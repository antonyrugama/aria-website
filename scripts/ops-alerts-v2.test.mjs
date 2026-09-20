/* Unit tests for ops/assets/pane-alerts.js — the Problems pane on the v2
   design system.

   What is worth testing here is what that file's docblock claims, and almost
   all of it is a claim about NOT drawing something, which no screenshot and no
   headless-Chrome overflow check can see:

     - acknowledging and closing stay two different actions, and an
       unacknowledged problem says nobody has it rather than leaving the
       absence to be inferred;
     - a count from a full read reads as a floor, and the disclosure names
       WHICH problems went missing;
     - severity is filtered by the API and category here, and a figure read
       over a scoped answer says so;
     - what the approved design asks for and the API does not carry is named
       where it would have been drawn, never invented: no "right now" column,
       no meter, no observed figure without the unit that gives it meaning;
     - a close note is content, so it is printed from the record rather than
       dropped;
     - an empty page proves which kind of empty it is, and a read that never
       landed is never allowed to claim there is nothing there.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal, inversion or insertion makes that
   test fail. A test with no such line pins nothing.

   NOT COVERED, deliberately and named rather than implied:

     - Layout. Nothing here measures anything; scripts/check-ops-narrow-overflow.mjs
       lays this page out in Chrome at 375px and is the only check that can see
       an overflow.
     - The stylesheet. ops/assets/pane-alerts-v2.css declares no behaviour these
       tests can read, and the tone words it maps are declared by
       ops/assets/aria.css, which this pull request does not edit.
     - Anything the operations API decides. The role checks below prove the
       pane draws a fact rather than a control that would be refused; the
       server enforces the same rules independently and is tested in the Aria
       monorepo.
     - That no value becomes markup. The last test here pins three spellings
       and nothing more; it is a prohibition, not a proof.
     - That a browser moves focus to <body> when the focused element is
       REMOVED, or when it is DISABLED. Both are true in Chrome and neither is
       true in this harness, which has no focus model to lose. Both halves
       were measured on the real page, in rounds 4 and 5 (removal) and round 6
       (disabling) of this pull request's independent review.

       What the tests below CAN decide, and do: that the severity control is
       still the same node after it is pressed, and that a re-read or a
       refused write which STARTS with focus parked on <body> ends with focus
       on the right node. That is the same start state a browser produces when
       a control is disabled or removed, which is why focusAfter() parks there
       rather than resting at null -- resting at null exercised the half of
       the pane's guard that a browser can never reach, and left the half it
       always reaches free to be deleted over a green suite. Round 7 of this
       pull request's review demonstrated exactly that.

       The class is every control that is DISABLED OR DESTROYED by being used,
       which is not the same as every re-read, and not the same as every
       control handler either: rounds 4 through 8 each found members the round
       before had missed -- three re-reads, three more re-reads, three refused
       writes, the two writes that SUCCEED (whose re-read arrives through
       afterChange() rather than from a control's own handler), and then the
       two the server answers ops_problem_moved to, which are afterChange()'s
       other two call sites and are not failures. Sharing a function is not
       the same as being one site: each is named below on its own.

       The guards are pinned in BOTH directions. Narrowing them is round 7's
       finding; widening them to ignore `live` entirely would satisfy every
       assertion that starts from <body> while carrying the operator off a
       control that survived, which is round 4's fix undone -- so the severity
       button and the range select are each used with focus ON them, and
       asserted to still hold it.

       The enumeration below is the part of this file a reader should distrust
       first. */
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
const V1_SHELL_SRC = read('assets/shell.js');
const OPERATE_SRC = read('assets/operate.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-alerts.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

const MINUTE = 60000;
const DAY = 86400000;
const at = (ms) => new Date(Date.now() - ms).toISOString();

/* One whole problem. Every test starts here and takes something away or
   changes one field, because most of what is under test is about absence.

   The title and the summary deliberately contain none of the words
   "critical", "warning" or "info", so a test that the severity is stated in
   words cannot pass on a sentence that happens to contain the word. */
function problem(over) {
  return Object.assign({
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
  }, over || {});
}

function closedProblem(over) {
  return problem(Object.assign({
    id: 'prb_9', reference: 'AO-101', status: 'closed',
    title: 'Chat replies were slow for twenty minutes',
    severity: 'warning',
    firedAt: at(3 * DAY), closedAt: at(2 * DAY),
    closedByEmail: 'owner@example.invalid', closeReason: 'self_resolved',
    acknowledgedAt: at(3 * DAY - 10 * MINUTE),
    acknowledgedByEmail: 'owner@example.invalid',
  }, over || {}));
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
  }, over || {});
}

function rulesFixture(rules) {
  return {
    rules: rules === undefined ? [
      rule(),
      rule({
        ruleKey: 'queue_wait', title: 'GPU queue backing up',
        scopeDescription: 'Sprint video analysis',
        thresholdUnit: 'count', thresholdLabel: 'over 10 for 5m',
        lastEvaluationStatus: 'ok', lastFiredAt: null,
      }),
      rule({
        ruleKey: 'cost_anomaly', title: 'Unusual cost for a service',
        scopeDescription: 'Against the last 7 days',
        thresholdUnit: 'basis_points', thresholdLabel: 'over 25%',
        lastEvaluationStatus: 'insufficient_data',
        lastInsufficientReason: 'below_minimum_samples',
        lastFiredAt: null,
      }),
    ] : rules,
    summary: {},
    channels: [
      { channel: 'teams', label: 'Microsoft Teams', configured: true,
        lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: at(5 * MINUTE), lastSuccessAt: at(5 * MINUTE) },
      { channel: 'email', label: 'Email', configured: false,
        lastDeliveryStatus: null, lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: null, lastSuccessAt: null },
    ],
  };
}

/* A rules answer where nothing is in a position to notice anything: enabled,
   but no rule reached a verdict the last time it ran. */
function blindRules() {
  return rulesFixture([
    rule({ lastEvaluationStatus: 'error', lastFiredAt: null }),
    rule({ ruleKey: 'queue_wait', title: 'GPU queue backing up',
      lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_samples', lastFiredAt: null }),
  ]);
}

function manyProblems(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(problem({
      id: 'prb_' + i, reference: 'AO-' + (200 + i),
      firedAt: at((i + 1) * MINUTE),
      severity: i === 0 ? 'critical' : 'warning',
    }));
  }
  return out;
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

/* Loads the page the way ops/alerts.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module.

   `answers` is handed back mutable, so a test can change what the API says and
   then use a real control on the page to make the pane read again — which is
   the only way to test what survives a re-render. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const role = opts.role || 'owner';
  const answers = {
    open: opts.open === undefined ? { problems: [problem()] } : opts.open,
    closed: opts.closed === undefined ? { problems: [] } : opts.closed,
    rules: opts.rules === undefined ? rulesFixture() : opts.rules,
    detail: opts.detail === undefined ? { runbook: [], timeline: [], ruleHistory: [] } : opts.detail,
    acknowledge: opts.acknowledge === undefined ? {} : opts.acknowledge,
    close: opts.close === undefined ? {} : opts.close,
    patch: opts.patch === undefined ? {} : opts.patch,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/alerts.html' + (opts.search || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  function answerFor(endpoint, o) {
    const method = (o && o.method) || 'GET';
    if (endpoint === '/api/ops/alerts/rules') return answers.rules;
    if (endpoint.indexOf('/api/ops/alerts/rules/') === 0 && method === 'PATCH') return answers.patch;
    if (endpoint === '/api/ops/alerts/problems') {
      return (o && o.query && o.query.status === 'closed') ? answers.closed : answers.open;
    }
    if (/\/acknowledge$/.test(endpoint)) return answers.acknowledge;
    if (/\/close$/.test(endpoint)) return answers.close;
    if (endpoint.indexOf('/api/ops/alerts/problems/') === 0) return answers.detail;
    return undefined;
  }

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({
        endpoint,
        method: (o && o.method) || 'GET',
        query: o && o.query,
        body: o && o.body,
      });
      const answer = answerFor(endpoint, o);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => !roles || roles.indexOf(role) !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-alerts.js' });

  await settle();

  return { ...dom, body, calls, answers, shell: dom.window.OpsPaneShell };
}

async function settle(times) {
  for (let i = 0; i < (times || 10); i += 1) await new Promise((r) => setImmediate(r));
}

/* ------------------------------------------------------------- reading it */

/* The panel the operator can actually see. The loading, empty and degraded
   panels are siblings of it and are hidden by aria.css, so reading the whole
   region would read text nobody is looking at. */
function panel(dom, state) {
  const shown = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1);
  return shown[0];
}

const liveText = (dom) => allText(panel(dom, 'live'));
const emptyText = (dom) => allText(panel(dom, 'empty'));

/* Which of the four states aria.js has actually shown. */
function shownState(dom) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => n.hasAttribute('data-shown'))
    .map((n) => n.getAttribute('data-state'));
}

function withClass(root, cls) {
  return findAll(root, (n) => (n.getAttribute && (n.getAttribute('class') || ''))
    .split(/\s+/).indexOf(cls) !== -1);
}

const problemCards = (dom) => withClass(panel(dom, 'live'), 'p-item');
const ruleRows = (dom) => withClass(dom.doc.body, 'rule-row');

function buttonNamed(root, re) {
  return findAll(root, (n) => n.tagName === 'BUTTON' && re.test(allText(n)))[0] || null;
}

const numerals = (text) => (text.match(/\d/g) || []).length;

/* ================================ focus ================================ */

const severityButton = (dom, label) => findAll(dom.doc.querySelector('.filters-pane'),
  (n) => n.tagName === 'BUTTON' && allText(n) === label)[0];

/* Is this node still the one on the page, or a replacement standing where it
   stood? Identity, not shape: two buttons reading "Critical" are the same to
   every assertion in this file except this one, and the difference between
   them is whether the operator still has focus. */
const stillOnPage = (dom, node) => {
  for (let at = node; at; at = at.parentNode) if (at === dom.doc.body) return true;
  return false;
};

test('picking a severity does not replace the control being picked', async () => {
  const dom = await boot({});
  /* The bar as it is first drawn, before anything is pressed: the pane starts
     on "All" and the bar has to say so, or the operator is looking at an
     unfiltered list with no control claiming it. */
  assert.equal(severityButton(dom, 'All').getAttribute('aria-pressed'), 'true',
    'the severity the pane starts on was not marked on first render');
  assert.equal(severityButton(dom, 'Critical').getAttribute('aria-pressed'), 'false',
    'a severity the pane is not filtering on was marked on first render');

  const pressed = severityButton(dom, 'Critical');
  pressed.focus();
  pressed.dispatch('click');
  await settle();

  /* Node identity is the whole argument: a browser cannot move focus off an
     element that is still there. What this cannot see is the other half --
     that removing it WOULD move focus -- because the harness has no focus
     model to lose. That half is browser behaviour, measured on the real page
     in round 4 of the review (BUTTON "Critical" before, BODY after), and it
     is named in NOT COVERED at the top of this file rather than implied. */
  assert.ok(stillOnPage(dom, pressed),
    'the severity button was replaced by the pick, so the browser drops focus on <body> ' +
    'and the operator is returned to the top of the document on every press');
  assert.equal(pressed.getAttribute('aria-pressed'), 'true',
    'the surviving button did not take the pressed state, so the bar shows a selection ' +
    'the pane is not filtering on');
  assert.equal(severityButton(dom, 'All').getAttribute('aria-pressed'), 'false',
    'the button that was pressed before stayed pressed');
});

/* Park focus on <body>, do the thing, report where focus ended up.

   Parking first is load-bearing: if something already holds focus then the
   assertion afterwards is satisfied by the state the test started in rather
   than by anything the pane did.

   Parking on <body> RATHER THAN null is equally load-bearing, and was a false
   green for three rounds. The pane's guard reads `!live || live ===
   document.body`, and only the second half can ever be true in a browser: a
   disabled or removed control blurs to <body>, never to null. Resting at null
   exercised the branch that cannot happen and left the branch that does free
   to be deleted -- narrowing the guard to `!live` kept the whole suite green
   while dropping focus at every site in Chrome. */
async function focusAfter(dom, act) {
  if (dom.doc.activeElement) dom.doc.activeElement.blur();
  dom.doc.body.focus();
  assert.equal(dom.doc.activeElement, dom.doc.body,
    'the test could not park focus on <body>, so it is not measuring the browser case');
  act();
  await settle();
  return dom.doc.activeElement;
}

/* The read controls are INSIDE the region the re-read replaces, so unlike the
   severity control they cannot survive; what they can do is put focus back.

   Every site that re-reads is asserted here rather than one per shape. The
   sites differ only in which control was pressed, and the defect is per-site:
   the round that fixed two of these left the other three dropping focus over
   a green suite, because nothing named them. */
test('every control that reloads the pane hands focus back rather than dropping it', async () => {
  /* Both halves unreadable: the whole pane is the failed state and the shell
     draws the retry, inside the region the retry replaces. */
  const dead = await boot({
    open: new Error('upstream timed out'),
    rules: new Error('upstream timed out'),
  });
  const wholePane = buttonNamed(dead.doc.body, /Try again/);
  assert.ok(wholePane, 'the whole-pane failure drew no Try again button');
  assert.equal(await focusAfter(dead, () => wholePane.dispatch('click')),
    dead.doc.getElementById('content'),
    'the whole-pane Try again left nothing holding focus, so the operator is on <body>');

  /* One half unreadable: a band above the queue carries its own retry. */
  const partial = await boot({ open: new Error('upstream timed out') });
  const bandAgain = buttonNamed(partial.doc.body, /Try again/);
  assert.ok(bandAgain, 'the partly failed read drew no Try again button');
  assert.equal(await focusAfter(partial, () => bandAgain.dispatch('click')),
    partial.doc.getElementById('content'),
    'the band Try again left nothing holding focus');

  /* Clear the filters on the pane's own window: the shell has no range to put
     back, so the pane re-reads for itself. */
  const empty = await boot({ open: { problems: [problem({ severity: 'warning' })] } });
  empty.answers.open = { problems: [] };
  severityButton(empty, 'Critical').dispatch('click');
  await settle();
  const clear = buttonNamed(empty.doc.body, /Clear the filters/);
  assert.ok(clear, 'the filtered empty state drew no Clear the filters button');
  assert.equal(await focusAfter(empty, () => clear.dispatch('click')),
    empty.doc.getElementById('content'),
    'Clear the filters left nothing holding focus');

  /* The same button on a window that is not the pane's default takes the
     other branch: the shell puts the range back and the re-read arrives as
     ops:filters instead. One control, two code paths, and the path an
     operator reaches by changing the window was the one left dropping focus. */
  const wide = await boot({
    search: '?range=7d',
    open: { problems: [problem({ severity: 'warning' })] },
  });
  wide.answers.open = { problems: [] };
  severityButton(wide, 'Critical').dispatch('click');
  await settle();
  const clearWide = buttonNamed(wide.doc.body, /Clear the filters/);
  assert.ok(clearWide, 'the filtered empty state drew no Clear the filters button');
  assert.equal(await focusAfter(wide, () => clearWide.dispatch('click')),
    wide.doc.getElementById('content'),
    'Clear the filters on a window the pane does not start on left nothing holding focus');

  /* And it is CONDITIONAL, which the sites above cannot show: they all start
     from <body>, so a guard that ignored `live` entirely would satisfy every
     one of them while undoing the fix that started this whole class. The
     severity control is marked in place rather than rebuilt, so the operator
     is still standing on the button they pressed and nothing may move them. */
  const standing = await boot({});
  const critical = severityButton(standing, 'Critical');
  critical.focus();
  critical.dispatch('click');
  await settle();
  assert.equal(standing.doc.activeElement, critical,
    'pressing a severity carried the operator off the button they were standing on');

  /* The same question for the range control, which lives in the shell rather
     than in this pane and is a <select> rather than a button. */
  const ranged = await boot({ search: '?range=7d' });
  const select = findAll(ranged.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'SELECT')[0];
  assert.ok(select, 'the filter bar drew no select');
  select.focus();
  select.dispatch('change');
  await settle();
  assert.equal(ranged.doc.activeElement, select,
    'changing a filter carried the operator out of the control they were using');

  /* A rule switch disables itself while the PATCH is in flight, which drops
     focus on its own before the re-read replaces the row. */
  const rules = await boot({});
  const sw = withClass(rules.doc.body, 'sw')[0];
  assert.ok(sw, 'the rules table drew no switch');
  assert.equal(await focusAfter(rules, () => { sw.checked = false; sw.dispatch('change'); }),
    rules.doc.getElementById('content'),
    'turning a rule off left nothing holding focus');
});

/* The first read is not a re-read. Nothing has been thrown away, so there is
   nothing to hand back, and moving focus into the content region on load would
   take a keyboard user past the skip link and the rail without asking. */
test('the first read does not move focus', async () => {
  const dom = await boot({});
  assert.equal(dom.doc.activeElement, null,
    'loading the page moved focus, so the operator was carried past the rail');
});

/* The other half of the class, and the half that is NOT about re-reading: a
   write the server refuses disables its control, fails, and re-enables it,
   re-reading nothing. In Chrome the disable blurs the control to <body> and
   nothing puts it back; in this harness disabling does not move focus at all,
   so the discriminating signal is the same in both -- start with focus on
   NOTHING, and end with it on the control. Without the handback the pane
   leaves it where it was, which here is null and in Chrome is <body>; neither
   is the control. */
test('a write the server refuses hands the control back rather than dropping it', async () => {
  const refused = new Error('The operations API did not answer.');

  const ack = await boot({ acknowledge: refused });
  const take = buttonNamed(problemCards(ack)[0], /I am on it/);
  assert.ok(take, 'the open problem was offered no acknowledge button');
  assert.equal(await focusAfter(ack, () => take.dispatch('click')), take,
    'a refused acknowledge left the operator nowhere, at the top of the document');
  assert.equal(take.disabled, false, 'the refused acknowledge button was left unusable');

  /* "Nowhere" has two spellings and the guard accepts both. Chrome produces
     <body>, which is what focusAfter() rests on because it is the reachable
     one; a document with nothing focused at all produces null, which is
     defensive and is this scenario. Both branches of the guard are pinned, or
     the unpinned one is free to be deleted -- which is exactly how the <body>
     half survived three rounds. */
  const nulled = await boot({ acknowledge: refused });
  const nowhere = buttonNamed(problemCards(nulled)[0], /I am on it/);
  assert.equal(nulled.doc.activeElement, null, 'the page did not start with focus nowhere');
  nowhere.dispatch('click');
  await settle();
  assert.equal(nulled.doc.activeElement, nowhere,
    'a refused acknowledge with focus nowhere at all left it nowhere');

  const rule = await boot({ patch: refused });
  const sw = withClass(rule.doc.body, 'sw')[0];
  assert.ok(sw, 'the rules table drew no switch');
  assert.equal(await focusAfter(rule, () => { sw.checked = false; sw.dispatch('change'); }), sw,
    'a refused rule change left the operator nowhere');

  const closing = await boot({ close: refused });
  buttonNamed(problemCards(closing)[0], /Close/).dispatch('click');
  await settle();
  const form = withClass(problemCards(closing)[0], 'close-form')[0]
    || findAll(problemCards(closing)[0], (n) => n.tagName === 'FORM')[0];
  assert.ok(form, 'pressing Close opened no form');
  const confirm = buttonNamed(form, /Close it/);
  assert.ok(confirm, 'the close form drew no confirm button');
  assert.equal(await focusAfter(closing, () => form.dispatch('submit')), confirm,
    'a refused close left the operator nowhere');
  assert.equal(confirm.disabled, false, 'the refused close button was left unusable');

  /* The refusal is also SAID. The other two writes toast; the close form does
     not, because the form stays open and the message belongs beside it -- so
     that message is the only report a screen reader can get, and it has to
     carry a live role or it is announced to nobody. v1 said this through
     op.confirmAction's role="alert" paragraph. */
  const said = findAll(form, (n) => n.getAttribute && n.getAttribute('role') === 'alert');
  assert.equal(said.length, 1, 'the close form has ' + said.length + ' live regions, not one');
  assert.equal(allText(said[0]), 'The operations API did not answer.',
    'the refusal was written somewhere other than the live region, so nobody is told');

  /* And the handback is conditional, or it becomes its own defect: a close
     submitted with Enter from the note field never blurred the field, so
     moving the operator to the button would take them out of what they were
     typing to tell them it did not send. The live region above is what tells
     them. */
  const typing = await boot({ close: refused });
  buttonNamed(problemCards(typing)[0], /Close/).dispatch('click');
  await settle();
  const openForm = findAll(problemCards(typing)[0], (n) => n.tagName === 'FORM')[0];
  const note = findAll(openForm, (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(note, 'the close form drew no note field');
  note.focus();
  openForm.dispatch('submit');
  await settle();
  assert.equal(typing.doc.activeElement, note,
    'a refused close took the operator out of the note they were writing');
});

/* The re-reads a WRITE starts, which are neither of the two halves above: the
   control is destroyed by the rebuild exactly as a read control is, but the
   call arrives through afterChange() rather than from the control's own
   handler, so an enumeration walked from the control handlers misses both.
   Six review rounds did.

   afterChange() has FOUR call sites, not two: acknowledging and closing each
   have a second path, the server answering ops_problem_moved, which is not a
   failure and re-reads exactly as the success does. Round 8 found the two
   moved branches were outside the enumeration while three places said they
   were inside it, so all four are named here one at a time rather than
   assumed to be one site because they share a function. */
test('a write that lands hands focus back too, not only one that is refused', async () => {
  const moved = () => Object.assign(new Error('That problem has already moved on.'),
    { code: 'ops_problem_moved' });

  const acknowledged = async (answers, why) => {
    const dom = await boot(answers);
    const take = buttonNamed(problemCards(dom)[0], /I am on it/);
    assert.ok(take, 'the open problem was offered no acknowledge button');
    assert.equal(await focusAfter(dom, () => take.dispatch('click')),
      dom.doc.getElementById('content'), why);
  };
  await acknowledged({},
    'acknowledging a problem left the operator nowhere once the card was rebuilt');
  await acknowledged({ acknowledge: moved() },
    'acknowledging a problem somebody else had already changed left the operator nowhere');

  const closed = async (answers, why) => {
    const dom = await boot(answers);
    buttonNamed(problemCards(dom)[0], /Close/).dispatch('click');
    await settle();
    const form = findAll(problemCards(dom)[0], (n) => n.tagName === 'FORM')[0];
    assert.ok(form, 'pressing Close opened no form');
    assert.equal(await focusAfter(dom, () => form.dispatch('submit')),
      dom.doc.getElementById('content'), why);
  };
  await closed({},
    'closing a problem left the operator nowhere once the queue was rebuilt');
  await closed({ close: moved() },
    'closing a problem somebody else had already closed left the operator nowhere');
});

/* One fact, one slot: the queue's footer answers "would we know", and the
   hero above it already says how many rules are watching and when they last
   ran. Stating them again under the queue is the shape the whole remodel
   exists to remove, and it costs more than a literal repeat because "rules
   last ran" and "last check" are the same clock in two phrasings. */
test('the rules inventory is stated once, not in two arithmetics', async () => {
  const text = liveText(await boot({}));

  /* Asserted present first: if the hero stopped saying these, the counts
     below would be satisfied by their absence. */
  const watching = /(\d+ rules? watching)/.exec(text);
  assert.ok(watching, 'nothing on the page says how many rules are watching');
  assert.equal(text.split(watching[1]).length - 1, 1,
    'how many rules are watching is on the page more than once: ' + watching[1]);

  const ran = /rules last ran ((?:an?|\d+) [a-z]+ ago)/.exec(text);
  assert.ok(ran, 'nothing on the page says when the rules last ran');
  assert.equal(text.split(ran[1]).length - 1, 1,
    'when the rules last ran is on the page more than once: ' + ran[1]);
});

/* ====================== controls that would be refused ================== */

/* On a window the queue carries closed problems as well as open ones, so the
   same card that offers Close to an open problem is asked to draw one that is
   already closed. The closed LIST is a different builder and never had these
   controls; the queue is where the gate has to hold. */
test('a closed problem is not offered a control the server can only refuse', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ id: 'prb_done', reference: 'AO-901' })] },
  });
  const card = problemCards(dom).filter((n) => /AO-901/.test(allText(n)))[0];
  assert.ok(card, 'the closed problem was not in the queue at all, so nothing was tested');
  assert.equal(buttonNamed(card, /Close/), null,
    'a problem that is already closed was offered a Close button the server can only refuse');
  assert.equal(buttonNamed(card, /I am on it/), null,
    'a problem that is already closed was offered an acknowledge button');
  assert.ok(buttonNamed(card, /Details/),
    'the closed card lost the one control it should have');

  /* The same card for an open problem does carry them, or the assertions
     above would hold on a pane that draws no controls at all. */
  const live = await boot({ open: { problems: [problem()] } });
  assert.ok(buttonNamed(problemCards(live)[0], /Close/),
    'an open problem was not offered Close, so the gate above proves nothing');
});

test('the close form labels its fields by an id nothing else on the page can take', async () => {
  const dom = await boot({
    open: { problems: [problem({ id: 'prb_dup' })] },
    closed: { problems: [] },
  });
  buttonNamed(problemCards(dom)[0], /Close/).dispatch('click');
  await settle();

  const ids = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('id'))
    .map((n) => n.getAttribute('id'));
  assert.equal(ids.length, new Set(ids).size,
    'two elements on the page carry the same id: ' + JSON.stringify(repeatedIds(dom)));

  const labels = findAll(dom.doc.body, (n) => n.tagName === 'LABEL' && n.getAttribute('for'));
  const formLabels = labels.filter((n) => /^close-(reason|note)-/.test(n.getAttribute('for')));
  assert.equal(formLabels.length, 2,
    'the close form did not label both of its fields');
  formLabels.forEach((label) => {
    const target = label.getAttribute('for');
    assert.ok(dom.doc.getElementById(target),
      'a close-form label points at ' + target + ', which is on no element');
    /* The counter, not the problem id. An id built from the record has to
       answer what characters a record id can contain; this one never asks. */
    assert.match(target, /-\d+$/,
      'a close-form id is not the counter\'s: ' + target);
    assert.doesNotMatch(target, /prb_dup/,
      'a close-form id is built from the record: ' + target);
  });
});

/* =========================== acknowledge vs close ====================== */

test('an unacknowledged problem says nobody has it; one taken on names who has', async () => {
  const nobody = await boot({});
  assert.match(liveText(nobody), /Nobody has picked this up/,
    'an open problem left the absence of an owner to be inferred');

  const taken = await boot({
    open: { problems: [problem({
      status: 'acknowledged',
      acknowledgedAt: at(20 * MINUTE),
      acknowledgedByEmail: 'ops.lead@example.invalid',
    })] },
  });
  const text = liveText(taken);
  assert.match(text, /ops\.lead@example\.invalid took this on/,
    'a problem somebody is on did not say who');
  assert.doesNotMatch(text, /Nobody has picked this up/,
    'a problem somebody is on still said nobody had it');

  /* The footer sentence carries WHEN as well as WHO, so a "Taken on" row in
     the fact grid would put the same relative time on the card twice. The
     needle is bounded to the time itself -- an unbounded capture runs on into
     the next sentence and can never repeat, which is how this assertion first
     passed over the defect it is named for. Asserting the footer printed one
     at all means deleting the footer cannot satisfy the count instead. */
  const card = allText(problemCards(taken)[0]);
  const stamp = /took this on ((?:an?|\d+) [a-z]+ ago)/.exec(card);
  assert.ok(stamp, 'the footer did not say when the problem was taken on');
  const times = card.split(stamp[1]).length - 1;
  assert.equal(times, 1,
    'the time a problem was taken on is on the card ' + times + ' times: ' + stamp[1]);
});

test('taking a problem on and closing it are two different calls', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];

  buttonNamed(card, /I am on it/).dispatch('click');
  await settle();

  const posts = dom.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.endpoint),
    ['/api/ops/alerts/problems/prb_1/acknowledge'],
    'taking a problem on did not post exactly one acknowledgement: ' +
    JSON.stringify(posts.map((c) => c.endpoint)));
});

test('closing a problem sends the reason and the note somebody wrote', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');

  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  assert.ok(form, 'Close opened no form');
  const select = findAll(form, (n) => n.tagName === 'SELECT')[0];
  const note = findAll(form, (n) => n.tagName === 'TEXTAREA')[0];
  select.value = 'no_action_needed';
  note.value = 'Provider had a bad hour. Cleared on its own.';
  form.dispatch('submit');
  await settle();

  const posted = dom.calls.filter((c) => /\/close$/.test(c.endpoint));
  assert.equal(posted.length, 1, 'the close form did not post once');
  assert.equal(posted[0].endpoint, '/api/ops/alerts/problems/prb_1/close');
  assert.equal(posted[0].body.reason, 'no_action_needed');
  assert.equal(posted[0].body.note, 'Provider had a bad hour. Cleared on its own.',
    'the note somebody wrote did not reach the server');
});

/* The route accepts exactly two reasons from a person. `self_resolved` is
   the engine's own, and the close endpoint answers `ops_close_reason_invalid`
   to anybody who sends it, so an option offering it is a button that can only
   fail. The harness does not implement a select's implicit first-option
   default, which is why the close tests above set `.value` by hand and why
   none of them can see WHICH options are on offer -- this one reads the
   option elements themselves. */
test('the close form offers only the two reasons a person is allowed to send', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');
  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  const select = findAll(form, (n) => n.tagName === 'SELECT')[0];
  const offered = findAll(select, (n) => n.tagName === 'OPTION')
    .map((n) => n.getAttribute('value'));
  assert.equal(offered.length, 2,
    'the close form offers ' + offered.length + ' reasons: ' + JSON.stringify(offered));
  assert.equal(offered.indexOf('self_resolved'), -1,
    'the close form offers self_resolved, which the route refuses from a person');
  assert.deepEqual(offered.slice().sort(), ['no_action_needed', 'resolved']);
});

test('a close with no note sends no note rather than an empty one', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');
  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  /* The harness does not implement a select's implicit first-option default, so
     the reason is set here the way a browser would have set it. */
  findAll(form, (n) => n.tagName === 'SELECT')[0].value = 'resolved';
  findAll(form, (n) => n.tagName === 'TEXTAREA')[0].value = '   ';
  form.dispatch('submit');
  await settle();

  const body = dom.calls.filter((c) => /\/close$/.test(c.endpoint))[0].body;
  assert.equal(body.note, undefined, 'whitespace was sent as the note it was closed with');
  assert.equal(body.reason, 'resolved');
});

/* ============================== counts and caps ======================== */

test('a full read reads as a floor, and names the problems that went missing', async () => {
  const full = await boot({ open: { problems: manyProblems(100) } });
  const text = liveText(full);
  assert.match(text, /At least \d+ problems open/,
    'a read that came back full printed its count as a total');
  assert.match(text, /most recent ones are missing/,
    'the disclosure did not say WHICH problems went missing');
  assert.doesNotMatch(text, /oldest (problems|ones) (are|were) (not|missing)/i,
    'the disclosure has the direction backwards: a full read drops the newest');

  const short = await boot({ open: { problems: manyProblems(3) } });
  const shortText = liveText(short);
  assert.doesNotMatch(shortText, /At least/,
    'a read that came back short still hedged its count');
  assert.doesNotMatch(shortText, /most recent ones are missing/,
    'a read that came back short was disclosed as truncated');
});

/* ======================= severity there, category here ================== */

test('severity goes to the API and category is applied on what came back', async () => {
  const dom = await boot({
    open: { problems: [
      problem(),
      problem({ id: 'prb_2', reference: 'AO-119', category: 'cost',
        categoryLabel: 'Cost', title: 'Spend is running ahead of the month' }),
    ] },
  });
  assert.equal(problemCards(dom).length, 2);

  const severity = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0];
  severity.dispatch('click');
  await settle();

  const reads = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems');
  const scoped = reads.slice(-2);
  assert.deepEqual(scoped.map((c) => c.query.severity), ['critical', 'critical'],
    'the severity the operator picked never reached the API');
  assert.ok(reads.every((c) => c.query.category === undefined),
    'a category was sent to an endpoint that does not filter on one');

  const category = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'SELECT')[0];
  category.value = 'cost';
  category.dispatch('change');
  await settle();

  const shown = problemCards(dom);
  assert.equal(shown.length, 1, 'the category filter changed nothing on screen');
  assert.match(allText(shown[0]), /Spend is running ahead/,
    'the category filter kept the wrong problem');
});

test('a figure read over a filtered answer says which filter it was read over', async () => {
  const plain = await boot({});
  assert.doesNotMatch(liveText(plain), /filtered by the operations API/,
    'an unfiltered read still claimed to be scoped');

  const dom = await boot({});
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  assert.match(liveText(dom), /Severity is filtered by the operations API/,
    'a severity-scoped answer was presented as a total');
});

/* A problem goes open -> closed and never back, so of two copies the one
   carrying `closedAt` was read later. Keeping the first showed one reference
   as "Still happening" in the queue and "Closed a minute ago" in the list
   below it, on one screen. */
test('a problem that is in both answers is the closed one, not the stale open one', async () => {
  const id = 'prb_r';
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem({ id, reference: 'AO-500', status: 'open' })] },
    closed: { problems: [closedProblem({ id, reference: 'AO-500' })] },
  });
  const cards = problemCards(dom);
  assert.equal(cards.length, 1, 'the problem was drawn twice');
  const text = allText(cards[0]).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /Still happening/,
    'the queue kept the stale open copy of a problem the closed read says is closed: ' + text);
  assert.match(text, /Closed/,
    'the closed copy lost its state as well: ' + text);
});

/* ===================== a closed problem is not an open one ============== */

/* `Open for` measures to now, so on a closed problem it counts on past the
   moment the thing stopped. A range filter admits closed problems into the
   queue -- two of the three windows this pane offers -- so this is the
   ordinary view, not an exotic one. */
test('a closed problem is not told how long it has been open', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  const cards = problemCards(dom);
  assert.equal(cards.length, 1, 'the closed problem was not in the queue at all');
  const text = allText(cards[0]);
  assert.doesNotMatch(text, /Open for/,
    'a closed problem is still being told how long it has been open: ' + text);
  assert.match(text, /Started/,
    'the dated start went missing along with the running total');

  const open = await boot({});
  assert.match(allText(problemCards(open)[0]), /Open for/,
    'an open problem stopped saying how long it has been open');
});

test('a closed card states the reason and the person once, not the word Closed twice', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ closeReason: 'resolved' })] },
  });
  const text = allText(problemCards(dom)[0]).replace(/\s+/g, ' ');
  assert.equal((text.match(/Closed/g) || []).length, 1,
    'the card says "Closed" more than once: ' + text);
  /* Em dash, not "by": two of the three reasons are not clauses, so
     "Nothing to do by somebody" does not parse. */
  assert.match(text, /Resolved \u2014 owner@example\.invalid/,
    'the reason and the person went missing with the duplication: ' + text);

  /* The closed LIST has no pill, so its sentence still carries both. */
  const listed = allText(dom.doc.querySelector('.c-list')).replace(/\s+/g, ' ');
  assert.match(listed, /Closed as resolved by owner@example\.invalid \d+ days ago/,
    'the closed list lost the sentence that is its only statement of when: ' + listed);

  /* The reason an operator can actually choose. It is not a clause, so the
     short form has to hold it without "by" on the end of it. */
  const nothing = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ closeReason: 'no_action_needed' })] },
  });
  assert.match(allText(problemCards(nothing)[0]).replace(/\s+/g, ' '),
    /Nothing to do \u2014 owner@example\.invalid/,
    'the short close sentence reads "Nothing to do by somebody", which does not parse');
});

/* ============================== de-duplication ========================= */

test('a problem that is in both answers is one problem', async () => {
  const shared = closedProblem({ id: 'prb_1', reference: 'AO-118' });
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
    closed: { problems: [shared] },
  });

  const refs = problemCards(dom).map((c) => (allText(c).match(/AO-\d+/) || [])[0]);
  assert.deepEqual(refs.sort(), ['AO-118', 'AO-119'],
    'the same problem was drawn twice, once from each read: ' + JSON.stringify(refs));
});

/* ================================ empty ================================ */

test('a filter that matched nothing never claims the system is well', async () => {
  const dom = await boot({ open: { problems: [] } });
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();

  const text = emptyText(dom);
  assert.match(text, /Nothing matches these filters/);
  assert.match(text, /says nothing about the problems these filters exclude/);
  assert.doesNotMatch(text, /Nothing is wrong/,
    'a filtered empty result claimed the system is healthy');
});

test('an empty queue says whether anything was in a position to notice', async () => {
  const watching = await boot({ open: { problems: [] } });
  assert.match(emptyText(watching), /Nothing is wrong, and the watching is working/);

  const blind = await boot({ open: { problems: [] }, rules: blindRules() });
  const text = emptyText(blind);
  assert.match(text, /Nothing is being reported, and that is the problem/);
  assert.doesNotMatch(text, /Nothing is wrong/,
    'a page with nothing judging still said nothing was wrong');
});

/* The ONE fact that tells an empty problems list apart from alerting that has
   stopped is the rules read. When that is the read that failed, the pane has
   built `armedState({})` for itself -- every count zero because nothing
   answered -- and "there are no alert rules at all" read off that object is a
   fabricated fact, printed three inches from "this part is unread, not
   empty". The routing card carried the same defect and was fixed; the empty
   state is its second call site, and the suite was green with it because no
   test booted with an empty open read AND a failed rules read together. */
test('an empty page over a failed rules read does not report that nothing is watching', async () => {
  const dom = await boot({ open: { problems: [] }, rules: new Error('The rules broke.') });
  const text = emptyText(dom);
  assert.doesNotMatch(text, /no alert rules at all/,
    'a rules read that never landed was reported as no rules existing: ' + text);
  assert.doesNotMatch(text, /Treat this as unmonitored/,
    'a rules read that never landed was reported as alerting having stopped');
  assert.match(text, /whether anything is watching is unknown/,
    'the empty page said nothing about the read that failed: ' + text);

  /* The filtered branch is the same sentence on a second call site, where it
     gains " That is the case whatever these filters are set to." -- a
     fabricated fact promoted to an invariant. `picked` is not read off the
     querystring, so this drives the real control. */
  const filtered = await boot({
    open: { problems: [] }, closed: { problems: [] }, rules: new Error('The rules broke.'),
  });
  findAll(filtered.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  const filteredText = emptyText(filtered);
  assert.match(filteredText, /Nothing matches these filters/,
    'the filtered branch was never reached: ' + filteredText);
  assert.doesNotMatch(filteredText, /no alert rules at all/,
    'the filtered empty state fabricated a verdict from a read that never landed: ' +
    filteredText);
  assert.match(filteredText, /whether anything is watching is unknown/,
    'the filtered empty state said nothing about the read that failed: ' + filteredText);

  /* And a read that DID land with no rules still says so, or the fix above is
     "never say it" rather than "say it when it is true". */
  const really = await boot({
    open: { problems: [] }, rules: Object.assign(rulesFixture(), { rules: [] }),
  });
  assert.match(emptyText(really), /no alert rules at all/,
    'an answer that really carries no rules stopped saying so');
});

test('a read that never landed is never allowed to say there is nothing here', async () => {
  const dom = await boot({ open: new Error('The operations API did not answer.') });
  assert.deepEqual(shownState(dom), ['live degraded'],
    'a failed read fell into a state that claims there is nothing here');
  assert.match(liveText(dom), /Nothing here is a zero/);
  assert.doesNotMatch(liveText(dom), /Nothing is wrong/);
});

/* ====================== one read failing, not the pane ================= */

test('one read failing leaves everything the other read on screen', async () => {
  const noRules = await boot({ rules: new Error('The rules could not be read.') });
  assert.equal(problemCards(noRules).length, 1,
    'a failed rules read took the problems off the screen');
  assert.match(liveText(noRules), /The rules could not be read/);
  assert.deepEqual(shownState(noRules), ['live degraded']);

  const noProblems = await boot({ open: new Error('The problems could not be read.') });
  assert.ok(ruleRows(noProblems).length >= 3,
    'a failed problems read took the rules off the screen');
  assert.match(liveText(noProblems), /The problems could not be read/);

  const neither = await boot({
    open: new Error('nothing answered'),
    rules: new Error('nothing answered'),
    closed: new Error('nothing answered'),
  });
  assert.match(liveText(neither), /This pane could not be read/,
    'a pane with nothing readable still drew a shell of one');
});

/* The channels come out of the rules answer. A rules read that never landed
   knows nothing about them, and "no notification channel is set up" is the
   one sentence on this pane that means alerts reach nobody. */
test('a rules read that failed does not report that nothing is set up to notify', async () => {
  const dom = await boot({ rules: new Error('The rules could not be read.') });
  const routing = dom.doc.querySelector('.c-side');
  const text = allText(routing);
  assert.doesNotMatch(text, /No notification channel is set up/,
    'a read that never landed claimed there is no channel: ' + text);
  assert.match(text, /could not be read/,
    'the routing card said nothing at all about the read that failed');

  const landed = await boot({ rules: rulesFixture(undefined) });
  assert.match(allText(landed.doc.querySelector('.c-side')), /Microsoft Teams/,
    'a rules read that landed stopped listing its channels');

  const none = await boot({ rules: Object.assign(rulesFixture(), { channels: [] }) });
  assert.match(allText(none.doc.querySelector('.c-side')), /No notification channel is set up/,
    'an answer that really carries no channel stopped saying so');
});

/* ============================== the rules table ======================== */

test('the rules table draws no reading the answer does not carry, and says so', async () => {
  const dom = await boot({});
  const headers = findAll(dom.doc.body, (n) => n.tagName === 'TH').map((n) => allText(n));
  assert.ok(headers.length >= 5, 'the rules table lost its header row');
  assert.ok(!headers.some((h) => /right now|current/i.test(h)),
    'the table grew a column for a reading the rules answer does not send: ' +
    JSON.stringify(headers));
  assert.match(liveText(dom), /No current reading per rule is in this answer/,
    'the missing column was dropped silently rather than stated');
});

test('a rule that cannot reach a verdict says so in words, and says why', async () => {
  const dom = await boot({});
  const rows = ruleRows(dom).map((r) => allText(r).replace(/\s+/g, ' '));
  assert.ok(rows.some((r) => r.includes('Not enough data to judge, too few measurements so far')),
    'the rule that cannot judge did not say why: ' + JSON.stringify(rows));
  assert.ok(rows.some((r) => r.includes('Firing now')),
    'a firing rule said nothing in words, so the tone is carrying it alone');
});

/* ================================ role gating ========================== */

test('turning a rule on or off is the owner\'s, and everyone else sees the true state', async () => {
  const rules = rulesFixture([
    rule(),
    rule({ ruleKey: 'quiet_rule', title: 'Muted rule', enabled: false,
      lastEvaluationStatus: 'ok', lastFiredAt: null }),
  ]);

  const owner = await boot({ rules });
  const ownerSwitches = withClass(owner.doc.body, 'sw');
  assert.equal(ownerSwitches.length, 2);
  assert.deepEqual(ownerSwitches.map((s) => s.disabled), [false, false],
    'the owner cannot change a rule');

  const operator = await boot({ rules, role: 'operator' });
  const theirs = withClass(operator.doc.body, 'sw');
  assert.deepEqual(theirs.map((s) => s.disabled), [true, true],
    'a non-owner was handed a control the server would refuse');
  assert.deepEqual(theirs.map((s) => s.checked), [true, false],
    'a non-owner was shown the wrong state for the rules: ' +
    JSON.stringify(theirs.map((s) => s.checked)));
});

test('acting on a problem needs a role, and the pane names it instead of offering a refusal', async () => {
  const owner = await boot({});
  const ownerCard = problemCards(owner)[0];
  assert.ok(buttonNamed(ownerCard, /I am on it/), 'an operator lost the acknowledge control');
  assert.ok(buttonNamed(ownerCard, /^Close/), 'an operator lost the close control');

  const viewer = await boot({ role: 'viewer' });
  const card = problemCards(viewer)[0];
  assert.equal(buttonNamed(card, /I am on it/), null,
    'a viewer was offered a control the server would refuse');
  assert.equal(buttonNamed(card, /^Close/), null);
  assert.match(allText(card), /need the operator role/,
    'a viewer was left to work out why the controls are missing');
});

test('a switch the server refuses goes back to where it was', async () => {
  const dom = await boot({ patch: new Error('You may not change this rule.') });
  const sw = withClass(dom.doc.body, 'sw')[0];
  assert.equal(sw.checked, true);

  sw.checked = false;
  sw.dispatch('change');
  await settle();

  assert.equal(sw.checked, true,
    'the switch stayed where the operator put it after the server refused');
  assert.equal(sw.disabled, false, 'the refused switch was left unusable');
});

/* ============================== somebody else ========================== */

test('a problem somebody else changed first is a re-read, not a failure', async () => {
  const moved = Object.assign(new Error('That problem has already moved on.'),
    { code: 'ops_problem_moved' });
  const dom = await boot({ acknowledge: moved });
  const before = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems').length;

  buttonNamed(problemCards(dom)[0], /I am on it/).dispatch('click');
  await settle();

  assert.match(allText(dom.doc.body), /Somebody else changed AO-118 first/,
    'a problem somebody else moved was reported as a failure of this action');
  const after = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems').length;
  assert.ok(after > before, 'the pane did not read again after the problem moved');
});

/* ================================ the badge ============================ */

test('the rail count comes from the read, and no count is drawn when there is none', async () => {
  const two = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  const badges = two.doc.getElementById('rail').querySelectorAll('.nav-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '2');
  assert.match(allText(two.doc.getElementById('rail')), /2 problems with nobody on them/,
    'the count is a bare number to a screen reader');

  const quiet = await boot({
    open: { problems: [problem({ status: 'acknowledged', acknowledgedAt: at(MINUTE),
      acknowledgedByEmail: 'owner@example.invalid' })] },
  });
  assert.equal(quiet.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 0,
    'a zero was drawn as a count');
});

test('a re-read that cannot see the problems takes the count away rather than leaving it', async () => {
  const dom = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  assert.equal(dom.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 1);

  dom.answers.open = new Error('nothing answered');
  dom.answers.rules = new Error('nothing answered');
  dom.answers.closed = new Error('nothing answered');
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();

  assert.match(liveText(dom), /This pane could not be read/);
  assert.equal(dom.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 0,
    'a count from the last read that worked is still beside a pane that cannot be read');
});

/* ========================== what it measured =========================== */

test('a measured figure is printed in its rule\'s unit, or not printed at all', async () => {
  const known = await boot({});
  assert.match(liveText(known), /89\.0%/,
    'a basis-point reading was not turned into a percentage');

  const unknown = await boot({ rules: rulesFixture([]) });
  const card = allText(problemCards(unknown)[0]);
  assert.doesNotMatch(card, /Measured/,
    'a reading was printed with no rule to say what unit it is in');
  assert.doesNotMatch(card, /8900/,
    'a bare 8900 was printed next to a threshold expressed as a percentage');
});

test('a problem card draws no meter', async () => {
  const dom = await boot({});
  assert.equal(withClass(panel(dom, 'live'), 'meter').length, 0,
    'a bar was drawn between an observed value and a threshold, on a scale ' +
    'nothing in the answer sends');
});

test('a span of seconds reads the same here as on the v1 panes', async () => {
  const v1 = v1Operate();
  const seconds = [4.2, 42, 246, 4320];
  const dom = await boot({
    rules: rulesFixture([rule({ thresholdUnit: 'seconds', thresholdLabel: 'over 3m' })]),
    open: { problems: seconds.map((value, i) => problem({
      id: 'prb_' + i, reference: 'AO-' + (300 + i), observedValue: value,
    })) },
  });

  const cards = problemCards(dom).map((c) => allText(c));
  assert.equal(cards.length, seconds.length);
  seconds.forEach((value, i) => {
    const expected = v1.fmt.duration(value);
    assert.ok(cards[i].includes(expected),
      value + 's should read "' + expected + '" as it does on the v1 panes, but the card says: ' +
      cards[i].replace(/\s+/g, ' ').slice(0, 160));
  });
});

/* The v1 implementation, loaded on its own page, to compare against. Reading
   it out of the source rather than restating it here is the point: an
   expectation written in this file would move with the thing it is checking. */
function v1Operate() {
  const dom = makeDom({ tokens: TOKENS });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  dom.window.OpsSession = { state: { admin: null }, hasRole: () => true, role: () => 'owner' };
  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(V1_SHELL_SRC, dom.window, { filename: 'shell.js' });
  vm.runInContext(OPERATE_SRC, dom.window, { filename: 'operate.js' });
  return dom.window.OpsOperate;
}

/* ============================== the close note ========================= */

test('the note a problem was closed with is printed from its own record', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
    detail: {
      runbook: [],
      ruleHistory: [],
      timeline: [
        { eventType: 'fired', actorEmail: null, detail: {}, occurredAt: at(3 * DAY) },
        { eventType: 'closed', actorEmail: 'owner@example.invalid', occurredAt: at(2 * DAY),
          detail: { close_reason: 'self_resolved',
            note: 'The model provider had a bad hour. Latency is back to 3.8s.' } },
      ],
    },
  });

  const card = problemCards(dom)[0];
  buttonNamed(card, /Details/).dispatch('click');
  await settle();

  assert.match(allText(card), /“The model provider had a bad hour\. Latency is back to 3\.8s\.”/,
    'the one sentence saying why it was closed was dropped from the record');
});

test('a record with no note prints no empty quotation', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
    detail: {
      runbook: [], ruleHistory: [],
      timeline: [{ eventType: 'closed', actorEmail: 'owner@example.invalid',
        occurredAt: at(2 * DAY), detail: { close_reason: 'resolved' } }],
    },
  });
  const card = problemCards(dom)[0];
  buttonNamed(card, /Details/).dispatch('click');
  await settle();
  assert.doesNotMatch(allText(card), /“/,
    'a problem closed without a note was drawn as though it had one');
});

/* The record read is the only request on the page whose failure is written
   into a disclosed region instead of toasted, so it is the only one a screen
   reader can miss entirely, and v1 offered a retry that the first draft of
   this pane dropped. Its retry is also a member of the focus class: it sits
   inside the region it replaces. */
test('a record that cannot be read says so out loud and can be asked again', async () => {
  const dom = await boot({ detail: new Error('The operations API did not answer.') });
  const card = problemCards(dom)[0];
  const details = buttonNamed(card, /Details/);
  details.dispatch('click');
  await settle();

  const said = findAll(card, (n) => n.getAttribute && n.getAttribute('role') === 'alert');
  assert.equal(said.length, 1, 'the failed record read has ' + said.length + ' live regions, not one');
  assert.match(allText(said[0]), /did not answer/,
    'the failure was written outside the live region, so nobody is told the record is missing');

  const again = buttonNamed(said[0], /Try again/);
  assert.ok(again, 'a record that could not be read offered no way to ask again');

  /* It really re-reads: the second answer lands, so the button is wired to
     the read rather than being a control that does nothing. */
  dom.answers.detail = { runbook: [], timeline: [], ruleHistory: [] };
  dom.doc.body.focus();
  again.dispatch('click');
  await settle();
  assert.doesNotMatch(allText(card), /did not answer/,
    'pressing Try again left the failure on screen, so it re-read nothing');
  assert.equal(dom.doc.activeElement, details,
    'the retry destroyed itself and left the operator nowhere');
});

test('the closed list says where the note is rather than leaving it out silently', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  assert.match(liveText(dom), /Open one to read the note it was closed with/,
    'the list dropped the close note and said nothing about where it went');
});

/* ====================== how the watching is doing ====================== */

test('the last-fortnight figures are refused over a read that came back full', async () => {
  const honest = await boot({
    search: '?range=30d',
    closed: { problems: [closedProblem(), closedProblem({ id: 'prb_8', reference: 'AO-100' })] },
  });
  assert.match(liveText(honest), /Opened/,
    'the counts were not drawn even over a read that came back short');

  const capped = await boot({
    search: '?range=30d',
    closed: { problems: manyProblems(100).map((p, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (400 + i),
    })) },
  });
  const text = liveText(capped);
  assert.doesNotMatch(text, /Median time to take one on/,
    'a figure about the last fortnight was worked out over a sample missing it');
  assert.match(text, /Nothing is drawn from a sample missing exactly the days it is about/);
});

/* The open read and the closed read are taken at different instants, so one
   problem closed between them comes back in both. The queue de-duplicates;
   the figures beside it were adding the same problem twice. */
test('a problem in both answers is counted once by the figures, not only listed once', async () => {
  const shared = closedProblem({ id: 'prb_1', reference: 'AO-118' });
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [shared] },
    closed: { problems: [shared] },
  });
  const rows = withClass(dom.doc.body, 'w-rows')[0];
  const text = allText(rows).replace(/\s+/g, ' ');
  assert.match(text, /Opened 1\b/,
    'one problem in both answers was counted twice: ' + text);
  assert.match(text, /Closed 1\b/, 'the closure went missing: ' + text);
});

/* The closed read is issued on EVERY load, whatever the range control says,
   so a capped one has to be disclosed on the default window too -- where the
   queue holds no closed problem and the queue's own disclosure never fires. */
test('a capped closed read is disclosed on the window that does not filter by it', async () => {
  const capped = await boot({
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (400 + i),
    })) },
  });
  const listed = allText(capped.doc.querySelector('.c-list').parentNode.parentNode);
  assert.match(listed, /most recent closures are missing from this list/,
    'a capped closed list was drawn with nothing said about it: ' + listed);
  /* The total the foot prints is "<n> closed. Open one to read..."; the
     disclosure sentence also contains "100 closed", which is why this pins
     the whole construction rather than the two words. */
  assert.doesNotMatch(listed, /\d+ closed\. Open one to read/,
    'a total was printed over a read that came back full: ' + listed);

  /* Both directions. A read that came back SHORT of the cap is a real total,
     so the count is still printed and the disclosure is still absent -- an
     invariant checked only one way passes just as well with the figure
     switched off everywhere. */
  const short = await boot({
    closed: { problems: manyProblems(8).map((_, i) => closedProblem({
      id: 'sh_' + i, reference: 'AO-' + (500 + i),
    })) },
  });
  const shortText = allText(short.doc.querySelector('.c-list').parentNode.parentNode);
  assert.doesNotMatch(shortText, /most recent closures are missing/,
    'a closed read that came back short was disclosed as truncated');
  assert.match(shortText, /8 closed\. Open one to read/,
    'a read that came back short stopped saying how many it held: ' + shortText);
});

/* The queue is not the open read. On a window it draws from BOTH reads, so a
   capped closed read makes the QUEUE short -- and short of exactly the recent
   closures the window is made of. The hero counts that queue. This was a
   regression: the note existed, was deleted as a duplicate of the closed
   card's foot, and nothing in the suite noticed either way. */
test('a capped closed read hedges the queue\'s own count, not only the closed list', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem()] },
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (700 + i),
    })) },
  });
  const title = allText(withClass(dom.doc.body, 'hero-title')[0]);
  assert.match(title, /^At least /,
    'the hero printed an exact total over a queue drawn from a capped read: ' + title);

  const notes = withClass(dom.doc.body, 'p-notes')[0];
  assert.ok(notes, 'the queue carried no disclosure at all over a capped read');
  const noteText = allText(notes).replace(/\s+/g, ' ');
  assert.match(noteText, /missing from this queue/,
    'the queue said nothing about being short of the window it is counting: ' + noteText);

  /* The default window counts only open problems, and the closed read cannot
     make THAT queue short -- so the hedge must not fire there, or it is on
     every page and says nothing. */
  const openWindow = await boot({
    open: { problems: [problem()] },
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (700 + i),
    })) },
  });
  assert.match(allText(withClass(openWindow.doc.body, 'hero-title')[0]), /^1 problem open/,
    'the open-window count was hedged by a cap that cannot reach it');
  const openNotes = withClass(openWindow.doc.body, 'p-notes')[0];
  assert.ok(!openNotes || !/missing from this queue/.test(allText(openNotes)),
    'the queue hedge fired on a window the closed read cannot shorten');
});

/* The closed query sends no date bound, so once more than PAGE closures exist
   the PAGE that come back are the oldest and every one can predate this
   window. The card then draws "nothing has been closed" from a sample that was
   never in a position to say so -- beside a figures card that refuses to count
   from the SAME sample for the SAME reason. The disclosure used to sit below
   the early return that branch takes. */
test('a capped closed read that reaches back past the window reports no zero', async () => {
  const old = await boot({
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'old_' + i, reference: 'AO-' + (600 + i),
      firedAt: at(61 * DAY), closedAt: at(60 * DAY),
    })) },
  });
  const text = liveText(old);
  assert.doesNotMatch(text, /Nothing has been closed in the last/,
    'a capped read that reaches back past the window was reported as a zero: ' + text);
  assert.match(text, /cannot be told from this read/,
    'the card said nothing about why it cannot answer: ' + text);
  assert.match(text, /most recent closures are missing/,
    'the cap was not disclosed anywhere on a page that has no other disclosure');

  /* A read that came back SHORT and empty is a real zero and still says so. */
  const none = await boot({ closed: { problems: [] } });
  assert.match(liveText(none), /Nothing has been closed in the last/,
    'a read that came back short stopped reporting a genuine zero');
  assert.doesNotMatch(liveText(none), /most recent closures are missing/,
    'a read that came back short was disclosed as capped');
});

test('a rate over too few closures is reported as counts instead', async () => {
  const few = await boot({
    search: '?range=30d',
    closed: { problems: [
      closedProblem({ id: 'c1', closeReason: 'no_action_needed' }),
      closedProblem({ id: 'c2', closeReason: 'resolved' }),
    ] },
  });
  assert.match(liveText(few), /1 of 2, too few to rate/,
    'a rate was implied over two closures');

  const enough = await boot({
    search: '?range=30d',
    closed: { problems: [1, 2, 3, 4, 5, 6].map((n) => closedProblem({
      id: 'c' + n, reference: 'AO-' + (500 + n),
      closeReason: n <= 2 ? 'no_action_needed' : 'resolved',
    })) },
  });
  const text = liveText(enough);
  assert.match(text, /2 of 6/);
  assert.doesNotMatch(text, /too few to rate/,
    'six closures were still treated as too few to say anything about');
});

/* ============================ colour is never alone ==================== */

test('every severity on the page is a word, not only a colour', async () => {
  const dom = await boot({
    open: { problems: [
      problem(),
      problem({ id: 'p2', reference: 'AO-119', severity: 'warning',
        title: 'Spend is running ahead of the month' }),
      problem({ id: 'p3', reference: 'AO-120', severity: 'info',
        title: 'Android 1.1.2 has stopped spreading' }),
    ] },
  });

  const wanted = ['Critical', 'Warning', 'Info'];
  problemCards(dom).forEach((card, i) => {
    assert.match(allText(card), new RegExp('\\b' + wanted[i] + '\\b'),
      'the ' + wanted[i].toLowerCase() + ' problem carries its severity in tone alone');
  });
});

/* =============================== drill-downs =========================== */

test('a problem links to the pane the answer named, at the file the registry gives it', async () => {
  const dom = await boot({});
  const links = findAll(problemCards(dom)[0], (n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'a problem offered more than one way out, or none');
  const href = links[0].getAttribute('href');
  assert.equal(href.split('?')[0], 'jobs-live.html',
    'the doorway does not go to the pane that owns the detail');
  assert.equal(href, dom.shell.paneHref('jobs'),
    'the doorway is not the registry\'s own link for that pane, so it does not ' +
    'carry the selection across: ' + href);
  assert.equal(allText(links[0]), 'Happening now');

  /* The selection travels only as far as the destination has somewhere to put
     it. Happening now declares no filter at all, so its link is the bare file
     and anything appended to it would be a selection that pane cannot apply;
     What happened keeps its window, so the window goes with the operator. */
  const windowed = await boot({
    search: '?range=30d',
    open: { problems: [problem({ workPane: 'run-history', workPaneLabel: 'What happened' })] },
  });
  const across = findAll(problemCards(windowed)[0], (n) => n.tagName === 'A')[0];
  assert.ok(across, 'the windowed problem offered no way out at all');
  assert.equal(across.getAttribute('href'), 'run-history.html?range=30d',
    'the doorway dropped the window the operator had chosen: '
    + across.getAttribute('href'));

  const nowhere = await boot({
    open: { problems: [problem({ workPane: 'a-pane-that-does-not-exist' })] },
  });
  assert.equal(findAll(problemCards(nowhere)[0], (n) => n.tagName === 'A').length, 0,
    'a work pane nothing knows about was drawn as a link anyway');
});

/* The work pane's name is a doorway, so it is not also a label. This is the
   editorial rule the remodel exists for: a fact that is already on the card
   as something you can act on does not get restated as something you read. */
test('the pane that owns the detail is named once on a card, and it is the way out', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];
  const named = findAll(card, (n) =>
    allText(n) === 'Happening now'
    && !(n.childNodes || []).some((child) => child.tagName));
  assert.equal(named.length, 1,
    'the work pane is named ' + named.length + ' times on one card; it belongs '
    + 'in the actions as a doorway, not also in the facts as a chip');
  assert.equal(named[0].tagName, 'A',
    'the one place the work pane is named is a ' + named[0].tagName
    + ', so the name is a label rather than a way to get there');
});

/* ============================= dated timestamps ======================== */

test('a problem carries the dated time it started, not only how long ago', async () => {
  const dom = await boot({});
  const card = allText(problemCards(dom)[0]);
  assert.match(card, /\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} UTC/,
    'the only time on the card is a relative one, which two operators in two ' +
    'time zones cannot quote to each other');
});

/* ======================= the two disclosures on a card ================== */

/* One problem can be on screen twice -- once in the queue, once in "Recently
   closed" -- so an id derived from the problem alone put two elements with
   the same id in the document and both buttons' aria-controls resolved to
   the first. */
function repeatedIds(dom) {
  const ids = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('id'))
    .map((n) => n.getAttribute('id'));
  const seen = {};
  return ids.filter((id) => {
    if (Object.prototype.hasOwnProperty.call(seen, id)) return true;
    seen[id] = true;
    return false;
  });
}

test('two views of one problem do not hand the document two elements with one id', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  assert.deepEqual(repeatedIds(dom), [],
    'one problem on two surfaces put a repeated id in the document: ' +
    JSON.stringify(repeatedIds(dom)));

  /* Both surfaces really are on screen, or the assertion above is vacuous. */
  assert.equal(problemCards(dom).length, 1, 'the problem is not in the queue');
  assert.ok(withClass(dom.doc.body, 'c-row').length >= 1,
    'the problem is not in the closed list');

  /* And several problems on ONE surface. The surface key fixes the first
     collision and says nothing about this one. */
  const many = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  assert.equal(problemCards(many).length, 2, 'the queue does not hold two problems');
  assert.deepEqual(repeatedIds(many), [],
    'several problems on one surface put a repeated id in the document: ' +
    JSON.stringify(repeatedIds(many)));
});

/* An id that no element carries is a disclosure a screen reader cannot follow,
   and the attribute still reads correctly in the DOM -- so a test that compares
   the two aria-controls STRINGS is true of two dangling references as well as
   two live ones, and counting repeated ids gets MORE green when an id is
   removed. Both of those were in this suite and neither saw it. This resolves
   each reference to an element and asserts it is that button's own region. */
test('every aria-controls on a problem card resolves to that button\'s own region', async () => {
  const dom = await boot({
    search: '?range=7d',
    closed: { problems: [closedProblem()] },
  });
  const buttons = findAll(dom.doc.body,
    (n) => n.tagName === 'BUTTON' && n.getAttribute('aria-controls'));
  assert.ok(buttons.length >= 4,
    'fewer disclosure buttons than the queue and the closed list should hold: ' +
    buttons.length);

  buttons.forEach((button) => {
    const id = button.getAttribute('aria-controls');
    const region = dom.doc.getElementById(id);
    assert.ok(region,
      'aria-controls="' + id + '" on ' + allText(button).trim() +
      ' points at an id no element in the document carries');

    /* And at the right one: the region a click fills, not some other card's. */
    button.dispatch('click');
    assert.ok(allText(region).trim().length > 0,
      'the region ' + id + ' named by ' + allText(button).trim() +
      ' stayed empty when the button was pressed, so it is not that button\'s own');
    button.dispatch('click');
  });
});

/* Details and the close form used to write into one host, so each button
   reported itself expanded over the other one's content, and opening Details
   destroyed a part-filled close form without saying so. */
test('Details and Close each own their own region, and each says so truthfully', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];
  const details = buttonNamed(card, /Details/);
  const close = buttonNamed(card, /^Close/);

  assert.notEqual(details.getAttribute('aria-controls'), close.getAttribute('aria-controls'),
    'Details and Close point at the same region');

  close.dispatch('click');
  await settle();
  const note = findAll(panel(dom, 'live'), (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(note, 'Close opened no form');
  note.value = 'Half a sentence somebody was still typing';
  assert.equal(details.getAttribute('aria-expanded'), 'false',
    'opening the close form reported Details as expanded');

  details.dispatch('click');
  await settle();
  assert.equal(close.getAttribute('aria-expanded'), 'true',
    'opening Details said the close form was shut while it was still on screen');
  const still = findAll(panel(dom, 'live'), (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(still, 'opening Details destroyed the close form');
  assert.equal(still.value, 'Half a sentence somebody was still typing',
    'opening Details threw away what somebody had typed into the close form');
  assert.equal(details.getAttribute('aria-expanded'), 'true');
});

/* ========================= clearing the filters ======================== */

test('clearing the filters puts the window back as well as the pane\'s own controls', async () => {
  const dom = await boot({ search: '?range=30d', open: { problems: [] } });
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  assert.equal(dom.shell.filters().range, '30d');

  buttonNamed(panel(dom, 'empty'), /Clear the filters/).dispatch('click');
  await settle();

  assert.equal(dom.shell.filters().range, 'open',
    'the window is a filter the button offered to clear and did not');
  const on = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && n.getAttribute('aria-pressed') === 'true')[0];
  assert.equal(allText(on), 'All', 'the severity the operator picked survived clearing');
});

/* ============================ the page itself ========================== */

test('the page loads one design system and one theme decision', () => {
  const html = read('alerts.html');
  for (const v1 of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js', 'assets/icons.js']) {
    assert.ok(!html.includes(v1),
      'alerts.html loads ' + v1 + ' as well as the v2 sheets; both define .card, ' +
      '.rail, .topbar, .btn, .seg, .pill and .tbl from different token sets');
  }
  for (const v2 of ['assets/aria.css', 'assets/shell-pane-v2.css', 'assets/pane-alerts-v2.css',
    'assets/aria.js', 'assets/shell-pane-v2.js', 'assets/pane-alerts.js']) {
    assert.ok(html.includes(v2), 'alerts.html no longer loads ' + v2);
  }
  assert.equal((html.match(/assets\/theme\.js/g) || []).length, 1,
    'the theme is decided in more than one place');
  assert.match(html, /Content-Security-Policy/, 'the page lost its CSP meta tag');
  assert.ok(!/unsafe-inline/.test(html), 'the CSP grew unsafe-inline');
});

/* A prohibition on the spelling, not a proof about the behaviour: it pins the
   three names, and a value that became markup by some other route would walk
   past it. It is here because those three names are how it would actually
   happen, and because nothing else in the suite would notice. */
test('the pane never spells innerHTML, outerHTML or insertAdjacentHTML', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'the pane reached for innerHTML');
  assert.ok(!/\.outerHTML/.test(PANE_SRC), 'the pane reached for outerHTML');
  assert.ok(!/insertAdjacentHTML/.test(PANE_SRC), 'the pane reached for insertAdjacentHTML');
});

/* A block that is not ready renders words and never a numeral — the Overview
   rule, applied to the one state here that can be mistaken for a zero. */
test('a pane that could not be read prints no numeral that could be read as a count', async () => {
  const dom = await boot({
    open: new Error('nothing answered'),
    rules: new Error('nothing answered'),
    closed: new Error('nothing answered'),
  });
  assert.equal(numerals(liveText(dom)), 0,
    'an unreadable pane printed a numeral: ' + liveText(dom).replace(/\s+/g, ' ').slice(0, 200));
});
