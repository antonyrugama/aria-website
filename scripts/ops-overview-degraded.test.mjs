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
  return dom;
}

/* ---------------------------------------------------------- what is drawn */

/* The panel an operator is actually looking at. The loading and empty panels
   are siblings of it, so reading the whole region would read text nobody can
   see. */
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
  const described = two.map((b) => b.getAttribute('aria-describedby'));
  assert.ok(described.every(Boolean) && described[0] !== described[1],
    'two buttons both named "Try again" are on screen with nothing telling them apart: '
    + `described by ${JSON.stringify(described)}`);
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
   change a test edit, and the defect is emptiness, not wording. It sweeps
   rather than naming sites so a fifth reading added later is covered without
   anybody remembering to come back.

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
