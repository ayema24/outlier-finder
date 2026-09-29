/* Shared pieces for the channel tools: lookups, recent uploads, SVG charts, channel cards. Exposes window.OFC. */
(function () {
  'use strict';
  var A = window.OFApp, el = A.el;
  var CH_PARTS = 'snippet,statistics,brandingSettings';
  var RECENT_TTL = 3 * 3600 * 1000, RECENT_PREFIX = 'of.recent.';
  var NS = 'http://www.w3.org/2000/svg';

  // ---------- data ----------
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function fetchChannels(ids) {
    ids = unique(ids.filter(Boolean));
    if (!ids.length) return Promise.resolve([]);
    return A.fetchBatched('channels', CH_PARTS, ids).then(function (items) {
      var out = items.map(OFI.buildChannel);
      return out.sort(function (a, b) { return ids.indexOf(a.id) - ids.indexOf(b.id); });
    });
  }

  /** Link / @handle / channel id / video link / name -> matching channels (one, or up to 6 for a name). */
  function resolve(input) {
    var p = OFI.parseChannelInput(input);
    if (!p) return Promise.reject(new Error('Paste a channel link, @handle, video link or name.'));
    if (p.type === 'id') return fetchChannels([p.id]);
    if (p.type === 'handle') {
      return A.api('channels', { part: CH_PARTS, forHandle: p.handle }, OF.QUOTA.list).then(function (r) { return (r.items || []).map(OFI.buildChannel); });
    }
    if (p.type === 'video') {
      return A.api('videos', { part: 'snippet', id: p.id }, OF.QUOTA.list).then(function (r) {
        var v = (r.items || [])[0];
        return v ? fetchChannels([v.snippet.channelId]) : [];
      });
    }
    return A.api('search', { part: 'snippet', type: 'channel', q: p.q, maxResults: 6 }, OF.QUOTA.search).then(function (r) {
      return fetchChannels((r.items || []).map(function (i) { return i.id && i.id.channelId; }));
    });
  }

  function cacheGet(id) {
    try {
      var c = JSON.parse(A.store(RECENT_PREFIX + id) || 'null');
      return c && Date.now() - c.t < RECENT_TTL ? c.rows : null;
    } catch (e) { return null; }
  }

  /** A channel's newest uploads (up to n, newest first) with stats. Costs 2 quota units, cached for 3 hours. */
  function recent(channel, n, force) {
    var hit = !force && cacheGet(channel.id);
    if (hit) return Promise.resolve(hit);
    var pl = OFI.uploadsPlaylist(channel.id);
    if (!pl) return Promise.resolve([]);
    return A.api('playlistItems', { part: 'contentDetails', playlistId: pl, maxResults: Math.min(n || 30, 50) }, OF.QUOTA.list).then(function (page) {
      var ids = (page.items || []).map(function (i) { return i.contentDetails && i.contentDetails.videoId; }).filter(Boolean);
      if (!ids.length) return [];
      return A.fetchBatched('videos', 'snippet,statistics,contentDetails,player', ids, OF.PLAYER_PARAMS)
        .then(function (videos) { return OF.channelRows(videos, channel.subs); });
    }, function (e) {
      if (/\(404\)/.test(e.message)) return []; // no public uploads playlist
      throw e;
    }).then(function (rows) {
      A.store(RECENT_PREFIX + channel.id, JSON.stringify({ t: Date.now(), rows: rows }));
      return rows;
    });
  }

  /** recent() for several channels at once; one failure just yields an empty list for that channel. */
  function recentMany(channels, n) {
    return Promise.all(channels.map(function (c) { return recent(c, n).catch(function () { return []; }); }))
      .then(function (lists) { var out = {}; channels.forEach(function (c, i) { out[c.id] = lists[i]; }); return out; });
  }

  // ---------- small UI bits ----------
  function fmtDate(t) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function fmtNum(n) { return n == null ? '–' : Math.round(n).toLocaleString(); }
  function signed(n, f) { return (n > 0 ? '+' : n < 0 ? '−' : '') + (f || OF.formatCount)(Math.abs(n)); }

  function avatar(ch, size) {
    var box = el('span', 'avatar big'), s = size || 44;
    box.style.width = box.style.height = s + 'px'; box.style.flexBasis = s + 'px';
    var h = A.hue(ch.title || '');
    box.style.background = 'linear-gradient(135deg, hsl(' + h + ',75%,55%), hsl(' + ((h + 50) % 360) + ',80%,50%))';
    box.textContent = (ch.title || '?').trim().charAt(0).toUpperCase();
    if (ch.thumb) {
      var img = el('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = ch.thumb;
      img.addEventListener('error', function () { img.remove(); });
      box.appendChild(img);
    }
    return box;
  }

  var MOMENTUM = {
    rising: ['📈', 'Rising', 'up'], cooling: ['📉', 'Cooling', 'down'], steady: ['➡️', 'Steady', 'flat'], unknown: ['⏳', 'Too few videos', 'unk']
  };
  function momentumBadge(m) {
    var d = MOMENTUM[(m && m.trend) || 'unknown'];
    var b = el('span', 'mbadge ' + d[2], d[0] + ' ' + d[1] + (m && m.ratio ? ' ×' + m.ratio.toFixed(1) : ''));
    b.title = 'Median views of the newest 5 videos (older than 2 days) compared with the 5 before them.';
    return b;
  }

  function table(head, rows) {
    var d = el('details', 'chart-table'), t = el('table'), tr = el('tr');
    d.appendChild(el('summary', null, 'Show data'));
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    t.appendChild(el('thead')).appendChild(tr);
    var tb = el('tbody');
    rows.forEach(function (r) { var x = el('tr'); r.forEach(function (c) { x.appendChild(el('td', null, c)); }); tb.appendChild(x); });
    t.appendChild(tb);
    var sc = el('div', 'tscroll'); sc.appendChild(t); d.appendChild(sc);
    return d;
  }

  function chooser(box, channels, onPick, title) {
    box.textContent = '';
    box.hidden = !channels.length;
    if (!channels.length) return;
    box.appendChild(el('p', 'hint', title || 'Which one did you mean?'));
    channels.forEach(function (ch) {
      var b = el('button', 'pick-row'); b.type = 'button';
      b.appendChild(avatar(ch, 36));
      var t = el('span', 'pick-text');
      t.appendChild(el('b', null, ch.title));
      t.appendChild(el('small', null, [ch.handle, ch.subs != null ? OF.formatCount(ch.subs) + ' subs' : 'hidden subs', OF.formatCount(ch.videos) + ' videos'].filter(Boolean).join(' · ')));
      b.appendChild(t);
      b.addEventListener('click', function () { box.hidden = true; onPick(ch); });
      box.appendChild(b);
    });
  }

  // ---------- SVG charts (one blue series; thin marks; recessive grid; hover tooltip) ----------
  function s(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function stext(parent, x, y, txt, cls, anchor) {
    var t = s('text', { x: x, y: y, 'class': cls || 'ct', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = txt;
    return t;
  }

  /** Tick values at 1 / 2 / 5 x 10^k steps covering [min, max]. */
  function niceTicks(min, max, count) {
    if (max <= min) { max = min + 1; }
    var raw = (max - min) / (count || 3), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag, out = [];
    for (var v = Math.floor(min / step) * step; v < max + step - 1e-9; v += step) out.push(v);
    return { ticks: out, step: step };
  }
  /** Compact number with just enough decimals to tell neighbouring ticks apart. */
  function tickLabel(v, step) {
    var unit = Math.abs(v) >= 1e9 ? 1e9 : Math.abs(v) >= 1e6 ? 1e6 : Math.abs(v) >= 1e3 ? 1e3 : 1;
    var dec = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step / unit) - 1e-9)));
    return (v / unit).toFixed(dec) + (unit === 1e9 ? 'B' : unit === 1e6 ? 'M' : unit === 1e3 ? 'K' : '');
  }

  function tipBox(wrap) { var t = el('div', 'tip'); t.hidden = true; wrap.appendChild(t); return t; }
  function fillTip(t, lines) {
    t.textContent = '';
    lines.forEach(function (l) { t.appendChild(el('div', l[0], l[1])); });
  }
  /** Position a tooltip above an SVG point (viewBox coords), clamped inside the wrapper. */
  function placeTip(t, wrap, svgEl, vb, x, y) {
    t.hidden = false;
    var r = svgEl.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    var px = r.left - w.left + x / vb[0] * r.width, py = r.top - w.top + y / vb[1] * r.height;
    var half = t.offsetWidth / 2;
    t.style.left = Math.max(half, Math.min(w.width - half, px)) + 'px';
    t.style.top = py + 'px';
  }

  /**
   * Line + soft area over time. points: [{ t: ms, y: number }], opts: { label, fmt(y) }.
   * Hover or arrow keys read the value at a date; the last point is labelled.
   */
  function lineChart(points, o) {
    o = o || {};
    var fmt = o.fmt || OF.formatCount, VB = [320, 124], pl = 46, pr = 50, pt = 10, pb = 22;
    var wrap = el('div', 'chart'), svgEl = s('svg', { viewBox: '0 0 ' + VB[0] + ' ' + VB[1], role: 'img', tabindex: 0 }, wrap);
    var ys = points.map(function (p) { return p.y; }), t0 = points[0].t, t1 = points[points.length - 1].t;
    var nt = niceTicks(Math.min.apply(null, ys), Math.max.apply(null, ys), 3), lo = nt.ticks[0], hi = nt.ticks[nt.ticks.length - 1];
    var X = function (t) { return t1 === t0 ? (pl + VB[0] - pr) / 2 : pl + (t - t0) / (t1 - t0) * (VB[0] - pl - pr); };
    var Y = function (v) { return pt + (1 - (v - lo) / (hi - lo)) * (VB[1] - pt - pb); };
    svgEl.setAttribute('aria-label', (o.label || 'Trend') + ' from ' + fmt(points[0].y) + ' on ' + fmtDate(t0) + ' to ' + fmt(points[points.length - 1].y) + ' on ' + fmtDate(t1));
    nt.ticks.forEach(function (v) {
      s('line', { x1: pl, x2: VB[0] - pr, y1: Y(v), y2: Y(v), 'class': 'grid' }, svgEl);
      stext(svgEl, pl - 6, Y(v) + 3, tickLabel(v, nt.step), 'ct', 'end');
    });
    var d = points.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
    var base = VB[1] - pb;
    s('path', { d: d + ' L' + X(t1).toFixed(1) + ' ' + base + ' L' + X(t0).toFixed(1) + ' ' + base + ' Z', 'class': 'area' }, svgEl);
    s('path', { d: d, 'class': 'line' }, svgEl);
    stext(svgEl, X(t0), VB[1] - 6, fmtDate(t0), 'ct', 'start');
    if (t1 !== t0) stext(svgEl, X(t1), VB[1] - 6, fmtDate(t1), 'ct', 'end');
    var last = points[points.length - 1];
    s('circle', { cx: X(last.t), cy: Y(last.y), r: 5, 'class': 'dot' }, svgEl);
    stext(svgEl, X(last.t) + 9, Y(last.y) + 4, fmt(last.y), 'cv', 'start');

    var cross = s('line', { y1: pt, y2: base, 'class': 'cross' }, svgEl), hot = s('circle', { r: 5, 'class': 'dot' }, svgEl), tip = tipBox(wrap), idx = -1;
    cross.style.display = hot.style.display = 'none';
    function at(i) {
      idx = Math.max(0, Math.min(points.length - 1, i));
      var p = points[idx], x = X(p.t), y = Y(p.y);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); hot.setAttribute('cx', x); hot.setAttribute('cy', y);
      cross.style.display = hot.style.display = '';
      fillTip(tip, [['tv', fmt(p.y)], ['ts', (o.label ? o.label + ' · ' : '') + fmtDate(p.t)]]);
      placeTip(tip, wrap, svgEl, VB, x, y - 8);
    }
    function off() { cross.style.display = hot.style.display = 'none'; tip.hidden = true; }
    svgEl.addEventListener('pointermove', function (e) {
      var r = svgEl.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * VB[0], best = 0;
      points.forEach(function (p, i) { if (Math.abs(X(p.t) - vx) < Math.abs(X(points[best].t) - vx)) best = i; });
      at(best);
    });
    svgEl.addEventListener('pointerleave', off);
    svgEl.addEventListener('blur', off);
    svgEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); at(idx < 0 ? points.length - 1 : idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); at(idx < 0 ? points.length - 1 : idx + 1); }
    });
    return wrap;
  }

  /**
   * Views per video, oldest to newest, from zero. Videos at 2x the channel's median or better are solid;
   * the rest are dimmed, so breakouts stand out. Hover / focus reads a video; click opens it.
   */
  function barChart(rows, o) {
    o = o || {};
    var list = rows.slice(0, o.max || 24).reverse(), VB = [320, 132], pl = 6, pr = 6, pt = 18, pb = 18;
    var wrap = el('div', 'chart'), svgEl = s('svg', { viewBox: '0 0 ' + VB[0] + ' ' + VB[1], role: 'group', 'aria-label': 'Views per recent video' }, wrap);
    var med = o.median != null ? o.median : OFI.median(list.map(function (r) { return r.views; }));
    var max = Math.max.apply(null, list.map(function (r) { return r.views; }).concat([1])), ch = VB[1] - pt - pb;
    var slot = (VB[0] - pl - pr) / list.length, bw = Math.min(24, slot * 0.72);
    var Y = function (v) { return pt + (1 - v / max) * ch; }, base = pt + ch;
    s('line', { x1: pl, x2: VB[0] - pr, y1: base, y2: base, 'class': 'grid base' }, svgEl);
    var tip = tipBox(wrap), bars = [];
    list.forEach(function (r, i) {
      var x = pl + slot * i + (slot - bw) / 2, y = Y(r.views), h = Math.max(base - y, 1), rad = Math.min(4, bw / 2, h);
      var hit = med > 0 && r.views >= 2 * med;
      var bar = s('path', {
        d: 'M' + x + ' ' + base + 'V' + (y + rad) + 'Q' + x + ' ' + y + ' ' + (x + rad) + ' ' + y + 'H' + (x + bw - rad) + 'Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + rad) + 'V' + base + 'Z',
        'class': 'bar' + (hit ? ' hit' : '')
      }, svgEl);
      bars.push(bar);
      var hitRect = s('rect', {
        x: pl + slot * i, y: 0, width: slot, height: VB[1], 'class': 'hitarea', tabindex: 0, role: 'link',
        'aria-label': r.title + ', ' + OF.formatCount(r.views) + ' views'
      }, svgEl);
      var show = function () {
        bars.forEach(function (b) { b.classList.remove('on'); }); bar.classList.add('on');
        fillTip(tip, [['tv', OF.formatCount(r.views) + ' views'], ['tt', r.title.length > 64 ? r.title.slice(0, 63) + '…' : r.title],
          ['ts', fmtDate(r.publishedAt) + (med > 0 ? ' · ' + (r.views / med).toFixed(1) + '× median' : '')]]);
        placeTip(tip, wrap, svgEl, VB, x + bw / 2, y - 2);
      };
      var hide = function () { bar.classList.remove('on'); tip.hidden = true; };
      hitRect.addEventListener('pointerenter', show); hitRect.addEventListener('pointerleave', hide);
      hitRect.addEventListener('focus', show); hitRect.addEventListener('blur', hide);
      hitRect.addEventListener('click', function () { window.open(r.url, '_blank', 'noopener'); });
      hitRect.addEventListener('keydown', function (e) { if (e.key === 'Enter') window.open(r.url, '_blank', 'noopener'); });
    });
    if (med > 0) {
      s('line', { x1: pl, x2: VB[0] - pr, y1: Y(med), y2: Y(med), 'class': 'median' }, svgEl);
      // put the label over whichever end has the shorter bars, so it doesn't sit on a tall one
      var third = Math.max(1, Math.floor(list.length / 3)), tall = function (a) { return Math.max.apply(null, a.map(function (r) { return r.views; }).concat([0])); };
      var left = tall(list.slice(0, third)) <= tall(list.slice(-third));
      stext(svgEl, left ? pl : VB[0] - pr, Y(med) - 4, 'median ' + OF.formatCount(Math.round(med)), 'ct halo', left ? 'start' : 'end');
    }
    var top = list.reduce(function (a, r) { return r.views > a.views ? r : a; }, list[0]), ti = list.indexOf(top);
    stext(svgEl, Math.max(24, Math.min(VB[0] - 24, pl + slot * ti + slot / 2)), Y(top.views) - 5, OF.formatCount(top.views), 'cv halo', 'middle');
    stext(svgEl, pl, VB[1] - 4, fmtDate(list[0].publishedAt), 'ct', 'start');
    if (list.length > 1) stext(svgEl, VB[0] - pr, VB[1] - 4, fmtDate(list[list.length - 1].publishedAt), 'ct', 'end');
    return wrap;
  }

  function barTable(rows) {
    return table(['Date', 'Video', 'Views'], rows.slice(0, 24).map(function (r) { return [fmtDate(r.publishedAt), r.title, fmtNum(r.views)]; }));
  }

  // ---------- channel card ----------
  /**
   * o: { badge: {text, title}, reasons: [str], shared: [str], tiles: [[label, value]], rows (for the bar chart),
   *      stats (channelStats), note }
   */
  function channelCard(ch, o) {
    o = o || {};
    var c = el('article', 'ccard');
    var head = el('div', 'ccard-head'); head.appendChild(avatar(ch, 46));
    var id = el('div', 'ccard-id');
    var name = el('a', 'cname', ch.title); name.href = ch.url; name.target = '_blank'; name.rel = 'noopener noreferrer';
    id.appendChild(name);
    id.appendChild(el('div', 'chandle', [ch.handle, ch.country].filter(Boolean).join(' · ') || ' '));
    head.appendChild(id);
    if (o.badge) { var bd = el('span', 'cbadge', o.badge.text); if (o.badge.title) bd.title = o.badge.title; head.appendChild(bd); }
    c.appendChild(head);

    if (o.reasons && o.reasons.length) { var ul = el('ul', 'reasons'); o.reasons.forEach(function (r) { ul.appendChild(el('li', null, r)); }); c.appendChild(ul); }
    if (o.shared && o.shared.length) {
      var sh = el('div', 'chips-inline'); sh.appendChild(el('span', 'pat-label', 'Shared topics'));
      o.shared.forEach(function (t) { sh.appendChild(el('span', 'tagchip', t)); });
      c.appendChild(sh);
    }
    var tiles = o.tiles || [['Subs', ch.subs != null ? OF.formatCount(ch.subs) : 'hidden'], ['Videos', OF.formatCount(ch.videos)], ['Total views', OF.formatCount(ch.views)]];
    var dl = el('dl', 'stats t' + tiles.length);
    tiles.forEach(function (t) { A.stat(dl, t[0], t[1]); });
    c.appendChild(dl);
    if (o.stats) {
      var meta = el('div', 'cmeta'); meta.appendChild(momentumBadge(o.stats.momentum));
      if (o.stats.perMonth != null) meta.appendChild(el('span', 'hint', '≈ ' + o.stats.perMonth.toFixed(1) + ' uploads / month'));
      c.appendChild(meta);
    }
    if (o.rows && o.rows.length > 1) { c.appendChild(barChart(o.rows, { max: 16, median: o.stats && o.stats.medianViews })); c.appendChild(barTable(o.rows)); }
    else if (o.rows) c.appendChild(el('p', 'hint', 'No public uploads to chart.'));
    if (o.note) c.appendChild(el('p', 'hint', o.note));

    var act = el('div', 'actions');
    var open = el('a', 'btn ghost', 'Open ↗'); open.href = ch.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
    var sim = el('button', 'btn ghost', '🧬 Similar'); sim.type = 'button'; sim.addEventListener('click', function () { A.go('similar', ch.id); });
    var trk = el('button', 'btn ghost', A.isTracked && A.isTracked(ch.id) ? '✓ Tracking' : '📈 Track'); trk.type = 'button';
    trk.addEventListener('click', function () {
      if (!A.trackChannel) return;
      trk.disabled = true;
      A.trackChannel(ch).then(function (ok) { trk.textContent = ok ? '✓ Tracking' : '📈 Track'; trk.disabled = false; });
    });
    act.appendChild(open); act.appendChild(sim); act.appendChild(trk);
    c.appendChild(act);
    return c;
  }

  function channelSkeleton() {
    var c = el('article', 'ccard skeleton');
    [50, 100, 70, 100].forEach(function (w) { var l = el('div', 'sk-line'); l.style.width = w + '%'; l.style.height = '14px'; l.style.marginBottom = '12px'; c.appendChild(l); });
    return c;
  }

  window.OFC = {
    fetchChannels: fetchChannels, resolve: resolve, recent: recent, recentMany: recentMany,
    avatar: avatar, momentumBadge: momentumBadge, chooser: chooser, table: table, lineChart: lineChart, barChart: barChart,
    barTable: barTable, channelCard: channelCard, channelSkeleton: channelSkeleton, fmtDate: fmtDate, fmtNum: fmtNum, signed: signed
  };
})();
