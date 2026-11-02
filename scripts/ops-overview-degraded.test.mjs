/* What the Today page does when some of its reads fail.

   The page draws from eight reads that come from different tables, so the
   rule is the one the Problems pane sits under: a failure degrades the page
   and never empties it. A read that did not land takes away the sections that
   draw from it, says in words what happened, and offers its own Try again.
   Everything drawn from a read that DID land stays exactly as it was.

   Two things make these tests bind the behaviour rather than a sentence:

     - "Is that section still on screen" is judged by comparing the section's
       whole text against the same section on a healthy render in the same
       test, never against a string typed here. A section that stops drawing,
       or draws something different, cannot be smuggled past it.

     - Every assertion that the page must not claim something is two-sided.
       The same finder that must come up empty on the unreadable render is
       first shown to FIND the claim on the readable one. A predicate that
       matches nothing would otherwise pass every absence test in this file.

   The question of which read feeds which section is DRAWN_FROM below. It is
   the claim under test, written out, so a section that begins to depend on a
   second read (or stops depending on one) fails here rather than silently
   changing what a failure takes away.

   NOT COVERED here, deliberately:

     - Whether the degraded state LOOKS different from the live one. Both are
       the same `[data-state]` box, so the shell shows the same element for
       either and no DOM assertion can tell them apart. What is on that box is
       the whole of what an operator sees, and that is what is read.

     - The retry, focus and announcement behaviour, which is
       ops-overview-retry-focus, and the health line's wording for each
       readable state, which is ops-overview-v2. */
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
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-overview.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

const WEEK = {
  start: '2026-10-25T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 7,
};
const MOBILE_DAILY = [12, 15, 14, 17, 16, 19, 18, 17, 20, 22, 19, 21, 23, 20, 22,
  25, 24, 22, 26, 27, 25, 24, 28, 30, 26, 29, 31, 28, 33, 37];
const COACHES_DAILY = [4, 5, 4, 6, 5, 7, 6, 5, 7, 8, 6, 7, 8, 6, 7,
  9, 8, 7, 8, 9, 7, 6, 8, 9, 7, 8, 9, 8, 7, 9];
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const GOOD = {
  summary: () => ({
    generatedAt: '2026-11-01T09:41:00.000Z',
    consent: { basis: 'operational' },
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [
        { app: 'mobile', label: 'Mobile', active: 870, previousActive: 800 },
        { app: 'coaches', label: 'Coaches Web', active: 412, previousActive: 390 },
      ],
      window: WEEK,
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 5,
      environment: 'production',
    },
    aiRuns: {
      availability: { state: 'ready' },
      runs: 4820, previous: { runs: 4410, daysReported: 7 },
      daysMissing: [], daysReported: 7, window: WEEK,
    },
  }),
  usage: () => ({
    window: {
      range: '30d', start: '2026-10-02T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z',
      days: 30, grain: 'day', timezone: 'UTC', daysCovered: 30, daysMissingRollups: [],
    },
    availability: { state: 'ready', detail: '' },
    apps: [
      { app: 'mobile', label: 'Mobile', trend: { values: MOBILE_DAILY.slice() } },
      { app: 'coaches', label: 'Coaches Web', trend: { values: COACHES_DAILY.slice() } },
    ],
  }),
  /* One warning nobody is on, so a healthy render has a queue row to lose and
     a health line that is still "No critical issues" for the rules read to
     change. A critical one would make the rules read irrelevant to the line. */
  problems: () => ({
    problems: [{
      id: 'p1', reference: 'PRB-104', severity: 'warning', status: 'open',
      title: 'Generation queue is slow', detectedAt: '2026-10-30T08:00:00.000Z',
      workPane: 'jobs-live',
    }],
    total: 1,
  }),
  rules: () => ({
    rules: [
      { key: 'queue', label: 'Queue depth', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok', lastFiredAt: null },
    ],
    channels: [{ key: 'teams', label: 'Teams', configured: true, status: 'ok' }],
  }),
  jobs: () => ({
    generatedAt: '2026-11-01T09:40:00.000Z',
    queue: { open: 19, byState: [{ state: 'running', jobs: 6 }, { state: 'queued', jobs: 13 }] },
    attention: { completeness: 'whole_queue', stuck: [] },
  }),
  runs: () => ({
    window: { range: '24h' },
    coverage: { state: 'ready', coversWindow: true },
    summary: { runs: 26, completed: 24, failed: 1, canceled: 1, unfinished: 0 },
  }),
  costs: () => ({
    availability: { state: 'ready' }, currency: 'USD',
    period: { start: '2026-10-01T00:00:00.000Z', actualThrough: '2026-10-31T00:00:00.000Z', billedDays: 31 },
    total: { micros: 3_100_000_000 },
    daily: { series: [{ values: Array.from({ length: 31 }, (_, i) => (85 + i) * 1_000_000) }] },
  }),
};

const ENDPOINTS = {
  summary: '/api/ops/summary', usage: '/api/ops/usage',
  problems: '/api/ops/alerts/problems', rules: '/api/ops/alerts/rules',
  jobs: '/api/ops/jobs', runs: '/api/ops/runs', costs: '/api/ops/costs',
};
const READS = Object.keys(ENDPOINTS);
const CORE = ['summary', 'usage', 'problems', 'rules', 'jobs', 'runs', 'costs'];

/* Which read each section draws from. Written out because it is the claim. */
const DRAWN_FROM = {
  health: ['problems', 'rules'],
  live: ['jobs'],
  people: ['summary'],
  charts: ['usage'],
  moments: ['usage', 'summary'],
  problems: ['problems'],
  jobs: ['jobs'],
  ai: ['summary', 'runs'],
  spend: ['costs'],
};

/* A message of its own per read, so a failure that reached the wrong section
   shows the wrong words. */
const boom = (read) => Object.assign(new Error('the ' + read + ' read is down'), { code: 'http_500' });
const failing = (...keys) => Object.fromEntries(keys.map((k) => [k, boom(k)]));

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'overview');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

async function boot(options) {
  const opts = options || {};
  const answers = {};
  for (const key of READS) answers[ENDPOINTS[key]] = opts[key] === undefined ? GOOD[key]() : opts[key];

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/index.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      let answer = answers[endpoint];
      if (typeof answer === 'function') answer = answer();
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
  /* The states the shell put the pane in, in order, so a test can tell the
     degraded pane from the live one: both are shown by the same box. */
  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    states.push(String(state));
    return applyState.call(dom.window.Aria, state);
  };
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
  return Object.assign(dom, { states });
}

/* ------------------------------------------------------------- reading it */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const withClass = (root, cls) => findAll(root, (n) => classesOf(n).includes(cls));
const section = (dom, id) => dom.doc.getElementById('today-' + id);
const hasDigit = (text) => /\d/.test(text);
const retries = (root) => findAll(root, (n) => n.getAttribute && n.getAttribute('data-retry') !== null);
const WHOLE = 'This pane could not be read';
const OK = 'No critical issues';

function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1, `${boxes.length} panels are on screen at once`);
  return boxes[0];
}

const textsOf = (dom) => Object.fromEntries(Object.keys(DRAWN_FROM).map((id) => [id, allText(section(dom, id))]));

/* =============================== which sections ========================== */

test('a failed read takes away the sections that draw from it and leaves every other one as it was', async () => {
  const healthy = textsOf(await boot());
  /* A healthy render draws something in every section, or the comparison below
     proves nothing about the ones that draw nothing. */
  for (const id of Object.keys(DRAWN_FROM)) assert.ok(healthy[id].length > 0, id + ' is empty on a healthy render');

  for (const key of READS) {
    const down = textsOf(await boot(failing(key)));
    for (const [id, reads] of Object.entries(DRAWN_FROM)) {
      if (reads.includes(key)) {
        assert.notEqual(down[id], healthy[id], `${key} failed and the ${id} section did not change`);
      } else {
        assert.equal(down[id], healthy[id], `${key} failed and took the ${id} section with it`);
      }
    }
  }
});

test('the pane goes down as a whole only when every read it cannot do without has failed', async () => {
  const all = await boot(failing(...CORE));
  assert.ok(allText(shownPanel(all)).includes(WHOLE), 'every read failed and the pane did not say so');
  assert.equal(section(all, 'health'), null, 'a section is on a screen that failed as a whole');

  /* Six of seven is a page, whichever six it is. */
  for (const survivor of CORE) {
    const dom = await boot(failing(...CORE.filter((k) => k !== survivor)));
    assert.ok(section(dom, 'health'), `with only ${survivor} readable the page was taken down`);
    assert.ok(!allText(shownPanel(dom)).includes(WHOLE), `with only ${survivor} readable the pane said it was unreadable`);
  }
});

/* ========================= what a failed section says ===================== */

const FAILURES = [
  { read: 'problems', id: 'health', headline: 'Problems unread', says: false },
  { read: 'summary', id: 'people', headline: 'Active people could not be read', says: true },
  { read: 'usage', id: 'charts', headline: 'The daily lines could not be read', says: true },
  { read: 'jobs', id: 'jobs', headline: 'Jobs could not be read', says: true },
  { read: 'costs', id: 'spend', headline: 'Cloud spend could not be read', says: true },
];

test('a failed section says what went wrong, in the section that failed, and offers one retry', async () => {
  for (const f of FAILURES) {
    const dom = await boot(failing(f.read));
    const host = section(dom, f.id);
    const text = allText(host);
    assert.ok(text.includes(f.headline), `${f.read}: the failure is not named in ${f.id}: ${text}`);
    if (f.says) assert.ok(text.includes(`the ${f.read} read is down`), `${f.read}: what went wrong is not said`);
    assert.equal(retries(host).length, 1, `${f.read}: expected one retry in ${f.id}`);
    assert.equal(retries(shownPanel(dom)).length, f.read === 'summary' ? 2 : 1,
      `${f.read}: a failure drew a retry somewhere it does not belong`);
  }
});

test('a failed section never draws a numeral, because a gap is not a zero', async () => {
  const healthy = await boot();
  for (const f of FAILURES.filter((x) => x.id !== 'health')) {
    assert.ok(hasDigit(allText(section(healthy, f.id))), `${f.id} drew no numeral on a healthy render, so its absence proves nothing`);
    const text = allText(section(await boot(failing(f.read)), f.id));
    assert.ok(!hasDigit(text), `${f.id} drew a numeral from a read that failed: ${text}`);
    assert.ok(!/\$/.test(text), `${f.id} drew a price from a read that failed`);
  }
});

test('the head of the page takes its time from the jobs read when the summary failed, and prints none when neither landed', async () => {
  const healthy = await boot();
  const slot = (dom) => allText(dom.doc.getElementById('pageSub'));
  assert.ok(slot(healthy).length > 0);
  /* With the summary down the stamp falls back to the jobs read's own. */
  assert.ok(slot(await boot(failing('summary'))).length > 0);
  assert.equal(slot(await boot(failing('summary', 'jobs'))), '', 'a time was printed with no read to take it from');
});

test('the failure message has contact details masked, in a section and on the whole pane', async () => {
  const leaky = () => Object.assign(new Error('Could not reach alice@example.com just now'), { code: 'http_500' });
  const partly = await boot({ costs: leaky() });
  const text = allText(section(partly, 'spend'));
  assert.ok(text.includes('Could not reach'), 'the message did not arrive at all: ' + text);
  assert.ok(!text.includes('alice@example.com'), 'a contact address reached the screen: ' + text);

  const all = await boot(Object.fromEntries(CORE.map((k) => [k, leaky()])));
  const whole = allText(shownPanel(all));
  assert.ok(whole.includes('Could not reach'));
  assert.ok(!whole.includes('alice@example.com'), 'a contact address reached the whole-pane card');
});

test('a failure that carries no message is still said in words', async () => {
  const bare = Object.assign(new Error(''), { code: 'ops_unreachable' });
  const dom = await boot({ jobs: bare });
  assert.ok(allText(section(dom, 'jobs')).includes('Could not reach the operations API'),
    'a failure with only a code printed nothing: ' + allText(section(dom, 'jobs')));
  const nothing = await boot({ jobs: Object.assign(new Error(''), {}) });
  assert.ok(allText(section(nothing, 'jobs')).replace('Try again', '').length > 'Happening nowJobs could not be read'.length,
    'a failure with neither a message nor a code said nothing about what happened');
});

/* ============================= the AI tile, in two halves ================= */

test('the AI tile keeps the half it could read when the other half failed', async () => {
  const healthy = allText(section(await boot(), 'ai'));
  assert.ok(healthy.includes('4,820') && healthy.includes('24 / 25') && healthy.includes('worked'));

  const noSummary = allText(section(await boot(failing('summary')), 'ai'));
  assert.ok(noSummary.includes('AI runs could not be read'));
  assert.ok(!noSummary.includes('4,820'), 'a run count was drawn from a summary that failed');
  assert.ok(noSummary.includes('24 / 25') && noSummary.includes('worked'), 'the readable last day was thrown away with the summary');
  assert.ok(!noSummary.includes('Last 24h could not be read'));

  const noRuns = allText(section(await boot(failing('runs')), 'ai'));
  assert.ok(noRuns.includes('Last 24h could not be read'));
  assert.ok(noRuns.includes('4,820'), 'the readable run count was thrown away with the runs');
  assert.ok(!noRuns.includes('worked') && !noRuns.includes('24 / 25'), 'a success rate was drawn from a read that failed');
});

test('both halves failing say so separately and each has a retry of its own', async () => {
  const dom = await boot(failing('summary', 'runs'));
  const host = section(dom, 'ai');
  const text = allText(host);
  assert.ok(text.includes('AI runs could not be read') && text.includes('Last 24h could not be read'));
  const mine = retries(host).map((b) => b.getAttribute('data-retry')).sort();
  assert.deepEqual(mine, ['AI runs could not be read', 'Last 24h could not be read']);
  assert.ok(!withClass(host, 'ai-bar').length, 'a bar was drawn from a read that failed');
});

/* ======================= what the health line may not claim =============== */

test('an unreadable rules list does not make an open critical problem disappear', async () => {
  const critical = () => ({
    problems: [{ id: 'c', reference: 'PRB-1', severity: 'critical', status: 'open', title: 'Queue is down' }], total: 1,
  });
  const dom = await boot({ problems: critical(), rules: boom('rules') });
  assert.equal(allText(withClass(section(dom, 'health'), 'health-text')[0]), '1 critical issue',
    'the rules read failed and took the critical issue off the health line');
  assert.equal(withClass(section(dom, 'problems'), 'prob-row').length, 1);
  assert.equal(retries(section(dom, 'health')).length, 0, 'a retry was drawn beside a claim that did not need one');

  const quiet = await boot({ problems: { problems: [], total: 0 }, rules: boom('rules') });
  assert.equal(allText(withClass(section(quiet, 'health'), 'health-text')[0]), 'Checks unread');
  assert.equal(retries(section(quiet, 'health')).length, 1);
});

test('an unreadable problems read is never read as a quiet queue', async () => {
  const healthy = await boot();
  assert.ok(allText(section(healthy, 'health')).includes(OK) && allText(section(healthy, 'problems')).includes('Generation queue is slow'),
    'the healthy fixture did not reach the claim this test is about');

  const down = await boot(failing('problems'));
  const everything = allText(shownPanel(down));
  assert.ok(!everything.includes(OK), 'a queue nobody could read was reported as nothing being wrong');
  assert.ok(!everything.includes('Nobody on it') && !everything.includes('Since'), 'a row was drawn from a read that failed');
  assert.equal(withClass(section(down, 'problems'), 'prob-row').length, 0);
});

/* A reply that is not an error but carries no list is no more a queue than a
   failure is. `list()` turns anything that is not an array into an empty one,
   and an empty queue over healthy checks is the one input that prints the
   claim, so each of these has to be a failed read before it gets that far. */
const UNREADABLE_PROBLEMS = [
  ['an answer with no list in it', { total: 0 }],
  ['an empty answer', {}],
  ['no answer body', null],
  ['a list that is null', { problems: null, total: 0 }],
  ['an object where the list should be', { problems: {}, total: 0 }],
  ['a string where the list should be', { problems: 'none', total: 0 }],
  ['a number where the list should be', { problems: 0, total: 0 }],
  ['a row that is null', { problems: [null], total: 1 }],
  ['a row that is a string', { problems: ['PRB-1'], total: 1 }],
];

test('a problems answer with no readable list is a failed read, never a quiet queue', async () => {
  const quiet = await boot({ problems: { problems: [], total: 0 } });
  assert.ok(allText(section(quiet, 'health')).includes(OK),
    'an empty, readable queue over healthy checks did not claim ' + OK + ', so the cases below prove nothing');

  for (const [name, answer] of UNREADABLE_PROBLEMS) {
    const dom = await boot({ problems: answer });
    const everything = allText(shownPanel(dom));
    assert.ok(!everything.includes(OK), name + ' was reported as nothing being wrong');
    assert.equal(allText(withClass(section(dom, 'health'), 'health-text')[0]), 'Problems unread', name);
    assert.equal(retries(section(dom, 'health')).length, 1, name + ': the failed read has no retry');
    assert.equal(withClass(section(dom, 'problems'), 'prob-row').length, 0, name + ' drew a queue row');
    assert.equal(dom.states[dom.states.length - 1], 'degraded', name + ': the pane is not marked degraded');
    assert.deepEqual(
      findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('data-badge-key') === 'alerts')
        .flatMap((l) => withClass(l, 'nav-badge').map(allText)), [], name + ' set a badge');
  }
});

test('an unreadable problems list that is retried and comes back readable draws the claim', async () => {
  let answer = { total: 0 };
  const dom = await boot({ problems: () => answer });
  assert.equal(allText(withClass(section(dom, 'health'), 'health-text')[0]), 'Problems unread');
  answer = { problems: [], total: 0 };
  retries(section(dom, 'health'))[0].dispatchEvent({ type: 'click' });
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(allText(withClass(section(dom, 'health'), 'health-text')[0]), OK);
  assert.equal(dom.states[dom.states.length - 1], 'live');
});

test('one unreadable read does not mask the problem list with a failure of the checks', async () => {
  const dom = await boot(failing('rules'));
  assert.equal(withClass(section(dom, 'problems'), 'prob-row').length, 1, 'the problem row went with the rules');
  assert.equal(allText(withClass(section(dom, 'health'), 'health-text')[0]), 'Checks unread');
});

/* ================================ the whole card ========================== */

test('the whole-pane failure says what went wrong, offers one retry and draws no section behind it', async () => {
  const dom = await boot(failing(...CORE));
  const panel = shownPanel(dom);
  const text = allText(panel);
  assert.ok(text.includes(WHOLE));
  assert.ok(text.includes('the summary read is down'), 'the card does not say what went wrong: ' + text);
  assert.ok(text.includes('Nothing here is a zero'));
  assert.equal(findAll(panel, (n) => n.tagName === 'BUTTON').length, 1, 'the card has more than one button');
  for (const id of Object.keys(DRAWN_FROM)) assert.equal(section(dom, id), null, id + ' is drawn behind the whole-pane card');
  assert.deepEqual(retries(panel), [], 'the card is drawn with section retries');
});

test('the badge on the Health destination is not set by a problems read that failed', async () => {
  const badge = (dom) => findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('data-badge-key') === 'alerts')
    .flatMap((l) => withClass(l, 'nav-badge').map(allText));
  assert.ok(badge(await boot()).length > 0, 'the healthy render drew no badge, so its absence proves nothing');
  assert.deepEqual(badge(await boot(failing('problems'))), []);
});

/* ============================== no empty labels =========================== */

test('no degraded state is drawn as an empty heading, an empty button or an empty line', async () => {
  const sweeps = [[], ...READS.map((k) => [k]), ['summary', 'runs'], ['problems', 'rules'], CORE];
  let checked = 0;
  for (const keys of sweeps) {
    const dom = await boot(failing(...keys));
    const panel = shownPanel(dom);
    const nodes = findAll(panel, (n) => /^H[1-6]$/.test(String(n.tagName || ''))
      || n.tagName === 'BUTTON'
      || (n.getAttribute && ['sec-title', 'state-title', 'fail-why', 'health-text'].some((k) => classesOf(n).includes(k))));
    for (const n of nodes) {
      checked += 1;
      /* An icon-only button is named by its label, which is a name. */
      const name = allText(n).trim() || String(n.getAttribute('aria-label') || '').trim();
      assert.notEqual(name, '', `[${keys}] drew an unnamed <${String(n.tagName).toLowerCase()} class="${n.getAttribute('class') || ''}">`);
    }
    assert.ok(!/undefined|null|NaN|Invalid Date/.test(allText(panel)), `[${keys}] printed a placeholder: ${allText(panel)}`);
  }
  assert.ok(checked > 40, 'the sweep reached only ' + checked + ' labels, so it is not sweeping');
});
