// BoostGrid Appwrite client configuration
// Fill in your project values (Appwrite Console -> Project Settings); imported as an ES module by every page that
// needs auth or database access

import { Client, Account, Databases, Storage, Functions, ID, Query, Permission, Role } from "https://cdn.jsdelivr.net/npm/appwrite@16.0.2/dist/esm/sdk.js";

export const APPWRITE_ENDPOINT = "https://nyc.cloud.appwrite.io/v1"; // e.g. https://fra.cloud.appwrite.io/v1
export const APPWRITE_PROJECT_ID = "6a638e99000a85010998";
export const DATABASE_ID = "6a644fc2001f2af1ed4e";

// collection IDs (create these in your database)
export const COLLECTIONS = {
  USERS: "users",
  PROJECTS: "projects",
  TASKS: "tasks",
  DEPOSITS: "deposits",
  WITHDRAWALS: "withdrawals",
  NOTIFICATIONS: "notifications", // one document per notification — see SETUP.md
  PLATFORM_REVENUE: "platform_revenue", // one document per platform-fee event — see SETUP.md
  SUPPORT_MESSAGES: "6aaced060014e8e4e62a", // one document per chat message — see SETUP.md
  ADMIN_RATINGS: "admin_ratings", // one document per project: the client's 1-5 star rating of its admin (server-written; read via ledger-ops
// "admin-ratings")
  ADMIN_ACTIVITIES: "admin_activities", // one document per admin action (approve, reject, flag, dismiss, reinstate, escalate) — see SCHEMA_REFERENCE.txt
};

// cloud function IDs (see /functions)
export const FUNCTIONS = {
  WALLET_OPS: "wallet-ops",   // verify-payment | submit-withdrawal | process-withdrawal (action field)
  LEDGER_OPS: "ledger-ops",   // calculate-project | approve-task | claim-referral (action field)
};

// storage bucket: one shared bucket for all uploads (task proof, example screenshots, profile pictures);
// permissions are per file (see uploadToStorage), so "File security" must be ON for the bucket
export const MEDIA_BUCKET_ID = "6aabb62100100a3e422f";

// client SDK setup (do not edit below this line)
export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export { ID, Query, Permission, Role };

// shared helpers

/* Gets the logged-in user, or redirects to login.html; call at the top of every protected page */
export async function requireSession(redirectTo = "login.html") {
  try {
    const user = await account.get();
    return user;
  } catch (err) {
    window.location.href = redirectTo;
    return null;
  }
}

/* Like requireSession, but a slow or dead connection isn't "logged out": only a real 401 redirects to login;
   otherwise throws an Error with `.offline = true` so the page can show Retry */
export async function requireSessionOrRetry(redirectTo = "login.html", timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([
      account.get(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("Timed out"), { offline: true })), timeoutMs); })
    ]);
  } catch (err) {
    if (err && (err.code === 401 || err.type === "general_unauthorized_scope" || err.type === "user_unauthorized")) { window.location.href = redirectTo; return null; }
    const e = new Error(err && err.offline ? "The connection timed out." : "Could not reach BoostGrid.");
    e.offline = true; throw e;
  } finally { clearTimeout(timer); }
}

/* Presence + typing for the support chat (ledger-ops "presence")
   startPresence(): heartbeat every 60s while the tab is visible (owner sees "Online")
   sendTyping(true|false): tell the owner you are typing (max one call per 3s)
   watchSupportTyping(userId, cb): cb(true|false) while support types to you; returns an unsubscribe fn */
let _presTimer = null, _typeAt = 0;
export function startPresence() {
  if (_presTimer) return;
  const beat = () => { if (document.visibilityState === "visible") callFunction(FUNCTIONS.LEDGER_OPS, { action: "presence" }).catch(() => {}); };
  beat(); _presTimer = setInterval(beat, 60000); document.addEventListener("visibilitychange", beat);
}
export function sendTyping(typing = true) {
  const now = Date.now();
  if (typing && now - _typeAt < 3000) return;
  _typeAt = typing ? now : 0;
  callFunction(FUNCTIONS.LEDGER_OPS, { action: "presence", typing }).catch(() => {});
}
export function watchSupportTyping(userId, cb) {
  let off = () => {}, clear;
  try {
    off = client.subscribe(`databases.${DATABASE_ID}.collections.${COLLECTIONS.USERS}.documents.${userId}`, ev => {
      const t = Date.parse(ev.payload && ev.payload.supportTypingAt); clearTimeout(clear);
      if (t && Date.now() - t < 6000) { cb(true); clear = setTimeout(() => cb(false), 6000); } else cb(false);
    });
  } catch {}
  return () => { clearTimeout(clear); try { off(); } catch {} };
}

/* Fetches the user's profile document (role, wallet balance, ...) from USERS, keyed by the auth user's $id */
export async function getUserProfile(userId) {
  return await databases.getDocument(DATABASE_ID, COLLECTIONS.USERS, userId);
}

/* Sends a support chat message via ledger-ops ("send-support-message"); readable only by its user and the owner
   team
   senderRole is "user" | "owner"; userId is always the conversation owner's id, so both sides share one thread
   `read` means "the OTHER party has seen it" (drives the unread badges)
   Goes through ledger-ops because a client can't grant permissions to team_owner (direct createDocument fails
   with user_unauthorized)
   attachmentUrl: optional image URL already uploaded to the media bucket */
export async function sendSupportMessage(userId, senderRole, message, attachmentUrl = "") {
  return await callFunction(FUNCTIONS.LEDGER_OPS, {
    action: "send-support-message",
    userId,
    senderRole,
    message,
    attachmentUrl
  });
}
export async function logout(redirectTo = "login.html") {
  try {
    await account.deleteSession("current");
  } finally {
    window.location.href = redirectTo;
  }
}

/* Uploads a file to the shared media bucket and returns a direct view URL
   permissions: Permission strings for this file (bucket needs "File security" ON), e.g.
   [Permission.read(Role.any())] public (profile pictures)
   [Permission.read(Role.users())] any signed-in user (screenshots)
   [Permission.read(Role.user(uid)), Permission.read(Role.team("team_owner"))] restricted (proof, chat
   attachments)
   A client can only grant roles it holds (itself, any, users); Role.team(...) entries are removed from the
   upload and applied afterwards via ledger-ops ("grant-storage-team-access") */
export async function uploadToStorage(file, permissions, { timeout = 60000, requireTeamGrant = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const teamIds = [];
    const clientGrantable = permissions.filter(p => {
      const match = /^read\("team:([^"]+)"\)$/.exec(p);
      if (match) { teamIds.push(match[1]); return false; }
      return true;
    });

    const uploaded = await storage.createFile(
      MEDIA_BUCKET_ID,
      ID.unique(),
      file,
      clientGrantable
    );

    if (teamIds.length) {
      // non-fatal: the file is already uploaded; failing here only means the team read grant wasn't added
      try {
        await callFunction(FUNCTIONS.LEDGER_OPS, {
          action: "grant-storage-team-access",
          fileId: uploaded.$id,
          teams: teamIds
        });
      } catch (grantErr) {
        console.error("Failed to grant team access to uploaded file:", grantErr);
        // fail loudly for uploads the team must be able to open (e.g. support-chat attachments)
        if (requireTeamGrant) {
          try { await storage.deleteFile(MEDIA_BUCKET_ID, uploaded.$id); } catch {}
          throw new Error("Couldn't share the file with support. Please try again.");
        }
      }
    }

    return storage.getFileView(MEDIA_BUCKET_ID, uploaded.$id).toString();
  } catch (err) {
    if (err.name === "AbortError" || controller.signal.aborted) {
      throw new Error("Upload timed out. Please try again.");
    }
    throw new Error(err.message || "Upload failed.");
  } finally {
    clearTimeout(timer);
  }
}

/* Calls an Appwrite Cloud Function synchronously and parses its JSON body; throws if it errored or returned
   {error} */
export async function callFunction(functionId, payload) {
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(payload || {}),
    false // synchronous — wait for the result
  );
  if (execution.responseStatusCode >= 400) {
    let msg = `Function ${functionId} failed (${execution.responseStatusCode})`;
    try { msg = JSON.parse(execution.responseBody).error || msg; } catch {}
    throw new Error(msg);
  }
  const data = JSON.parse(execution.responseBody || "{}");
  if (data.error) throw new Error(data.error);
  return data;
}

// restricted file viewing: a plain storage URL carries no login, so non-public files return 401 in
// <img>/<video>/tabs; this fetches the file with the user's session (short-lived JWT) and returns a blob: URL
// Returns { src, isVideo } (video detected from the real MIME type)
let _jwt = null, _jwtAt = 0, _jwtPending = null;
async function getJwt() {
  if (_jwt && Date.now() - _jwtAt < 10 * 60 * 1000) return _jwt;   // JWTs last 15 min
  // share one in-flight request so many attachments don't each create a JWT
  if (!_jwtPending) {
    _jwtPending = account.createJWT()
      .then(r => { _jwt = r.jwt; _jwtAt = Date.now(); return _jwt; })
      .finally(() => { _jwtPending = null; });
  }
  return _jwtPending;
}

const _fileCache = new Map(); // url -> Promise<{ src, isVideo }> (a URL is only ever downloaded once)
const _fileReady = new Map(); // url -> the resolved value, so re-renders can fill in images instantly (no flicker)
export function getProtectedFile(fileUrl) {
  if (_fileCache.has(fileUrl)) return _fileCache.get(fileUrl);
  const p = (async () => {
    // Not one of our Appwrite files (e.g. an older Cloudinary URL) — use it as-is.
    if (!fileUrl.startsWith(APPWRITE_ENDPOINT)) {
      return { src: fileUrl, isVideo: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(fileUrl) };
    }
    const res = await fetch(fileUrl, {
      headers: { "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-JWT": await getJwt() }
    });
    if (!res.ok) throw new Error(`Could not load file (${res.status})`);
    const blob = await res.blob();
    return { src: URL.createObjectURL(blob), isVideo: blob.type.startsWith("video/") };
  })();
  _fileCache.set(fileUrl, p);
  p.then(v => _fileReady.set(fileUrl, v), () => _fileCache.delete(fileUrl)); // a failed load can be retried later
  return p;
}

// drop-in for templates: emit <img data-protected-src="URL">, then call hydrateProtectedMedia(container) after
// setting innerHTML
// Each placeholder is filled using the user's session (see getProtectedFile); a video swaps the <img> for <video
// controls>; on failure an "error" event fires so onerror handlers still run
const UNAVAILABLE_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' rx='10' fill='#eee'/>" +
  "<text x='80' y='64' font-size='12' text-anchor='middle' fill='#999' font-family='sans-serif'>Unavailable</text></svg>");

export function hydrateProtectedMedia(root = document) {
  if (!document.getElementById("pm-style")) {
    const st = document.createElement("style");
    st.id = "pm-style";
    st.textContent = ".pm-loading{min-width:120px;min-height:120px;border-radius:10px;" +
      "background:linear-gradient(90deg,rgba(0,0,0,.06) 25%,rgba(0,0,0,.12) 50%,rgba(0,0,0,.06) 75%);" +
      "background-size:200% 100%;animation:pmShimmer 1.2s linear infinite}" +
      "@keyframes pmShimmer{to{background-position:-200% 0}}";
    document.head.appendChild(st);
  }
  const apply = (el, { src, isVideo }) => {
    if (isVideo && el.tagName === "IMG") {
      const v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = src;
      v.className = el.className.replace("pm-loading", "").trim();
      v.style.cssText = el.style.cssText;
      el.replaceWith(v);
    } else {
      el.src = src;
      el.classList.remove("pm-loading");
    }
  };
  root.querySelectorAll("[data-protected-src]:not([data-hydrated])").forEach((el) => {
    el.dataset.hydrated = "1";
    const url = el.dataset.protectedSrc;
    const ready = _fileReady.get(url);
    if (ready) return apply(el, ready);          // already downloaded this session
    el.classList.add("pm-loading");
    getProtectedFile(url).then(f => apply(el, f)).catch((err) => {
      console.error("Protected media failed:", err);
      el.classList.remove("pm-loading");
      el.dispatchEvent(new Event("error"));
      if (el.isConnected && el.tagName === "IMG" && !el.getAttribute("src")) el.src = UNAVAILABLE_IMG;
    });
  });
}
