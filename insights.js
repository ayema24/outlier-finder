/* Pure analysis logic for the Viral / Find Channel / Similar / Trends tools.
   Works in the browser (window.OFI, needs window.OF from lib.js) and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lib.js'));
  else root.OFI = factory(root.OF);
})(typeof self !== 'undefined' ? self : this, function (OF) {
  'use strict';

  var DAY = 86400000;

  // ---------- text helpers ----------
  var STOP = {};
  ('a an and are as at be but by for from how i in is it its my of on or our so that the their this to was we what when why with you your ' +
   'not no can do does did have has had will just get got than then them they these those there here about into over after before more most ' +
   'every need needs ever really thing things know make makes made way ways many much even still take takes let lets going want wants use used using ' +
   'off very one all any out up down new best top vs via if me he she his her who which while also been being were am video videos official ' +
   'watch shorts short subscribe channel full part')
    .split(' ').forEach(function (w) { STOP[w] = 1; });

  function tokenize(text) {
    return String(text == null ? '' : text).toLowerCase().match(/[\p{L}\p{N}]+(?:'\p{L}+)?/gu) || [];
  }
  /** Meaningful words: no stop words, no bare numbers, 3+ letters. */
  function keywords(text) {
    return tokenize(text).filter(function (t) { return t.length >= 3 && !STOP[t] && !/^\d+$/.test(t); });
  }
  function unique(arr) { var seen = {}; return arr.filter(function (x) { return seen[x] ? false : (seen[x] = 1); }); }

  /** true when two words are equal or differ by one edit (only for words of 5+ letters; forgives OCR slips). */
  function within1(a, b) {
    if (a === b) return true;
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  /** 0..1 similarity of two short texts (titles, channel names). Tolerates OCR typos and truncated titles. */
  function matchScore(a, b) {
    var ta = unique(tokenize(a).filter(function (t) { return t.length > 1; }));
    var tb = unique(tokenize(b).filter(function (t) { return t.length > 1; }));
    if (!ta.length || !tb.length) return 0;
    var m = ta.filter(function (x) { return tb.some(function (y) { return within1(x, y); }); }).length;
    var jac = m / (ta.length + tb.length - m);
    if (Math.min(ta.length, tb.length) >= 3) return Math.max(jac, 0.95 * m / Math.min(ta.length, tb.length));
    return jac;
  }

  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; }), h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  function mean(nums) { return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : 0; }
  function pct(n, d) { return d ? Math.round(100 * n / d) : 0; }

  // ---------- channel input ----------
  /**
   * What did the user paste? Returns
   *   { type: 'id', id } | { type: 'handle', handle } | { type: 'video', id } | { type: 'query', q } | null
   */
  function parseChannelInput(str) {
    var s = String(str == null ? '' : str).trim();
    if (!s) return null;
    if (/^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be)(\/|$)/i.test(s)) {
      var u;
      try { u = new URL(/^https?:/i.test(s) ? s : 'https://' + s); } catch (e) { return { type: 'query', q: s }; }
      var parts = u.pathname.split('/').filter(Boolean);
      if (/youtu\.be$/i.test(u.hostname) && parts[0]) return { type: 'video', id: parts[0] };
      if (u.searchParams.get('v')) return { type: 'video', id: u.searchParams.get('v') };
      if (parts[0] && /^@/.test(parts[0])) return { type: 'handle', handle: decodeURIComponent(parts[0]) };
      if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { type: 'id', id: parts[1] };
      if (/^(shorts|live|embed)$/.test(parts[0]) && parts[1]) return { type: 'video', id: parts[1] };
      if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { type: 'query', q: decodeURIComponent(parts[1]) };
      return { type: 'query', q: s };
    }
    if (/^@[\w.\-]{3,}$/.test(s)) return { type: 'handle', handle: s };
    if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', id: s };
    return { type: 'query', q: s };
  }

  // ---------- channels ----------
  function parseChannelKeywords(str) {
    var out = [], re = /"([^"]+)"|(\S+)/g, m;
    while ((m = re.exec(String(str || '')))) out.push(m[1] || m[2]);
    return out;
  }

  /** channels.list item (snippet, statistics, brandingSettings) -> plain channel object. */
  function buildChannel(c) {
    var sn = c.snippet || {}, st = c.statistics || {}, br = (c.brandingSettings || {}).channel || {};
    var hidden = !!st.hiddenSubscriberCount, subs = hidden ? null : parseInt(st.subscriberCount, 10);
    var th = sn.thumbnails || {};
    return {
      id: c.id, title: sn.title || '', handle: /^@/.test(sn.customUrl || '') ? sn.customUrl : '',
      description: sn.description || '', thumb: (th.medium || th.default || th.high || {}).url || '',
      subs: isNaN(subs) ? null : subs, hiddenSubs: hidden,
      views: parseInt(st.viewCount, 10) || 0, videos: parseInt(st.videoCount, 10) || 0,
      publishedAt: sn.publishedAt || '', country: sn.country || '',
      keywords: parseChannelKeywords(br.keywords), url: 'https://www.youtube.com/channel/' + c.id
    };
  }

  /** Every channel's uploads live in a hidden playlist: UC... -> UU... (1 quota unit to list, vs 100 for search). */
  function uploadsPlaylist(channelId) {
    return /^UC/.test(channelId || '') ? 'UU' + channelId.slice(2) : null;
  }

  // ---------- performance stats ----------
  /** Newest videos old enough that their view count has mostly settled. */
  function settled(rows, now, minDays) {
    now = now || Date.now(); minDays = minDays == null ? 2 : minDays;
    var s = rows.filter(function (r) { return OF.ageDays(r.publishedAt, now) >= minDays; });
    return s.length >= 5 ? s : rows;
  }

  /**
   * Is the channel speeding up? Median views of the newest settled videos vs the ones before them.
   * Needs 6+ videos. Heuristic: views depend on age, so videos under 2 days old are ignored.
   */
  function momentum(rows, now) {
    now = now || Date.now();
    var el = rows.filter(function (r) { return OF.ageDays(r.publishedAt, now) >= 2; })
      .sort(function (a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt); });
    if (el.length < 6) return { trend: 'unknown', ratio: null };
    var half = Math.min(5, el.length >> 1);
    var recent = median(el.slice(0, half).map(function (r) { return r.views; }));
    var prior = median(el.slice(half, half * 2).map(function (r) { return r.views; }));
    if (!prior) return { trend: 'unknown', ratio: null };
    var ratio = recent / prior;
    return { trend: ratio >= 1.25 ? 'rising' : ratio <= 0.8 ? 'cooling' : 'steady', ratio: ratio };
  }

  /** Uploads per 30 days, measured from the oldest video listed up to now (so a dormant channel scores low). */
  function uploadsPerMonth(rows, now) {
    if (rows.length < 2) return null;
    now = now || Date.now();
    var oldest = Math.min.apply(null, rows.map(function (r) { return new Date(r.publishedAt).getTime(); }));
    return rows.length / Math.max((now - oldest) / DAY, 7) * 30;
  }

  /** views ÷ the channel's median. 1 = typical, 5 = five times its usual. */
  function breakoutRatio(row, medianViews) { return medianViews > 0 ? row.views / medianViews : null; }

  /** Summary numbers for one channel from its recent uploads (rows newest first). */
  function channelStats(rows, channel, now) {
    now = now || Date.now();
    var recent = rows.slice(0, 10), st = settled(rows, now);
    var med = median(st.slice(0, 10).map(function (r) { return r.views; }));
    var best = null;
    rows.forEach(function (r) {
      var b = breakoutRatio(r, med);
      if (b != null && (!best || b > best.ratio)) best = { row: r, ratio: b };
    });
    var subs = channel && channel.subs;
    return {
      count: rows.length, medianViews: med, meanViews: mean(recent.map(function (r) { return r.views; })),
      viewsToSubs: subs ? med / subs : null, perMonth: uploadsPerMonth(rows, now),
      shortShare: rows.length ? rows.filter(OF.rowIsShort).length / rows.length : 0,
      momentum: momentum(rows, now), best: best
    };
  }

  // ---------- patterns ----------
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** Top words / two-word phrases by number of titles they appear in (2+ titles required). */
  function topTerms(titles, n, phrases) {
    var docs = {};
    titles.forEach(function (t) {
      var words = tokenize(t), seen = {};
      if (phrases) {
        for (var i = 0; i < words.length - 1; i++) {
          if (STOP[words[i]] || STOP[words[i + 1]] || words[i].length < 3 || words[i + 1].length < 3) continue;
          var p = words[i] + ' ' + words[i + 1];
          if (!seen[p]) { seen[p] = 1; docs[p] = (docs[p] || 0) + 1; }
        }
      } else {
        keywords(t).forEach(function (w) { if (!seen[w]) { seen[w] = 1; docs[w] = (docs[w] || 0) + 1; } });
      }
    });
    return Object.keys(docs).filter(function (k) { return docs[k] >= 2; })
      .map(function (k) { return { term: k, count: docs[k] }; })
      .sort(function (a, b) { return b.count - a.count || (a.term < b.term ? -1 : 1); }).slice(0, n);
  }

  /** What do these winning videos have in common? Returns numbers plus plain-English insights. */
  function analyzePatterns(rows) {
    var n = rows.length;
    if (!n) return null;
    var titles = rows.map(function (r) { return r.title || ''; });
    var share = function (re) { return pct(titles.filter(function (t) { return re.test(t); }).length, n); };
    var out = {
      n: n,
      numbers: share(/\d/), question: share(/\?/), caps: share(/\b[A-Z]{3,}\b/), brackets: share(/[\[(【]/),
      emoji: share(/\p{Extended_Pictographic}/u), howto: share(/^\s*how\b/i),
      medianTitleLen: Math.round(median(titles.map(function (t) { return t.length; }))),
      shortShare: pct(rows.filter(OF.rowIsShort).length, n),
      medianSubs: median(rows.filter(function (r) { return r.subs != null; }).map(function (r) { return r.subs; })),
      words: topTerms(titles, 8, false), phrases: topTerms(titles, 6, true), bestDay: null
    };
    var longDur = rows.filter(function (r) { return !OF.rowIsShort(r) && r.duration; }).map(function (r) { return r.duration; });
    out.medianLongDuration = longDur.length ? median(longDur) : null;
    var small = rows.filter(function (r) { return r.subs != null; });
    out.smallShare = pct(small.filter(function (r) { return r.subs < 10000; }).length, small.length);
    if (n >= 10) {
      var days = [0, 0, 0, 0, 0, 0, 0];
      rows.forEach(function (r) { days[new Date(r.publishedAt).getUTCDay()]++; });
      var top = days.indexOf(Math.max.apply(null, days));
      if (days[top] / n >= 0.22) out.bestDay = { name: WEEKDAYS[top], share: pct(days[top], n) };
    }

    var ins = [];
    if (out.shortShare >= 60) ins.push({ icon: '📱', text: out.shortShare + '% are Shorts. Vertical, quick-hit videos dominate this list.' });
    else if (out.shortShare <= 15) ins.push({ icon: '🎬', text: 'Mostly long-form' + (out.medianLongDuration ? ', typically around ' + OF.formatDuration(Math.round(out.medianLongDuration)) : '') + '.' });
    else ins.push({ icon: '🎞️', text: 'A mix: ' + out.shortShare + '% Shorts, ' + (100 - out.shortShare) + '% long-form.' });
    if (out.numbers >= 40) ins.push({ icon: '🔢', text: out.numbers + '% of titles contain a number (lists, dollar amounts, days).' });
    if (out.question >= 25) ins.push({ icon: '❓', text: out.question + '% of titles are phrased as a question.' });
    if (out.howto >= 20) ins.push({ icon: '🛠️', text: out.howto + '% of titles start with “How”.' });
    if (out.caps >= 25) ins.push({ icon: '🔠', text: out.caps + '% use an ALL-CAPS word for emphasis.' });
    if (out.brackets >= 20) ins.push({ icon: '🏷️', text: out.brackets + '% add a bracketed tag like (2026) or [Full Guide].' });
    if (out.phrases.length) ins.push({ icon: '🔁', text: '“' + out.phrases[0].term + '” shows up in ' + out.phrases[0].count + ' titles.' });
    ins.push({ icon: '✍️', text: 'Median title length is ' + out.medianTitleLen + ' characters.' });
    if (out.smallShare >= 50) ins.push({ icon: '🌱', text: out.smallShare + '% come from channels under 10K subscribers.' });
    if (out.bestDay) ins.push({ icon: '📅', text: out.bestDay.share + '% were posted on a ' + out.bestDay.name + ' (UTC).' });
    out.insights = ins.slice(0, 7);
    return out;
  }

  // ---------- topics & similarity ----------
  /** Weighted terms describing what a channel is about: title words, tags (x0.5), channel keywords (x3). */
  function topicProfile(rows, channel) {
    var w = {};
    var add = function (t, x) { w[t] = (w[t] || 0) + x; };
    rows.forEach(function (r) {
      unique(keywords(r.title)).forEach(function (t) { add(t, 1); });
      (r.tags || []).forEach(function (tag) { unique(keywords(tag)).forEach(function (t) { add(t, 0.5); }); });
    });
    if (channel) {
      (channel.keywords || []).forEach(function (k) { unique(keywords(k)).forEach(function (t) { add(t, 3); }); });
      unique(keywords(channel.description)).forEach(function (t) { add(t, 0.5); });
    }
    return Object.keys(w).map(function (t) { return { term: t, weight: w[t] }; })
      .sort(function (a, b) { return b.weight - a.weight || (a.term < b.term ? -1 : 1); }).slice(0, 14);
  }

  /** Short search phrases from the strongest terms: "a b", "a c", "b c"... */
  function topicQueries(terms, n) {
    var t = terms.slice(0, 6).map(function (x) { return x.term; }), out = [];
    for (var j = 1; j < t.length && out.length < n; j++)
      for (var i = 0; i < j && out.length < n; i++) out.push(t[i] + ' ' + t[j]);
    if (!out.length && t.length) out.push(t[0]);
    return out;
  }

  /** Rough 0..1 topic overlap between a profile and some text. A ranking aid, not a probability. */
  function similarityScore(terms, text) {
    var set = {};
    keywords(text).forEach(function (t) { set[t] = 1; });
    var top = terms.slice(0, 8), total = 0, hit = 0;
    top.forEach(function (x) { total += x.weight; if (set[x.term]) hit += x.weight; });
    return total ? Math.min(0.99, 1.5 * hit / total) : 0;
  }

  function sharedTerms(terms, text, n) {
    var set = {};
    keywords(text).forEach(function (t) { set[t] = 1; });
    return terms.filter(function (x) { return set[x.term]; }).slice(0, n || 4).map(function (x) { return x.term; });
  }

  // ---------- screenshot text ----------
  var UI_WORDS = {};
  ('subscribe subscribed subscribers subscriber share download save like likes dislike reply replies comment comments shorts home ' +
   'subscriptions library history trending explore you create notification notifications search more show less clip thanks join sort by ' +
   'top newest first video videos playlist playlists about live post posts ad ads sponsored skip up next autoplay settings watch later ' +
   'remix hype report description transcript chapter chapters and')
    .split(' ').forEach(function (w) { UI_WORDS[w] = 1; });
  /** A line made only of interface words ("Share Download Save", "Top comments") is not a channel or title. */
  function isUiLine(t) {
    var w = tokenize(t), ui = w.filter(function (x) { return UI_WORDS[x]; }).length;
    return !!w.length && (ui === w.length || (ui >= 2 && ui / w.length >= 0.6)); // tolerates OCR-mangled button labels
  }

  function extractHandles(text) {
    var out = [], re = /(^|[^\w@])(@[A-Za-z0-9][\w.\-]{2,29})/g, m;
    while ((m = re.exec(String(text || '')))) out.push(m[2].replace(/[.\-]+$/, ''));
    return unique(out);
  }

  /** "12.3K subscribers" in the text -> 12300, else null. */
  function parseSubHint(text) {
    var m = /(\d[\d.,]*\s*[KMBkmb]?)\s*subscribers?/i.exec(String(text || ''));
    if (!m) return null;
    var n = OF.parseCount(m[1].replace(/\s+/g, ''));
    return isNaN(n) || n === Infinity ? null : n;
  }

  /** Drop stray one-character tokens (OCR specks like "O" or "¢") and, for channel rows, button words at the line's edges. */
  function edgeTrim(t, dropUi) {
    var w = String(t || '').split(' ').filter(Boolean);
    var junk = function (x) { return (x.length === 1 && !/[IiAa0-9]/.test(x)) || /^[oO0]{1,2}$/.test(x) || (dropUi && UI_WORDS[x.toLowerCase().replace(/[^\p{L}]/gu, '')]); };
    while (w.length > 1 && junk(w[0])) w.shift();
    while (w.length > 1 && junk(w[w.length - 1])) w.pop();
    return w.join(' ');
  }

  /** Strip view counts, timestamps, "3 days ago" and icon junk from one OCR line. */
  function cleanLine(raw) {
    var t = String(raw || '').replace(/[|•·●▪◦►▶»«©®™]/g, ' ');
    t = t.replace(/\b\d[\d.,]*\s*[KMBkmb]?\s*(views?|watching|subscribers?|likes?|comments?)\b/gi, ' ');
    t = t.replace(/\b(streamed\s+|premiered\s+)?\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/gi, ' ');
    t = t.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
    t = t.replace(/(^|\s)@[\w.\-]+/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return edgeTrim(t.replace(/^[^\p{L}\p{N}#]+/u, '').replace(/[^\p{L}\p{N}?!)\]'"”.…]+$/u, '').trim(), false);
  }

  function acceptable(t) {
    if (!t) return false;
    var letters = (t.match(/\p{L}/gu) || []).length;
    if (letters < 4 || letters / t.length < 0.6 || isUiLine(t)) return false;
    return tokenize(t).some(function (w) { return w.length >= 3; });
  }

  /**
   * Turn raw OCR text from a screenshot into search hints:
   * handles (@name), subscriber-count hint, likely channel-name lines, likely title lines.
   */
  function ocrCandidates(text) {
    var raw = String(text || '').split(/\r?\n/);
    var stop = raw.findIndex(function (l) { return /^\s*comments?\b/i.test(l); });
    if (stop >= 2) raw = raw.slice(0, stop); // everything below "Comments" is other people's text
    var cleaned = raw.map(cleanLine);
    var handles = extractHandles(text), subHint = parseSubHint(text);
    var adjacent = [], channelish = [], titleish = [];
    var isAnchor = function (l) { return /subscribers?\b/i.test(l) || /(^|[^\w@])@[A-Za-z0-9][\w.\-]{2,}/.test(l); };
    raw.forEach(function (line, i) {
      if (!isAnchor(line)) return;
      var here = edgeTrim(cleaned[i], true), prev = cleaned[i - 1];
      if (acceptable(here) && here.split(' ').length <= 5) adjacent.push(here);
      else if (acceptable(prev) && prev.split(' ').length <= 5) adjacent.push(prev);
    });
    // A long title wraps onto a second line: glue the continuation back on.
    var blocks = [], wc = function (x) { return x.split(' ').length; };
    for (var k = 0; k < cleaned.length; k++) {
      var cur = cleaned[k], nx = cleaned[k + 1];
      if (acceptable(cur) && !isAnchor(raw[k]) && wc(cur) >= 5 && !/[.!?:]$/.test(cur) && nx && acceptable(nx) && !isAnchor(raw[k + 1]) && wc(nx) <= 6) { cur += ' ' + nx; k++; }
      blocks.push(cur);
    }
    blocks.forEach(function (t) {
      if (!acceptable(t) || adjacent.indexOf(t) >= 0) return;
      var words = t.split(' ').length;
      if (words >= 4 || t.length >= 28) titleish.push(t); else channelish.push(t);
    });
    var byWords = function (a, b) { return b.split(' ').length - a.split(' ').length || b.length - a.length; };
    titleish = unique(titleish).sort(byWords).slice(0, 3);
    var channelLines = unique(adjacent.concat(unique(channelish).sort(function (a, b) { return b.length - a.length; }))).slice(0, 3);
    return {
      handles: handles.slice(0, 3), subHint: subHint, channelLines: channelLines, titleLines: titleish,
      queries: handles.slice(0, 3).concat(channelLines.map(function (l) { return 'channel: ' + l; }), titleish.map(function (l) { return 'title: ' + l; }))
    };
  }

  /** Parse the editable "what to search for" box back into { handles, channelLines, titleLines }. */
  function parseQueryLines(text) {
    var out = { handles: [], channelLines: [], titleLines: [] };
    String(text || '').split(/\r?\n/).forEach(function (l) {
      l = l.trim();
      if (!l) return;
      var m = /^(channel|title)\s*:\s*(.+)$/i.exec(l);
      if (m) { (m[1].toLowerCase() === 'channel' ? out.channelLines : out.titleLines).push(m[2].trim()); return; }
      if (/^@[\w.\-]{3,}$/.test(l)) out.handles.push(l);
      else if (l.split(/\s+/).length <= 4) out.channelLines.push(l);
      else out.titleLines.push(l);
    });
    return out;
  }

  /**
   * Combine evidence into ranked channel guesses.
   * evidence: [{ channelId, kind: 'handle'|'title'|'name', score (0..1), line }]
   * channels: { channelId: channel } for the subscriber cross-check.
   */
  function rankCandidates(evidence, subHint, channels) {
    var by = {};
    evidence.forEach(function (e) {
      var c = by[e.channelId] || (by[e.channelId] = { channelId: e.channelId, best: {}, reasons: [] });
      var conf = e.kind === 'handle' ? 0.97
        : e.kind === 'title' ? (e.score >= 0.6 ? 0.45 + 0.45 * e.score : 0.15 + 0.3 * e.score)
        : (e.score >= 0.5 ? 0.25 + 0.6 * e.score : 0.1 * e.score);
      if (!c.best[e.kind] || conf > c.best[e.kind].conf) c.best[e.kind] = { conf: conf, line: e.line };
    });
    return Object.keys(by).map(function (id) {
      var c = by[id], miss = 1, reasons = [];
      Object.keys(c.best).forEach(function (k) {
        miss *= 1 - c.best[k].conf;
        if (k === 'handle') reasons.push('Handle ' + c.best[k].line + ' matches');
        else if (k === 'title') reasons.push('Has a video titled like “' + c.best[k].line + '”');
        else reasons.push('Name looks like “' + c.best[k].line + '”');
      });
      var p = 1 - miss, ch = channels && channels[id];
      if (subHint && ch && ch.subs) {
        var ratio = ch.subs / subHint;
        if (ratio >= 0.75 && ratio <= 1.33) { p = Math.min(0.99, p + 0.08); reasons.push('Subscriber count matches ~' + OF.formatCount(subHint)); }
        else if (ratio > 3 || ratio < 1 / 3) p *= 0.75;
      }
      if (!c.best.handle) p = Math.min(p, 0.97);
      return { channelId: id, confidence: Math.round(p * 100) / 100, reasons: reasons };
    }).sort(function (a, b) { return b.confidence - a.confidence; });
  }

  // ---------- snapshots (daily history kept in the browser) ----------
  var MAX_SNAPS = 400;

  /** Append a snapshot, keeping at most one per UTC day (the newest wins). Returns a new array. */
  function addSnapshot(snaps, snap) {
    var out = (snaps || []).slice(), last = out[out.length - 1];
    if (last && Math.floor(last.t / DAY) === Math.floor(snap.t / DAY)) out[out.length - 1] = snap; else out.push(snap);
    return out.slice(-MAX_SNAPS);
  }

  /** Change between consecutive snapshots, per day. */
  function dailyDeltas(snaps) {
    var out = [];
    for (var i = 1; i < (snaps || []).length; i++) {
      var a = snaps[i - 1], b = snaps[i], days = Math.max((b.t - a.t) / DAY, 0.04);
      out.push({
        t: b.t, subs: b.subs, views: b.views, dSubs: b.subs - a.subs, dViews: b.views - a.views,
        subsPerDay: (b.subs - a.subs) / days, viewsPerDay: (b.views - a.views) / days, days: days
      });
    }
    return out;
  }

  /** Terms that keep showing up in titles of videos that beat their channel's usual (ratio >= minRatio). */
  function risingTopics(rows, n) { return topTerms(rows.map(function (r) { return r.title; }), n || 8, false); }

  return {
    tokenize: tokenize, keywords: keywords, within1: within1, matchScore: matchScore, median: median, mean: mean,
    parseChannelInput: parseChannelInput, parseChannelKeywords: parseChannelKeywords, buildChannel: buildChannel,
    uploadsPlaylist: uploadsPlaylist, momentum: momentum, uploadsPerMonth: uploadsPerMonth, breakoutRatio: breakoutRatio,
    channelStats: channelStats, settled: settled, topTerms: topTerms, analyzePatterns: analyzePatterns,
    topicProfile: topicProfile, topicQueries: topicQueries, similarityScore: similarityScore, sharedTerms: sharedTerms,
    extractHandles: extractHandles, parseSubHint: parseSubHint, cleanLine: cleanLine, ocrCandidates: ocrCandidates,
    parseQueryLines: parseQueryLines, rankCandidates: rankCandidates, addSnapshot: addSnapshot, dailyDeltas: dailyDeltas,
    risingTopics: risingTopics
  };
});
