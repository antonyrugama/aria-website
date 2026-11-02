/* Unit tests for ops/assets/pane-analytics.js, the Growth page.

   What is worth testing here is the set of rules in that file's docblock, nearly
   all of them rules about NOT drawing something, and none of which a screenshot
   or a headless-Chrome overflow check can see:

     - the headline is the platform's own distinct count and the change is a
       difference in people; the two apps are never added together;
     - a day with no reading is a gap in the line and is named under the chart,
       never a drop to zero; "Week high" is printed only when it is earned; a
       line on other days than the lead's is neither drawn nor named;
     - an app that sent nothing is named, never drawn as a row of zeroes;
     - features and the signup weeks are counts of people, never shares; a week
       that has not happened yet is a dash, never a zero;
     - the store's state is written in words and a state nobody can name is
       "Not reported", never guessed;
     - every read is its own: one that is down takes only its own sections, and
       its Try again asks only for it;
     - the pane asks for exactly four reads, none of them /growth, and draws no
       Momentum card, because that route is not in the backend yet;
     - the old address with a query on it is Usage detail's, and is sent there.

   Plus the things that are easy to re-break by accident: the registry gives
   Growth no filter bar and Usage detail all three, every class the pane writes
   is one a loaded sheet styles, and the page's own sheet keeps the type size
   and tap-target floors the design brief sets.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal or inversion makes that test fail.
   A test with no such line is a test that pins nothing. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const PANE_SRC = read('assets/pane-analytics.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

const ENDPOINTS = { summary: '/api/ops/summary', usage: '/api/ops/usage', releases: '/api/ops/releases' };

/* ------------------------------------------------------------- fixtures */

/* Every fixture is a function that returns a fresh object, because every test
   below takes something away from a whole, healthy answer and a shared object
   would carry the removal into the next test. Dates are fixed: the pane reads
   every date from the answer and never from the clock, so a fixed date says
   the same thing every day it is run. The two ages that ARE read against the
   clock are given as a moment far enough back that no run can call it fresh,
   or as one a little while ago. */
const WEEK = { start: '2026-10-25T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 7 };
const MONTH = { start: '2026-10-02T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 30 };
const LONG_AGO = '2026-10-29T03:00:00.000Z';
const recently = () => new Date(Date.now() - 3600000).toISOString();

const MOBILE_WEEK = [17, 19, 16, 22, 24, 27, 31];
const COACHES_WEEK = [4, 5, 5, 6, 5, 7, 8];

const edit = (make, over) => {
  const base = make();
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
};

function summaryFixture(over) {
  return edit(() => ({
    generatedAt: '2026-11-01T09:00:00.000Z',
    people: {
      availability: { state: 'ready' },
      platform: { active: 44, previousActive: 32 },
      apps: [
        { app: 'mobile', label: 'Mobile', active: 39, previousActive: 28 },
        { app: 'coaches', label: 'Coaches Web', active: 9, previousActive: 7 },
      ],
      window: WEEK,
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 5,
      environment: 'production',
    },
  }), over);
}

function appFixture(app, label, people, sessions, coverage, values) {
  return {
    app, label, tone: app, coverageBasisPoints: coverage,
    metrics: [
      { label: 'Active people', kind: 'count', value: people },
      { label: 'Sessions', kind: 'count', value: sessions },
      { label: 'Sessions per person', kind: 'decimal', digits: 1, value: sessions / people },
      { label: 'Opened a feature', kind: 'rate', value: 5000, numerator: 1, denominator: 2 },
    ],
    trend: { label: 'Active people per day, ' + label, color: app === 'mobile' ? 's1' : 's2', values },
  };
}

function weekFixture(over) {
  return edit(() => ({
    window: { range: '7d', ...WEEK, rollupsComputedAt: recently(), daysMissingRollups: [] },
    availability: { state: 'ready', detail: '' },
    apps: [
      appFixture('mobile', 'Mobile', 39, 86, 9400, MOBILE_WEEK.slice()),
      appFixture('coaches', 'Coaches Web', 9, 21, 10000, COACHES_WEEK.slice()),
    ],
    notReporting: [],
    cohorts: [],
    features: {
      hint: 'People who opened each feature.',
      rows: [
        { label: 'Training plan', app: 'Mobile', color: 's1', basisPoints: 5385, users: 21, denominator: 39 },
        { label: 'Aria chat', app: 'Mobile', color: 's1', basisPoints: 4103, users: 16, denominator: 39 },
        { label: 'Workout logging', app: 'Mobile', color: 's1', basisPoints: 3333, users: 13, denominator: 39 },
        { label: 'Program builder', app: 'Coaches Web', color: 's2', basisPoints: 7778, users: 7, denominator: 9 },
        { label: 'Athlete roster', app: 'Coaches Web', color: 's2', basisPoints: 6667, users: 6, denominator: 9 },
      ],
      note: 'People who opened each feature in the window.',
    },
  }), over);
}

function monthFixture(over) {
  return edit(() => ({
    window: { range: '30d', ...MONTH, rollupsComputedAt: recently(), daysMissingRollups: [] },
    availability: { state: 'ready', detail: '' },
    apps: [],
    notReporting: [],
    cohorts: [
      { app: 'mobile', label: 'Mobile', offsets: ['W1', 'W2'], note: 'A group is the accounts created in that UTC week.',
        rows: [
          { label: '5 Oct', size: 10, cells: [{ basisPoints: 6000, returned: 6 }, { basisPoints: 5000, returned: 5 }] },
          { label: '12 Oct', size: 12, cells: [{ basisPoints: 5833, returned: 7 }, { state: 'not_aged' }] },
          { label: '19 Oct', size: 6, cells: [{ state: 'not_aged' }, { state: 'not_aged' }] },
        ] },
    ],
    features: null,
  }), over);
}

function releasesFixture(over) {
  const track = (state, versionName, releasedAt) => [
    { track: 'internal', versionName: '1.3.3', state: 'processing', fetchedAt: recently() },
    { track: 'production', versionName, state, releasedAt, fetchedAt: recently() },
  ];
  return edit(() => ({
    platforms: [
      { platform: 'ios', label: 'iOS', tracks: track('live', '1.3.2', '2026-10-29T14:00:00.000Z') },
      { platform: 'android', label: 'Android', tracks: track('live', '1.3.2', '2026-10-29T16:00:00.000Z') },
    ],
  }), over);
}

const boom = (message) => Object.assign(new Error(message || 'The server did not answer.'), { code: 'http_500' });

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'analytics');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/analytics.html loads it: registry, aria.js, the
   bootstrap, then the pane module. `options` replaces a read's answer by its
   short name; an Error rejects, and a function is asked with the query so the
   one usage endpoint can answer its two windows differently. The answer table
   is handed back live. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = {
    [ENDPOINTS.summary]: opts.summary === undefined ? summaryFixture() : opts.summary,
    [ENDPOINTS.releases]: opts.releases === undefined ? releasesFixture() : opts.releases,
    week: opts.week === undefined ? weekFixture() : opts.week,
    month: opts.month === undefined ? monthFixture() : opts.month,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: opts.href || 'https://ops.example.invalid/ops/analytics.html',
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      const query = o && o.query;
      calls.push({ endpoint, query });
      let answer = endpoint === ENDPOINTS.usage
        ? answers[query && query.range === '7d' ? 'week' : 'month']
        : answers[endpoint];
      if (typeof answer === 'function') answer = answer(query);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-analytics.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));

  return Object.assign(dom, { calls, answers });
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
}

/* ------------------------------------------------------------- reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const section = (dom, id) => dom.doc.getElementById('growth-' + id);
const wordsOf = (root, cls) => withClass(root, cls).map(allText);
const all = (dom) => allText(dom.doc.body);
const leadLines = (dom) => withClass(section(dom, 'chart'), 'tc-line').filter((n) => !classesOf(n).includes('is-also'));
const alsoLines = (dom) => withClass(section(dom, 'chart'), 'tc-line').filter((n) => classesOf(n).includes('is-also'));
const retryButtons = (root) => findAll(root, (n) => n.getAttribute && n.getAttribute('data-retry') !== null);

/* =============================== the reads ============================== */

test('the pane asks for four reads, with the questions it means to ask, and never for /growth', async () => {
  const dom = await boot();
  const asked = dom.calls.map((c) => c.endpoint + ' ' + JSON.stringify(c.query || null)).sort();
  assert.deepEqual(asked, [
    '/api/ops/releases null',
    '/api/ops/summary null',
    '/api/ops/usage {"scope":"all","range":"30d","env":"production"}',
    '/api/ops/usage {"scope":"all","range":"7d","env":"production"}',
  ].sort(), 'Growth should ask for exactly these four reads, once each');

  const text = all(dom);
  for (const word of ['Momentum', 'New accounts', 'Paying']) {
    assert.doesNotMatch(text, new RegExp(word), word + ' was drawn with no route behind it');
  }
});

test('the old address with a query on it is sent to Usage detail, and reads nothing', async () => {
  const dom = await boot({ href: 'https://ops.example.invalid/ops/analytics.html?scope=aria&range=7d&env=staging' });
  assert.equal(dom.window.location.href, 'usage.html?scope=aria&range=7d&env=staging',
    'a link that carried a window, an app or an environment was not handed to the page that has them');
  assert.deepEqual(dom.calls, [], 'the redirect still read something');

  const plain = await boot({ href: 'https://ops.example.invalid/ops/analytics.html?fixture=x' });
  assert.notEqual(plain.window.location.href, 'usage.html?fixture=x');
  assert.equal(plain.calls.length, 4, 'a query nobody moved was treated as one that is');
});

test('Growth has no filter bar and Usage detail has all three, and both live under Growth', async () => {
  const dom = await boot();
  const reg = dom.window.OpsPaneRegistry;
  const growth = reg.PANES.analytics;
  const usage = reg.PANES.usage;
  assert.equal(growth.destination, 'growth');
  assert.equal(growth.datedHead, true);
  for (const filter of ['scope', 'range', 'env']) {
    assert.ok(!growth[filter], 'Growth declared a ' + filter + ' control');
    assert.ok(usage[filter], 'Usage detail lost its ' + filter + ' control');
  }
  assert.deepEqual(Array.from(reg.panesOf('growth')), ['analytics', 'releases', 'usage']);
  assert.equal(usage.file, 'usage.html');
  assert.equal(growth.file, 'analytics.html');
});

/* ============================== the head ================================ */

test('the head reads the date and the seven days, and prints no "Updated"', async () => {
  const dom = await boot();
  const slot = dom.doc.getElementById('pageSub');
  assert.deepEqual(wordsOf(slot, 'sub-date'), ['Sun, Nov 1, 2026']);
  assert.deepEqual(wordsOf(slot, 'sub-updated'), ['Oct 25\u201331 \u00b7 UTC']);
  assert.doesNotMatch(allText(slot), /Updated/);
});

/* ============================ the people ================================ */

test('the headline is the platform count and the change is people, not the apps added up', async () => {
  const dom = await boot();
  const people = section(dom, 'people');
  assert.deepEqual(wordsOf(people, 'big'), ['44'],
    'the headline was the two apps added together (39 + 9 = 48) or something else');
  assert.match(allText(people), /\+12 vs last week/);
  assert.doesNotMatch(allText(people), /%/, 'the change was drawn as a percentage');
  assert.match(allText(people), /Opt-in activity/);
});

test('a people figure that is not ready is words and never a numeral', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.people.availability = { state: 'insufficient', detail: 'Too few.' }; }),
  });
  const people = section(dom, 'people');
  assert.deepEqual(wordsOf(people, 'big'), ['Too few to report']);
  assert.doesNotMatch(allText(people), /\d/, 'a figure was drawn for an answer that is not ready');
});

/* =============================== the lines ============================== */

test('a day with no reading is a gap named under the chart, never a zero', async () => {
  const dom = await boot({
    week: weekFixture((w) => { w.apps[0].trend.values = [17, 19, null, 22, 24, 27, 31]; }),
  });
  assert.equal(leadLines(dom).length, 2, 'the line did not break at the day with no reading');
  assert.deepEqual(wordsOf(section(dom, 'chart'), 'g-note'), ['No reading Oct 27']);
  assert.ok(!withClass(section(dom, 'chart'), 'tc-val').some((n) => allText(n) === '0'),
    'a missing day was drawn as a zero');

  const many = await boot({
    week: weekFixture((w) => {
      w.apps[0].trend.values = [17, null, null, null, 24, 27, 31];
      w.apps[1].trend.values = [4, 5, 5, 6, 5, null, 8];
    }),
  });
  assert.deepEqual(wordsOf(section(many, 'chart'), 'g-note'), ['No reading on 4 days'],
    'the days either line had no reading for were not counted together');
});

test('Week high is printed only when every day has a reading and one is strictly highest', async () => {
  const earned = await boot();
  assert.deepEqual(wordsOf(section(earned, 'chart'), 'tc-high'), ['Week high \u00b7 31']);

  const gap = await boot({ week: weekFixture((w) => { w.apps[0].trend.values = [17, 19, null, 22, 24, 27, 31]; }) });
  assert.deepEqual(wordsOf(section(gap, 'chart'), 'tc-high'), [], 'a high was claimed over a week with a hole in it');

  const tie = await boot({ week: weekFixture((w) => { w.apps[0].trend.values = [31, 19, 16, 22, 24, 27, 31]; }) });
  assert.deepEqual(wordsOf(section(tie, 'chart'), 'tc-high'), [], 'a high was claimed for two days that tie');
});

test('the second line is drawn on the lead\'s days or not at all, and the legend follows the lines', async () => {
  const dom = await boot();
  assert.equal(alsoLines(dom).length, 1);
  assert.deepEqual(wordsOf(section(dom, 'chart'), 'tc-key'), ['Mobile daily', 'Coaches Web daily']);

  const short = await boot({ week: weekFixture((w) => { w.apps[1].trend.values = [4, 5, 5, 6, 5, 7]; }) });
  assert.equal(alsoLines(short).length, 0, 'a line of six days was drawn on a seven day axis');
  assert.deepEqual(wordsOf(section(short, 'chart'), 'tc-key'), ['Mobile daily'],
    'the legend named a line the chart did not draw');
  assert.match(allText(section(short, 'apps')), /Coaches Web/, 'the app lost its row with its line');
});

test('a recount older than a day and a half says when it last ran, and a fresh one says nothing', async () => {
  const fresh = await boot();
  assert.deepEqual(wordsOf(section(fresh, 'chart'), 'g-note'), []);

  const old = await boot({ week: weekFixture((w) => { w.window.rollupsComputedAt = LONG_AGO; }) });
  assert.deepEqual(wordsOf(section(old, 'chart'), 'g-note'), ['Last counted Oct 29']);
});

test('a window that is not ready is words in place of the chart, never an empty axis', async () => {
  const dom = await boot({
    week: weekFixture((w) => { w.availability = { state: 'not_reporting', detail: 'No app has sent anything.' }; }),
  });
  assert.equal(withClass(section(dom, 'chart'), 'tchart').length, 0, 'a chart was drawn for nothing');
  assert.match(allText(section(dom, 'chart')), /No reading/);
  assert.equal(withClass(section(dom, 'apps'), 'g-app').length, 0, 'app rows were drawn for an answer that is not ready');
});

/* ============================== the app rows ============================ */

test('each app is a row of people, sessions and coverage, and an app with no reading is named not zeroed', async () => {
  const dom = await boot({
    week: weekFixture((w) => {
      w.apps[1].coverageBasisPoints = null;
      w.apps[0].metrics[0].value = 1;
      w.notReporting = [{ app: 'ios', label: 'Kiosk', detail: 'Nothing arrived.' }];
    }),
  });
  const rows = withClass(section(dom, 'apps'), 'g-app').map(allText);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /Mobile.*1 person.*86 sessions.*94% coverage/);
  assert.match(rows[1], /Coaches Web.*9 people.*21 sessions.*Coverage not reported/);
  assert.match(rows[2], /Kiosk.*No reading/);
  assert.doesNotMatch(rows[2], /\d/, 'an app that sent nothing was drawn with a figure');
});

/* ============================= feature use ============================== */

test('feature use is the people, grouped by app in the order sent, with no percentage anywhere', async () => {
  const dom = await boot();
  const card = section(dom, 'features');
  assert.deepEqual(wordsOf(card, 'g-sub'), ['Mobile \u00b7 people', 'Coaches Web \u00b7 people']);
  assert.deepEqual(withClass(card, 'g-item').map(allText), [
    'Training plan 21', 'Aria chat 16', 'Workout logging 13', 'Program builder 7', 'Athlete roster 6',
  ]);
  assert.doesNotMatch(allText(card), /%/, 'a share of people was drawn');

  const unsure = await boot({
    week: weekFixture((w) => { w.features.rows[1].users = null; }),
  });
  assert.match(withClass(section(unsure, 'features'), 'g-item').map(allText)[1], /^Aria chat -$/,
    'a count nobody has was drawn as a number');

  const none = await boot({ week: weekFixture((w) => { w.features = null; }) });
  assert.match(allText(section(none, 'features')), /No feature use reported/);
});

/* ============================= coming back ============================== */

test('coming back is people by signup week, with a week that has not happened a dash and not a zero', async () => {
  const dom = await boot();
  const card = section(dom, 'back');
  assert.deepEqual(wordsOf(card, 'g-sub'), ['Mobile \u00b7 Oct 2\u201331 A group is the accounts created in that UTC week.']);
  const heads = findAll(card, (n) => n.tagName === 'TH' && n.getAttribute('scope') === 'col').map(allText);
  assert.deepEqual(heads, ['Cohort', 'Joined', 'Week 1', 'Week 2']);

  const rows = findAll(card, (n) => n.tagName === 'TR').slice(1).map((tr) =>
    findAll(tr, (n) => n.tagName === 'TH' || n.tagName === 'TD').map((c) => allText(c).replace(/Not aged yet|Not reported/, '').trim()));
  assert.deepEqual(rows, [['Oct 5', '10', '6', '5'], ['Oct 12', '12', '7', '\u2014'], ['Oct 19', '6', '\u2014', '\u2014']],
    'the signup weeks were not written as dates, or a week that has not happened was drawn as a number');
  assert.match(allText(card), /People \u00b7 \u2014 not yet aged/);
  assert.doesNotMatch(allText(card), /%/, 'a share of people was drawn');

  const aged = await boot({
    month: monthFixture((m) => { m.cohorts[0].rows = [m.cohorts[0].rows[0]]; }),
  });
  assert.doesNotMatch(allText(section(aged, 'back')), /not yet aged/,
    'a footnote explained a dash that is not on the card');

  const none = await boot({ month: monthFixture((m) => { m.cohorts = []; }) });
  assert.match(allText(section(none, 'back')), /No full signup weeks yet/);
});

/* =============================== releases =============================== */

test('app releases name the production build, say its state in words, and date it once or per store', async () => {
  const dom = await boot();
  const card = section(dom, 'releases');
  assert.deepEqual(withClass(card, 'g-rel').map(allText), ['iOS 1.3.2 Live', 'Android 1.3.2 Live']);
  assert.deepEqual(wordsOf(card, 'g-released'), ['Released Oct 29']);
  const link = withClass(card, 'g-link')[0];
  assert.equal(link.getAttribute('href'), 'releases.html', 'View tracks did not go to App releases');

  const odd = await boot({
    releases: releasesFixture((r) => {
      r.platforms[0].tracks[1].state = 'something_new';
      r.platforms[1].tracks[1].state = 'rolling_out';
      r.platforms[1].tracks[1].releasedAt = '2026-10-30T09:00:00.000Z';
    }),
  });
  assert.deepEqual(withClass(section(odd, 'releases'), 'g-rel').map(allText),
    ['iOS 1.3.2 Not reported', 'Android 1.3.2 Rolling out'], 'a state nobody can name was guessed at');
  assert.deepEqual(wordsOf(section(odd, 'releases'), 'g-released'), ['iOS Oct 29 \u00b7 Android Oct 30']);

  const bare = await boot({
    releases: releasesFixture((r) => { r.platforms[0].tracks = r.platforms[0].tracks.slice(0, 1); }),
  });
  assert.match(allText(section(bare, 'releases')), /iOS.*No production build/);

  const old = await boot({
    releases: releasesFixture((r) => { r.platforms[0].tracks[1].fetchedAt = LONG_AGO; }),
  });
  assert.match(allText(section(old, 'releases')), /Stores last checked over 6 hours ago/,
    'a state read days ago was drawn as if it were now');
});

/* ============================ one read at a time ======================== */

test('a read that is down takes only its own sections, and its Try again asks only for it', async () => {
  const dom = await boot({ week: boom('The week could not be counted.') });

  assert.deepEqual(wordsOf(section(dom, 'people'), 'big'), ['44'], 'the headline went with the week');
  assert.equal(withClass(section(dom, 'back'), 'g-table').length, 1, 'the signup weeks went with the week');
  assert.equal(withClass(section(dom, 'releases'), 'g-rel').length, 2, 'the stores went with the week');

  for (const id of ['chart', 'features']) {
    assert.equal(retryButtons(section(dom, id)).length, 1, id + ' drew no Try again of its own');
  }
  assert.equal(withClass(section(dom, 'apps'), 'g-app').length, 0, 'app rows were drawn from a read that failed');
  assert.match(all(dom), /could not be read/);

  dom.answers.week = weekFixture();
  const before = dom.calls.length;
  retryButtons(section(dom, 'chart'))[0].dispatch('click');
  await settle();

  assert.deepEqual(dom.calls.slice(before).map((c) => c.endpoint + ' ' + (c.query && c.query.range)),
    ['/api/ops/usage 7d'], 'a Try again asked for more than the read that failed');
  assert.equal(withClass(section(dom, 'chart'), 'tchart').length, 1, 'the chart did not come back');
  assert.equal(withClass(section(dom, 'features'), 'g-item').length, 5, 'the features did not come back with the week');
  assert.equal(retryButtons(dom.doc.body).length, 0, 'a Try again is left over after the read answered');
});

test('the signup weeks and the stores are their own reads, and each failure stays in its own card', async () => {
  const dom = await boot({ month: boom('down'), releases: boom('down too') });
  assert.equal(withClass(section(dom, 'chart'), 'tchart').length, 1, 'the chart went with another read');
  assert.equal(retryButtons(section(dom, 'back')).length, 1);
  assert.equal(retryButtons(section(dom, 'releases')).length, 1);
  assert.equal(retryButtons(section(dom, 'chart')).length, 0);
});

test('with every read down the page is one failure and a Try again, and no card at all', async () => {
  const dom = await boot({
    summary: boom('a'), week: boom('b'), month: boom('c'), releases: boom('d'),
  });
  assert.equal(section(dom, 'people'), null, 'a card was drawn with nothing behind it');
  const tries = findAll(dom.doc.body, (n) => n.tagName === 'BUTTON' && allText(n) === 'Try again');
  assert.equal(tries.length, 1, 'a page with every read down should offer one Try again');
});

/* ============================== the sheet =============================== */

const PANE_CSS = read('assets/pane-analytics-v2.css');
const SHELL_CSS = read('assets/shell-pane-v2.css');
const ARIA_CSS = read('assets/aria.css');

const classesIn = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((m) => m[1]));

test('every class the pane writes is one a loaded sheet styles', async () => {
  const written = new Set();
  const walk = (node) => {
    for (const cls of classesOf(node)) written.add(cls);
    for (const kid of node.childNodes || []) if (kid.nodeType === 1) walk(kid);
  };
  const states = [
    await boot(),
    await boot({
      week: weekFixture((w) => { w.apps[0].trend.values = [17, 19, null, 22, 24, 27, 31]; w.window.rollupsComputedAt = LONG_AGO; w.notReporting = [{ app: 'x', label: 'X' }]; }),
      releases: releasesFixture((r) => { r.platforms[0].tracks[1].state = 'rejected'; r.platforms[1].tracks[1].state = 'in_review'; }),
    }),
    await boot({ week: boom('x'), month: boom('y'), releases: boom('z') }),
    await boot({ summary: summaryFixture((s) => { s.people.availability = { state: 'insufficient', detail: 'x' }; }), week: weekFixture((w) => { w.availability = { state: 'insufficient' }; w.features = null; }), month: monthFixture((m) => { m.cohorts = []; }) }),
  ];
  for (const dom of states) walk(section(dom, 'people') ? section(dom, 'people').parentNode.parentNode.parentNode : dom.doc.body);

  const styled = new Set([...classesIn(PANE_CSS), ...classesIn(SHELL_CSS), ...classesIn(ARIA_CSS)]);
  const bare = [...written].filter((cls) => !styled.has(cls) && /^(g-|tc-|growth)/.test(cls));
  assert.deepEqual(bare.sort(), [], 'classes the pane writes that no loaded sheet mentions');
  assert.ok([...written].filter((c) => c.startsWith('g-')).length >= 25,
    'only ' + [...written].filter((c) => c.startsWith('g-')).length + ' of the pane\'s own classes were reached, so this is not reading the pane');
});

test('the page\'s own sheet holds the type size and tap-target floors the brief sets', () => {
  const css = PANE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 10, 'only ' + sizes.length + ' font sizes were read from the sheet');
  assert.deepEqual(sizes.filter((px) => px < 14), [], 'a size under the 14px floor for body text');
  assert.doesNotMatch(css, /monospace|--mono/, 'numbers set in a monospace face');

  const link = /\.g-link\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
  assert.ok(link && Number(link[1]) >= 44, 'View tracks is under the 44px tap target');
});
