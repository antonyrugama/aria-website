/* Unit tests for ops/assets/pane-jobs-live-v2.js — Happening now, on the v2
   design system.

   The one thing this pane exists to get right is the difference between a
   queue that is slow and a queue that is wedged. They are different problems
   with different fixes, they look identical in a screenshot, and no overflow
   check or contrast oracle can see which one the pane said. So most of what is
   below is about that distinction and about the third answer, which is that
   the pane cannot tell:

     - a queue whose front has not moved since it crossed the line reads STUCK;
     - a queue that has drained past its old front reads MOVING, BEHIND;
     - where the unit, the observation or the breach start is missing, the
       verdict is CANNOT TELL, and is never rounded up to the alarming one;
     - work that is flowing and failing is a third fact, not a fourth kind of
       queue;
     - a figure nothing records renders words and never a numeral;
     - staging is refused before the read, not after it;
     - no control is drawn that could never succeed.

   Every test here has a published mutation in the pull request: the exact
   file, the exact line, and the exact edit whose presence makes that test
   fail. A test with no such line is a test that pins nothing.

   The page-shape tests at the bottom read ops/jobs-live.html as text rather
   than booting it. Their mutation is the page itself. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-jobs-live-v2.js');
const PAGE_SRC = read('jobs-live.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Relative to now, because every reading under test is relative to now. A
   fixed date in a fixture ages into a different test. */
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* ------------------------------------------------------------- fixtures */

/* A queue that is over the line. `observed` is the age of the job at the front
   of it in seconds, and the breach window is an hour wide, so a fixture that
   passes `observed` at or above 3540 is a queue whose front has not moved. */
function queueProblem(over) {
  return Object.assign({
    id: 110,
    reference: 'AO-110',
    ruleKey: 'queue_backlog_age',
    ruleTitle: 'Queue backlog',
    ruleThreshold: 'over 10 minutes, held for 5 minutes',
    severity: 'critical',
    category: 'infrastructure',
    categoryLabel: 'Infrastructure',
    status: 'open',
    title: 'Jobs are waiting',
    summary: 'The oldest queued job is over the line.',
    scopeKey: 'video_analysis',
    scopeLabel: 'Sprint video',
    observedValue: 3600,
    thresholdValue: 600,
    durationSeconds: 300,
    workPane: 'jobs-live',
    workPaneLabel: 'Happening now',
    firstBreachedAt: at(60 * MINUTE),
    firedAt: at(55 * MINUTE),
    lastObservedAt: at(1 * MINUTE),
    conditionClearedAt: null,
    acknowledgedAt: null,
    closedAt: null,
    closeReason: null,
  }, over || {});
}

function failingProblem(over) {
  return Object.assign({
    id: 118,
    reference: 'AO-118',
    ruleKey: 'ai_success_rate',
    ruleTitle: 'AI success rate',
    ruleThreshold: 'below 95%, over 10 minutes',
    severity: 'critical',
    category: 'ai_reliability',
    categoryLabel: 'AI reliability',
    status: 'open',
    title: 'Nutrition plans are failing',
    summary: 'Nine of the last twelve failed.',
    scopeKey: 'nutrition_plan',
    scopeLabel: 'Nutrition plans',
    observedValue: 8800,
    thresholdValue: 9500,
    durationSeconds: 600,
    workPane: 'jobs-live',
    workPaneLabel: 'Happening now',
    firstBreachedAt: at(30 * MINUTE),
    firedAt: at(20 * MINUTE),
    lastObservedAt: at(1 * MINUTE),
    conditionClearedAt: null,
    acknowledgedAt: null,
    closedAt: null,
    closeReason: null,
  }, over || {});
}

function elsewhereProblem(over) {
  return Object.assign({}, failingProblem({
    id: 130,
    reference: 'AO-130',
    ruleKey: 'spend_forecast',
    ruleTitle: 'Spend forecast',
    severity: 'warning',
    category: 'cost',
    categoryLabel: 'Cost',
    scopeKey: 'azure',
    scopeLabel: 'Azure, month to date',
    workPane: 'spend',
    workPaneLabel: 'Cloud costs',
  }), over || {});
}

function rulesFixture(over) {
  const base = {
    rules: [
      {
        ruleKey: 'queue_backlog_age', title: 'Queue backlog', enabled: true,
        thresholdUnit: 'seconds', thresholdValue: 600, durationSeconds: 300,
        thresholdLabel: 'over 10 minutes, held for 5 minutes',
        lastEvaluatedAt: at(3 * MINUTE), lastEvaluationStatus: 'firing', lastFiredAt: at(55 * MINUTE),
      },
      {
        ruleKey: 'ai_success_rate', title: 'AI success rate', enabled: true,
        thresholdUnit: 'basis_points', thresholdValue: 9500, durationSeconds: 600,
        thresholdLabel: 'below 95%, over 10 minutes',
        lastEvaluatedAt: at(3 * MINUTE), lastEvaluationStatus: 'ok', lastFiredAt: at(20 * MINUTE),
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
  body.setAttribute('data-pane', 'jobs');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/jobs-live.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const problems = opts.problems === undefined
    ? { problems: [queueProblem()], summary: {} }
    : opts.problems;
  const answers = {
    '/api/ops/alerts/problems': problems,
    '/api/ops/alerts/rules': opts.rules === undefined ? rulesFixture() : opts.rules,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/jobs-live.html' + (opts.query || ''),
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-jobs-live-v2.js' });

  /* Which of the four states the pane asked for, in order. The live and
     degraded panels are the same element, so the DOM alone cannot tell a
     degraded pane from a whole one, and that difference is the point of two of
     the tests below. */
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

function hasClass(node, name) {
  return (node.getAttribute('class') || '').split(/\s+/).indexOf(name) !== -1;
}

function queueRows(dom) {
  const section = sectionWithHeading(dom, /Waiting, and whether it is moving/);
  return section ? findAll(section, (n) => hasClass(n, 'queue-row')) : [];
}

function heroText(dom) {
  const hero = findAll(livePanel(dom), (n) => hasClass(n, 'hero'))[0];
  return hero ? allText(hero) : '';
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

/* ===================== working, behind, stuck are three ================= */

test('a queue whose front has not moved since it crossed the line reads stuck', async () => {
  /* Breach began 60 minutes ago and was last measured a minute ago, so it has
     been over the line for 59 minutes. The job at the front has been waiting
     60. It was therefore already there when the breach began: nothing has left
     the front of that queue since. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: 3600 })], summary: {} },
  });
  const rows = queueRows(dom);
  assert.equal(rows.length, 1, 'the queue band drew no row for a queue that is over the line');
  const text = allText(rows[0]);
  assert.match(text, /Stuck/, 'a wedged queue was not called stuck');
  assert.doesNotMatch(text, /Moving/, 'a wedged queue was also called moving');
});

test('a queue that has drained past its old front reads moving, behind', async () => {
  /* Same 59 minute breach, but the job at the front has only been waiting 11
     minutes, so the queue has emptied past its old front at least once. Work
     is leaving; it is arriving faster. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: 660 })], summary: {} },
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Moving, behind/, 'a draining queue was not called moving');
  assert.doesNotMatch(text, /Stuck/,
    'a queue that is draining was called stuck, which sends somebody to restart workers ' +
    'that are working');
});

test('the two verdicts can be on screen at once and stay different', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({ observedValue: 3600, scopeKey: 'video', scopeLabel: 'Sprint video' }),
        queueProblem({
          id: 111, reference: 'AO-111', observedValue: 660,
          scopeKey: 'chat', scopeLabel: 'Chat replies',
        }),
      ],
      summary: {},
    },
  });
  const rows = queueRows(dom);
  assert.equal(rows.length, 2, 'two queues over the line did not draw two rows');
  const byScope = {};
  rows.forEach((row) => {
    const text = allText(row);
    byScope[/Sprint video/.test(text) ? 'video' : 'chat'] = text;
  });
  assert.match(byScope.video, /Stuck/, 'the wedged queue lost its verdict');
  assert.match(byScope.chat, /Moving, behind/, 'the draining queue lost its verdict');
});

test('a verdict is never read from an observation with no unit', async () => {
  /* The observed figure is a bare number on the problem; its unit lives on the
     rules read. Without the unit, 3600 could be seconds, milliseconds or jobs,
     and a verdict derived from a guess is worse than no verdict. */
  const dom = await boot({
    rules: rulesFixture((r) => { r.rules[0].thresholdUnit = null; }),
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Cannot tell/, 'a verdict was reached without the unit of the observation');
  assert.doesNotMatch(text, /Stuck|Moving, behind/,
    'an unreadable observation produced one of the two verdicts anyway');
});

test('a missing observation is cannot tell, and never the alarming one', async () => {
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: null })], summary: {} },
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Cannot tell/, 'a missing observation did not say so');
  assert.doesNotMatch(text, /Stuck/,
    'a missing observation was rounded up to stuck, which is the guess this pane must not make');
});

test('a missing breach start is cannot tell, because there is no span to compare', async () => {
  const dom = await boot({
    problems: { problems: [queueProblem({ firstBreachedAt: null })], summary: {} },
  });
  assert.match(allText(queueRows(dom)[0]), /Cannot tell/,
    'a span measured from a missing start was treated as a span');
});

/* ========================== the hero says which ========================= */

test('the hero names the fact, not just that something is wrong', async () => {
  const stuck = await boot({
    problems: { problems: [queueProblem({ observedValue: 3600 })], summary: {} },
  });
  assert.match(heroText(stuck), /is stuck/, 'the hero did not say the queue was stuck');

  const behind = await boot({
    problems: { problems: [queueProblem({ observedValue: 660 })], summary: {} },
  });
  assert.match(heroText(behind), /is behind/, 'the hero did not say the queue was behind');
  assert.doesNotMatch(heroText(behind), /is stuck/,
    'the hero called a draining queue stuck, which is the whole distinction collapsed');
});

test('work that is flowing and failing is a third fact, not a queue', async () => {
  const dom = await boot({
    problems: { problems: [failingProblem()], summary: {} },
  });
  const hero = heroText(dom);
  assert.match(hero, /failing/, 'a failing request type was not named as failing');
  assert.doesNotMatch(hero, /stuck|behind|queue/i,
    'work that is flowing and failing was reported as a queue: ' + hero);
  assert.match(liveText(dom), /Nothing is waiting/,
    'nothing said that this is not a queue at all');
  assert.equal(queueRows(dom).length, 0, 'a failing run drew a queue row');
});

test('the failing figure is a percentage only while its unit says so', async () => {
  const known = await boot({ problems: { problems: [failingProblem()], summary: {} } });
  assert.match(liveText(known), /finishing cleanly 88\.0%/,
    'a basis-points observation was not turned into a percentage');

  const unreadable = await boot({
    problems: { problems: [failingProblem()], summary: {} },
    rules: rulesFixture((r) => { r.rules[1].thresholdUnit = 'ratio'; }),
  });
  const text = liveText(unreadable);
  assert.match(text, /finishing cleanly not readable/,
    'an observation whose unit is not basis points was printed as a percentage anyway');
  assert.doesNotMatch(text, /88\.0%|8800/,
    'the bare number reached the screen under a unit that does not fit it');
});

test('a problem that belongs to another pane says so and does not become a queue', async () => {
  const dom = await boot({
    problems: { problems: [elsewhereProblem()], summary: {} },
  });
  assert.equal(queueRows(dom).length, 0, 'a cost problem was drawn as a queue');
  const section = sectionWithHeading(dom, /Open elsewhere/);
  assert.ok(section, 'a problem owned by another pane was dropped entirely');
  const hrefs = linksIn(section).map((a) => a.getAttribute('href'));
  assert.ok(hrefs.some((href) => href && href.split('?')[0] === 'spend.html'),
    'the doorway does not point at the pane that owns the work: ' + hrefs.join(', '));
});

/* ================= availability: words, never a numeral ================= */

test('a figure nothing records renders words and never a numeral', async () => {
  const dom = await boot({});
  const tile = tileText(dom, /Jobs running/);
  assert.match(tile, /Not recorded/, 'an unrecorded figure did not say so');
  assert.equal(numerals(tile), 0,
    'an unrecorded figure printed a numeral, which reads as a measurement: ' + tile);
  assert.ok(numerals(tileText(dom, /Needs a person/)) > 0,
    'no tile printed a numeral at all, so this proves nothing');
});

test('the oldest wait is a duration when it is known and words when it is not', async () => {
  const known = await boot({
    problems: { problems: [queueProblem({ observedValue: 3600 })], summary: {} },
  });
  assert.match(tileText(known, /Oldest job waiting/), /1h 0m|60m/,
    'a known wait was not printed as a duration');

  const unreadable = await boot({
    rules: rulesFixture((r) => { r.rules[0].thresholdUnit = null; }),
  });
  const tile = tileText(unreadable, /Oldest job waiting/);
  assert.match(tile, /Cannot be read/, 'an unreadable wait did not say so');
  assert.equal(numerals(tile), 0, 'an unreadable wait printed a numeral anyway: ' + tile);

  const quiet = await boot({
    problems: { problems: [failingProblem()], summary: {} },
  });
  assert.match(tileText(quiet, /Oldest job waiting/), /Not over the line/,
    'with no queue over the line the tile did not say that is why it has no figure');
});

/* ===================== selections the read cannot act on ================ */

test('staging is refused before the read, not after it', async () => {
  const dom = await boot({ query: '?env=staging' });
  assert.equal(stateOf(dom), 'empty', 'a staging selection drew production figures');
  assert.match(emptyText(dom), /no staging record/i, 'the refusal did not say what was missing');
  assert.equal(dom.calls.length, 0,
    'the pane read production and then hid the answer, rather than not reading it');
});

test('an app selection says plainly that it narrows nothing', async () => {
  const dom = await boot({ query: '?scope=mobile' });
  assert.match(liveText(dom), /per request type, not per app/i,
    'an app filter was accepted silently over figures it cannot narrow');

  const all = await boot({ query: '?scope=all' });
  assert.doesNotMatch(liveText(all), /per request type, not per app/i,
    'the note is unconditional, so it says nothing about the selection');
});

/* ======================= empty is never just zero ======================= */

test('an empty page says whether anything was watching', async () => {
  const watched = await boot({ problems: { problems: [], summary: {} } });
  assert.equal(stateOf(watched), 'empty');
  assert.match(emptyText(watched), /were checking/i,
    'an empty page claimed all was well without saying anything was watching');

  const unwatched = await boot({
    problems: { problems: [], summary: {} },
    rules: rulesFixture((r) => {
      r.rules.forEach((rule) => { rule.lastEvaluationStatus = 'insufficient_data'; });
    }),
  });
  assert.match(emptyText(unwatched), /nothing is watching/i,
    'an unwatched system read exactly like a quiet one');
  assert.doesNotMatch(emptyText(unwatched), /were checking/i,
    'the unwatched page also claimed rules were checking');
});

test('an empty page offers the way to what happened earlier', async () => {
  const dom = await boot({ problems: { problems: [], summary: {} } });
  const hrefs = linksIn(emptyPanel(dom)).map((a) => a.getAttribute('href'));
  assert.ok(hrefs.some((href) => href && href.split('?')[0] === 'run-history.html'),
    'a quiet page offers no way to the past tense: ' + hrefs.join(', '));
});

/* ============================== read failures ========================== */

test('the rules read failing degrades the pane and takes the verdict with it', async () => {
  const dom = await boot({ rules: new Error('rules are down') });
  assert.equal(stateOf(dom), 'degraded',
    'one unreadable read either took the whole pane down or was hidden entirely');
  assert.match(liveText(dom), /Sprint video/, 'the half that answered was thrown away');
  assert.match(allText(queueRows(dom)[0]), /Cannot tell/,
    'a verdict survived the read that carries the unit it depends on');
});

test('the record read failing is a failure and never a quiet page', async () => {
  const dom = await boot({ problems: new Error('the record is down') });
  const text = allText(dom.doc.getElementById('content'));
  assert.match(text, /could not be read/i, 'a failed read was not named as one');
  assert.doesNotMatch(text, /Nothing is being reported/i,
    'a read that never landed was reported as a system with nothing wrong');
});

/* ============================ floors, not totals ======================== */

test('a full page reads as a floor and says why', async () => {
  const many = [];
  for (let i = 0; i < 100; i += 1) {
    many.push(queueProblem({ id: i, reference: 'AO-' + i, scopeKey: 's' + i, scopeLabel: 'Type ' + i }));
  }
  const dom = await boot({ problems: { problems: many, summary: {} } });
  assert.match(tileText(dom, /Needs a person/), /At least/,
    'a full page printed a total rather than a floor');
  assert.match(liveText(dom), /came back, worst first/,
    'nothing said the page was truncated, so the floor has no explanation');

  const short = await boot({});
  assert.doesNotMatch(tileText(short, /Needs a person/), /At least/,
    'a short page was also called a floor, so the floor means nothing');
});

/* ============================== the ordering =========================== */

test('the worst queue is first, and a longer breach breaks the tie', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({
          id: 1, reference: 'AO-1', severity: 'warning', scopeKey: 'a', scopeLabel: 'Warning queue',
        }),
        queueProblem({
          id: 2, reference: 'AO-2', severity: 'critical', scopeKey: 'b', scopeLabel: 'Newer critical',
          firstBreachedAt: at(10 * MINUTE),
        }),
        queueProblem({
          id: 3, reference: 'AO-3', severity: 'critical', scopeKey: 'c', scopeLabel: 'Older critical',
          firstBreachedAt: at(6 * HOUR),
        }),
      ],
      summary: {},
    },
  });
  const order = queueRows(dom).map(allText);
  assert.match(order[0], /Older critical/,
    'the queue that has been over the line longest was not first among equals');
  assert.match(order[1], /Newer critical/, 'the two criticals are not together at the top');
  assert.match(order[2], /Warning queue/, 'a warning outranked a critical');
});

/* ========================= colour is never alone ======================= */

test('every verdict carries its words as well as its tone', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({ observedValue: 3600 }),
        queueProblem({ id: 2, reference: 'AO-2', observedValue: 660, scopeKey: 'c', scopeLabel: 'Chat replies' }),
      ],
      summary: {},
    },
  });
  const pills = findAll(livePanel(dom), (n) => hasClass(n, 'pill'));
  assert.ok(pills.length >= 4, 'the pane draws fewer pills than it should, so this proves little');
  pills.forEach((pill) => {
    assert.ok(allText(pill).trim().length > 0, 'a pill said its state in colour alone');
  });
});

/* ===================== no control that cannot succeed =================== */

test('the pane draws no control it has no route for', async () => {
  const dom = await boot({
    problems: { problems: [queueProblem(), failingProblem()], summary: {} },
  });
  const controls = findAll(livePanel(dom),
    (n) => n.tagName === 'BUTTON' || n.tagName === 'INPUT');
  assert.equal(controls.length, 0,
    'a control that can never succeed tells an operator the thing is within reach');
  assert.match(liveText(dom), /Cancel, retry and export/,
    'the three controls the design asks for were dropped silently rather than named');
});

/* ============================== the read itself ======================== */

test('the read asks for what is happening now, and carries the querystring', async () => {
  const dom = await boot({});
  const record = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems')[0];
  assert.ok(record, 'the record was never read');
  assert.ok(record.query, 'the read carried no querystring at all, so a request nobody made ' +
    'is answered under the operator own selection');
  assert.equal(record.query.status, 'open',
    'a pane called Happening now asked for problems that are not happening now');
  assert.equal(record.query.limit, 100, 'the record was read with the wrong page size');
});

/* ============================ masking, still ========================== */

test('address-shaped text is masked before it reaches the screen', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({ scopeLabel: 'Sprint video (ops@example.invalid)' }),
        elsewhereProblem({ ruleTitle: 'Spend forecast, watched by finance@example.invalid' }),
      ],
      summary: {},
    },
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /@example\.invalid/,
    'an address the API sent was drawn in the clear');
  /* Counted per source rather than in total, because a label the pane draws
     twice would make a total pass while one of the two call sites leaked. */
  assert.match(text, /Sprint video \[hidden contact detail\]/,
    'the address inside a request-type label was not replaced by a named hole');
  assert.match(text, /watched by \[hidden contact detail\]/,
    'the address inside another pane rule title was not replaced by a named hole');
});

/* ============================= the page shape ========================== */

test('the page loads one design system, not two', () => {
  assert.match(PAGE_SRC, /assets\/aria\.css/, 'the v2 design system is missing');
  assert.match(PAGE_SRC, /assets\/shell-pane-v2\.css/, 'the v2 pane chrome is missing');
  assert.match(PAGE_SRC, /assets\/pane-jobs-live-v2\.css/, "the pane's own sheet is missing");
  for (const v1 of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js', 'assets/icons.js']) {
    assert.ok(PAGE_SRC.indexOf(v1) === -1,
      v1 + ' is loaded beside the v2 system, and both define .card, .rail, .btn and .pill');
  }
});

test('the scripts load in the order the bootstrap needs', () => {
  const order = ['assets/theme.js', 'assets/pane-registry.js', 'assets/api.js', 'assets/session.js',
    'assets/aria.js', 'assets/shell-pane-v2.js', 'assets/alerts-model.js',
    'assets/pane-jobs-live-v2.js'];
  let last = -1;
  for (const src of order) {
    const at2 = PAGE_SRC.indexOf(src);
    assert.ok(at2 > last, src + ' is missing or loads out of order');
    last = at2;
  }
});

test('the page mentions no API path, because only scripts are parsed', () => {
  assert.ok(PAGE_SRC.indexOf('/api/ops') === -1,
    'the route guard reads every non-script file under ops/ and fails on any it cannot parse');
});

test('the pane module writes no markup and no style attribute', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'pane-jobs-live-v2.js reaches for innerHTML');
  assert.ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(PANE_SRC));
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(PANE_SRC),
    'pane-jobs-live-v2.js writes a style attribute');
  assert.ok(!/\sstyle="/.test(PAGE_SRC), 'jobs-live.html carries a style attribute');
});

/* This pane has no chart, so every svg on it is an icon: decorative, hidden,
   and never the only carrier of a fact. role="img" is children-presentational,
   so a glyph that claimed one would take its own title off the accessibility
   tree with it. */
test('every glyph is decorative and no status is a glyph alone', async () => {
  const dom = await boot({});
  const svgs = findAll(dom.content, (n) => n.tagName === 'svg');
  assert.ok(svgs.length > 4, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'a glyph is announced');
    assert.equal(svg.getAttribute('role'), null, 'a glyph carries a role');
  }
});

/* The v1 module these two panes shared. What happened left it in #60 and this
   change is the last page that loaded it, so it goes. A file nothing loads is
   a file the next reader has to work out is dead. */
test('the shared awaiting-data module is gone and nothing reaches for it', () => {
  assert.ok(!existsSync(new URL('assets/pane-awaiting-data.js', OPS)),
    'pane-awaiting-data.js still exists, and no page loads it any more');
  assert.ok(PAGE_SRC.indexOf('pane-awaiting-data') === -1,
    'jobs-live.html still loads the module this change retires');
  assert.ok(read('run-history.html').indexOf('pane-awaiting-data') === -1,
    'What happened still loads the module this change retires');
});
