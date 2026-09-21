/* What the Problems pane shows for a rule that has never looked, and for a
   destination nothing has ever been sent to.

   The 26-route data-reality audit found that on the live dashboard four of
   the eight alert rules have never reached a verdict (Stadiora/Aria#10812),
   with seven problems open, the oldest 51 days old, and not one notification
   ever delivered (Stadiora/Aria#10811). The pane half of both is one
   question: does a rule that has never looked render like a rule that looked
   and found nothing?

   "Not one notification ever delivered" is the durable half and the only one
   asserted here: every row of `ops_alert_notifications` carries
   `delivered_at` null. Whether a destination is CONFIGURED is not a fact
   about history at all -- the route computes `configured` from the live
   environment at request time (`isOpsAlertChannelConfigured`), so it can
   differ between two reads a minute apart, and this file states nothing
   about its value.

   It is also not a proxy for the thing above. `ops_alert_channel_state`
   carries `last_success_at` for the channel, written by whatever last used
   it; on 2026-09-21 the email row carried a success at the same instant as a
   handover, while all nine notifications were still undelivered. So a
   channel that reports a delivery is not evidence that anything in this
   queue was delivered, and the pane cannot tell the two apart from the
   payload it is given. What it does instead is decline the claim -- see "a
   destination that has delivered stops the sentence" below.

   Measured before anything here was written, the answer was already mostly
   yes. The ribbon says "4 rules watching" and not 8, a note under it says
   four rules cannot reach a verdict, and each of the four rows says so on its
   own line. Those three behaviours are load-bearing and had no test, so the
   first four tests below pin them against the exact production payload -- a
   regression in any of them would put a confident "8 rules watching" over
   data half of them never saw.

   Three things did need changing, and each has its own test:

     - `no_source_configured` read "nothing is feeding it yet". Waiting does
       not fix a missing source, and #10812 asked for the two to be told
       apart.
     - Nothing anywhere said that no notification has ever been sent. Each
       destination row was honest on its own; the aggregate an operator needs
       was three bands below the queue and never stated.
     - `armedState({})` produced `channels: []`, which the pane printed as
       "No notification channel is set up." -- a claim about the world taken
       from a gap in the payload.

   And Stadiora/Aria#10821: the shared API stub's `channels` fixture carried
   `status`/`target`/`lastDeliveredAt`/`failureReason`, none of which the pane
   reads, so the stub drew two nameless rows both saying no destination was
   set. The last two tests bind the stub's own answer against the pane.

   How these bind:

     - The rule fixtures are the production rows from #10812 verbatim, keys
       and statuses and reasons, not a sketch of them. If the pane stops
       telling the truth it will be about this payload.

     - Every absence assertion is preceded by the same finder locating the
       thing on a render that has it, so a finder that matches nothing cannot
       pass by matching nothing.

     - The stub test imports `ops-api-stub.mjs` and feeds its ANSWER to the
       pane. Asserting the fixture's field names would pin the fixture; this
       asserts that what it sends draws a destination.

   NOT COVERED here:

     - Whether the rules are evaluated, or whether a notification is sent.
       Both are backend behaviour on Stadiora/Aria and neither is reachable
       from this repo.

     - The per-destination sentences. `scripts/ops-alerts-v2.test.mjs` owns
       `channelNote()`'s branches and that file is held by another PR. What is
       new here is the aggregate and the label fallback. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';
import { stub } from './ops-api-stub.mjs';

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

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const at = (back) => new Date(Date.now() - back).toISOString();

/* ------------------------------------------------------------- fixtures */

/* `ops_alert_rules` as the audit read it on 2026-09-21, all eight rows.

   Four have never reached a verdict: `ai_success_rate`, `queue_backlog_age`
   and `stalled_staged_rollout` for want of samples, `crash_free_rate`
   because nothing is wired up to feed it at all. That last distinction is
   the whole of one of the fixes below, so it is in the fixture rather than
   flattened into "four cannot judge". */
function prodRules() {
  return [
    { ruleKey: 'ai_success_rate', title: 'AI success rate', category: 'ai_reliability',
      categoryLabel: 'AI reliability', severity: 'critical', enabled: true,
      threshold: 'below 95% for 10m', thresholdLabel: 'below 95% for 10m',
      scopeLabel: 'Per request type', scopeDescription: 'Per request type',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_samples', lastFiredAt: null },
    { ruleKey: 'cost_reconciliation_blocked', title: 'Cost reconciliation blocked',
      category: 'cost', categoryLabel: 'Cost', severity: 'warning', enabled: true,
      threshold: 'blocked for 24h', thresholdLabel: 'blocked for 24h',
      scopeLabel: 'Daily rollup', scopeDescription: 'Daily rollup',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'firing',
      lastInsufficientReason: null, lastFiredAt: at(42 * DAY) },
    { ruleKey: 'crash_free_rate', title: 'Crash-free rate', category: 'mobile',
      categoryLabel: 'Mobile', severity: 'critical', enabled: true,
      threshold: 'below 99% for 1h', thresholdLabel: 'below 99% for 1h',
      scopeLabel: 'Per app', scopeDescription: 'Per app',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_source_configured', lastFiredAt: null },
    { ruleKey: 'data_silence', title: 'Data silence', category: 'ingestion',
      categoryLabel: 'Ingestion', severity: 'critical', enabled: true,
      threshold: 'no rows for 6h', thresholdLabel: 'no rows for 6h',
      scopeLabel: 'All sources', scopeDescription: 'All sources',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'firing',
      lastInsufficientReason: null, lastFiredAt: at(49 * DAY) },
    { ruleKey: 'queue_backlog_age', title: 'Queue backlog age', category: 'jobs',
      categoryLabel: 'Jobs', severity: 'warning', enabled: true,
      threshold: 'over 30m', thresholdLabel: 'over 30m',
      scopeLabel: 'Sprint video analysis', scopeDescription: 'Sprint video analysis',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_samples', lastFiredAt: null },
    { ruleKey: 'service_cost_anomaly', title: 'Unusual cost for a service', category: 'cost',
      categoryLabel: 'Cost', severity: 'warning', enabled: true,
      threshold: 'over 25%', thresholdLabel: 'over 25%',
      scopeLabel: 'Against the last 7 days', scopeDescription: 'Against the last 7 days',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'ok',
      lastInsufficientReason: null, lastFiredAt: at(3 * DAY) },
    { ruleKey: 'spend_forecast', title: 'Spend forecast', category: 'cost',
      categoryLabel: 'Cost', severity: 'warning', enabled: true,
      threshold: 'over budget', thresholdLabel: 'over budget',
      scopeLabel: 'Month to date', scopeDescription: 'Month to date',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'firing',
      lastInsufficientReason: null, lastFiredAt: at(49 * DAY) },
    { ruleKey: 'stalled_staged_rollout', title: 'Stalled staged rollout',
      category: 'releases', categoryLabel: 'Releases', severity: 'warning', enabled: true,
      threshold: 'no movement for 48h', thresholdLabel: 'no movement for 48h',
      scopeLabel: 'Per app', scopeDescription: 'Per app',
      lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_samples', lastFiredAt: null },
  ];
}

/* A `channels` payload with nothing configured and nothing ever delivered.

   Not a snapshot of `ops_alert_channel_state`, and deliberately not called
   one: `configured` is computed from the live environment per request, so a
   fixture asserting today's value would be a claim that goes stale without
   failing. This is the shape the pane is being tested against. */
function prodChannels() {
  return [
    { channel: 'teams', label: 'Microsoft Teams', configured: false,
      lastDeliveryStatus: null, lastFailureReason: 'config', consecutiveFailures: 0,
      lastAttemptAt: null, lastSuccessAt: null },
    { channel: 'email', label: 'Email', configured: false,
      lastDeliveryStatus: null, lastFailureReason: 'config', consecutiveFailures: 0,
      lastAttemptAt: null, lastSuccessAt: null },
  ];
}

function problem(over) {
  return Object.assign({
    id: 'prb_1', reference: 'AO-101',
    ruleKey: 'data_silence', ruleTitle: 'Data silence', ruleThreshold: 'no rows for 6h',
    severity: 'critical', category: 'ingestion', categoryLabel: 'Ingestion',
    status: 'open', title: 'Data silence', summary: 'No rows have arrived.',
    scopeKey: 'all', scopeLabel: 'All sources',
    observedValue: 0, thresholdValue: 1, durationSeconds: 21600, detail: null,
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    firstBreachedAt: at(51 * DAY), firedAt: at(51 * DAY),
    lastObservedAt: at(MINUTE), conditionClearedAt: null,
    acknowledgedAt: null, acknowledgedByEmail: null,
    closedAt: null, closedByEmail: null, closeReason: null,
  }, over || {});
}

/* Seven open, the oldest 51 days, as the audit counted them. */
function prodProblems() {
  return [
    problem({ id: 'p1', reference: 'AO-101' }),
    problem({ id: 'p2', reference: 'AO-102', scopeLabel: 'Workouts' }),
    problem({ id: 'p3', reference: 'AO-103', severity: 'warning', scopeLabel: 'aria-api' }),
    problem({ id: 'p4', reference: 'AO-104', severity: 'warning', scopeLabel: 'Month to date' }),
    problem({ id: 'p5', reference: 'AO-105', severity: 'warning', scopeLabel: 'Daily rollup' }),
    problem({ id: 'p6', reference: 'AO-106', severity: 'warning', scopeLabel: 'app-backend' }),
    problem({ id: 'p7', reference: 'AO-107', severity: 'warning', scopeLabel: 'coaches-web' }),
  ];
}

/* ------------------------------------------------------------------ boot */

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

/* `rules` takes the whole `/api/ops/alerts/rules` answer, so a test can send
   one with no `channels` key at all -- which is the shape the confident-zero
   test is about and which no `channels: []` default could express. */
async function boot(options) {
  const opts = options || {};
  const rules = opts.rules === undefined
    ? { rules: prodRules(), channels: prodChannels() }
    : opts.rules;
  const problems = opts.problems === undefined ? prodProblems() : opts.problems;

  const answers = {
    '/api/ops/alerts/rules': rules,
    '/api/ops/alerts/problems': problems instanceof Error ? problems : { problems },
  };

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/alerts.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      const key = Object.keys(answers).filter((k) => endpoint.indexOf(k) === 0)[0];
      if (!key) return Promise.resolve({ data: {} });
      const answer = answers[key];
      if (answer instanceof Error) return Promise.reject(answer);
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

  for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r));
  return dom;
}

/* ------------------------------------------------------- what is drawn */

const hasClass = (node, name) =>
  String(node.className || '').split(/\s+/).indexOf(name) !== -1;

function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once, so "what the operator sees" `
    + 'is not a single answer');
  return boxes[0];
}

const screenText = (dom) => allText(shownPanel(dom)).replace(/\s+/g, ' ').trim();

/* The ribbon at the top of the pane, whole. "N rules watching" is drawn into
   `hero-sub` rather than into a pill, and the pills it sits beside carry the
   severity counts, so reading pills alone across the panel picks up every
   queue row's chips and none of the sentence. */
function ribbonText(dom) {
  const heroes = findAll(shownPanel(dom), (n) => hasClass(n, 'hero'));
  assert.equal(heroes.length, 1, 'the pane does not have exactly one ribbon to read');
  return allText(heroes[0]).replace(/\s+/g, ' ').trim();
}

/* The one warn note between the ribbon and the queue. */
function noteText(dom) {
  const notes = findAll(shownPanel(dom), (n) => hasClass(n, 'note'));
  return notes.length ? allText(notes[0]).replace(/\s+/g, ' ').trim() : null;
}

/* Text with nothing done to the whitespace, for the assertions that are
   about the whitespace. */
function rawText(node) {
  if (!node) return '';
  return (node.textContent || '') + (node.childNodes || []).map(rawText).join('');
}

/* Every row in "Where problems are sent", as its name and its status chip. */
function routeRows(dom) {
  return findAll(shownPanel(dom), (n) => hasClass(n, 'c-route')).map((row) => {
    const lines = findAll(row, (n) => hasClass(n, 'strong'));
    const pills = findAll(row, (n) => hasClass(n, 'pill'));
    return {
      name: lines.length ? allText(lines[0]).trim() : '',
      /* The same name with NOTHING done to the whitespace. `allText()` ends
         in `.replace(/\s+/g, ' ').trim()`, so every assertion routed through
         it reads a string the HARNESS tidied -- and a padded label drawn
         with its padding intact looks identical to one drawn trimmed. */
      rawName: lines.length ? rawText(lines[0]) : '',
      /* The status chip, read separately from the row.
         A routing row is TWO statements -- `channelNote()`'s sentence and
         this chip -- and round 3 of PR #124's review showed they need two
         assertions: the note was bound positively while the chip was bound
         only by "carries no digit", and `CHANNEL_STATUS.ok.label` is
         `'Connected'`, which has no digit in it. So a green Connected chip
         sat next to "No destination has been set" at 850/0. */
      chip: pills.length ? allText(pills[pills.length - 1]).replace(/\s+/g, ' ').trim() : '',
      text: allText(row).replace(/\s+/g, ' ').trim(),
    };
  });
}

/* Every rule row's state cell, keyed by the rule's title. */
function ruleStates(dom) {
  const out = {};
  findAll(shownPanel(dom), (n) => n.tagName === 'TR').forEach((row) => {
    const cells = findAll(row, (n) => n.tagName === 'TD');
    if (cells.length < 4) return;
    out[allText(cells[0]).trim()] = allText(cells[3]).replace(/\s+/g, ' ').trim();
  });
  return out;
}

/* ====================================================================== */
/* #10812 -- what the pane already does, pinned so it keeps doing it       */
/* ====================================================================== */

test('the ribbon counts rules that reached a verdict, not rules that exist', async () => {
  const ribbon = ribbonText(await boot());

  /* Four of the eight rows are judging. The number an operator reads has to
     be that four: printing 8 would report that eight things are watching
     when half have never looked at anything. */
  assert.match(ribbon, /\b4 rules watching\b/,
    `the ribbon reads "${ribbon}", which does not say "4 rules watching" -- over a payload `
    + 'where exactly four of eight rules reached a verdict');
  assert.doesNotMatch(ribbon, /\b8 rules watching\b/,
    'the pane counted every rule as watching, including four that have never judged '
    + 'anything');
});

test('a rule that has never judged does not read as a rule that found nothing wrong',
  async () => {
    const states = ruleStates(await boot());

    /* The healthy rule first, so "no row says Checking normally" cannot pass
       because the finder never found a row. */
    assert.equal(states['Unusual cost for a service'], 'Checking normally',
      'the one rule that IS judging does not say so, so the four assertions below read a '
      + 'table this finder cannot parse');

    for (const title of ['AI success rate', 'Crash-free rate', 'Queue backlog age',
      'Stalled staged rollout']) {
      const state = states[title];
      assert.ok(state, `"${title}" has no state cell on screen`);
      assert.doesNotMatch(state, /Checking normally|No problems|Healthy|All clear/i,
        `"${title}" has never reached a verdict and its row reads "${state}", which an `
        + 'operator during an incident would read as this rule having looked');
      assert.match(state, /Not enough data to judge/,
        `"${title}" reads "${state}", which does not say the rule could not judge`);
    }
  });

test('the pane says in words that some of its rules cannot judge', async () => {
  const note = noteText(await boot());
  assert.ok(note, 'there is no note between the ribbon and the queue at all');

  /* The sentence that stops the list below being read as the whole truth. */
  assert.match(note, /A rule that is not judging is not watching/,
    `the note reads "${note}" and does not say that the list below is short`);
});

/* ====================================================================== */
/* #10812 -- a missing source is not a waiting problem                    */
/* ====================================================================== */

test('a rule nothing feeds is told apart from a rule that is merely short of data',
  async () => {
    const dom = await boot();
    const states = ruleStates(dom);
    const note = noteText(dom);

    /* Three rules are waiting for samples; one has no source at all. */
    assert.match(note, /3 rules cannot reach a verdict yet\./,
      `the note reads "${note}" -- the three rules that ARE waiting are not counted as three`);
    assert.match(note, /1 rule has nothing wired up to feed it, so waiting will not help\./,
      `the note reads "${note}" -- the rule with no source is not told apart from the ones `
      + 'that are waiting');
    assert.doesNotMatch(note, /4 rules cannot reach a verdict yet/,
      'the note lumps the unwired rule in with the waiting ones, so an operator is told to '
      + 'come back later about a rule that will read the same in a year');

    /* And on the row itself. */
    assert.match(states['Crash-free rate'], /nothing is wired up to feed it/,
      `Crash-free rate reads "${states['Crash-free rate']}"`);
    assert.doesNotMatch(states['Crash-free rate'], /\byet\b/,
      'the row tells an operator to wait for something waiting will not produce');
    assert.match(states['AI success rate'], /nothing has come in to measure/,
      'the rule that IS waiting for samples lost its own wording');
  });

/* ====================================================================== */
/* #10811 -- nothing has ever been delivered                              */
/* ====================================================================== */

test('the pane says that nothing has ever been sent, where the problems are', async () => {
  const note = noteText(await boot());
  assert.match(note, /No destination is set, so nothing here has been sent to anyone\./,
    `the note reads "${note}" -- seven open problems and not one notification ever sent, and `
    + 'the operator is told neither where the queue is nor anywhere near it');
});

test('a destination that is set up but has never delivered says so too', async () => {
  const channels = prodChannels();
  channels[0].configured = true;
  channels[0].lastDeliveryStatus = 'failed';
  const note = noteText(await boot({ rules: { rules: prodRules(), channels } }));

  assert.match(note, /Nothing has ever been delivered, on any destination that is set up\./,
    `the note reads "${note}" -- a configured destination that has never succeeded is not `
    + 'the same as no destination, and the sentence has to change with it');
  assert.doesNotMatch(note, /No destination is set/,
    'a destination IS set, and the pane said otherwise');
});

test('a destination that has delivered stops the sentence', async () => {
  const channels = prodChannels();
  channels[0].configured = true;
  channels[0].lastDeliveryStatus = 'ok';
  channels[0].lastSuccessAt = at(5 * MINUTE);
  const note = noteText(await boot({ rules: { rules: prodRules(), channels } }));

  /* The note still exists -- four rules still cannot judge -- so this is a
     real absence inside a real note, not the note being gone. */
  assert.ok(note, 'the note vanished entirely, so the absence below proves nothing');
  assert.doesNotMatch(note, /has ever been delivered|been sent to anyone/,
    `the note reads "${note}" and claims nothing has been delivered, over a payload where `
    + 'something has');
});

test('an unreadable queue is not told that nothing in it has been sent', async () => {
  /* The sentence is about THESE problems reaching nobody. When the problems
     read failed, what is in the queue is unknown, so there is no "these" to
     make the claim about.

     This is the reachable empty queue, and the only one. A read that LANDS
     with no problems takes the pane's empty branch several lines earlier and
     never calls the note at all, so a test booted with `problems: []` cannot
     see this gate however the gate is written -- battery row M15 came back
     green over exactly that draft. A failed read is the one way an empty
     queue reaches the note. */
  const dom = await boot({ problems: Object.assign(new Error('problems are down'),
    { status: 503 }) });
  const text = screenText(dom);

  /* The rules half still rendered, so this is an absence inside a note that
     exists rather than a note that is gone. */
  assert.match(text, /A rule that is not judging is not watching/,
    'the note is not on screen at all, so the absence below proves nothing');
  assert.doesNotMatch(text, /has been sent to anyone|has ever been delivered/,
    'the pane said these problems reached nobody, over a queue it could not read');
});

test('an answer that did not mention delivery is not read as no delivery', async () => {
  /* `armedState({})` used to produce `channels: []`, and an empty list is
     what the pane prints "No notification channel is set up." over. So a
     read that said nothing at all about destinations produced a confident
     statement that there are none. */
  const dom = await boot({ rules: { rules: prodRules() } });
  const text = screenText(dom);

  assert.doesNotMatch(text, /No notification channel is set up\./,
    'the pane stated there are no destinations, from an answer that did not carry the '
    + 'field at all');
  assert.doesNotMatch(text, /nothing here has been sent to anyone/,
    'the pane claimed nothing has been delivered, from an answer that said nothing about '
    + 'delivery');
  assert.match(text, /did not say where problems are sent/,
    'the pane neither stated the gap nor admitted it');
});

test('a known-empty list still says there are no destinations', async () => {
  /* The other side of the same gate, and the reason it is a gate rather than
     a deletion: an answer that DID carry the field and carried nothing in it
     supports exactly the sentence the absent case does not. */
  const dom = await boot({ rules: { rules: prodRules(), channels: [] } });
  const text = screenText(dom);

  assert.match(text, /No notification channel is set up\./,
    'a read that landed and reported zero destinations stopped saying so');
  assert.doesNotMatch(text, /did not say where problems are sent/,
    'a read that DID say where problems are sent was reported as silent');
});

/* ====================================================================== */
/* #10821 -- the stub's fixture, and rows with no name                    */
/* ====================================================================== */

test('the shared API stub sends a shape the pane can draw destinations from', async () => {
  /* The stub's own answer, not a transcription of it. A test that asserted
     the fixture's field names would go green on a fixture the pane cannot
     read, which is exactly the state #10821 was filed about. */
  const sent = stub('/api/ops/alerts/rules').data;
  assert.ok(sent.channels && sent.channels.length >= 2,
    'the stub no longer sends channels, so there is nothing here to check');

  const rows = routeRows(await boot({ rules: sent }));
  assert.equal(rows.length, sent.channels.length,
    `the stub sent ${sent.channels.length} destinations and the pane drew ${rows.length}`);

  for (const row of rows) {
    assert.notEqual(row.name, '',
      `a destination row drew with no name at all: "${row.text}"`);
    assert.doesNotMatch(row.text, /No destination has been set/,
      `the stub's destination drew as unconfigured: "${row.text}" -- the fixture is `
      + 'describing a payload the route does not send');
  }

  /* And the states actually differ, measured WITHOUT the names.

     The first draft took the distinctness of `row.text`, which carries the
     destination's own name -- so three rows in identical states wearing three
     different names counted as three distinct states, which is precisely the
     fixture defect the assertion claims to reject. Round 2 of the review
     proved it by giving all three channels Teams' delivered state and leaving
     their labels alone: 848/848 green.

     The stripping is `slice(name.length)`, which is only right because the
     name is the first text in the row. Nothing said so, and round 3 of the
     review pointed out that anything drawn before the name would silently
     chop state text instead -- leaving name fragments in `states` and
     restoring the exact defect this block exists to reject, with no
     failure. So the assumption is now asserted rather than assumed. */
  for (const r of rows) {
    assert.ok(r.text.startsWith(r.name),
      `the row for "${r.name}" reads "${r.text}", which does not start with its own `
      + 'name -- slicing the name off below would cut state text instead');
  }
  const states = rows.map((r) => r.text.slice(r.name.length).trim());
  assert.equal(new Set(states).size, rows.length,
    `the stub's destinations draw as ${JSON.stringify(states)} -- the fixture exercises `
    + 'fewer branches than it has rows');

  /* Named, so losing one to a fixture edit fails here rather than quietly
     reducing what the stub can show. These are the three states
     `channelNote()` has for a configured destination, and the third is what
     Stadiora/Aria#10811 is asking somebody to create. */
  for (const want of [/Last delivered/, /Last attempt .*refused/, /nothing sent through/]) {
    assert.ok(states.some((t) => want.test(t)),
      `no destination the stub sends is in the ${want} state; it draws `
      + `${JSON.stringify(states)}`);
  }
});

test('a destination with no label is still identified', async () => {
  const channels = prodChannels();
  delete channels[0].label;
  const rows = routeRows(await boot({ rules: { rules: prodRules(), channels } }));

  assert.equal(rows.length, 2, 'the unlabelled destination took a row down with it');
  assert.equal(rows[0].name, 'teams',
    `the unlabelled destination is named "${rows[0].name}" -- a row that cannot say which `
    + 'destination it is about is a row nobody can act on');
  assert.equal(rows[1].name, 'Email',
    'the labelled destination lost its label');
});

/* ====================================================================== */
/* Raised by the independent review of PR #124                            */
/* ====================================================================== */

test('a destination that delivered before it was disconnected stops the sentence',
  async () => {
    /* `everDelivered` filtered to CONFIGURED channels while its comment said
       "anywhere". A webhook that delivered and was later rotated out leaves
       `configured: false` beside a real `lastSuccessAt`, and the pane said
       "nothing here has been sent to anyone" over a payload carrying the
       timestamp of something that was. `ops_alert_channel_state` keeps
       `status` and `last_success_at` independently, so this is the state that
       configuring Teams for #10811 and later rotating the webhook produces. */
    const channels = prodChannels();
    channels[0].configured = false;
    channels[0].lastSuccessAt = at(30 * DAY);
    const note = noteText(await boot({ rules: { rules: prodRules(), channels } }));

    assert.ok(note, 'the note vanished entirely, so the absence below proves nothing');
    assert.doesNotMatch(note, /has ever been delivered|been sent to anyone/,
      `the note reads "${note}" and claims nothing has ever been sent, over a payload `
      + 'whose own lastSuccessAt says something was');
  });

test('one render does not both deny and report a delivery', async () => {
  /* Three spellings of "is this destination configured" -- `c.configured ===
     true` in the model, `channel.configured ?` on the routing chip, and
     `!c.configured` on Overview's -- put "No destination is set" above the
     queue and "Connected · Last delivered 5 minutes ago" three bands below
     it, on one render. Two panes disagreeing during one incident is
     #10630; this was one pane disagreeing with itself. */
  const channels = prodChannels();
  channels.forEach((c) => {
    c.configured = 'yes';
    c.lastDeliveryStatus = 'ok';
    c.lastSuccessAt = null;
    c.lastAttemptAt = null;
  });
  const dom = await boot({ rules: { rules: prodRules(), channels } });
  const note = noteText(dom);
  const rows = routeRows(dom);

  const denies = /No destination is set/.test(note || '');
  assert.ok(rows.length >= 2,
    `the finder saw ${rows.length} routing rows, so the agreement below is vacuous`);

  /* The chip finder, demonstrated on a render where the chip says something
     ELSE. A finder that returns '' for every row would satisfy nothing below
     and look like a pass; this is the render that proves it reads the chip
     and that the chip varies with the payload. */
  const wired = prodChannels();
  wired.forEach((c) => {
    c.configured = true;
    c.lastDeliveryStatus = 'ok';
    c.lastSuccessAt = new Date(Date.now() - 300_000).toISOString();
  });
  const wiredChips = routeRows(await boot({ rules: { rules: prodRules(), channels: wired } }))
    .map((r) => r.chip);
  assert.ok(wiredChips.length >= 2 && wiredChips.every((c) => c === 'Connected'),
    `the chip finder read ${JSON.stringify(wiredChips)} on a payload whose destinations `
    + 'are all set up and delivering, so it is not reading the chip');

  /* Asserted as the EXPECTED STATE of every row, not as the absence of two
     spellings. The first draft tested `!/Connected|Set up/`, which round 2
     of the review broke by having the unconfigured branch return a "Last
     delivered ..." string: the note still denied, the rows still reported,
     and the test passed because it had never heard of that wording. An
     oracle that recognises a finite list of ways to be wrong is a filter, not
     a test.

     A row is TWO statements, and round 3 of the review found the second one
     bound by nothing. `channelNote()`'s sentence was pinned positively; the
     CHIP was covered only by `doesNotMatch(/\d/)`, and `Connected` carries
     no digit -- so relaxing `channel.configured === true` to
     `channel.configured` on the chip alone rendered "Microsoft Teams · No
     destination has been set · Connected" at 15/15 and 850/0. Both halves
     are now stated positively, by name. */
  for (const row of rows) {
    assert.match(row.text, /No destination has been set/,
      `the note says "${note}" while a routing row says "${row.text}"`);
    assert.equal(row.chip, 'Not configured',
      `the row for "${row.name}" says "No destination has been set" under a `
      + `"${row.chip}" chip -- the sentence and the chip disagree on one render`);
  }

  /* And the direction is the strict one, so the pane treats a value that is
     not the boolean the column holds as "not set up" rather than as set up. */
  assert.ok(denies,
    `the note reads "${note}" -- a configured flag of 'yes' was read as configured`);
});

test('a rule whose reason is a word every object answers to does not print a function',
  async () => {
    /* #10630 on the adjacent map. `INSUFFICIENT_REASON` is a plain object
       literal, so `INSUFFICIENT_REASON['constructor']` is `Object` and the
       rule row printed `function Object() { [native code] }` at an operator
       mid-incident. The severity pill one screen above was hardened for this;
       the rule state cell was not. */
    const healthy = ruleStates(await boot());
    assert.ok(Object.keys(healthy).length >= 8,
      `the finder saw ${Object.keys(healthy).length} rule rows, so a clean result below `
      + 'would mean the probe never reached the render path');
    assert.ok(Object.values(healthy).some((t) => /Not enough data to judge/.test(t)),
      'no rule row reads "Not enough data to judge" on the production payload, so this '
      + 'test is not reading the cell it names');

    for (const reason of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const rules = prodRules();
      const target = rules.find((r) => r.lastEvaluationStatus === 'insufficient_data');
      assert.ok(target, 'no rule in the production payload is short of data');
      target.lastInsufficientReason = reason;
      const states = ruleStates(await boot({ rules: { rules, channels: prodChannels() } }));
      const cell = states[target.title];

      assert.ok(cell, `no rule row was drawn for ${JSON.stringify(target.title)}`);
      assert.doesNotMatch(cell, /\[native code\]|function \w*\(/,
        `a reason of "${reason}" drew the source of a function at an operator: "${cell}"`);
      assert.match(cell, /Not enough data to judge/,
        `a reason of "${reason}" took down the words around it: "${cell}"`);
    }
  });

/* ====================================================================== */
/* Raised by round 5 of the independent review of PR #124                 */
/* ====================================================================== */

/* A stamp the answer carries and `new Date()` cannot read. All three reach
   this pane from the stack below it: Postgres renders `timestamptz` with a
   TWO-digit UTC offset, which ECMA-262's Date Time String Format does not
   accept; `timestamptz 'infinity'` serialises verbatim; and epoch seconds
   that went through JSON as a string arrive as digits. */
const UNREADABLE = ['2026-09-21T14:00:00+00', 'infinity', '1758470400'];

test('a delivery time the pane cannot read is not reported as never delivered',
  async () => {
    /* The PR gave "has anything ever arrived" a SECOND spelling and did not
       align it with the first. `armedState().everDelivered` PARSES the stamp;
       `channelNote()` tested it for TRUTH. They agree on absent and they
       agree on valid -- the only two values the test above ever handed them --
       and they disagree on exactly one class, which is a stamp that is there
       and cannot be read. One render then said "Nothing has ever been
       delivered, on any destination that is set up" above two green
       "Connected · Last delivered -" rows, which is the two-panes-disagreeing
       defect of #10630 inside a single render, on the pane whose whole
       subject is that delivery has never worked (#10811). */
    const configured = (over) => prodChannels().map((c) => Object.assign(c, {
      configured: true, lastDeliveryStatus: 'ok', lastAttemptAt: null,
    }, over));
    const render = async (over) =>
      boot({ rules: { rules: prodRules(), channels: configured(over) },
        problems: prodProblems() });

    /* Two gates, because both halves of the disagreement are asserted below
       and a finder that read neither would look like a pass. The denial has
       to be a sentence this probe can SEE, and the row has to be one that
       reports a delivery when there is one to report. */
    const denied = noteText(await render({ lastSuccessAt: null }));
    assert.match(denied || '', /Nothing has ever been delivered/,
      `a payload with no delivery anywhere drew the note "${denied}", so the absence of `
      + 'that sentence below would prove nothing');
    const good = routeRows(await render({ lastSuccessAt: at(5 * MINUTE) }));
    assert.ok(good.length >= 2 && good.every((r) => /Last delivered \w/.test(r.text)),
      `a payload with a real delivery drew ${JSON.stringify(good.map((r) => r.text))}, so `
      + 'the row finder is not reading the delivery line');

    for (const stamp of UNREADABLE) {
      const dom = await render({ lastSuccessAt: stamp });
      const note = noteText(dom);
      const rows = routeRows(dom);

      assert.ok(note, `"${stamp}" drew no note at all, so the pane said nothing about a `
        + 'delivery it cannot date');
      assert.doesNotMatch(note, /has ever been delivered|been sent to anyone/,
        `the note reads "${note}" and denies any delivery, over a payload whose own `
        + `lastSuccessAt of "${stamp}" reports one`);
      assert.match(note, /cannot be read/,
        `the note reads "${note}" -- a stamp the pane cannot read is a thing it cannot `
        + 'tell, and saying so is the only honest answer available');

      assert.equal(rows.length, 2, `"${stamp}" drew ${rows.length} routing rows`);
      for (const row of rows) {
        assert.ok(!/Last delivered/.test(row.text),
          `the row for "${row.name}" reads "${row.text}" -- "Last delivered -" reads as a `
          + 'delivery whose time is merely missing, while the note above denies it');
        assert.match(row.text, /Delivered, at a time that cannot be read/,
          `the row for "${row.name}" reads "${row.text}", which does not say what is `
          + 'actually wrong with the stamp');
      }
    }
  });

test('a destination whose failure reason is a word every object answers to '
  + 'does not print a function', async () => {
  /* #10630 again, on the destinations card rather than the rule table.
     `CHANNEL_FAILURE` is a plain object literal, so a reason of `constructor`
     resolved to Object through the prototype chain and the row printed
     `function Object() { [native code] }` at an operator. */
  const failing = (reason) => prodChannels().map((c) => Object.assign(c, {
    configured: true, lastDeliveryStatus: 'failed', lastFailureReason: reason,
    lastAttemptAt: at(30 * MINUTE), consecutiveFailures: 1,
  }));
  const render = async (reason) =>
    routeRows(await boot({ rules: { rules: prodRules(), channels: failing(reason) } }));

  const known = await render('auth');
  assert.ok(known.length >= 2 && known.every((r) => /it was refused/.test(r.text)),
    `a known failure reason drew ${JSON.stringify(known.map((r) => r.text))}, so this test `
    + 'is not reading the line it is about to check');

  for (const reason of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    for (const row of await render(reason)) {
      assert.doesNotMatch(row.text, /\[native code\]|function \w*\(/,
        `a failure reason of "${reason}" drew the source of a function at an operator: `
        + `"${row.text}"`);
      assert.match(row.text, /Last attempt \w/,
        `a failure reason of "${reason}" took down the words around it: "${row.text}"`);
    }
  }
});

test('a delivery status no map knows does not draw the word undefined', async () => {
  /* The sibling hole, and the one a falsy fallback cannot close.
     `CHANNEL_STATUS['constructor']` is `Object`, which is TRUTHY, so
     `|| null` never fired and `status.label` was `undefined` -- rendered as
     the literal five letters, in the chip, next to a real destination. */
  const withStatus = (status) => prodChannels().map((c) => Object.assign(c, {
    configured: true, lastDeliveryStatus: status, lastSuccessAt: at(5 * MINUTE),
  }));
  const render = async (status) =>
    routeRows(await boot({ rules: { rules: prodRules(), channels: withStatus(status) } }));

  const ok = await render('ok');
  assert.ok(ok.length >= 2 && ok.every((r) => r.chip === 'Connected'),
    `a known status drew chips ${JSON.stringify(ok.map((r) => r.chip))}, so a clean result `
    + 'below would mean the probe never reached the chip');

  for (const status of ['constructor', 'toString', '__proto__', 'valueOf']) {
    for (const row of await render(status)) {
      assert.equal(row.chip, 'Nothing sent yet',
        `a delivery status of "${status}" drew the chip "${row.chip}" -- an unrecognised `
        + 'status is a status the pane does not know, and it has a word for that');
      assert.doesNotMatch(row.text, /\[native code\]|function \w*\(/,
        `a delivery status of "${status}" drew a function at an operator: "${row.text}"`);
    }
  }
});

test('a destination label made of spaces is not a label', async () => {
  /* #10799 on the row this PR rewrote, in both of its shapes.

     A label of three spaces is a label with nothing in it, and drawing it
     produces a name-shaped element carrying nothing -- the blank row #10821
     was filed about, wearing a different payload. And a label with words
     inside padding is the predicate/value split: `textOf()` decides, and
     whatever gets CONCATENATED is what the operator reads.

     The two need separate payloads, and finding that out is what this test
     is worth. The first draft used the blank label for both, so the battery
     row that put the split back came back GREEN -- with a blank label the
     split cannot express itself, because both branches fall through to the
     channel key. Not a blind test: a payload that could not reach the
     defect. */
  const withLabel = async (label) => {
    const channels = prodChannels();
    channels[0].label = label;
    return routeRows(await boot({ rules: { rules: prodRules(), channels } }));
  };

  const blank = await withLabel('   ');
  assert.equal(blank.length, 2, 'the blank label took a row down with it');
  assert.equal(blank[0].name, 'teams',
    `the destination whose label is three spaces is named "${blank[0].name}" -- a row that `
    + 'cannot say which destination it is about is a row nobody can act on');
  assert.equal(blank[1].name, 'Email', 'the labelled destination lost its label');

  const padded = await withLabel('  Microsoft Teams  ');
  assert.equal(padded[0].rawName, 'Microsoft Teams',
    `the padded label drew ${JSON.stringify(padded[0].rawName)} -- the row decided with a `
    + 'trimmed value and drew an untrimmed one, which is the same defect wearing its own fix');
});

test('a pane where waiting will not help does not say nought rules are waiting',
  async () => {
    /* `insufficientData > unconfigured`, and the boundary is the state
       #10812 reaches the moment the three sample-starved rules get samples:
       every rule that is short of data is short of it because nothing feeds
       it, so the two counts are EQUAL and the subtraction is zero. No
       fixture had ever put them equal, so `>=` there printed "0 rules cannot
       reach a verdict yet." at an operator and nothing noticed. */
    const waiting = noteText(await boot());
    assert.match(waiting || '', /3 rules cannot reach a verdict yet/,
      `the production payload drew the note "${waiting}", so this test is not reading the `
      + 'sentence whose disappearance it is about to require');

    const rules = prodRules();
    rules.forEach((r) => {
      if (r.lastEvaluationStatus === 'insufficient_data') {
        r.lastInsufficientReason = 'no_source_configured';
      }
    });
    const note = noteText(await boot({ rules: { rules, channels: prodChannels() } }));

    assert.ok(note, 'the note vanished, so the absence below proves nothing');
    assert.doesNotMatch(note, /cannot reach a verdict yet/,
      `the note reads "${note}" -- with every short-of-data rule short because nothing `
      + 'feeds it, no rule is merely waiting and a count of them is a count of nothing');
    assert.match(note, /4 rules have nothing wired up to feed them/,
      `the note reads "${note}" and does not say what is actually wrong with the four`);

    /* Found by the payload above rather than looked for: no fixture had ever
       put more than one rule in this branch, so the sentence was written
       singular under a plural count and read "4 rules HAS nothing wired up
       to feed it". `fmt.plural()` pluralises the noun and nothing was
       pluralising the verb. The same line one branch down said "4 rules has
       never run." */
    const never = prodRules();
    never.forEach((r) => { r.lastEvaluatedAt = null; r.lastEvaluationStatus = null; });
    const neverNote = noteText(await boot({ rules: { rules: never, channels: prodChannels() } }));
    assert.match(neverNote || '', /8 rules have never run/,
      `eight rules that have never run drew "${neverNote}"`);
  });

test('an insufficient reason every object answers to is not counted as unwired',
  async () => {
    /* `UNCONFIGURED_REASON[reason] === true`, not a truth test.
       `UNCONFIGURED_REASON['constructor']` is `Object`, which is truthy, so a
       truth test would move a rule out of "waiting" and into "nothing feeds
       it" on a reason the map has never heard of -- and send an operator to
       configure a source for a rule that is simply short of data. */
    const base = noteText(await boot());
    assert.match(base || '', /3 rules cannot reach a verdict yet/,
      `the production payload drew "${base}", so the counts below are not being read`);
    assert.match(base, /1 rule has nothing wired up to feed it/,
      `the production payload drew "${base}", so the unwired count is not being read`);

    for (const reason of ['constructor', 'toString', 'valueOf', '__proto__']) {
      const rules = prodRules();
      const target = rules.find((r) => r.lastInsufficientReason === 'no_samples');
      assert.ok(target, 'no rule in the production payload is merely short of data');
      target.lastInsufficientReason = reason;
      const note = noteText(await boot({ rules: { rules, channels: prodChannels() } }));

      assert.match(note || '', /3 rules cannot reach a verdict yet/,
        `a reason of "${reason}" drew "${note}" -- a rule short of data for a reason the `
        + 'map does not know is still a rule short of data');
      assert.match(note, /1 rule has nothing wired up to feed it/,
        `a reason of "${reason}" drew "${note}" and counted it as unwired, which sends `
        + 'somebody to configure a source that is already configured');
    }
  });
