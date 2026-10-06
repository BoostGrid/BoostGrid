/* BoostGrid notices (shared by the client, earner and admin pages)
   NoticeFmt.parse(doc): how a raw notification looks in the bell list, or null for types it doesn't own
   NoticeCard.show({...}): the reusable "read in full" banner; markup and look live in banner.html (fetched once)
   Owner notice format from ledger-ops: "<title>\u241E<body>" (title omitted when empty); types: announcement |
   promotion | dn (direct notification)
   Load with <script src="lib/notice.js"></script> before the page's module script; needs only the page's theme
   variables */
(function () {
  'use strict';
  var SEP = '\u241E';
  var BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^\/]*$/, '') : new URL('lib/', document.baseURI).href;

  function split(msg) {
    msg = String(msg == null ? '' : msg);
    var i = msg.indexOf(SEP);
    if (i < 0) return { title: '', body: msg.trim() };
    return { title: msg.slice(0, i).trim(), body: msg.slice(i + 1).trim() };
  }

  var NoticeFmt = {
    SEP: SEP,
    split: split,
    // -> { kind, label, title, text, cardTitle, body, clickable } | null
    // title/text: shown in the bell list (title may be '' for a DN)
    // cardTitle/body: shown when the row is opened
    parse: function (d) {
      var type = d && d.type, p = split(d && d.message);
      if (type === 'announcement') return {
        kind: 'announcement', label: 'Announcement', title: 'Announcement',
        text: 'You have an announcement to read. Click to read.',
        cardTitle: p.title || 'Announcement', body: p.body, clickable: true
      };
      if (type === 'promotion') return {
        kind: 'promotion', label: 'Promotion', title: 'Promotion',
        text: 'There are system promotions for you, click to view.',
        cardTitle: p.title || 'Promotion', body: p.body, clickable: true
      };
      if (type === 'rate') return {
        kind: 'rate', label: 'Rating', title: 'Rate BoostGrid',
        text: 'Tell us how BoostGrid is working for you. Tap to rate.',
        cardTitle: p.title || 'Rate BoostGrid', body: p.body, clickable: true
      };
      if (type === 'dn') return {
        kind: 'dn', label: 'Message', title: p.title, text: p.body,
        cardTitle: p.title, body: p.body, clickable: false
      };
      return null;
    }
  };

  /* the banner lives in banner.html (one file, one look); fetched once and filled here */
  var ICON = {
    announcement: '<path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6"/>',
    promotion: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 010-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 010 5"/>',
    info: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>'
  };
  // rows in the bell list that can't be opened (direct notifications)
  var ROW_CSS = '.notif-item.nc-static{cursor:default}.notif-item.nc-static:active{background:transparent}' +
    '.notif-item.nc-static .n-text span{white-space:pre-wrap;word-break:break-word}';
  var rowCss = document.createElement('style'); rowCss.textContent = ROW_CSS; document.head.appendChild(rowCss);

  var tplPromise = null;
  function loadTpl() {
    if (tplPromise) return tplPromise;
    var url = new URL('banner.html', document.baseURI).href;
    tplPromise = fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('banner.html ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var css = doc.getElementById('nbStyle'), tpl = doc.getElementById('nbTpl');
      if (!css || !tpl) throw new Error('banner.html is missing nbStyle / nbTpl');
      if (!document.getElementById('nbStyle')) { var st = document.createElement('style'); st.id = 'nbStyle'; st.textContent = css.textContent; document.head.appendChild(st); }
      return tpl.innerHTML;
    }).catch(function (e) { tplPromise = null; throw e; });
    return tplPromise;
  }

  // last-resort card if banner.html can't be fetched (offline, wrong path): plain, but the message is still readable
  function fallbackHtml() {
    return '<div class="nb-layer" role="dialog" aria-modal="true" style="position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,16,12,.5)" data-nb="scrim">' +
      '<div class="nb-card" style="width:100%;max-width:400px;max-height:80vh;overflow:auto;border-radius:20px;background:var(--surface,#fff);color:var(--text,#0d1f17);padding:22px;opacity:1;transform:none">' +
      '<h2 class="nb-title" data-nb="title" style="margin:0 0 12px;font-size:20px"></h2><div class="nb-text" data-nb="text"></div><p class="nb-time" data-nb="time" style="font-size:12px;opacity:.7"></p>' +
      '<button class="nb-btn" type="button" data-nb="done" style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:12px;background:var(--brand,#00cc88);font-weight:700;cursor:pointer">Got it</button>' +
      '<svg data-nb="icon" viewBox="0 0 24 24" hidden></svg><span data-nb="eyebrow" hidden></span><button data-nb="close" hidden></button></div></div>';
  }

  var root = null, opts = null, lastFocus = null, token = 0, closing = null;

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); e.preventDefault();
    NoticeCard.hide();
  }
  function slot(name) { return root.querySelector('[data-nb="' + name + '"]'); }

  function mount(html, o, kind) {
    var wrap = document.createElement('div'); wrap.innerHTML = html;
    root = wrap.firstElementChild;
    var label = o.label != null ? o.label : (kind === 'promotion' ? 'Promotion' : kind === 'announcement' ? 'Announcement' : 'Notification');
    slot('title').textContent = o.title || label || 'Notification';
    slot('eyebrow').textContent = label;
    slot('icon').innerHTML = ICON[kind] || ICON.info;
    root.classList.add('nb-k-' + (kind || 'info'));
    var text = slot('text');
    String(o.body || '').split(/\n{2,}/).forEach(function (para) {
      para = para.trim(); if (!para) return;
      var p = document.createElement('p'); p.textContent = para; text.appendChild(p);
    });
    slot('time').textContent = o.time || '';
    slot('close').addEventListener('click', function () { NoticeCard.hide(); });
    slot('done').addEventListener('click', function () { NoticeCard.hide(); });
    var scrim = slot('scrim'); if (scrim) scrim.addEventListener('click', function (e) { if (e.target === scrim) NoticeCard.hide(); });
    root.addEventListener('click', function (e) { if (e.target === root) NoticeCard.hide(); });
    lastFocus = document.activeElement;
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    // shrink the title until its longest word fits on one line (never split a word); only a word that still doesn't
    // fit at the smallest size may break
    var fitTitle = function () {
      var t = slot('title'); if (!t) return;
      t.style.fontSize = ''; t.style.overflowWrap = 'normal';
      var size = parseFloat(getComputedStyle(t).fontSize) || 24;
      while (size > 15 && t.scrollWidth > t.clientWidth + 1) { size -= 1; t.style.fontSize = size + 'px'; }
      t.style.overflowWrap = '';
    };
    fitTitle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (root) fitTitle(); });
    void root.offsetWidth; root.classList.add('in');
    slot('done').focus({ preventScroll: true });
    if (typeof o.onOpen === 'function') o.onOpen();
  }

  var NoticeCard = {
    /* show({ title, body, kind, label, time, onOpen, onClose })
       kind: 'announcement' | 'promotion' | other (plain look); label: small line above the title (defaults from
       kind); time: small text under the message
       onOpen/onClose: hooks to tie the banner to a page's back-button stack */
    show: function (o) {
      o = o || {};
      if (root) NoticeCard.hide(true);
      // a "rate" notice opens the rating modal (lib/rate.js, loaded on first use) instead of the text banner
      if (o.kind === 'rate') {
        var go = function () { window.RateCard.show({ title: o.title && o.title !== 'Rate BoostGrid' ? o.title : undefined, subtitle: o.body || undefined, onOpen: o.onOpen, onClose: o.onClose }); };
        if (window.RateCard) go();
        else { var sc = document.createElement('script'); sc.src = BASE + 'rate.js'; sc.onload = go; document.head.appendChild(sc); }
        return;
      }
      var my = ++token, kind = o.kind === 'promotion' || o.kind === 'announcement' ? o.kind : 'info';
      loadTpl().then(function (html) { return html; }, function () { return fallbackHtml(); }).then(function (html) {
        if (my !== token) return;          // closed or replaced while loading
        opts = o; mount(html, o, kind);
      });
    },
    hide: function (instant) {
      if (window.RateCard && window.RateCard.isOpen()) window.RateCard.hide(instant);
      token++;                              // cancels a banner that is still loading
      if (!root) return;
      var l = root, o = opts;
      root = null; opts = null;
      document.removeEventListener('keydown', onKey, true);
      l.classList.remove('in');
      clearTimeout(closing);
      if (instant) l.remove(); else closing = setTimeout(function () { l.remove(); }, 260);
      try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) {}
      if (o && typeof o.onClose === 'function') o.onClose();
    },
    isOpen: function () { return !!root || !!(window.RateCard && window.RateCard.isOpen()); }
  };

  window.NoticeFmt = NoticeFmt;
  window.NoticeCard = NoticeCard;
})();
