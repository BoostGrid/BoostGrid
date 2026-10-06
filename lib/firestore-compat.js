// Firestore-shaped compatibility shim on Appwrite: re-implements the Firestore function names (doc, getDoc, setDoc,
// updateDoc, addDoc, collection, query, where, onSnapshot, increment, arrayUnion, serverTimestamp,
// onAuthStateChanged, signOut) so pages need only a new import
// Differences:
// - timestamps are ISO strings, not Timestamp objects (use new Date(value) instead of .toDate())
// - onSnapshot() re-fetches the whole filtered query on any collection change (Appwrite Realtime), no incremental
// diffs
// - increment()/arrayUnion() are read-then-write, not atomic: fine for counters and notification lists, never for
// money (cloud functions handle balances)

import { client, account, databases, DATABASE_ID, Query as AWQuery, ID } from "./appwrite-config.js";

export const db = {}; // placeholder so `getFirestore(app)`-style code that just passes `db` around keeps working

// References
export function collection(_db, colId) {
  return { __isCollRef: true, _col: colId, _filters: [] };
}

export function doc(_db, colId, id) {
  return { __isDocRef: true, _col: colId, _id: id };
}

// Query building
export function query(collRef, ...clauses) {
  const base = collRef.__isCollRef ? collRef : { _col: collRef, _filters: [] };
  return { __isCollRef: true, _col: base._col, _filters: [...base._filters, ...clauses] };
}

export function where(field, op, value) {
  switch (op) {
    case "==": return AWQuery.equal(field, value);
    case "!=": return AWQuery.notEqual(field, value);
    case ">": return AWQuery.greaterThan(field, value);
    case ">=": return AWQuery.greaterThanEqual(field, value);
    case "<": return AWQuery.lessThan(field, value);
    case "<=": return AWQuery.lessThanEqual(field, value);
    case "in": return AWQuery.equal(field, value); // Appwrite treats an array as an OR/IN match
    case "array-contains": return AWQuery.contains(field, value);
    default: throw new Error(`Unsupported where() operator: ${op}`);
  }
}

export function orderBy(field, direction = "asc") {
  return direction === "desc" ? AWQuery.orderDesc(field) : AWQuery.orderAsc(field);
}

export function limit(n) {
  return AWQuery.limit(n);
}

// Sentinel values (non-atomic emulation — see notes above)
export function serverTimestamp() {
  return new Date().toISOString();
}

export function increment(delta) {
  return { __increment: true, value: delta };
}

export function arrayUnion(...items) {
  return { __arrayUnion: true, values: items };
}

export function arrayRemove(...items) {
  return { __arrayRemove: true, values: items };
}

// splits data into normal fields (written directly) and special ops (increment/arrayUnion/arrayRemove) that need
// extra API calls
function splitSpecialOps(data) {
  const normal = {};
  const ops = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && val.__increment) ops.push({ type: "increment", key, value: val.value });
    else if (val && val.__arrayUnion) ops.push({ type: "arrayUnion", key, values: val.values });
    else if (val && val.__arrayRemove) ops.push({ type: "arrayRemove", key, values: val.values });
    else normal[key] = val;
  }
  return { normal, ops };
}

async function applySpecialOps(colId, id, ops) {
  for (const op of ops) {
    if (op.type === "increment") {
      if (op.value >= 0) {
        await databases.incrementDocumentAttribute(DATABASE_ID, colId, id, op.key, op.value);
      } else {
        await databases.decrementDocumentAttribute(DATABASE_ID, colId, id, op.key, Math.abs(op.value));
      }
    } else if (op.type === "arrayUnion" || op.type === "arrayRemove") {
      // Read-modify-write — fine for notification lists, not for money.
      const current = await databases.getDocument(DATABASE_ID, colId, id);
      let arr = Array.isArray(current[op.key]) ? [...current[op.key]] : [];
      if (op.type === "arrayUnion") {
        op.values.forEach(v => {
          const exists = arr.some(existing => JSON.stringify(existing) === JSON.stringify(v));
          if (!exists) arr.push(v);
        });
      } else {
        arr = arr.filter(existing => !op.values.some(v => JSON.stringify(existing) === JSON.stringify(v)));
      }
      await databases.updateDocument(DATABASE_ID, colId, id, { [op.key]: arr });
    }
  }
}

// Reads / writes
export async function getDoc(ref) {
  try {
    const data = await databases.getDocument(DATABASE_ID, ref._col, ref._id);
    return { exists: () => true, data: () => data, id: data.$id, ref };
  } catch (err) {
    if (err.code === 404) return { exists: () => false, data: () => undefined, id: ref._id, ref };
    throw err;
  }
}

export async function getDocs(queryRef) {
  const res = await databases.listDocuments(DATABASE_ID, queryRef._col, queryRef._filters);
  const docs = res.documents.map(d => ({
    id: d.$id,
    data: () => d,
    ref: doc(db, queryRef._col, d.$id)
  }));
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (fn) => docs.forEach(fn)
  };
}

export async function getCountFromServer(queryRef) {
  const res = await databases.listDocuments(DATABASE_ID, queryRef._col, [...queryRef._filters, AWQuery.limit(1)]);
  return { data: () => ({ count: res.total }) };
}

export async function addDoc(collRef, data) {
  const { normal, ops } = splitSpecialOps(data);
  const created = await databases.createDocument(DATABASE_ID, collRef._col, ID.unique(), normal);
  if (ops.length) await applySpecialOps(collRef._col, created.$id, ops);
  return { id: created.$id };
}

export async function setDoc(ref, data) {
  const { normal, ops } = splitSpecialOps(data);
  try {
    await databases.updateDocument(DATABASE_ID, ref._col, ref._id, normal);
  } catch (err) {
    if (err.code === 404) {
      await databases.createDocument(DATABASE_ID, ref._col, ref._id, normal);
    } else {
      throw err;
    }
  }
  if (ops.length) await applySpecialOps(ref._col, ref._id, ops);
}

export async function updateDoc(ref, data) {
  const { normal, ops } = splitSpecialOps(data);
  if (Object.keys(normal).length) {
    await databases.updateDocument(DATABASE_ID, ref._col, ref._id, normal);
  }
  if (ops.length) await applySpecialOps(ref._col, ref._id, ops);
}

export async function deleteDoc(ref) {
  await databases.deleteDocument(DATABASE_ID, ref._col, ref._id);
}

// realtime ("onSnapshot"): Appwrite can't filter server-side, so the filtered fetch re-runs on any collection
// change; returns an unsubscribe function
export function onSnapshot(refOrQuery, callback) {
  let cancelled = false;

  async function fetchAndEmit() {
    if (cancelled) return;
    if (refOrQuery.__isDocRef) {
      const snap = await getDoc(refOrQuery);
      callback(snap);
    } else {
      const snap = await getDocs(refOrQuery);
      callback(snap);
    }
  }

  fetchAndEmit();

  const colId = refOrQuery._col;
  const unsubscribe = client.subscribe(
    `databases.${DATABASE_ID}.collections.${colId}.documents`,
    () => fetchAndEmit()
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

// no-op: Appwrite's web SDK needs no offline persistence; kept so old call sites still work
export function enableIndexedDbPersistence() {
  return Promise.resolve();
}

// Auth shim (onAuthStateChanged / signOut / auth.currentUser)
function mapUser(u) {
  if (!u) return null;
  return { uid: u.$id, email: u.email, displayName: u.name };
}

export const auth = { currentUser: null };

// Appwrite's web SDK has no live auth-state events, so this checks the session once on call (all the pages need)
export function onAuthStateChanged(_auth, callback) {
  account.get()
    .then(u => { auth.currentUser = mapUser(u); callback(auth.currentUser); })
    .catch(() => { auth.currentUser = null; callback(null); });
  return () => {}; // unsubscribe no-op, kept for API parity
}

export async function signOut(_auth) {
  await account.deleteSession("current");
  auth.currentUser = null;
}

export async function sendPasswordResetEmail(_auth, email) {
  const recoveryUrl = window.location.origin + "/login.html";
  await account.createRecovery(email, recoveryUrl);
}
