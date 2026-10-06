/* BoostGrid email verification (shared by the client, earner and admin pages)
   mountEmailVerify({ account, after }): account = Appwrite Account from lib/appwrite-config.js; after = profile
   card element (the Email card goes right below it)
   Shows the address with a "Verified" badge or a "Verify email" button; the modal's Proceed sends the link
   (account.createVerification) and shows "Check your inbox" with a reply timer (Resend unlocks at zero; survives
   refresh via per-user localStorage)
   The emailed link returns to the same page with ?userId=...&secret=..., which finishes verification and shows a
   result modal ("Email verified" or "Link expired") */

const RESEND_SECONDS = 60;
const STYLE_ID = 'ev-style';

const CSS = `
.ev-card{ display:flex; align-items:center; gap:12px; margin:0 0 16px; padding:14px 16px; background:var(--surface,#fff); border:1px solid var(--border,#dceee5); border-radius:var(--radius-lg,22px); box-shadow:var(--shadow,0 8px 24px rgba(13,31,23,.06)); }
.ev-ico{ flex:0 0 auto; width:38px; height:38px; display:grid; place-items:center; border-radius:12px; background:var(--brand-soft,#e6faf2); color:var(--brand-deep,#00a873); }
body.dark .ev-ico{ color:var(--brand,#00e6a0); }
.ev-ico svg{ width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.ev-txt{ flex:1 1 auto; min-width:0; }
.ev-lbl{ margin:0; font:600 11px system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--text-dim,#5b7268); }
.ev-addr{ margin:2px 0 0; font:600 12px system-ui,sans-serif; color:var(--text,#0d1f17); overflow-wrap:anywhere; }
.ev-badge{ flex:0 0 auto; display:inline-flex; align-items:center; gap:5px; padding:7px 12px; border-radius:999px; border:0; font:700 12px system-ui,sans-serif; white-space:nowrap; }
.ev-badge svg{ width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; }
.ev-badge.ok{ color:var(--brand-deep,#00a873); background:var(--brand-soft,#e6faf2); }
body.dark .ev-badge.ok{ color:var(--brand,#00e6a0); }
button.ev-badge.todo{ cursor:pointer; color:#7a4b00; background:#fff1d6; transition:transform .2s; }
body.dark button.ev-badge.todo{ color:#ffd98a; background:#3a2a0a; }
button.ev-badge.todo:active{ transform:scale(.95); }
.ev-skel{ opacity:.55; }

.ev-overlay{ position:fixed; inset:0; z-index:100000; display:none; align-items:center; justify-content:center; padding:20px; background:rgba(5,16,12,.55); -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); }
.ev-overlay.show{ display:flex; animation:evFade .2s ease both; }
.ev-modal{ width:100%; max-width:360px; padding:26px 22px 33px; text-align:center; background:var(--surface,#fff); color:var(--text,#0d1f17); border:1px solid var(--border,#dceee5); border-radius:var(--radius-lg,22px); box-shadow:0 20px 60px rgba(0,0,0,.35); animation:evPop .32s cubic-bezier(.34,1.56,.64,1) both; }
.ev-mico{ width:56px; height:56px; margin:0 auto 14px; display:grid; place-items:center; border-radius:50%; background:var(--brand-soft,#e6faf2); color:var(--brand-deep,#00a873); }
body.dark .ev-mico{ color:var(--brand,#00e6a0); }
.ev-mico.bad{ background:#fde8ec; color:var(--danger,#e8546a); }
body.dark .ev-mico.bad{ background:#3a1620; }
.ev-mico svg{ width:28px; height:28px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.ev-modal h3{ margin:0 0 8px; font:700 17px system-ui,sans-serif; letter-spacing:-.01em; }
.ev-modal p{ margin:0; font:400 13.5px/1.5 system-ui,sans-serif; color:var(--text-dim,#5b7268); overflow-wrap:anywhere; }
.ev-modal p b{ color:var(--text,#0d1f17); font-weight:600; font-size:12.5px; }
.ev-timer{ margin:14px 0 0; font:600 13px system-ui,sans-serif; color:var(--text-dim,#5b7268); }
.ev-timer b{ color:var(--brand-deep,#00a873); font-variant-numeric:tabular-nums; }
body.dark .ev-timer b{ color:var(--brand,#00e6a0); }
.ev-btns{ display:flex; gap:10px; margin-top:20px; }
.ev-btns button{ flex:1 1 0; min-width:0; padding:12px 10px; border:0; border-radius:var(--radius-sm,12px); cursor:pointer; font:700 13.5px system-ui,sans-serif; transition:transform .2s, opacity .2s; }
.ev-btns button:active:not(:disabled){ transform:scale(.96); }
.ev-btns button:disabled{ opacity:.5; cursor:not-allowed; }
.ev-btns .ev-later{ color:var(--text-dim,#5b7268); background:var(--bg,#f6fbf8); border:1px solid var(--border,#dceee5); }
.ev-btns .ev-go{ color:#04140d; background:linear-gradient(135deg,var(--brand,#00cc88),var(--brand-deep,#00a873)); }
.ev-err{ margin-top:12px !important; color:var(--danger,#e8546a) !important; font-size:12.5px !important; }
@keyframes evFade{ from{ opacity:0 } to{ opacity:1 } }
@keyframes evPop{ from{ opacity:0; transform:scale(.9) translateY(8px) } to{ opacity:1; transform:none } }
@media (prefers-reduced-motion:reduce){ .ev-overlay.show,.ev-modal{ animation:none } }
`;

const ICON = {
  mail:  '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 17h.01"/></svg>'
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

export async function mountEmailVerify({ account, after }) {
  if (!account || !after || document.getElementById('evCard')) return;

  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* the Email card */
  const card = document.createElement('div');
  card.className = 'ev-card ev-skel';
  card.id = 'evCard';
  card.innerHTML =
    '<span class="ev-ico">' + ICON.mail + '</span>' +
    '<div class="ev-txt"><p class="ev-lbl">Email</p><p class="ev-addr" id="evAddr">Loading…</p></div>' +
    '<span class="ev-badge" id="evStatus"></span>';
  after.insertAdjacentElement('afterend', card);

  /* the modal (one overlay, content swapped per state) */
  const overlay = document.createElement('div');
  overlay.className = 'ev-overlay';
  overlay.innerHTML = '<div class="ev-modal" role="dialog" aria-modal="true" aria-live="polite"></div>';
  document.body.appendChild(overlay);
  const modal = overlay.firstElementChild;

  let user = null;          // Appwrite account object
  let tick = null;          // countdown interval

  const openModal = html => { modal.innerHTML = html; overlay.classList.add('show'); };
  const closeModal = () => { overlay.classList.remove('show'); clearInterval(tick); tick = null; };
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('show')) closeModal(); });

  /* reply timer storage (survives refresh) */
  const key = () => 'socihub_ev_next_' + (user ? user.$id : '');
  const readNext = () => { try { return Number(localStorage.getItem(key())) || 0; } catch (_) { return 0; } };
  const writeNext = t => { try { localStorage.setItem(key(), String(t)); } catch (_) {} };
  const clearNext = () => { try { localStorage.removeItem(key()); } catch (_) {} };
  const remaining = () => Math.max(0, Math.ceil((readNext() - Date.now()) / 1000));

  /* paint the card */
  function paint() {
    card.classList.remove('ev-skel');
    card.querySelector('#evAddr').textContent = user.email || '—';
    const slot = card.querySelector('#evStatus');
    const fresh = document.createElement(user.emailVerification ? 'span' : 'button');
    fresh.id = 'evStatus';
    if (user.emailVerification) {
      fresh.className = 'ev-badge ok';
      fresh.innerHTML = ICON.check + 'Verified';
    } else {
      fresh.type = 'button';
      fresh.className = 'ev-badge todo';
      fresh.textContent = 'Verify email';
      fresh.addEventListener('click', openConfirm);
    }
    slot.replaceWith(fresh);
  }

  /* modal states */
  function openConfirm() {
    const wait = remaining();
    openModal(
      '<div class="ev-mico">' + ICON.mail + '</div>' +
      '<h3>Verify your email</h3>' +
      '<p>We are sending you a verification link to your email<br><b>' + esc(user.email) + '</b></p>' +
      '<p class="ev-timer" id="evTimer" ' + (wait ? '' : 'hidden') + '></p>' +
      '<p class="ev-err" id="evErr" hidden></p>' +
      '<div class="ev-btns"><button type="button" class="ev-later" id="evLater">Later</button>' +
      '<button type="button" class="ev-go" id="evGo">Proceed</button></div>'
    );
    modal.querySelector('#evLater').onclick = closeModal;
    const go = modal.querySelector('#evGo');
    go.onclick = () => send(go);
    runTimer(go, 'Proceed');
  }

  function openSent() {
    openModal(
      '<div class="ev-mico">' + ICON.check + '</div>' +
      '<h3>Check your inbox</h3>' +
      '<p>We sent a verification link to<br><b>' + esc(user.email) + '</b></p>' +
      '<p class="ev-timer" id="evTimer"></p>' +
      '<p class="ev-err" id="evErr" hidden></p>' +
      '<div class="ev-btns"><button type="button" class="ev-later" id="evLater">Close</button>' +
      '<button type="button" class="ev-go" id="evGo">Resend link</button></div>'
    );
    modal.querySelector('#evLater').onclick = closeModal;
    const go = modal.querySelector('#evGo');
    go.onclick = () => send(go);
    runTimer(go, 'Resend link');
  }

  /* the reply timer: disables the button and counts down until another link may be sent */
  function runTimer(btn, label) {
    clearInterval(tick);
    const out = modal.querySelector('#evTimer');
    const step = () => {
      const s = remaining();
      if (s > 0) {
        btn.disabled = true;
        out.hidden = false;
        out.innerHTML = 'You can request another link in <b>' + mmss(s) + '</b>';
      } else {
        btn.disabled = false;
        btn.textContent = label;
        out.hidden = true;
        clearInterval(tick); tick = null;
      }
    };
    step();
    if (remaining() > 0) tick = setInterval(step, 1000);
  }

  async function send(btn) {
    if (remaining() > 0) return;
    const err = modal.querySelector('#evErr');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      // the link brings the person back to this same page, which finishes the verification below
      await account.createVerification(window.location.origin + window.location.pathname);
      writeNext(Date.now() + RESEND_SECONDS * 1000);
      openSent();
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Proceed';
      err.textContent = (e && e.code === 429)
        ? 'Too many requests. Please wait a bit and try again.'
        : 'We couldn’t send the link. Please try again.';
      err.hidden = false;
    }
  }

  function openResult(ok) {
    openModal(
      '<div class="ev-mico' + (ok ? '' : ' bad') + '">' + (ok ? ICON.check : ICON.alert) + '</div>' +
      '<h3>' + (ok ? 'Email verified' : 'Link expired or invalid') + '</h3>' +
      '<p>' + (ok
        ? 'Thanks! <b>' + esc(user ? user.email : 'Your email') + '</b> is now verified.'
        : 'This verification link can’t be used. Tap “Verify email” to get a new one.') + '</p>' +
      '<div class="ev-btns"><button type="button" class="ev-go" id="evOk">' + (ok ? 'Done' : 'OK') + '</button></div>'
    );
    modal.querySelector('#evOk').onclick = closeModal;
  }

  /* load the account, then finish a verification link if we were opened from one */
  try {
    user = await account.get();
  } catch (e) {
    card.remove();    // no session: the page's own guard handles sending the person to login
    return;
  }
  paint();

  const params = new URLSearchParams(window.location.search);
  const uid = params.get('userId'), secret = params.get('secret');
  if (uid && secret) {
    let ok = false;
    try { await account.updateVerification(uid, secret); ok = true; } catch (e) { console.error(e); }
    // drop the one-time values from the address bar so a refresh doesn't replay them
    params.delete('userId'); params.delete('secret'); params.delete('expire');
    const qs = params.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    if (ok) {
      clearNext();
      try { user = await account.get(); } catch (_) { user.emailVerification = true; }
      paint();
    }
    openResult(ok);
  }
}
