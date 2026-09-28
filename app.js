(function () {
  'use strict';
  var API = 'https://www.googleapis.com/youtube/v3/';
  var KEY_STORE = 'of.apiKey', SAVED_STORE = 'of.saved', THEME_STORE = 'of.theme';
  var $ = function (id) { return document.getElementById(id); };

  var state = { results: [], saved: [], view: 'results', quota: 0, pageToken: null, params: null, hiddenSubs: 0, scanned: 0, busy: false };

  // ---- storage (guarded; localStorage can throw in private modes) ----
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function getKey() { return store(KEY_STORE) || ''; }
  try { state.saved = JSON.parse(store(SAVED_STORE) || '[]'); } catch (e) { state.saved = []; }
  function persistSaved() { store(SAVED_STORE, JSON.stringify(state.saved)); }

  // ---- UI helpers ----
  function show(msg, isError) {
    var el = $('message');
    el.textContent = msg || '';
    el.className = 'message' + (isError ? ' error' : '');
    el.hidden = !msg;
  }
  function updateQuota() { $('quota').textContent = 'Quota: ~' + state.quota.toLocaleString() + ' units'; }
  function updateKeyStatus() {
    $('keyStatus').textContent = getKey() ? 'A key is saved in this browser.' : 'No key saved yet.';
  }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(store(THEME_STORE));

  // ---- API ----
  function api(endpoint, params, cost) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('No API key. Open Settings and paste your YouTube Data API v3 key.'));
    var qs = new URLSearchParams(Object.assign({}, params, { key: key }));
    state.quota += cost; updateQuota();
    return fetch(API + endpoint + '?' + qs).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(OF.describeApiError(res.status, body));
        return body;
      });
    }, function () { throw new Error('Network error. Check your connection and try again.'); });
  }

  function fetchBatched(endpoint, part, ids) {
    return Promise.all(OF.chunk(ids, 50).map(function (c) {
      return api(endpoint, { part: part, id: c.join(','), maxResults: 50 }, OF.QUOTA.list);
    })).then(function (pages) {
      return pages.reduce(function (a, p) { return a.concat(p.items || []); }, []);
    });
  }

  function runSearch(more) {
    if (state.busy) return;
    var p;
    if (more) p = state.params;
    else {
      var maxSubs = OF.parseCount($('maxSubs').value), minViews = OF.parseCount($('minViews').value);
      if (isNaN(maxSubs) || isNaN(minViews)) return show('Max subs / min views must be numbers like 50000 or 50k.', true);
      var region = $('region').value.trim().toUpperCase();
      if (region && !/^[A-Z]{2}$/.test(region)) return show('Region must be a 2-letter code such as US or GB.', true);
      p = {
        q: $('q').value.trim(), days: +$('days').value, type: $('type').value, region: region,
        maxSubs: maxSubs, minViews: minViews === Infinity ? 0 : minViews
      };
      state.params = p; state.results = []; state.pageToken = null; state.hiddenSubs = 0; state.scanned = 0;
    }
    setBusy(true); show('');
    var sp = {
      part: 'snippet', type: 'video', order: 'viewCount', maxResults: 50, q: p.q,
      publishedAfter: new Date(Date.now() - p.days * 86400000).toISOString()
    };
    if (p.region) sp.regionCode = p.region;
    if (p.type === 'short') sp.videoDuration = 'short';
    if (more && state.pageToken) sp.pageToken = state.pageToken;

    api('search', sp, OF.QUOTA.search).then(function (s) {
      state.pageToken = s.nextPageToken || null;
      var ids = (s.items || []).map(function (i) { return i.id && i.id.videoId; }).filter(Boolean);
      state.scanned += ids.length;
      if (!ids.length) return;
      return fetchBatched('videos', 'snippet,statistics,contentDetails', ids).then(function (videos) {
        var chIds = Array.from(new Set(videos.map(function (v) { return v.snippet.channelId; })));
        return fetchBatched('channels', 'statistics', chIds).then(function (channels) {
          var built = OF.buildRows(videos, channels, { maxSubs: p.maxSubs, minViews: p.minViews, type: p.type });
          state.hiddenSubs += built.hiddenSubs;
          state.results = OF.mergeRows(state.results, built.rows);
        });
      });
    }).then(function () {
      if (!state.scanned) show('No videos found for that search.');
      else if (!state.results.length) show('No outliers matched yet.' + (state.pageToken ? ' Try "Load more" or loosen the filters.' : ' Try loosening the filters.'));
      switchView('results');
    }).catch(function (e) {
      show(e.message, true); render();
    }).then(function () { setBusy(false); });
  }

  function setBusy(b) {
    state.busy = b;
    $('searchBtn').disabled = b; $('moreBtn').disabled = b;
    $('searchBtn').textContent = b ? 'Searching…' : 'Search';
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
    var d = el('div'); d.appendChild(el('dt', null, label + ' ')); d.appendChild(el('dd', null, value)); dl.appendChild(d);
  }

  function card(r) {
    var c = el('article', 'card');
    var t = el('a', 'thumb'); t.href = r.url; t.target = '_blank'; t.rel = 'noopener noreferrer'; t.setAttribute('aria-label', 'Watch: ' + r.title);
    if (r.thumb) { var img = el('img'); img.src = r.thumb; img.alt = ''; img.loading = 'lazy'; t.appendChild(img); }
    t.appendChild(el('span', 'score', OF.formatScore(r.score)));
    t.appendChild(el('span', 'dur', OF.formatDuration(r.duration)));
    c.appendChild(t);
    var b = el('div', 'body');
    var title = el('a', 'title', r.title); title.href = r.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; title.title = r.title;
    var ch = el('a', 'channel', r.channel); ch.href = r.channelUrl; ch.target = '_blank'; ch.rel = 'noopener noreferrer';
    var dl = el('dl', 'stats');
    stat(dl, 'Subs', OF.formatCount(r.subs)); stat(dl, 'Views', OF.formatCount(r.views));
    stat(dl, 'Views/day', OF.formatCount(Math.round(r.viewsPerDay))); stat(dl, 'Age', OF.formatAge(OF.ageDays(r.publishedAt)));
    var isSaved = state.saved.some(function (s) { return s.id === r.id; });
    var btn = el('button', 'ghost', isSaved ? '★ Saved (remove)' : '☆ Save');
    btn.type = 'button';
    btn.addEventListener('click', function () { toggleSave(r); });
    [title, ch, dl, btn].forEach(function (n) { b.appendChild(n); });
    c.appendChild(b);
    return c;
  }

  function currentRows() { return state.view === 'saved' ? state.saved : state.results; }

  function render() {
    var rows = OF.sortRows(currentRows(), $('sort').value);
    var box = $('cards'); box.textContent = '';
    rows.forEach(function (r) { box.appendChild(card(r)); });
    $('resultsCount').textContent = state.results.length;
    $('savedCount').textContent = state.saved.length;
    $('moreBtn').hidden = !(state.view === 'results' && state.pageToken);
    $('clearSaved').hidden = !(state.view === 'saved' && state.saved.length);
    var s = '';
    if (state.view === 'results' && state.scanned) {
      s = 'Scanned ' + state.scanned + ' videos, ' + state.results.length + ' matched.';
      if (state.hiddenSubs) s += ' Skipped ' + state.hiddenSubs + ' video' + (state.hiddenSubs > 1 ? 's' : '') + ' from channels with hidden subscriber counts.';
    } else if (state.view === 'saved' && !state.saved.length) s = 'Nothing saved yet.';
    $('summary').textContent = s;
  }

  function switchView(v) {
    state.view = v;
    $('tabResults').setAttribute('aria-selected', v === 'results');
    $('tabSaved').setAttribute('aria-selected', v === 'saved');
    render();
  }

  function toggleSave(r) {
    var i = state.saved.findIndex(function (s) { return s.id === r.id; });
    if (i >= 0) state.saved.splice(i, 1); else state.saved.push(r);
    persistSaved(); render();
  }

  function exportCSV() {
    var rows = OF.sortRows(currentRows(), $('sort').value);
    if (!rows.length) return show('Nothing to export.');
    var blob = new Blob(['﻿' + OF.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'outliers-' + state.view + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---- events ----
  $('searchForm').addEventListener('submit', function (e) { e.preventDefault(); runSearch(false); });
  $('moreBtn').addEventListener('click', function () { runSearch(true); });
  $('sort').addEventListener('change', render);
  $('tabResults').addEventListener('click', function () { switchView('results'); });
  $('tabSaved').addEventListener('click', function () { switchView('saved'); });
  $('exportBtn').addEventListener('click', exportCSV);
  $('clearSaved').addEventListener('click', function () {
    if (confirm('Remove all saved videos?')) { state.saved = []; persistSaved(); render(); }
  });
  $('settingsBtn').addEventListener('click', function () {
    var p = $('settings'); p.hidden = !p.hidden; $('settingsBtn').setAttribute('aria-expanded', !p.hidden);
  });
  $('saveKey').addEventListener('click', function () {
    var k = $('apiKey').value.trim();
    if (!k) return show('Paste a key first.', true);
    store(KEY_STORE, k); $('apiKey').value = ''; updateKeyStatus(); show('API key saved in this browser.');
  });
  $('clearKey').addEventListener('click', function () { store(KEY_STORE, null); updateKeyStatus(); show('API key removed.'); });
  $('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next); store(THEME_STORE, next);
  });

  updateKeyStatus(); updateQuota(); render();
  if (!getKey()) { $('settings').hidden = false; $('settingsBtn').setAttribute('aria-expanded', 'true'); }
})();
