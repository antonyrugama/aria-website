/* Unit tests for ops/assets/pane-run-history-v2.js — What happened, on the v2
   design system.

   What is worth testing here is everything the pane refuses to do, because
   every rule in that file's docblock is a rule about NOT drawing something,
   and none of them is visible to a screenshot or to a headless-Chrome overflow
   check:

     - the window is applied to the record that came back, and a problem that
       is still open belongs to today's window however long ago it fired;
     - a full page reads as a floor rather than a total, and says why;
     - a figure nothing records renders words and never a numeral;
     - a selection the record cannot act on is never offered: no app, no
       environment and no custom window, so one asked for in the URL changes
       nothing rather than being refused underneath its own control;
     - run content is hidden at every role, the owner included, with no control
       that could never succeed, and no value node in the markup at all;
     - anything address-shaped is masked before it reaches the DOM, on every
       payload string this pane draws.

   Every test here has a published mutation in the pull request: the exact file,
   the exact line, and the exact edit whose presence makes that test fail. A
   test with no such line is a test that pins nothing.

   The page-shape tests at the bottom read ops/run-history.html as text rather
   than booting it. Their mutation is the page itself. */
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
const PANE_SRC = read('assets/pane-run-history-v2.js');
const PAGE_SRC = read('run-history.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Timestamps are built relative to now, because the window under test is
   relative to now. A fixed date in a fixture ages into a different test. */
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* ------------------------------------------------------------- fixtures */

/* One problem, whole. Every test below starts here and changes one thing,
   because the rules under test are rules about a single difference. */
function problem(over) {
  return Object.assign({
    id: 41,
    reference: 'AO-41',
    ruleKey: 'ai_success_rate',
    ruleTitle: 'AI success rate',
    ruleThreshold: 'below 95% for 10 minutes',
    severity: 'critical',
    category: 'ai',
    categoryLabel: 'Aria runs',
    status: 'closed',
    title: 'Nutrition plans are failing',
    summary: 'Nine of the last twelve failed.',
    scopeKey: 'nutrition_plan',
    scopeLabel: 'Nutrition plans',
    observedValue: 74,
    thresholdValue: 95,
    durationSeconds: 600,
    firstBreachedAt: at(3 * DAY),
    firedAt: at(3 * DAY),
    lastObservedAt: at(3 * DAY - HOUR),
    conditionClearedAt: at(3 * DAY - HOUR),
    acknowledgedAt: null,
    closedAt: at(3 * DAY - HOUR),
    closeReason: 'resolved',
  }, over || {});
}

function rulesFixture(over) {
  const base = {
    rules: [
      {
        ruleKey: 'ai_success_rate', title: 'AI success rate', enabled: true,
        lastEvaluatedAt: at(4 * MINUTE), lastEvaluationStatus: 'ok', lastFiredAt: at(3 * DAY),
      },
      {
        ruleKey: 'queue_backlog_age', title: 'Queue backlog age', enabled: true,
        lastEvaluatedAt: at(4 * MINUTE), lastEvaluationStatus: 'ok', lastFiredAt: null,
      },
    ],
    channels: [],
  };
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'history');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/run-history.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const problems = opts.problems === undefined
    ? { problems: [problem()], summary: {} }
    : opts.problems;
  const answers = {
    '/api/ops/alerts/problems': problems,
    '/api/ops/alerts/rules': opts.rules === undefined ? rulesFixture() : opts.rules,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/run-history.html' + (opts.query || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  const role = opts.role || 'owner';
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query });
      const answer = answers[endpoint];
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => (roles || []).indexOf(role) !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-run-history-v2.js' });

  /* Which of the four states the pane asked for, in order. The live and
     degraded panels are the same element — aria.css shows one element for both
     words — so the DOM alone cannot tell a degraded pane from a whole one, and
     that difference is the point of two of the tests below. The shell reaches
     aria.js through this property at call time, so recording it here records
     what the pane actually asked for. */
  const applied = [];
  const realApply = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    applied.push(String(state));
    return realApply.apply(this, arguments);
  };

  await settle();

  return { ...dom, body, calls, answers, applied, content: dom.doc.getElementById('content') };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
}

/* The panel the operator can see. The loading, empty and live panels are
   siblings and aria.css hides the ones that are not current, so reading the
   whole region would read text nobody is looking at. */
function panelFor(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0];
}

const livePanel = (dom) => panelFor(dom, 'live');
const emptyPanel = (dom) => panelFor(dom, 'empty');
const liveText = (dom) => allText(livePanel(dom));
const emptyText = (dom) => allText(emptyPanel(dom));

/* The state the pane last asked for. */
function stateOf(dom) {
  return dom.applied[dom.applied.length - 1] || null;
}

function sectionWithHeading(dom, pattern) {
  return findAll(livePanel(dom), (n) => n.tagName === 'SECTION')
    .filter((n) => pattern.test(allText(n)))[0];
}

function rowsOfFailureTable(dom) {
  const section = sectionWithHeading(dom, /Why things failed/);
  if (!section) return [];
  const bodies = findAll(section, (n) => n.tagName === 'TBODY');
  return bodies.length ? findAll(bodies[0], (n) => n.tagName === 'TR') : [];
}

function tileText(dom, heading) {
  const tile = findAll(livePanel(dom), (n) => (n.getAttribute('class') || '').indexOf('kpi') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
  return tile ? allText(tile) : '';
}

function numerals(text) {
  return (text.match(/\d/g) || []).length;
}

function linksIn(node) {
  return findAll(node, (n) => n.tagName === 'A');
}

/* ========================== the window is real ========================== */

test('the window is applied to the record that came back', async () => {
  const rows = [
    problem({ id: 1, reference: 'AO-1', scopeKey: 'chat', scopeLabel: 'Chat replies' }),
    problem({
      id: 2, reference: 'AO-2', scopeKey: 'video', scopeLabel: 'Sprint video',
      firstBreachedAt: at(20 * DAY), firedAt: at(20 * DAY),
      lastObservedAt: at(20 * DAY - HOUR), closedAt: at(20 * DAY - HOUR),
    }),
  ];

  const week = await boot({ query: '?range=7d', problems: { problems: rows, summary: {} } });
  assert.match(liveText(week), /Chat replies/, 'the in-window failure was dropped');
  assert.doesNotMatch(liveText(week), /Sprint video/,
    'a failure 20 days old was counted inside a 7 day window');
  assert.match(tileText(week, /Failures raised/), /\b1\b/,
    'the count was taken over the whole record rather than the window');

  const month = await boot({ query: '?range=30d', problems: { problems: rows, summary: {} } });
  assert.match(liveText(month), /Sprint video/,
    'the same failure was dropped from a 30 day window, so the filter is not a window at all');
});

test('a problem that fired before the window but is still open stays in it', async () => {
  /* The failure somebody is still living with is the one a window must not
     drop. Comparing only the moment it fired would do exactly that. */
  const rows = [problem({
    status: 'open', closedAt: null, conditionClearedAt: null,
    firstBreachedAt: at(20 * DAY), firedAt: at(20 * DAY), lastObservedAt: at(2 * MINUTE),
  })];
  const dom = await boot({ query: '?range=24h', problems: { problems: rows, summary: {} } });
  assert.match(liveText(dom), /Nutrition plans/,
    'a problem still being observed this minute was dropped because it fired weeks ago');
});

/* ============================ floors, not totals ======================== */

test('a full page reads as a floor and says why', async () => {
  const many = [];
  for (let i = 0; i < 100; i += 1) {
    many.push(problem({ id: i, reference: 'AO-' + i, scopeKey: 'scope-' + i, scopeLabel: 'Type ' + i }));
  }
  const dom = await boot({ problems: { problems: many, summary: {} } });
  const text = liveText(dom);
  assert.match(tileText(dom, /Failures raised/), /At least/,
    'a full page printed a total rather than a floor');
  assert.match(text, /came back full/,
    'nothing said the record was truncated, so the floor has no explanation');

  const short = await boot({});
  assert.doesNotMatch(tileText(short, /Failures raised/), /At least/,
    'a short page was also called a floor, so the floor means nothing');
});

test('counts are of the window, not of the whole record', async () => {
  const rows = [
    problem({ id: 1, scopeKey: 'a', scopeLabel: 'Alpha' }),
    problem({ id: 2, scopeKey: 'b', scopeLabel: 'Beta' }),
    problem({
      id: 3, scopeKey: 'c', scopeLabel: 'Gamma',
      firedAt: at(40 * DAY), firstBreachedAt: at(40 * DAY),
      lastObservedAt: at(40 * DAY), closedAt: at(40 * DAY),
    }),
  ];
  const dom = await boot({ query: '?range=7d', problems: { problems: rows, summary: {} } });
  assert.match(tileText(dom, /Failures raised/), /\b2\b/,
    'the failures figure counted entries the window excluded');
  assert.match(tileText(dom, /Distinct reasons/), /\b2\b/,
    'the reasons figure counted entries the window excluded');
});

/* ====================== grouping answers the question =================== */

test('the same rule in the same request type is one reason, counted', async () => {
  const rows = [
    problem({ id: 1, firedAt: at(2 * DAY), firstBreachedAt: at(2 * DAY), lastObservedAt: at(2 * DAY) }),
    problem({ id: 2, firedAt: at(1 * DAY), firstBreachedAt: at(1 * DAY), lastObservedAt: at(1 * DAY) }),
  ];
  const dom = await boot({ problems: { problems: rows, summary: {} } });
  const table = rowsOfFailureTable(dom);
  assert.equal(table.length, 1, 'two firings of one rule on one request type drew two rows');
  assert.match(allText(table[0]), /\b2\b/, 'the grouped row did not say how many times');
});

test('the same rule in a different request type is a different reason', async () => {
  const rows = [
    problem({ id: 1 }),
    problem({ id: 2, scopeKey: 'chat', scopeLabel: 'Chat replies' }),
  ];
  const dom = await boot({ problems: { problems: rows, summary: {} } });
  assert.equal(rowsOfFailureTable(dom).length, 2,
    'two request types were folded into one reason, which is the question this pane answers');
});

/* ================= availability: words, never a numeral ================= */

test('a figure nothing records renders words and never a numeral', async () => {
  const dom = await boot({});
  const tile = tileText(dom, /Runs in this window/);
  assert.match(tile, /Not recorded/, 'an unrecorded figure did not say so');
  assert.equal(numerals(tile), 0,
    'an unrecorded figure printed a numeral, which reads as a measurement: ' + tile);
  assert.ok(numerals(tileText(dom, /Failures raised/)) > 0,
    'no tile printed a numeral at all, so this proves nothing');
});

/* ============ selections the shell can no longer hand over ============= */

/* The app and environment controls this pane used to draw are gone from the
   registry, and so is the custom window: the alerting record is kept per
   request type and covers production only, and a custom window has no start
   and no end for this bar to give it. The note, the staging refusal and the
   custom-window refusal are all replaced by the same stronger guarantee —
   the shell pins a filter the pane does not declare and clamps a window it
   does not offer, so none of the three is a selection the operator can reach.

   The window that IS declared is asserted to narrow by `the window is applied
   to the record that came back` above; this is only the other half. */
test('an app, an environment or a custom window in the URL changes nothing', async () => {
  const asked = await boot({ query: '?scope=mobile&env=staging&range=custom' });
  const plain = await boot({});

  /* Each boot runs in its own vm context, so its recorded calls carry that
     context's Object prototype and a strict deep comparison fails on two
     identical readings. JSON is the one shape both realms agree on. */
  const recorded = (dom) => JSON.parse(JSON.stringify(dom.calls));

  assert.equal(stateOf(asked), 'live',
    'a filter the pane does not declare took the page off the screen');
  assert.deepEqual(recorded(asked), recorded(plain),
    'a filter the pane does not declare reached the read: '
    + JSON.stringify(asked.calls));
  assert.equal(liveText(asked), liveText(plain),
    'a filter the pane does not declare changed what the page says');
  assert.match(liveText(asked), /last 7 days/i,
    'a window nothing offers was not clamped back to the one the pane starts on');
});

/* ======================= empty is never just zero ======================= */

test('an empty window says whether anything was watching', async () => {
  const watched = await boot({ problems: { problems: [], summary: {} } });
  assert.equal(stateOf(watched), 'empty');
  assert.match(emptyText(watched), /were checking/i,
    'an empty window claimed nothing had gone wrong without saying anything was watching');

  const unwatched = await boot({
    problems: { problems: [], summary: {} },
    rules: rulesFixture((r) => {
      r.rules.forEach((rule) => { rule.lastEvaluationStatus = 'insufficient_data'; });
    }),
  });
  assert.match(emptyText(unwatched), /nothing was watching/i,
    'an unwatched window read exactly like a quiet one');
  assert.doesNotMatch(emptyText(unwatched), /were checking/i,
    'the unwatched window also claimed rules were checking');
});

test('a live window says how much of it was watched', async () => {
  const dom = await boot({});
  assert.match(liveText(dom), /2 of 2 rules were checking/,
    'the figures were printed with nothing saying what produced them');

  const half = await boot({
    rules: rulesFixture((r) => { r.rules[1].lastEvaluationStatus = 'insufficient_data'; }),
  });
  assert.match(liveText(half), /1 of 2 rules were checking/,
    'the watching line is fixed text rather than a reading of the rules');
});

/* ============================== read failures ========================== */

test('the rules read failing degrades the pane rather than emptying it', async () => {
  const dom = await boot({ rules: new Error('rules are down') });
  assert.equal(stateOf(dom), 'degraded',
    'one unreadable read either took the whole pane down or was hidden entirely');
  assert.match(liveText(dom), /Nutrition plans/, 'the half that answered was thrown away');
  assert.match(liveText(dom), /could not be read/i,
    'the half that failed was passed over in silence');
});

test('the record read failing is a failure and never an empty window', async () => {
  const dom = await boot({ problems: new Error('the record is down') });
  const text = allText(dom.doc.getElementById('content'));
  assert.match(text, /could not be read/i, 'a failed read was not named as one');
  assert.doesNotMatch(text, /Nothing was raised/i,
    'a read that never landed was reported as a window with nothing in it');
});

/* ============================ the privacy band ========================== */

function privacyBand(dom) {
  return sectionWithHeading(dom, /What was asked, and what Aria answered/);
}

test('run content is hidden at every role, the owner included', async () => {
  for (const role of ['owner', 'operator', 'viewer']) {
    const dom = await boot({ role });
    const band = privacyBand(dom);
    assert.ok(band, 'the privacy band is missing for ' + role);
    const text = allText(band);
    const never = (text.match(/Never shown here/g) || []).length;
    assert.equal(never, 3,
      'expected three locked fields to say so for ' + role + ', found ' + never);
    assert.match(text, /What was asked/);
    assert.match(text, /What Aria answered/);
    assert.match(text, /Athlete details the run read/);
  }
});

test('the privacy band offers no control, not even a disabled one', async () => {
  const dom = await boot({ role: 'owner' });
  const band = privacyBand(dom);
  const controls = findAll(band, (n) => n.tagName === 'BUTTON' || n.tagName === 'INPUT');
  assert.equal(controls.length, 0,
    'a control that can never succeed tells an operator the value is within reach');
});

test('a locked row carries a field name and no value node at all', async () => {
  const dom = await boot({});
  const rows = findAll(privacyBand(dom),
    (n) => (n.getAttribute('class') || '').split(/\s+/).indexOf('locked-row') !== -1);
  assert.equal(rows.length, 3, 'the locked rows are not three rows');
  rows.forEach((row) => {
    const text = allText(row);
    assert.match(text, /Hidden/, 'a locked row did not say it was hidden');
    assert.doesNotMatch(text, /[a-z]{3,}@|:\s*"/,
      'a locked row carried something that looks like a value: ' + text);
  });
});

test('the six guarantees are on screen as sentences', async () => {
  const dom = await boot({});
  const items = findAll(privacyBand(dom), (n) => n.tagName === 'LI');
  assert.equal(items.length, 6, 'the six guarantees are not six sentences');
  const text = items.map(allText).join(' | ');
  [
    /names a person/i,
    /hidden for every role/i,
    /written reason/i,
    /by field name/i,
    /athlete can see/i,
    /outlive the reveal/i,
  ].forEach((pattern) => {
    assert.match(text, pattern, 'a guarantee is missing from the band');
  });
});

test('address-shaped text is masked before it reaches the screen', async () => {
  const leaky = problem({
    ruleTitle: 'AI success rate for athlete@example.invalid',
    scopeLabel: 'Nutrition plans (coach@example.invalid)',
    categoryLabel: 'Aria runs, reported by ops@example.invalid',
    ruleThreshold: 'below 95%, notified to oncall@example.invalid',
  });
  const dom = await boot({ problems: { problems: [leaky], summary: {} } });
  const text = liveText(dom);
  assert.doesNotMatch(text, /@example\.invalid/,
    'an address the API sent was drawn in the clear on a pane that promises it never is');
  assert.equal((text.match(/\[hidden contact detail\]/g) || []).length, 4,
    'the four addresses were not all replaced by a named hole');
});

/* ========================= colour is never alone ======================= */

test('status is words as well as tone', async () => {
  const dom = await boot({
    problems: {
      problems: [problem({ status: 'open', closedAt: null, conditionClearedAt: null })],
      summary: {},
    },
  });
  const row = rowsOfFailureTable(dom)[0];
  const pills = findAll(row, (n) => (n.getAttribute('class') || '').indexOf('pill') !== -1);
  assert.ok(pills.length >= 2, 'the row carries fewer pills than it draws');
  pills.forEach((pill) => {
    assert.ok(allText(pill).trim().length > 0,
      'a status pill said its state in colour alone');
  });
  assert.match(allText(row), /still open/i, 'an open failure did not say it was still open');
});

/* ============================== the doorways =========================== */

test('every doorway points at the pane the registry says owns it', async () => {
  const dom = await boot({});
  const hrefs = linksIn(livePanel(dom)).map((a) => a.getAttribute('href'));
  assert.ok(hrefs.some((href) => href && href.split('?')[0] === 'alerts.html'),
    'the failure table does not open the pane that owns problems: ' + hrefs.join(', '));
  assert.ok(hrefs.some((href) => href && href.split('?')[0] === 'users.html'),
    'the privacy band does not point at the pane that records a reveal: ' + hrefs.join(', '));

  const quiet = await boot({ problems: { problems: [], summary: {} } });
  const empties = linksIn(emptyPanel(quiet)).map((a) => a.getAttribute('href'));
  assert.ok(empties.some((href) => href && href.split('?')[0] === 'jobs-live.html'),
    'an empty window offers no way to the present tense: ' + empties.join(', '));
});

/* ============================== the read itself ======================== */

test('the read carries the querystring as well as the path', async () => {
  const dom = await boot({});
  const record = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems')[0];
  assert.ok(record, 'the record was never read');
  /* Compared field by field: the object was built inside the VM realm, so a
     deep-equality check against a literal from this one fails on the
     prototype rather than on the values. */
  assert.ok(record.query, 'the read carried no querystring at all, so a request nobody ' +
    'made is answered under the operator own selection');
  assert.equal(record.query.status, 'all', 'the record was read for the wrong statuses');
  assert.equal(record.query.limit, 100, 'the record was read with the wrong page size');
});

test('the past tense includes problems somebody already closed', async () => {
  const dom = await boot({});
  const record = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems')[0];
  assert.equal(record.query.status, 'all',
    'a pane called What happened asked only for what is still happening');
  assert.match(liveText(dom), /all closed/i,
    'a closed failure was dropped from the record of what happened');
});

/* ============================= the page shape ========================== */

test('the page loads one design system, not two', () => {
  assert.doesNotMatch(PAGE_SRC, /assets\/ops\.css/, 'the v1 stylesheet is still loaded');
  assert.doesNotMatch(PAGE_SRC, /assets\/operate\.css/, 'the v1 pane stylesheet is still loaded');
  assert.doesNotMatch(PAGE_SRC, /assets\/shell\.js/, 'the v1 shell is still loaded');
  assert.match(PAGE_SRC, /assets\/aria\.css/);
  assert.match(PAGE_SRC, /assets\/shell-pane-v2\.css/);
  assert.match(PAGE_SRC, /assets\/pane-run-history-v2\.css/);
  assert.match(PAGE_SRC, /data-pane="history"/,
    'the v2 shell keys on data-pane, so the page names no pane at all');
  assert.doesNotMatch(PAGE_SRC, /data-page=/,
    'the page still claims the v1 shell as well, and both would boot');
});

test('the scripts load in the order the bootstrap needs', () => {
  const order = ['assets/theme.js', 'assets/pane-registry.js', 'assets/api.js',
    'assets/session.js', 'assets/aria.js', 'assets/shell-pane-v2.js',
    'assets/alerts-model.js', 'assets/pane-run-history-v2.js'];
  const positions = order.map((src) => PAGE_SRC.indexOf(src));
  positions.forEach((pos, i) => {
    assert.notEqual(pos, -1, order[i] + ' is not loaded at all');
    if (i > 0) {
      assert.ok(pos > positions[i - 1],
        order[i] + ' loads before ' + order[i - 1] + ', which it depends on');
    }
  });
});

/* The monorepo's route-parity guard parses ops/**\/*.js and sweeps everything
   else: an /api/ops path in a file it cannot parse fails that build, in
   somebody else's pull request. */
test('the page mentions no API path, because only scripts are parsed', () => {
  assert.doesNotMatch(PAGE_SRC, /\/api\/ops/,
    'an ops path in the HTML reds the route-parity guard in the backend repository');
});

test('the pane module writes no markup and no style attribute', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'pane-run-history-v2.js reaches for innerHTML');
  assert.ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(PANE_SRC));
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(PANE_SRC),
    'pane-run-history-v2.js writes a style attribute');
  assert.ok(!/\sstyle="/.test(PAGE_SRC), 'run-history.html carries a style attribute');
});

/* The one thing a screen reader needs and no screenshot shows. This pane draws
   no chart, so every svg on it is an icon: decorative, hidden, and never the
   only carrier of a fact. role="img" is children-presentational, so a glyph
   that claimed one would take its own <title> off the accessibility tree with
   it. */
test('every glyph is decorative and no status is a glyph alone', async () => {
  const dom = await boot({});
  const svgs = findAll(dom.content, (n) => n.tagName === 'svg');
  assert.ok(svgs.length > 4, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'a glyph is announced');
    assert.equal(svg.getAttribute('role'), null, 'a glyph carries a role');
  }
  const pills = findAll(livePanel(dom),
    (n) => (n.getAttribute('class') || '').split(/\s+/).indexOf('pill') !== -1);
  assert.ok(pills.length > 0, 'no pills at all, so this proves nothing');
  for (const pill of pills) {
    assert.ok(allText(pill).trim().length > 0, 'a pill says nothing but its colour');
  }
});
