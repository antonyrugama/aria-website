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
     - the reporting floor is about rates: every count is drawn on both sides of
       the 50-person floor (49 and 50 draw the same page), and an answer that is
       not reporting draws none;
     - the change against last week is drawn only from a previous count and a
       comparison the route sent, never from a fallback to zero or to a week;
     - sessions are summed from stored days, so a window with none says "not
       reported" and never "0 sessions", and a window that covers part of the
       week names the days it covers;
     - features and the signup weeks are counts of people, never shares; a week
       that has not happened yet is a dash, never a zero;
     - the store's state is written in words and a state nobody can name is
       "Not reported", never guessed;
     - every read is its own: one that is down takes only its own sections, and
       its Try again asks only for it;
     - the pane asks for exactly five reads, and the fifth, /growth, is the only
       one that is optional: Momentum draws what the route sent and nothing it
       did not, a week before it did not send is "No comparison yet" and never
       no change, and a route that is down or not deployed yet leaves out
       Momentum and nothing else, with no error and no degraded page;
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

const ENDPOINTS = {
  summary: '/api/ops/summary', usage: '/api/ops/usage', releases: '/api/ops/releases', growth: '/api/ops/growth',
};

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

/* Aria today: fewer than fifty people active, so the route answers
   `insufficient` for every window it is asked, with the sentence it really
   writes, and still sends every count. The floor is about rates. */
const FLOOR = 50;
const below = (people, days) => ({
  state: 'insufficient',
  detail: people + ' people were active in the last ' + days + ' days, which is under the ' + FLOOR + ' we report rates from.',
});
const READY = { state: 'ready', detail: '' };

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
      reportingFloor: FLOOR,
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
    window: { range: '7d', ...WEEK, rollupsComputedAt: recently(), reportingStart: '2026-10-25', daysCovered: 7, daysMissingRollups: [] },
    availability: below(44, 7),
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
    window: { range: '30d', ...MONTH, rollupsComputedAt: recently(), reportingStart: '2026-10-02', daysCovered: 30, daysMissingRollups: [] },
    availability: below(47, 30),
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

/* Eight weeks of new accounts and 57 days of paying subscribers, as
   GET /api/ops/growth sends them: 9 new accounts this week against 6, and 37
   paying today against 33 a week ago. */
const ACCOUNTS = [4, 5, 3, 6, 5, 7, 6, 9];
const PAYING = Array.from({ length: 57 }, (_, i) => (i < 49 ? 22 + Math.floor((i * 10) / 48) : [33, 33, 34, 34, 35, 36, 36, 37][i - 49]));
const payingDay = (i, count) => {
  const day = new Date(Date.UTC(2026, 8, 6 + i)).toISOString().slice(0, 10);
  return { day, count, capturedAt: count === null ? null : day + 'T00:05:00.000Z' };
};

function growthFixture(over) {
  return edit(() => {
    const weeks = ACCOUNTS.map((count, k) => ({
      start: new Date(Date.UTC(2026, 8, 6 + 7 * k)).toISOString().slice(0, 10),
      endExclusive: new Date(Date.UTC(2026, 8, 13 + 7 * k)).toISOString().slice(0, 10),
      count,
    }));
    return {
      asOf: '2026-11-01T09:00:00.000Z',
      timezone: 'UTC',
      newAccounts: { current: weeks[7], previous: weeks[6], weeks, source: 'users.createdAt', coverage: 'surviving_accounts' },
      payingSubscribers: {
        current: { count: 37, asOf: '2026-11-01T09:00:00.000Z' },
        previous: payingDay(49, PAYING[49]),
        weeks: [0, 7, 14, 21, 28, 35, 42, 49].map((i) => payingDay(i, PAYING[i])),
        daily: PAYING.map((count, i) => payingDay(i, count)),
        historyBeginsAt: '2026-09-06T00:05:00.000Z',
        source: 'subscriptions', historySource: 'telemetry_metric_rollups.paying_subscribers',
      },
    };
  }, over);
}

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
    [ENDPOINTS.growth]: opts.growth === undefined ? growthFixture() : opts.growth,
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

test('the pane asks for five reads, with the questions it means to ask, growth being the only optional one', async () => {
  const dom = await boot();
  const asked = dom.calls.map((c) => c.endpoint + ' ' + JSON.stringify(c.query || null)).sort();
  assert.deepEqual(asked, [
    '/api/ops/growth null',
    '/api/ops/releases null',
    '/api/ops/summary null',
    '/api/ops/usage {"scope":"all","range":"30d","env":"production"}',
    '/api/ops/usage {"scope":"all","range":"7d","env":"production"}',
  ].sort(), 'Growth should ask for exactly these five reads, once each');
});

/* The card's two tiles by name: what is counted, over what span, the count and
   the sentence about the change. */
const tiles = (dom) => withClass(section(dom, 'momentum'), 'g-mom').map((t) => ({
  name: wordsOf(t, 'g-mom-name')[0],
  span: wordsOf(t, 'g-mom-span')[0],
  count: wordsOf(t, 'g-mom-num')[0],
  change: wordsOf(t, 'delta')[0],
}));

test('Momentum is new accounts and paying subscribers, each against the week before, drawn as the route sent them', async () => {
  const dom = await boot();
  assert.deepEqual(wordsOf(section(dom, 'momentum'), 'g-title'), ['Momentum']);
  assert.deepEqual(tiles(dom), [
    { name: 'New accounts', span: '7 days', count: '9', change: '+3 vs last week' },
    { name: 'Paying', span: 'Now', count: '37', change: '+4 vs last week' },
  ]);

  const fewer = await boot({
    growth: growthFixture((g) => { g.newAccounts.current.count = 6; g.payingSubscribers.current.count = 31; }),
  });
  assert.deepEqual(tiles(fewer).map((t) => t.change), ['No change vs last week', '\u22122 vs last week']);
});

test('a week before that the route could not count is "No comparison yet", never no change and never zero', async () => {
  const dom = await boot({
    growth: growthFixture((g) => {
      g.newAccounts.previous = { ...g.newAccounts.previous, count: null };
      g.payingSubscribers.previous = { ...g.payingSubscribers.previous, count: null, capturedAt: null };
    }),
  });
  assert.deepEqual(tiles(dom).map((t) => [t.count, t.change]), [['9', 'No comparison yet'], ['37', 'No comparison yet']]);

  const onlyPaying = await boot({
    growth: growthFixture((g) => { g.newAccounts.previous = null; }),
  });
  assert.deepEqual(tiles(onlyPaying).map((t) => t.change), ['No comparison yet', '+4 vs last week']);
});

test('a count the route did not send is no tile, and with neither the card is not drawn at all', async () => {
  const one = await boot({ growth: growthFixture((g) => { g.newAccounts.current = { ...g.newAccounts.current, count: null }; }) });
  assert.deepEqual(tiles(one).map((t) => t.name), ['Paying']);

  const none = await boot({ growth: growthFixture((g) => { delete g.newAccounts; delete g.payingSubscribers; }) });
  assert.deepEqual(tiles(none), []);
  assert.equal(section(none, 'momentum').childNodes.length, 0, 'a card was drawn around nothing');
  assert.ok(!classesOf(section(none, 'momentum').parentNode).includes('has-momentum'),
    'the row kept its room for a card that is empty');
  assert.ok(classesOf(section(await boot(), 'momentum').parentNode).includes('has-momentum'));
});

test('a growth read that is down or not deployed yet leaves out Momentum and nothing else', async () => {
  const healthy = await boot();
  for (const growth of [
    boom('Growth is unavailable.'),
    Object.assign(new Error('Not found.'), { code: 'http_404' }),
    {},
  ]) {
    const dom = await boot({ growth });
    assert.deepEqual(tiles(dom), []);
    assert.equal(section(dom, 'momentum').childNodes.length, 0, 'a card was drawn with no growth behind it');
    assert.equal(retryButtons(dom.doc.body).length, 0, 'a missing growth read offered a Try again');
    assert.doesNotMatch(all(dom), /could not be read|Growth is unavailable|Not found/, 'the page told a reader about a read they did not ask for');
    assert.deepEqual(wordsOf(section(dom, 'people'), 'big'), wordsOf(section(healthy, 'people'), 'big'),
      'the headline moved with a read it does not use');
  }
});

test('a growth answer with no daily series still draws Momentum, because Momentum never reads it', async () => {
  const dom = await boot({ growth: growthFixture((g) => { delete g.payingSubscribers.daily; }) });
  assert.deepEqual(tiles(dom).map((t) => t.count), ['9', '37']);
});

test('the old address with a query on it is sent to Usage detail, and reads nothing', async () => {
  const dom = await boot({ href: 'https://ops.example.invalid/ops/analytics.html?scope=aria&range=7d&env=staging' });
  assert.equal(dom.window.location.href, 'usage.html?scope=aria&range=7d&env=staging',
    'a link that carried a window, an app or an environment was not handed to the page that has them');
  assert.deepEqual(dom.calls, [], 'the redirect still read something');

  const plain = await boot({ href: 'https://ops.example.invalid/ops/analytics.html?fixture=x' });
  assert.notEqual(plain.window.location.href, 'usage.html?fixture=x');
  assert.equal(plain.calls.length, 5, 'a query nobody moved was treated as one that is');
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

test('the seven days come off the week that was read when the summary carries no dates', async () => {
  const dom = await boot({ summary: summaryFixture((s) => { s.people.window = { days: 7 }; }) });
  assert.deepEqual(wordsOf(dom.doc.getElementById('pageSub'), 'sub-updated'), ['Oct 25\u201331 \u00b7 UTC'],
    'the head named no days though the week read carries them');
});

/* ============================ the people ================================ */

test('the headline is the platform count and the change is people, not the apps added up', async () => {
  const dom = await boot();
  const people = section(dom, 'people');
  assert.deepEqual(wordsOf(people, 'big'), ['44'],
    'the headline was the two apps added together (39 + 9 = 48) or something else');
  assert.match(allText(people), /\+12 vs last week/);
  assert.doesNotMatch(allText(people), /%/, 'the change was drawn as a percentage');
});

test('"Opt-in activity" is the info tip, not a caption beside the heading', async () => {
  const dom = await boot();
  const people = section(dom, 'people');
  assert.equal(withClass(people, 'g-caption').length, 0, 'a visible caption sits beside the heading');
  const bubble = dom.doc.getElementById('growth-people-scope');
  assert.ok(bubble && bubble.getAttribute('role') === 'tooltip', 'the headline has no info tip');
  assert.match(allText(bubble), /^Opt-in activity: only people who turned on usage analytics are counted/);
  const holders = findAll(people, (n) => allText(n).includes('Opt-in activity') &&
    !findAll(n, (k) => k !== n && allText(k).includes('Opt-in activity')).length);
  assert.deepEqual(holders.map((n) => n.getAttribute('role')), ['tooltip'],
    'the words are printed somewhere other than the tip');
});

/* The change against last week is a difference of two counts the route sent.
   A count it did not send, or a comparison it did not describe, is "No
   comparison yet": a missing previous is not a previous of nothing, and a
   comparison nobody described is not a week. The cases are one each because
   each is its own way to invent a figure: a fallback to 0 turns an absent
   previous into "+44", and a fallback to a seven day span turns an absent
   comparison into "vs last week". */
test('the change is drawn only from a previous count and a comparison the route sent', async () => {
  const change = async (over) => allText(section(await boot({ summary: summaryFixture(over) }), 'people'));

  assert.match(await change(), /\+12 vs last week/, 'the sent previous and comparison were not drawn');

  for (const [name, over] of [
    ['previousActive absent', (s) => { delete s.people.platform.previousActive; }],
    ['previousActive null', (s) => { s.people.platform.previousActive = null; }],
    ['comparison absent', (s) => { delete s.people.comparison; }],
    ['comparison null', (s) => { s.people.comparison = null; }],
    ['both absent', (s) => { delete s.people.platform.previousActive; delete s.people.comparison; }],
  ]) {
    const text = await change(over);
    assert.match(text, /No comparison yet/, name + ': no comparison was not said');
    assert.doesNotMatch(text, /vs last week|\+\d+|\u2212\d+/, name + ': a change was invented');
  }

  assert.match(await change((s) => { s.people.platform.previousActive = 0; }), /\+44 vs last week/,
    'a previous count of zero the route did measure was treated as absent');
  assert.match(await change((s) => { s.people.comparison = { label: 'the days before' }; }), /\+12 vs last week/,
    'a comparison with no day count was treated as absent');
});

test('a people figure that is not reporting is words and never a numeral', async () => {
  const dom = await boot({
    summary: summaryFixture((s) => { s.people.availability = { state: 'not_reporting', detail: 'No app has sent anything.' }; }),
  });
  const people = section(dom, 'people');
  assert.deepEqual(wordsOf(people, 'big'), ['No reading']);
  assert.doesNotMatch(allText(people), /\d/, 'a figure was drawn for an answer that is not ready');

  const unknown = await boot({
    summary: summaryFixture((s) => { s.people.availability = { state: 'something_new' }; }),
  });
  assert.deepEqual(wordsOf(section(unknown, 'people'), 'big'), ['Not reported'],
    'a state nobody can name was guessed at');

  /* The summary does not send this state for people today. If it ever does,
     the floor is about rates, so the count it sends is still the headline. */
  const floor = await boot({
    summary: summaryFixture((s) => { s.people.availability = below(44, 7); }),
  });
  assert.deepEqual(wordsOf(section(floor, 'people'), 'big'), ['44'],
    'a count the route sent was withheld for sitting under the reporting floor');
  assert.match(allText(section(floor, 'people')), /\+12 vs last week/);

  const nothing = await boot({
    summary: summaryFixture((s) => { s.people.availability = below(0, 7); delete s.people.platform.active; }),
  });
  assert.deepEqual(wordsOf(section(nothing, 'people'), 'big'), ['Not reported'],
    'a count the route did not send was drawn');
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

test('each app is a row of people, sessions and reporting, and an app with no reading is named not zeroed', async () => {
  const dom = await boot({
    week: weekFixture((w) => {
      w.apps[1].coverageBasisPoints = null;
      w.apps[0].metrics[0].value = 1;
      w.notReporting = [{ app: 'ios', label: 'Kiosk', detail: 'Nothing arrived.' }];
    }),
  });
  const rows = withClass(section(dom, 'apps'), 'g-app').map(allText);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /Mobile.*1 person.*86 sessions.*94% reporting/);
  assert.match(rows[1], /Coaches Web.*9 people.*21 sessions.*Reporting unknown/);
  assert.match(rows[2], /Kiosk.*No reading/);
  assert.doesNotMatch(rows[2], /\d/, 'an app that sent nothing was drawn with a figure');
  assert.doesNotMatch(rows.join(' '), /coverage/i, 'the app rows still say coverage');
});

/* ===================== the floor is about rates, not counts =============== */

/* What the route draws from, and everything the page prints from it. The route
   answers `insufficient` under 50 active people and still sends every count;
   Aria has fewer than 50 active people, so this is the shape it really gets. */
const counts = (dom) => ({
  lines: leadLines(dom).length + alsoLines(dom).length,
  chart: withClass(section(dom, 'chart'), 'tchart').length,
  apps: withClass(section(dom, 'apps'), 'g-app').map(allText),
  features: withClass(section(dom, 'features'), 'g-item').map(allText),
  back: findAll(section(dom, 'back'), (n) => n.tagName === 'TR').map(allText),
});

test('the real fifty-person boundary: 49 and 50 draw the same counts, and not reporting draws none', async () => {
  const at = (people, state) => ({
    week: weekFixture((w) => { w.availability = state === 'ready' ? READY : below(people, 7); }),
    month: monthFixture((m) => { m.availability = state === 'ready' ? READY : below(people, 30); }),
    summary: summaryFixture((s) => { s.people.platform.active = people; }),
  });

  const under = counts(await boot(at(49, 'insufficient')));
  const over = counts(await boot(at(50, 'ready')));
  assert.deepEqual(under, over, 'the counts changed across the floor, so the floor withheld a count');
  assert.equal(under.chart, 1, 'the daily lines were not drawn under the floor');
  assert.equal(under.apps.length, 2, 'the app rows were not drawn under the floor');
  assert.equal(under.features.length, 5, 'feature use was not drawn under the floor');
  assert.equal(under.back.length, 4, 'the signup weeks were not drawn under the floor');
  assert.match(under.apps[0], /Mobile.*39 people.*86 sessions/);

  const small = await boot(at(49, 'insufficient'));
  assert.deepEqual(wordsOf(section(small, 'people'), 'big'), ['49'], 'the headline count was withheld under the floor');
  assert.doesNotMatch(all(small), /Too few to report|Not enough/, 'the floor was drawn as an absence of counts');
  assert.doesNotMatch((allText(section(small, 'features')) + allText(section(small, 'back')) +
    allText(section(small, 'apps'))).replace(/\d+% reporting/g, ''), /%/, 'a rate the floor protects was drawn');

  const gone = await boot({
    week: weekFixture((w) => { w.availability = { state: 'not_reporting', detail: 'No app reported.' }; }),
    month: monthFixture((m) => { m.availability = { state: 'not_reporting', detail: 'No app reported.' }; }),
  });
  const none = counts(gone);
  assert.equal(none.chart, 0, 'a chart was drawn for nothing');
  assert.deepEqual(none.apps, [], 'app rows were drawn for nothing');
  assert.deepEqual(none.features, [], 'feature counts were drawn for nothing');
  assert.deepEqual(none.back, [], 'signup weeks were drawn for nothing');
  assert.match(allText(section(gone, 'features')), /No reading/);
  assert.match(allText(section(gone, 'back')), /No reading/);
});

/* ======================== sessions and the days they cover ================ */

const SESSIONS_NOT_REPORTED = /Sessions not reported/;

test('a window with no stored days says sessions are not reported, never zero sessions', async () => {
  const dom = await boot({
    week: weekFixture((w) => {
      w.window.daysCovered = 0;
      w.window.reportingStart = null;
      w.window.rollupsComputedAt = null;
      for (const app of w.apps) {
        for (const m of app.metrics) if (m.label === 'Sessions' || m.label === 'Sessions per person') m.value = 0;
      }
    }),
  });
  const rows = withClass(section(dom, 'apps'), 'g-app').map(allText);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Mobile.*39 people.*Sessions not reported/);
  assert.match(rows[1], /Coaches Web.*9 people.*Sessions not reported/);
  assert.doesNotMatch(rows.join(' '), /\b0 sessions?\b/, 'no stored days was drawn as a measured zero');
  assert.deepEqual(wordsOf(section(dom, 'apps'), 'g-note'), [], 'a covered-days note was drawn for a window that covers none');
  assert.match(all(dom), SESSIONS_NOT_REPORTED);

  /* The people are read live, so they are drawn whatever the days say. */
  assert.deepEqual(wordsOf(section(dom, 'people'), 'big'), ['44']);
});

test('only a zero that no stored day explains is withheld: a measured session count survives, and so does a real zero', async () => {
  const unsure = await boot({
    week: weekFixture((w) => { w.window.daysCovered = 0; w.window.reportingStart = null; }),
  });
  assert.match(withClass(section(unsure, 'apps'), 'g-app').map(allText)[0], /86 sessions/,
    'a session count that was sent was withheld because the days say none were stored');

  const real = await boot({
    week: weekFixture((w) => { w.apps[1].metrics.find((m) => m.label === 'Sessions').value = 0; }),
  });
  assert.match(withClass(section(real, 'apps'), 'g-app').map(allText)[1], /Coaches Web.*0 sessions/,
    'a measured zero, with stored days behind it, was called not reported');

  const silent = await boot({
    week: weekFixture((w) => { delete w.window.daysCovered; delete w.window.reportingStart; w.apps[1].metrics.find((m) => m.label === 'Sessions').value = 0; }),
  });
  assert.match(withClass(section(silent, 'apps'), 'g-app').map(allText)[1], /0 sessions/,
    'an answer that does not say what it covers had its zero withheld on a guess');
});

test('a window whose stored days cover part of the week says which, once, and a full week says nothing', async () => {
  const partial = await boot({
    week: weekFixture((w) => { w.window.daysCovered = 4; w.window.reportingStart = '2026-10-28'; }),
  });
  assert.deepEqual(wordsOf(section(partial, 'apps'), 'g-note'), ['Sessions cover 4 of 7 days, from Oct 28'],
    'the days the sessions cover were not named');
  assert.match(withClass(section(partial, 'apps'), 'g-app').map(allText)[0], /86 sessions/,
    'the part that exists was not drawn');

  const full = await boot();
  assert.deepEqual(wordsOf(section(full, 'apps'), 'g-note'), [], 'a note was drawn for a week fully covered');

  const noStart = await boot({
    week: weekFixture((w) => { w.window.daysCovered = 3; w.window.reportingStart = null; }),
  });
  assert.deepEqual(wordsOf(section(noStart, 'apps'), 'g-note'), ['Sessions cover 3 of 7 days'],
    'a start that was not sent was made up');
});

test('the shell reads a usage window once, for Growth and Usage detail alike', async () => {
  const dom = await boot();
  const win = dom.window.OpsPaneShell.usageWindow;
  const ans = (over) => ({ window: Object.assign({ days: 7, daysCovered: 7, reportingStart: '2026-10-25', daysMissingRollups: [] }, over) });

  assert.equal(win.span({}), null, 'an answer with no window was given a span');
  assert.equal(win.span({ window: { days: 7 } }), null, 'an answer that does not say what it covers was given a span');
  assert.deepEqual(JSON.parse(JSON.stringify(win.span(ans({ daysMissingRollups: ['2026-10-27', 5] })))),
    { covered: 7, days: 7, start: '2026-10-25', missing: ['2026-10-27'] });

  assert.equal(win.noStoredDays(ans({ daysCovered: 0, reportingStart: null })), true);
  assert.equal(win.noStoredDays(ans({ daysCovered: 1 })), false);
  assert.equal(win.noStoredDays({}), false, 'an answer that says nothing was called empty');

  assert.equal(win.partial(ans({ daysCovered: 4 })).covered, 4);
  assert.equal(win.partial(ans({ daysCovered: 0 })), null, 'no stored days is its own state, not a partial');
  assert.equal(win.partial(ans()), null, 'a full week was called partial');
  assert.equal(win.partial(ans({ days: null, daysCovered: 4 })), null, 'a window of no length was called partial');

  const sessions = { label: 'Sessions', value: 0 };
  assert.equal(win.storedDayGap(sessions, true), true);
  assert.equal(win.storedDayGap(sessions, false), false, 'a zero was withheld in a window with stored days');
  assert.equal(win.storedDayGap({ label: 'Sessions', value: 3 }, true), false, 'a measured count was withheld');
  assert.equal(win.storedDayGap({ label: 'Active people', value: 0 }, true), false,
    'a figure that is read live was withheld for a gap in the stored days');
  assert.equal(win.storedDayGap({ label: 'Sessions per person', value: 0 }, true), true);
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

  const tip = dom.doc.getElementById('growth-features-reporting');
  assert.ok(tip && tip.getAttribute('role') === 'tooltip', 'the Feature use heading has no info tip');
  assert.match(allText(tip), /Reporting, beside each app above, is the share of its sessions that do\./,
    'the tip does not say what Reporting means');
  assert.deepEqual(wordsOf(card, 'g-title'), ['Feature use']);

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
    findAll(tr, (n) => n.tagName === 'TH' || n.tagName === 'TD').map((c) => allText(c).replace(/Too early to tell|Not reported/, '').trim()));
  assert.deepEqual(rows, [['Oct 5', '10', '6', '5'], ['Oct 12', '12', '7', '\u2014'], ['Oct 19', '6', '\u2014', '\u2014']],
    'the signup weeks were not written as dates, or a week that has not happened was drawn as a number');
  assert.match(allText(card), /People \u00b7 \u2014 too early to tell/);
  assert.doesNotMatch(allText(card), /not yet aged|not aged/i, 'the dash was explained in the words the brief replaced');
  assert.doesNotMatch(allText(card), /%/, 'a share of people was drawn');

  const aged = await boot({
    month: monthFixture((m) => { m.cohorts[0].rows = [m.cohorts[0].rows[0]]; }),
  });
  assert.doesNotMatch(allText(section(aged, 'back')), /too early to tell/,
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
  // Growth answers here: it is not one of the reads the page stands on, so its answer cannot keep the page up.
  const dom = await boot({
    summary: boom('a'), week: boom('b'), month: boom('c'), releases: boom('d'),
  });
  assert.equal(section(dom, 'momentum'), null, 'Momentum was drawn on a page that failed');
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
    await boot({ summary: summaryFixture((s) => { s.people.availability = { state: 'not_reporting', detail: 'x' }; }), week: weekFixture((w) => { w.availability = { state: 'not_reporting' }; w.features = null; }), month: monthFixture((m) => { m.cohorts = []; }) }),
    await boot({ week: weekFixture((w) => { w.window.daysCovered = 4; w.window.reportingStart = '2026-10-28'; }) }),
  ];
  for (const dom of states) walk(withClass(dom.doc.body, 'growth')[0] || dom.doc.body);

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
