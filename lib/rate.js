/* BoostGrid rating modal (reusable)
   RateCard.show({ title, subtitle, onSubmit(data) -> Promise (data = { stars, tags[], note }; default ledger-ops
   "submit-review"), onLater() -> Promise (default "review-later"), eyebrow, tags:false, laterLabel,
   initial:{stars,note}, doneText, onOpen, onClose })
   RateCard.hide(), RateCard.isOpen()
   Loaded by lib/notice.js the first time a "rate" notice opens, or via <script src="lib/rate.js"></script>;
   needs the page's theme variables
   Tap outside / Escape closes it without logging; only the two buttons record a result */
(function () {
  'use strict';
  var BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*$/, '') : new URL('lib/', document.baseURI).href;
  var TAGS = ['Easy to use', 'Fast payouts', 'Great support', 'Good tasks', 'Needs improvement', 'Hard to understand'];
  var LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  var NOTE_MAX = 300;

  var CSS = '' +
'.rc-layer{position:fixed;inset:0;z-index:125;display:flex;align-items:center;justify-content:center;padding:20px}' +
'.rc-scrim{position:absolute;inset:0;background:rgba(5,16,12,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .3s ease}' +
'.rc-card{position:relative;width:100%;max-width:400px;max-height:calc(100svh - 40px);display:flex;flex-direction:column;overflow:hidden;background:var(--surface,#fff);color:var(--text,#0d1f17);border:1px solid var(--border,#dceee5);border-radius:var(--radius-lg,22px);box-shadow:0 40px 80px -24px rgba(5,16,12,.55),0 0 0 1px color-mix(in srgb,var(--brand,#00cc88) 14%,transparent);opacity:0;transform:translateY(22px) scale(.92);transition:opacity .25s ease,transform .45s var(--spring,cubic-bezier(.34,1.56,.64,1))}' +
'.rc-layer.in .rc-scrim{opacity:1}.rc-layer.in .rc-card{opacity:1;transform:none}.rc-layer:not(.in) .rc-card{transition:opacity .18s ease,transform .2s ease;transform:scale(.95)}' +
'.rc-hero{position:relative;flex:0 0 auto;min-height:112px;padding:22px 22px 18px;display:flex;align-items:flex-end;overflow:hidden;color:#04140d;background:radial-gradient(120% 140% at 100% 0%,rgba(255,255,255,.35) 0%,transparent 45%),linear-gradient(135deg,var(--brand,#00cc88),var(--brand-deep,#00a873))}' +
'.rc-hero::before{content:"";position:absolute;width:190px;height:190px;right:-60px;top:-96px;border-radius:50%;border:26px solid rgba(255,255,255,.16)}' +
'.rc-copy{position:relative;z-index:2;min-width:0;padding-right:78px}' +
'.rc-eyebrow{margin:0 0 6px;font-size:13px;font-weight:600;opacity:.78}' +
'.rc-title{margin:0;font-family:"Unbounded",system-ui,sans-serif;font-size:19px;font-weight:700;line-height:1.2;letter-spacing:-.02em;text-wrap:balance;overflow-wrap:break-word}' +
'.rc-art{position:absolute;z-index:1;right:12px;bottom:-14px;width:84px;height:84px;transform:rotate(14deg);filter:drop-shadow(0 10px 10px rgba(4,20,13,.35))}' +
'.rc-star{display:block;background:linear-gradient(150deg,#fff2a8 0%,#ffc933 45%,#ff9a16 100%);clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}' +
'.rc-art .rc-star{width:100%;height:100%}' +
'.rc-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 20px 4px}' +
'.rc-sub{margin:0;font-size:13.5px;line-height:1.5;color:var(--text-dim,#5b7268)}' +
'.rc-stars{display:flex;justify-content:center;gap:4px;margin:14px 0 4px}' +
'.rc-stars button{border:0;background:none;padding:3px;cursor:pointer;transition:transform .25s var(--spring,cubic-bezier(.34,1.56,.64,1))}' +
'.rc-stars button:active{transform:scale(.84)}' +
'.rc-stars .rc-star{width:38px;height:38px;background:var(--border-strong,#c3e6d7)}' +
'.rc-stars button.on{filter:drop-shadow(0 4px 7px rgba(255,160,20,.5))}.rc-stars button.on .rc-star{background:linear-gradient(150deg,#fff2a8 0%,#ffc933 45%,#ff9a16 100%)}' +
'.rc-lbl{height:18px;margin:0 0 12px;text-align:center;font-size:13px;font-weight:600;color:var(--text-dim,#5b7268)}' +
'.rc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}' +
'.rc-chips button{font:inherit;font-size:13px;border:1px solid var(--border,#dceee5);background:var(--surface-2,#f0f9f5);color:inherit;border-radius:999px;padding:7px 12px;cursor:pointer}' +
'.rc-chips button[aria-pressed="true"]{background:color-mix(in srgb,var(--brand,#00cc88) 22%,transparent);border-color:var(--brand,#00cc88)}' +
'.rc-note{width:100%;resize:none;font:inherit;font-size:14px;line-height:1.5;padding:12px;border-radius:12px;border:1px solid var(--border,#dceee5);background:var(--surface-2,#f0f9f5);color:inherit}' +
'.rc-cnt{margin:4px 2px 0;text-align:right;font-size:11px;color:var(--text-dim,#5b7268)}' +
'.rc-err{margin:8px 0 0;font-size:13px;color:#e5484d}' +
'.rc-foot{flex:0 0 auto;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 20px 20px}' +
'.rc-btn{border:1px solid transparent;border-radius:var(--radius-sm,12px);padding:13px 10px;font-family:"Space Grotesk",system-ui,sans-serif;font-size:14px;font-weight:700;cursor:pointer;color:#04140d;background:linear-gradient(135deg,var(--brand,#00cc88),var(--brand-deep,#00a873));box-shadow:0 10px 24px -8px color-mix(in srgb,var(--brand,#00cc88) 55%,transparent);transition:transform .28s var(--spring,ease)}' +
'.rc-btn.ghost{background:var(--surface-2,#f0f9f5);color:inherit;border-color:var(--border,#dceee5);box-shadow:none}' +
'.rc-btn:active{transform:scale(.96)}.rc-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}' +
'.rc-done{padding:30px 20px 26px;text-align:center}.rc-done b{display:block;font-family:"Unbounded",system-ui,sans-serif;font-size:18px;margin-bottom:6px}.rc-done p{margin:0;font-size:14px;color:var(--text-dim,#5b7268)}' +
'.rc-stars button:focus-visible,.rc-chips button:focus-visible,.rc-btn:focus-visible,.rc-note:focus-visible{outline:2px solid var(--brand,#00cc88);outline-offset:2px}' +
'@media (prefers-reduced-motion:reduce){.rc-card,.rc-scrim{transition:none}}';

  function api(payload) {
    return import(BASE + 'appwrite-config.js').then(function (m) { return m.callFunction(m.FUNCTIONS.LEDGER_OPS, payload); });
  }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  var root = null, opts = null, lastFocus = null, closing = null, st = null;

  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); RateCard.hide(); } }

  function show(o) {
    o = o || {};
    if (root) hide(true);
    if (!document.getElementById('rcStyle')) { var s = document.createElement('style'); s.id = 'rcStyle'; s.textContent = CSS; document.head.appendChild(s); }
    opts = o; st = { rate: 0, tags: {}, busy: false };

    root = el('div', 'rc-layer'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'rcTitle');
    root.innerHTML =
      '<div class="rc-scrim"></div><div class="rc-card">' +
      '<div class="rc-hero"><div class="rc-copy"><p class="rc-eyebrow">Your feedback</p><h2 class="rc-title" id="rcTitle"></h2></div><div class="rc-art" aria-hidden="true"><i class="rc-star"></i></div></div>' +
      '<div class="rc-main" style="display:flex;flex-direction:column;min-height:0;flex:1 1 auto">' +
      '<div class="rc-body"><p class="rc-sub"></p>' +
      '<div class="rc-stars" role="radiogroup" aria-label="Rating"></div><p class="rc-lbl" aria-live="polite">Tap a star</p>' +
      '<div class="rc-chips"></div>' +
      '<textarea class="rc-note" rows="3" maxlength="' + NOTE_MAX + '" placeholder="Add a note (optional)" aria-label="Note"></textarea><div class="rc-cnt">0 / ' + NOTE_MAX + '</div>' +
      '<p class="rc-err" role="alert" hidden></p></div>' +
      '<div class="rc-foot"><button type="button" class="rc-btn ghost" data-rc="later">Remind me later</button><button type="button" class="rc-btn" data-rc="send" disabled>Send</button></div></div></div>';
    var q = function (sel) { return root.querySelector(sel); };
    q('.rc-eyebrow').textContent = o.eyebrow || 'Your feedback'; if (o.tags === false) q('.rc-chips').style.display = 'none'; if (o.laterLabel) q('[data-rc="later"]').textContent = o.laterLabel;
    q('.rc-title').textContent = o.title || 'How is BoostGrid working for you?';
    q('.rc-sub').textContent = o.subtitle || 'Your rating helps us make the platform better for everyone.';
    var stars = q('.rc-stars'), lbl = q('.rc-lbl'), send = q('[data-rc="send"]'), later = q('[data-rc="later"]'), note = q('.rc-note'), err = q('.rc-err');
    for (var i = 1; i <= 5; i++) { var b = el('button', '', '<i class="rc-star"></i>'); b.type = 'button'; b.dataset.s = i; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', i + ' star' + (i > 1 ? 's' : '')); stars.appendChild(b); }
    if (o.tags !== false) TAGS.forEach(function (t) { var b = el('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', 'false'); q('.rc-chips').appendChild(b); });

    function paint() {
      [].forEach.call(stars.children, function (b) { var on = +b.dataset.s <= st.rate; b.classList.toggle('on', on); b.setAttribute('aria-checked', +b.dataset.s === st.rate); });
      lbl.textContent = LABELS[st.rate] || 'Tap a star'; send.disabled = !st.rate || st.busy; later.disabled = st.busy;
    }
    function busy(v, text) { st.busy = v; paint(); if (text) send.textContent = text; }
    function fail(e) { err.textContent = (e && e.message) || 'Could not send. Try again.'; err.hidden = false; send.textContent = 'Send'; busy(false); }

    stars.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { st.rate = +b.dataset.s; paint(); } });
    q('.rc-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var t = b.textContent; if (st.tags[t]) delete st.tags[t]; else st.tags[t] = 1; b.setAttribute('aria-pressed', !!st.tags[t]); });
    note.addEventListener('input', function () { q('.rc-cnt').textContent = note.value.length + ' / ' + NOTE_MAX; });
    q('.rc-scrim').addEventListener('click', function () { hide(); });
    root.addEventListener('click', function (e) { if (e.target === root) hide(); });

    function thanks(title, text) {
      var d = el('div', 'rc-done', '<b></b><p></p>'); d.querySelector('b').textContent = title; d.querySelector('p').textContent = text;
      var m = q('.rc-main'); m.replaceWith(d); setTimeout(function () { if (root) hide(); }, 1500);
    }
    send.addEventListener('click', function () {
      if (!st.rate || st.busy) return; err.hidden = true; busy(true, 'Sending…');
      var data = { stars: st.rate, tags: Object.keys(st.tags), note: note.value.trim() };
      var run = o.onSubmit ? Promise.resolve(o.onSubmit(data)) : api({ action: 'submit-review', stars: data.stars, tags: data.tags, note: data.note });
      run.then(function () { thanks('Thank you', o.doneText || 'Your review was sent.'); }, fail);
    });
    later.addEventListener('click', function () {
      if (st.busy) return; err.hidden = true; busy(true);
      var run = o.onLater ? Promise.resolve(o.onLater()) : api({ action: 'review-later' });
      run.then(function () { hide(); }, fail);
    });

    if (o.initial && o.initial.stars) { st.rate = o.initial.stars; note.value = o.initial.note || ''; q('.rc-cnt').textContent = note.value.length + ' / ' + NOTE_MAX; }
    lastFocus = document.activeElement;
    document.body.appendChild(root); document.addEventListener('keydown', onKey, true);
    paint(); void root.offsetWidth; root.classList.add('in');
    stars.children[0].focus({ preventScroll: true });
    if (typeof o.onOpen === 'function') o.onOpen();
  }

  function hide(instant) {
    if (!root) return;
    var l = root, o = opts; root = null; opts = null;
    document.removeEventListener('keydown', onKey, true);
    l.classList.remove('in'); clearTimeout(closing);
    if (instant) l.remove(); else closing = setTimeout(function () { l.remove(); }, 260);
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) {}
    if (o && typeof o.onClose === 'function') o.onClose();
  }

  var RateCard = { show: show, hide: hide, isOpen: function () { return !!root; }, TAGS: TAGS };
  window.RateCard = RateCard;
})();
