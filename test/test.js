const assert = require('assert');
const OF = require('../lib.js');
const mock = require('./mock-data.json');
const now = Date.parse(mock.now);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('parseDuration', () => {
  assert.strictEqual(OF.parseDuration('PT45S'), 45);
  assert.strictEqual(OF.parseDuration('PT12M5S'), 725);
  assert.strictEqual(OF.parseDuration('PT1H2M3S'), 3723);
  assert.strictEqual(OF.parseDuration('P1DT1H'), 90000);
  assert.strictEqual(OF.parseDuration('PT0S'), 0);
  assert.strictEqual(OF.parseDuration('garbage'), 0);
  assert.strictEqual(OF.parseDuration(undefined), 0);
});
t('formatDuration / formatCount / formatScore / formatAge', () => {
  assert.strictEqual(OF.formatDuration(45), '0:45');
  assert.strictEqual(OF.formatDuration(725), '12:05');
  assert.strictEqual(OF.formatDuration(3723), '1:02:03');
  assert.strictEqual(OF.formatCount(999), '999');
  assert.strictEqual(OF.formatCount(1234), '1.2K');
  assert.strictEqual(OF.formatCount(50000), '50K');
  assert.strictEqual(OF.formatCount(1500000), '1.5M');
  assert.strictEqual(OF.formatScore(87), '87x');
  assert.strictEqual(OF.formatScore(3.456), '3.5x');
  assert.strictEqual(OF.formatAge(0.5), 'today');
  assert.strictEqual(OF.formatAge(10), '10d ago');
  assert.strictEqual(OF.formatAge(65), '2mo ago');
  assert.strictEqual(OF.formatAge(800), '2y ago');
});
t('outlierScore uses subscriber floor of 100', () => {
  assert.strictEqual(OF.outlierScore(87000, 1000), 87);
  assert.strictEqual(OF.outlierScore(2000, 3), 20);
  assert.strictEqual(OF.outlierScore(500, 0), 5);
});
t('viewsPerDay floors age at 1 day', () => {
  assert.strictEqual(OF.viewsPerDay(8700, 10), 870);
  assert.strictEqual(OF.viewsPerDay(500, 0.2), 500);
});
t('parseCount', () => {
  assert.strictEqual(OF.parseCount('50k'), 50000);
  assert.strictEqual(OF.parseCount('1.5M'), 1500000);
  assert.strictEqual(OF.parseCount('2,000'), 2000);
  assert.strictEqual(OF.parseCount(''), Infinity);
  assert.ok(isNaN(OF.parseCount('abc')));
});
t('buildRows: scoring, hidden subs, filters', () => {
  const r = OF.buildRows(mock.videos, mock.channels, { now, maxSubs: 50000, minViews: 1000 });
  assert.strictEqual(r.hiddenSubs, 1);
  assert.deepStrictEqual(r.rows.map(x => x.id).sort(), ['vidShort', 'vidSmallHit', 'vidZeroSubs']);
  assert.strictEqual(r.filtered, 1); // big channel
  const hit = r.rows.find(x => x.id === 'vidSmallHit');
  assert.strictEqual(hit.score, 87);
  assert.strictEqual(hit.duration, 725);
  assert.strictEqual(Math.round(hit.ageDays), 10);
  assert.strictEqual(Math.round(hit.viewsPerDay), 8700);
  assert.strictEqual(hit.url, 'https://www.youtube.com/watch?v=vidSmallHit');
  assert.strictEqual(r.rows.find(x => x.id === 'vidZeroSubs').score, 20);
});
t('buildRows: shorts vs long-form and min views', () => {
  const s = OF.buildRows(mock.videos, mock.channels, { now, type: 'short' });
  assert.deepStrictEqual(s.rows.map(x => x.id), ['vidShort']);
  const l = OF.buildRows(mock.videos, mock.channels, { now, type: 'long', minViews: 10000 });
  assert.deepStrictEqual(l.rows.map(x => x.id).sort(), ['vidBigChan', 'vidSmallHit']);
});
t('sortRows', () => {
  const rows = OF.buildRows(mock.videos, mock.channels, { now }).rows;
  assert.strictEqual(OF.sortRows(rows, 'score')[0].id, 'vidSmallHit');
  assert.strictEqual(OF.sortRows(rows, 'views')[0].id, 'vidBigChan');
  assert.strictEqual(OF.sortRows(rows, 'newest')[0].id, 'vidShort');
  assert.strictEqual(OF.sortRows(rows, 'vpd')[0].id, 'vidBigChan');
});
t('mergeRows de-duplicates', () => {
  const rows = OF.buildRows(mock.videos, mock.channels, { now }).rows;
  assert.strictEqual(OF.mergeRows(rows, rows).length, rows.length);
});
t('CSV escaping and formula guard', () => {
  const rows = OF.buildRows(mock.videos, mock.channels, { now, maxSubs: 50000 }).rows;
  const lines = OF.toCSV(OF.sortRows(rows, 'score')).split('\n');
  assert.strictEqual(lines[0].split(',')[0], 'Title');
  assert.ok(lines[1].startsWith('"How I built a desk, ""cheap"""'));
  assert.ok(OF.toCSV(rows).includes("'=SUM(1,1) quick tip")); // guarded, and quoted due to comma
  assert.strictEqual(OF.csvCell('a\nb'), '"a\nb"');
});
t('describeApiError', () => {
  assert.match(OF.describeApiError(mock.apiErrors.quota.status, mock.apiErrors.quota.body), /quota exceeded/i);
  assert.match(OF.describeApiError(mock.apiErrors.badKey.status, mock.apiErrors.badKey.body), /invalid/i);
  assert.match(OF.describeApiError(500, {}), /500/);
});
t('chunk batches of 50', () => {
  const ids = Array.from({ length: 120 }, (_, i) => i);
  assert.deepStrictEqual(OF.chunk(ids, 50).map(c => c.length), [50, 50, 20]);
});
t('niches are well-formed and unique', () => {
  assert.ok(OF.NICHES.length >= 10);
  const names = new Set(OF.NICHES.map(x => x.name)), qs = new Set(OF.NICHES.map(x => x.q));
  assert.strictEqual(names.size, OF.NICHES.length);
  assert.strictEqual(qs.size, OF.NICHES.length);
  OF.NICHES.forEach(x => assert.ok(x.name && x.icon && x.q.trim()));
});
t('niches reference a known category and rpm tier', () => {
  const cats = new Set(OF.NICHE_CATS.map(c => c.id));
  OF.NICHES.forEach(x => { assert.ok(cats.has(x.cat), x.name); assert.ok([1, 2, 3].includes(x.rpm), x.name); });
  OF.NICHE_CATS.forEach(c => assert.ok(OF.NICHES.some(x => x.cat === c.id), c.id));
});
t('preview embed is muted, inline and skips intros', () => {
  assert.strictEqual(OF.previewStart(45), 0);
  assert.strictEqual(OF.previewStart(600), 120);
  assert.strictEqual(OF.previewStart(300), 60);
  const u = new URL(OF.previewEmbed('abc123', 300));
  assert.strictEqual(u.origin + u.pathname, 'https://www.youtube-nocookie.com/embed/abc123');
  ['autoplay', 'mute', 'playsinline', 'loop'].forEach(k => assert.strictEqual(u.searchParams.get(k), '1'));
  assert.strictEqual(u.searchParams.get('playlist'), 'abc123');
  assert.strictEqual(u.searchParams.get('start'), '60');
});
t('scoreTier', () => {
  assert.strictEqual(OF.scoreTier(150), 'legendary');
  assert.strictEqual(OF.scoreTier(30), 'hot');
  assert.strictEqual(OF.scoreTier(6), 'warm');
  assert.strictEqual(OF.scoreTier(1.2), 'mild');
});
const vid = (id, dur, extra = {}) => ({ id, snippet: Object.assign({ channelId: 'chSmall', channelTitle: 'T', title: 'clip ' + id, publishedAt: '2026-09-20T00:00:00Z' }, extra.snippet),
  statistics: { viewCount: '50000' }, contentDetails: { duration: dur }, player: extra.player });
const tall = { embedWidth: '405', embedHeight: '720' }, wide = { embedWidth: 1280, embedHeight: 720 };
t('classifyFormat: shape decides up to 3 minutes', () => {
  assert.deepStrictEqual(OF.classifyFormat(vid('a', 'PT2M30S', { player: tall })), { isShort: true, signal: 'shape' });
  assert.deepStrictEqual(OF.classifyFormat(vid('b', 'PT45S', { player: wide })), { isShort: false, signal: 'shape' });
  assert.deepStrictEqual(OF.classifyFormat(vid('c', 'PT3M', { player: tall })), { isShort: true, signal: 'shape' });
});
t('classifyFormat: over 3 minutes is never a Short, even if vertical', () => {
  assert.deepStrictEqual(OF.classifyFormat(vid('d', 'PT3M1S', { player: tall })), { isShort: false, signal: 'length' });
  assert.strictEqual(OF.classifyFormat(vid('e', 'P0D')).isShort, false); // live / unknown length
});
t('classifyFormat: no shape falls back to #shorts tag, then 60s', () => {
  assert.deepStrictEqual(OF.classifyFormat(vid('f', 'PT2M', { snippet: { title: 'wow #Shorts' } })), { isShort: true, signal: 'tag' });
  assert.strictEqual(OF.classifyFormat(vid('g', 'PT2M', { snippet: { tags: ['shorts'] } })).isShort, true);
  assert.strictEqual(OF.classifyFormat(vid('h', 'PT2M', { snippet: { title: '#shortstory time' } })).isShort, false);
  assert.strictEqual(OF.classifyFormat(vid('i', 'PT50S')).isShort, true);
  assert.strictEqual(OF.classifyFormat(vid('j', 'PT2M')).isShort, false);
});
t('buildRows: format filters and length buckets', () => {
  const vids = [vid('s150', 'PT2M30S', { player: tall }), vid('w90', 'PT1M30S', { player: wide }),
    vid('m10', 'PT10M', { player: wide }), vid('x45', 'PT45M', { player: wide })];
  const ids = type => OF.buildRows(vids, mock.channels, { now, type }).rows.map(r => r.id);
  assert.deepStrictEqual(ids('short'), ['s150']);
  assert.deepStrictEqual(ids('long'), ['w90', 'm10', 'x45']);
  assert.deepStrictEqual(ids('long4'), ['w90']);
  assert.deepStrictEqual(ids('long20'), ['m10']);
  assert.deepStrictEqual(ids('longXL'), ['x45']);
  assert.strictEqual(ids('any').length, 4);
  const row = OF.buildRows(vids, mock.channels, { now }).rows[0];
  assert.strictEqual(row.isShort, true);
  assert.strictEqual(row.vertical, true);
  Object.keys(OF.FORMATS).forEach(k => { const a = OF.FORMATS[k].api; assert.ok(!a || ['short', 'medium', 'long'].includes(a)); });
});
t('rowIsShort handles rows saved before detection existed', () => {
  assert.strictEqual(OF.rowIsShort({ duration: 45 }), true);
  assert.strictEqual(OF.rowIsShort({ duration: 90 }), false);
  assert.strictEqual(OF.rowIsShort({ duration: 90, isShort: true }), true);
  assert.strictEqual(OF.rowIsShort({ duration: 0 }), false);
});
console.log(`\n${n} tests passed`);
require('./insights.test.js');
