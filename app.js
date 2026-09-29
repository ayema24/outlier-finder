(function () {
  'use strict';
  var API = 'https://www.googleapis.com/youtube/v3/';
  var KEY_STORE = 'of.apiKey', SAVED_STORE = 'of.saved', THEME_STORE = 'of.theme', CAT_STORE = 'of.cat';
  var $ = function (id) { return document.getElementById(id); };
  var canHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  var state = { fmt: 'all', results: [], saved: [], view: 'results', quota: 0, pageToken: null, params: null, hiddenSubs: 0, scanned: 0, busy: false, searched: false };

  // ---- storage (guarded; localStorage can throw in private modes) ----
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function getKey() { return store(KEY_STORE) || ''; }
  try { state.saved = JSON.parse(store(SAVED_STORE) || '[]'); } catch (e) { state.saved = []; }
  function persistSaved() { store(SAVED_STORE, JSON.stringify(state.saved)); }

  // ---- UI helpers ----
  function show(msg, isError) {
    var m = $('message');
    m.textContent = msg || '';
    m.className = 'message' + (isError ? ' error' : '');
    m.hidden = !msg;
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function updateQuota() { $('quota').textContent = '~' + state.quota.toLocaleString() + ' units'; }
  function updateKeyStatus() {
    var k = $('keyStatus'), has = !!getKey();
    k.textContent = has ? '● Key saved' : '○ No key yet';
    k.className = 'key-status' + (has ? ' ok' : '');
  }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    var dark = t ? t === 'dark' : !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0a0914' : '#f7f5ff';
  }
  applyTheme(store(THEME_STORE));

  function updateFilterSummary() {
    var parts = [$('days').selectedOptions[0].text, $('type').selectedOptions[0].text];
    var ms = $('maxSubs').value.trim(), mv = $('minViews').value.trim(), rg = $('region').value.trim();
    parts.push(ms ? '≤ ' + ms + ' subs' : 'any subs');
    if (mv) parts.push('≥ ' + mv + ' views');
    if (rg) parts.push(rg.toUpperCase());
    $('filterSummary').textContent = parts.join(' · ');
  }

  // ---- API ----
  function api(endpoint, params, cost) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('No API key yet. Tap ⚙ and paste your YouTube Data API v3 key.'));
    var qs = new URLSearchParams(Object.assign({}, params, { key: key }));
    state.quota += cost; updateQuota();
    return fetch(API + endpoint + '?' + qs).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(OF.describeApiError(res.status, body));
        return body;
      });
    }, function () { throw new Error('Network error. Check your connection and try again.'); });
  }

  function fetchBatched(endpoint, part, ids, extra) {
    return Promise.all(OF.chunk(ids, 50).map(function (c) {
      return api(endpoint, Object.assign({ part: part, id: c.join(','), maxResults: 50 }, extra), OF.QUOTA.list);
    })).then(function (pages) {
      return pages.reduce(function (a, p) { return a.concat(p.items || []); }, []);
    });
  }

  /** search.list -> videos.list -> channels.list -> rows */
  function fetchOutliers(sp, filters) {
    return api('search', sp, OF.QUOTA.search).then(function (s) {
      var ids = (s.items || []).map(function (i) { return i.id && i.id.videoId; }).filter(Boolean);
      var out = { next: s.nextPageToken || null, scanned: ids.length, rows: [], hiddenSubs: 0 };
      if (!ids.length) return out;
      return fetchBatched('videos', 'snippet,statistics,contentDetails,player', ids, OF.PLAYER_PARAMS).then(function (videos) {
        var chIds = Array.from(new Set(videos.map(function (v) { return v.snippet.channelId; })));
        return fetchBatched('channels', 'statistics', chIds).then(function (channels) {
          var built = OF.buildRows(videos, channels, filters);
          out.rows = built.rows; out.hiddenSubs = built.hiddenSubs;
          return out;
        });
      });
    });
  }

  function runSearch(more) {
    if (state.busy) return;
    var p;
    if (more) p = state.params;
    else {
      var maxSubs = OF.parseCount($('maxSubs').value), minViews = OF.parseCount($('minViews').value);
      if (isNaN(maxSubs) || isNaN(minViews)) { $('filters').open = true; return show('Max subs / min views must be numbers like 50000 or 50k.', true); }
      var region = $('region').value.trim().toUpperCase();
      if (region && !/^[A-Z]{2}$/.test(region)) { $('filters').open = true; return show('Region must be a 2-letter code such as US or GB.', true); }
      var q = $('q').value.trim();
      if (!q) { $('q').focus(); return; }
      p = { q: q, days: +$('days').value, type: $('type').value, region: region, maxSubs: maxSubs, minViews: minViews === Infinity ? 0 : minViews };
      state.params = p; state.results = []; state.pageToken = null; state.hiddenSubs = 0; state.scanned = 0; state.searched = true; state.fmt = 'all';
      state.view = 'results';
    }
    setBusy(true); show('');
    render();
    if (!more) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    var sp = {
      part: 'snippet', type: 'video', order: 'viewCount', maxResults: 50, q: p.q,
      publishedAfter: new Date(Date.now() - p.days * 86400000).toISOString()
    };
    if (p.region) sp.regionCode = p.region;
    var fmt = OF.FORMATS[p.type];
    if (fmt && fmt.api) sp.videoDuration = fmt.api;
    if (more && state.pageToken) sp.pageToken = state.pageToken;

    fetchOutliers(sp, { maxSubs: p.maxSubs, minViews: p.minViews, type: p.type }).then(function (r) {
      state.pageToken = r.next; state.scanned += r.scanned; state.hiddenSubs += r.hiddenSubs;
      state.results = OF.mergeRows(state.results, r.rows);
      if (!state.scanned) show('No videos found for that search.');
      else if (!state.results.length) show('No outliers matched yet.' + (state.pageToken ? ' Try "Load more" or loosen the filters.' : ' Try loosening the filters.'));
      else if (!more) toast('🔥 ' + state.results.length + ' outlier' + (state.results.length > 1 ? 's' : '') + ' found');
    }).catch(function (e) {
      show(e.message, true);
      if (/API key/.test(e.message)) openSettings(true);
    }).then(function () { setBusy(false); render(); });
  }

  function setBusy(b) {
    state.busy = b;
    $('searchBtn').disabled = b; $('moreBtn').disabled = b;
    $('searchBtn').textContent = b ? 'Hunting…' : 'Find outliers';
    $('moreBtn').textContent = b ? 'Loading…' : 'Load more';
  }

  // ---- rendering ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function stat(dl, label, value) {
    var d = el('div'); d.appendChild(el('dt', null, label)); d.appendChild(el('dd', null, value)); dl.appendChild(d);
  }
  function hue(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }

  // ---- inline preview: muted YouTube embed, one at a time ----
  // Works on touch devices via the ▶ Preview button (tap to toggle); on desktop it also starts on hover.
  var active = null;
  function stopPreview() {
    if (!active) return;
    var a = active; active = null;
    clearTimeout(a.timer);
    if (a.frame) a.frame.remove();
    if (a.loader) a.loader.remove();
    a.thumb.classList.remove('previewing');
    a.btn.textContent = '▶ Preview';
    a.btn.setAttribute('aria-pressed', 'false');
  }
  function startPreview(thumb, btn, r) {
    if (active && active.thumb === thumb) return;
    stopPreview();
    var a = active = { thumb: thumb, btn: btn };
    thumb.classList.add('previewing');
    btn.textContent = '■ Stop';
    btn.setAttribute('aria-pressed', 'true');
    a.loader = el('span', 'loader'); thumb.appendChild(a.loader);
    var f = a.frame = document.createElement('iframe');
    f.src = OF.previewEmbed(r.id, r.duration);
    f.title = 'Preview: ' + r.title;
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.setAttribute('tabindex', '-1');
    f.addEventListener('load', function () {
      // give the player a moment to start so we don't flash its loading screen
      a.timer = setTimeout(function () { f.classList.add('ready'); if (a.loader) { a.loader.remove(); a.loader = null; } }, 700);
    });
    thumb.insertBefore(f, thumb.firstChild.nextSibling);
  }
  // Stop previews that scroll off screen.
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (!e.isIntersecting && active && active.thumb === e.target) stopPreview(); });
  }, { threshold: 0.25 }) : null;

  function attachPreview(thumb, r) {
    var btn = el('button', 'preview-btn', '▶ Preview');
    btn.type = 'button'; btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Preview ' + r.title);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (active && active.thumb === thumb) stopPreview(); else startPreview(thumb, btn, r);
    });
    thumb.appendChild(btn);
    if (canHover) {
      var hoverTimer;
      thumb.addEventListener('mouseenter', function () { hoverTimer = setTimeout(function () { startPreview(thumb, btn, r); }, 450); });
      thumb.addEventListener('mouseleave', function () { clearTimeout(hoverTimer); if (active && active.thumb === thumb) stopPreview(); });
    }
    if (io) io.observe(thumb);
  }

  /** opts: { pill: 'text shown above the stats', perHour: true to show views/hour instead of views/day } */
  function card(r, rank, opts) {
    opts = opts || {};
    var c = el('article', 'card');
    c.style.animationDelay = Math.min(rank || 0, 12) * 40 + 'ms';
    var t = el('div', 'thumb');
    t.setAttribute('role', 'button'); t.tabIndex = 0;
    t.setAttribute('aria-label', 'Play ' + r.title);
    if (r.thumb) { var img = el('img'); img.src = r.thumb; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; t.appendChild(img); }
    else t.appendChild(el('span'));
    var tier = OF.scoreTier(r.score);
    t.appendChild(el('span', 'badge score ' + tier, (tier === 'legendary' ? '🔥 ' : '') + OF.formatScore(r.score)));
    if (rank != null) t.appendChild(el('span', 'badge rank', '#' + (rank + 1)));
    t.appendChild(el('span', 'badge dur', OF.formatDuration(r.duration)));
    if (OF.rowIsShort(r)) t.appendChild(el('span', 'badge short-tag', 'SHORT'));
    attachPreview(t, r);
    t.addEventListener('click', function () { openPlayer(r); });
    t.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(r); } });
    c.appendChild(t);

    var b = el('div', 'body');
    var title = el('a', 'title', r.title); title.href = r.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; title.title = r.title;
    var ch = el('a', 'channel'); ch.href = r.channelUrl; ch.target = '_blank'; ch.rel = 'noopener noreferrer';
    var av = el('span', 'avatar', (r.channel || '?').trim().charAt(0).toUpperCase());
    var h = hue(r.channel || '');
    av.style.background = 'linear-gradient(135deg, hsl(' + h + ',75%,55%), hsl(' + ((h + 50) % 360) + ',80%,50%))';
    ch.appendChild(av); ch.appendChild(el('span', null, r.channel));

    var meter = el('div', 'meter');
    var mt = el('div', 'meter-top'); mt.appendChild(el('span', null, 'Views vs subs'));
    var mb = el('b', null, OF.formatScore(r.score)); mt.appendChild(mb);
    var track = el('div', 'meter-track'), fill = el('div', 'meter-fill');
    fill.style.width = Math.max(4, Math.min(100, Math.log10(Math.max(r.score, 1)) / 3 * 100)) + '%';
    track.appendChild(fill); meter.appendChild(mt); meter.appendChild(track);

    var dl = el('dl', 'stats');
    stat(dl, 'Views', OF.formatCount(r.views)); stat(dl, 'Subs', OF.formatCount(r.subs));
    if (opts.perHour) stat(dl, 'Per hour', OF.formatCount(Math.round(OF.rowVph(r))));
    else stat(dl, 'Per day', OF.formatCount(Math.round(r.viewsPerDay)));
    stat(dl, 'Age', OF.formatAge(OF.ageDays(r.publishedAt)));

    var actions = el('div', 'actions');
    var isSaved = state.saved.some(function (s) { return s.id === r.id; });
    var btn = el('button', 'btn ghost save-btn' + (isSaved ? ' saved' : ''), isSaved ? '♥ Saved' : '♡ Save');
    btn.type = 'button';
    btn.addEventListener('click', function () { toggleSave(r); });
    var open = el('a', 'btn ghost', 'YouTube ↗'); open.href = r.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
    actions.appendChild(btn); actions.appendChild(open);

    var tools = el('div', 'actions sub');
    var simBtn = el('button', 'link-btn', '🧬 Similar channels'); simBtn.type = 'button';
    simBtn.addEventListener('click', function () { go('similar', r.channelId); });
    var trkBtn = el('button', 'link-btn', '📈 Track channel'); trkBtn.type = 'button';
    trkBtn.addEventListener('click', function () { if (api_.trackById) api_.trackById(r.channelId, r.channel); });
    tools.appendChild(simBtn); tools.appendChild(trkBtn);

    [title, ch].forEach(function (n) { b.appendChild(n); });
    if (opts.pill) b.appendChild(el('div', 'pill', opts.pill));
    [meter, dl, actions, tools].forEach(function (n) { b.appendChild(n); });
    c.appendChild(b);
    return c;
  }

  function skeleton() {
    var c = el('article', 'card skeleton');
    c.appendChild(el('div', 'thumb'));
    var b = el('div', 'body');
    [90, 60, 40, 100].forEach(function (w) { var l = el('div', 'sk-line'); l.style.width = w + '%'; b.appendChild(l); });
    c.appendChild(b);
    return c;
  }

  function viewRows() { return state.view === 'saved' ? state.saved : state.results; }
  /** Rows for the current tab, narrowed by the All / Shorts / Long-form switch so each ranks on its own. */
  function currentRows() {
    var rows = viewRows();
    if (state.fmt === 'short') return rows.filter(OF.rowIsShort);
    if (state.fmt === 'long') return rows.filter(function (r) { return !OF.rowIsShort(r); });
    return rows;
  }
  function renderFormatSwitch() {
    var rows = viewRows(), shorts = rows.filter(OF.rowIsShort).length, longs = rows.length - shorts;
    var box = $('fmtSwitch');
    box.hidden = !(shorts && longs) && state.fmt === 'all';
    [['all', rows.length], ['short', shorts], ['long', longs]].forEach(function (x) {
      var b = box.querySelector('[data-fmt="' + x[0] + '"]');
      b.setAttribute('aria-pressed', state.fmt === x[0]);
      b.querySelector('.count').textContent = x[1];
    });
  }

  function render() {
    stopPreview();
    renderFormatSwitch();
    var rows = OF.sortRows(currentRows(), $('sort').value);
    var box = $('cards'); box.textContent = '';
    var ranked = $('sort').value === 'score';
    rows.forEach(function (r, i) { box.appendChild(card(r, ranked ? i : null)); });
    if (state.busy && state.view === 'results') for (var i = 0; i < (rows.length ? 3 : 6); i++) box.appendChild(skeleton());
    $('resultsCount').textContent = state.results.length;
    $('savedCount').textContent = state.saved.length;
    $('moreBtn').hidden = !(state.view === 'results' && state.pageToken);
    $('clearSaved').hidden = !(state.view === 'saved' && state.saved.length);
    $('tabResults').setAttribute('aria-selected', state.view === 'results');
    $('tabSaved').setAttribute('aria-selected', state.view === 'saved');
    var s = '';
    if (state.view === 'results' && state.scanned) {
      s = 'Scanned ' + state.scanned + ' videos for “' + state.params.q + '”, ' + state.results.length + ' matched.';
      if (state.hiddenSubs) s += ' Skipped ' + state.hiddenSubs + ' from channels that hide their subscriber count.';
    }
    $('summary').textContent = s;
    var empty = !rows.length && !state.busy;
    $('empty').hidden = !empty;
    if (empty) $('emptyText').textContent = state.view === 'saved' ? 'Nothing saved yet. Tap ♡ Save on any card to keep it here.'
      : state.searched ? 'No outliers yet for this search.' : 'Pick a niche or search a keyword to start hunting outliers.';
    if (inspo.rows.length) renderInspo();
  }

  function switchView(v) { state.view = v; state.fmt = 'all'; render(); }

  function toggleSave(r) {
    var i = state.saved.findIndex(function (s) { return s.id === r.id; });
    if (i >= 0) { state.saved.splice(i, 1); toast('Removed from saved'); } else { state.saved.push(r); toast('♥ Saved'); }
    persistSaved(); render();
  }

  function exportCSV() {
    var rows = OF.sortRows(currentRows(), $('sort').value);
    if (!rows.length) return toast('Nothing to export yet');
    var blob = new Blob(['﻿' + OF.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'outliers-' + state.view + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---- lightbox player ----
  var lastFocus = null;
  function openPlayer(r) {
    stopPreview();
    lastFocus = document.activeElement;
    var f = document.createElement('iframe');
    f.src = OF.playerEmbed(r.id);
    f.title = r.title;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    var box = $('lbFrame'); box.textContent = ''; box.appendChild(f);
    box.classList.toggle('vertical', r.vertical != null ? !!r.vertical : OF.rowIsShort(r));
    $('lbTitle').textContent = r.title;
    $('lbSub').textContent = r.channel + ' · ' + OF.formatCount(r.views) + ' views' +
      (r.subs != null ? ' · ' + OF.formatCount(r.subs) + ' subs · ' + OF.formatScore(r.score) + ' outlier' : '');
    $('lbOpen').href = r.url;
    $('lightbox').hidden = false;
    document.body.classList.add('lb-open');
    $('lightbox').querySelector('button[data-close]').focus();
  }
  function closePlayer() {
    if ($('lightbox').hidden) return;
    $('lightbox').hidden = true;
    $('lbFrame').textContent = '';
    document.body.classList.remove('lb-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (n) { n.addEventListener('click', closePlayer); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePlayer(); });

  // ---- inspiration feed (random small-channel hits, cached to save quota) ----
  var INSPO_STORE = 'of.inspo', INSPO_TTL = 6 * 3600 * 1000, INSPO_COUNT = 6;
  var inspo = { rows: [], niche: '' };
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function renderInspo() {
    var box = $('inspoCards'); box.textContent = '';
    inspo.rows.forEach(function (r) { box.appendChild(card(r)); });
    $('inspoNiche').textContent = inspo.niche ? '· from ' + inspo.niche : '';
  }
  function inspoMsg(t) { var m = $('inspoMsg'); m.textContent = t || ''; m.hidden = !t; }

  function loadInspiration(force) {
    var sec = $('inspo');
    if (!getKey()) { sec.hidden = true; return; }
    sec.hidden = false;
    if (!force) {
      try {
        var c = JSON.parse(store(INSPO_STORE) || 'null');
        if (c && Date.now() - c.t < INSPO_TTL && c.rows && c.rows.length) { inspo = { rows: c.rows, niche: c.niche }; return renderInspo(); }
      } catch (e) {}
    }
    var n = OF.NICHES[Math.floor(Math.random() * OF.NICHES.length)];
    $('shuffleBtn').disabled = true; inspoMsg('Finding inspiration in ' + n.icon + ' ' + n.name + '…');
    var box = $('inspoCards'); box.textContent = '';
    for (var i = 0; i < 3; i++) box.appendChild(skeleton());
    fetchOutliers({
      part: 'snippet', type: 'video', order: 'viewCount', maxResults: 50, q: n.q,
      publishedAfter: new Date(Date.now() - 30 * 86400000).toISOString()
    }, { maxSubs: 100000, minViews: 5000 }).then(function (r) {
      var top = OF.sortRows(r.rows, 'score').slice(0, 12);
      inspo = { rows: shuffle(top).slice(0, INSPO_COUNT), niche: n.icon + ' ' + n.name };
      if (inspo.rows.length) store(INSPO_STORE, JSON.stringify({ t: Date.now(), niche: inspo.niche, rows: inspo.rows }));
      inspoMsg(inspo.rows.length ? '' : 'No small-channel hits in ' + n.name + ' this time. Try Shuffle.');
      renderInspo();
    }).catch(function (e) { box.textContent = ''; inspoMsg('Could not load inspiration: ' + e.message); })
      .then(function () { $('shuffleBtn').disabled = false; });
  }

  // ---- niche explorer ----
  var nicheState = { cat: store(CAT_STORE) || 'money', filter: '', activeQ: '' };
  function renderCatTabs() {
    var box = $('catTabs'); box.textContent = '';
    var cats = [{ id: 'all', name: 'All', icon: '🌐' }].concat(OF.NICHE_CATS);
    if (!cats.some(function (c) { return c.id === nicheState.cat; })) nicheState.cat = 'all';
    cats.forEach(function (c) {
      var n = c.id === 'all' ? OF.NICHES.length : OF.NICHES.filter(function (x) { return x.cat === c.id; }).length;
      var b = el('button', 'cat-tab');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c.id === nicheState.cat);
      b.appendChild(el('span', null, c.icon)); b.appendChild(el('span', null, c.name)); b.appendChild(el('span', 'n', n));
      b.addEventListener('click', function () { nicheState.cat = c.id; store(CAT_STORE, c.id); renderCatTabs(); renderNiches(); });
      box.appendChild(b);
    });
  }
  function renderNiches() {
    var box = $('niches'); box.textContent = '';
    var f = nicheState.filter.toLowerCase();
    var list = OF.NICHES.filter(function (n) {
      if (f) return (n.name + ' ' + n.q).toLowerCase().indexOf(f) >= 0;
      return nicheState.cat === 'all' || n.cat === nicheState.cat;
    });
    if (!list.length) { box.appendChild(el('p', 'no-niches', 'No niche matches “' + nicheState.filter + '”. Press Enter to search it as a keyword.')); return; }
    list.forEach(function (n, i) {
      var b = el('button', 'chip' + (n.q === nicheState.activeQ ? ' active' : ''));
      b.type = 'button'; b.title = 'Search “' + n.q + '”';
      b.style.animationDelay = Math.min(i, 24) * 15 + 'ms';
      b.appendChild(el('span', 'chip-icon', n.icon));
      b.appendChild(el('span', 'chip-name', n.name));
      b.appendChild(el('span', 'rpm r' + n.rpm, '$$$'.slice(0, n.rpm)));
      b.addEventListener('click', function () { pickNiche(n); });
      box.appendChild(b);
    });
  }
  function pickNiche(n) {
    if (state.busy) return;
    nicheState.activeQ = n.q;
    renderNiches();
    $('q').value = n.q;
    $('sort').value = 'score';
    runSearch(false);
  }

  // ---- settings ----
  function openSettings(open, quiet) {
    var p = $('settings'); p.hidden = !open; $('settingsBtn').setAttribute('aria-expanded', open);
    if (open && !quiet) { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(function () { $('apiKey').focus(); }, 300); }
  }

  // ---- events ----
  $('searchForm').addEventListener('submit', function (e) { e.preventDefault(); runSearch(false); });
  $('moreBtn').addEventListener('click', function () { runSearch(true); });
  $('shuffleBtn').addEventListener('click', function () { loadInspiration(true); });
  $('surpriseBtn').addEventListener('click', function () { pickNiche(OF.NICHES[Math.floor(Math.random() * OF.NICHES.length)]); });
  $('sort').addEventListener('change', render);
  Array.prototype.forEach.call(document.querySelectorAll('#fmtSwitch [data-fmt]'), function (b) {
    b.addEventListener('click', function () { state.fmt = b.dataset.fmt; render(); });
  });
  $('q').addEventListener('input', function () { if (nicheState.activeQ) { nicheState.activeQ = ''; renderNiches(); } });
  $('nicheFilter').addEventListener('input', function (e) { nicheState.filter = e.target.value.trim(); renderNiches(); });
  $('nicheFilter').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !nicheState.filter) return;
    e.preventDefault();
    var f = nicheState.filter.toLowerCase();
    var hit = OF.NICHES.filter(function (n) { return (n.name + ' ' + n.q).toLowerCase().indexOf(f) >= 0; });
    if (hit.length === 1) return pickNiche(hit[0]);
    if (!hit.length) { $('q').value = nicheState.filter; runSearch(false); }
  });
  ['days', 'type', 'maxSubs', 'minViews', 'region'].forEach(function (id) { $(id).addEventListener('input', updateFilterSummary); $(id).addEventListener('change', updateFilterSummary); });
  $('tabResults').addEventListener('click', function () { switchView('results'); });
  $('tabSaved').addEventListener('click', function () { switchView('saved'); });
  $('exportBtn').addEventListener('click', exportCSV);
  $('clearSaved').addEventListener('click', function () {
    if (confirm('Remove all saved videos?')) { state.saved = []; persistSaved(); render(); }
  });
  $('settingsBtn').addEventListener('click', function () { openSettings($('settings').hidden); });
  $('saveKey').addEventListener('click', function () {
    var k = $('apiKey').value.trim();
    if (!k) return show('Paste a key first.', true);
    store(KEY_STORE, k); $('apiKey').value = ''; updateKeyStatus(); show(''); toast('🔑 API key saved'); openSettings(false); loadInspiration(false);
  });
  $('clearKey').addEventListener('click', function () { store(KEY_STORE, null); updateKeyStatus(); toast('API key removed'); loadInspiration(false); });
  $('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next); store(THEME_STORE, next);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopPreview(); });

  // ---- router: #viral, #finder, #similar/<channelId>, #trends (no hash = outliers) ----
  var VIEWS = ['outliers', 'viral', 'finder', 'similar', 'trends'], modules = {};
  function go(view, arg) { location.hash = view === 'outliers' ? '' : '#' + view + (arg ? '/' + encodeURIComponent(arg) : ''); if (!location.hash && view === 'outliers') route(); }
  function route() {
    var parts = (location.hash || '').replace(/^#/, '').split('/');
    var view = VIEWS.indexOf(parts[0]) >= 0 ? parts[0] : 'outliers';
    var arg = '';
    try { arg = decodeURIComponent(parts.slice(1).join('/')); } catch (e) { arg = parts.slice(1).join('/'); }
    stopPreview();
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.hidden = v.dataset.view !== view; });
    Array.prototype.forEach.call(document.querySelectorAll('#mainNav a'), function (a) {
      var on = a.dataset.nav === view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.dataset.view = view;
    window.scrollTo(0, 0);
    if (modules[view] && modules[view].show) modules[view].show(arg);
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route); // runs after every module script has registered

  /** Shared with channels.js, viral.js, finder.js, similar.js and trends.js. */
  var api_ = window.OFApp = {
    $: $, el: el, stat: stat, hue: hue, api: api, fetchBatched: fetchBatched, store: store, getKey: getKey, toast: toast,
    fetchOutliers: fetchOutliers, card: card, skeleton: skeleton, openPlayer: openPlayer, openSettings: openSettings, go: go, stopPreview: stopPreview,
    register: function (name, mod) { modules[name] = mod; },
    /** Show a message in a view's own message box; opens Settings when the problem is a missing key. */
    say: function (box, text, isError) { box.textContent = text || ''; box.className = 'message' + (isError ? ' error' : ''); box.hidden = !text; },
    fail: function (box, e) { api_.say(box, e && e.message || String(e), true); if (/API key/.test(e && e.message)) openSettings(true); }
  };

  $('nicheCount').textContent = OF.NICHES.length;
  renderCatTabs(); renderNiches(); updateKeyStatus(); updateQuota(); updateFilterSummary(); render();
  loadInspiration(false);
  if (!getKey()) openSettings(true, true);
})();
