/* Two defects in the Overview pane's retry controls.

   Stadiora/Aria#10771 — the rules read was the one read with no way to ask
   again. Its failure was reported honestly (the ribbon says `rules unread`,
   the queue card says whether the checks are running could not be read) and
   then the operator was stranded: nothing to press. Reloading the page was the
   only way to retry, which also re-runs the two reads that had already worked.

   Stadiora/Aria#10784 — pressing any Try again re-renders the panel, which
   destroys the button that was pressed. Focus fell back to the document: the
   keyboard operator is thrown to the top of the page by the control they just
   used, and a screen-reader operator hears nothing at all about what happened
   to the read.

   How these bind behaviour rather than sentences:

     - Focus is asserted as CONTAINMENT in the panel the operator can see, not
       as `activeElement !== body`. The harness leaves activeElement pointing
       at the detached button after a re-render, which is not what a browser
       does — but a detached node is not inside the shown panel in either, so
       the containment question has the same answer in both and the pre-fix
       code fails it.

     - "Exactly one" counts are counts of rendered nodes carrying a value
       resolved from the DOM. Nothing here greps the source.

     - All four retries this pane can draw are pressed IN THIS FILE, and each
       one's read is counted through `dom.calls`, so a button wired to a no-op
       fails. The rules one, the figures one, the problems one, and the shell's
       whole-pane card — which this pane does not build but does supply the
       action for, and whose button carries none of the attributes the others
       do. `boot()` hands back the answer table live, so a test can repair a
       read between loads and watch the section recover.

     - Two reads can be held in flight at once and released in an order the
       test chooses (`dom.hold` / `dom.release`). Which of two overlapping
       retries is allowed to move focus is decided by that order, not by a
       sleep, so the answer is the same on a laptop and on the runner.

     - Announcements are asserted two ways, on purpose. The first pair
       composes the expected sentence from the band heading and the failure
       heading as they were RENDERED, resolved through the button's own
       aria-labelledby — that is the assertion that would catch a heading
       changing. The tests about WHICH failure is named instead compare
       against the headline as a stated constant, because the question there
       is selection among two, and an expectation read out of the rendered
       band would move with the selection it is checking.

   NOT COVERED here, deliberately:

     - What a real browser does to focus when a focused element is removed.
       The harness has no focus manager. What is asserted instead is where
       this code PUTS focus, which is the half this PR changes; the browser's
       half is the same in both directions and is why the assertion is
       containment rather than identity.

     - The accessible name of a retry. That is bound for the sibling pane by
       `scripts/ops-alerts-severity-retry.test.mjs`, whose `nameText()` models
       the two AccName rules that matter here; this file asserts only that the
       `data-retry` value and the name reference the SAME heading node, which
       is the invariant the announcement depends on.

     - Whether the announcement is spoken. A `role="status"` region's text is
       what a test can see; the speaking is the screen reader's.

     - The shell's whole-pane failure CARD, as markup. What it draws is
       `shell-pane-v2.js`'s; what pressing its button does is this pane's, and
       that half is pressed here in all three of its states — every read down,
       render() itself throwing, and recovery from each. Its button carries
       neither `data-retry` nor `aria-labelledby`, so `retriesIn()` cannot see
       it and the tests that reach it find it by its word instead. Naming it
       would be a change to the shell.

     - What a browser does with a rapid double-press. The race test decides
       the completion order itself; whether Chrome would deliver the second
       Enter before the loading state replaces the button is the browser's
       question, and round 2 of this PR's review measured that it sometimes
       does. What is bound here is the consequence: an obsolete read must not
       move focus. */
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
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

function summaryFixture() {
  return {
    generatedAt: '2026-09-20T06:00:00.000Z',
    consent: { basis: 'operational', detail: 'Operational data only.' },
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [
        { key: 'aria', label: 'Aria', active: 870, tone: 's1' },
        { key: 'ariaxii', label: 'Aria XII', active: 412, tone: 's2' },
      ],
      window: { days: 7 },
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 50,
      environment: 'production',
    },
    aiRuns: {
      availability: { state: 'ready' },
      window: { days: 7 }, runs: 4210, previous: { runs: 3900 },
    },
    cost: {
      availability: { state: 'ready' },
      window: { days: 7 }, total: { usd: 128.4 },
      comparison: { changeBasisPoints: -420 },
    },
    release: {
      availability: { state: 'ready' },
      version: '2.4.1', releasedAt: hoursAgo(50),
    },
    activity: { days: [] },
    omissions: [],
  };
}

function problemsFixture() {
  return {
    problems: [{
      id: 'p1', reference: 'PRB-1', title: 'Checkout latency', severity: 'critical',
      status: 'open', category: 'performance', firedAt: hoursAgo(3), workPane: 'alerts',
    }],
  };
}

function rulesFixture() {
  return {
    rules: [{
      id: 'r1', name: 'Checkout latency', enabled: true, thresholdUnit: 'ms',
      lastEvaluatedAt: hoursAgo(1), lastEvaluationStatus: 'ok', lastFiredAt: hoursAgo(3),
    }],
    summary: { armed: 1, total: 1 },
    channels: [{ key: 'email', configured: true }],
  };
}

/* The three reads' error messages are distinct on purpose: every "the right
   failure reached the screen" assertion below would pass on the wrong one if
   they read alike. */
const boom = (what) => Object.assign(new Error(what + ' is down'), { status: 503 });

/* --------------------------------------------------------------- booting */

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
  const app = el(appGate, 'div', { id: 'app' });
  const rail = el(app, 'nav', { id: 'rail' });
  el(rail, 'a', { class: 'nav-item', href: 'alerts.html' }).textContent = 'Problems';
}

async function boot(options) {
  const opts = options || {};
  const answers = {
    '/api/ops/summary': opts.summary === undefined ? summaryFixture() : opts.summary,
    '/api/ops/alerts/problems': opts.problems === undefined ? problemsFixture() : opts.problems,
    '/api/ops/alerts/rules': opts.rules === undefined ? rulesFixture() : opts.rules,
  };

  const calls = {};
  const settle = async (n) => {
    for (let i = 0; i < (n || 12); i += 1) await new Promise((r) => setImmediate(r));
  };

  /* Reads that can be held and released in an order the test chooses.
     Two presses in quick succession are two batches in flight at once, and
     which one lands first is the whole question — so it has to be decided
     deliberately rather than by a sleep. Held answers are read at RELEASE
     time, the way a server answers late, so a test can repair a read between
     the press and the reply. */
  const held = new Set();
  const waiting = [];

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
      calls[endpoint] = (calls[endpoint] || 0) + 1;
      const now = () => {
        const answer = answers[endpoint];
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
        return Promise.resolve({ data: answer });
      };
      if (!held.has(endpoint)) return now();
      return new Promise((resolve, reject) => {
        waiting.push({ endpoint, batch: batchOf(endpoint), send: () => now().then(resolve, reject) });
      });
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });

  await settle();
  /* Which round of reads a held call belongs to: the nth time this endpoint
     has been asked while held. Batch 0 is the first press, batch 1 the
     second, and a test releases them by number rather than by position in a
     queue that interleaves three endpoints. */
  function batchOf(endpoint) {
    return waiting.filter((w) => w.endpoint === endpoint).length;
  }
  const hold = (...endpoints) => endpoints.forEach((e) => held.add(e));
  const release = async (batch) => {
    const mine = waiting.filter((w) => w.batch === batch);
    assert.ok(mine.length, 'nothing is waiting in batch ' + batch);
    mine.forEach((w) => {
      waiting.splice(waiting.indexOf(w), 1);
      w.send();
    });
    await settle(20);
  };
  return Object.assign(dom, { answers, calls, settle, hold, release, waiting });
}

/* ---------------------------------------------------------- what is drawn */

/* Whichever of the shell's three panels is the one showing. They all sit in
   #content at once and only data-shown says which the operator sees, so a
   test that reads the live panel unconditionally reads a hidden one for an
   empty render. */
function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once, so "what the operator sees" `
    + 'is not a single answer and nothing below means what it says');
  return boxes[0];
}

const retriesIn = (root) => findAll(root, (n) => n.getAttribute
  && n.getAttribute('data-retry') !== null);

/* The heading a retry is named after, reached the way a browser reaches it:
   through the second id in aria-labelledby, resolved against the document.
   Never through data-retry, which is the value under test in one of these. */
function namingHeading(dom, button) {
  const ids = String(button.getAttribute('aria-labelledby') || '').split(/\s+/)
    .filter(Boolean);
  assert.equal(ids.length, 2,
    'a retry should be named by its own word plus one heading, got: ' + ids.join(','));
  const head = dom.doc.getElementById(ids[1]);
  assert.ok(head, 'aria-labelledby points at ' + ids[1] + ', which is not in the document');
  return head;
}

/* What the shell's polite region is currently saying. The toast host also
   uses role=status, so this narrows on the live region's own class. */
function announcement(dom) {
  const said = findAll(dom.doc.body, (n) => n.getAttribute
    && n.getAttribute('role') === 'status'
    && String(n.className || '').split(/\s+/).indexOf('sr') !== -1);
  return said.length ? String(said[said.length - 1].textContent || '') : '';
}

function bandTitles(root) {
  return findAll(root, (n) => String(n.className || '').split(/\s+/)
    .indexOf('band-title') !== -1);
}

/* Press a control and let every promise it started settle. */
async function press(dom, button) {
  tap(button);
  await dom.settle(20);
}

/* Press without waiting: the half of a press a race test needs, because the
   second press has to happen while the first read is still in flight. */
function tap(button) {
  button.focus();
  button.dispatchEvent({ type: 'click' });
}

const RULES_HEADLINE = 'Whether the checks are running could not be read';

/* ------------------------------------------------------------ #10771 */

test('a failed rules read offers a way to ask again', async () => {
  const dom = await boot({ rules: boom('rules') });
  const retries = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE);
  assert.equal(retries.length, 1,
    'the rules failure should carry exactly one retry, got ' + retries.length);
  assert.equal(String(retries[0].textContent || ''), 'Try again');
});

test('the retry sits with the rules failure in every state that can draw one', async () => {
  /* The three states the pane can be in while the rules read is unreadable.
     Each renders the failure somewhere different — inside the queue card when
     the queue is empty, as its own card when the queue has rows, and beside
     the problems failure when both reads are down — and the operator has to be
     offered the same control in all three. */
  const states = [
    ['a queue with rows', { rules: boom('rules') }],
    ['an empty queue', { rules: boom('rules'), problems: { problems: [] } }],
    ['the problems read down too', { rules: boom('rules'), problems: boom('problems') }],
  ];
  for (const [what, options] of states) {
    const dom = await boot(options);
    const panel = shownPanel(dom);
    const mine = retriesIn(panel)
      .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE);
    assert.equal(mine.length, 1,
      `with ${what} the rules failure drew ${mine.length} retries, not one`);
    assert.ok(allText(panel).indexOf('The operations API did not answer.') !== -1,
      `with ${what} the operator is not shown the fixed failure copy`);
    assert.ok(allText(panel).indexOf('rules is down') === -1,
      `with ${what} the raw rules read error reached the pane`);
  }
});

test('the rules failure is never stated twice on one screen', async () => {
  /* The card and the in-queue block are alternatives, not a pair: printing
     both would put the same headline on screen twice, which is the density
     this dashboard was redrawn to remove. */
  for (const options of [
    { rules: boom('rules') },
    { rules: boom('rules'), problems: { problems: [] } },
    { rules: boom('rules'), problems: boom('problems') },
  ]) {
    const dom = await boot(options);
    const panel = shownPanel(dom);
    const said = findAll(panel, (n) => String(n.textContent || '') === RULES_HEADLINE);
    assert.equal(said.length, 1,
      'the rules headline is on screen ' + said.length + ' times, not once');
  }
});

test('pressing the rules retry asks for the rules again', async () => {
  const dom = await boot({ rules: boom('rules') });
  const before = Object.assign({}, dom.calls);
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  await press(dom, again);
  assert.equal(dom.calls['/api/ops/alerts/rules'], before['/api/ops/alerts/rules'] + 1,
    'the rules read did not happen again');
  /* The other two go with it because this pane has one loader, and that is
     the honest thing to say about it rather than to claim otherwise: what
     matters for #10771 is that the operator no longer has to reload the page.
     The count is asserted so a change to that behaviour has to be deliberate. */
  assert.equal(dom.calls['/api/ops/summary'], before['/api/ops/summary'] + 1);
});

test('a rules read that comes back takes its own failure off the screen', async () => {
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  dom.answers['/api/ops/alerts/rules'] = rulesFixture();
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.equal(retriesIn(panel)
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE).length, 0,
    'the rules retry is still on screen after the read succeeded');
  assert.ok(allText(panel).indexOf(RULES_HEADLINE) === -1,
    'the pane still says the rules are unreadable after reading them');
});

/* ------------------------------------------------------------ #10784 */

test('a retry leaves focus somewhere the operator can see', async () => {
  /* Containment, not identity: the pre-fix code leaves focus on the button it
     just removed from the tree, and a removed node is outside the shown panel
     in the harness and in a browser alike. */
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.ok(dom.doc.activeElement,
    'nothing has focus at all after the retry');
  assert.ok(panel.contains(dom.doc.activeElement),
    'focus is outside the panel the operator is looking at');
});

test('focus lands on the heading of the section that was re-read', async () => {
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  await press(dom, again);
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.className || ''), 'band-title');
  assert.equal(String(landed.textContent || ''), 'What needs a person');
  assert.equal(landed.getAttribute('tabindex'), '-1',
    'a heading cannot hold focus without one, so this is load-bearing');
});

test('each retry lands in its own section rather than in the first one', async () => {
  /* The figures retry and the rules retry are the same control in two places.
     A landing that named one band for both would pass every test above and
     throw a figures operator into the queue. */
  const dom = await boot({ summary: boom('summary') });
  const panel = shownPanel(dom);
  const titles = bandTitles(panel).map((n) => String(n.textContent || ''));
  const again = retriesIn(panel)
    .filter((n) => n.getAttribute('data-retry') === 'These figures could not be read')[0];
  assert.ok(again, 'the figures failure has no retry to press');
  const before = dom.calls['/api/ops/summary'];
  await press(dom, again);
  assert.equal(dom.calls['/api/ops/summary'], before + 1,
    'the figures retry was pressed and the read never went out again');
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.textContent || ''), titles[titles.length - 1],
    'the figures retry landed on ' + landed.textContent + ', not the last band');
  assert.notEqual(titles[0], titles[titles.length - 1],
    'the two bands share a heading, so this test cannot tell them apart');
});

test('focus still lands when the retry succeeds and deletes its own control', async () => {
  const dom = await boot({ summary: boom('summary') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === 'These figures could not be read')[0];
  dom.answers['/api/ops/summary'] = summaryFixture();
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.equal(retriesIn(panel).length, 0, 'the read recovered but a retry is still drawn');
  assert.ok(panel.contains(dom.doc.activeElement),
    'the control was deleted and focus went with it');
  assert.equal(String(dom.doc.activeElement.className || ''), 'band-title');
});

test('a retry does not land the operator in a panel that is no longer shown', async () => {
  /* #content keeps the empty panel and the live panel at once and clears only
     the one it fills, so a live-then-empty sequence leaves the band this pane
     drew a render ago inside a live box that nobody is shown. Resolving the
     landing by document id finds that one — it is the only node with that id,
     and it is the wrong one. */
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  dom.answers['/api/ops/alerts/rules'] = { rules: [], summary: { armed: 0, total: 0 }, channels: [] };
  dom.answers['/api/ops/alerts/problems'] = { problems: [] };
  dom.answers['/api/ops/summary'] = null;
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.equal(panel.getAttribute('data-state'), 'empty',
    'this test needs the empty render to be what happened, and it is not');
  const stale = dom.doc.getElementById('ov-band-attention');
  assert.ok(stale, 'the stale band is gone, so this test is no longer about anything');
  assert.ok(!panel.contains(stale),
    'the stale band is inside the shown panel, so it is not stale');
  assert.ok(panel.contains(dom.doc.activeElement),
    'focus landed in the hidden panel the previous render left behind');
});

/* ------------------------------------------------- what the operator hears */

test('the outcome is spoken, because a heading does not say what happened', async () => {
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  const head = namingHeading(dom, again);
  const band = bandTitles(shownPanel(dom))
    .filter((n) => String(n.textContent || '') === 'What needs a person')[0];
  await press(dom, again);
  assert.equal(announcement(dom),
    String(band.textContent || '') + ': ' + String(head.textContent || '') + '.');
});

test('a read that came back is announced as having come back', async () => {
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  const band = bandTitles(shownPanel(dom))
    .filter((n) => String(n.textContent || '') === 'What needs a person')[0];
  dom.answers['/api/ops/alerts/rules'] = rulesFixture();
  await press(dom, again);
  assert.equal(announcement(dom), String(band.textContent || '') + ' was read again.');
});

test('the spoken failure and the button name are the same heading', async () => {
  /* data-retry is what the announcement reads and aria-labelledby is what a
     screen reader reads. They are written from one node by one function, and
     this is the assertion that keeps them that way: resolve the heading
     through the id reference, compare its text with the attribute. */
  const dom = await boot({ rules: boom('rules'), summary: boom('summary') });
  const panel = shownPanel(dom);
  const retries = retriesIn(panel);
  assert.ok(retries.length >= 2, 'this test needs two retries, found ' + retries.length);
  for (const again of retries) {
    const head = namingHeading(dom, again);
    assert.equal(again.getAttribute('data-retry'), String(head.textContent || ''));
  }
});

/* ----------------------------------------- the other two retries on the pane

   The rules and figures retries above are two of four controls this pane can
   draw. The problems failure draws a third through the same helper, and the
   shell draws a fourth for the pane's own whole-read failure and takes the
   action as an argument. Both were wired to bare load() before review round 1
   found that nothing here pressed them. */

const PROBLEMS_HEADLINE = 'The problems could not be read';
const WHOLE_PANE_HEADLINE = 'This pane could not be read';

/* The shell's whole-pane retry, which carries no data-retry: the shell writes
   that card itself and this pane only hands it the action. Found by its word
   rather than by an attribute for that reason. */
function retryByWord(root) {
  return findAll(root, (n) => String(n.tagName || '').toLowerCase() === 'button'
    && String(n.textContent || '') === 'Try again');
}

test('pressing the problems retry asks for the problems again and lands focus', async () => {
  const dom = await boot({ problems: boom('problems') });
  const before = dom.calls['/api/ops/alerts/problems'];
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === PROBLEMS_HEADLINE)[0];
  assert.ok(again, 'the problems failure drew no retry to press');
  await press(dom, again);
  assert.equal(dom.calls['/api/ops/alerts/problems'], before + 1,
    'the problems retry was pressed and the read never went out again');
  const panel = shownPanel(dom);
  assert.ok(panel.contains(dom.doc.activeElement),
    'the problems retry left focus outside the panel the operator can see');
  assert.equal(String(dom.doc.activeElement.className || ''), 'band-title');
  assert.equal(String(dom.doc.activeElement.textContent || ''), 'What needs a person');
  assert.equal(announcement(dom), 'What needs a person: ' + PROBLEMS_HEADLINE + '.');
});

test('the pane-wide failure card offers a retry that lands focus too', async () => {
  /* Every read down, so the shell draws its own card in place of the pane. It
     builds the button; this pane supplies what pressing it does. Handed bare
     load(), it re-read the pane and dropped focus on the document — the third
     site Stadiora/Aria#10784 names. */
  const dom = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  const panel = shownPanel(dom);
  assert.ok(allText(panel).indexOf(WHOLE_PANE_HEADLINE) !== -1,
    'this test needs the shell card, and the pane rendered something else');
  const again = retryByWord(panel);
  assert.equal(again.length, 1, 'the whole-pane card drew ' + again.length + ' retries, not one');
  const before = dom.calls['/api/ops/summary'];
  await press(dom, again[0]);
  assert.equal(dom.calls['/api/ops/summary'], before + 1,
    'the whole-pane retry was pressed and no read went out again');
  const after = shownPanel(dom);
  assert.ok(after.contains(dom.doc.activeElement),
    'the whole-pane retry left focus outside the panel the operator can see');
  assert.equal(String(dom.doc.activeElement.className || ''), 'state-title',
    'with no band to land in, the landing is the card that replaced the pane');
  assert.equal(announcement(dom), WHOLE_PANE_HEADLINE + '.');
});

test('the pane-wide retry lands in the band when the reads come back', async () => {
  const dom = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  const again = retryByWord(shownPanel(dom))[0];
  dom.answers['/api/ops/alerts/problems'] = problemsFixture();
  dom.answers['/api/ops/summary'] = summaryFixture();
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.ok(allText(panel).indexOf(WHOLE_PANE_HEADLINE) === -1,
    'two reads came back and the pane still says it could not be read at all');
  assert.equal(String(dom.doc.activeElement.className || ''), 'band-title',
    'the reads came back and drew bands, and the landing stayed on the fallback');
  assert.equal(String(dom.doc.activeElement.textContent || ''), 'What needs a person');
});

test('a band holding two failures announces the one that was retried', async () => {
  /* Both reads in the attention band are down, so two retries sit in one band
     and the answer has to be about the read the operator asked for. The rules
     retry is the SECOND of the two, so an announcement that names whatever is
     first in the band names the problems read instead — a true sentence about
     something the operator did not press. */
  const dom = await boot({ problems: boom('problems'), rules: boom('rules') });
  const panel = shownPanel(dom);
  const order = retriesIn(panel).map((n) => String(n.getAttribute('data-retry') || ''));
  assert.deepEqual(order, [PROBLEMS_HEADLINE, RULES_HEADLINE],
    'this test needs the rules retry to be the later of the two, and it is not');
  const again = retriesIn(panel)
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  await press(dom, again);
  assert.equal(announcement(dom), 'What needs a person: ' + RULES_HEADLINE + '.');
});

test('a retry that works reports what is still unread beside it', async () => {
  /* The other half of the same band: the retried read comes back and its
     sibling has not. "Was read again" would be true of the button that was
     pressed and false of the section the operator is now looking at. */
  const dom = await boot({ problems: boom('problems'), rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  dom.answers['/api/ops/alerts/rules'] = rulesFixture();
  await press(dom, again);
  const left = retriesIn(shownPanel(dom)).map((n) => String(n.getAttribute('data-retry') || ''));
  assert.deepEqual(left, [PROBLEMS_HEADLINE],
    'the rules read came back and the band holds ' + left.join(', '));
  assert.equal(announcement(dom), 'What needs a person: ' + PROBLEMS_HEADLINE + '.');
});

/* ------------------------------------- two reads in flight, and which lands

   loadToken already stops an older read from RENDERING. Its promise still
   fulfils, and the landing hangs off that promise, so before review round 2
   an obsolete request could still move focus — after the newer one had
   landed and after the operator had moved on. */

test('a superseded retry does not take focus back when it finishes last', async () => {
  const dom = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  dom.hold('/api/ops/alerts/problems', '/api/ops/alerts/rules', '/api/ops/summary');
  const first = retryByWord(shownPanel(dom))[0];
  tap(first);
  await dom.settle(4);
  tap(first);
  await dom.settle(4);
  assert.equal(dom.calls['/api/ops/summary'], 3,
    'this test needs two retries in flight at once, and the pane made '
    + dom.calls['/api/ops/summary'] + ' reads in total');

  await dom.release(1);
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.className || ''), 'state-title',
    'the newer read did not land, so there is nothing for the older one to steal');

  /* The operator moves on, which is the whole point: without this the older
     landing puts focus where it already was and nothing looks wrong. */
  const moved = retryByWord(shownPanel(dom))[0];
  moved.focus();
  assert.equal(dom.doc.activeElement, moved);

  await dom.release(0);
  assert.equal(dom.doc.activeElement, moved,
    'a read that rendered nothing dragged focus back to '
    + String(dom.doc.activeElement.className || ''));
});

test('the read that did render still lands when it finishes last', async () => {
  /* The other completion order, so the gate cannot be satisfied by never
     landing at all. */
  const dom = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  dom.hold('/api/ops/alerts/problems', '/api/ops/alerts/rules', '/api/ops/summary');
  const first = retryByWord(shownPanel(dom))[0];
  tap(first);
  await dom.settle(4);
  tap(first);
  await dom.settle(4);

  await dom.release(0);
  assert.equal(dom.doc.activeElement, first,
    'the obsolete read landed on ' + String(dom.doc.activeElement.className || '')
    + ', so the gate is not doing anything');
  await dom.release(1);
  assert.equal(String(dom.doc.activeElement.className || ''), 'state-title',
    'the read that actually rendered did not land');
});

/* -------------------------------------- the placements round 2 found unbound */

test('both retries in one band announce their own failure, not a fixed end of the list', async () => {
  /* Round 2's finding: pressing only the LAST of the two is satisfied by an
     implementation that always names the last. Both are pressed here, in one
     test, so a constant index fails whichever end it picks. */
  const dom = await boot({ problems: boom('problems'), rules: boom('rules') });
  const order = retriesIn(shownPanel(dom)).map((n) => String(n.getAttribute('data-retry') || ''));
  assert.deepEqual(order, [PROBLEMS_HEADLINE, RULES_HEADLINE],
    'this test needs the two failures in a known order, and got ' + order.join(' | '));

  for (const headline of order) {
    const fresh = await boot({ problems: boom('problems'), rules: boom('rules') });
    const again = retriesIn(shownPanel(fresh))
      .filter((n) => n.getAttribute('data-retry') === headline)[0];
    assert.ok(again, 'no retry carries ' + headline);
    await press(fresh, again);
    assert.equal(announcement(fresh), 'What needs a person: ' + headline + '.',
      'pressing the retry for "' + headline + '" announced something else');
  }
});

test('the rules retry drawn inside the queue card lands in the queue card band', async () => {
  /* The rules failure renders in two places and only one of them was pressed
     before round 2. This is the in-card one: an empty queue, where the
     failure is also the reason the list is short. A wrong band argument here
     sends the operator to the figures and reports the wrong outcome. */
  const dom = await boot({ rules: boom('rules'), problems: { problems: [] } });
  const panel = shownPanel(dom);
  const again = retriesIn(panel)
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  assert.ok(again, 'the in-queue rules failure drew no retry');
  const card = bandTitles(panel).filter((n) => String(n.textContent || '') === 'What needs a person');
  assert.equal(card.length, 1, 'this test needs one attention band, found ' + card.length);
  await press(dom, again);
  assert.equal(String(dom.doc.activeElement.className || ''), 'band-title');
  assert.equal(String(dom.doc.activeElement.textContent || ''), 'What needs a person',
    'the in-queue retry landed on ' + dom.doc.activeElement.textContent);
  assert.equal(announcement(dom), 'What needs a person: ' + RULES_HEADLINE + '.');
});

/* ---------------------------------------- the fallback landing, in full

   A heading cannot hold focus without tabindex="-1" in a browser, and the
   fake DOM will focus one anyway. The band landing asserted it; the two
   fallback landings did not, so an implementation that set it only for bands
   passed both. */

test('the fallback landing is focusable, not merely focused', async () => {
  const dom = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  await press(dom, retryByWord(shownPanel(dom))[0]);
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.className || ''), 'state-title');
  assert.equal(landed.getAttribute('tabindex'), '-1',
    'the whole-pane card heading cannot take focus in a browser without one');
});

test('the empty-state landing is focusable, not merely focused', async () => {
  const dom = await boot({ rules: boom('rules') });
  const again = retriesIn(shownPanel(dom))
    .filter((n) => n.getAttribute('data-retry') === RULES_HEADLINE)[0];
  dom.answers['/api/ops/alerts/rules'] = { rules: [], summary: { armed: 0, total: 0 }, channels: [] };
  dom.answers['/api/ops/alerts/problems'] = { problems: [] };
  dom.answers['/api/ops/summary'] = null;
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.equal(panel.getAttribute('data-state'), 'empty',
    'this test needs the empty render, and it is not what happened');
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.className || ''), 'state-title');
  assert.equal(landed.getAttribute('tabindex'), '-1',
    'the empty-state heading cannot take focus in a browser without one');
});

/* ------------------------------------------- the backstop for a broken render

   The three reads cannot reject, so load()'s catch is not a failed-read path:
   it is what happens when render() itself throws. A rules payload the pane
   cannot walk reaches it, which round 2 demonstrated and which is why this is
   a test rather than a declared-unreachable row in the mutation table. */

const UNWALKABLE_RULES = { rules: [null], channels: [] };

test('a render that throws leaves a retry that lands focus', async () => {
  const dom = await boot({ rules: UNWALKABLE_RULES });
  const panel = shownPanel(dom);
  assert.ok(allText(panel).indexOf(WHOLE_PANE_HEADLINE) !== -1,
    'this test needs render() to have thrown, and the pane drew something else');
  const again = retryByWord(panel);
  assert.equal(again.length, 1, 'the backstop card drew ' + again.length + ' retries, not one');
  await press(dom, again[0]);
  const landed = dom.doc.activeElement;
  assert.equal(String(landed.className || ''), 'state-title',
    'the backstop retry left focus on ' + String(landed.className || ''));
  assert.equal(landed.getAttribute('tabindex'), '-1');
  assert.equal(announcement(dom), WHOLE_PANE_HEADLINE + '.');
});

test('a render that throws recovers when the payload it choked on comes back walkable', async () => {
  const dom = await boot({ rules: UNWALKABLE_RULES });
  const again = retryByWord(shownPanel(dom))[0];
  dom.answers['/api/ops/alerts/rules'] = rulesFixture();
  await press(dom, again);
  const panel = shownPanel(dom);
  assert.ok(allText(panel).indexOf(WHOLE_PANE_HEADLINE) === -1,
    'the payload came back walkable and the pane still says it could not be read');
  assert.equal(String(dom.doc.activeElement.textContent || ''), 'What needs a person');
});
