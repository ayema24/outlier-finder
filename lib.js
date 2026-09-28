/* Pure logic for Outlier Finder. Works in the browser (window.OF) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Niche library. rpm = rough ad-revenue tier (3 = high, 1 = low), from 2026 RPM/CPM roundups. */
  var NICHE_CATS = [
    { id: 'money', name: 'Money & Business', icon: '💸' },
    { id: 'tech', name: 'Tech & AI', icon: '🤖' },
    { id: 'story', name: 'Stories & Mystery', icon: '🕯️' },
    { id: 'learn', name: 'Learn & Explain', icon: '🧠' },
    { id: 'life', name: 'Lifestyle & Health', icon: '🌿' },
    { id: 'make', name: 'Make & Build', icon: '🛠️' },
    { id: 'play', name: 'Gaming & Fun', icon: '🎮' },
    { id: 'formats', name: 'Viral Formats', icon: '🔥' }
  ];
  var NICHES = [
    // money
    { name: 'Personal Finance', icon: '💰', q: 'personal finance investing', cat: 'money', rpm: 3 },
    { name: 'Side Hustles', icon: '🚀', q: 'side hustle make money online', cat: 'money', rpm: 3 },
    { name: 'Real Estate', icon: '🏠', q: 'real estate investing', cat: 'money', rpm: 3 },
    { name: 'Stock Market', icon: '📈', q: 'stock market explained', cat: 'money', rpm: 3 },
    { name: 'Crypto', icon: '🪙', q: 'crypto news bitcoin', cat: 'money', rpm: 3 },
    { name: 'Taxes & Legal', icon: '⚖️', q: 'tax tips explained', cat: 'money', rpm: 3 },
    { name: 'Business Stories', icon: '🏢', q: 'business documentary rise and fall', cat: 'money', rpm: 3 },
    { name: 'Entrepreneurship', icon: '🧑‍💼', q: 'starting a small business', cat: 'money', rpm: 3 },
    { name: 'E-commerce', icon: '🛒', q: 'ecommerce shopify dropshipping', cat: 'money', rpm: 3 },
    { name: 'Careers & Jobs', icon: '💼', q: 'career advice job interview tips', cat: 'money', rpm: 2 },
    { name: 'Frugal Living', icon: '🪙', q: 'frugal living save money tips', cat: 'money', rpm: 2 },
    { name: 'Luxury & Wealth', icon: '💎', q: 'billionaire lifestyle luxury', cat: 'money', rpm: 2 },
    // tech
    { name: 'AI Tools', icon: '🤖', q: 'ai tools tutorial', cat: 'tech', rpm: 3 },
    { name: 'AI Automation', icon: '⚙️', q: 'ai agents automation small business', cat: 'tech', rpm: 3 },
    { name: 'Cybersecurity', icon: '🔐', q: 'cybersecurity online privacy', cat: 'tech', rpm: 3 },
    { name: 'Coding', icon: '💻', q: 'coding tutorial for beginners', cat: 'tech', rpm: 3 },
    { name: 'Software & SaaS', icon: '🧩', q: 'software review productivity apps', cat: 'tech', rpm: 3 },
    { name: 'Tech Reviews', icon: '📱', q: 'tech review smartphone', cat: 'tech', rpm: 2 },
    { name: 'PC Building', icon: '🖥️', q: 'pc build budget gaming pc', cat: 'tech', rpm: 2 },
    { name: 'Tech News', icon: '📰', q: 'tech news this week', cat: 'tech', rpm: 2 },
    { name: 'Excel & Productivity', icon: '📊', q: 'excel tips productivity tricks', cat: 'tech', rpm: 3 },
    // story
    { name: 'True Crime', icon: '🕵️', q: 'true crime documentary', cat: 'story', rpm: 2 },
    { name: 'Horror & Mystery', icon: '👻', q: 'scary stories mystery', cat: 'story', rpm: 1 },
    { name: 'Unsolved Mysteries', icon: '❓', q: 'unsolved mysteries explained', cat: 'story', rpm: 2 },
    { name: 'Conspiracies', icon: '🛸', q: 'conspiracy theory deep dive', cat: 'story', rpm: 1 },
    { name: 'Storytime', icon: '🗣️', q: 'storytime', cat: 'story', rpm: 1 },
    { name: 'Reddit Stories', icon: '📜', q: 'reddit stories aita', cat: 'story', rpm: 1 },
    { name: 'Survival Stories', icon: '🏔️', q: 'survival story i survived', cat: 'story', rpm: 2 },
    { name: 'Disasters', icon: '🌋', q: 'disaster documentary what went wrong', cat: 'story', rpm: 2 },
    { name: 'Internet Drama', icon: '🍿', q: 'youtuber drama explained', cat: 'story', rpm: 1 },
    // learn
    { name: 'Documentaries', icon: '🎬', q: 'documentary', cat: 'learn', rpm: 2 },
    { name: 'History', icon: '🏛️', q: 'history explained', cat: 'learn', rpm: 2 },
    { name: 'Science', icon: '🔬', q: 'science explained', cat: 'learn', rpm: 2 },
    { name: 'Space', icon: '🪐', q: 'space universe explained', cat: 'learn', rpm: 2 },
    { name: 'Geography', icon: '🗺️', q: 'geography countries explained', cat: 'learn', rpm: 2 },
    { name: 'Psychology', icon: '🧩', q: 'psychology facts human behavior', cat: 'learn', rpm: 2 },
    { name: 'Philosophy', icon: '🦉', q: 'philosophy stoicism', cat: 'learn', rpm: 2 },
    { name: 'Video Essays', icon: '🎞️', q: 'video essay analysis', cat: 'learn', rpm: 2 },
    { name: 'Language Learning', icon: '🗣', q: 'learn english language learning', cat: 'learn', rpm: 2 },
    { name: 'Military & Aviation', icon: '✈️', q: 'military aviation history', cat: 'learn', rpm: 2 },
    { name: 'Engineering', icon: '🏗️', q: 'engineering explained how it works', cat: 'learn', rpm: 3 },
    { name: 'Faith & Bible', icon: '🙏', q: 'bible stories explained', cat: 'learn', rpm: 1 },
    // life
    { name: 'Fitness', icon: '💪', q: 'home workout', cat: 'life', rpm: 2 },
    { name: 'Nutrition', icon: '🥗', q: 'nutrition healthy eating tips', cat: 'life', rpm: 2 },
    { name: 'Health & Longevity', icon: '🫀', q: 'longevity health tips doctor', cat: 'life', rpm: 3 },
    { name: 'Mental Health', icon: '🧘', q: 'anxiety mental health tips', cat: 'life', rpm: 2 },
    { name: 'Self Improvement', icon: '🌱', q: 'self improvement productivity', cat: 'life', rpm: 2 },
    { name: 'Cooking', icon: '🍳', q: 'easy recipes cooking', cat: 'life', rpm: 2 },
    { name: 'Travel', icon: '🧳', q: 'travel vlog', cat: 'life', rpm: 2 },
    { name: 'Cost of Living', icon: '🏙️', q: 'cost of living abroad', cat: 'life', rpm: 2 },
    { name: 'Van & Off-grid', icon: '🚐', q: 'van life off grid living', cat: 'life', rpm: 2 },
    { name: 'Parenting', icon: '🍼', q: 'parenting tips', cat: 'life', rpm: 2 },
    { name: 'Pets', icon: '🐶', q: 'dog training tips', cat: 'life', rpm: 2 },
    { name: 'Skincare & Beauty', icon: '✨', q: 'skincare routine', cat: 'life', rpm: 2 },
    { name: 'Fashion', icon: '👟', q: 'mens fashion style tips', cat: 'life', rpm: 2 },
    { name: 'Minimalism', icon: '🤍', q: 'minimalism declutter', cat: 'life', rpm: 2 },
    { name: 'Ambient & Sleep', icon: '🌙', q: 'rain sounds sleep ambience', cat: 'life', rpm: 1 },
    // make
    { name: 'DIY & Woodworking', icon: '🔨', q: 'diy woodworking build', cat: 'make', rpm: 2 },
    { name: 'Home Renovation', icon: '🧱', q: 'home renovation before after', cat: 'make', rpm: 3 },
    { name: 'Gardening', icon: '🪴', q: 'gardening tips grow vegetables', cat: 'make', rpm: 2 },
    { name: 'Cars', icon: '🚗', q: 'car review', cat: 'make', rpm: 3 },
    { name: 'Car Restoration', icon: '🔧', q: 'car restoration rebuild', cat: 'make', rpm: 2 },
    { name: 'Art & Drawing', icon: '🎨', q: 'drawing tutorial art', cat: 'make', rpm: 1 },
    { name: 'Music Production', icon: '🎛️', q: 'music production', cat: 'make', rpm: 2 },
    { name: 'Guitar & Piano', icon: '🎸', q: 'guitar lesson beginner', cat: 'make', rpm: 2 },
    { name: 'Photo & Video', icon: '📷', q: 'filmmaking photography tips', cat: 'make', rpm: 2 },
    { name: 'Restoration ASMR', icon: '🧽', q: 'restoration asmr', cat: 'make', rpm: 1 },
    { name: '3D Printing', icon: '🖨️', q: '3d printing projects', cat: 'make', rpm: 2 },
    // play
    { name: 'Gaming', icon: '🎮', q: 'gaming', cat: 'play', rpm: 1 },
    { name: 'Minecraft', icon: '⛏️', q: 'minecraft', cat: 'play', rpm: 1 },
    { name: 'Retro Games', icon: '👾', q: 'retro games history', cat: 'play', rpm: 1 },
    { name: 'Game Lore', icon: '📖', q: 'game lore explained', cat: 'play', rpm: 1 },
    { name: 'Speedruns', icon: '⏱️', q: 'speedrun explained', cat: 'play', rpm: 1 },
    { name: 'Chess', icon: '♟️', q: 'chess', cat: 'play', rpm: 2 },
    { name: 'Movies & TV', icon: '🍿', q: 'movie explained ending', cat: 'play', rpm: 2 },
    { name: 'Anime', icon: '🌸', q: 'anime explained', cat: 'play', rpm: 1 },
    { name: 'Sports', icon: '⚽', q: 'sports highlights analysis', cat: 'play', rpm: 2 },
    { name: 'Fishing & Outdoors', icon: '🎣', q: 'fishing', cat: 'play', rpm: 2 },
    { name: 'Collectibles', icon: '🃏', q: 'pokemon cards opening collection', cat: 'play', rpm: 1 },
    // formats
    { name: 'Tier Lists', icon: '🏆', q: 'tier list ranking', cat: 'formats', rpm: 2 },
    { name: 'I Tried…', icon: '🧪', q: 'i tried for 30 days', cat: 'formats', rpm: 2 },
    { name: 'Cheap vs Expensive', icon: '🏷️', q: 'cheap vs expensive', cat: 'formats', rpm: 2 },
    { name: 'Honest Reviews', icon: '⭐', q: 'honest review worth it', cat: 'formats', rpm: 3 },
    { name: 'Day in the Life', icon: '📅', q: 'day in my life', cat: 'formats', rpm: 1 },
    { name: 'Things I Wish I Knew', icon: '💡', q: 'things i wish i knew before', cat: 'formats', rpm: 2 },
    { name: 'Beginner Guides', icon: '🧭', q: 'complete beginners guide', cat: 'formats', rpm: 2 },
    { name: 'Challenges', icon: '🎯', q: '24 hour challenge', cat: 'formats', rpm: 1 },
    { name: 'Reactions', icon: '😲', q: 'reaction', cat: 'formats', rpm: 1 },
    { name: 'Top 10 Lists', icon: '🔟', q: 'top 10', cat: 'formats', rpm: 2 }
  ];

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

  /** Where an inline preview starts: skip intros on long videos, start Shorts at 0. */
  function previewStart(durationSec) {
    if (!durationSec || durationSec < 90) return 0;
    return Math.min(Math.floor(durationSec * 0.2), 120);
  }

  /** Muted, looping, inline YouTube embed used for previews (works on mobile via playsinline). */
  function previewEmbed(id, durationSec) {
    var qs = new URLSearchParams({
      autoplay: 1, mute: 1, controls: 0, playsinline: 1, loop: 1, playlist: id,
      rel: 0, modestbranding: 1, iv_load_policy: 3, disablekb: 1, start: previewStart(durationSec)
    });
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?' + qs;
  }

  /** Full player embed for the in-app lightbox. */
  function playerEmbed(id) {
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1';
  }

  /** Visual tier for a score badge. */
  function scoreTier(score) {
    if (score >= 100) return 'legendary';
    if (score >= 25) return 'hot';
    if (score >= 5) return 'warm';
    return 'mild';
  }

  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  return {
    QUOTA: QUOTA, NICHES: NICHES, NICHE_CATS: NICHE_CATS, parseDuration: parseDuration, formatDuration: formatDuration,
    formatCount: formatCount, formatScore: formatScore, formatAge: formatAge,
    ageDays: ageDays, outlierScore: outlierScore, viewsPerDay: viewsPerDay,
    parseCount: parseCount, buildRows: buildRows, sortRows: sortRows, mergeRows: mergeRows,
    toCSV: toCSV, csvCell: csvCell, describeApiError: describeApiError, chunk: chunk,
    previewStart: previewStart, previewEmbed: previewEmbed, playerEmbed: playerEmbed, scoreTier: scoreTier
  };
});
