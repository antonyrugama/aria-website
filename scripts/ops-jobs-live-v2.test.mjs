/* Unit tests for ops/assets/pane-jobs-live-v2.js — Happening now, on the v2
   design system.

   The one thing this pane exists to get right is the difference between a
   queue that has emptied past everything it was holding and one that has not.
   They are different problems with different fixes, they look identical in a
   screenshot, and no overflow check or contrast oracle can see which one the
   pane said. So most of what is below is about that distinction, about the
   third answer — that the pane cannot tell — and about the boundary of what
   two numbers prove, because an overclaim here reads as a verdict:

     - a queue whose front is older than the breach reads NOT CLEARING;
     - a queue whose front arrived after the breach reads MOVING, BEHIND;
     - NOT CLEARING never claims the front has not moved: a burst that all
       arrived before the breach can drain steadily and still show an old
       front, so the words stop at what was proved;
     - where the unit, the observation, the breach start or the elapsed time is
       missing, the verdict is CANNOT TELL, and is never rounded up to the
       alarming one;
     - work that is flowing and failing is a third fact, not a fourth kind of
       queue;
     - a figure nothing records renders words and never a numeral;
     - the bar draws no app and no environment control, and says why;
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
   fixed date in a fixture ages into a different test.

   One call is one instant. A fixture whose subject is two recorded times being
   EQUAL reads this once and reuses the value — two calls are two instants, and
   they agree only when they land in the same millisecond (#10514). */
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* ------------------------------------------------------------- fixtures */

/* A queue that is over the line. `observedValue` is the age of the job at the
   front of it in seconds, and the breach window is 59 minutes wide, so a
   fixture at or above 3540 is a queue whose front was already waiting when it
   crossed the line. */
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
  const section = sectionWithHeading(dom, /Waiting, and whether it is clearing/);
  return section ? findAll(section, (n) => hasClass(n, 'queue-row')) : [];
}

function heroText(dom) {
  const hero = findAll(livePanel(dom), (n) => hasClass(n, 'hero'))[0];
  return hero ? allText(hero) : '';
}

/* The verdict sentence of a row, and of the hero, read on their own rather
   than out of the surrounding text. Two tests assert these EQUAL a sentence
   written out here, because a blacklist of phrasings pins the phrasings and
   not the claim: the wrong sentence can always be spelled a fourth way. An
   expected string stated independently of the source cannot be satisfied by a
   rewrite, so any change to what the pane claims has to be made here too,
   deliberately, in a diff a reviewer reads. */
function rowSentence(row) {
  const sub = findAll(row, (n) => hasClass(n, 't-sub'))[0];
  return sub ? allText(sub) : '';
}

function heroSub(dom) {
  const hero = findAll(livePanel(dom), (n) => hasClass(n, 'hero'))[0];
  const sub = hero ? findAll(hero, (n) => hasClass(n, 'hero-sub'))[0] : null;
  return sub ? allText(sub) : '';
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

/* ============== moving, not clearing and cannot tell are three =========== */

test('a queue whose front is older than the breach reads not clearing', async () => {
  /* Breach began 60 minutes ago and was last measured a minute ago, so it has
     been over the line for 59 minutes. The job at the front has been waiting
     60. It was therefore already there when the breach began: nothing queued
     since has reached the front. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: 3600 })], summary: {} },
  });
  const rows = queueRows(dom);
  assert.equal(rows.length, 1, 'the queue band drew no row for a queue that is over the line');
  const text = allText(rows[0]);
  assert.match(text, /Not clearing/, 'a queue holding its backlog was not called not clearing');
  assert.doesNotMatch(text, /Moving/, 'a queue holding its backlog was also called moving');
});

test('not clearing claims exactly what oldest >= span proves, and no more', async () => {
  /* The boundary of what two numbers prove, and the reason this pane does not
     say "stuck". A burst that all arrived before the breach can drain one job
     at a time and satisfy oldest >= span the whole way, because every new
     front is still older than the breach — so most of that backlog can be
     gone. This fixture IS that burst: the front is 30m30s old and the queue
     has been over the line 20m. What survives is the existential, that the job
     now at the front was already waiting when the line was crossed.

     The sentence is asserted whole, not searched for phrases. Two earlier
     drafts of it were false — "Nothing has left the front of this queue since
     it went over the line" and "the backlog it had then is still there" — and
     both were reached by rewording, which is the move an equality assertion
     refuses and a blacklist does not. */
  const dom = await boot({
    problems: {
      problems: [queueProblem({
        observedValue: 1830,
        firstBreachedAt: at(20 * MINUTE),
        firedAt: at(18 * MINUTE),
        lastObservedAt: at(0),
      })],
      summary: {},
    },
  });
  const row = queueRows(dom)[0];
  assert.match(allText(row), /Not clearing/, 'the fixture did not reach the verdict under test');
  assert.equal(rowSentence(row),
    'Work that was already waiting when this queue went over the line is still waiting. ' +
    'Nothing queued since has reached the front.',
    'the row says something other than what oldest >= span proves');
});

test('moving, behind claims exactly what oldest < span proves, and no more', async () => {
  /* The sibling limit, and the one round 2 of review found: oldest < span
     proves the queue turned over, and counts nothing and times nothing, so it
     cannot carry a rate. This fixture is that counter-example, kept consistent
     with the alerting engine — the line is held throughout by a job enqueued
     three minutes into the breach, five older jobs drained one a minute, and
     then nothing left the queue for seven minutes:

       depth 5 -> 1, arrivals 1, departures 5, stalled for 7 minutes,
       oldest 22m < span 25m  ->  MOVING, BEHIND

     Arrivals are strictly SLOWER than departures across the whole span and the
     queue has not moved recently, so "they are arriving faster than they
     leave" is false here in both readings. Told that, an operator adds
     capacity while a worker is dead. */
  const dom = await boot({
    problems: {
      problems: [queueProblem({
        observedValue: 1320,
        firstBreachedAt: at(25 * MINUTE),
        firedAt: at(20 * MINUTE),
        lastObservedAt: at(0),
      })],
      summary: {},
    },
  });
  const row = queueRows(dom)[0];
  assert.match(allText(row), /Moving, behind/, 'the fixture did not reach the verdict under test');
  assert.equal(rowSentence(row),
    'Everything this queue was holding when it went over the line has since left it. ' +
    'What is waiting now arrived after that.',
    'the row says something other than what oldest < span proves');
});

test('a queue whose front arrived after the breach reads moving, behind', async () => {
  /* Same 59 minute breach, but the job at the front has only been waiting 11
     minutes, so nothing the queue was holding when it crossed the line is
     still in it, and everything in it now arrived after the line was
     crossed. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: 660 })], summary: {} },
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Moving, behind/, 'a draining queue was not called moving');
  assert.doesNotMatch(text, /Not clearing/,
    'a queue that has emptied past its whole backlog was called not clearing, which sends ' +
    'somebody to restart workers that are working');
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
  assert.match(byScope.video, /Not clearing/, 'the queue holding its backlog lost its verdict');
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
  assert.doesNotMatch(text, /Not clearing|Moving, behind/,
    'an unreadable observation produced one of the two verdicts anyway');
});

test('a missing observation is cannot tell, and never the alarming one', async () => {
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: null })], summary: {} },
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Cannot tell/, 'a missing observation did not say so');
  assert.doesNotMatch(text, /Not clearing/,
    'a missing observation was rounded up to the alarming verdict, which is the guess this ' +
    'pane must not make');
});

test('a negative observation is cannot tell, because an age below zero is not a reading', async () => {
  /* A number is not automatically a measurement. The elapsed-time formatter
     already refuses a negative, and the verdict has to refuse the same figure,
     or -5 reads as "older than the breach" and prints the alarming verdict. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: -5 })], summary: {} },
  });
  const text = allText(queueRows(dom)[0]);
  assert.match(text, /Cannot tell/, 'an age below zero was accepted as an observation');
  assert.doesNotMatch(text, /Not clearing|Moving, behind/,
    'a negative age produced a verdict, and a negative age produces the alarming one');
});

test('a span of zero is cannot tell, because no time elapsed for either claim', async () => {
  /* Measured at the instant it crossed the line. Both verdicts are statements
     about what happened while the queue was over the line, and nothing has
     happened yet, so oldest >= span is satisfied by every non-negative age and
     means nothing.

     ONE read of the clock, used three times. The subject here is an IDENTITY
     between two recorded times, and an identity cannot be written as three
     coincidences: `at(...)` three times asks the clock three times and gets one
     instant only when all three land in the same millisecond. It did not, and a
     1ms window is a window, so the pane correctly read a span and printed
     `over the line 0.0s Not clearing` — an honest verdict, failed by a test
     whose premise had quietly stopped holding (#10514).

     NOT COVERED, and stated rather than implied: what the pane says about a
     window wider than zero but under a second. Nothing writes one. An open
     problem's span is at least its rule's duration, and durationSeconds is
     validated as a whole number greater than zero
     (app-backend opsAlertsRouter.ts), so the engine's spans are exactly zero —
     which is what createProblem and restartProblemPersistence stamp from a
     single `now` — or a second and up. The 1ms width that reddened CI is the
     one width no record has. */
  const instant = at(10 * MINUTE);
  const problem = queueProblem({
    firstBreachedAt: instant,
    firedAt: instant,
    lastObservedAt: instant,
  });
  assert.equal(problem.firstBreachedAt, problem.lastObservedAt,
    'the fixture did not build a zero-width window, so nothing below is about one');

  const dom = await boot({ problems: { problems: [problem], summary: {} } });
  const text = allText(queueRows(dom)[0]);

  /* The premise, before the verdict. `Cannot tell` is reached by a missing
     observation OR a missing span, so on its own it cannot say which one the
     pane refused, and it would stay green while the span reasoning it is named
     for went untested. These two pin it to the span: the age is readable, and
     the window is the thing the pane declined to read. */
  assert.match(text, /oldest 1h 0m/,
    'the observation was unreadable too, so Cannot tell proves nothing about the span');
  assert.match(text, /over the line not readable/,
    'the pane read a span out of two readings taken at the same instant: ' + text);

  assert.match(text, /Cannot tell/, 'a zero-width breach window was treated as a span');
  assert.doesNotMatch(text, /Not clearing|Moving, behind/,
    'a zero-width window produced a verdict about time that had not passed');
});

test('a missing breach start is cannot tell, because there is no span to compare', async () => {
  const dom = await boot({
    problems: { problems: [queueProblem({ firstBreachedAt: null })], summary: {} },
  });
  assert.match(allText(queueRows(dom)[0]), /Cannot tell/,
    'a span measured from a missing start was treated as a span');
});

/* ================= stopped: the record says it is over ================== */

/* The alerting engine never closes a problem. On the first non-breaching
   check it records a recovery, sets conditionClearedAt and leaves the problem
   OPEN for a person to close, and it stops writing observedValue and
   lastObservedAt because refreshProblem only runs on a breaching sample. The
   route's `status=open` means open-or-acknowledged and never looks at
   conditionClearedAt, so the pane is handed the frozen figures of an incident
   that ended. Drawn live they say a queue that recovered is not clearing, with
   a wait nobody is doing. Every assertion below is about that gap. */

test('a queue whose condition has stopped is drawn in the past tense', async () => {
  const dom = await boot({
    problems: {
      problems: [queueProblem({
        firstBreachedAt: at(100 * MINUTE),
        firedAt: at(95 * MINUTE),
        lastObservedAt: at(40 * MINUTE),
        conditionClearedAt: at(40 * MINUTE),
      })],
      summary: {},
    },
  });
  const row = queueRows(dom)[0];
  assert.match(allText(row), /Stopped/, 'a recovered queue did not read as stopped');
  assert.doesNotMatch(allText(row), /Not clearing|Moving, behind|Cannot tell/,
    'a recovered queue kept a live verdict: ' + allText(row));
  assert.equal(rowSentence(row),
    'This queue is no longer over the line. The readings beside it are from when it was, ' +
    'and it is still on this page because closing a problem is somebody\'s decision rather ' +
    'than the engine\'s.',
    'the row says something other than what conditionClearedAt proves');
  assert.match(allText(row), /oldest when it stopped 1h 0m/,
    'the frozen age was labelled as a live wait');
  assert.match(allText(row), /was over the line 1h 0m/,
    'the frozen span was labelled as still running');
  assert.match(allText(row), /stopped 40 minutes ago/,
    'the row did not say when it stopped');
});

test('a queue that has stopped is not the longest wait, because nobody is waiting it', async () => {
  const dom = await boot({
    problems: {
      problems: [queueProblem({ conditionClearedAt: at(40 * MINUTE) })],
      summary: {},
    },
  });
  const tile = tileText(dom, /Oldest job waiting/);
  assert.match(tile, /Not over the line/, 'the tile quoted a wait from a queue that recovered');
  assert.equal(numerals(tile), 0, 'the tile drew a frozen figure as a live numeral: ' + tile);
  assert.match(tile, /no queue is over the line now/,
    'the tile did not say why the figure is absent');
});

test('the longest-wait tile speaks only for the queues it is built from', async () => {
  /* Round 4 of review: the tile is built from the queue rows alone and cannot
     see the failing or elsewhere groups, so a note about what is "open below"
     is false whenever one of those is still going — and on the elsewhere
     fixture the hero says "One problem is going" on the same screen. Both
     mixes are ordinary: one incident recovers while another is still live. */
  const withFailing = await boot({
    problems: {
      problems: [
        queueProblem({ conditionClearedAt: at(40 * MINUTE) }),
        failingProblem(),
      ],
      summary: {},
    },
  });
  const failingTile = tileText(withFailing, /Oldest job waiting/);
  assert.match(failingTile, /no queue is over the line now; the queues below have stopped/,
    'the tile note was not the queue-scoped one');
  assert.doesNotMatch(failingTile, /what is open below|nothing is over the line/,
    'the tile spoke for problems it cannot see: ' + failingTile);
  assert.match(liveText(withFailing), /the answers are coming back wrong/,
    'the fixture did not reach the live failing row the tile must not speak for');

  const withElsewhere = await boot({
    problems: {
      problems: [
        queueProblem({ conditionClearedAt: at(40 * MINUTE) }),
        elsewhereProblem(),
      ],
      summary: {},
    },
  });
  assert.match(heroText(withElsewhere), /One problem is going/,
    'the fixture did not reach the live elsewhere hero');
  assert.doesNotMatch(tileText(withElsewhere, /Oldest job waiting/),
    /what is open below|nothing is over the line/,
    'the tile contradicted the hero on the same screen');
});

test('the hero of a page where everything stopped says so, and does not sound the alarm', async () => {
  const one = await boot({
    problems: {
      problems: [queueProblem({ conditionClearedAt: at(40 * MINUTE) })],
      summary: {},
    },
  });
  assert.match(heroText(one), /It has stopped, and nobody has closed it/,
    'the hero of a recovered page did not say it had stopped');
  assert.doesNotMatch(heroText(one), /is not clearing|is behind|are failing/,
    'the hero called a recovered page live: ' + heroText(one));
  assert.equal(heroSub(one),
    'Nothing is over the line now. What is below stopped on its own and stays open until ' +
    'somebody says which of "we fixed it" and "it went away" happened.',
    'the hero says something other than what conditionClearedAt proves');

  const two = await boot({
    problems: {
      problems: [
        queueProblem({ conditionClearedAt: at(40 * MINUTE) }),
        failingProblem({ conditionClearedAt: at(12 * MINUTE) }),
      ],
      summary: {},
    },
  });
  assert.match(heroText(two), /2 have stopped, and nobody has closed them/,
    'the hero counted recovered problems singly or not at all: ' + heroText(two));
});

test('a queue that is still going outranks one that stopped, in the hero and in the order', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({ id: 111, scopeLabel: 'Sprint video', conditionClearedAt: at(40 * MINUTE) }),
        queueProblem({
          id: 112,
          scopeKey: 'form_check',
          scopeLabel: 'Form check',
          severity: 'warning',
          observedValue: 3600,
        }),
      ],
      summary: {},
    },
  });
  assert.match(heroText(dom), /is not clearing/,
    'a live queue lost the hero to one that had already stopped: ' + heroText(dom));
  /* Severity is how bad it WAS. The stopped row here is critical and the live
     one is only a warning, so a sort that reads severity first puts the
     recovered incident at the top of the page. */
  const rows = queueRows(dom);
  assert.match(allText(rows[0]), /Not clearing/, 'the stopped row was drawn first');
  assert.match(allText(rows[1]), /Stopped/, 'the live row was not drawn first');
  assert.match(tileText(dom, /Oldest job waiting/), /1h 0m/,
    'the tile skipped the queue that is still over the line');
});

test('work that stopped failing says so beside its severity, not instead of it', async () => {
  const dom = await boot({
    problems: {
      problems: [failingProblem({ conditionClearedAt: at(12 * MINUTE) })],
      summary: {},
    },
  });
  const row = findAll(sectionWithHeading(dom, /Flowing, and failing/),
    (n) => hasClass(n, 'queue-row'))[0];
  assert.equal(rowSentence(row),
    'The answers were coming back wrong and are not any more. The figure beside this is ' +
    'from when they were.',
    'a recovered failure still said the answers are coming back wrong');
  assert.match(allText(row), /was finishing cleanly 88\.0%/,
    'the frozen rate was labelled as a live one');
  assert.match(allText(row), /stopped 12 minutes ago/, 'the row did not say when it stopped');
  /* Severity survives, and the condition is stated separately beside it. The
     Problems pane draws this same record that way — a severity pill and a
     Condition of "Stopped <ago>" — and the elsewhere band below does too. Two
     panes disagreeing about one record is worse than either presentation. */
  assert.match(allText(row), /Critical/,
    'a recovered failure lost the severity it is still rated at');
  assert.match(allText(row), /Stopped/,
    'a recovered failure did not say its condition had stopped');
});

test('a problem on another pane that stopped is marked, not quietly listed', async () => {
  const dom = await boot({
    problems: {
      problems: [elsewhereProblem({ conditionClearedAt: at(3 * MINUTE) })],
      summary: {},
    },
  });
  const section = sectionWithHeading(dom, /Open elsewhere/);
  assert.match(allText(section), /stopped 3 minutes ago/,
    'a recovered problem elsewhere was listed as though it were still going');
  assert.match(heroText(dom), /It has stopped, and nobody has closed it/,
    'the hero treated a recovered problem elsewhere as live: ' + heroText(dom));
});

test('a live problem elsewhere still outranks anything that stopped', async () => {
  const dom = await boot({
    problems: {
      problems: [
        queueProblem({ conditionClearedAt: at(40 * MINUTE) }),
        elsewhereProblem(),
      ],
      summary: {},
    },
  });
  assert.match(heroText(dom), /One problem is going, and it is not the queue/,
    'a live problem elsewhere lost the hero to a recovered queue: ' + heroText(dom));
  assert.equal(heroSub(dom),
    'Nothing is queueing and nothing is failing. What is still going belongs to another ' +
    'pane, and each one below says which. The rest have stopped and are waiting to be ' +
    'closed.',
    'the hero did not account for the recovered problem it was not counting');
});

/* ========================== the hero says which ========================= */

test('the hero names the fact, not just that something is wrong', async () => {
  const holding = await boot({
    problems: { problems: [queueProblem({ observedValue: 3600 })], summary: {} },
  });
  assert.match(heroText(holding), /is not clearing/,
    'the hero did not say the queue was not clearing');
  /* The hero carries the same two claims as the rows and the same limits on
     them, so it is held to the same whole sentences. A pane that narrows its
     rows and leaves its headline overclaiming has narrowed nothing: the
     headline is the line somebody reads first. */
  assert.equal(heroSub(holding),
    'Work that was already waiting when it went over the line is still waiting.',
    'the hero says something other than what oldest >= span proves');

  const behind = await boot({
    problems: { problems: [queueProblem({ observedValue: 660 })], summary: {} },
  });
  assert.match(heroText(behind), /is behind/, 'the hero did not say the queue was behind');
  assert.equal(heroSub(behind),
    'Everything it was holding when the line was crossed has since left. What is waiting now ' +
    'arrived after that.',
    'the hero says something other than what oldest < span proves');
  assert.doesNotMatch(heroText(behind), /is not clearing/,
    'the hero called a draining queue not clearing, which is the whole distinction collapsed');
});

/* The singular forks above are bound whole; these are the plural ones. Round 3
   of review demonstrated that they were not — the hero rewritten to
   "N queues are stuck" with its old sub restored survived the suite — and a
   claim that is only bound in one of its two spellings is bound in neither,
   because the fork a mutation lands in is a coin toss. */
test('the plural hero forks claim exactly what the singular ones do', async () => {
  const twoHolding = await boot({
    problems: {
      problems: [
        queueProblem({ id: 111 }),
        queueProblem({ id: 112, scopeKey: 'form_check', scopeLabel: 'Form check' }),
      ],
      summary: {},
    },
  });
  assert.match(heroText(twoHolding), /2 queues are not clearing/,
    'the fixture did not reach the plural fork under test');
  assert.equal(heroSub(twoHolding),
    'Work that was already waiting when they went over the line is still waiting.',
    'the plural hero says something other than what oldest >= span proves');

  const twoBehind = await boot({
    problems: {
      problems: [
        queueProblem({ id: 111, observedValue: 660 }),
        queueProblem({
          id: 112,
          scopeKey: 'form_check',
          scopeLabel: 'Form check',
          observedValue: 660,
        }),
      ],
      summary: {},
    },
  });
  assert.match(heroText(twoBehind), /2 queues are behind/,
    'the fixture did not reach the plural fork under test');
  assert.equal(heroSub(twoBehind),
    'Everything they were holding when the line was crossed has since left. What is waiting ' +
    'now arrived after that.',
    'the plural hero says something other than what oldest < span proves');
});

test('cannot tell claims exactly what an unreadable record proves, and no more', async () => {
  /* The third verdict is the one with the strongest pull towards guessing: a
     pane that quietly rounds it to the alarming answer sends an operator to a
     queue that is working, and a pane that rounds it to the quiet one hides a
     queue that is not. The sentence is bound whole for the same reason the
     other two are. */
  const dom = await boot({
    problems: { problems: [queueProblem({ observedValue: null })], summary: {} },
  });
  const row = queueRows(dom)[0];
  assert.match(allText(row), /Cannot tell/, 'the fixture did not reach the verdict under test');
  assert.equal(rowSentence(row),
    'Whether this queue is clearing cannot be read from what was recorded, so it is not ' +
    'being guessed at.',
    'the row guessed at, or overstated, a verdict it could not read');
});

test('a failing row claims exactly that work is flowing, and never that it is queued', async () => {
  const dom = await boot({
    problems: { problems: [failingProblem()], summary: {} },
  });
  const row = findAll(sectionWithHeading(dom, /Flowing, and failing/),
    (n) => hasClass(n, 'queue-row'))[0];
  assert.equal(rowSentence(row),
    'Work is being picked up and the answers are coming back wrong. This is not a queue: ' +
    'nothing is waiting.',
    'the failing row says something other than that work is flowing and failing');
});

test('work that is flowing and failing is a third fact, not a queue', async () => {
  const dom = await boot({
    problems: { problems: [failingProblem()], summary: {} },
  });
  const hero = heroText(dom);
  assert.match(hero, /failing/, 'a failing request type was not named as failing');
  assert.doesNotMatch(hero, /not clearing|behind|queue/i,
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

  /* A number is not automatically a measurement, and this read is the sibling
     of the seconds one: a success rate below zero is not a rate. Zero is,
     which is why the guard here is >= 0 and the one on the age is > 0. */
  const negative = await boot({
    problems: { problems: [failingProblem({ observedValue: -500 })], summary: {} },
  });
  assert.match(liveText(negative), /finishing cleanly not readable/,
    'a success rate below zero was printed as a percentage');
  assert.doesNotMatch(liveText(negative), /-5\.0%|−5\.0%/,
    'a negative percentage was set beside a real threshold as though it were a reading');

  const zero = await boot({
    problems: { problems: [failingProblem({ observedValue: 0 })], summary: {} },
  });
  assert.match(liveText(zero), /finishing cleanly 0\.0%/,
    'nothing finishing cleanly is a real reading and was refused as though it were not');
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

/* ================= the two controls that came off ====================== */

/* The app and environment controls this pane used to draw are gone from the
   registry, because neither could narrow the read: the alerting record is
   kept per request type and covers production only. The note underneath and
   the staging refusal card are gone with them.

   The claim worth holding is about the BAR, not about the URL. A URL asking
   for a filter the pane does not declare is pinned by the shell before the
   pane sees it, so "nothing changed" there is true whatever the pane does and
   stays true when the pane starts reading it again — this test would be green
   for a reason other than the one it names. What is drawn is the thing that
   moves the moment the registry overclaims again. */
test('the bar offers no app and no environment, and says why instead', async () => {
  const dom = await boot({});
  const bar = findAll(dom.root, (n) => hasClass(n, 'filters'))[0];
  assert.ok(bar, 'the pane drew no filter bar at all, so the note has nowhere to be');

  const labels = findAll(bar, (n) => hasClass(n, 'filter-label')).map((n) => allText(n));
  assert.deepEqual(labels, [],
    'the bar drew a control: ' + labels.join(', ') + '. Every one of them narrows '
    + 'nothing here, which is why the registry declares none.');

  assert.match(allText(bar), /per request type and covers production only/,
    'the bar has no controls and does not say why either');
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
