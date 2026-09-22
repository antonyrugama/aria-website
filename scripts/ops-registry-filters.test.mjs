/* The registry's filter claims, held against what the panes actually do.

   ops/assets/pane-registry.js declares per-pane filter applicability as
   `scope`, `range` and `env`, and both shells draw a control for every one
   that is truthy. Nothing until this file checked that the pane behind the
   control could act on it, and two panes could not: Happening now and What
   happened each declared an app filter the alerting record cannot be narrowed
   by, and an environment filter whose staging value they refused rather than
   answered, and each then explained that in prose underneath the controls the
   registry had made the shell draw. What happened also offered a custom
   window whose only outcome was a refusal card.

   THE CONTRACT, stated here rather than read out of the registry

     1. A filter a pane declares must MOVE something. Every control the
        operator can move has to change the read or the page for at least one
        of the values it offers. This is the weakest of the three, and it is
        NOT what catches the defect above: the two panes answered a staging
        environment with a refusal card and an app with an apology note, and
        both of those are page changes, so this rule passed on the defect as
        it stood. Reassembled at its own anchors it is the coverage lock that
        goes red, at the declaration level; silence the lock and it is rules
        2 and 3 below — the read arriving without the operator's value, and a
        value costing the pane its answer — that catch it behaviourally.
        Rule 1 is the floor under panes that answer every value identically.

     2. It must move it in one of exactly two ways, and the table below names
        which for every declared filter:

          'read'    the value the operator picked reaches the pane's own API
                    call, in a field of the same name, in the querystring or
                    in the request body
          'answer'  the value is applied to the answer after it comes back:
                    a narrower value leaves fewer records on the page, and no
                    value reaches a record that lies outside all of them

     3. No value a pane offers may COST it its answer. Every value reaches the
        same pane state as the value the pane starts on. A selection that
        empties a pane which was otherwise live is a refusal wearing a
        filter's clothes, and the registry's own comment settles that a
        control whose one outcome is a refusal is an option in name only.

   Every assertion here is keyed off the call the pane recorded and the DOM it
   drew. None of it reads pane source text: a source-grep assertion pins the
   string and stays green when the defect is reinstated in another spelling.

   NOT COVERED by this file, stated rather than implied:

     - whether `alerts` acts on a window ADDED to its list. Section 5 reaches
       Problems, but its reading only catches a pane whose fallback for an
       unrecognised window is too wide; Problems answers one on status instead
       (pane-alerts.js:314), so the reading passes for a reason that has
       nothing to do with the window. Its three windows are pinned by value in
       ALSO_PINNED for that reason, so a fourth is red at the lock rather than
       proved here. Spend is on that table too, but not for this reason: a
       window added to spend IS proved here, by the sections banner-numbered
       3 and 6 (NOT by section 2, whose assertion is an OR across the non-start
       values: appending a window only lengthens the set that OR quantifies
       over, so it cannot go red on one -- section 2's own docblock says the
       same about itself). That is why the two entries have their reasons
       written out separately.
     - whether the API acts on a filter the pane sends it. A client can
       promise that the operator's selection reached the request; what the
       route does with it is the route's own test.
     - the converse, that a filter a pane does NOT declare cannot be reached
       through the URL. It was written here and then taken out, because no
       mutation could turn it red: the shell pins every undeclared filter in
       readFilters(), and removing that pin — for `scope` and for `env`, run
       separately — left all of these tests green, since a pane that does not
       declare a filter does not read one either. It was green for a reason
       other than the one it named. The shell-level claim, that a pane is
       offered exactly the filters it declared and never one more, is held
       where it can fail: scripts/ops-shell-pane-v2.test.mjs.
     - `jobs`, `overview`, `evals`, `releases` and `settings`. They declare no
       filter, so there is nothing on them for rules 1 to 3 to check. `jobs`
       keeps a boot recipe in PAGES anyway, so the day it declares one again
       rule 2 reaches it without anybody writing a recipe first. A regression
       that gives one of them a filter is caught by the coverage lock, which
       is a declaration-level failure rather than a recorded-call one; it says
       so in its own message.
     - layout, width and contrast. Nothing here measures anything. */
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

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const at = (ms) => new Date(Date.now() - ms).toISOString();

/* ========================== the contract table ========================= */

/* How each declared filter is acted on. Written out rather than derived from
   anything the panes or the registry say, so that a pane which stops acting
   on a filter cannot bring this table with it. */
const HONOURED = {
  /* Was 'answer' while this pane drew the alerting record from a route that
     took no window. Stadiora/Aria#5563 gave it GET /api/ops/runs, which takes
     one, so the window now reaches the read and check 3 proves it rather than
     check 4. */
  history: { range: 'read' },
  alerts: { range: 'answer' },
  analytics: { scope: 'read', range: 'read', env: 'read' },
  users: { scope: 'read' },
  spend: { range: 'read' },
};

/* Nothing is excused any more, and this table is empty. The entry that lived
   here was `spend`, excused on the grounds that it was the last pane on the v1
   shell and could not be booted; that conversion merged in
   antonyrugama/aria-website#65, the PAGES table below boots the pane on a
   two-field answer, and its windows are pinned in ALSO_PINNED like any
   other booted pane's. The table is kept, empty, because a pane that
   genuinely cannot be booted must still declare what it is excused for, by
   name and by value, rather than going quiet. The loop below therefore
   iterates nothing. */
const NOT_BOOTED = {};

/* Panes this file DOES boot whose window lists are additionally pinned by
   value. The pin is the same; the reason is not, and the two are written out
   separately because a reason reused across panes without being re-derived is
   how the entry below came to be filed under the wrong one.

   alerts: SECTION 5 cannot see a value added to its list. Section 5 reads
   back a record lying outside every window a pane offers, which catches a
   fallback that is too WIDE: What happened finds no entry for an unrecognised
   window in its own table, falls through to no window at all, and draws the far
   record. Problems falls the other way — pane-alerts.js:314 is
   `if (!days) return problem.status !== 'closed';`, the same branch its own
   'open' value uses — so the far record is dropped for a reason that has
   nothing to do with the window, and section 5 passes on a value nothing is
   applying. Section 6 DOES reach alerts — it has no 'answer' gate — and a
   reproduction (control 6/0 with a fourth window declared and unpinned;
   then pane-alerts.js:422 broken so that window alone draws nothing) turns
   sections 5 and 6 red together. Section 5's red there is its own vacuity
   guard ("this fixture never draws"), not the fallback being caught; 6's is
   the window itself. So what the pin buys is the narrow case section 6 cannot
   see: a window that keeps the answer and narrows nothing. The categorical
   version of this sentence ("nothing watches a value added here") is false
   for alerts, and was a round-4 finding.

   spend: an added value IS watched, and the pin is not what watches it.
   Sections 2, 3 and 6 sweep valuesFor(registry(), ...) live, so a fifth window
   is read back, carried into the call and held to its state the moment it
   is declared. (Section 5 never reaches spend at all: its sweep skips every
   filter this file records as 'read', and spend's is.) The pin is here for
   the weaker reason that a window added to a pane this file boots should
   still have to be WRITTEN DOWN by whoever adds it, so the declaration is a
   deliberate act rather than a diff nobody read. Deleting spend from this
   table would lose that and lose no behavioural coverage. */
const ALSO_PINNED = {
  alerts: { range: ['open', '7d', '30d'] },
  spend: { range: ['month', 'last-month', '3m', '12m'] },
};

/* ============================== fixtures =============================== */

/* One problem from the alerting record, in the shape the route sends. Three
   panes read this route and all three are given the same shape, because a
   fixture per pane is three chances to disagree with the route. */
function problem(over) {
  return Object.assign({
    id: 'prb_1', reference: 'AO-118',
    ruleKey: 'queue_backlog_age', ruleTitle: 'Queue backlog',
    ruleThreshold: 'over 10 minutes, held for 5 minutes',
    severity: 'critical', category: 'infrastructure', categoryLabel: 'Infrastructure',
    status: 'open',
    title: 'Jobs are waiting',
    summary: 'The oldest queued job is over the line.',
    scopeKey: 'video_analysis', scopeLabel: 'Sprint video',
    observedValue: 3600, thresholdValue: 600, durationSeconds: 300,
    detail: null,
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    firstBreachedAt: at(60 * MINUTE), firedAt: at(55 * MINUTE),
    lastObservedAt: at(MINUTE), conditionClearedAt: null,
    acknowledgedAt: null, acknowledgedByEmail: null,
    closedAt: null, closedByEmail: null, closeReason: null,
  }, over || {});
}

/* One window's worth of runs, for What happened. The same answer whatever
   window is asked for, on purpose: this file proves the SELECTION reaches the
   read, and an answer that varied with it would let a pane pass by drawing a
   difference it was handed rather than one it asked for. */
function runsAnswer() {
  return {
    window: { range: '7d', startAt: at(7 * DAY), endExclusiveAt: at(0) },
    selection: { type: null, outcome: null, limit: 50 },
    coverage: {
      state: 'ready', recordingSince: at(30 * DAY), lastRecordedAt: at(3 * MINUTE),
      coversWindow: true,
    },
    summary: {
      runs: 2, completed: 1, failed: 1, canceled: 0, failureReasons: 1, unfinished: 0,
      duration: { p50Ms: 8400, measured: 2, total: 2 },
      queued: { p50Ms: 900, measured: 2, total: 2 },
    },
    facets: {
      types: [{ value: 'nutrition_plan', label: 'Nutrition plan', labelled: true, runs: 2 }],
      outcomes: [
        { value: 'completed', label: 'Worked', runs: 1 },
        { value: 'failed', label: 'Failed', runs: 1 },
      ],
    },
    failures: [{
      failureCode: 'model_timeout', runs: 1, retryable: true,
      firstSeenAt: at(2 * HOUR), lastSeenAt: at(2 * HOUR),
      byType: [{
        type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true }, runs: 1,
      }],
    }],
    runs: [{
      jobId: '11111111-1111-4111-8111-111111111111',
      type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true },
      outcome: 'completed', outcomeLabel: 'Worked',
      failureCode: null, retryable: null, modelUsed: 'gpt-5-mini',
      queuedMs: 900, durationMs: 8400, finishedAt: at(2 * HOUR),
    }],
    truncated: false,
  };
}

function rules() {
  return {
    rules: [
      {
        ruleKey: 'queue_backlog_age', title: 'Queue backlog', enabled: true,
        thresholdUnit: 'seconds', thresholdValue: 600, durationSeconds: 300,
        thresholdLabel: 'over 10 minutes, held for 5 minutes',
        lastEvaluatedAt: at(3 * MINUTE), lastEvaluationStatus: 'firing',
        lastFiredAt: at(55 * MINUTE),
      },
      {
        ruleKey: 'ai_success_rate', title: 'AI success rate', enabled: true,
        thresholdUnit: 'basis_points', thresholdValue: 9500, durationSeconds: 600,
        thresholdLabel: 'below 95%, over 10 minutes',
        lastEvaluatedAt: at(3 * MINUTE), lastEvaluationStatus: 'ok',
        lastFiredAt: at(20 * MINUTE),
      },
    ],
    channels: [],
  };
}

const CONSENT_DETAIL =
  'Counts come from people whose analytics consent was on at the time.';

function usage() {
  return {
    asOf: at(HOUR),
    window: {
      range: '30d', start: at(30 * DAY), endExclusive: at(0),
      days: 30, grain: 'day', timezone: 'UTC',
      rollupsComputedAt: at(5 * HOUR),
      reportingStart: '2026-08-21', daysCovered: 30, daysMissingRollups: [],
    },
    filters: { app: 'all', env: 'production' },
    reportingFloor: 50,
    consent: { enforcedAt: 'ingest', detail: CONSENT_DETAIL },
    availability: { state: 'ready', detail: '' },
    apps: [
      {
        app: 'mobile', label: 'Mobile', tone: 'mobile', subtitle: 'Athlete app',
        coverageBasisPoints: 9200,
        metrics: [
          { label: 'Active people', kind: 'count', value: 1061 },
          { label: 'Sessions', kind: 'count', value: 8430 },
        ],
        trend: {
          label: 'Active people per day, Mobile', color: 's1',
          values: [980, 1001, 1040, 1077, 1061],
        },
      },
    ],
    cohorts: [],
    features: { hint: '', rows: [], note: '', coverageNote: '' },
    coverage: { shortfall: null, versions: [] },
  };
}

function lookupResult() {
  return {
    recorded: { at: at(1000), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
    matchCount: 1,
    matches: [
      {
        reference: 'ath_2277',
        maskedEmail: 'a•••@example.invalid',
        state: { key: 'active', label: 'Active', tone: 'ok' },
        tier: { key: 'pro', label: 'Athlete Pro', brand: true },
        platforms: [{ key: 'mobile', label: 'Mobile' }],
        lastActiveAt: at(3 * HOUR),
        flags: [],
      },
    ],
  };
}

function accountDetail() {
  return {
    reference: 'ath_2277',
    kind: 'athlete',
    state: { key: 'active', label: 'Active', tone: 'ok' },
    tier: { key: 'pro', label: 'Athlete Pro', brand: true },
    memberSince: at(400 * DAY),
    recorded: { at: at(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
    summary: {
      fields: [
        { key: 'locale', label: 'Locale', masked: false, value: 'es-ES' },
      ],
    },
    activity: { windowDays: 7, events: [] },
    devices: [],
    billing: { fields: [] },
    access: { windowDays: 90, entries: [] },
    supportActions: { available: [] },
  };
}

/* ============================ booting a pane =========================== */

/* What each pane needs on the page, which scripts it loads after the
   bootstrap, and what its reads answer with. The shape is lifted from the
   per-pane test files, which all boot the same way; nothing here is pane
   knowledge beyond the script list and the endpoints. */
const PAGES = {
  jobs: {
    file: 'jobs-live.html',
    scripts: ['assets/alerts-model.js', 'assets/pane-jobs-live-v2.js'],
    answer: (endpoint) => {
      if (endpoint === '/api/ops/alerts/problems') return { problems: [problem()], summary: {} };
      if (endpoint === '/api/ops/alerts/rules') return rules();
      return undefined;
    },
  },
  history: {
    file: 'run-history.html',
    scripts: ['assets/pane-run-history-v2.js'],
    answer: (endpoint) => (endpoint === '/api/ops/runs' ? runsAnswer() : undefined),
  },
  alerts: {
    file: 'alerts.html',
    scripts: ['assets/alerts-model.js', 'assets/pane-alerts.js'],
    answer: (endpoint, o) => {
      if (endpoint === '/api/ops/alerts/rules') return rules();
      if (endpoint === '/api/ops/alerts/problems') {
        return (o && o.query && o.query.status === 'closed')
          ? { problems: [] }
          : { problems: [problem()] };
      }
      return undefined;
    },
  },
  analytics: {
    file: 'analytics.html',
    scripts: ['assets/pane-analytics.js'],
    answer: (endpoint) => (endpoint === '/api/ops/usage' ? usage() : undefined),
  },
  spend: {
    file: 'spend.html',
    scripts: ['assets/pane-spend.js'],
    /* Two fields, because two is what the rules here need. The pane's own
       suite next door needs a large payload for the reconciliation, chart and
       staleness claims; none of those is a rule in this file, and a recipe
       carrying them would be a second derivation of that fixture without
       proving anything this file asks. `/api/ops/summary` is deliberately
       left to reject: the pane's target() catches it and draws no budget
       card, which is the absent case and not a failure. The pane still
       reaches live on all four windows, which is what sections 2, 3 and 6
       read back. */
    answer: (endpoint, o) => (endpoint === '/api/ops/costs'
      ? { range: (o && o.query && o.query.range) || null, availability: { state: 'ready' } }
      : undefined),
  },
  users: {
    file: 'users.html',
    scripts: ['assets/pane-users.js'],
    answer: (endpoint) => {
      if (/\/api\/ops\/users\/lookup$/.test(endpoint)) return lookupResult();
      /* One match is not a choice, so the pane opens the account itself. That
         second read has to answer or the pane lands in its degraded state,
         which would still carry the filter but would be reading a filter off
         an error path. */
      if (/\/api\/ops\/users\//.test(endpoint)) return accountDetail();
      return undefined;
    },
    /* The only pane here that reads nothing until it is asked to. Its filter
       travels on the lookup, so the lookup has to be run for there to be a
       recorded call to read. */
    act: async (dom) => {
      dom.doc.getElementById('lookupIdentifier').value = 'ath_2277';
      dom.doc.getElementById('lookupReason').value = 'SUP-4471';
      dom.doc.querySelector('.hunt-form').dispatch('submit');
      await settle();
    },
  },
};

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
}

function buildPage(dom, body, paneId) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', paneId);
  body.className = 'is-booting';
  const gate = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(gate, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* One pane, booted the way its own page boots it, at the querystring given.
   Returns what the pane asked the API for and which state it ended in. */
async function bootPane(paneId, search) {
  const page = PAGES[paneId];
  assert.ok(page, 'no boot recipe for ' + paneId);

  const calls = [];
  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/' + page.file + (search || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  dom.doc.contains = (node) => dom.root.contains(node);
  buildPage(dom, body, paneId);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({
        endpoint,
        method: (o && o.method) || 'GET',
        query: (o && o.query) || null,
        body: (o && o.body) || null,
      });
      const data = page.answer(endpoint, o);
      if (data === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data });
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

  /* Recorded before the pane module runs, so the first state it asks for is
     caught. The live and degraded panels are one element, so the DOM alone
     cannot tell them apart and the pane's own request is the only reading. */
  const applied = [];
  const realApply = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    applied.push(String(state));
    return realApply.apply(this, arguments);
  };

  for (const rel of page.scripts) {
    vm.runInContext(read(rel), dom.window, { filename: rel });
  }

  await settle();
  if (page.act) await page.act(dom);

  return { ...dom, body, calls, applied, paneId };
}

/* The state the pane last asked for: 'loading', 'live', 'degraded' or
   'empty'. */
const stateOf = (dom) => dom.applied[dom.applied.length - 1] || null;

function panel(dom, state) {
  const content = dom.doc.getElementById('content');
  if (!content) return null;
  return content.querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0] || null;
}

/* Everything on screen, whichever panel is showing it. */
function shownText(dom) {
  const node = panel(dom, stateOf(dom) === 'empty' ? 'empty' : 'live');
  return node ? allText(node) : '';
}

/* The shown panel's elements carrying one class, for a reading narrower than
   the whole page. */
function withClass(dom, name) {
  const node = panel(dom, stateOf(dom) === 'empty' ? 'empty' : 'live');
  if (!node) return [];
  return findAll(node, (n) => (n.getAttribute && (n.getAttribute('class') || '').split(/\s+/)
    .indexOf(name) !== -1));
}

/* Each boot runs in its own vm context, so a recorded call carries that
   context's Object prototype and a strict deep comparison of two identical
   readings fails on the prototype alone. JSON is the shape both realms
   agree on. */
const recorded = (dom) => JSON.parse(JSON.stringify(dom.calls));

/* Every value a recorded call carried, querystring and body together, as
   strings. What the pane sent, with no opinion about which field it sent it
   in. */
function valuesSent(dom) {
  const out = [];
  for (const call of dom.calls) {
    for (const bag of [call.query, call.body]) {
      if (!bag) continue;
      for (const key of Object.keys(bag)) {
        const value = bag[key];
        if (value !== undefined && value !== null) out.push(String(value));
      }
    }
  }
  return out;
}

/* The values a recorded call carried under one field name, querystring and
   body alike. Narrower than valuesSent on purpose: a pane that sent the app
   the operator picked in the environment field would satisfy "the value
   travelled" while sending it somewhere the route will not read it. Both
   panes proved below name the field after the filter, and a pane that renames
   one is red here until somebody says so out loud. */
function sentAs(dom, field) {
  const out = [];
  for (const call of dom.calls) {
    for (const bag of [call.query, call.body]) {
      if (!bag || !Object.prototype.hasOwnProperty.call(bag, field)) continue;
      const value = bag[field];
      if (value !== undefined && value !== null) out.push(String(value));
    }
  }
  return out;
}

/* ============================ the registry ============================= */

function registry() {
  const dom = makeDom({ tokens: TOKENS });
  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  return dom.window.OpsPaneRegistry;
}

const FILTERS = ['scope', 'range', 'env'];

/* The filters one pane declares, in a fixed order so two lists can be
   compared. `range` is a list of values rather than a boolean, so truthiness
   is the one test that reads all three. */
function declaredBy(pane) {
  return FILTERS.filter((name) => Boolean(pane[name]));
}

/* The values the shell will offer for one declared filter, taken from the
   same tables the shell draws its controls from. */
function valuesFor(reg, pane, filter) {
  if (filter === 'scope') return reg.SCOPES.map((s) => s.v);
  if (filter === 'env') return reg.ENVS.map((e) => e.v);
  return pane.range.slice();
}

/* The value the pane starts on, which is what a selection is compared
   against. */
function startsOn(pane, filter) {
  if (filter === 'scope') return 'all';
  if (filter === 'env') return 'production';
  return pane.rangeDefault || pane.range[0];
}

const searchFor = (filter, value) => '?' + filter + '=' + encodeURIComponent(value);

/* ======================== 1. the coverage lock ========================= */

/* Nothing below can check a claim this file does not know about, so this is
   the assertion that keeps the rest of the file from going quiet. A pane that
   gains a filter is red here until somebody writes down how that filter is
   acted on and this file proves it. */
test('every filter the registry declares is claimed by this file, and every claim is a pane\'s', () => {
  const { PANES } = registry();

  const declared = {};
  for (const id of Object.keys(PANES)) {
    const filters = declaredBy(PANES[id]);
    if (filters.length) declared[id] = filters;
  }

  const claimed = {};
  for (const id of Object.keys(HONOURED)) claimed[id] = Object.keys(HONOURED[id]).sort();
  for (const id of Object.keys(NOT_BOOTED)) claimed[id] = Object.keys(NOT_BOOTED[id]).sort();

  assert.deepEqual(
    Object.keys(declared).sort(), Object.keys(claimed).sort(),
    'the registry and this file disagree about which panes declare a filter. A pane '
    + 'that gained one needs a recipe in PAGES and a line in HONOURED saying how it '
    + 'is acted on; a pane that lost one needs its line removed.'
  );

  for (const id of Object.keys(declared)) {
    assert.deepEqual(
      declared[id].slice().sort(), claimed[id],
      id + ' declares ' + declared[id].join(', ') + ' and this file claims '
      + claimed[id].join(', ') + ', so one of them is unproven'
    );
  }

  /* So the lock cannot pass by the dashboard losing its filters. */
  const total = Object.keys(declared).reduce((n, id) => n + declared[id].length, 0);
  assert.ok(total >= 6,
    'only ' + total + ' filters are declared across the whole dashboard, so the '
    + 'proofs below have almost nothing to bind');

  /* Every pane this file claims to prove has to be bootable, or the proof is
     a line in a table. */
  for (const id of Object.keys(HONOURED)) {
    assert.ok(PAGES[id], id + ' is claimed in HONOURED with no boot recipe behind it');
  }

  /* Two tables, pinned down to the values, and two messages: one claim is not
     true of both. What watches a value rather than a filter name differs by
     pane and by rule -- section 5 only reaches a filter HONOURED records as
     'answer' (it skips the rest at the top of its own loop), so for a 'read'
     pane the value-level work is sections 3 and 6. Section 2 is the
     filter-level floor, not value-level: its assertion is an OR across the
     non-start values, so appending a value can only make it easier to pass.
     ("Section N" throughout this file means the numbered SECTION banners,
     e.g. `3. a filter reaches the read`; the CONTRACT block at the top of the
     file numbers three rules separately and is not this scheme. Numbers in
     text this PR did not write may be either.) The reasons are written
     per pane above each table rather than once here.

     Read separately rather than merged, so that neither table can quietly
     replace the other's entry for the same pane. Array.from throughout,
     because the registry is read in its own realm and a bare deepEqual
     compares prototypes as well as contents. */
  const reg = registry();

  /* NOT_BOOTED is empty, so this loop iterates nothing. It is kept for the
     pane that cannot be booted next: the declaration it is excused for has to
     be pinned by value, or the excuse quietly widens. */
  for (const id of Object.keys(NOT_BOOTED)) {
    for (const filter of Object.keys(NOT_BOOTED[id])) {
      const offered = Array.from(valuesFor(reg, PANES[id], filter));
      assert.deepEqual(
        offered, NOT_BOOTED[id][filter],
        id + ' offers ' + offered.join(', ') + ' for ' + filter
        + ' and this file is excused only for ' + NOT_BOOTED[id][filter].join(', ')
        + '. Nothing here boots it, so no value on that list is proved here and '
        + 'an added one would not be either.'
      );
    }
  }

  /* Every pane on this list IS booted, and every value on it is swept by the
     rules that apply to that pane. The pin is about a value ADDED to a list,
     and what that costs differs per pane; the reasons are written out one by
     one above the table. */
  for (const id of Object.keys(ALSO_PINNED)) {
    for (const filter of Object.keys(ALSO_PINNED[id])) {
      const offered = Array.from(valuesFor(reg, PANES[id], filter));
      assert.deepEqual(
        offered, ALSO_PINNED[id][filter],
        id + ' offers ' + offered.join(', ') + ' for ' + filter
        + ' and this file pins ' + ALSO_PINNED[id][filter].join(', ')
        + '. A window added to a pane this file boots has to be written down '
        + 'here as well; the reason it is pinned is written above the table, '
        + 'per pane, because the two panes on it are pinned for different ones.'
      );
    }
  }
});

/* ============ 2. a declared filter changes what the pane does ========== */

/* Driven off the registry rather than off the table above, because the table
   above is where a new overclaim would be missing. The contract this checks is
   the weakest true one — a control the operator can move has to move
   SOMETHING, in the read or on the page. It is NOT the assertion that catches
   the defect this file was written for: a refusal card and an apology note are
   both page changes, so this test passes on the two panes as they stood.
   Reassembled at its own anchors — main's Happening now pane file and main's
   jobs registry entry — the only red in this file is the coverage lock above,
   at the declaration level; silence the lock with a lying HONOURED line and
   the two that go red are `a filter carried into the read arrives with the
   value the operator picked` and `every value a pane offers reaches the same
   state as the one it starts on`, not this one and not the answer test. This
   one is the floor under a pane that answers every value identically. The two
   tests after it are the strong forms, and say which of the two ways the value
   was acted on. */
test('a filter a pane declares changes the read or the page', async () => {
  const { PANES } = registry();
  let checked = 0;

  for (const id of Object.keys(PAGES)) {
    const pane = PANES[id];
    for (const filter of declaredBy(pane)) {
      const start = startsOn(pane, filter);
      const base = await bootPane(id, searchFor(filter, start));
      const baseCalls = JSON.stringify(recorded(base));
      const baseText = shownText(base);

      const others = valuesFor(registry(), pane, filter).filter((v) => v !== start);
      assert.ok(others.length,
        id + ' offers exactly one value for ' + filter + ', which is a control that '
        + 'cannot be moved');

      let moved = false;
      for (const value of others) {
        const dom = await bootPane(id, searchFor(filter, value));
        if (JSON.stringify(recorded(dom)) !== baseCalls || shownText(dom) !== baseText) {
          moved = true;
        }
      }

      assert.ok(moved,
        id + ' declares ' + filter + ', and every value it offers produces the same read '
        + 'and the same page as ' + filter + '=' + start + '. The control moves and '
        + 'nothing behind it does. It asked for: ' + baseCalls);
      checked += 1;
    }
  }

  assert.ok(checked >= 4,
    'only ' + checked + ' declared filters were swept, so this proves less than it reads');
});

/* ===================== 3. a filter reaches the read ==================== */

/* The assertion this file exists for. A pane that declares a filter and never
   sends it is a control the operator can move over figures that ignore it. */
test('a filter carried into the read arrives with the value the operator picked', async () => {
  const { PANES } = registry();
  let proved = 0;

  for (const id of Object.keys(HONOURED)) {
    for (const filter of Object.keys(HONOURED[id])) {
      if (HONOURED[id][filter] !== 'read') continue;
      const pane = PANES[id];
      const seen = new Map();

      for (const value of valuesFor(registry(), pane, filter)) {
        const dom = await bootPane(id, searchFor(filter, value));
        assert.ok(dom.calls.length,
          id + ' read nothing at all under ' + filter + '=' + value
          + ', so nothing can carry the selection');
        assert.ok(valuesSent(dom).indexOf(String(value)) !== -1,
          id + ' declares ' + filter + ' and did not send ' + value + ' to any read. '
          + 'It asked for: ' + JSON.stringify(recorded(dom)));
        assert.ok(sentAs(dom, filter).indexOf(String(value)) !== -1,
          id + ' sent ' + value + ' somewhere, but not in a field called ' + filter
          + '. It asked for: ' + JSON.stringify(recorded(dom)));
        seen.set(value, JSON.stringify(recorded(dom)));
        proved += 1;
      }

      /* Sending the value is not enough on its own: a pane that hard-coded
         the value the operator happens to start on would satisfy the check
         above for that one value. Two selections have to produce two
         different reads. */
      assert.ok(new Set(seen.values()).size === seen.size,
        id + ' sent the same read for two different values of ' + filter
        + ', so the value it carried was not the selection');
    }
  }

  assert.ok(proved >= 8,
    'only ' + proved + ' pane-and-value pairs were proved to carry their selection');
});

/* ================= 4. a filter applied to the answer =================== */

/* The other way a filter can be real. This pane reads a route that takes no
   window, so the window is applied to what came back — which narrows the page
   just as honestly, and is why it is not required to send it. The probe
   straddles the boundary in both directions, so a pane that simply drew
   nothing, or drew everything, fails it.

   What happened used to be here too and is not any more: since
   Stadiora/Aria#5563 it reads GET /api/ops/runs, which takes a window, so its
   range is proved by check 3 above. */
const ANSWER_PROBES = {
  'alerts.range': async () => {
    const stale = problem({
      id: 'prb_stale', reference: 'AO-301', title: 'Open since last month',
      firstBreachedAt: at(40 * DAY), firedAt: at(40 * DAY), lastObservedAt: at(40 * DAY),
    });
    const closed = problem({
      id: 'prb_closed', reference: 'AO-302', title: 'Closed two days ago',
      status: 'closed',
      firstBreachedAt: at(2 * DAY), firedAt: at(2 * DAY),
      lastObservedAt: at(2 * DAY), closedAt: at(2 * DAY), closeReason: 'fixed',
    });
    const previous = PAGES.alerts.answer;
    PAGES.alerts.answer = (endpoint, o) => {
      if (endpoint === '/api/ops/alerts/rules') return rules();
      if (endpoint === '/api/ops/alerts/problems') {
        return (o && o.query && o.query.status === 'closed')
          ? { problems: [closed] }
          : { problems: [stale] };
      }
      return undefined;
    };
    try {
      const open = await bootPane('alerts', '?range=open');
      const month = await bootPane('alerts', '?range=30d');

      /* The queue only. This pane also draws a "recently closed" band on a
         fourteen-day window of its own, which the shell's range deliberately
         does not touch, so whole-page text would report that band as if the
         range had reached it. */
      const queue = (dom) => withClass(dom, 'p-item').map(allText).join(' ');

      assert.match(queue(open), /Open since last month/,
        'open now dropped a problem that is open now');
      assert.doesNotMatch(queue(open), /Closed two days ago/,
        'open now is showing a problem somebody closed');
      assert.match(queue(month), /Closed two days ago/,
        'the thirty day window dropped a problem closed two days ago');
      assert.doesNotMatch(queue(month), /Open since last month/,
        'the thirty day window reached a problem that fired forty days ago');
    } finally {
      PAGES.alerts.answer = previous;
    }
  },
};

test('a filter applied to the answer narrows what is on the page', async () => {
  let ran = 0;
  for (const id of Object.keys(HONOURED)) {
    for (const filter of Object.keys(HONOURED[id])) {
      if (HONOURED[id][filter] !== 'answer') continue;
      const probe = ANSWER_PROBES[id + '.' + filter];
      assert.ok(probe,
        id + ' claims to apply ' + filter + ' to the answer and has no probe proving it');
      await probe();
      ran += 1;
    }
  }
  assert.equal(ran, Object.keys(ANSWER_PROBES).length,
    'a probe was written and never run, so it proves nothing');
});

/* =========== 5. no value reaches past every value the pane offers ===== */

/* The value-level defect, which the coverage lock cannot see on a pane this
   file boots: it compares filter NAMES there, so a window added to a list a
   pane already declares walks past it. (`spend` and `alerts` are the two
   exceptions, both on ALSO_PINNED, which pins their window lists by value;
   the reasons they are pinned differ and are written out per pane above that
   table.)
   What happened offered 'custom' for a while, and the pane answered it with a
   refusal card; delete the refusal and leave the value, and the pane finds no
   entry for it in its own window table, falls through to no window at all, and
   draws every record it was given under a control that says Custom. That is
   the same overclaim one level down.

   The reading that catches it on a pane whose fallback is too WIDE: one
   record placed far outside every window any pane here offers, and closed. It
   has to be closed for two separate reasons — What happened keeps a problem
   that is STILL OPEN inside today's window however long ago it fired, and
   Problems answers its own "Open now" on status rather than on age — so an
   open record would be drawn correctly by both and prove nothing. A value that
   alone puts a closed four-hundred-day-old record on the page is a value
   nothing is applying. Each value is then asked the same question about a
   record from an hour ago, which must be on the page, or the absence above
   would prove only that the fixture never drew.

   What this reading CANNOT catch is the other fallback: a pane that answers an
   unrecognised window on some dimension of its own rather than on age drops
   the far record for a reason that has nothing to do with the window, and
   reads as clean. Problems is that pane — pane-alerts.js:314,
   `if (!days) return problem.status !== 'closed';` — so a window added to its
   list walks past this test as well as past the lock's name comparison. Its
   windows are pinned by value in ALSO_PINNED instead, which is why the
   exception above is spend AND alerts. */
const MARKED = { scopeKey: 'coach_invites', scopeLabel: 'Coach invites' };
const MARKER = /Coach invites/;

/* Where the records live on each pane. Problems reads a second, closed list on
   a fourteen-day window of its own that the shell's range does not touch, so
   whole-page text there would answer a question nobody asked. */
const RECORDS_SHOWN = {
  alerts: (dom) => withClass(dom, 'p-item').map(allText).join(' '),
};

function markedRecord(ageMs, closed) {
  const extra = closed
    ? { status: 'closed', closedAt: at(ageMs), closeReason: 'fixed' }
    : { status: 'open' };
  return problem(Object.assign({
    id: 'prb_marked', reference: 'AO-777', title: 'The marked record',
    firstBreachedAt: at(ageMs), firedAt: at(ageMs), lastObservedAt: at(ageMs),
  }, MARKED, extra));
}

test('no value a pane offers reaches a record that lies outside all of them', async () => {
  const { PANES } = registry();
  let checked = 0;
  const visited = new Set();

  for (const id of Object.keys(HONOURED)) {
    for (const filter of Object.keys(HONOURED[id])) {
      if (HONOURED[id][filter] !== 'answer') continue;
      const readRecords = RECORDS_SHOWN[id];
      assert.ok(readRecords, id + ' applies ' + filter + ' to its answer and this file does '
        + 'not know where to read its records');

      const previous = PAGES[id].answer;
      /* The record is served to whichever read asks for its status, the way
         the route would: What happened asks for `all`, Problems asks twice,
         once for `open` and once for `closed`. */
      const serve = (record) => (endpoint, o) => {
        if (endpoint === '/api/ops/alerts/rules') return rules();
        if (endpoint === '/api/ops/alerts/problems') {
          const want = (o && o.query && o.query.status) || 'open';
          const matches = want === 'all'
            || (want === 'closed') === (record.status === 'closed');
          return { problems: matches ? [record] : [] };
        }
        return undefined;
      };

      try {
        for (const value of valuesFor(registry(), PANES[id], filter)) {
          PAGES[id].answer = serve(markedRecord(400 * DAY, true));
          const far = await bootPane(id, searchFor(filter, value));
          assert.doesNotMatch(readRecords(far), MARKER,
            id + ' put a record from four hundred days ago on the page under ' + filter
            + '=' + value + ', which no window it offers reaches. That value is not being '
            + 'applied to the answer.');

          PAGES[id].answer = serve(markedRecord(HOUR, false));
          const near = await bootPane(id, searchFor(filter, value));
          assert.match(readRecords(near), MARKER,
            id + ' left a record from an hour ago off the page under ' + filter + '='
            + value + ', so the check above proves nothing: this fixture never draws.');
          visited.add(id);
          checked += 1;
        }
      } finally {
        PAGES[id].answer = previous;
      }
    }
  }

  /* The floor is stated as the panes rather than as a count, because a count
     is a number the next change lowers to whatever it produced — which is the
     failure this floor exists to catch, one level up. Problems is named here
     literally: if it stops being an answer-filtered pane, this line goes red
     and somebody decides that deliberately rather than by editing a 6 to a 3.
     (What happened was the second name on this line until Stadiora/Aria#5563
     moved its window into the read, where check 3 proves it.) */
  assert.deepEqual([...visited].sort(), ['alerts'],
    'the panes whose answer-side filtering was actually exercised were '
    + JSON.stringify([...visited].sort()));
  assert.ok(checked >= 3,
    'only ' + checked + ' values were reached, so this proves less than it reads');
});

/* ================== 6. no value costs the pane its answer ============== */

test('every value a pane offers reaches the same state as the one it starts on', async () => {
  const { PANES } = registry();
  let checked = 0;

  for (const id of Object.keys(HONOURED)) {
    const pane = PANES[id];
    for (const filter of Object.keys(HONOURED[id])) {
      const base = await bootPane(id, searchFor(filter, startsOn(pane, filter)));
      const baseState = stateOf(base);
      assert.ok(baseState, id + ' asked for no state at all');

      for (const value of valuesFor(registry(), pane, filter)) {
        const dom = await bootPane(id, searchFor(filter, value));
        assert.equal(stateOf(dom), baseState,
          id + ' answers ' + filter + '=' + startsOn(pane, filter) + ' with "' + baseState
          + '" and ' + filter + '=' + value + ' with "' + stateOf(dom)
          + '". A value that costs the pane its answer is a refusal, not a filter.');
        checked += 1;
      }
    }
  }

  assert.ok(checked >= 12,
    'only ' + checked + ' values were reached, so this proves less than it reads');
});
