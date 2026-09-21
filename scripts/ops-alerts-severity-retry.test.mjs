/* Two operator-facing defects on the Problems pane, bound on the rendered DOM.

   Stadiora/Aria#10630 — the severity pill printed whatever the answer put in
   `severity`, through an unguarded lookup on a plain object literal. An absent
   severity drew a pill with NO TEXT (shell-pane-v2.js:97 skips textContent
   when `opts.text` is undefined), and a severity of `constructor` printed
   `function Object() { [native code] }` onto the screen, because
   `SEVERITY_LABEL['constructor']` is `Object`. The Overview pane was hardened
   for this in #10393 and this one was not, and the two panes disagreeing
   during one incident is its own defect.

   Stadiora/Aria#10760 — `failedBand()` built every per-section retry as a bare
   `text: 'Try again'`, so a screen reader's control list -- which enumerates
   by NAME -- was told the action and never its object. The issue's "three at
   once" count does NOT reproduce, and the tests below say why where they sit:
   `render()` treats two failed reads as the whole pane unreadable, so two
   section retries can never share a screen. What reproduces is the name.

   What makes these bind behaviour rather than strings:

     - Every severity assertion reads the pill INSIDE the card for a named
       reference, so it cannot be satisfied by some other pill on the page, and
       the three expected words come from #10630's own table rather than from
       `SEVERITY_LABEL`. An expectation computed from the map under test moves
       with the mutation.

     - The `[native code]` sweep is byte-checked against the render path. A
       sweep that reached nothing looks identical to a sweep that found nothing,
       so the same render that must not contain `[native code]` is first
       required to contain all three hostile titles AND the literal word
       `constructor`. If the payload never reached the screen, that check fails
       before the absence check can pass for the wrong reason.

     - Every accessible name is RESOLVED, never compared as an attribute
       string. `aria-labelledby` is split on whitespace, each id is looked up,
       and the assertion is on the concatenated TEXT. A dangling reference is a
       name of nothing, and comparing the attribute would pass on two buttons
       pointing at ids that do not exist.

       There are TWO resolvers and they differ on purpose. `accessibleName()`
       requires exactly one element per id, so an ambiguous reference is an
       error rather than an answer. `browserName()` takes the first element in
       document order and says nothing about a second, because that is what
       `getElementById` does, and the one test about two panels being in the
       document at once needs the browser's answer rather than a complaint --
       the defect there is a name that says the WRONG thing, not a name that
       cannot be computed.

   NOT COVERED here, deliberately:

     - Whether a screen reader actually announces the composed name. That is
       the user agent's accessible-name computation, not this repo's; what is
       testable is that the references resolve and that the resolved text is
       what AccName's rules make of this markup.

     - Most of AccName. `nameText()` implements TWO of its rules --
       `aria-hidden` subtrees contribute nothing, and `aria-label` replaces
       contents -- because those are the two this pane's markup can turn and
       both were demonstrated wrong here in round 3 of the review. `title`,
       form-control values, `::before` content and the embedded-control
       recursion are NOT modelled, so a change that reached for one of those
       would pass here and be wrong in a browser.

       What closes the gap for the markup as shipped is a check the browser
       answers, not this one. `Accessibility.getFullAXTree` over the real pane
       in Chromium names the two retries "Try again The rules could not be
       read" and "Try again reading AO-118", which is what the assertions
       below say -- and under each of round 3's two mutations Chromium's
       answer moves exactly the way this model's does. That probe is in the
       PR, not in the repo: the Chrome-driven guards and their workflows are
       another agent's files this week.

     - The shell's whole-pane retry, which `region.failed()` draws when BOTH
       reads fail. It is the only control on that panel, it is not
       `failedBand()`'s, and `shell-pane-v2.js` is not this pane's to change.

     - Anything about the pill's COLOUR. `SEVERITY_PILL[tone]` already falls
       back for every hostile key (an object built-in makes `tone` a function,
       and a function used as a key misses), so there was nothing to fix and
       nothing here asserts a class. */
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
const PANE_SRC = read('assets/pane-alerts.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const MINUTE = 60000;
const at = (ago) => new Date(Date.now() - ago).toISOString();

/* ------------------------------------------------------------- fixtures */

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

function rulesFixture() {
  return {
    rules: [{
      ruleKey: 'ai_success_rate', title: 'AI success rate', category: 'ai_reliability',
      categoryLabel: 'AI reliability', severity: 'critical', enabled: true,
      threshold: 'below 95% for 10m', scopeLabel: 'Aria (athletes)',
      lastEvaluatedAt: at(MINUTE), lastFiredAt: at(45 * MINUTE),
    }],
    evaluatedAt: at(MINUTE), coverage: { evaluated: 1, total: 1 },
  };
}

/* The three payloads from #10630's table, as the route can send them: a
   severity outside the three this pane knows, a record with no severity field
   at all, and one naming an object built-in. The third is the only one that
   separates a checked lookup from a bare `SEVERITY_LABEL[x] || x` — a fixture
   of ordinary words cannot tell those apart.

   AO-4 is not in #10630's table and is here because the fix has a second
   `textOf()` in it that the table's three payloads cannot reach. A severity
   column holding whitespace is an ordinary thing for a text column to hold,
   and it lands on defect 1's symptom by a different route: `'   ' || 'Unknown'`
   is truthy, so a pill of three spaces is a blank chip again. */
function hostileSeverities() {
  const absent = problem({ id: 'p2', reference: 'AO-2', title: 'Field absent' });
  delete absent.severity;
  return [
    problem({ id: 'p1', reference: 'AO-1', severity: 'notice', title: 'Unrecognised word' }),
    absent,
    problem({ id: 'p3', reference: 'AO-3', severity: 'constructor', title: 'Object built-in' }),
    problem({ id: 'p4', reference: 'AO-4', severity: '   ', title: 'Nothing but spaces' }),
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

/* Loads the page the way ops/alerts.html loads it. `open` and `rules` take an
   Error to make that read fail. */
async function boot(options) {
  const opts = options || {};
  const answers = {
    open: opts.open === undefined ? { problems: [problem()] } : opts.open,
    closed: opts.closed === undefined ? { problems: [] } : opts.closed,
    rules: opts.rules === undefined ? rulesFixture() : opts.rules,
    detail: opts.detail === undefined
      ? { runbook: [], timeline: [], ruleHistory: [] } : opts.detail,
  };

  const dom = makeDom({
    tokens: TOKENS, href: 'https://ops.example.invalid/ops/alerts.html',
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  function answerFor(endpoint, o) {
    if (endpoint === '/api/ops/alerts/rules') return answers.rules;
    if (endpoint === '/api/ops/alerts/problems') {
      return (o && o.query && o.query.status === 'closed') ? answers.closed : answers.open;
    }
    if (endpoint.indexOf('/api/ops/alerts/problems/') === 0) return answers.detail;
    return undefined;
  }

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      const answer = answerFor(endpoint, o);
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-alerts.js' });

  for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r));

  /* `answers` is handed back live so a test can repair a read BETWEEN loads
     and then use a real control on the page to make the pane ask again. Without
     it a retry can only be asserted to exist, not to do anything -- which is
     how a button wired to a no-op stays green. */
  return Object.assign(dom, { answers });
}

const boom = (what) => new Error('the ' + what + ' read failed');

/* ---------------------------------------------------------- reading it */

const hasClass = (node, name) =>
  String(node.className || '').split(/\s+/).indexOf(name) !== -1;

const nodesWithClass = (root, name) => findAll(root, (n) => hasClass(n, name));

/* The panel showing. `region.empty()` fills a DIFFERENT box from
   `region.show()` and `region.degraded()`, so a test that always reads the
   live one reads '' for an empty render and would pass every absence
   assertion here for the wrong reason. */
function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once, so "what the operator sees" `
    + 'is not a single answer and nothing below means what it says');
  return boxes[0];
}

/* The one problem card carrying a given reference, found by its own text
   rather than by position, so reordering the fixture cannot silently change
   which card an assertion is about. */
function cardFor(dom, reference) {
  const cards = nodesWithClass(shownPanel(dom), 'p-head')
    .filter((n) => allText(n).indexOf(reference) !== -1);
  assert.equal(cards.length, 1,
    `${cards.length} problem heads carry ${reference}; the pill read below would be `
    + 'ambiguous or absent');
  return cards[0];
}

/* The severity pill inside one card: the first `pill` that is not the
   reference chip and not one of the live-condition chips. Those carry their
   own extra classes, so this asks for a plain `pill <tone>` and asserts there
   is exactly one. */
function severityPill(dom, reference) {
  const head = cardFor(dom, reference);
  const pills = nodesWithClass(head, 'pill').filter((n) => {
    const classes = String(n.className || '').split(/\s+/);
    return classes.indexOf('ghost') === -1 && classes.indexOf('p-live') === -1;
  });
  assert.equal(pills.length, 1,
    `${reference} has ${pills.length} candidate severity pills, so the text read below `
    + 'does not identify one element');
  return allText(pills[0]).trim();
}

/* Every control on screen whose visible word is "Try again" -- including the
   record-detail retry, whose own `sr` span adds " reading AO-118" after it.
   The count is what the render produced; nothing here says how many there
   should be. */
function retryButtons(dom) {
  return findAll(shownPanel(dom),
    (n) => n.tagName === 'BUTTON' && /^Try again\b/.test(allText(n).trim()));
}

/* The text a subtree contributes to an accessible NAME, which is not the text
   it contains. Two rules out of AccName, and only two, because these are the
   two the markup in this pane can actually turn:

     - an `aria-hidden="true"` subtree contributes NOTHING. `allText()` reads
       it, so a name built out of `allText()` certifies text the browser does
       not speak. Round 3 of the review proved it: adding `aria-hidden` to the
       record retry's `sr` span leaves the name in the DOM and takes it out of
       the accessibility tree, and Chromium then names that button `Try again`
       -- the exact defect #10760 is about, restored, while the suite stayed
       green.

     - an `aria-label` REPLACES the element's contents rather than adding to
       them. Same shape: `aria-label="Retry"` on the button makes Chromium say
       `Retry ...` while the visible word is still "Try again", which is the
       failure `nameRetry()` exists to avoid.

   Everything else AccName does -- `title`, form controls, `::before` content,
   the recursion rules for embedded controls -- is NOT here and is listed as
   not covered above. This is a subset chosen to match the markup, not an
   implementation of the spec. */
function nameText(node) {
  if (!node) return '';
  if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return '';
  const label = node.getAttribute && node.getAttribute('aria-label');
  if (label && String(label).trim()) return String(label).trim();
  const own = node.textContent || '';
  const kids = (node.childNodes || []).map(nameText).join(' ');
  return (own + ' ' + kids).replace(/\s+/g, ' ').trim();
}

/* The name a control actually carries into a screen reader's control list:
   aria-labelledby when it is there, otherwise aria-label, otherwise the
   control's own contents.

   Every referenced id is LOOKED UP and must exist exactly once, and the answer
   is the concatenated NAME TEXT of the elements found. Comparing the attribute
   string instead would accept two buttons naming ids that do not exist --
   which is a name of nothing, twice.

   The self-reference in `aria-labelledby` is the button itself, and AccName
   consults that element's `aria-label` when it gets there even though it will
   not follow its `aria-labelledby` a second time. `nameText()` does the same,
   which is why an `aria-label` slipped onto the button turns the composed name
   red here rather than only in Chromium. */
function accessibleName(dom, button) {
  const refs = String(button.getAttribute('aria-labelledby') || '').trim();
  if (!refs) return nameText(button);
  return refs.split(/\s+/).map((id) => {
    const found = dom.doc.querySelectorAll(`[id="${id}"]`);
    assert.equal(found.length, 1,
      `aria-labelledby names id "${id}" and ${found.length} elements carry it, so the `
      + 'composed name is a name of nothing');
    return nameText(found[0]);
  }).join(' ').trim();
}

/* The section retries specifically: the ones `failedBand()` draws. Identified
   by carrying a composed name at all, which is what this change adds. */
const sectionRetries = (dom) =>
  retryButtons(dom).filter((b) => b.getAttribute('aria-labelledby'));

/* Every named retry in the WHOLE document, shown or not. The shell keeps its
   panels rather than swapping them -- `region.empty()` fills one box and
   `region.degraded()` fills another, and neither clears the other -- so a
   control drawn on a render the operator has moved past is still in the
   document, still holding its ids. Reading only the shown panel cannot see
   that, and id collisions live exactly there. */
const allNamedRetries = (dom) => findAll(dom.doc.body,
  (n) => n.tagName === 'BUTTON'
    && /^Try again\b/.test(allText(n).trim())
    && n.getAttribute('aria-labelledby'));

/* The name the BROWSER would compose, which is not quite the one
   `accessibleName()` asserts: `getElementById` takes the first element in
   document order and says nothing about a second one carrying the same id.
   That difference is the whole point where two panels are in the document at
   once, so this resolver reproduces it rather than rejecting it. */
function browserName(dom, button) {
  return String(button.getAttribute('aria-labelledby')).trim().split(/\s+/)
    .map((id) => {
      const found = dom.doc.getElementById(id);
      return found ? nameText(found) : '';
    }).join(' ').trim();
}

const within = (node, ancestor) => {
  for (let n = node; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
};

async function settle(n) {
  for (let i = 0; i < (n || 14); i += 1) await new Promise((r) => setImmediate(r));
}

function buttonWithText(dom, text) {
  const found = findAll(shownPanel(dom),
    (n) => n.tagName === 'BUTTON' && allText(n).trim().indexOf(text) === 0);
  assert.equal(found.length, 1, `${found.length} controls read "${text}"`);
  return found[0];
}

/* -------------------------------------------------- #10630, the severity */

/* #10630's table, as its own statement of what the screen should read. Written
   here rather than computed from SEVERITY_LABEL: an expectation derived from
   the map under test moves with the mutation and agrees with itself. */
const EXPECTED_PILLS = [
  ['AO-1', 'notice'],
  ['AO-2', 'Unknown'],
  ['AO-3', 'constructor'],
  ['AO-4', 'Unknown'],
];

test('every severity the route can send prints as a word', async () => {
  const dom = await boot({ open: { problems: hostileSeverities() } });

  for (const [reference, word] of EXPECTED_PILLS) {
    assert.equal(severityPill(dom, reference), word,
      `${reference}'s severity pill reads something other than "${word}"`);
  }
});

test('a record with no severity field is not a blank chip', async () => {
  const dom = await boot({ open: { problems: hostileSeverities() } });

  /* The specific shape of defect 1: the pill rendered, and had nothing in it.
     An operator was shown an empty chip and told nothing was missing. */
  assert.notEqual(severityPill(dom, 'AO-2'), '',
    'the pill for a record with no severity is on screen with no text in it');
  /* The same symptom by the other route: a severity of whitespace is truthy,
     so an unguarded fallback prints it and the chip is blank again. */
  assert.notEqual(severityPill(dom, 'AO-4'), '',
    'the pill for a whitespace severity is on screen with no text in it');
});

test('a severity naming an object built-in does not put JavaScript on screen', async () => {
  const dom = await boot({ open: { problems: hostileSeverities() } });
  const screen = allText(shownPanel(dom));

  /* Byte-check before the absence check. A sweep that never reached the
     hostile render looks exactly like a sweep that found it clean, so this
     first requires the three payloads to BE on the screen. `constructor` is
     required as a literal because that is what the pane should now print for
     AO-3 — if it printed nothing, or `Unknown`, the absence below would pass
     while the record was silently dropped. */
  for (const title of ['Unrecognised word', 'Field absent', 'Object built-in',
    'Nothing but spaces']) {
    assert.ok(screen.indexOf(title) !== -1,
      `"${title}" never reached the screen, so the sweep below reads a render that `
      + 'does not contain the payload it is named for');
  }
  assert.ok(screen.indexOf('constructor') !== -1,
    'the word `constructor` is not on screen at all, so the sweep below proves nothing');

  assert.doesNotMatch(screen, /\[native code\]/,
    'the pane printed the source of a JavaScript function onto the operator\'s screen');
  assert.doesNotMatch(screen, /function\s+Object\s*\(/,
    'the pane printed a JavaScript function onto the operator\'s screen');
});

/* The Overview pane is the other half of the same incident, and #10630 is
   about the two disagreeing. This compares the two panes' answers to ONE
   payload rather than trusting that both files happen to say "Unknown". */
test('Problems and Overview give one word for one state', async () => {
  const dom = await boot({ open: { problems: hostileSeverities() } });

  const ovSrc = read('assets/pane-overview.js');
  const words = /function severityWords\(severity\) \{\s*return ([^;]+);/.exec(ovSrc);
  assert.ok(words, 'pane-overview.js no longer has a severityWords() to agree with');

  /* Overview's own `textOf()`, lifted from its own source rather than
     rewritten here. Typing a copy of it would make this test agree with
     itself: Overview could stop guarding the lookup entirely and the local
     copy would keep answering the way the fixed file used to. */
  const ovTextOf = /function textOf\(value\) \{\s*return ([^;]+);/.exec(ovSrc);
  assert.ok(ovTextOf, 'pane-overview.js no longer has a textOf() to run');

  /* And Overview's `model` is `global.OpsAlertsModel` -- the same
     alerts-model.js this pane loaded, taken from the booted window rather
     than transcribed, so a change to the shared label map is a change to
     both sides of the comparison.

     Sharing the map does NOT make the two panes agree, and an earlier draft
     of this comment said it did. They normalise differently: put `'   '` in
     the map as the label for `notice` and this pane answers `notice` while
     Overview answers three spaces, and this test goes red on it. What is out
     of scope here is arbitrary edits to the map, which is a choice about how
     wide to make the fixture -- not an impossibility. M14 is the mutation
     this does bind: dropping Overview's guard on the label lookup. */
  const ovModel = dom.window.OpsAlertsModel;
  assert.ok(ovModel && ovModel.SEVERITY_LABEL,
    'alerts-model.js no longer publishes the label map both panes look in');

  /* Run Overview's own expression, over Overview's own textOf and the shared
     label map, against the same severities — so this compares BEHAVIOUR, not
     two copies of a sentence. */
  const overview = vm.runInNewContext(
    `(function (model, textOf) { return function (severity) { return ${words[1]}; }; })`,
    {},
  )(ovModel, vm.runInNewContext(`(function (value) { return ${ovTextOf[1]}; })`, {}));

  /* #10630's three tabulated payloads only. AO-4 is deliberately not here:
     this pane's textOf() TRIMS and Overview's does not, so the two answer
     differently for any severity with surrounding whitespace -- `'   '` reads
     "Unknown" here and as a blank prefix there, and `' critical '` reads
     `critical` here and ` critical ` there. Asserting agreement on those
     would be asserting something untrue. It is an Overview defect, filed as
     Stadiora/Aria#10799 rather than fixed from a PR that does not own that
     pane. */
  const severities = { 'AO-1': 'notice', 'AO-2': undefined, 'AO-3': 'constructor' };
  for (const [reference, severity] of Object.entries(severities)) {
    assert.equal(severityPill(dom, reference), overview(severity),
      `the two panes print different words for severity ${String(severity)} during one `
      + 'incident');
  }
});

/* ----------------------------------------------------- #10760, the names */

/* What #10760 says, and what the pane can actually reach.

   The issue describes THREE retries called "Try again" at once. That count
   does not reproduce, and saying so is part of the fix. `render()` short-
   circuits: two failed reads are the whole pane unreadable
   (`pane-alerts.js:413`, `region.failed()`), so the two `failedBand()` retries
   can never be on screen together, and the third call site is inside
   `emptyState()`, which fills a different panel from the live one.

   What DOES reproduce is the defect under the count. One section retry is
   reachable in three different states, its accessible name was the single
   word "Try again" in all three, and nothing in it said which read had
   failed. It can also share a screen with the record-detail retry, which
   already names its own object. So the assertions below are about what the
   name SAYS, and the multi-control case they are motivated by is the one the
   pane can really draw.

   The issue proposes aria-describedby. That is superseded by what PR #98
   actually shipped on Overview after trying it: a description is announced on
   focus, and the lists that enumerate controls read NAMES. */

/* The two headlines the pane writes for these two reads, and the fixture that
   makes each one the only failure. Stated here as the contract rather than
   read back out of the render, so a render that stopped saying which read
   failed cannot satisfy these by agreeing with itself. */
const SECTION_FAILURES = [
  ['The problems could not be read', () => ({ open: boom('problems') })],
  ['The rules could not be read', () => ({ rules: boom('rules') })],
];

test('a section retry names the read that failed', async () => {
  const seen = [];
  for (const [headline, fixture] of SECTION_FAILURES) {
    const dom = await boot(fixture());
    const retries = sectionRetries(dom);
    assert.equal(retries.length, 1,
      `${retries.length} section retries are on screen for "${headline}", so the name `
      + 'read below does not identify one control');
    const name = accessibleName(dom, retries[0]);
    assert.ok(name.indexOf(headline) !== -1,
      `the retry for "${headline}" is called ${JSON.stringify(name)}, which does not say `
      + 'which section is missing');
    seen.push(name);
  }

  /* The other half: the name is composed per section, not one constant that
     happens to contain a headline. Hard-coding either sentence into
     failedBand() would pass the loop above on one state and fail here. */
  assert.equal(new Set(seen).size, seen.length,
    `both failure states name their retry ${JSON.stringify(seen)}, which is the same name `
    + 'for two different missing sections');
});

test('a section retry and a record retry do not read as one control twice', async () => {
  /* The multi-control state the pane can really reach: the rules read failed,
     so the live panel carries a section retry, and a record whose detail read
     also failed carries its own. Two controls, both visibly "Try again". */
  const dom = await boot({ rules: boom('rules'), detail: boom('detail') });
  assert.equal(retryButtons(dom).length, 1, 'the rules failure did not draw its retry alone');

  buttonWithText(dom, 'Details').dispatch('click');
  await settle();

  const retries = retryButtons(dom);
  assert.equal(retries.length, 2,
    `${retries.length} controls read "Try again" after the detail read failed, so this is `
    + 'not the two-control state the test is named for');

  const names = retries.map((b) => accessibleName(dom, b));
  assert.equal(new Set(names).size, names.length,
    `a control list reads ${JSON.stringify(names)}, which is the same name twice`);
  assert.equal(names.filter((n) => n.indexOf('The rules could not be read') !== -1).length, 1,
    'neither name says the rules are the thing that could not be read');

  /* And the other one names ITS object: the record it re-reads. Asserting
     only that the two differ would pass on a bare "Try again" beside a named
     section retry -- two different strings, one of which still says nothing.
     That control's `sr` span predates this change and nothing else in the
     repo binds it; round 2 of the review proved that by deleting the span and
     watching the whole suite stay green. */
  const record = names.filter((n) => n.indexOf('The rules could not be read') === -1);
  assert.equal(record.length, 1, 'the record retry is not one control');
  assert.equal(record[0], 'Try again reading AO-118',
    `the record retry is called ${JSON.stringify(record[0])}, which does not say which `
    + 'record it re-reads');
});

test('the visible word stays the first token of the composed name', async () => {
  const dom = await boot({ rules: boom('rules') });

  /* Voice control says the word it can see. aria-label would have replaced
     it; aria-labelledby beginning with the button's own id keeps it. */
  for (const button of sectionRetries(dom)) {
    const first = String(button.getAttribute('aria-labelledby')).trim().split(/\s+/)[0];
    assert.equal(first, button.getAttribute('id'),
      'the composed name does not start with the button itself, so the word the operator '
      + 'can see is not the start of the name they can say');
    assert.match(accessibleName(dom, button), /^Try again\b/,
      'the composed name does not begin with the visible word');
  }
});

test('a retry drawn on the empty panel is named too', async () => {
  /* The third `failedBand()` call site is in `emptyState()`, which fills a
     different panel from the live one. One retry, and it is the only control
     there, so an unnamed one here is a hole the tests above cannot see. */
  const dom = await boot({ open: { problems: [] }, rules: boom('rules') });
  assert.equal(shownPanel(dom).getAttribute('data-state'), 'empty',
    'the fixture did not reach the empty panel, so this is not the call site described');

  const retries = sectionRetries(dom);
  assert.equal(retries.length, 1,
    `the empty panel drew ${retries.length} named retries, not the one this test is about`);
  assert.ok(accessibleName(dom, retries[0]).indexOf('The rules could not be read') !== -1,
    'the empty panel\'s retry does not name the read that failed');
});

test('naming the retry did not stop it reading again', async () => {
  /* A name is worthless on a button that stopped working, and an id written
     onto a control is exactly the kind of change that can replace it. Press
     it with the read repaired and the section comes back. */
  const dom = await boot({ rules: boom('rules') });
  const retries = sectionRetries(dom);
  assert.equal(retries.length, 1, 'the failed render is not the one described');

  dom.answers.rules = rulesFixture();
  retries[0].dispatch('click');
  await settle(20);

  assert.equal(sectionRetries(dom).length, 0,
    'the rules read was repaired and the failed section is still on screen, so the retry '
    + 'is wired to nothing');
  assert.ok(allText(shownPanel(dom)).indexOf('The rules could not be read') === -1,
    'the pane still says the rules could not be read after a successful re-read');
});

test('a retry left on a panel the operator moved past does not take the visible one\'s name',
  async () => {
    /* The shell KEEPS its panels. `region.empty()` fills `emptyBox`,
       `region.degraded()` fills `liveBox`, and neither clears the other --
       only `data-shown` decides which one the operator sees. So a render that
       goes empty and then degraded leaves TWO `failedBand()` retries in the
       document, and the ids `nameRetry()` writes have to survive that.

       Reached with two real renders: nothing open and the rules unreadable is
       the empty panel, then the operator presses its own retry and this time
       the PROBLEMS read is the one that fails, which is the degraded panel.
       Two different sections, so the two names are different sentences and a
       name resolved off the wrong panel is a name that says the wrong thing
       -- not merely a duplicate id. */
    const dom = await boot({ open: { problems: [] }, rules: boom('rules') });
    assert.equal(shownPanel(dom).getAttribute('data-state'), 'empty',
      'the first render is not the empty panel, so the two-panel state below is not reached');

    dom.answers.open = boom('problems');
    dom.answers.rules = rulesFixture();
    sectionRetries(dom)[0].dispatch('click');
    await settle(20);

    const shown = shownPanel(dom);
    assert.equal(shown.getAttribute('data-state'), 'live degraded',
      'the second render is not the degraded panel, so only one panel has content');

    const retries = allNamedRetries(dom);
    assert.equal(retries.length, 2,
      `${retries.length} named retries are in the document, so the discarded panel did not `
      + 'keep its control and this test is not about the state it names');

    /* The expectation is the section that failed on THIS render, stated
       rather than read back off the control: the problems read is the one
       that broke, so the visible retry has to say so. Under a constant id it
       resolves to the discarded panel's heading, which still says the rules
       failed -- a true sentence about a render that is gone. */
    const visible = retries.filter((b) => within(b, shown));
    assert.equal(visible.length, 1,
      `${visible.length} of the named retries are on the shown panel`);
    assert.equal(browserName(dom, visible[0]), 'Try again The problems could not be read',
      'the retry the operator can see resolves its name off the wrong heading');

    for (const id of String(visible[0].getAttribute('aria-labelledby')).trim().split(/\s+/)) {
      assert.ok(within(dom.doc.getElementById(id), shown),
        `the visible retry names id "${id}", which resolves to an element on a panel the `
        + 'operator is not looking at');
    }
  });
