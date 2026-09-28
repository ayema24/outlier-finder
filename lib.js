/* Pure logic for Outlier Finder. Works in the browser (window.OF) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUOTA = { search: 100, list: 1 };
  var MIN_SUBS_FLOOR = 100;
  var DAY_MS = 86400000;

  /** ISO 8601 duration (PT1H2M3S, P1DT2H) -> seconds. Returns 0 if unparseable. */
  function parseDuration(iso) {
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }

  function formatDuration(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  /** 1234 -> "1.2K", 1500000 -> "1.5M" */
  function formatCount(n) {
    if (n == null || isNaN(n)) return '–';
    var trim = function (x) { return x.toFixed(x >= 100 ? 0 : 1).replace(/\.0$/, ''); };
    if (n >= 1e9) return trim(n / 1e9) + 'B';
    if (n >= 1e6) return trim(n / 1e6) + 'M';
    if (n >= 1e3) return trim(n / 1e3) + 'K';
    return String(n);
  }

  function formatScore(score) {
    return (score >= 10 ? Math.round(score) : Math.round(score * 10) / 10) + 'x';
  }

  function formatAge(days) {
    if (days < 1) return 'today';
    if (days < 30) return Math.floor(days) + 'd ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  function ageDays(publishedAt, now) {
    return Math.max(0, ((now || Date.now()) - new Date(publishedAt).getTime()) / DAY_MS);
  }

  /** views / max(subs, 100) */
  function outlierScore(views, subs) {
    return views / Math.max(subs, MIN_SUBS_FLOOR);
  }

  /** Views per day; videos under a day old are treated as 1 day to avoid inflated values. */
  function viewsPerDay(views, days) {
    return views / Math.max(days, 1);
  }

  /** Parse "50k", "1.5m", "2,000" -> number. Returns NaN if invalid, Infinity for empty. */
  function parseCount(str) {
    var s = String(str == null ? '' : str).trim().toLowerCase().replace(/,/g, '');
    if (!s) return Infinity;
    var m = /^(\d+(?:\.\d+)?)\s*([kmb]?)$/.exec(s);
    if (!m) return NaN;
    var mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
    return Math.round(parseFloat(m[1]) * mult);
  }

  /**
   * Merge videos.list + channels.list items into result rows.
   * Returns { rows, hiddenSubs, filtered }.
   */
  function buildRows(videoItems, channelItems, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var maxSubs = opts.maxSubs == null ? Infinity : opts.maxSubs;
    var minViews = opts.minViews || 0;
    var type = opts.type || 'any';

    var chans = {};
    (channelItems || []).forEach(function (c) { chans[c.id] = c; });

    var rows = [], hiddenSubs = 0, filtered = 0;
    (videoItems || []).forEach(function (v) {
      var ch = chans[v.snippet.channelId];
      if (!ch || !ch.statistics) { filtered++; return; }
      if (ch.statistics.hiddenSubscriberCount) { hiddenSubs++; return; }
      var subs = parseInt(ch.statistics.subscriberCount, 10);
      var views = parseInt((v.statistics || {}).viewCount, 10);
      if (isNaN(subs) || isNaN(views)) { filtered++; return; }
      var dur = parseDuration(v.contentDetails && v.contentDetails.duration);
      if (type === 'short' && dur >= 60) { filtered++; return; }
      if (type === 'long' && dur < 60) { filtered++; return; }
      if (subs > maxSubs || views < minViews) { filtered++; return; }
      var days = ageDays(v.snippet.publishedAt, now);
      var thumbs = v.snippet.thumbnails || {};
      rows.push({
        id: v.id,
        title: v.snippet.title,
        url: 'https://www.youtube.com/watch?v=' + v.id,
        thumb: (thumbs.medium || thumbs.high || thumbs.default || {}).url || '',
        channelId: v.snippet.channelId,
        channel: v.snippet.channelTitle,
        channelUrl: 'https://www.youtube.com/channel/' + v.snippet.channelId,
        subs: subs,
        views: views,
        score: outlierScore(views, subs),
        viewsPerDay: viewsPerDay(views, days),
        publishedAt: v.snippet.publishedAt,
        ageDays: days,
        duration: dur
      });
    });
    return { rows: rows, hiddenSubs: hiddenSubs, filtered: filtered };
  }

  var SORTERS = {
    score: function (a, b) { return b.score - a.score; },
    views: function (a, b) { return b.views - a.views; },
    vpd: function (a, b) { return b.viewsPerDay - a.viewsPerDay; },
    newest: function (a, b) { return new Date(b.publishedAt) - new Date(a.publishedAt); }
  };

  function sortRows(rows, key) {
    return rows.slice().sort(SORTERS[key] || SORTERS.score);
  }

  /** Add rows to an existing list, de-duplicating by video id. */
  function mergeRows(existing, incoming) {
    var seen = {};
    existing.forEach(function (r) { seen[r.id] = true; });
    return existing.concat(incoming.filter(function (r) { return !seen[r.id]; }));
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var CSV_COLS = [
    ['title', 'Title'], ['url', 'Video URL'], ['channel', 'Channel'], ['channelUrl', 'Channel URL'],
    ['subs', 'Subscribers'], ['views', 'Views'], ['score', 'Score'], ['viewsPerDay', 'Views/day'],
    ['publishedAt', 'Published'], ['duration', 'Duration (s)']
  ];

  function toCSV(rows) {
    var lines = [CSV_COLS.map(function (c) { return c[1]; }).join(',')];
    rows.forEach(function (r) {
      lines.push(CSV_COLS.map(function (c) {
        var v = r[c[0]];
        if (c[0] === 'score' || c[0] === 'viewsPerDay') v = Math.round(v * 100) / 100;
        return csvCell(v);
      }).join(','));
    });
    return lines.join('\n');
  }

  /** Map a YouTube API error response to a user-facing message. */
  function describeApiError(status, body) {
    var err = (body && body.error) || {};
    var reason = ((err.errors || [])[0] || {}).reason || '';
    var msg = err.message || '';
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded')
      return 'API quota exceeded. The daily quota (10,000 units by default) resets at midnight Pacific Time. Try again later.';
    if (reason === 'keyInvalid' || /API key not valid/i.test(msg))
      return 'Your API key is invalid. Check it in Settings.';
    if (reason === 'ipRefererBlocked' || /referer/i.test(msg))
      return 'This API key is restricted and blocks requests from this site. Add this page\'s URL to the key\'s allowed HTTP referrers.';
    if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(msg))
      return 'YouTube Data API v3 is not enabled for this key\'s Google Cloud project. Enable it in the Cloud Console.';
    if (reason === 'badRequest' && /regionCode|region/i.test(msg))
      return 'Invalid region code. Use a 2-letter code such as US or GB.';
    if (status === 400) return 'Bad request' + (msg ? ': ' + msg : '.');
    if (status === 403) return 'Access denied' + (msg ? ': ' + msg : '.');
    return 'YouTube API error (' + status + ')' + (msg ? ': ' + msg : '.');
  }

  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  return {
    QUOTA: QUOTA, parseDuration: parseDuration, formatDuration: formatDuration,
    formatCount: formatCount, formatScore: formatScore, formatAge: formatAge,
    ageDays: ageDays, outlierScore: outlierScore, viewsPerDay: viewsPerDay,
    parseCount: parseCount, buildRows: buildRows, sortRows: sortRows, mergeRows: mergeRows,
    toCSV: toCSV, csvCell: csvCell, describeApiError: describeApiError, chunk: chunk
  };
});
