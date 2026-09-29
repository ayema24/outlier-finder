const assert = require('assert');
const OF = require('../lib.js');
const I = require('../insights.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const NOW = Date.parse('2026-09-28T12:00:00Z'), DAY = 86400000;
const row = (id, title, views, daysAgo, extra = {}) => Object.assign({
  id, title, views, subs: 5000, duration: 600, publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  isShort: false, ageDays: daysAgo, tags: []
}, extra);

t('matchScore forgives OCR typos and truncated titles', () => {
  assert.strictEqual(I.matchScore('Tiny Woodshop', 'Tiny Woodshcp'), 1);
  assert.ok(I.matchScore('How I built a desk from scrap', 'How I built a desk from scrap wood in one weekend') >= 0.9);
  assert.ok(I.matchScore('Tiny Woodshop', 'Mega Media') < 0.2);
  assert.strictEqual(I.matchScore('', 'abc'), 0);
  assert.ok(I.within1('woodshop', 'woodshcp') && !I.within1('cat', 'cut') && !I.within1('woodshop', 'workshop'));
});
t('keywords drops stop words and numbers', () => {
  assert.deepStrictEqual(I.keywords('How I paid off $80k in 2 years with the debt snowball'), ['paid', '80k', 'years', 'debt', 'snowball']);
});
t('parseChannelInput understands links, handles, ids, videos and names', () => {
  const id = 'UC' + 'a'.repeat(22);
  assert.deepStrictEqual(I.parseChannelInput('https://www.youtube.com/@TinyWoodshop/videos'), { type: 'handle', handle: '@TinyWoodshop' });
  assert.deepStrictEqual(I.parseChannelInput('youtube.com/channel/' + id), { type: 'id', id });
  assert.deepStrictEqual(I.parseChannelInput(id), { type: 'id', id });
  assert.deepStrictEqual(I.parseChannelInput('@tiny.woodshop'), { type: 'handle', handle: '@tiny.woodshop' });
  assert.deepStrictEqual(I.parseChannelInput('https://youtu.be/dQw4w9WgXcQ?t=4'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepStrictEqual(I.parseChannelInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), { type: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepStrictEqual(I.parseChannelInput('https://youtube.com/shorts/abcdefghijk'), { type: 'video', id: 'abcdefghijk' });
  assert.deepStrictEqual(I.parseChannelInput('https://www.youtube.com/c/OldName'), { type: 'query', q: 'OldName' });
  assert.deepStrictEqual(I.parseChannelInput('  tiny woodshop '), { type: 'query', q: 'tiny woodshop' });
  assert.strictEqual(I.parseChannelInput('   '), null);
});
t('buildChannel and uploads playlist', () => {
  const c = I.buildChannel({ id: 'UCabc', snippet: { title: 'T', customUrl: '@tiny', thumbnails: { default: { url: 'u' } }, publishedAt: '2020-01-01T00:00:00Z' },
    statistics: { subscriberCount: '1200', viewCount: '99', videoCount: '7' }, brandingSettings: { channel: { keywords: '"wood working" diy' } } });
  assert.strictEqual(c.subs, 1200); assert.strictEqual(c.handle, '@tiny'); assert.deepStrictEqual(c.keywords, ['wood working', 'diy']);
  assert.strictEqual(I.buildChannel({ id: 'x', statistics: { hiddenSubscriberCount: true } }).subs, null);
  assert.strictEqual(I.uploadsPlaylist('UCabc'), 'UUabc');
  assert.strictEqual(I.uploadsPlaylist('nope'), null);
});
t('momentum: rising, cooling, steady, unknown, and ignores very new videos', () => {
  const mk = (views) => views.map((v, i) => row('v' + i, 't', v, 3 + i * 4)); // newest first, 3d, 7d, ...
  assert.strictEqual(I.momentum(mk([900, 800, 1000, 900, 950, 300, 400, 350, 300, 320]), NOW).trend, 'rising');
  assert.strictEqual(I.momentum(mk([300, 320, 300, 280, 310, 900, 800, 1000, 900, 950]), NOW).trend, 'cooling');
  assert.strictEqual(I.momentum(mk([500, 520, 480, 510, 500, 495, 505, 500, 500, 500]), NOW).trend, 'steady');
  assert.strictEqual(I.momentum(mk([500, 520, 480]), NOW).trend, 'unknown');
  const withNew = [row('new', 't', 5, 0.2)].concat(mk([900, 800, 1000, 900, 950, 300, 400, 350, 300, 320]));
  assert.strictEqual(I.momentum(withNew, NOW).trend, 'rising');
});
t('uploadsPerMonth counts from oldest video to now', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row('v' + i, 't', 1, 10 * (i + 1) - 5)); // oldest 95 days
  assert.ok(Math.abs(I.uploadsPerMonth(rows, NOW) - 10 / 95 * 30) < 1e-9);
  assert.strictEqual(I.uploadsPerMonth([row('a', 't', 1, 1)], NOW), null);
  assert.ok(I.uploadsPerMonth([row('a', 't', 1, 1), row('b', 't', 1, 2)], NOW) < 10); // 7-day floor
});
t('channelStats finds the breakout and the views-to-subs ratio', () => {
  const rows = [row('hit', 'big one', 50000, 5)].concat(Array.from({ length: 9 }, (_, i) => row('v' + i, 't', 1000, 10 + i * 5)));
  const s = I.channelStats(rows, { subs: 5000 }, NOW);
  assert.strictEqual(s.medianViews, 1000);
  assert.strictEqual(s.best.row.id, 'hit'); assert.strictEqual(s.best.ratio, 50);
  assert.strictEqual(s.viewsToSubs, 0.2);
  assert.strictEqual(s.count, 10);
});
t('analyzePatterns summarises titles, formats and timing', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(row('v' + i, i % 2 ? 'I saved $' + (i * 1000) + ' with the debt snowball method' : 'Why the debt snowball works (in full)?', 1000 * (i + 1), i + 1,
    { subs: i < 9 ? 4000 : 90000, publishedAt: '2026-09-' + String(22 + (i % 2) * 0).padStart(2, '0') + 'T10:00:00Z', isShort: i < 2, duration: i < 2 ? 40 : 700 }));
  const p = I.analyzePatterns(rows);
  assert.strictEqual(p.n, 12); assert.strictEqual(p.numbers, 50); assert.strictEqual(p.question, 50); assert.strictEqual(p.brackets, 50);
  assert.strictEqual(p.words[0].term, 'debt'); assert.strictEqual(p.phrases[0].term, 'debt snowball');
  assert.strictEqual(p.shortShare, 17); assert.strictEqual(p.smallShare, 75);
  assert.strictEqual(p.bestDay.name, 'Tuesday'); // 22 Sep 2026 is a Tuesday
  assert.ok(p.insights.length >= 4 && p.insights.every(i => i.icon && i.text));
  assert.strictEqual(I.analyzePatterns([]), null);
});
t('topic profile, queries and similarity', () => {
  const rows = ['Sourdough starter for beginners', 'Easy sourdough bread recipe', 'Sourdough discard crackers', 'Bread scoring tips'].map((title, i) => row('s' + i, title, 100, i + 3, { tags: ['sourdough', 'baking'] }));
  const terms = I.topicProfile(rows, { keywords: ['bread baking'], description: 'Home bakery tips' });
  assert.deepStrictEqual(terms.slice(0, 3).map(x => x.term).sort(), ['baking', 'bread', 'sourdough']);
  assert.ok(terms.some(x => x.term === 'bread'));
  const q = I.topicQueries(terms, 2);
  assert.strictEqual(q.length, 2); assert.ok(q.join(' ').includes('sourdough'));
  const hi = I.similarityScore(terms, 'Sourdough bread baking every week'), lo = I.similarityScore(terms, 'Crypto news and trading');
  assert.ok(hi > 0.4 && lo === 0);
  assert.ok(I.sharedTerms(terms, 'sourdough bread lover').includes('sourdough'));
});
const SHOT = `Search
How I built a tiny cabin with $500 and it changed my life
1.2M views  3 days ago
Tiny Woodshop
12.3K subscribers
Subscribe
@tinywoodshop
Share   Download   Save
Top comments
12:05`;
t('ocrCandidates pulls handle, subscriber hint, channel name and title from screenshot text', () => {
  const r = I.ocrCandidates(SHOT);
  assert.deepStrictEqual(r.handles, ['@tinywoodshop']);
  assert.strictEqual(r.subHint, 12300);
  assert.strictEqual(r.channelLines[0], 'Tiny Woodshop');
  assert.strictEqual(r.titleLines[0], 'How I built a tiny cabin with $500 and it changed my life');
  assert.ok(!r.channelLines.concat(r.titleLines).some(l => /views|subscribe|share|comments|12:05/i.test(l)));
  assert.deepStrictEqual(r.queries.slice(0, 2), ['@tinywoodshop', 'channel: Tiny Woodshop']);
});
// Real Tesseract output for a dark-mode phone screenshot (title wraps; mangled "Share"; a comment below).
const REAL = `4.
How | built a tiny cabin with $500 and it
changed my life
1.2M views 3 days ago ...more
Tiny Woodshop ;
@tinywoodshop ¢ 12.3K subscribers Subscribe
45K Like SHEE] Download Save
Comments 1.2K
Love this build, the joinery is so clean!`;
t('ocrCandidates copes with real OCR output: wrapped title, mangled buttons, comments', () => {
  const r = I.ocrCandidates(REAL);
  assert.deepStrictEqual(r.handles, ['@tinywoodshop']);
  assert.deepStrictEqual(r.channelLines, ['Tiny Woodshop']);
  assert.strictEqual(r.titleLines.length, 1);
  assert.match(r.titleLines[0], /tiny cabin with \$500 and it changed my life$/);
  const nohandle = I.ocrCandidates(REAL.replace('@tinywoodshop ¢ ', '').replace('SHEE]', 'SET'));
  assert.deepStrictEqual(nohandle.channelLines, ['Tiny Woodshop']);
  assert.ok(!nohandle.queries.some(q => /Download|Love this build/.test(q)));
});
t('ocrCandidates drops stray specks next to the subscribe button (light mode)', () => {
  const r = I.ocrCandidates('y\nHow | built a tiny cabin with $500 and it\nchanged my life\n1.2M views 3 days ago ...more\n\nTiny Woodshop :\nO 12.3K subscribers Subscribe\n45K Like Share Download Save\nComments 1.2K\n\nLove this build, the joinery is so clean!');
  assert.deepStrictEqual(r.channelLines, ['Tiny Woodshop']);
  assert.strictEqual(r.titleLines.length, 1);
  assert.deepStrictEqual(I.ocrCandidates('Tiny Woodshop\noO 12.3K subscribers Subscribe').channelLines, ['Tiny Woodshop']); // avatar circle read as "oO"
});
t('ocrCandidates ignores email-like text and pure noise', () => {
  assert.deepStrictEqual(I.extractHandles('mail me at bob@example.com or @real_one'), ['@real_one']);
  const r = I.ocrCandidates('|| ~~ \n1.2M views\n0:45\nSubscribe');
  assert.deepStrictEqual([r.channelLines, r.titleLines, r.handles], [[], [], []]);
});
t('parseQueryLines round-trips the editable box', () => {
  const r = I.parseQueryLines('@tinywoodshop\nchannel: Tiny Woodshop\ntitle: How I built a cabin\nTiny Woodshop\nA much longer plain line of words here');
  assert.deepStrictEqual(r.handles, ['@tinywoodshop']);
  assert.deepStrictEqual(r.channelLines, ['Tiny Woodshop', 'Tiny Woodshop']);
  assert.deepStrictEqual(r.titleLines, ['How I built a cabin', 'A much longer plain line of words here']);
});
t('rankCandidates: handle beats fuzzy, subscriber hint nudges, mismatches are penalised', () => {
  const ev = [
    { channelId: 'A', kind: 'handle', score: 1, line: '@tinywoodshop' },
    { channelId: 'B', kind: 'title', score: 0.9, line: 'How I built a cabin' },
    { channelId: 'B', kind: 'name', score: 1, line: 'Tiny Woodshop' },
    { channelId: 'C', kind: 'name', score: 0.5, line: 'Woodshop' }
  ];
  const ranked = I.rankCandidates(ev, 12300, { A: { subs: 12000 }, B: { subs: 9000000 }, C: { subs: 12500 } });
  assert.strictEqual(ranked[0].channelId, 'A'); assert.ok(ranked[0].confidence >= 0.97);
  const b = ranked.find(x => x.channelId === 'B'), c = ranked.find(x => x.channelId === 'C');
  assert.ok(b.confidence < 0.97 && b.confidence > 0.5);
  assert.ok(c.reasons.some(r => /Subscriber count matches/.test(r)));
  assert.ok(ranked.every((x, i) => i === 0 || ranked[i - 1].confidence >= x.confidence));
});
t('snapshots: one per UTC day, deltas per day', () => {
  const s0 = [{ t: NOW - 3 * DAY, subs: 1000, views: 50000, videos: 10 }];
  let s = I.addSnapshot(s0, { t: NOW - 3 * DAY + 3600e3, subs: 1010, views: 50100, videos: 10 });
  assert.strictEqual(s.length, 1); assert.strictEqual(s[0].subs, 1010); // same day: replaced
  s = I.addSnapshot(s, { t: NOW - 1 * DAY, subs: 1210, views: 52100, videos: 11 });
  s = I.addSnapshot(s, { t: NOW, subs: 1250, views: 52600, videos: 11 });
  assert.strictEqual(s.length, 3);
  const d = I.dailyDeltas(s);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].dSubs, 200);
  assert.ok(Math.abs(d[0].subsPerDay - 200 / (2 - 1 / 24)) < 1e-6); // real elapsed time: the replaced snapshot is 1h into day -3
  assert.strictEqual(d[1].dSubs, 40);
  assert.deepStrictEqual(I.dailyDeltas([]), []);
  assert.strictEqual(I.addSnapshot(Array.from({ length: 400 }, (_, i) => ({ t: i * DAY })), { t: 400 * DAY }).length, 400);
});
t('lib: channelRows / rowVph / vph sorting', () => {
  const vids = [
    { id: 'a', snippet: { channelId: 'c', channelTitle: 'C', title: 'A', publishedAt: new Date(NOW - 2 * 3600e3).toISOString(), tags: ['x', 'y'] }, statistics: { viewCount: '4000' }, contentDetails: { duration: 'PT10M' } },
    { id: 'b', snippet: { channelId: 'c', channelTitle: 'C', title: 'B', publishedAt: new Date(NOW - 10 * DAY).toISOString() }, statistics: { viewCount: '40000' }, contentDetails: { duration: 'PT10M' } }
  ];
  const r = OF.channelRows(vids, null, NOW);
  assert.strictEqual(r[0].id, 'a'); assert.strictEqual(r[0].subs, null); assert.strictEqual(r[0].score, null);
  assert.deepStrictEqual(r[0].tags, ['x', 'y']);
  assert.strictEqual(Math.round(r[0].viewsPerHour), 2000);
  assert.strictEqual(OF.sortRows(r, 'vph')[0].id, 'a');
  assert.strictEqual(OF.sortRows([{ id: 'old', views: 10, publishedAt: '2020-01-01' }, { id: 'x', views: 5000, viewsPerHour: 999, publishedAt: '2020-01-01' }], 'vph')[0].id, 'x');
  assert.match(OF.describeApiError(400, { error: { message: 'x', errors: [{ reason: 'videoChartNotFound' }] } }), /trending chart/);
});
console.log(`${n} insight tests passed`);
