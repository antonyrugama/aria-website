/* The Problems pane, and strings that carry their own padding.

   Stadiora/Aria#10873: `pane-alerts.js` used its own `textOf()` as a
   PREDICATE and then drew the RAW field, so a value that was present but
   padded decided with the trimmed string and printed the untrimmed one. The
   same defect class PR #124 fixed on Overview (scripts/ops-overview-blank-text
   .test.mjs, which this file follows).

   The issue named seven sites. This file does not list them, and does not
   list the sites fixed beside them either, because Overview's sweep showed a
   census of `textOf()` calls is the wrong instrument: two hand-written ones
   were wrong, and six of the eleven sites its sweep found were not `textOf()`
   calls at all. What binds instead is the invariant, checked against the
   render: PADDING A STRING THE ANSWER CARRIES CHANGES NOTHING ON THE SCREEN.

   What the render is, here: every text node in the live panel, with nothing
   done to its whitespace, plus every `aria-label` in it. Two Overview sites
   lived only in an accessible name, and a text-only sweep called them clean.
   The Details disclosure of every card is OPENED before reading, so the
   record read (runbook, timeline, rule history) is on screen too.

   Fields that are not printed but looked up are exceptions, and each one is
   checked in both directions below, so a stale exception fails rather than
   hides what it covers.

   NOT SWEPT, and named rather than left to be discovered:

     - Any field the fixtures below do not carry, and any branch they do not
       enter: the failed-read bands, the empty state, the close form, and a
       problem with `detail` set. The sweep walks the fixture's own strings,
       not the source.
     - Anything outside text nodes and `aria-label`: `title`, `data-*`, `id`,
       `aria-controls`, and the endpoint URLs the pane calls.
     - Toasts. They are drawn outside the live panel and only after an
       action. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-alerts.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

/* Stamps are computed ONCE, at load, and in the middle of a minute, so every
   render in a sweep reads the same "N minutes ago" and a difference between
   two renders is the field under test rather than the clock. */
const MINUTE = 60000;
const DAY = 86400000;
const NOW = Date.now();
const at = (ms) => new Date(NOW - ms - 30000).toISOString();

function openProblem() {
  return {
    id: 'prb_1', reference: 'AO-118',
    ruleKey: 'ai_success_rate', ruleTitle: 'AI success rate',
    ruleThreshold: 'below 95% for 10m',
    severity: 'critical', category: 'ai_reliability', categoryLabel: 'AI reliability',
    status: 'open',
    title: 'Plan generation keeps giving up',
    summary: 'About one request in ten ends without a plan.',
    scopeKey: 'aria', scopeLabel: 'Aria (athletes)',
    observedValue: 8900, thresholdValue: 9500, durationSeconds: 600,
    detail: null,
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    firstBreachedAt: at(50 * MINUTE), firedAt: at(45 * MINUTE),
    lastObservedAt: at(MINUTE), conditionClearedAt: null,
    acknowledgedAt: null, acknowledgedByEmail: null,
    closedAt: null, closedByEmail: null, closeReason: null,
  };
}

/* Taken on by somebody, so the footer prints who. */
function acknowledgedProblem() {
  return Object.assign(openProblem(), {
    id: 'prb_2', reference: 'AO-119',
    ruleKey: 'queue_wait', ruleTitle: 'GPU queue backing up',
    ruleThreshold: 'over 10 for 5m',
    severity: 'warning', category: 'capacity', categoryLabel: 'Capacity',
    status: 'acknowledged',
    title: 'Sprint videos are waiting for a GPU',
    summary: 'Twelve videos have waited more than five minutes.',
    scopeKey: 'video', scopeLabel: 'Sprint video analysis',
    observedValue: 12, thresholdValue: 10, durationSeconds: 300,
    acknowledgedAt: at(20 * MINUTE), acknowledgedByEmail: 'oncall@example.invalid',
  });
}

function closedProblem() {
  return Object.assign(openProblem(), {
    id: 'prb_9', reference: 'AO-101', status: 'closed',
    title: 'Chat replies were slow for twenty minutes',
    summary: 'Replies took over eight seconds.',
    severity: 'warning',
    firedAt: at(3 * DAY), closedAt: at(2 * DAY),
    closedByEmail: 'owner@example.invalid', closeReason: 'self_resolved',
    acknowledgedAt: at(3 * DAY - 10 * MINUTE),
    acknowledgedByEmail: 'owner@example.invalid',
  });
}

function rule(over) {
  return Object.assign({
    ruleKey: 'ai_success_rate', title: 'AI success rate',
    scopeDescription: 'Per request type', category: 'ai_reliability',
    enabled: true, severity: 'critical',
    thresholdValue: 9500, thresholdUnit: 'basis_points', durationSeconds: 600,
    thresholdLabel: 'below 95% for 10m', channels: ['email'],
    rationale: null,
    lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'firing',
    lastInsufficientReason: null, lastFiredAt: at(45 * MINUTE),
  }, over);
}

function answers() {
  return {
    open: { problems: [openProblem(), acknowledgedProblem()] },
    closed: { problems: [closedProblem()] },
    rules: {
      rules: [
        rule({}),
        rule({
          ruleKey: 'queue_wait', title: 'GPU queue backing up',
          scopeDescription: 'Sprint video analysis', category: 'capacity',
          thresholdUnit: 'count', thresholdLabel: 'over 10 for 5m',
          lastEvaluationStatus: 'firing',
        }),
        rule({
          ruleKey: 'cost_anomaly', title: 'Unusual cost for a service',
          scopeDescription: 'Against the last 7 days', category: 'cost',
          thresholdLabel: 'over 25%',
          lastEvaluationStatus: 'insufficient_data',
          lastInsufficientReason: 'below_minimum_samples',
          lastFiredAt: null,
        }),
      ],
      summary: {},
      channels: [
        { channel: 'teams', label: 'Microsoft Teams', configured: true,
          lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
          lastAttemptAt: at(5 * MINUTE), lastSuccessAt: at(5 * MINUTE) },
        { channel: 'email', label: 'Email', configured: true,
          lastDeliveryStatus: 'failed', lastFailureReason: 'provider_rejected',
          consecutiveFailures: 3,
          lastAttemptAt: at(7 * MINUTE), lastSuccessAt: at(DAY) },
      ],
    },
    detail: {
      runbook: ['Check the model provider status page.'],
      timeline: [
        { eventType: 'fired', actorEmail: null, detail: {}, occurredAt: at(45 * MINUTE) },
        { eventType: 'acknowledged', actorEmail: 'oncall@example.invalid',
          detail: { note: 'Looking at the provider now.' }, occurredAt: at(20 * MINUTE) },
      ],
      ruleHistory: [
        { reference: 'AO-090', title: 'Plan generation gave up overnight',
          firedAt: at(9 * DAY), closedAt: at(8 * DAY), closeReason: 'resolved' },
      ],
    },
  };
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'alerts');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

async function settle(times) {
  for (let i = 0; i < (times || 10); i += 1) await new Promise((r) => setImmediate(r));
}

/* Loads the page the way ops/alerts.html loads it, answers every read from
   `given`, then opens every Details disclosure on the page so the record read
   is drawn as well. */
async function boot(given, search) {
  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/alerts.html' + (search || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  function answerFor(endpoint, o) {
    if (endpoint === '/api/ops/alerts/rules') return given.rules;
    if (endpoint === '/api/ops/alerts/problems') {
      return (o && o.query && o.query.status === 'closed') ? given.closed : given.open;
    }
    if (endpoint.indexOf('/api/ops/alerts/problems/') === 0) return given.detail;
    return undefined;
  }

  const admin = { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' };
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin },
    boot: () => Promise.resolve({ admin }),
    call: (endpoint, o) => {
      const answer = answerFor(endpoint, o);
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
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-alerts.js' });
  await settle();

  const details = findAll(livePanel(dom), (n) => n.tagName === 'BUTTON'
    && n.getAttribute('aria-expanded') === 'false' && /^Details/.test(n.textContent || ''));
  for (const button of details) button.dispatch('click');
  await settle();
  return { dom, opened: details.length };
}

/* ------------------------------------------------------- what is drawn */

function livePanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf('live') !== -1);
  assert.equal(boxes.length, 1, 'the live panel is not a single element to read');
  return boxes[0];
}

/* Text with NOTHING done to its whitespace. The harness's `allText()` ends in
   `.replace(/\s+/g, ' ').trim()`, which tidies away exactly the padding this
   file is looking for. */
function rawText(node) {
  if (!node) return '';
  return (node.textContent || '') + (node.childNodes || []).map(rawText).join('');
}

/* What the pane SAYS: text nodes and accessible names. */
function saidBy(panel) {
  const spoken = findAll(panel, (n) => n.getAttribute && n.getAttribute('aria-label'))
    .map((n) => n.getAttribute('aria-label'));
  return rawText(panel) + '\u0000' + spoken.join('\u0000');
}

async function said(given, search) {
  const { dom, opened } = await boot(given, search);
  return { text: saidBy(livePanel(dom)), opened };
}

/* ------------------------------------------------------------ the sweep */

function stringPaths(node, prefix = []) {
  if (typeof node === 'string') return [prefix];
  if (Array.isArray(node)) return node.flatMap((v, i) => stringPaths(v, prefix.concat(String(i))));
  if (node && typeof node === 'object') {
    return Object.keys(node).flatMap((k) => stringPaths(node[k], prefix.concat(k)));
  }
  return [];
}

const getPath = (obj, path) => path.reduce((o, k) => o[k], obj);
const withPath = (obj, path, value) => {
  const last = path[path.length - 1];
  path.slice(0, -1).reduce((o, k) => o[k], obj)[last] = value;
  return obj;
};

/* Not a date, not an enum key, not a word any table in the pane knows, and
   holding no whitespace for a render to normalise away. */
const SENTINEL = 'Zq7Sentinel';

/* A path with its array indices replaced by `*`, so one entry covers every
   problem, rule, channel and event in the fixture. */
const shape = (path) => path.map((k) => (/^\d+$/.test(k) ? '*' : k)).join('.');

/* Fields that are keys the pane looks something up by, or stamps it parses,
   and never prints. A padded one SHOULD change the render: it is a key the
   pane does not recognise, and refusing to read it is the behaviour
   Overview's sweep and the severity tests ask for. Verified both ways by
   `sweep()`: padding at least one instance changes the render (so the entry
   is not stale), and a substituted sentinel reaches nothing on screen in any
   instance (so the field is looked up, not printed). */
const LOOKUP = new Set([
  'open.problems.*.ruleKey',
  'open.problems.*.status',
  'open.problems.*.workPane',
  'open.problems.*.firedAt',
  'open.problems.*.acknowledgedAt',
  'closed.problems.*.status',
  'closed.problems.*.firedAt',
  'closed.problems.*.closedAt',
  'closed.problems.*.acknowledgedAt',
  'rules.rules.*.ruleKey',
  'rules.rules.*.lastEvaluatedAt',
  'rules.rules.*.lastFiredAt',
  'rules.rules.*.thresholdUnit',
  'rules.channels.*.lastDeliveryStatus',
  'rules.channels.*.lastAttemptAt',
  'rules.channels.*.lastSuccessAt',
  'detail.timeline.*.occurredAt',
  'detail.ruleHistory.*.firedAt',
]);

/* Keys looked up in a table that PRINT THEMSELVES when the table does not
   know them, so an operator is told an unrecognised value rather than shown
   a blank. A padded one legitimately changes the render -- it misses the
   table -- but what it then prints must not carry the padding. Verified
   three ways: padding at least one instance changes the render (not stale);
   a substituted sentinel reaches the screen in at least one instance (it
   really is printed, so it does not belong on LOOKUP); and in EVERY instance
   the sentinel padded draws exactly what the sentinel bare draws. */
const LOOKUP_PRINTED = new Set([
  'open.problems.*.severity',
  'closed.problems.*.closeReason',
  'rules.rules.*.lastEvaluationStatus',
  'rules.rules.*.lastInsufficientReason',
  'detail.timeline.*.eventType',
]);

/* The sentinel is looked for case-blind, because two of the printed
   fallbacks are lower-cased on the way to the screen and one is then
   capitalised again, and a check that missed them would call a printed field
   a hidden one. */
const shows = (text, value) => text.toLowerCase().includes(value.toLowerCase());

/* Pads every string leaf of `make()`, one at a time, and returns what it
   found. `extra` adds per-render entries to the two exception lists, for
   fields only one of the two sweeps reaches as keys. */
async function sweep(make, search, extra, reachedAll) {
  const lookup = new Set([...LOOKUP, ...(extra.lookup || [])]);
  const printed = new Set([...LOOKUP_PRINTED, ...(extra.printed || [])]);
  const base = make();
  const clean = await said(make(), search);
  assert.ok(clean.opened >= 3,
    `only ${clean.opened} Details disclosures were opened, so the record read is not on `
    + 'screen and every detail field below is swept over nothing');
  /* One value from each region, so a region that stopped drawing cannot sit
     inside the sweep looking covered. */
  for (const reached of reachedAll) {
    assert.ok(clean.text.includes(reached),
      `the baseline render does not carry "${reached}", so the region it comes from was `
      + 'never drawn and every comparison below passes over nothing');
  }

  const excused = new Map();
  const drifted = [];
  const exercised = [];
  for (const path of stringPaths(base)) {
    const key = shape(path);
    const where = path.join('.');
    const padded = await said(withPath(make(), path, '  ' + getPath(base, path) + '  '), search);

    if (lookup.has(key) || printed.has(key)) {
      const seen = excused.get(key) || { moved: false, shown: false };
      excused.set(key, seen);
      if (padded.text !== clean.text) seen.moved = true;
      const swapped = await said(withPath(make(), path, SENTINEL), search);
      if (lookup.has(key)) {
        assert.ok(!shows(swapped.text, SENTINEL),
          `"${where}" is excused as a lookup, but substituting an unrecognisable value put `
          + 'it on the screen -- the field is printed, not only looked up');
      } else {
        if (shows(swapped.text, SENTINEL)) seen.shown = true;
        const swappedPadded = await said(withPath(make(), path, '  ' + SENTINEL + '  '), search);
        assert.equal(swappedPadded.text, swapped.text,
          `"${where}" prints an unrecognised value with its own padding`);
      }
      continue;
    }

    exercised.push(where);
    if (padded.text !== clean.text) {
      let i = 0;
      while (i < clean.text.length && padded.text[i] === clean.text[i]) i += 1;
      drifted.push(`${where} (${JSON.stringify(clean.text.slice(Math.max(0, i - 40), i + 40))}`
        + ` => ${JSON.stringify(padded.text.slice(Math.max(0, i - 40), i + 40))})`);
    }
  }

  /* The exception lists, checked in both directions. An entry the fixture
     never reaches, or one whose padding changes nothing, is a stale
     exception hiding whatever it now covers. */
  for (const key of [...lookup, ...printed]) {
    const seen = excused.get(key);
    assert.ok(seen, `"${key}" is on an exception list but the fixture carries no such field`);
    assert.ok(seen.moved,
      `"${key}" is on an exception list but padding it changes nothing, so the exception `
      + 'is stale and is hiding whatever it now covers');
    if (printed.has(key)) {
      assert.ok(seen.shown,
        `"${key}" is excused as a lookup that prints itself when unknown, but an unknown `
        + 'value never reached the screen -- it belongs on LOOKUP');
    }
  }
  return { exercised, drifted };
}

/* One value from each region the sweep claims to reach: the queue, the
   footer's owner, the rules table, the destinations card, the closed list,
   and the three halves of the record read. */
const REACHED = [
  'Plan generation keeps giving up', 'oncall@example.invalid took this on',
  'Per request type', 'Microsoft Teams', 'Chat replies were slow for twenty minutes',
  'Check the model provider status page.', '“Looking at the provider now.”',
  'AO-090, Plan generation gave up overnight',
];

function assertClean({ exercised, drifted }, expectSwept) {
  /* Pinned exactly, not floored, so a fixture that lost a field says so. */
  assert.equal(exercised.length, expectSwept,
    `${exercised.length} fields were swept, not ${expectSwept}: ${JSON.stringify(exercised)}`);
  assert.deepEqual(drifted, [],
    `padding these fields changed what the pane says: ${JSON.stringify(drifted)} -- each is `
    + 'a site that decides with a trimmed value and draws the raw one, or never trims');
}

test('padding any string the answers carry changes nothing on the Problems pane', async () => {
  assertClean(await sweep(answers, '', {}, REACHED), 75);
});

test('padding any string changes nothing with closed problems in the queue too', async () => {
  /* A range window draws the closed problem as a queue card as well as a
     closed row, which is the only way `closedSentence()`'s card form, the
     closed condition pill and a closed card's own actions are on screen. */
  const result = await sweep(answers, '?range=7d', {
    lookup: ['closed.problems.*.ruleKey', 'closed.problems.*.workPane'],
    printed: ['closed.problems.*.severity'],
  }, [...REACHED, 'Fixed itself \u2014 owner@example.invalid']);
  assertClean(result, 72);
});
