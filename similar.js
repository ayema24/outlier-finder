/* Similar channels: topic profile of a channel -> discover neighbours -> compare growth signals and playbooks. */
(function () {
  'use strict';
  var A = window.OFApp, $ = A.$, el = A.el;
  var st = { source: null, srcRows: [], srcStats: null, terms: [], cands: [], busy: false, token: 0 };
  var KEEP = 10, MIN_SIM = 0.05; // candidates sharing (almost) no topic words with the source are dropped

  function pctTxt(x) { return x == null ? '–' : (x >= 0.1 ? Math.round(x * 100) : Math.round(x * 1000) / 10) + '%'; }
  function perMonth(x) { return x == null ? '–' : (x >= 10 ? Math.round(x) : x.toFixed(1)); }

  function start(input) {
    if (st.busy) return;
    var box = $('similarMsg');
    A.say(box, ''); $('similarPick').hidden = true;
    var wait = el('p', 'hint', 'Looking up the channel…'); $('similarSource').hidden = false; $('similarSource').textContent = ''; $('similarSource').appendChild(wait);
    OFC.resolve(input).then(function (list) {
      if (!list.length) { $('similarSource').hidden = true; return A.say(box, 'No channel found. Try a link, an @handle or a video link from the channel.', true); }
      if (list.length === 1) return analyze(list[0]);
      $('similarSource').hidden = true;
      OFC.chooser($('similarPick'), list, analyze, 'Which channel do you want to compare against?');
    }).catch(function (e) { $('similarSource').hidden = true; A.fail(box, e); });
  }

  function analyze(source) {
    var token = ++st.token;
    st.busy = true; st.source = source; st.cands = []; st.srcRows = []; st.terms = [];
    $('similarGo').disabled = true; $('similarPick').hidden = true; $('similarBar').hidden = true;
    A.say($('similarMsg'), '');
    var cards = $('similarCards'); cards.textContent = '';
    for (var i = 0; i < 4; i++) cards.appendChild(OFC.channelSkeleton());
    renderSource('Reading ' + source.title + "'s recent videos…");

    OFC.recent(source, 30).then(function (rows) {
      if (token !== st.token) throw new Error('cancelled');
      st.srcRows = rows; st.srcStats = OFI.channelStats(rows, source);
      st.terms = OFI.topicProfile(rows, source);
      renderSource('Searching for channels in the same space…');
      if (!st.terms.length) throw new Error('There is not enough text on that channel (titles, tags, description) to work out its topic.');
      var queries = OFI.topicQueries(st.terms, 2), hit = {}, ids = [];
      var since = new Date(Date.now() - 120 * 86400000).toISOString();
      var addText = function (id, text) { if (!id || id === source.id) return; if (ids.indexOf(id) < 0) ids.push(id); hit[id] = (hit[id] || '') + ' ' + text; };
      return A.api('search', { part: 'snippet', type: 'channel', q: queries[0], maxResults: 15 }, OF.QUOTA.search).then(function (r) {
        (r.items || []).forEach(function (it) { addText(it.id && it.id.channelId, (it.snippet.channelTitle || '') + ' ' + (it.snippet.description || '')); });
        return A.api('search', { part: 'snippet', type: 'video', q: queries[1] || queries[0], publishedAfter: since, maxResults: 25 }, OF.QUOTA.search);
      }).then(function (r) {
        (r.items || []).forEach(function (it) { addText(it.snippet.channelId, it.snippet.title); });
        return OFC.fetchChannels(ids.slice(0, 40));
      }).then(function (chs) {
        chs = chs.filter(function (c) { return c.id !== source.id; });
        chs.forEach(function (c) { c.score0 = OFI.similarityScore(st.terms, [c.title, c.description, c.keywords.join(' '), hit[c.id]].join(' ')); });
        chs = chs.filter(function (c) { return c.score0 >= MIN_SIM; });
        chs.sort(function (a, b) { return b.score0 - a.score0; });
        var top = chs.slice(0, KEEP);
        return OFC.recentMany(top, 20).then(function (byId) {
          if (token !== st.token) throw new Error('cancelled');
          st.cands = top.map(function (c) {
            var rows = byId[c.id] || [], text = [c.title, c.description, c.keywords.join(' '), hit[c.id]].concat(rows.map(function (r) { return r.title + ' ' + (r.tags || []).join(' '); })).join(' ');
            return { ch: c, rows: rows, stats: OFI.channelStats(rows, c), sim: OFI.similarityScore(st.terms, text), shared: OFI.sharedTerms(st.terms, text, 4) };
          });
        });
      });
    }).then(function () {
      renderSource(); renderCards();
      if (!st.cands.length) A.say($('similarMsg'), 'Nothing similar came up. The channel may be very niche or new. Try a link to a channel with more videos.');
    }).catch(function (e) {
      if (e.message === 'cancelled') return;
      cards.textContent = ''; renderSource(); A.fail($('similarMsg'), e);
    }).then(function () { if (token === st.token) { st.busy = false; $('similarGo').disabled = false; } });
  }

  // ---------- rendering ----------
  function insightList(pat) {
    var ul = el('ul', 'insights');
    pat.insights.forEach(function (i) { var li = el('li'); li.appendChild(el('span', 'ii', i.icon)); li.appendChild(el('span', null, i.text)); ul.appendChild(li); });
    return ul;
  }
  function topThird(rows) {
    var n = Math.max(5, Math.ceil(rows.length / 3));
    return rows.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, n);
  }

  function renderSource(status) {
    var box = $('similarSource'), s = st.source;
    box.textContent = ''; box.hidden = !s;
    if (!s) return;
    var head = el('div', 'ccard-head'); head.appendChild(OFC.avatar(s, 54));
    var id = el('div', 'ccard-id'), name = el('a', 'cname', s.title); name.href = s.url; name.target = '_blank'; name.rel = 'noopener noreferrer';
    id.appendChild(name); id.appendChild(el('div', 'chandle', [s.handle, s.subs != null ? OF.formatCount(s.subs) + ' subs' : 'hidden subs', OF.formatCount(s.videos) + ' videos'].filter(Boolean).join(' · ')));
    head.appendChild(id); head.appendChild(el('span', 'cbadge alt', 'Comparing against'));
    box.appendChild(head);
    if (status) { box.appendChild(el('p', 'hint', status)); return; }
    var ss = st.srcStats;
    if (ss && st.srcRows.length) {
      var dl = el('dl', 'stats');
      A.stat(dl, 'Median views', OF.formatCount(Math.round(ss.medianViews))); A.stat(dl, 'Views ÷ subs', pctTxt(ss.viewsToSubs));
      A.stat(dl, 'Uploads / mo', perMonth(ss.perMonth)); A.stat(dl, 'Shorts', Math.round(ss.shortShare * 100) + '%');
      box.appendChild(dl);
      var meta = el('div', 'cmeta'); meta.appendChild(OFC.momentumBadge(ss.momentum)); box.appendChild(meta);
    }
    var chips = el('div', 'chips-inline'); chips.appendChild(el('span', 'pat-label', 'Topic clues'));
    st.terms.slice(0, 8).forEach(function (t) { chips.appendChild(el('span', 'tagchip', t.term)); });
    box.appendChild(chips);

    var grid = el('div', 'playbooks');
    var pat = st.srcRows.length >= 3 ? OFI.analyzePatterns(topThird(st.srcRows)) : null;
    if (pat) { var a = el('div', 'playbook'); a.appendChild(el('h3', null, 'What works for ' + s.title)); a.appendChild(el('p', 'hint', 'From its best ' + pat.n + ' recent videos.')); a.appendChild(insightList(pat)); grid.appendChild(a); }
    var comp = competitorPlaybook();
    if (comp) grid.appendChild(comp);
    if (grid.children.length) box.appendChild(grid);
  }

  /** Aggregate view of what the discovered channels do: their best recent videos, cadence and typical views. */
  function competitorPlaybook() {
    var withRows = st.cands.filter(function (c) { return c.rows.length >= 3; });
    if (withRows.length < 2) return null;
    var best = [];
    withRows.forEach(function (c) { best = best.concat(c.rows.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 3)); });
    var pat = OFI.analyzePatterns(best);
    var box = el('div', 'playbook');
    box.appendChild(el('h3', null, 'What similar channels do'));
    box.appendChild(el('p', 'hint', 'From the 3 best recent videos of each of ' + withRows.length + ' channels.'));
    var ul = insightList(pat);
    var cad = OFI.median(withRows.map(function (c) { return c.stats.perMonth; }).filter(function (x) { return x != null; }));
    var med = OFI.median(withRows.map(function (c) { return c.stats.medianViews; }));
    var srcCad = st.srcStats && st.srcStats.perMonth, srcMed = st.srcStats && st.srcStats.medianViews;
    if (cad) { var li = el('li'); li.appendChild(el('span', 'ii', '🗓️')); li.appendChild(el('span', null, 'They upload about ' + perMonth(cad) + ' times a month' + (srcCad ? ' (' + st.source.title + ': ' + perMonth(srcCad) + ').' : '.'))); ul.insertBefore(li, ul.firstChild); }
    if (med && srcMed) { var l2 = el('li'); l2.appendChild(el('span', 'ii', '👁️')); l2.appendChild(el('span', null, 'A typical video gets ' + OF.formatCount(Math.round(med)) + ' views, ' + (med / srcMed >= 1 ? (med / srcMed).toFixed(1) + '× ' : Math.round(100 * med / srcMed) + '% of ') + st.source.title + "'s.")); ul.insertBefore(l2, ul.children[1] || null); }
    box.appendChild(ul);
    return box;
  }

  var SORTS = {
    match: function (a, b) { return b.sim - a.sim; },
    growth: function (a, b) { return (b.stats.viewsToSubs || -1) - (a.stats.viewsToSubs || -1); },
    momentum: function (a, b) { return (b.stats.momentum.ratio || -1) - (a.stats.momentum.ratio || -1); },
    small: function (a, b) { return (a.ch.subs == null ? 1e12 : a.ch.subs) - (b.ch.subs == null ? 1e12 : b.ch.subs); }
  };

  function renderCards() {
    var box = $('similarCards'); box.textContent = '';
    var list = st.cands.slice();
    if ($('similarSmaller').checked && st.source && st.source.subs != null) list = list.filter(function (c) { return c.ch.subs != null && c.ch.subs < st.source.subs; });
    list.sort(SORTS[$('similarSort').value] || SORTS.match);
    $('similarBar').hidden = !st.cands.length;
    $('similarSummary').textContent = st.cands.length ? list.length + ' of ' + st.cands.length + ' channels shown. Topic match is a rough overlap of words, not a guarantee.' : '';
    list.forEach(function (c) {
      var ss = c.stats, ch = c.ch;
      box.appendChild(OFC.channelCard(ch, {
        badge: { text: Math.round(c.sim * 100) + '% topic', title: 'Rough overlap between this channel\'s words and the source channel\'s topic clues' },
        shared: c.shared, rows: c.rows, stats: ss,
        tiles: [['Subs', ch.subs != null ? OF.formatCount(ch.subs) : 'hidden'], ['Median views', c.rows.length ? OF.formatCount(Math.round(ss.medianViews)) : '–'],
          ['Views ÷ subs', pctTxt(ss.viewsToSubs)], ['Uploads / mo', perMonth(ss.perMonth)]]
      }));
    });
    if (st.cands.length && !list.length) box.appendChild(el('p', 'hint', 'None of these are smaller than the source. Untick "Smaller than source" to see them.'));
  }

  $('similarForm').addEventListener('submit', function (e) { e.preventDefault(); var v = $('similarInput').value.trim(); if (v) start(v); });
  $('similarSort').addEventListener('change', renderCards);
  $('similarSmaller').addEventListener('change', renderCards);
  A.register('similar', {
    show: function (arg) {
      if (arg && (!st.source || st.source.id !== arg) && !st.busy) { $('similarInput').value = arg; start(arg); }
    }
  });
})();
