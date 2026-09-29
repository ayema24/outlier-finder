/* Viral videos: live breakout scan (fresh uploads) or YouTube's trending chart, plus the patterns behind the winners. */
(function () {
  'use strict';
  var A = window.OFApp, $ = A.$, el = A.el;
  var CATS = [['', 'All categories'], ['10', 'Music'], ['17', 'Sports'], ['19', 'Travel & events'], ['20', 'Gaming'], ['22', 'People & blogs'],
    ['23', 'Comedy'], ['24', 'Entertainment'], ['25', 'News & politics'], ['26', 'How-to & style'], ['27', 'Education'], ['28', 'Science & tech'],
    ['2', 'Autos'], ['15', 'Pets & animals']];
  var AUTO_MS = 5 * 60 * 1000;
  var st = { src: 'search', rows: [], updated: 0, busy: false, word: '', auto: null, subsDirty: false, scannedSrc: 'search' };

  CATS.forEach(function (c) { var o = el('option', null, c[1]); o.value = c[0]; $('vCat').appendChild(o); });

  function setSource(src) {
    st.src = src;
    Array.prototype.forEach.call(document.querySelectorAll('#vSource button'), function (b) { b.setAttribute('aria-pressed', b.dataset.src === src); });
    $('vQField').hidden = $('vWindowField').hidden = src === 'trending';
    $('vAutoLabel').hidden = src !== 'trending';
    if (src !== 'trending') { $('vAuto').checked = false; stopAuto(); }
    if (!st.subsDirty) $('vMaxSubs').value = src === 'trending' ? '' : '100k';
    $('vGo').textContent = src === 'trending' ? 'Load trending' : 'Scan now';
  }

  function withChannels(videos, filters) {
    var ids = Array.from(new Set(videos.map(function (v) { return v.snippet.channelId; })));
    return A.fetchBatched('channels', 'statistics', ids).then(function (ch) { return OF.buildRows(videos, ch, filters); });
  }

  function fresh(o) {
    var sp = {
      part: 'snippet', type: 'video', order: 'viewCount', maxResults: 50, q: $('vQ').value.trim(),
      publishedAfter: new Date(Date.now() - o.hours * 3600000).toISOString()
    };
    if (o.region) sp.regionCode = o.region;
    if (o.cat) sp.videoCategoryId = o.cat;
    var f = OF.FORMATS[o.type];
    if (f && f.api) sp.videoDuration = f.api;
    return A.fetchOutliers(sp, { maxSubs: o.maxSubs, minViews: 0, type: o.type }).then(function (r) { return r.rows; });
  }

  function trending(o) {
    var p = { part: 'snippet,statistics,contentDetails,player', chart: 'mostPopular', regionCode: o.region || 'US', maxResults: 50, maxHeight: 720 };
    if (o.cat) p.videoCategoryId = o.cat;
    return A.api('videos', p, OF.QUOTA.list).then(function (r) {
      return withChannels(r.items || [], { maxSubs: o.maxSubs, minViews: 0, type: o.type }).then(function (b) { return b.rows; });
    });
  }

  function scan(silent) {
    if (st.busy) return;
    var maxSubs = OF.parseCount($('vMaxSubs').value), region = $('vRegion').value.trim().toUpperCase();
    if (isNaN(maxSubs)) return A.say($('viralMsg'), 'Max subs must be a number like 50000 or 100k.', true);
    if (region && !/^[A-Z]{2}$/.test(region)) return A.say($('viralMsg'), 'Region must be a 2-letter code such as US or GB.', true);
    var o = { maxSubs: maxSubs, region: region, cat: $('vCat').value, type: $('vType').value, hours: +$('vWindow').value };
    st.busy = true; $('vGo').disabled = true; $('vGo').textContent = 'Scanning…';
    A.say($('viralMsg'), '');
    if (!silent) { var box = $('viralCards'); box.textContent = ''; for (var i = 0; i < 6; i++) box.appendChild(A.skeleton()); $('viralEmpty').hidden = true; }
    (st.src === 'trending' ? trending(o) : fresh(o)).then(function (rows) {
      st.rows = rows; st.updated = Date.now(); st.word = ''; st.scannedSrc = st.src;
      if (!rows.length) A.say($('viralMsg'), st.src === 'trending'
        ? 'Nothing on the trending chart matched. Raise the max subs (or clear it) to include bigger channels.'
        : 'No breakouts matched. Try a longer window, a higher max subs, or clear the topic.');
    }).catch(function (e) { A.fail($('viralMsg'), e); })
      .then(function () { st.busy = false; $('vGo').disabled = false; $('vGo').textContent = st.src === 'trending' ? 'Load trending' : 'Scan now'; render(); });
  }

  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function updateLive() {
    $('viralLive').hidden = !st.updated;
    if (st.updated) $('viralUpdated').textContent = 'Updated ' + ago(st.updated) + ' · ' + st.rows.length + ' video' + (st.rows.length === 1 ? '' : 's');
  }

  function render() {
    var box = $('viralCards'); box.textContent = '';
    var rows = st.rows, sortKey = $('vSort').value;
    if (st.word) rows = rows.filter(function (r) { return OFI.keywords(r.title).indexOf(st.word) >= 0; });
    rows = OF.sortRows(rows, sortKey);
    var ranked = sortKey !== 'newest';
    rows.forEach(function (r, i) {
      var vph = Math.round(OF.rowVph(r));
      box.appendChild(A.card(r, ranked ? i : null, { perHour: true, pill: '🚀 ' + OF.formatCount(vph) + ' views per hour since upload' }));
    });
    $('viralEmpty').hidden = st.busy || !!rows.length || !!st.rows.length;
    updateLive();

    var pat = OFI.analyzePatterns(st.rows), sec = $('viralPatterns');
    sec.hidden = !pat;
    if (!pat) return;
    $('patSub').textContent = 'Based on ' + pat.n + ' video' + (pat.n === 1 ? '' : 's') + (st.scannedSrc === 'trending' ? " from YouTube's trending chart." : ' that beat their channel size in this window.') +
      (pat.n < 8 ? ' Small sample: treat as hints.' : '');
    var ul = $('patInsights'); ul.textContent = '';
    pat.insights.forEach(function (i) { var li = el('li'); li.appendChild(el('span', 'ii', i.icon)); li.appendChild(el('span', null, i.text)); ul.appendChild(li); });
    var chips = $('patWords'); chips.textContent = '';
    pat.words.forEach(function (w) {
      var b = el('button', 'tagchip' + (st.word === w.term ? ' active' : ''), w.term + ' ' + w.count); b.type = 'button';
      b.addEventListener('click', function () { st.word = st.word === w.term ? '' : w.term; render(); });
      chips.appendChild(b);
    });
    if (!pat.words.length) chips.appendChild(el('span', 'hint', 'No word appears in more than one title yet.'));
  }

  function startAuto() {
    stopAuto();
    st.auto = setInterval(function () {
      if (document.hidden || document.body.dataset.view !== 'viral' || st.src !== 'trending') return;
      scan(true);
    }, AUTO_MS);
  }
  function stopAuto() { clearInterval(st.auto); st.auto = null; }

  $('viralForm').addEventListener('submit', function (e) { e.preventDefault(); scan(false); });
  $('vSort').addEventListener('change', render);
  $('vMaxSubs').addEventListener('input', function () { st.subsDirty = true; });
  $('vAuto').addEventListener('change', function (e) {
    if (e.target.checked) { startAuto(); A.toast('Refreshing every 5 minutes while this tab is open'); } else stopAuto();
  });
  Array.prototype.forEach.call(document.querySelectorAll('#vSource button'), function (b) { b.addEventListener('click', function () { setSource(b.dataset.src); }); });
  setInterval(updateLive, 20000);
  setSource('search');
  A.register('viral', { show: function () { render(); } });
})();
