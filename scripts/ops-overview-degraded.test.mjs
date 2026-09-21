/* What the Overview pane does when ONE of its three reads fails.

   Stadiora/Aria#5498's first defect: the pane loaded its three reads under a
   bare `Promise.all`, so a single rejected request rejected the whole thing
   and the catch replaced the entire pane with "This pane could not be read" —
   including the sections whose own reads had landed. The pane's own docblock,
   and the Problems pane it sits beside, both state the opposite rule: a
   failure degrades the pane rather than emptying it.

   Two things make these tests bind the behaviour rather than a sentence:

     - Every assertion about "is that section still on screen" counts RENDERED
       NODES in the live panel, and the count it compares against is taken
       from a healthy render in the same test rather than typed here. A
       section that stops rendering cannot be smuggled past a node count.

     - Every assertion about "the pane must not claim X" is two-sided. The
       same finder that must come up empty on the unreadable render is first
       shown to FIND the claim on the readable one. A predicate that matches
       nothing would otherwise pass every absence test in this file, which is
       exactly how a `/\b(free|paid)\b/i` sweep on another pane classified
       nothing and stayed green through a real misclassification.

   NOT COVERED here, deliberately:

     - The two remaining defects in #5498. The close note reaching the record's
       timeline was already fixed and is already bound, by
       `scripts/ops-alerts-v2.test.mjs`'s "a record closed with a note prints
       it on the timeline" and its no-note twin; duplicating them here would
       add a second place to update and prove nothing new. The close note's
       length limit is in `scripts/ops-close-note-limit.test.mjs`.

     - Whether the degraded state LOOKS different from the live one. Both are
       the same `[data-state]` box ("live degraded"), so the shell shows the
       same element for either and no DOM assertion here can tell them apart.
       What is on that box is the whole of what an operator sees, and that is
       what these tests read. */
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

/* A whole, healthy answer from each of the three reads. Every test below
   takes exactly one of them away. */
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

/* One critical problem with nobody on it, so the healthy render has a queue
   row to count and a rail badge to look for. */
function problemsFixture() {
  return {
    problems: [{
      id: 'p1', reference: 'PRB-1', title: 'Checkout latency', severity: 'critical',
      status: 'open', category: 'performance', firedAt: hoursAgo(3), workPane: 'alerts',
    }],
  };
}

/* An enabled rule that has run and reached a verdict, which is the only shape
   alerts-model.js will call "checking" — and therefore the only shape that
   makes the healthy ribbon say the checks are running. */
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

const boom = (what) => Object.assign(new Error(what + ' is down'), { status: 503 });

/* --------------------------------------------------------------- booting */

/* The page ops/index.html builds, plus a rail. No test here reads the rail,
   but the pane sets a badge on it every render, and without a rail item that
   call returns at its first line — so the rail is what makes the badge path
   actually run rather than be skipped. */
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
      const answer = answers[endpoint];
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
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));

  /* `answers` is handed back live so a test can change what a read returns
     BETWEEN loads, and `calls` counts them. Without those two a retry can only
     be asserted to exist, not to do anything — which is how a button wired to
     a no-op stayed green through three review rounds. */
  return Object.assign(dom, { answers, calls, settle });
}

/* ---------------------------------------------------------- what is drawn */

/* The panel an operator is actually looking at. The loading and empty panels
   are siblings of it, so reading the whole region would read text nobody can
   see. */
/* Whichever of the shell's panels is the one showing. `region.empty()` fills
   a DIFFERENT box from `region.show()`, so a test that always reads the live
   panel reads '' for an empty render and would pass every absence assertion
   in this file for the wrong reason. */
function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once, so "what the operator sees" `
    + 'is not a single answer and nothing below means what it says');
  return boxes[0];
}

function livePanel(dom) {
  return dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf('live') !== -1)[0];
}

const hasClass = (node, name) =>
  String(node.className || '').split(/\s+/).indexOf(name) !== -1;

const nodesWithClass = (root, name) => findAll(root, (n) => hasClass(n, name));

/* The four headline tiles, as nodes. The figures half of the pane renders
   them into one `grid g4`, so their number is the count of that grid's
   children — not a number written here. */
function figureTileCount(dom) {
  const grid = nodesWithClass(livePanel(dom), 'g4')[0];
  return grid ? grid.childNodes.length : 0;
}

/* The queue rows, as nodes: the children of the one `q-list`. */
function queueRowCount(dom) {
  const list = nodesWithClass(livePanel(dom), 'q-list')[0];
  return list ? list.childNodes.length : 0;
}

function ribbonTitle(dom) {
  const title = nodesWithClass(livePanel(dom), 'hero-title')[0];
  return title ? allText(title).trim() : null;
}

function chipTexts(dom) {
  const strip = nodesWithClass(livePanel(dom), 'hero-chips')[0];
  if (!strip) return [];
  return strip.childNodes.map((n) => allText(n).trim()).filter(Boolean);
}


/* The state block the queue card draws when it has no rows: the card's own
   answer to why the list is short. */
function quietBlockTitle(dom) {
  const list = nodesWithClass(livePanel(dom), 'q-list')[0];
  if (list && list.childNodes.length) return null;
  const block = nodesWithClass(livePanel(dom), 'card-body')
    .map((body) => nodesWithClass(body, 'state-block')[0])
    .filter(Boolean)[0];
  if (!block) return null;
  const title = findAll(block, (n) => /^H[1-6]$/.test(n.tagName))[0];
  return title ? allText(title).trim() : null;
}

/* A claim of the form "3 of 4 rules checking", resolved to its two numbers
   rather than matched as a phrase. Returns null when the pane makes no such
   claim, which is the state an unreadable rules read has to reach. */
function rulesCheckingClaim(dom) {
  for (const text of chipTexts(dom)) {
    const found = /(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+rules checking/.exec(text);
    if (found) {
      return {
        checking: Number(found[1].replace(/,/g, '')),
        total: Number(found[2].replace(/,/g, '')),
      };
    }
  }
  return null;
}

/* Whether the shell's whole-pane failure card is what the operator got. It is
   the only thing region.failed() puts on the live panel, so its presence and
   an empty pane are the same event seen twice. */
function wholePaneFailureCard(dom) {
  return nodesWithClass(livePanel(dom), 'state-block')
    .filter((n) => /This pane could not be read/.test(allText(n)))[0] || null;
}

/* ------------------------------------------ one read down, the rest drawn */

test('a failed problems read leaves the figures on screen', async () => {
  const healthy = await boot();
  const expected = figureTileCount(healthy);
  assert.ok(expected > 0,
    'the healthy render drew no figure tiles, so this test can prove nothing');

  const down = await boot({ problems: boom('problems') });
  assert.equal(figureTileCount(down), expected,
    'one failed read took the figures off the screen with it');
  assert.equal(wholePaneFailureCard(down), null,
    'the pane reported itself unreadable while two of its three reads had landed');
});

test('a failed rules read leaves the problems on screen', async () => {
  const healthy = await boot();
  const expected = queueRowCount(healthy);
  assert.ok(expected > 0,
    'the healthy render drew no queue rows, so this test can prove nothing');

  const down = await boot({ rules: boom('rules') });
  assert.equal(queueRowCount(down), expected,
    'the unreadable rules list took the urgent queue off the screen with it');
  assert.equal(wholePaneFailureCard(down), null,
    'the pane reported itself unreadable while two of its three reads had landed');
});

test('a failed summary read leaves the problems on screen', async () => {
  const healthy = await boot();
  const expected = queueRowCount(healthy);
  assert.ok(expected > 0,
    'the healthy render drew no queue rows, so this test can prove nothing');

  const down = await boot({ summary: boom('the summary') });
  assert.equal(queueRowCount(down), expected,
    'the unreadable figures took the urgent queue off the screen with them');
});

test('only every read failing takes the whole pane down', async () => {
  const down = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('the summary'),
  });
  assert.ok(wholePaneFailureCard(down),
    'nothing on this pane was readable and it did not say so');
  assert.equal(figureTileCount(down), 0, 'figures were drawn from a read that failed');
  assert.equal(queueRowCount(down), 0, 'queue rows were drawn from a read that failed');
});

test('each failed section offers its own retry rather than one for the pane', async () => {
  const down = await boot({ problems: boom('problems') });
  const retries = findAll(livePanel(down),
    (n) => n.tagName === 'BUTTON' && /Try again/.test(allText(n)));
  assert.equal(retries.length, 1,
    'the section that failed did not offer exactly one way to ask again');

  /* "rather than one for the pane" is the half a count cannot see: the
     whole-pane failure card also draws exactly one Try again. What separates
     them is WHERE the button is, so the retry has to be inside the block the
     failed section drew, and the pane-wide card has to be absent. */
  const section = nodesWithClass(livePanel(down), 'state-block')
    .find((b) => /The problems could not be read/.test(allText(b)));
  assert.ok(section, 'no failed-section block to hold a retry');
  assert.ok(findAll(section, (n) => n === retries[0]).length === 1,
    'the retry is on the page but not inside the section that failed, which is what a '
    + 'pane-wide failure card looks like');
  assert.equal(
    nodesWithClass(livePanel(down), 'state-block')
      .filter((b) => /This pane could not be read/.test(allText(b))).length, 0,
    'the pane drew its whole-pane failure card for a single failed read');

  /* Two failed reads, two independent ways to ask again. */
  const both = await boot({ problems: boom('problems'), summary: boom('summary') });
  const two = findAll(livePanel(both),
    (n) => n.tagName === 'BUTTON' && /Try again/.test(allText(n)));
  assert.equal(two.length, 2,
    'two sections failed and the pane did not offer a retry for each');

  /* The accessible NAME each button ends up with, resolved the way an
     assistive technology resolves it: follow every idref to the element it
     names and read that element's text. An earlier version of this compared
     the two attribute STRINGS, which is green for two references that both
     dangle — and they did dangle, because the pane set the heading id by
     property and this harness has no id accessor. Comparing strings asserts
     that two pieces of markup differ, not that two controls are told apart. */
  const names = two.map((button) => {
    const refs = String(button.getAttribute('aria-labelledby') || '').split(/\s+/)
      .filter(Boolean);
    assert.ok(refs.length >= 2,
      'the retry composes its name from fewer than two elements, so it cannot be naming '
      + 'both itself and the section it belongs to');
    return refs.map((id) => {
      const target = findAll(both.doc.body, (n) => n.getAttribute && n.getAttribute('id') === id);
      assert.equal(target.length, 1,
        `aria-labelledby points at "${id}", which matches ${target.length} elements on the `
        + 'page — a name built out of a reference that resolves to nothing is no name at all');
      return allText(target[0]).trim();
    }).join(' ');
  });

  assert.ok(names.every((n) => /^Try again\b/.test(n)),
    'the visible word is no longer the first token of the accessible name, so anyone driving '
    + `this by voice cannot say what they can see: ${JSON.stringify(names)}`);
  assert.ok(names.every((n) => n.replace(/^Try again\s*/, '').length > 0),
    `a retry's name is the bare word with nothing identifying its section: ${
      JSON.stringify(names)}`);
  assert.notEqual(names[0], names[1],
    `two buttons resolve to the same accessible name: ${JSON.stringify(names)}`);
});

test('the failed section says what went wrong and that the gap is not a zero', async () => {
  /* The ribbon shed "Nothing here is a zero: they are unread, not absent" on the
     grounds that the card beneath carries it. Nothing bound that the card does,
     so the sentence could have left the pane entirely and the suite would have
     agreed. This is the assumption that word-reduction rests on.

     The error string is asserted as the one the READ rejected with, not as a
     phrase: an error message the pane invents is the same defect as no error
     message, and a /could not/ predicate cannot tell them apart. */
  const down = await boot({ problems: boom('the problems query timed out') });
  const section = nodesWithClass(livePanel(down), 'state-block')
    .find((b) => /The problems could not be read/.test(allText(b)));
  assert.ok(section, 'no failed-section card to read');

  const text = allText(section);
  assert.match(text, /the problems query timed out/,
    'the section reports that something failed without reporting what, so an operator has '
    + 'nothing to act on and no way to tell a timeout from a permission error');
  assert.match(text, /not a zero|unread, not empty/,
    'the section does not say the gap is unread rather than empty — the one thing this pane '
    + 'exists to keep straight, and the reason the ribbon was allowed to shed the sentence');

  /* Two-sided: the healthy render says neither of these, so a finder matching
     everything would not look like a pass. */
  const healthy = allText(livePanel(await boot()));
  assert.doesNotMatch(healthy, /the problems query timed out/,
    'the healthy render already carries the error text, so its presence proves nothing');
});

test('a read that never landed does not earn the sentence "there is nothing here"', async () => {
  /* The emptiest legal answer all three reads can give: a summary that landed
     carrying no figures, no problems, no rules. That IS empty, and the pane
     says so. */
  const nothing = {
    summary: null,
    problems: { problems: [] },
    rules: { rules: [], summary: { armed: 0, total: 0 }, channels: [] },
  };
  const bare = allText(shownPanel(await boot(nothing)));
  assert.match(bare, /Nothing is behind this pane yet/,
    'the pane no longer recognises its genuinely empty state, so the absence assertions '
    + 'below would pass for the wrong reason');

  /* Now take one read away and leave the rest exactly as they were. Nothing
     about how much data exists has changed — only how much of it was read.
     An unread half is not an empty half, and "nothing is behind this pane"
     is a claim about the world, not about the request. */
  for (const [which, only] of [
    ['problems', 'problems'], ['rules', 'rules'], ['summary', 'summary'],
  ]) {
    const text = allText(shownPanel(await boot({ ...nothing, [only]: boom(which) })));
    assert.doesNotMatch(text, /Nothing is behind this pane yet/,
      `the ${which} read failed and the pane told the operator there is nothing behind it — `
      + 'the one sentence on this pane that a failed read can turn into a lie, because it '
      + 'reads as a fact about the system rather than about the request');
    assert.match(text, /could not be read|unread/,
      `the ${which} read failed and the pane says nothing about it at all`);
  }
});

test('the retry actually re-runs the read and the section comes back', async () => {
  /* Three rounds of review checked that the button EXISTS and that it is told
     apart from the other one. Nothing checked that pressing it does anything,
     and a retry wired to a no-op is a worse failure than no retry at all: it
     is the control the whole partial-degradation fix hands the operator, and
     it would have looked completely normal. */
  const dom = await boot({ problems: boom('problems') });
  const before = dom.calls['/api/ops/alerts/problems'];
  assert.ok(before >= 1, 'the pane never asked for the problems at all');

  const again = findAll(shownPanel(dom),
    (n) => n.tagName === 'BUTTON' && /Try again/.test(allText(n)))[0];
  assert.ok(again, 'the failed section drew no retry');

  /* The read starts answering. Nothing else about the page changes, so any
     difference below is the retry's doing. */
  dom.answers['/api/ops/alerts/problems'] = problemsFixture();
  again.dispatch('click');
  await dom.settle();

  assert.ok(dom.calls['/api/ops/alerts/problems'] > before,
    'pressing Try again did not ask for the problems again — the button is drawn, named, '
    + 'and wired to nothing');

  const after = allText(shownPanel(dom));
  assert.doesNotMatch(after, /The problems could not be read/,
    'the read succeeded on retry and the pane is still showing the failure card, so the '
    + 'operator has no way back to a working pane short of a reload');
  assert.match(after, /Checkout latency/,
    'the problems came back and the pane did not draw them');
});

test('the figures card\'s retry re-runs its read too, which is a second handler', async () => {
  /* figuresSection builds its own button rather than going through
     failedSection, so it is a separate `addEventListener` and a separate way
     to be wired to nothing. */
  const dom = await boot({ summary: boom('summary') });
  const before = dom.calls['/api/ops/summary'];
  const again = findAll(shownPanel(dom),
    (n) => n.tagName === 'BUTTON' && /Try again/.test(allText(n)))[0];
  assert.ok(again, 'the figures failure drew no retry');

  dom.answers['/api/ops/summary'] = summaryFixture();
  again.dispatch('click');
  await dom.settle();

  assert.ok(dom.calls['/api/ops/summary'] > before,
    'the figures card\'s Try again did not ask for the summary again');
  assert.match(allText(shownPanel(dom)), /1,102|1102/,
    'the summary came back on retry and the figures did not');
});

test('the whole-pane failure offers a retry that works', async () => {
  /* When all three reads fail the pane hands `load` to the shell, and the
     shell draws the button. The handler is the shell\'s; what this binds is
     that the pane passed something that actually re-reads. */
  const dom = await boot({
    summary: boom('summary'), problems: boom('problems'), rules: boom('rules'),
  });
  const panel = shownPanel(dom);
  assert.match(allText(panel), /This pane could not be read/,
    'all three reads failed and the pane did not say so');

  const before = dom.calls['/api/ops/summary'];
  const again = findAll(panel,
    (n) => n.tagName === 'BUTTON' && /Try again/.test(allText(n)))[0];
  assert.ok(again, 'the whole-pane failure drew no retry');

  dom.answers['/api/ops/summary'] = summaryFixture();
  dom.answers['/api/ops/alerts/problems'] = problemsFixture();
  dom.answers['/api/ops/alerts/rules'] = rulesFixture();
  again.dispatch('click');
  await dom.settle();

  assert.ok(dom.calls['/api/ops/summary'] > before,
    'the whole-pane retry did not re-read anything, so an operator who lost the pane to a '
    + 'transient failure cannot get it back without a reload');
  assert.doesNotMatch(allText(shownPanel(dom)), /This pane could not be read/,
    'every read recovered and the pane is still showing its failure state');
});

test('two reads down is still not the whole pane down', async () => {
  /* `openFailed && rulesFailed && failed` has three terms and the file bound
     one of them: taking a read away and watching the pane survive only ever
     exercised the term for THAT read. Each case below leaves a different one
     of the three answering, and what it answers has to still be on screen —
     which is #5498 itself, restated for every pair rather than for singles. */
  const cases = [
    {
      name: 'the summary',
      down: { problems: boom('problems'), rules: boom('rules') },
      survives: /1,102|1102/,
      lost: 'the figures landed and the pane threw them away',
    },
    {
      name: 'the problems',
      down: { rules: boom('rules'), summary: boom('summary') },
      survives: /Checkout latency/,
      lost: 'a live critical problem landed and the pane threw it away',
    },
    {
      name: 'the rules',
      down: { problems: boom('problems'), summary: boom('summary') },
      survives: /rules checking|Everything is working|Nothing is open/,
      lost: 'the rules landed and the pane threw them away',
    },
  ];

  for (const c of cases) {
    const dom = await boot(c.down);
    const text = allText(shownPanel(dom));
    assert.doesNotMatch(text, /This pane could not be read/,
      `two of three reads failed and ${c.name} answered, and the pane replaced everything `
      + `with its whole-pane failure: ${c.lost}. That is the defect #5498 was filed for, `
      + 'one read short of the case the other tests cover');
    assert.match(text, c.survives,
      `the pane stayed up but ${c.name} is not on screen, so the read that landed reached `
      + 'the operator no better than if it had failed');
  }

  /* The other side: all three down IS the whole pane down, so the assertions
     above are not passing because the branch is unreachable. */
  const allDown = await boot({
    problems: boom('problems'), rules: boom('rules'), summary: boom('summary'),
  });
  assert.match(allText(shownPanel(allDown)), /This pane could not be read/,
    'every read failed and the pane did not say the whole pane is unreadable');
});

test('an unreadable rules list does not make an open problem disappear', async () => {
  /* The ribbon\'s unread-rules reading is gated `rulesFailed && !active.length`
     and the file bound the branch it REACHES, never the gate that keeps it
     out. Without `!active.length` the reading wins over the open-problems
     one, and the ribbon reads "Nothing is open" directly beside a chip saying
     a critical problem is open — the pane contradicting itself in one line,
     about the thing it exists to show. */
  const dom = await boot({ rules: boom('rules') });
  const text = allText(shownPanel(dom));

  assert.match(text, /Checkout latency|1 critical|critical/i,
    'the fixture\'s open problem is not on screen at all, so the contradiction below could '
    + 'not appear either and this test would pass for the wrong reason');
  assert.doesNotMatch(text, /Nothing is open/,
    'the rules read failed and the ribbon announced that nothing is open, next to an open '
    + 'critical problem it is drawing itself');

  /* And the reading IS correct when the queue really is empty, so the
     assertion above is about the gate rather than about the sentence. */
  const quiet = await boot({ rules: boom('rules'), problems: { problems: [] } });
  assert.match(allText(shownPanel(quiet)), /Nothing is open/,
    'with the queue genuinely empty and the rules unread, the ribbon stopped saying so');
});

test('one thing behind the pane is enough to stop it saying there is nothing', async () => {
  /* The empty guard has six terms. Three say the reads landed and are bound
     above; three say there is genuinely nothing behind them, and the conjunct
     sweep found all three deletable with the suite green. Each case here
     leaves exactly ONE of the three things present and everything else empty,
     so each term is the only thing standing between the pane and a sentence
     that is false. */
  const empty = {
    summary: null,
    problems: { problems: [] },
    rules: { rules: [], summary: { armed: 0, total: 0 }, channels: [] },
  };

  const cases = [
    { term: '!figures', only: { summary: summaryFixture() }, shows: /1,102|1102/,
      lie: 'the figures came back and the pane said there is nothing behind it' },
    { term: '!problems.length', only: { problems: problemsFixture() },
      shows: /Checkout latency/,
      lie: 'a critical problem is open and the pane said there is nothing behind it' },
    { term: '!armed.total', only: { rules: rulesFixture() }, shows: /rules checking/,
      lie: 'a rule exists and the pane said there is nothing behind it' },
  ];

  for (const c of cases) {
    const text = allText(shownPanel(await boot({ ...empty, ...c.only })));
    assert.doesNotMatch(text, /Nothing is behind this pane yet/,
      `${c.lie} — the \`${c.term}\` term of the empty guard is the only thing preventing it`);
    assert.match(text, c.shows,
      `the pane did not draw the one thing this case puts behind it, so the absence `
      + 'assertion above passed for the wrong reason');
  }
});

/* ------------------------------------------- what the pane may not claim */

test('an unreadable rules list is not printed as a count of rules', async () => {
  /* The positive half: with the rules read answering, the claim is there and
     its numbers are the ones the answer carries. Without this, the finder
     below could be matching nothing at all and every absence would pass. */
  const healthy = await boot();
  const claim = rulesCheckingClaim(healthy);
  assert.deepEqual(claim, { checking: 1, total: 1 },
    'the readable render made no rules-checking claim, so its absence proves nothing');

  const down = await boot({ rules: boom('rules') });
  assert.equal(rulesCheckingClaim(down), null,
    'the pane printed a count of checking rules from a read that never landed');
});

test('an unreadable rules list is not printed as a system with nothing watching', async () => {
  /* The positive half again, and it needs a problem on screen: with an empty
     queue the ribbon answers from its unreadable-rules branch before it ever
     reaches the unarmed one, so an empty-queue fixture would pass this test
     without exercising the guard it is named for. */
  const unarmed = await boot({
    rules: { rules: [{ id: 'r1', name: 'Checkout latency', enabled: true }], channels: [] },
  });
  assert.equal(ribbonTitle(unarmed), 'Nothing is being checked',
    'the unarmed fixture did not reach the title this test is about');

  const down = await boot({ rules: boom('rules') });
  assert.notEqual(ribbonTitle(down), 'Nothing is being checked',
    'the pane stated that nothing is watching, from a read that never landed');
});

test('a quiet queue is not called working when the checks could not be read', async () => {
  const quiet = await boot({ problems: { problems: [] } });
  assert.equal(ribbonTitle(quiet), 'Everything is working',
    'the quiet fixture did not reach the title this test is about');

  const down = await boot({ problems: { problems: [] }, rules: boom('rules') });
  assert.notEqual(ribbonTitle(down), 'Everything is working',
    'an empty queue was called health while whether anything was looking was unknown');
});

test('an unreadable queue is not called working either', async () => {
  const quiet = await boot({ problems: { problems: [] } });
  assert.equal(ribbonTitle(quiet), 'Everything is working',
    'the quiet fixture did not reach the title this test is about');

  const down = await boot({ problems: boom('problems') });
  assert.notEqual(ribbonTitle(down), 'Everything is working',
    'a queue nobody could read was reported as nothing being wrong');
});

test('the queue card does not call the checks stopped when they are unread', async () => {
  const unarmed = await boot({
    problems: { problems: [] },
    rules: { rules: [{ id: 'r1', name: 'Checkout latency', enabled: true }], channels: [] },
  });
  assert.equal(quietBlockTitle(unarmed), 'The checks are not running',
    'the unarmed fixture did not reach the block this test is about');

  const down = await boot({ problems: { problems: [] }, rules: boom('rules') });
  assert.notEqual(quietBlockTitle(down), 'The checks are not running',
    'the queue card stated the checks had stopped, from a read that never landed');
});

/* NOT COVERED, with the reason rather than a weaker test.

   `badgeProblems` takes a `failed` flag and clears the rail badge with it, the
   way the Problems pane's does. No test here binds that flag, because none
   can: when the problems read fails the pane already hands that function an
   empty list, so the badge is cleared whether the flag is read or not, and
   every mutation of the flag leaves this file green. It is kept for the case
   the list stops being emptied, and it is named here rather than covered by
   an assertion that would pass on its own regardless. */

test('the figures failure claims the problems are unaffected only when they are', async () => {
  const summaryOnly = await boot({ summary: boom('the summary') });
  assert.match(allText(livePanel(summaryOnly)), /read separately and are unaffected/,
    'the figures failure did not reach the sentence this test is about');

  const both = await boot({ summary: boom('the summary'), problems: boom('problems') });
  assert.doesNotMatch(allText(livePanel(both)), /read separately and are unaffected/,
    'the pane told the operator their problems were fine while saying it could not read them');
});

/* ------------------------------------ every degraded reading says something */

/* The negative assertions above bind which branch is CHOSEN. None of them binds
   that the chosen branch says anything at all, and an independent reviewer
   showed all four new readings can be emptied to '' with the file still green
   — two of them shipping an empty <h2 class="hero-title"> and an empty
   <h4 class="state-title">, which is an accessibility defect that renders.

   This is the positive half, and it is deliberately not an equality check
   against the prose: pinning the sentence would make every future wording
   change a test edit, and the defect is emptiness, not wording.

   WHAT IT COVERS, exactly, because a sweep invites a wider reading than it
   earns: every heading and every hero-chip reachable from the fixture
   combinations in `cases`. A reading added later is covered automatically
   ONLY if it is a heading or a chip AND some case renders it. Two of the four
   readings this file was written for were NOT reachable when the sweep was
   first written — both need an empty queue — and it reported clean; the
   battery caught it, reading the code did not.

   NOT COVERED by it: the ribbon SUBS. An emptied sub renders no element at
   all (`if (sub)` in ribbon()), so there is no empty <p> and nothing unnamed,
   which is why they are outside a sweep whose subject is labels with no
   words in them. They are prose, and prose is bound where it is load-bearing:
   `the failed section says what went wrong...` above.

   chipTexts() cannot see this: it ends in .filter(Boolean), so an empty chip
   leaves the array it returns and the absence looks like success. */
function emptyLabels(dom) {
  const panel = livePanel(dom);
  const headings = findAll(panel, (n) => /^H[1-6]$/.test(String(n.tagName || '')));
  const chips = nodesWithClass(panel, 'hero-chips')
    .flatMap((strip) => strip.childNodes || []);
  const checked = [...headings, ...chips];
  return {
    checked: checked.length,
    empty: checked.filter((n) => allText(n).trim() === '')
      .map((n) => `<${String(n.tagName || '?').toLowerCase()} class="${n.className || ''}">`),
  };
}

test('no degraded reading is drawn as an empty heading or an empty chip', async () => {
  /* The healthy render first: it proves the finder reaches real nodes, so a
     sweep that found nothing cannot pass as a sweep that found nothing wrong. */
  const healthy = emptyLabels(await boot());
  assert.ok(healthy.checked >= 4,
    `the finder reached ${healthy.checked} labelled nodes on a healthy render, which is too `
    + 'few for its absence on a degraded one to mean anything');
  assert.deepEqual(healthy.empty, [], 'the healthy render already draws an empty label');

  const cases = [
    ['the problems read', { problems: boom('problems') }],
    ['the rules read', { rules: boom('rules') }],
    ['the summary read', { summary: boom('the summary') }],
    ['the problems and rules reads', { problems: boom('problems'), rules: boom('rules') }],
    ['the problems and summary reads',
      { problems: boom('problems'), summary: boom('the summary') }],
    /* An empty queue is not a variation, it is the only way two of the four
       readings are reachable at all: the ribbon's "nothing open and nothing
       known to be watching" needs !active.length, and the queue card only
       draws its state block when it has no rows. Without these two rows the
       sweep walks straight past them and reports clean — which is exactly
       what it did, and the battery caught it as a green mutation. */
    ['the rules read, with a quiet queue', { problems: { problems: [] }, rules: boom('rules') }],
    ['the summary read, with a quiet queue',
      { problems: { problems: [] }, summary: boom('the summary') }],
  ];
  for (const [what, options] of cases) {
    const seen = emptyLabels(await boot(options));
    assert.ok(seen.checked > 0, `nothing labelled was drawn with ${what} down`);
    assert.deepEqual(seen.empty, [],
      `with ${what} down the pane drew ${seen.empty.join(', ')} — a reading with no words in `
      + 'it, which a screen reader announces as an unnamed heading');
  }
});
