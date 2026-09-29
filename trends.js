/* Channel trends: a watchlist with one snapshot per day, recent-upload performance, and breakout detection. */
(function () {
  'use strict';
  var A = window.OFApp, $ = A.$, el = A.el;
  var WATCH = 'of.watch', RELOAD_MS = 10 * 60 * 1000, DAY = 86400000;
  var st = { list: [], chans: {}, rows: {}, stats: {}, busy: false, loadedAt: 0, refreshedAt: 0 };

  // ---------- storage ----------
  function clean(e) {
    if (!e || typeof e.id !== 'string' || !/^UC[\w-]{22}$/.test(e.id)) return null;
    var num = function (x) { return typeof x === 'number' && isFinite(x) ? x : null; };
    var snaps = (Array.isArray(e.snaps) ? e.snaps : []).map(function (s) {
      return s && num(s.t) != null ? { t: s.t, subs: num(s.subs), views: num(s.views) || 0, videos: num(s.videos) || 0 } : null;
    }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });
    return {
      id: e.id, title: String(e.title || '').slice(0, 200), handle: /^@[\w.\-]{1,60}$/.test(e.handle || '') ? e.handle : '',
      thumb: /^https:\/\//.test(e.thumb || '') ? String(e.thumb).slice(0, 500) : '', added: num(e.added) || Date.now(), snaps: snaps
    };
  }
  function load() {
    try { st.list = (JSON.parse(A.store(WATCH) || '[]') || []).map(clean).filter(Boolean); } catch (e) { st.list = []; }
  }
  function save() { A.store(WATCH, JSON.stringify(st.list)); }
  function find(id) { return st.list.filter(function (e) { return e.id === id; })[0]; }
  function snapOf(ch) { return { t: Date.now(), subs: ch.subs, views: ch.views, videos: ch.videos }; }

  // ---------- public: used by cards elsewhere ----------
  A.isTracked = function (id) { return !!find(id); };
  A.trackChannel = function (ch) {
    if (find(ch.id)) { A.toast('Already tracking ' + ch.title); return Promise.resolve(true); }
    st.list.push({ id: ch.id, title: ch.title, handle: ch.handle, thumb: ch.thumb, added: Date.now(), snaps: [snapOf(ch)] });
    st.chans[ch.id] = ch; save();
    A.toast('📈 Tracking ' + ch.title);
    if (document.body.dataset.view === 'trends') refresh(false);
    return Promise.resolve(true);
  };
  A.trackById = function (id, name) {
    if (find(id)) return A.toast('Already tracking ' + (name || 'this channel'));
    OFC.fetchChannels([id]).then(function (l) { if (l[0]) A.trackChannel(l[0]); else A.toast('Could not find that channel'); })
      .catch(function (e) { A.toast(e.message); if (/API key/.test(e.message)) A.openSettings(true); });
  };

  // ---------- loading data ----------
  function updateStatus() {
    var n = st.list.length;
    $('trendStatus').textContent = n ? n + ' channel' + (n === 1 ? '' : 's') + (st.refreshedAt ? ' · refreshed ' + Math.max(0, Math.round((Date.now() - st.refreshedAt) / 60000)) + ' min ago' : '') + ' · a refresh costs about ' + (1 + 2 * n) + ' units' : '';
  }

  /** force = ignore the 3-hour cache of recent uploads. */
  function refresh(force) {
    if (st.busy || !st.list.length) { renderAll(); return Promise.resolve(); }
    st.busy = true; $('trendRefresh').disabled = true; $('trendRefresh').textContent = '↻ Refreshing…';
    A.say($('trendMsg'), '');
    return OFC.fetchChannels(st.list.map(function (e) { return e.id; })).then(function (chs) {
      chs.forEach(function (c) {
        var e = find(c.id); if (!e) return;
        st.chans[c.id] = c; e.title = c.title || e.title; e.handle = c.handle || e.handle; e.thumb = c.thumb || e.thumb;
        e.snaps = OFI.addSnapshot(e.snaps, snapOf(c));
      });
      save(); renderAll();
      var live = st.list.map(function (e) { return st.chans[e.id]; }).filter(Boolean);
      return Promise.all(live.map(function (c) {
        return OFC.recent(c, 30, force).then(function (rows) { st.rows[c.id] = rows; st.stats[c.id] = OFI.channelStats(rows, c); }).catch(function () {});
      }));
    }).then(function () { st.loadedAt = st.refreshedAt = Date.now(); })
      .catch(function (e) { A.fail($('trendMsg'), e); })
      .then(function () { st.busy = false; $('trendRefresh').disabled = false; $('trendRefresh').textContent = '↻ Refresh all'; renderAll(); });
  }

  // ---------- rendering ----------
  function deltaTile(dl, label, value, perDay, fmt) {
    A.stat(dl, label, value);
    var d = dl.lastChild;
    if (perDay == null || !isFinite(perDay)) return;
    var up = perDay > 0, flat = Math.abs(perDay) < 0.5;
    d.appendChild(el('small', 'delta ' + (flat ? 'flat' : up ? 'up' : 'down'), flat ? '● flat' : (up ? '▲ ' : '▼ ') + OFC.signed(Math.round(perDay), fmt) + '/day'));
  }

  function trendCard(e) {
    var ch = st.chans[e.id] || { id: e.id, title: e.title, handle: e.handle, thumb: e.thumb, url: 'https://www.youtube.com/channel/' + e.id, subs: null, views: 0, videos: 0 };
    var c = el('article', 'ccard trend');
    var head = el('div', 'ccard-head'); head.appendChild(OFC.avatar(ch, 46));
    var id = el('div', 'ccard-id'), name = el('a', 'cname', ch.title || e.title); name.href = ch.url; name.target = '_blank'; name.rel = 'noopener noreferrer';
    id.appendChild(name); id.appendChild(el('div', 'chandle', ch.handle || ' '));
    head.appendChild(id);
    var rm = el('button', 'x-btn', '✕'); rm.type = 'button'; rm.setAttribute('aria-label', 'Stop tracking ' + (ch.title || e.title)); rm.title = 'Stop tracking';
    rm.addEventListener('click', function () {
      if (!confirm('Stop tracking ' + (ch.title || e.title) + '? Its saved history will be deleted.')) return;
      st.list = st.list.filter(function (x) { return x.id !== e.id; }); delete st.rows[e.id]; delete st.stats[e.id]; save(); renderAll();
    });
    head.appendChild(rm); c.appendChild(head);

    var subSnaps = e.snaps.filter(function (s) { return s.subs != null; });
    var dSubs = OFI.dailyDeltas(subSnaps), dViews = OFI.dailyDeltas(e.snaps);
    var ss = st.stats[e.id], rows = st.rows[e.id];
    var dl = el('dl', 'stats');
    deltaTile(dl, 'Subs', ch.subs != null ? OF.formatCount(ch.subs) : 'hidden', dSubs.length ? dSubs[dSubs.length - 1].subsPerDay : null);
    deltaTile(dl, 'Total views', OF.formatCount(ch.views), dViews.length ? dViews[dViews.length - 1].viewsPerDay : null);
    A.stat(dl, 'Median views', ss && rows && rows.length ? OF.formatCount(Math.round(ss.medianViews)) : '–');
    A.stat(dl, 'Uploads / mo', ss && ss.perMonth != null ? (ss.perMonth >= 10 ? Math.round(ss.perMonth) : ss.perMonth.toFixed(1)) : '–');
    c.appendChild(dl);

    var h1 = el('p', 'chart-title', 'Subscribers over time'); c.appendChild(h1);
    if (subSnaps.length >= 2) {
      c.appendChild(OFC.lineChart(subSnaps.map(function (s) { return { t: s.t, y: s.subs }; }), { label: 'Subscribers' }));
      c.appendChild(OFC.table(['Date', 'Subscribers', 'Total views'], subSnaps.slice().reverse().map(function (s) { return [OFC.fmtDate(s.t), OFC.fmtNum(s.subs), OFC.fmtNum(s.views)]; })));
    } else {
      c.appendChild(el('p', 'placeholder', ch.subs == null ? 'This channel hides its subscriber count, so there is no subscriber line.'
        : "History starts today (" + OF.formatCount(ch.subs) + " subs). Open this tab again tomorrow and a growth line appears."));
    }

    c.appendChild(el('p', 'chart-title', 'Views on recent videos'));
    if (rows && rows.length > 1) {
      c.appendChild(OFC.barChart(rows, { max: 24, median: ss.medianViews }));
      var key = el('p', 'chart-key'); key.appendChild(el('i', 'kdot')); key.appendChild(document.createTextNode(' Solid bars beat 2× the channel\'s median'));
      c.appendChild(key);
      c.appendChild(OFC.barTable(rows));
      var meta = el('div', 'cmeta'); meta.appendChild(OFC.momentumBadge(ss.momentum)); c.appendChild(meta);
      if (ss.best && ss.best.ratio >= 1.5) {
        var b = el('p', 'hint'); b.appendChild(document.createTextNode('Top recent: '));
        var a = el('a', null, ss.best.row.title); a.href = ss.best.row.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; b.appendChild(a);
        b.appendChild(document.createTextNode(' (' + ss.best.ratio.toFixed(1) + '× its usual)')); c.appendChild(b);
      }
    } else c.appendChild(el('p', 'placeholder', rows ? 'No public uploads to chart yet.' : (st.busy ? 'Loading recent videos…' : 'Refresh to load recent videos.')));
    return c;
  }

  function renderBreakouts() {
    var items = [];
    st.list.forEach(function (e) {
      var ss = st.stats[e.id], rows = st.rows[e.id];
      if (!ss || !rows) return;
      rows.forEach(function (r) {
        var ratio = OFI.breakoutRatio(r, ss.medianViews);
        if (ratio != null && ratio >= 2 && OF.ageDays(r.publishedAt) <= 14 && r.views >= 500) items.push({ row: r, ratio: ratio, channel: st.chans[e.id] || e });
      });
    });
    items.sort(function (a, b) { return b.ratio - a.ratio; });
    var sec = $('trendBreakouts'); sec.hidden = !items.length;
    if (!items.length) return;
    var ul = $('brkList'); ul.textContent = '';
    items.slice(0, 6).forEach(function (it) {
      var li = el('li'), a = el('a', 'brk-title', it.row.title); a.href = it.row.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.appendChild(el('span', 'brk-ratio', it.ratio.toFixed(1) + '×'));
      var t = el('div', 'brk-text'); t.appendChild(a);
      t.appendChild(el('small', null, it.channel.title + ' · ' + OF.formatCount(it.row.views) + ' views · ' + OF.formatAge(OF.ageDays(it.row.publishedAt))));
      li.appendChild(t); ul.appendChild(li);
    });
    var topics = items.length >= 3 ? OFI.risingTopics(items.map(function (i) { return i.row; }), 8) : [];
    $('brkTopics').hidden = !topics.length;
    var chips = $('brkChips'); chips.textContent = '';
    topics.forEach(function (t) { chips.appendChild(el('span', 'tagchip', t.term + ' ' + t.count)); });
  }

  function renderAll() {
    var box = $('trendList'); box.textContent = '';
    st.list.forEach(function (e) { box.appendChild(trendCard(e)); });
    $('trendEmpty').hidden = !!st.list.length;
    $('trendRefresh').hidden = !st.list.length;
    $('trendExport').hidden = !st.list.length;
    updateStatus(); renderBreakouts();
  }

  // ---------- backup / restore ----------
  function exportJSON() {
    var blob = new Blob([JSON.stringify({ app: 'outlier-finder', version: 1, exported: new Date().toISOString(), channels: st.list }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'outlier-finder-watchlist-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJSON(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return A.say($('trendMsg'), 'That file is too large to be a watchlist backup.', true);
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var data = JSON.parse(rd.result), incoming = (Array.isArray(data) ? data : data.channels || []).map(clean).filter(Boolean), added = 0, merged = 0;
        incoming.forEach(function (e) {
          var have = find(e.id);
          if (!have) { st.list.push(e); added++; return; }
          e.snaps.forEach(function (s) { if (!have.snaps.some(function (x) { return Math.floor(x.t / DAY) === Math.floor(s.t / DAY); })) { have.snaps.push(s); merged++; } });
          have.snaps.sort(function (a, b) { return a.t - b.t; });
        });
        save(); renderAll();
        if (added) refresh(false); // clears the message box, so say our piece afterwards
        A.say($('trendMsg'), incoming.length ? 'Restored ' + added + ' new channel' + (added === 1 ? '' : 's') + (merged ? ' and ' + merged + ' extra snapshot' + (merged === 1 ? '' : 's') : '') + '.' : 'No channels found in that file.', !incoming.length);
      } catch (e) { A.say($('trendMsg'), "That file isn't a valid watchlist backup.", true); }
    };
    rd.readAsText(file);
  }

  // ---------- events ----------
  $('trendForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('trendInput').value.trim(); if (!v) return;
    $('trendAdd').disabled = true; A.say($('trendMsg'), ''); $('trendPick').hidden = true;
    OFC.resolve(v).then(function (list) {
      if (!list.length) return A.say($('trendMsg'), 'No channel found. Try a link, an @handle or a video link from the channel.', true);
      var done = function (ch) { $('trendInput').value = ''; A.trackChannel(ch); };
      if (list.length === 1) done(list[0]); else OFC.chooser($('trendPick'), list, done, 'Which channel do you want to track?');
    }).catch(function (err) { A.fail($('trendMsg'), err); }).then(function () { $('trendAdd').disabled = false; });
  });
  $('trendRefresh').addEventListener('click', function () { refresh(true); });
  $('trendExport').addEventListener('click', exportJSON);
  $('trendImport').addEventListener('click', function () { $('trendFile').click(); });
  $('trendFile').addEventListener('change', function (e) { importJSON(e.target.files[0]); e.target.value = ''; });

  load();
  A.register('trends', {
    show: function () {
      load(); renderAll();
      if (st.list.length && Date.now() - st.loadedAt > RELOAD_MS) refresh(false);
    }
  });
})();
