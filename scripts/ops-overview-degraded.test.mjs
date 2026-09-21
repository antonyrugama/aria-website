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

/* The page ops/index.html builds, plus a rail: setBadge() writes onto a rail
   item and silently does nothing without one, so a badge assertion needs the
   item to exist before it can mean anything. */
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

/* The rail badge beside Problems, as the label it is actually showing. */
function railBadge(dom) {
  const badge = nodesWithClass(dom.doc.getElementById('rail'), 'nav-badge')[0];
  return badge ? allText(badge).trim() : null;
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
  /* The positive half again, and this one needs its own fixture: "Nothing is
     being checked" is a real and correct title when the rules read LANDS and
     says no rule is judging. It is a lie only when nobody could read them. */
  const unarmed = await boot({
    problems: { problems: [] },
    rules: { rules: [{ id: 'r1', name: 'Checkout latency', enabled: true }], channels: [] },
  });
  assert.equal(ribbonTitle(unarmed), 'Nothing is being checked',
    'the unarmed fixture did not reach the title this test is about');

  const down = await boot({ problems: { problems: [] }, rules: boom('rules') });
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

test('an unreadable queue puts no count beside Problems in the rail', async () => {
  const healthy = await boot();
  assert.equal(railBadge(healthy), '1',
    'the healthy render set no rail badge, so its absence proves nothing');

  const down = await boot({ problems: boom('problems') });
  assert.equal(railBadge(down), null,
    'the rail carried a count of problems this pane could not read');
});

test('the figures failure claims the problems are unaffected only when they are', async () => {
  const summaryOnly = await boot({ summary: boom('the summary') });
  assert.match(allText(livePanel(summaryOnly)), /read separately and are unaffected/,
    'the figures failure did not reach the sentence this test is about');

  const both = await boot({ summary: boom('the summary'), problems: boom('problems') });
  assert.doesNotMatch(allText(livePanel(both)), /read separately and are unaffected/,
    'the pane told the operator their problems were fine while saying it could not read them');
});
