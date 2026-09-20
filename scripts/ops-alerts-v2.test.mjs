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
       landed is never allowed to claim there is nothing there;
     - the box the rules table scrolls inside carries its own tab stop and its
       own name, so the columns past its edge are not a pointer's alone;
     - and what the STYLESHEET's docblock claims about its own paint, which is
       prose about code and so is derived from the code instead.

   Every test here has a published mutation in the pull request: the exact file
   and the exact original line whose removal, inversion or insertion makes that
   test fail. A test with no such line pins nothing.

   NOT COVERED, deliberately and named rather than implied:

     - Layout. Nothing here measures anything, in any browser, at any width.
     - Every reader of the sheet. The line below enumerates the PREFIXED
       docblock lines, and PROSE_FRAMES_OVER_THE_SHEET the regex frames
       over its prose; what is not enumerated anywhere is the rest, the
       twenty-odd places this file reads the sheet's RULES through
       declarations(). Those are read as CSS, not as prose about CSS, so
       nothing they say can overclaim -- but no test counts them.
     - What the stylesheet LOOKS like. Nothing here renders it. The lines it
       reads as data are NON-TOKEN PAINT, AVATAR INK TOKEN, SAME FOCUS RING
       AS and DIFFERENT FOCUS RING; the rest of what THREE sections of this
       file read out of ops/assets/pane-alerts-v2.css is its text -- the
       claims around those lines, the two rules the rules table's scrolling
       box depends on, the .is- tone rules, the sheet's own custom
       properties, and every test title the sheet cites, each against the
       file it names. No rule below is rendered to decide any of it, and
       nothing here can see a colour as a pixel --
       scripts/check-ops-contrast.mjs is the tool that judges contrast, and
       it is not run from here.
     - Anything the operations API decides. The role checks below prove the
       pane draws a fact rather than a control that would be refused; the
       server enforces the same rules independently and is tested in the Aria
       monorepo.
     - That no value becomes markup. The test "the pane never spells
       innerHTML, outerHTML or insertAdjacentHTML" pins three spellings and
       nothing more; it is a prohibition, not a proof. It is not the last
       test in the file, which is what this line said until the third review
       of #75 read it -- and the title it then cited belonged to three OTHER
       suites, which the fourth review read. Citations in THIS file now carry
       the words `The test` before the quote and are resolved, the way the
       stylesheet's are.
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
       button (this pane's own, marked in place rather than rebuilt) and the
       range select (#fRange, which the SHELL draws and this pane never
       redraws) are each used with focus ON them, and asserted to still hold
       it. Two different mechanisms of survival, one assertion each; the
       second probe used to land on this pane's own #fCategory while the
       sentence around it claimed the shell's control (Stadiora/Aria#10460).

       The enumeration below is the part of this file a reader should distrust
       first. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import nodeTest from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

/* Every title this file registers, collected as it registers them rather
   than scraped out of the source. The stylesheet cites tests BY TITLE and
   says a claim naming one is thereby bound; a citation that stops resolving
   would leave the sentence around it reading as proven while nothing held it
   up, which is Stadiora/Aria#10632 in the device built to close it. The set
   is complete by the time any test BODY runs, because node:test registers
   every top-level test while the module evaluates. */
const TEST_TITLES = new Set();
const test = (name, ...rest) => {
  TEST_TITLES.add(name);
  return nodeTest(name, ...rest);
};

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const V1_SHELL_SRC = read('assets/shell.js');
const OPERATE_SRC = read('assets/operate.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-alerts.js');
const PANE_CSS = read('assets/pane-alerts-v2.css');
const ARIA_CSS = read('assets/aria.css');
const THIS_FILE = readFileSync(new URL(import.meta.url), 'utf8');

/* The PREFIXED docblock lines this file reads as DATA rather than as prose.
   Every reader OF A PREFIXED LINE goes through machineLine(), which refuses a
   prefix that is not listed, and the NOT COVERED bullet at the top of this
   file is checked against the list rather than counting them by hand -- it
   said "three" while four were read, and the fourth arrived in the same
   commit as the word three (found in the third review of
   antonyrugama/aria-website#75).

   It said "every reader" until the fourth review, which found that the next
   reader added after it was written -- the regex frame over the paint-stem
   sentence -- does not read a prefixed line and so cannot go through this.
   The other kind is enumerated separately, below. */
const MACHINE_READ_PREFIXES = [
  'NON-TOKEN PAINT', 'AVATAR INK TOKEN', 'SAME FOCUS RING AS', 'DIFFERENT FOCUS RING',
];
/* The OTHER way this file reads the sheet's docblock as data: a regex frame
   over a PROSE sentence, which has no prefix and so cannot go through
   machineLine(). Enumerated, because a test named for a class has to say
   which class. NO COUNT IS TYPED HERE, and that is deliberate: this comment
   said "two" while the list below held three, and the fifth review of #75
   showed the count was bound by nothing -- rewriting it to "seventeen" left
   the suite green, because only the list's LENGTH is ever read, never the
   word. A count in prose beside the list it counts is the overclaim this
   file exists to catch; the list is the count.

   The shape this catches is the whitespace-collapsing spelling below, which
   every frame needs, because the sheet's docblock is hard-wrapped and no
   sentence in it survives on one line. The shapes it MISSES: a frame written
   over the raw text with `[\s\S]` or `\s+` in the pattern instead, a frame
   over a copy taken before the collapse, and any reading of the sheet outside
   this file. */
/* Typed once, and checked against BOTH sides: the declaration below must
   really be called this, and the NOT COVERED bullet must really point at it.
   Found by my own round-6 battery -- dropping the name from the bullet left
   the suite green, so the pointer was prose like any other. */
const FRAMES_LIST_NAME = 'PROSE_FRAMES_OVER_THE_SHEET';
const PROSE_FRAMES_OVER_THE_SHEET = [
  'the paint stems the reader has',
  'the stemless properties a keyword walks past on',
  'the double-quoted test titles the sheet cites',
];
const FRAME_SPELLING = /PANE_CSS\.replace\(\/\\s\+\/g, ' '\)/g;

const machineLine = (prefix, tail = '(.*)') => {
  assert.ok(MACHINE_READ_PREFIXES.includes(prefix),
    prefix + ' is read as data but is not on MACHINE_READ_PREFIXES');
  return new RegExp('^\\s*' + prefix + ':' + tail + '$', 'm');
};

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

/* What can take a tab stop, as far as the document ITSELF can say.

   This helper answered seven cases wrong (Stadiora/Aria#10633) because the
   tabindex branch ran ahead of both the disabled check and the tag check and
   because Number('') is 0. Order is most of it: `disabled` beats tabindex,
   `tabindex="-1"` asks to be OUT of the tab order, and a tabindex whose value
   has no leading digits is IGNORED by the parser.

   Two independent reviews have found more since, and a third more again; all
   of them are rows of FOCUSABLE_PROBES marked FOUND IN REVIEW, and how many
   is printed beside the table rather than typed here -- typing it here is
   how this sentence came to say five and six while the table said six and
   eight.
   What the two rounds between them corrected: tabindex is fed through HTML's
   rules for parsing INTEGERS rather than validated, and a parsed value
   outside the range of a long is an error just as a missing digit is; only
   the OUTERMOST editing host takes a stop, and it is decided before href; an
   <input type="hidden"> takes none; a <details> takes its first <summary>
   CHILD rather than its first child, and one with no <summary> at all is the
   agent's business rather than this helper's.

   Every answer below is a row of FOCUSABLE_PROBES, which runs this helper
   against the case and compares it with a typed expectation. FOCUSABLE_PROBES
   is this helper's TEST surface, and saying it is the helper's whole surface
   would be the claim this file exists to stop making: two review rounds each
   found answers no row covered, and each time the row came after the finding.
   What it cannot decide it REFUSES by throwing, rather than guessing: a wrong
   answer from a guard is worse than no guard.

   NOT MODELLED, and answered anyway rather than refused, because none of it
   is legible from ONE node's markup: focusability that CSS decides
   (display: none, visibility: hidden), shadow DOM, and Chrome's extra tab
   stop for a scrollable box that contains nothing focusable, which Safari
   does not grant. The rules table depends on none of them: it carries its
   own tabindex.

   That sentence used to read "none of it is legible from the markup", which
   was false of a fourth case it was covering: a radio group's one stop IS
   decided by type, name and checked. The fourth review of #75 measured four
   members this helper called tab stops that Chrome gives none to. A NAMED
   radio is now refused rather than answered -- at any tabindex, a
   non-negative one included, which the fifth review found still answered --
   because the group is the owner form's business and not one node's; an
   unnamed one is answered. */
const FOCUSABLE_TAGS = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
const DISABLEABLE_TAGS = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET', 'OPTGROUP', 'OPTION'];
const HREF_TAGS = ['A', 'AREA'];
const MEDIA_TAGS = ['AUDIO', 'VIDEO'];
/* Whether these take a tab stop depends on the resource they load, their
   fallback content and the browser, so the helper says it cannot tell
   instead of answering -- but only where that is still what decides it.
   hidden, inert and a negative tabindex take the element out whatever it
   loads and are answered above the refusal; a NON-negative tabindex does not
   put it back and is answered below it. */
const UNDECIDABLE_TAGS = ['OBJECT', 'EMBED'];

const attr = (node, name) =>
  (node.hasAttribute && node.hasAttribute(name) ? String(node.getAttribute(name) ?? '') : null);

const isDisabled = (node) =>
  DISABLEABLE_TAGS.includes(node.tagName) && (node.disabled === true || attr(node, 'disabled') !== null);

/* The parser's own reading of tabindex, which is HTML's RULES FOR PARSING
   INTEGERS and not the attribute's conformance requirement: skip ASCII
   whitespace, take an optional sign, collect the LEADING digits and ignore
   whatever follows. Two things make it an error -- no leading digits at all,
   and a result outside the range of a long, which is exactly the 32-bit
   signed range -- and on either the element sits where it would have without
   the attribute at all.

   So '' and '  ' and 'yes' are ignored, but '1.5' is 1 and '12abc' is 12 --
   both real tab stops, which /^[+-]?\d+$/ called invalid. And '2147483648'
   is ignored while '2147483647' is a stop, so a <button tabindex="-3e9">
   keeps the stop its tag gives it rather than losing one it never had. */
const TAB_INDEX_MIN = -2147483648;
const TAB_INDEX_MAX = 2147483647;
const tabIndexOf = (node) => {
  const raw = attr(node, 'tabindex');
  if (raw === null) return null;
  const body = raw.replace(/^[ \t\n\f\r]+/, '');
  if (!/^[+-]?\d/.test(body)) return null;
  const value = Number.parseInt(body, 10);
  if (!Number.isFinite(value) || value < TAB_INDEX_MIN || value > TAB_INDEX_MAX) return null;
  return value;
};

/* hidden and inert take a whole subtree out of the tab order, so an ancestor
   carrying either answers for everything under it. A disabled <fieldset>
   does the same to its controls EXCEPT those inside its first <legend>, and
   that exception is the kind of thing this helper would get wrong, so a
   descendant of one is refused rather than answered. */
const suppressedBy = (node) => {
  for (let at = node; at && at.nodeType === 1; at = at.parentNode) {
    if (attr(at, 'hidden') !== null || attr(at, 'inert') !== null) return 'hidden';
    if (at !== node && at.tagName === 'FIELDSET' && isDisabled(at)) return 'fieldset';
  }
  return null;
};

/* An EDITING HOST is an element whose OWN contenteditable is in the true or
   plaintext-only state AND whose nearest such ancestor is none: a host nested
   inside a host is editable CONTENT of the outer one, and Chrome's tab ring
   gives the stop to the outer only. A contenteditable="false" between them
   breaks the chain, and the inner one is a host again. 'inherit' and any
   unrecognised value state nothing either way. */
const ownEditable = (node) => {
  const value = attr(node, 'contenteditable');
  if (value === null) return null;
  const word = value.trim().toLowerCase();
  if (word === 'false') return false;
  if (word === '' || word === 'true' || word === 'plaintext-only') return true;
  return null;
};

const editable = (node) => {
  if (ownEditable(node) !== true) return false;
  for (let at = node.parentNode; at && at.nodeType === 1; at = at.parentNode) {
    const own = ownEditable(at);
    if (own === true) return false;
    if (own === false) return true;
  }
  return true;
};

/* An <input type="hidden"> is not rendered at all, so it takes no tab stop
   even carrying tabindex="0". Markup decides this one, not the sheet. */
const hiddenInput = (node) =>
  node.tagName === 'INPUT' && (attr(node, 'type') || '').trim().toLowerCase() === 'hidden';

function focusable(node) {
  if (node.nodeType !== 1) return false;
  const suppressed = suppressedBy(node);
  if (suppressed === 'fieldset') {
    throw new Error('focusable() cannot tell: a descendant of a disabled <fieldset> is '
      + 'disabled unless it is inside that fieldset\'s first <legend>');
  }
  if (suppressed) return false;
  if (isDisabled(node)) return false;
  if (hiddenInput(node)) return false;

  const index = tabIndexOf(node);
  /* A NEGATIVE tabindex is an answer for any tag, so it is taken before the
     <object>/<embed> refusal below: hidden, inert, disabled and tabindex="-1"
     all take the element out whatever it loads, and refusing them was this
     helper saying "cannot tell" about cases the document settles (found in
     the third review of antonyrugama/aria-website#75). A NON-negative one is
     NOT an answer for those two tags, so it stays below. Measured: bare
     <object tabindex="0"> takes no stop, the SAME element with a loaded
     data= takes one, and empty <div tabindex="0"> takes one -- so answering
     the non-negative case from the attribute would be wrong half the time,
     which is worse than refusing it. */
  if (index !== null && index < 0) return false;
  if (UNDECIDABLE_TAGS.includes(node.tagName)) {
    throw new Error('focusable() cannot tell: <' + node.tagName.toLowerCase()
      + '> takes a tab stop in some browsers and not others');
  }
  /* A radio GROUP takes one sequential tab stop between all its members --
     the checked member, or the first member in tree order when none is
     checked -- and every other member takes none. Which members are in the
     group is decided by the owner FORM (two forms are two groups, and a
     form= attribute can put a radio in a form it does not sit inside), so a
     single node cannot answer it. This helper said `true` for every member
     until the fourth review of #75 measured Chrome. An UNNAMED radio, or one
     with name="", is in no group at all and always takes its own stop --
     measured, not assumed -- so it is answered rather than refused.
     ABOVE the non-negative tabindex branch, which is where the fifth review
     of #75 found it still answering: a tabindex does not take a radio out of
     its group, it only moves where the group's one stop sits in the order.
     Measured, same ring walk: name=g unchecked WITH a checked sibling takes
     no stop at tabindex=1 or 2, while the same markup with NO checked member
     takes the stop at tabindex=1 or 2. One node's markup is identical across
     that pair, so no attribute on it can decide the answer. A NEGATIVE
     tabindex still answers false above this: that one is out of the ring
     whatever the group does. */
  if (node.tagName === 'INPUT' && (attr(node, 'type') || '').toLowerCase() === 'radio'
    && attr(node, 'name')) {
    throw new Error('focusable() cannot tell: a radio group takes one tab stop between all '
      + 'its members, and which members are in the group is decided by the owner form');
  }
  if (index !== null) return index >= 0;

  /* Before the href branch: an <a contenteditable> with no href is an editing
     host and a real tab stop, which asking about href first answers wrong. */
  if (editable(node)) return true;
  /* An <area> is a stop only when a RENDERED <img usemap> uses the <map> it
     sits in -- a fact about the rest of the document, not about the node --
     so a linked one is refused. One with no href is never a stop anywhere. */
  if (node.tagName === 'AREA') {
    if (attr(node, 'href') === null) return false;
    throw new Error('focusable() cannot tell: an <area href> takes a tab stop only where a '
      + 'rendered <img usemap> uses its <map>');
  }
  if (HREF_TAGS.includes(node.tagName)) return attr(node, 'href') !== null;
  if (node.tagName === 'IFRAME') return true;
  if (MEDIA_TAGS.includes(node.tagName)) return attr(node, 'controls') !== null;
  /* A <details> with NO <summary> child is given one by the user agent, and
     whether that supplied control takes a stop is the agent's business, so
     this one is refused too. With a <summary>, the <summary> is the stop and
     the <details> is not. */
  if (node.tagName === 'DETAILS') {
    if (Array.from(node.children).some((child) => child.tagName === 'SUMMARY')) return false;
    throw new Error('focusable() cannot tell: a <details> with no <summary> child is given '
      + 'one by the user agent');
  }
  /* A <details> takes its FIRST <summary> CHILD as its disclosure control --
     not its first child, and not a <summary> nested deeper. Any other
     <summary> is ordinary text. */
  if (node.tagName === 'SUMMARY') {
    const parent = node.parentNode;
    if (!parent || parent.tagName !== 'DETAILS') return false;
    return Array.from(parent.children).find((child) => child.tagName === 'SUMMARY') === node;
  }
  return FOCUSABLE_TAGS.includes(node.tagName);
}

/* ====================== focusable(), against cases ===================== */

/* Guard code is code. Every row is a case a browser has a definite answer
   for, or -- for the rows marked `cannot tell` -- one this helper will not
   guess at. `answer` is typed here from the HTML standard's own rules and
   never read back out of the helper, and every row was then enumerated
   against Chrome's real sequential focus ring, walked to completion rather
   than by one Tab press, because a positive tabindex forms its own group
   ahead of document order. That enumeration is published on
   antonyrugama/aria-website#75 and is NOT re-run by this suite: what runs
   here is the typed column.

   The rows marked WAS WRONG are the ones Stadiora/Aria#10633 enumerated. The
   rows marked FOUND IN REVIEW are the ones two rounds of independent review
   of the fix for those found still wrong. Both are counted below the table
   rather than here, so a count and its rows cannot come apart. */
const FOCUSABLE_PROBES = [
  { name: '<button>', tag: 'button', answer: true },
  { name: '<button disabled>', tag: 'button', props: { disabled: true }, answer: false },
  { name: '<button tabindex="-1">', tag: 'button', attrs: { tabindex: '-1' }, answer: false,
    note: 'WAS WRONG: true. -1 asks to be out of the tab order' },
  { name: '<input>', tag: 'input', answer: true },
  { name: '<input disabled>', tag: 'input', props: { disabled: true }, answer: false },
  { name: '<input disabled tabindex="0">', tag: 'input', props: { disabled: true },
    attrs: { tabindex: '0' }, answer: false,
    note: 'WAS WRONG: true. disabled beats tabindex' },
  { name: '<input type="hidden">', tag: 'input', attrs: { type: 'hidden' }, answer: false,
    note: 'FOUND IN REVIEW: true. it is not rendered, so it is not in the ring' },
  { name: '<input type="hidden" tabindex="0">', tag: 'input',
    attrs: { type: 'hidden', tabindex: '0' }, answer: false,
    note: 'FOUND IN REVIEW: true. not rendered beats an explicit tabindex' },
  { name: '<select>', tag: 'select', answer: true },
  { name: '<textarea>', tag: 'textarea', answer: true },
  { name: '<div>', tag: 'div', answer: false },
  { name: '<div tabindex="0">', tag: 'div', attrs: { tabindex: '0' }, answer: true },
  { name: '<div tabindex="2">', tag: 'div', attrs: { tabindex: '2' }, answer: true },
  { name: '<div tabindex="-1">', tag: 'div', attrs: { tabindex: '-1' }, answer: false },
  { name: '<div tabindex="">', tag: 'div', attrs: { tabindex: '' }, answer: false,
    note: 'WAS WRONG: true. Number(\'\') is 0; the parser reads an invalid value as absent' },
  { name: '<div tabindex="  ">', tag: 'div', attrs: { tabindex: '  ' }, answer: false,
    note: 'WAS WRONG: true. same' },
  { name: '<div tabindex=" 0 ">', tag: 'div', attrs: { tabindex: ' 0 ' }, answer: true },
  { name: '<div tabindex="+0">', tag: 'div', attrs: { tabindex: '+0' }, answer: true },
  { name: '<div tabindex="1.5">', tag: 'div', attrs: { tabindex: '1.5' }, answer: true,
    note: 'FOUND IN REVIEW: false. parsing integers takes the leading digits: this is 1' },
  { name: '<div tabindex="12abc">', tag: 'div', attrs: { tabindex: '12abc' }, answer: true,
    note: 'the shape that shows the parse is not a validity test: this is 12' },
  { name: '<div tabindex="yes">', tag: 'div', attrs: { tabindex: 'yes' }, answer: false },
  { name: '<a>', tag: 'a', answer: false },
  { name: '<a href>', tag: 'a', attrs: { href: '/ops/alerts.html' }, answer: true },
  { name: '<a contenteditable>', tag: 'a', attrs: { contenteditable: '' }, answer: true,
    note: 'FOUND IN REVIEW: false. asking about href first answered before editing host' },
  { name: '<div contenteditable>', tag: 'div', attrs: { contenteditable: '' }, answer: true,
    note: 'WAS WRONG: false. the unsafe direction: an editable box reported unreachable' },
  { name: '<div contenteditable="true">', tag: 'div', attrs: { contenteditable: 'true' },
    answer: true },
  { name: '<div contenteditable="plaintext-only">', tag: 'div',
    attrs: { contenteditable: 'plaintext-only' }, answer: true },
  { name: '<div contenteditable="false">', tag: 'div', attrs: { contenteditable: 'false' },
    answer: false },
  { name: '<div contenteditable="inherit">', tag: 'div', attrs: { contenteditable: 'inherit' },
    answer: false },
  { name: '<div contenteditable="wat">', tag: 'div', attrs: { contenteditable: 'wat' },
    answer: false, note: 'an unrecognised value is the inherit state, not the true state' },
  { name: '<div contenteditable tabindex="-1">', tag: 'div',
    attrs: { contenteditable: '', tabindex: '-1' }, answer: false,
    note: 'an editing host can still ask to be out of the tab order' },
  { name: '<iframe>', tag: 'iframe', answer: true, note: 'WAS WRONG: false' },
  { name: '<audio controls>', tag: 'audio', attrs: { controls: '' }, answer: true,
    note: 'WAS WRONG: false' },
  { name: '<audio>', tag: 'audio', answer: false },
  { name: '<video controls>', tag: 'video', attrs: { controls: '' }, answer: true },
  { name: '<button hidden>', tag: 'button', attrs: { hidden: '' }, answer: false },
  { name: '<button inert>', tag: 'button', attrs: { inert: '' }, answer: false },
  { name: '<summary> outside <details>', tag: 'summary', answer: false },
  { name: '<summary> first in <details>', tag: 'summary', wrap: 'details', answer: true },
  { name: '<summary> after a <div> in <details>', tag: 'summary', wrap: 'details',
    wrapBefore: ['div'], answer: true,
    note: 'FOUND IN REVIEW: false. the rule is first <summary> child, not first child' },
  { name: '<summary> after a <summary> in <details>', tag: 'summary', wrap: 'details',
    wrapBefore: ['summary'], answer: false },
  { name: '<summary> nested in <details>', tag: 'summary', wrap: 'div', outerWrap: 'details',
    answer: false, note: 'a <summary> deeper than a child is ordinary text' },
  { name: '<button> inside <div inert>', tag: 'button', wrap: 'div', wrapAttrs: { inert: '' },
    answer: false },
  { name: '<div> inside <div contenteditable>', tag: 'div', wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. the stop is the editing HOST; this is its content' },
  { name: '<div contenteditable="false"> inside <div contenteditable>', tag: 'div',
    attrs: { contenteditable: 'false' }, wrap: 'div', wrapAttrs: { contenteditable: '' },
    answer: false },
  { name: '<object>', tag: 'object', answer: 'cannot tell',
    why: 'measured in Chrome it takes no stop at tabIndex 0, but that is the empty case: '
      + 'what a loaded resource or fallback content does is not in the markup' },
  { name: '<embed>', tag: 'embed', answer: 'cannot tell',
    why: 'same, and its tabIndex reads -1 where <object> reads 0, so even the IDL the two '
      + 'expose disagrees on elements this helper cannot distinguish' },
  { name: '<object hidden>', tag: 'object', attrs: { hidden: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. hidden takes it out whatever it loads, so the refusal '
      + 'below does not get to answer this one' },
  { name: '<object> inside <div inert>', tag: 'object', wrap: 'div', wrapAttrs: { inert: '' },
    answer: false, note: 'FOUND IN REVIEW: true. same, from an ancestor' },
  { name: '<object tabindex="-1">', tag: 'object', attrs: { tabindex: '-1' }, answer: false,
    note: 'FOUND IN REVIEW: true. asking to be out of the order is an answer for any tag' },
  { name: '<embed tabindex="-1">', tag: 'embed', attrs: { tabindex: '-1' }, answer: false,
    note: 'FOUND IN REVIEW: true. same' },
  { name: '<object tabindex="0">', tag: 'object', attrs: { tabindex: '0' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. and this is why the refusal stays BELOW the non-negative '
      + 'case: measured, bare it takes no stop and with a loaded data= it does, so the '
      + 'attribute alone does not decide it' },
  /* Chrome, full ring walks over HTTP, fourth review of #75: of two radios
     named the same, only ONE takes a stop -- the checked one, else the first
     -- and two forms are two groups. All four were answered `true`. */
  { name: '<input type="radio" name="g">', tag: 'input',
    attrs: { type: 'radio', name: 'g' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. first of an unchecked group takes the stop and every '
      + 'other member takes none, and which members are in the group is the owner form\'s' },
  { name: '<input type="radio" name="g" checked>', tag: 'input',
    attrs: { type: 'radio', name: 'g', checked: '' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured it DOES take the stop, but only because it is '
      + 'the checked member of its group, which one node cannot see' },
  { name: '<input type="radio">', tag: 'input', attrs: { type: 'radio' }, answer: true,
    why: 'no name, so no group: measured, two nameless radios both take a stop' },
  { name: '<input type="radio" name="">', tag: 'input', attrs: { type: 'radio', name: '' },
    answer: true, why: 'name="" is no group either -- measured, both members take a stop' },
  { name: '<input type="radio" name="g" disabled>', tag: 'input',
    attrs: { type: 'radio', name: 'g' }, props: { disabled: true }, answer: false,
    why: 'disabled is decided above the refusal, so the group never comes into it' },
  { name: '<input type="radio" name="g" tabindex="-1">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '-1' }, answer: false,
    why: 'a negative tabindex is out of the ring whatever the group does' },
  /* Chrome, same ring walk, fifth review of #75: a tabindex does not take a
     radio out of its group, it only moves where the group's one stop sits.
     Both rows below were answered `true` by the non-negative branch, which
     ran above the refusal. The measurement that settles it is a PAIR whose
     probe markup is character-identical: name=g unchecked at tabindex=2
     takes the stop when no member is checked, and takes NONE when a sibling
     is checked. Nothing on the node itself differs between those two. */
  { name: '<input type="radio" name="g" tabindex="0">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '0' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured no stop as the unchecked non-first member of '
      + 'its group, so a tabindex of 0 does not buy it one' },
  { name: '<input type="radio" name="g" tabindex="2">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '2' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured BOTH ways on identical node markup -- a stop '
      + 'with no checked member in the group, none with one -- so it is the group again' },
  { name: '<input type="radio" tabindex="0">', tag: 'input',
    attrs: { type: 'radio', tabindex: '0' }, answer: true,
    why: 'unnamed, so no group to refuse for: measured, it takes its own stop' },
  { name: '<area href>', tag: 'area', attrs: { href: '/ops/alerts.html' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. a stop only inside a <map> a rendered <img usemap> uses' },
  { name: '<area> with no href', tag: 'area', answer: false,
    note: 'FOUND IN REVIEW: true. no href, no link, no stop in any arrangement' },
  { name: '<details> with a <summary> child', tag: 'details', childBefore: ['summary'],
    answer: false, why: 'the <summary> is the stop; its <details> is not' },
  { name: '<details> with no <summary>', tag: 'details', answer: 'cannot tell',
    note: 'FOUND IN REVIEW: false. the agent supplies a summary, and Chrome gives it a stop' },
  { name: '<div tabindex="2147483647">', tag: 'div', attrs: { tabindex: '2147483647' },
    answer: true, why: 'the largest value a long holds, so still a real index' },
  { name: '<div tabindex="2147483648">', tag: 'div', attrs: { tabindex: '2147483648' },
    answer: false,
    note: 'FOUND IN REVIEW: true. one past a long is an ERROR, so the div is a plain div' },
  { name: '<div tabindex="999999999999999999999">', tag: 'div',
    attrs: { tabindex: '999999999999999999999' }, answer: false,
    note: 'FOUND IN REVIEW: true. the same error, far enough out to lose precision as well' },
  { name: '<button tabindex="-3000000000">', tag: 'button', attrs: { tabindex: '-3000000000' },
    answer: true,
    note: 'FOUND IN REVIEW: false. the UNSAFE direction: an out-of-range value is ignored, '
      + 'so the button keeps the stop its tag gives it' },
  { name: '<select tabindex="-2147483649">', tag: 'select', attrs: { tabindex: '-2147483649' },
    answer: true, note: 'FOUND IN REVIEW: false. one below a long, same as above' },
  { name: '<div tabindex="-2147483648">', tag: 'div', attrs: { tabindex: '-2147483648' },
    answer: false, why: 'in range, so it is read as a negative index and asks to be out' },
  { name: '<div contenteditable> inside <div contenteditable>', tag: 'div',
    attrs: { contenteditable: '' }, wrap: 'div', wrapAttrs: { contenteditable: '' },
    answer: false,
    note: 'FOUND IN REVIEW: true. a host inside a host is the outer one\'s content' },
  { name: '<div contenteditable> under a false under a host', tag: 'div',
    attrs: { contenteditable: '' }, wrap: 'div', wrapAttrs: { contenteditable: 'false' },
    outerWrap: 'div', outerWrapAttrs: { contenteditable: '' }, answer: true,
    why: 'contenteditable="false" breaks the chain, so the inner one is a host again' },
  { name: '<button> inside <fieldset disabled>', tag: 'button', wrap: 'fieldset',
    wrapProps: { disabled: true }, answer: 'cannot tell' },
  { name: '<button> inside a <legend> of <fieldset disabled>', tag: 'button', wrap: 'legend',
    outerWrap: 'fieldset', outerWrapProps: { disabled: true }, answer: 'cannot tell',
    note: 'refused for a reason: Chrome gives THIS one a stop and the row above none' },
];

test('focusable() answers the tab order the document can decide, and refuses the rest', () => {
  const { element: make } = makeDom({});
  const build = (probe) => {
    const node = make(probe.tag);
    for (const [name, value] of Object.entries(probe.attrs || {})) node.setAttribute(name, value);
    Object.assign(node, probe.props || {});
    for (const tag of probe.childBefore || []) node.appendChild(make(tag));
    if (!probe.wrap) return node;
    const parent = make(probe.wrap);
    for (const [name, value] of Object.entries(probe.wrapAttrs || {})) parent.setAttribute(name, value);
    Object.assign(parent, probe.wrapProps || {});
    for (const tag of probe.wrapBefore || []) parent.appendChild(make(tag));
    parent.appendChild(node);
    if (!probe.outerWrap) return node;
    const outer = make(probe.outerWrap);
    for (const [name, value] of Object.entries(probe.outerWrapAttrs || {})) outer.setAttribute(name, value);
    Object.assign(outer, probe.outerWrapProps || {});
    outer.appendChild(parent);
    return node;
  };

  const got = FOCUSABLE_PROBES.map((probe) => {
    let answer;
    try { answer = focusable(build(probe)); } catch { answer = 'cannot tell'; }
    return { name: probe.name, answer };
  });
  assert.deepEqual(got, FOCUSABLE_PROBES.map((p) => ({ name: p.name, answer: p.answer })),
    'focusable() disagrees with the tab order a browser gives one of these');

  /* Derived from the answers rather than typed, so a probe that quietly
     changes side fails here as well as above, and so does one that is
     deleted. */
  const counts = {
    cases: got.length,
    takesATabStop: got.filter((g) => g.answer === true).length,
    doesNot: got.filter((g) => g.answer === false).length,
    refused: got.filter((g) => g.answer === 'cannot tell').length,
    wereWrongBefore: FOCUSABLE_PROBES.filter((p) => /^WAS WRONG/.test(p.note || '')).length,
    foundInReview: FOCUSABLE_PROBES.filter((p) => /^FOUND IN REVIEW/.test(p.note || '')).length,
  };
  assert.deepEqual(counts,
    { cases: 75, takesATabStop: 27, doesNot: 37, refused: 11, wereWrongBefore: 7, foundInReview: 23 });
  console.log('focusable() probes judged: ' + JSON.stringify(counts));
});

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

  /* The same question for the range control, which lives in the SHELL rather
     than in this pane and is a <select> rather than a button. That difference
     is the point, so it is asserted rather than described: #fRange is drawn by
     shell-pane-v2.js into .filters, outside the .filters-pane slot this pane
     owns, and it survives a re-read because nothing in this pane redraws it.
     A probe that landed on the pane's own #fCategory would be testing the
     opposite mechanism under this sentence.

     The value has to actually CHANGE. The shell only re-emits ops:filters
     with the new range, and this pane ignores an event whose range it is
     already showing, so dispatching over an unchanged selection would read
     nothing, move nothing, and leave the assertion below passing on a page
     where no re-read ever happened. The call count is the proof it did. */
  const ranged = await boot({ search: '?range=7d' });
  const select = ranged.doc.getElementById('fRange');
  assert.ok(select, 'the shell drew no range control');
  assert.ok(select.closest('.filters'),
    'the range control is not in the shell\'s own filter bar');
  assert.equal(select.closest('.filters-pane'), null,
    'the range control is inside the slot this pane owns, so it is not the shell\'s');
  const readsBefore = ranged.calls.length;
  select.value = '30d';
  select.focus();
  select.dispatch('change');
  await settle();
  assert.ok(ranged.calls.length > readsBefore,
    'changing the range re-read nothing, so nothing was in a position to move focus');
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

/* The sheet's reading rule -- "anything this sheet says about another file is
   bound by a test ONLY where the sentence saying it names that test" -- is
   the whole device this pane's docblock rests on, and it rests in turn on
   those citations resolving. Nothing checked that they did, so any cited test
   could be renamed with the suite green and every sentence citing it would go
   on reading as proven. That is Stadiora/Aria#10632 inside the thing built to
   close it, and the second independent review of PR #75 found it there.

   Every double-quoted run in the sheet is either a title this file registers
   or one of the strings below, which are UI copy the sheet quotes rather than
   citations. Attribute spellings are dropped first, or a role="switch" pairs
   its quotes with the prose either side and every run after it is garbage. */
const SHEET_QUOTES_THAT_ARE_NOT_CITATIONS = ['Still happening'];

/* Which tests the sheet cites, pinned by IDENTITY rather than by a floor:
   a floor of eight against fourteen leaves six deletable in silence, and a
   citation going AWAY unbinds its sentence exactly as a citation going stale
   does. Pinned as a set, so citing one test from two places and then dropping
   one of the two is not a change here -- the claim is which tests hold the
   sheet up, not how many sentences say so. One entry is generated rather
   than typed, because the title it names is generated: it counts the sites
   on the NON-TOKEN PAINT line, so the sheet's own citation of it goes red
   when that line changes size. What generating it buys is one fewer place to
   edit, not that property -- see the note above NON_TOKEN_PAINT_TITLE, which
   is where that was measured. */
/* What this binds: the named test is registered. What it does NOT bind: that
   the named test is rigorous -- gut its body and the citation still resolves
   (mutation M4-R2 on #75). Each cited test carries its own mutations; this one
   only stops the sheet naming a test that no longer exists.

   Two more shapes it does not see, both latent today. The scan reads STRAIGHT
   double quotes, so a citation respelled with typographic quotes leaves the
   set; that is caught by the identity below UNLESS the same title is cited
   from two places, which the set comparison deliberately allows -- then one
   of the two sites silently stops being checked. No title is doubly cited
   at the moment. */
const SHEET_CITATIONS = [
  'a problem card carries one severity, in the accent and both inks alike',
  'every rule switch is a real checkbox, reachable, stateful and named',
  'every severity on the page is a word, not only a colour',
  'every status tone here paints the -ink of a tint aria.css also declares',
  'every test the stylesheet cites by name is a test this file registers',
  'every token this sheet paints with is one aria.css actually declares',
  'the accent this sheet adds is the one aria.css leaves out',
  'the avatar ink is the one paint no aria.css token could have made',
  'the page loads one design system and one theme decision',
  'the reader refuses what READER_PROBES says it refuses, and walks past what it says it misses',
  'the rules table scrolls inside a box a keyboard can reach and a screen reader can name',
  'the rules the sheet justifies by what the page draws name what it draws',
];

/* The tests this file's own comments cite, pinned by identity for the same
   reason SHEET_CITATIONS is. The bullet at the top cited a title that three
   OTHER ops suites register and this one does not, and nothing moved, because
   the resolver read the stylesheet and never this file (found in the fourth
   review of #75). */
const FILE_CITATIONS = ['the pane never spells innerHTML, outerHTML or insertAdjacentHTML'];

/* The NOT COVERED bullet at the top of this file used to count the
   machine-read lines by hand, and it was one short from the commit that
   added the fourth. The count is gone: the bullet NAMES them, and the names
   are matched both ways against MACHINE_READ_PREFIXES, which machineLine()
   holds every reader to. A fifth reader cannot be added without listing it,
   and a fifth line cannot be written in the sheet without being read.

   What it does not see: a machine-read line that does not LOOK like a
   heading. The sheet scan matches an upper-case run, hyphens included,
   before a colon at the start of a line -- so a data line spelled in lower
   case, or one carrying a digit or an underscore, would be invisible to it.
   The hyphen is in that class because leaving it out made the scan blind to
   NON-TOKEN PAINT, which is the FIRST of the four; a character class is a
   shape, and a guard that anchors on one shape cannot see the others. */
test('the NOT COVERED bullet names every prefixed docblock line this file reads as data, '
  + 'and every prose frame over it', () => {
  const bullet = /reads as data are ([\s\S]*?);/.exec(THIS_FILE);
  assert.ok(bullet, 'the NOT COVERED bullet no longer names the lines read as data');
  const namedThere = bullet[1].replace(/\s+/g, ' ').split(/, | and /);
  assert.deepEqual(namedThere, MACHINE_READ_PREFIXES,
    'the bullet and machineLine() disagree about which lines are read as data: '
    + namedThere.join(' / '));

  /* And from the sheet's side: no OTHER line in it is shaped like data. */
  const headings = [...PANE_CSS.matchAll(/^ *([A-Z][A-Z-]+(?: [A-Z-]+)*):/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(headings)].sort(), [...MACHINE_READ_PREFIXES].sort(),
    'the sheet carries a line shaped like a machine-read one that nothing reads: '
    + headings.join(' / '));
  /* The unprefixed kind, counted off the code rather than typed in prose. */
  assert.ok(THIS_FILE.includes('const ' + FRAMES_LIST_NAME + ' = ['),
    'FRAMES_LIST_NAME does not name a list this file declares, so the bullet points at '
    + 'nothing and the check below is comparing a string to itself');
  /* The whole NOT COVERED block, not the one bullet parsed above: the
     frames are named in a different bullet from the prefixes. */
  const notCovered = /NOT COVERED, deliberately[\s\S]*?\*\//.exec(THIS_FILE);
  assert.ok(notCovered, 'the NOT COVERED block is gone, and with it every claim about '
    + 'what this file does not check');
  assert.ok(notCovered[0].includes(FRAMES_LIST_NAME),
    'the NOT COVERED block stopped naming ' + FRAMES_LIST_NAME + ', so the unprefixed '
    + 'readers are enumerated in code and unmentioned in the prose that claims to name them');
  const frames = (THIS_FILE.match(FRAME_SPELLING) || []).length;
  assert.equal(frames, PROSE_FRAMES_OVER_THE_SHEET.length,
    'this file reads the sheet through ' + frames + ' prose frames and names '
    + PROSE_FRAMES_OVER_THE_SHEET.length + ': a frame was added or removed without saying '
    + 'which sentence it reads');

  /* This file's OWN citations, resolved the way the stylesheet's are. The
     marker is the words "The test" before the quote; a citation written
     without it is invisible here, which is the shape this misses and the
     reason FILE_CITATIONS is pinned by identity rather than by a floor.

     That gap has a SECOND face, named by the fifth review of #75: an
     unmarked quotation of a title belonging to NO suite -- an invented one
     -- falls between both halves. The marked half never sees it for want of
     the marker, and the foreign half below rejects it because it is in no
     sibling's title set. Only a real foreign title is caught unmarked. */
  /* Built from parts rather than written as one literal, or the pattern
     matches its own source text and this file cites `([^`. */
  const marker = new RegExp('The' + ' test "([^"]+)"', 'g');
  const marked = [...THIS_FILE.replace(/\s+/g, ' ').matchAll(marker)].map((m) => m[1]);
  assert.deepEqual([...new Set(marked)].sort(), FILE_CITATIONS.slice().sort(),
    'a comment in this file cites a test FILE_CITATIONS does not list, or stopped citing '
    + 'one it does');
  assert.deepEqual(marked.filter((title) => !TEST_TITLES.has(title)), [],
    'a comment in this file names a test this file does not register, so the sentence '
    + 'around it is prose wearing a proof pointer');

  /* And the failure that got here: an UNMARKED quotation of a title that is
     real, but belongs to another suite. Those read as proof to a person and
     bind nothing. */
  const foreign = new Set();
  for (const name of readdirSync(new URL('.', import.meta.url))) {
    if (!/^ops-.*\.test\.mjs$/.test(name) || name === 'ops-alerts-v2.test.mjs') continue;
    for (const m of readFileSync(new URL(name, import.meta.url), 'utf8')
      .matchAll(/^test\('([^']+)'/gm)) foreign.add(m[1]);
  }
  /* Asked per known title rather than by scanning this file for quoted runs.
     A scan pairs quote characters in order, so ONE unbalanced " anywhere
     above shifts every pair after it -- this file holds 275 of them, an odd
     number, and the shift is why my round-6 battery could paste a foreign
     title into a comment and watch the suite stay green. Membership cannot
     drift: each candidate is a string we already have. */
  const normalised = THIS_FILE.replace(/\s+/g, ' ');
  const quotedForeign = [...foreign]
    .filter((title) => !TEST_TITLES.has(title) && normalised.includes('"' + title + '"'));
  assert.deepEqual(quotedForeign, [],
    'a comment in this file quotes a test title that belongs to a DIFFERENT ops suite, '
    + 'which reads as a proof pointer and is not one');

  console.log('machine-read docblock lines judged: '
    + JSON.stringify({ read: MACHINE_READ_PREFIXES.length, inSheet: headings.length,
      proseFrames: frames, ownCitations: marked.length, foreignTitles: foreign.size }));
});

test('every test the stylesheet cites by name is a test this file registers', () => {
  const prose = PANE_CSS.replace(/\s+/g, ' ').replace(/[a-zA-Z-]+="[^"]*"/g, '');
  const quoted = [...prose.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  for (const copy of SHEET_QUOTES_THAT_ARE_NOT_CITATIONS) {
    assert.ok(quoted.includes(copy),
      'the sheet no longer quotes ' + JSON.stringify(copy) + ', so the exception for it here '
      + 'is stale and the next quotation of it would be waved through as UI copy');
  }

  const cited = quoted.filter((q) => !SHEET_QUOTES_THAT_ARE_NOT_CITATIONS.includes(q));
  assert.deepEqual(cited.filter((title) => !TEST_TITLES.has(title)), [],
    'the sheet names a test that this file does not register, so the sentence around it is '
    + 'prose wearing a proof pointer');

  /* The EXTENT, not only the verdict: an empty citation list passes the line
     above, and the sheet would then be entirely unbound while this test went
     on saying its citations were fine. A FLOOR is not enough either -- at
     >= 8 against 14 real ones, six could be deleted in silence (found in the
     third review of #75) -- so the list itself is pinned and losing one is a
     deliberate edit here. */
  assert.deepEqual([...new Set(cited)].sort(),
    [...SHEET_CITATIONS, NON_TOKEN_PAINT_TITLE].sort(),
    'the sheet cites a different set of tests than SHEET_CITATIONS lists, so a claim has '
    + 'either gained or quietly LOST its proof pointer');
  console.log('stylesheet citations judged: '
    + JSON.stringify({ quoted: quoted.length, cited: cited.length, resolved: cited.length }));
});

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

  /* The sheet's own first sentence: "Loaded after assets/aria.css and
     assets/shell-pane-v2.css, on ops/alerts.html and nowhere else." Order
     first -- a later sheet wins a tie in the cascade, and this one is written
     to override the two above it. */
  const at = (href) => html.indexOf('href="' + href + '"');
  assert.ok(at('assets/aria.css') < at('assets/shell-pane-v2.css'),
    'alerts.html loads shell-pane-v2.css before aria.css');
  assert.ok(at('assets/shell-pane-v2.css') < at('assets/pane-alerts-v2.css'),
    'alerts.html loads pane-alerts-v2.css before the sheets it is written to override');

  /* And nowhere else. */
  const elsewhere = readdirSync(new URL('.', OPS))
    .filter((name) => name.endsWith('.html') && name !== 'alerts.html')
    .filter((name) => read(name).includes('pane-alerts-v2.css'));
  assert.deepEqual(elsewhere, [],
    'pane-alerts-v2.css is loaded by a page other than alerts.html, which its own docblock '
    + 'says never happens');
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

/* ===================== the rules table as a region ===================== */

/* Six columns hold a 760px minimum, so on a phone the rules table scrolls
   inside its own box. A box that scrolls sideways and cannot be focused
   belongs to a pointer: measured on the real page at 375px, that box reported
   clientWidth 343 against scrollWidth 967, with 624px of table past its own
   edge (Stadiora/Aria#10459).

   Everything below is asserted about THE BOX THAT CLIPS -- the table's own
   parent, reached from the table rather than from a class name -- and the
   overflow that makes it clip is read out of the stylesheet, so a rule that
   moved the scrolling somewhere else cannot leave these assertions passing on
   a box that no longer scrolls. */
test('the rules table scrolls inside a box a keyboard can reach and a screen reader can name',
  async () => {
    const dom = await boot({});
    const table = findAll(panel(dom, 'live'),
      (n) => n.tagName === 'TABLE' && allText(n).includes('What it watches'))[0];
    assert.ok(table, 'the pane drew no rules table');

    const box = table.parentNode;
    const classes = (box.className || '').split(/\s+/).filter(Boolean);
    assert.equal(classes.length, 1, 'the box around the table carries more than one class');
    const paint = declarations(PANE_CSS)
      .filter((d) => d.selector === '.' + classes[0] && d.property === 'overflow-x');
    assert.deepEqual(paint.map((d) => d.value), ['auto'],
      'the table\'s own parent is not the box the stylesheet scrolls, so these '
      + 'assertions would be about an element that clips nothing');

    assert.equal(box.getAttribute('tabindex'), '0',
      'the box that clips the table has no tab stop, so the columns past its edge '
      + 'are a pointer\'s alone');
    assert.equal(box.getAttribute('role'), 'region');

    /* A tab stop with no name is announced as "group" and nothing else. The
       name is the table's own caption, so the region and the table cannot end
       up describing themselves differently. */
    const named = box.getAttribute('aria-labelledby');
    assert.ok(named, 'the region has no accessible name');
    const targets = findAll(dom.doc.body, (n) => n.getAttribute('id') === named);
    assert.equal(targets.length, 1,
      'aria-labelledby resolves to ' + targets.length + ' elements, so the name is '
      + (targets.length ? 'ambiguous' : 'nothing at all'));
    assert.equal(targets[0].tagName, 'CAPTION', 'the name is not the table\'s own caption');
    assert.equal(targets[0].parentNode, table, 'the caption names some other table');
    assert.ok(allText(targets[0]).trim().length > 0, 'the caption is empty');

    /* The ring is the global one, moved. aria.css puts :focus-visible OUTSIDE
       the element; this box is flush with its card's left, right and top
       edges, so outside the box is outside the CARD -- measured on the
       rendered page at both widths and both themes in
       antonyrugama/aria-website#72, all of the default ring lands beyond the
       box and none of it on the table.

       The quantity that decides whether a ring lands INSIDE its box is the
       ring's own width, not the offset it is pulled in by: a ring of width w
       painted at offset o spans o to o + w outward from the box edge, so it
       is wholly inside only when o <= -w. Deriving the override from the
       global OFFSET alone left the suite green while aria.css grew a 6px ring
       that a -2px offset leaves 4px of outside the box (Stadiora/Aria#10633).
       Both quantities are read out of aria.css here, and neither is typed. */
    /* WHICH declaration paints is a cascade question, not a document-order
       one: within one origin the last !important wins where there is one,
       and the last declaration otherwise. Reading document order alone took
       2px off a rule painting a 6px !important ring -- 4px of it outside the
       box, suite green -- and aria.css already uses !important four times
       (found in the third review of antonyrugama/aria-website#75). What this
       does NOT model is named in the NOT BOUND list at the top of the sheet:
       one origin, and the :focus-visible selector exactly as spelled. */
    const wins = (decls, what) => {
      assert.ok(decls.length > 0, 'nothing declares ' + what + ' at all');
      const forced = decls.filter((d) => IMPORTANT.test(d.value));
      const kept = forced.length ? forced : decls;
      return kept[kept.length - 1].value.replace(IMPORTANT, '').trim();
    };
    const globalRing = (property) => declarations(ARIA_CSS)
      .filter((d) => d.selector === ':focus-visible' && d.property === property);
    const px = (value, what) => {
      const n = Number(/^(-?[\d.]+)px$/.exec(value)?.[1]);
      assert.ok(Number.isFinite(n), what + ' is not a px length: ' + value);
      return n;
    };

    /* The width comes from the shorthand and the longhand together -- an
       outline-width ABOVE a later outline shorthand is overridden by it, so
       preferring the longhand wherever it sits reads a 1px ring off a rule
       that paints 6px, and preferring document order reads 2px off a 6px
       !important one. Both go through wins(). */
    const widthDecl = wins(declarations(ARIA_CSS).filter((d) => d.selector === ':focus-visible'
      && (d.property === 'outline' || d.property === 'outline-width')),
    'a global outline width');
    const width = px((/(^|\s)(-?[\d.]+px)(\s|$)/.exec(widthDecl) || [])[2] || widthDecl,
      'aria.css\'s global outline width');
    assert.ok(width > 0, 'aria.css\'s global focus ring has no width, so there is no ring');

    const outside = px(wins(globalRing('outline-offset'), 'a global outline-offset'),
      'aria.css\'s global outline-offset');
    assert.ok(outside > -width,
      'aria.css\'s global ring already lands wholly inside the element, so this override has '
      + 'nothing to pull in and the reason written beside it is false');

    const offsets = declarations(PANE_CSS).filter(
      (d) => d.selector === '.' + classes[0] + ':focus-visible' && d.property === 'outline-offset');
    const pulled = px(wins(offsets, 'an offset on ' + classes[0]),
      'the offset on ' + classes[0]);
    assert.ok(pulled + width <= 0,
      'the focus ring on the scrolling box is ' + (pulled + width) + 'px wide outside the box: '
      + 'a ' + width + 'px ring at ' + pulled + 'px needs an offset of at most ' + (-width) + 'px '
      + 'to land on the table it belongs to');

    /* And the two siblings the sheet says carry the same line carry it: read
       out of the sheet's own SAME FOCUS RING AS line, compared declaration
       for declaration, because citing a sibling that differs is the same
       defect class as a docblock that describes paint it does not use
       (Stadiora/Aria#10632). */
    const cited = machineLine('SAME FOCUS RING AS').exec(PANE_CSS);
    assert.ok(cited, 'the sheet no longer names the siblings it says it matches');
    const siblings = cited[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.ok(siblings.length > 0, 'the sheet cites no sibling at all');
    const mine = scrollBoxFocusRule(PANE_CSS);
    assert.deepEqual(mine, [{ property: 'outline-offset', value: pulled + 'px' }],
      'the rule this test compares the siblings against is not the one it just measured');
    for (const name of siblings) {
      assert.deepEqual(scrollBoxFocusRule(read('assets/' + name)), mine,
        name + ' does not draw the same focus ring on its own scrolling box, so the line '
        + 'citing it is false');
    }

    /* And the sibling the sheet says is deliberately NOT on that line really
       differs, by exactly the property it says: naming an excluded sibling is
       a positive claim too, and it was the false half of
       Stadiora/Aria#10632's finding 4. */
    /* The line carries the whole DECLARATION, property and value. Naming the
       property alone left "it resets border-radius: 0" half bound: the
       sibling growing a border-radius: 4px kept the suite green while the
       sentence went on saying 0 (found in the second review of #75). */
    const apart = machineLine('DIFFERENT FOCUS RING',
      '\\s*(\\S+)\\s+adds\\s+([\\w-]+):\\s*(\\S.*?)\\s*').exec(PANE_CSS);
    assert.ok(apart, 'the sheet no longer names the sibling it says it differs from');
    const [, excluded, extra, extraValue] = apart;
    assert.ok(!siblings.includes(excluded),
      excluded + ' is cited as both the same ring and a different one');
    const theirs = scrollBoxFocusRule(read('assets/' + excluded));
    assert.deepEqual(
      theirs.filter((d) => !mine.some((m) => m.property === d.property && m.value === d.value))
        .map((d) => d.property + ': ' + d.value),
      [extra + ': ' + extraValue],
      excluded + ' no longer differs from this sheet by exactly ' + extra + ': ' + extraValue
      + ', so the reason it is held apart is false');
    assert.ok(!mine.some((d) => d.property === extra),
      'this sheet declares ' + extra + ' on its own focus rule after all');
  });

/* The focus rule of whichever box a sheet scrolls sideways, found by its
   overflow rather than by a class name: every one of these sheets calls its
   box something different. */
function scrollBoxFocusRule(css) {
  const decls = declarations(css);
  const boxes = decls
    .filter((d) => d.property === 'overflow-x' && d.value === 'auto')
    .map((d) => d.selector);
  assert.equal(boxes.length, 1, 'expected exactly one sideways-scrolling box, found '
    + boxes.length + ': ' + boxes.join(', '));
  return decls
    .filter((d) => d.selector === boxes[0] + ':focus-visible')
    .map((d) => ({ property: d.property, value: d.value }));
}

/* The state the tab stop exists FOR. Every rule switch is disabled for anyone
   below owner, so for them the box holds nothing focusable at all and the stop
   on the box itself is the only way into the columns past its edge. */
test('for a non-owner the scrolling box holds nothing else that can take focus', async () => {
  const dom = await boot({ role: 'viewer' });
  const table = findAll(panel(dom, 'live'),
    (n) => n.tagName === 'TABLE' && allText(n).includes('What it watches'))[0];
  const box = table.parentNode;

  const inside = findAll(box, (n) => n !== box && focusable(n));
  assert.deepEqual(inside.map((n) => n.tagName), [],
    'a non-owner has something else to tab to in here, so this fixture no longer '
    + 'reproduces the state the stop is for');
  assert.ok(focusable(box), 'nothing in or on the box can take focus');
});

/* ========================== what the sheet paints ====================== */

/* ops/assets/pane-alerts-v2.css opens with positive claims about its own
   paint. Prose is where this programme's defects have lived, so they are
   derived from the file here rather than trusted: the sheet itself said "no
   new colour value" while painting one (Stadiora/Aria#10460).

   What the reader below catches and what walks past it USED TO BE A SENTENCE
   here, and the sentence was wrong -- it said "a hex, a colour function or an
   unknown function in the same place would not [walk past]", which is false
   for color-mix(), the one colour function this sheet uses
   (Stadiora/Aria#10632). The sentence is gone. READER_PROBES below is the
   same statement as cases the reader is actually run against, so a blind spot
   that closes or opens fails the suite instead of going stale in a comment.

   Still NOT COVERED, and not probeable: strings and url(), which the reader
   does not parse. A url( is refused outright, in any case. A quoted STRING is
   refused only when it carries a brace or a semicolon -- what declarations()
   splits on -- so a colour word inside one reaches the reader as an ordinary
   value and is then judged, or walked past, by the paint stem in its
   property's name like anything else. This sheet's only string is
   content: ''. */

/* Every declaration in a sheet, as { selector, property, value }. A reader
   rather than a regex over the source: `white-space` contains the word
   "white", `--acc` is a custom property holding a colour, and a rule nested
   in @media is still a rule. */
/* A declaration's importance decides the cascade before its position does.
   declarations() keeps the flag in the value, so anything resolving a
   winner has to read it and anything reading a length has to strip it. */
const IMPORTANT = /\s*!\s*important\s*$/i;

function declarations(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const stack = [];
  let buf = '';
  let depth = 0;
  const flush = () => {
    const text = buf.trim();
    const i = text.indexOf(':');
    if (!text || !stack.length || i < 0) return;
    out.push({
      selector: stack[stack.length - 1],
      property: text.slice(0, i).trim(),
      value: text.slice(i + 1).trim().replace(/\s+/g, ' '),
    });
  };
  for (const ch of src) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && (ch === '{' || ch === '}' || ch === ';')) {
      if (ch === '{') stack.push(buf.trim().replace(/\s+/g, ' '));
      else { flush(); if (ch === '}') stack.pop(); }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

/* var() first, then a function name, then a hex, then a measure, then a bare
   word, then the parentheses that nest them. Order matters: `var(--cyan)`
   must not come back as the word `var`.

   Every atom carries the function it sits INSIDE, because `transparent`
   standing alone and `transparent` laid under a token by a color-mix() are
   different paint, and the sheet's docblock claims it only ever uses the
   second (Stadiora/Aria#10632). Without this the two are one pin entry and
   the claim can go stale in place. */
const ATOM =
  /var\(\s*--[\w-]+\s*\)|-?[a-zA-Z][\w-]*\(|#[0-9a-fA-F]{3,8}\b|-?\.?\d[\w.%]*|-?[a-zA-Z][\w-]*|[()]/g;
function atomsIn(value) {
  const out = [];
  const open = [];
  for (const [text] of value.matchAll(ATOM)) {
    if (text === '(') { open.push(''); continue; }
    if (text === ')') { open.pop(); continue; }
    out.push({ atom: text, inside: open[open.length - 1] || '' });
    if (text.endsWith('(') && !text.startsWith('var(')) open.push(text.slice(0, -1));
  }
  return out;
}
const atomsOf = (value) => atomsIn(value).map((a) => a.atom);

/* Property names that can carry a colour, by stem. Anything starting with --
   counts too: .acc-blue sets --acc to one. */
const PAINT_STEMS = ['color', 'background', 'shadow', 'outline', 'border', 'fill', 'stroke'];
const paints = (property) =>
  property.startsWith('--') || PAINT_STEMS.some((stem) => property.includes(stem));

/* Words that appear inside a colour-bearing value and are not paint. Pinned,
   so a fourth one is classified by a person rather than assumed. */
const COLOUR_SYNTAX = ['in', 'inset', 'solid', 'srgb'];

/* The functions this sheet is allowed to call, anywhere. An unknown one is a
   failure rather than a skip: rgb(), hsl() and every other colour function
   arrives here first, and so does a var() written with a fallback -- only the
   bare `var(--token)` spelling is read as a token below. */
const FUNCTIONS = ['color-mix(', 'linear-gradient(', 'minmax(', 'translateX('];

/* The reader's whole verdict on one sheet: every atom it paints with, every
   function it calls, and which of those functions nothing has classified.
   One function, so the probes below and the assertions on the real sheet run
   the same code rather than two readings of it. */
function readPaint(css) {
  const found = [];
  const functions = new Set();
  for (const d of declarations(css)) {
    for (const { atom, inside } of atomsIn(d.value)) {
      if (atom.endsWith('(')) { functions.add(atom); continue; }
      if (atom.startsWith('var(')) continue;
      if (/^-?\.?\d/.test(atom)) continue;
      const site = { selector: d.selector, property: d.property, atom, inside };
      if (atom.startsWith('#')) { found.push(site); continue; }
      if (!paints(d.property) || COLOUR_SYNTAX.includes(atom)) continue;
      found.push(site);
    }
  }
  return {
    found,
    functions: [...functions].sort(),
    unclassified: [...functions].filter((f) => !FUNCTIONS.includes(f)).sort(),
  };
}

/* What the reader refuses and what walks past it, one declaration at a time.
   `refused` is typed from what the assertions below would do with that
   declaration -- report a non-token atom, or call a function FUNCTIONS has
   not classified -- and is never read back out of readPaint().

   The rows marked BLIND SPOT are the ones this guard does NOT catch. They are
   here so that closing a blind spot, or opening a new one, fails the suite:
   the sentence they replaced claimed colour functions were refused
   everywhere, which was false for the only colour function the sheet uses
   (Stadiora/Aria#10632). */
const READER_PROBES = [
  { css: '.probe { color: magenta; }', refused: true,
    why: 'a bare colour keyword on a property whose name carries a paint stem' },
  { css: '.probe { border-color: #ff00ff; }', refused: true, why: 'a hex where colour is expected' },
  { css: '.probe { column-rule: 1px solid #ff00ff; }', refused: true,
    why: 'a hex is refused on EVERY property, paint stem or not' },
  { css: '.probe { column-rule: 1px solid frobnicate(0); }', refused: true,
    why: 'an unclassified function is refused on every property' },
  { css: '.probe { color: color-mix(in srgb, black 50%, white); }', refused: true,
    why: 'the atoms inside a classified function ARE read, on a property that paints' },
  { css: '.probe { --acc: magenta; }', refused: true,
    why: 'a custom property can carry a colour, so every one of them is read' },
  { css: '.probe { column-rule: 1px solid magenta; }', refused: false, stemless: 'column-rule',
    why: 'BLIND SPOT: a bare colour keyword on a property with no paint stem in its name' },
  /* The sheet NAMES five stemless properties. Probing one of them and
     writing the other four into prose is the claim this file exists to stop
     making, so each is run (found in the third review of #75). */
  { css: '.probe { text-decoration: underline magenta; }', refused: false, stemless: 'text-decoration',
    why: 'BLIND SPOT: text-decoration, named by the sheet, carries no paint stem' },
  { css: '.probe { mask-image: linear-gradient(magenta, white); }', refused: false, stemless: 'mask-image',
    why: 'BLIND SPOT: mask-image, named by the sheet, carries no paint stem' },
  { css: '.probe { list-style: square inside magenta; }', refused: false, stemless: 'list-style',
    why: 'BLIND SPOT: list-style, named by the sheet, carries no paint stem' },
  { css: '.probe { filter: drop-shadow(0 0 1px magenta); }', refused: true,
    why: 'NOT a blind spot, though paints("filter") is false: the only syntax that carries a '
      + 'colour to filter is drop-shadow(), which is unclassified and refused everywhere. The '
      + 'sheet named filter alongside the four real ones until this row was run' },
  { css: '.probe { column-rule: 1px solid color-mix(in srgb, black 50%, white); }', refused: false,
    why: 'BLIND SPOT: the same, inside a classified colour function -- the exact payload of '
      + 'Stadiora/Aria#10632 finding 1' },
  { css: '.probe { column-rule-color: magenta; }', refused: true,
    why: 'the -color longhand of a stemless shorthand IS caught: the stem is in its name' },
  { css: '.probe { color: var(--cyan); }', refused: false, why: 'a token is what it is for' },
  { css: '.probe { white-space: nowrap; }', refused: false,
    why: 'the reader splits declarations rather than grepping: "white-space" is not white' },
];

test('the reader refuses what READER_PROBES says it refuses, and walks past what it says it misses',
  () => {
    const got = READER_PROBES.map((probe) => {
      const { found, unclassified } = readPaint(probe.css);
      return { css: probe.css, refused: found.length > 0 || unclassified.length > 0 };
    });
    assert.deepEqual(got, READER_PROBES.map((p) => ({ css: p.css, refused: p.refused })),
      'the reader no longer catches what this file says it catches, or no longer misses what '
      + 'it says it misses');

    const counts = {
      probes: got.length,
      refused: got.filter((g) => g.refused).length,
      blindSpots: READER_PROBES.filter((p) => /^BLIND SPOT/.test(p.why)).length,
    };
    assert.deepEqual(counts, { probes: 15, refused: 8, blindSpots: 5 });
    assert.deepEqual(
      READER_PROBES.filter((p) => /^BLIND SPOT/.test(p.why) && p.refused).map((p) => p.css), [],
      'a row is written down as a blind spot while the reader catches it, so the disclosure '
      + 'is worse than the guard');
    console.log('reader probes judged: ' + JSON.stringify(counts));

    /* The paragraph at pane-alerts-v2.css:36-40 NAMES the stemless properties
       a keyword walks past on. Citing the test by title binds that this test
       exists; it does not bind that list, so the list is read out of the sheet
       and deepEqual to the rows marked `stemless`. Removing one from the sheet,
       or adding one the file never probes, fails here. Shape it misses: the
       sentence has to keep the exact frame "on <list> walks past it" -- rewrite
       that frame and the extraction finds nothing, which is why it asserts the
       match is present before comparing. */
    const frame = PANE_CSS.replace(/\s+/g, ' ')
      .match(/so a keyword on ([a-z-]+(?:, [a-z-]+)*) or ([a-z-]+) walks past it/);
    assert.ok(frame, 'the sheet no longer names the stemless properties in the frame this '
      + 'test reads, so nothing is checking that list');
    const namedBySheet = frame[1].split(', ').concat(frame[2]).sort();
    assert.deepEqual(namedBySheet, READER_PROBES.filter((probe) => probe.stemless)
      .map((probe) => probe.stemless).sort(),
      'the sheet names a stemless property this file never probes, or stops naming one it '
      + 'does -- the prose and the probes have drifted apart');

    /* The OTHER half of the same sentence enumerates PAINT_STEMS, and it was
       unread for exactly as long as the stemless half was: the sheet could
       name a stem the reader does not have, or the reader could lose one the
       sheet names, and nothing moved (found in the fourth review of #75).
       Same device, same frame caveat. */
    const stems = PANE_CSS.replace(/\s+/g, ' ')
      .match(/carries a paint stem \(([a-z, -]+)\), so a keyword/);
    assert.ok(stems, 'the sheet no longer names the paint stems in the frame this test '
      + 'reads, so nothing is checking that list either');
    assert.deepEqual(stems[1].split(', ').sort(), PAINT_STEMS.slice().sort(),
      'the sheet names a paint stem the reader does not use, or the reader uses one the '
      + 'sheet does not name');
  });

/* Every atom this sheet paints with that is NOT a token aria.css declares,
   one entry per site, and the function each one sits inside. deepEqual, so a
   new one fails the suite rather than joining the list quietly -- and so does
   removing one, or moving one out of its color-mix(). */
const NON_TOKEN_PAINT = [
  { selector: '.av', property: 'color', atom: 'black', inside: 'color-mix' },
  { selector: '.p-detail', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.p-close', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw:checked', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw:checked', property: 'box-shadow', atom: 'transparent', inside: 'color-mix' },
];

/* How the docblock spells one of those sites: "black in color-mix()", or the
   bare atom if it is ever painted on its own. The docblock's own line is
   deepEqual to the distinct set of these, so the sentence about WHERE the
   sheet's `transparent` lives cannot drift from the sheet. */
const spell = (site) => (site.inside ? site.atom + ' in ' + site.inside + '()' : site.atom);

/* Generated, and the sheet cites it by this exact text, so the sheet's
   citation goes red when NON_TOKEN_PAINT changes size. SHEET_CITATIONS adds
   this one in rather than typing it -- but measured (M4-P4 on #75), typing it
   out is ALSO caught, by the half of the citation test that requires a cited
   title to be registered: grow the list and the typed 6 stops resolving. So
   generating it removes a place to drift, it is not the only thing holding
   that property. */
const NON_TOKEN_PAINT_TITLE = 'every colour this sheet paints is a token aria.css declares, '
  + 'bar the ' + NON_TOKEN_PAINT.length + ' sites named here';

test(NON_TOKEN_PAINT_TITLE,
  () => {
    for (const quoted of PANE_CSS.match(/'[^'\n]*'|"[^"\n]*"/g) || []) {
      assert.ok(!/[;{}]/.test(quoted),
        'a quoted string carries a brace or a semicolon, which declarations() splits on: '
        + quoted);
    }
    assert.ok(!/\burl\(/i.test(PANE_CSS), 'the sheet grew a url(), which declarations() cannot read');

    const decls = declarations(PANE_CSS);
    assert.ok(decls.length > 150, 'the reader found only ' + decls.length + ' declarations');

    const { found, functions } = readPaint(PANE_CSS);

    assert.deepEqual(functions, FUNCTIONS,
      'the sheet calls a function this test has not classified; every colour function '
      + 'arrives here first');
    assert.deepEqual(found, NON_TOKEN_PAINT,
      'the sheet paints with something that is not a token aria.css declares, or paints one '
      + 'of the exceptions somewhere other than inside the function the docblock names');

    /* And the sheet's own docblock says the same thing in words. It is read
       out of the comment rather than believed, because a docblock that claims
       one thing while the rules below it do another is what filed
       Stadiora/Aria#10460 in the first place. */
    const claimed = machineLine('NON-TOKEN PAINT').exec(PANE_CSS);
    assert.ok(claimed, 'the sheet\'s docblock no longer names what it paints outside the tokens');
    assert.deepEqual(
      claimed[1].split(',').map((s) => s.trim()).filter(Boolean).sort(),
      [...new Set(NON_TOKEN_PAINT.map(spell))].sort(),
      'the docblock names a different set of non-token paint than the sheet uses');
  });

test('every token this sheet paints with is one aria.css actually declares', () => {
  const declared = new Set(
    declarations(ARIA_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));
  const own = new Set(
    declarations(PANE_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));
  assert.ok(declared.size > 20, 'aria.css declared only ' + declared.size + ' custom properties');

  const missing = [];
  for (const d of declarations(PANE_CSS)) {
    for (const atom of atomsOf(d.value)) {
      const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(atom);
      if (!ref || declared.has(ref[1]) || own.has(ref[1])) continue;
      missing.push(d.selector + ' { ' + d.property + ': ' + d.value + ' }');
    }
  }
  assert.deepEqual(missing, [],
    'a rule asks for a custom property nothing declares, so it paints its fallback or nothing');
});

/* The docblock's "Status text takes the -ink variant of its tone, because the
   base colour is the tint and the -ink is the text on that tint." Every .is-
   rule is paired here with the tint aria.css declares beside its ink, so a
   tone painted in its own tint -- the failure the sentence warns about -- is
   a failure rather than a sentence. */
/* The sheet says its three status-ink rules exist because aria.css declares
   .acc-bad and .acc-warn but no blue, so info problems need one declared
   here. Every clause of that is checkable, and none of it was checked
   (independent review of antonyrugama/aria-website#75). */
test('the accent this sheet adds is the one aria.css leaves out', () => {
  const accents = (css) => new Set(declarations(css)
    .filter((d) => /^\.acc-[\w-]+$/.test(d.selector) && d.property === '--acc')
    .map((d) => d.selector));

  const fromAria = accents(ARIA_CSS);
  const fromHere = accents(PANE_CSS);
  for (const named of ['.acc-bad', '.acc-warn']) {
    assert.ok(fromAria.has(named),
      'the comment says aria.css declares ' + named + ' and it does not');
    assert.ok(!fromHere.has(named), named + ' is declared here as well as in aria.css');
  }
  assert.deepEqual([...fromHere], ['.acc-blue'],
    'this sheet declares accents other than the blue it says it adds');
  assert.ok(!fromAria.has('.acc-blue'),
    'aria.css declares .acc-blue after all, so this sheet is copying it rather than adding it');
});

/* "The accent down a problem card, the ink on its title and the glyph beside
   it are three sightings of one fact." Asserted on the drawn page rather than
   on the JS that draws it: whatever severity a card carries, its accent class
   and both of its ink classes have to name the SAME tone. */
test('a problem card carries one severity, in the accent and both inks alike', async () => {
  /* Three severities at once: one tone agreeing with itself proves nothing
     about a mapping, and the fixture's default is a single card. */
  const dom = await boot({
    open: { problems: [
      problem({ id: 'prb_c', reference: 'AO-801', severity: 'critical' }),
      problem({ id: 'prb_w', reference: 'AO-802', severity: 'warning' }),
      problem({ id: 'prb_i', reference: 'AO-803', severity: 'info' }),
    ] },
  });
  const accentOf = { 'acc-bad': 'crit', 'acc-warn': 'warn', 'acc-blue': 'info' };
  const inkOf = { 'is-crit': 'crit', 'is-warn': 'warn', 'is-info': 'info' };
  const named = (node, map) => ((node.getAttribute && node.getAttribute('class')) || '')
    .split(/\s+/).map((c) => map[c]).filter(Boolean);

  const cards = problemCards(dom);
  assert.ok(cards.length >= 2, 'the fixture draws ' + cards.length + ' problem cards, so this '
    + 'cannot see whether different severities agree with themselves');

  const seen = cards.map((card) => {
    const inks = findAll(card, (n) => named(n, inkOf).length).flatMap((n) => named(n, inkOf));
    return {
      accent: named(card, accentOf),
      inkSightings: inks.length,
      tones: [...new Set([...named(card, accentOf), ...inks])],
    };
  });
  assert.deepEqual(seen.filter((s) => s.accent.length !== 1).map((s) => s.accent), [],
    'a problem card carries no accent tone, or more than one');
  assert.deepEqual(seen.filter((s) => s.inkSightings < 2).map((s) => s.inkSightings), [],
    'a problem card shows fewer than the two inks the sheet says it draws');
  assert.deepEqual(seen.filter((s) => s.tones.length !== 1).map((s) => s.tones), [],
    'a problem card shows more than one severity between its accent and its inks');
  assert.ok(new Set(seen.map((s) => s.tones[0])).size >= 2,
    'every card on the fixture is the same severity, so agreeing proves nothing');
});

/* "A real checkbox carrying role=\"switch\", so it is focusable, announced
   with its state and named by the rule it belongs to." Three separate facts
   about a control this sheet styles, and the whole set could be deleted from
   the JS with the suite green (independent review of
   antonyrugama/aria-website#75). */
test('every rule switch is a real checkbox, reachable, stateful and named', async () => {
  const dom = await boot({ role: 'owner' });
  const rows = ruleRows(dom).filter((row) => withClass(row, 'sw').length);
  assert.ok(rows.length >= 2, 'the fixture draws ' + rows.length + ' rule switches');

  for (const row of rows) {
    const sw = withClass(row, 'sw')[0];
    assert.equal(sw.tagName, 'INPUT', 'the switch is not an input');
    assert.equal(sw.getAttribute('type'), 'checkbox', 'the switch is not a checkbox');
    assert.equal(sw.getAttribute('role'), 'switch', 'the checkbox is not exposed as a switch');
    assert.ok(focusable(sw), 'an owner cannot tab to a rule switch');
    assert.equal(typeof sw.checked, 'boolean',
      'the switch carries no state for a screen reader to announce');

    /* Named by the rule it belongs to: the label has to contain the rule's
       own title, which is the .t-main of the row it sits in. */
    const name = sw.getAttribute('aria-label');
    assert.ok(name && name.trim(), 'a rule switch has no accessible name');
    const title = allText(withClass(row, 't-main')[0] || row).trim();
    assert.ok(title.length > 0 && name.includes(title),
      'the switch is named "' + name + '", which does not name the rule "' + title + '"');
  }
});

/* Two layout rules in the sheet are justified by facts about what
   assets/pane-alerts.js draws -- the rules table having six columns, and the
   condition pill's words being "Still happening" -- and both justifications
   were prose (Stadiora/Aria#10632, found in the second review of the fix).
   Delete a column or rename the pill and the sheet goes on naming the old
   shape as the reason its rules exist. */
test('the rules the sheet justifies by what the page draws name what it draws',
  async () => {
    const dom = await boot({ role: 'owner' });
    const table = withClass(dom.doc.body, 'rules-card')[0];
    assert.ok(table, 'the fixture draws no rules card');
    const head = findAll(table, (n) => n.tagName === 'TR')
      .find((row) => findAll(row, (n) => n.tagName === 'TH').length > 0);
    assert.ok(head, 'the rules table draws no header row');
    const columns = findAll(head, (n) => n.tagName === 'TH').length;
    assert.equal(columns, 6,
      'the rules table draws ' + columns + ' columns, and pane-alerts-v2.css justifies two '
      + 'rules by there being six of them in 760px');

    const pill = withClass(dom.doc.body, 'p-live')[0];
    assert.ok(pill, 'no problem on the page is still happening, so nothing carries .p-live');
    assert.equal(allText(pill).trim(), 'Still happening',
      'the condition pill reads "' + allText(pill).trim() + '", and pane-alerts-v2.css '
      + 'justifies white-space: nowrap by "Still happening" wrapping to two words');
  });

test('every status tone here paints the -ink of a tint aria.css also declares', () => {
  const declared = new Set(
    declarations(ARIA_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));

  const rules = declarations(PANE_CSS).filter((d) => /^\.is-[\w-]+$/.test(d.selector));
  assert.ok(rules.length >= 3, 'the sheet declares only ' + rules.length + ' status tones');

  const paired = rules.map((d) => {
    const ref = /^var\(\s*(--[\w-]+)-ink\s*\)$/.exec(d.value);
    return {
      selector: d.selector,
      property: d.property,
      tint: ref ? '--' + ref[1].slice(2) : null,
      tintDeclared: !!(ref && declared.has(ref[1])),
      inkDeclared: !!(ref && declared.has(ref[1] + '-ink')),
    };
  });
  assert.deepEqual(paired.filter((p) => p.property !== 'color').map((p) => p.selector), [],
    'a status tone sets something other than the text colour');
  assert.deepEqual(paired.filter((p) => !p.tint).map((p) => p.selector), [],
    'a status tone is painted in something that is not the -ink of a tone');
  assert.deepEqual(paired.filter((p) => !p.tintDeclared || !p.inkDeclared).map((p) => p.selector),
    [], 'a status tone names a tone aria.css does not declare both halves of');
  console.log('status tones judged: ' + JSON.stringify({
    tones: paired.length, pairs: paired.filter((p) => p.tintDeclared && p.inkDeclared).length,
  }));
});

/* --------------------------------------- the one exception, and its reason */

/* WCAG relative luminance and contrast ratio, sRGB. Proved against two
   published figures before anything below is believed. */
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c) =>
  0.2126 * channel(c[0] / 255) + 0.7152 * channel(c[1] / 255) + 0.0722 * channel(c[2] / 255);
const ratio = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)]
    : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const rgbOf = (hex) => {
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((c) => c + c).join('') : body;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
/* CSS color-mix(in srgb, ...) and linear-gradient() both interpolate in
   gamma-encoded sRGB, which is componentwise on the 0-255 values. */
const blend = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

/* The two theme blocks aria.css declares, with one level of var() resolved:
   the dark theme writes --cyan-ink: var(--cyan) and the light one writes a
   hex. A token that is not an opaque hex -- --line is an rgba() -- comes back
   null.

   `readable` is the set the AA sweep below can actually try: a null is NOT a
   rejection, and scoring it as one is how the sweep used to report "no token
   could have made this ink" while never having looked at thirteen of them.
   UNREADABLE_TOKENS names every one it cannot read, so a new token in a
   spelling this resolver does not handle fails the suite instead of being
   silently counted as tried (found in the fourth review of
   antonyrugama/aria-website#75, with --rv-stand: rgb(0, 0, 0) -- the same
   colour as #000000, which IS read and DOES stand in). */
function themeTokens(css) {
  const rows = declarations(css).filter((d) => d.property.startsWith('--'));
  const of = (selector) => new Map(
    rows.filter((d) => d.selector === selector).map((d) => [d.property, d.value]));
  const dark = of(':root');
  const light = new Map([...dark, ...of('[data-theme="light"]')]);
  const resolve = (table, name, depth) => {
    const raw = table.get(name);
    if (!raw || (depth || 0) > 4) return null;
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
    if (ref) return resolve(table, ref[1], (depth || 0) + 1);
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? rgbOf(raw) : null;
  };
  const names = [...new Set([...dark.keys(), ...light.keys()])];
  return {
    names,
    readable: names.filter((name) => resolve(dark, name) && resolve(light, name)),
    dark: (name) => resolve(dark, name),
    light: (name) => resolve(light, name),
  };
}

/* Every token aria.css declares that the resolver above cannot turn into a
   colour, and why. deepEqual, so adding a token in an unhandled spelling is a
   red suite rather than a thirteenth silent drop. Three of these ARE colours
   -- CSS would take them in a color-mix() perfectly well; they are here
   because the resolver reads opaque hex only, not because the mix would
   refuse them. */
const UNREADABLE_TOKENS = [
  { name: '--line', why: 'a colour, but a translucent rgba()' },
  { name: '--line-2', why: 'a colour, but a translucent rgba()' },
  { name: '--edge', why: 'a colour, but a translucent rgba()' },
  { name: '--shadow-1', why: 'a shadow list: offsets, a blur and an rgba()' },
  { name: '--shadow-2', why: 'a shadow list, two of them' },
  { name: '--shadow-3', why: 'a shadow list, two of them' },
  { name: '--r-sm', why: 'a length' },
  { name: '--r', why: 'a length' },
  { name: '--r-lg', why: 'a length' },
  { name: '--r-xl', why: 'a length' },
  { name: '--rail', why: 'a length' },
  { name: '--sans', why: 'a font stack' },
  { name: '--mono', why: 'a font stack' },
];

/* The only raw colour word the sheet is allowed. Spelled out so that changing
   the exception to a different keyword fails here rather than going
   unmeasured. */
const KEYWORD_RGB = { black: [0, 0, 0] };

test('the avatar ink is the one paint no aria.css token could have made', () => {
  assert.equal(Math.round(ratio(rgbOf('#000000'), rgbOf('#ffffff'))), 21,
    'the contrast formula does not reproduce black on white');
  assert.equal(ratio(rgbOf('#777777'), rgbOf('#ffffff')).toFixed(2), '4.48',
    'the contrast formula does not reproduce the published 4.48:1 of #777 on white');

  const sheet = declarations(PANE_CSS).filter((d) => d.selector === '.av');
  const ink = sheet.filter((d) => d.property === 'color').map((d) => d.value);
  const tile = sheet.filter((d) => d.property === 'background').map((d) => d.value);
  assert.equal(ink.length, 1, '.av declares ' + ink.length + ' inks');
  assert.equal(tile.length, 1, '.av declares ' + tile.length + ' backgrounds');

  const mixed = /^color-mix\(in srgb, var\((--[\w-]+)\) ([\d.]+)%, ([a-z]+)\)$/.exec(ink[0]);
  assert.ok(mixed, '.av\'s ink is no longer a color-mix this test can read: ' + ink[0]);
  const [, inkToken, inkShare, inkKeyword] = mixed;
  assert.ok(KEYWORD_RGB[inkKeyword], '.av mixes toward ' + inkKeyword + ', which has no value here');
  assert.deepEqual(
    NON_TOKEN_PAINT.filter((p) => p.selector === '.av'),
    [{ selector: '.av', property: 'color', atom: inkKeyword, inside: 'color-mix' }],
    'the exception the sheet paints and the exception pinned above have come apart');

  /* The docblock names the token this ink mixes. It named `var(--cyan)` while
     nothing checked it, so swapping the sheet to another token left the
     sentence standing and green (Stadiora/Aria#10632). */
  const named = machineLine('AVATAR INK TOKEN').exec(PANE_CSS);
  assert.ok(named, 'the sheet\'s docblock no longer names the token .av\'s ink mixes');
  assert.equal(named[1].trim(), inkToken,
    'the docblock says .av\'s ink mixes ' + named[1].trim() + ' and the sheet mixes ' + inkToken);

  const stops = (tile[0].match(/var\(\s*--[\w-]+\s*\)/g) || [])
    .map((v) => /--[\w-]+/.exec(v)[0]);
  assert.equal(stops.length, 2, '.av\'s tile is no longer a two-stop gradient of tokens');
  /* "The avatar tile is an opaque gradient of that same token": the ink is
     mixed FROM the tile's own colour, which is why the exception is about
     that token rather than about cyan by name. */
  assert.ok(stops.includes(inkToken),
    '.av\'s ink mixes ' + inkToken + ', which is not one of its tile\'s own stops ('
    + stops.join(', ') + '), so the docblock\'s "a gradient of that same token" is false');

  const tokens = themeTokens(ARIA_CSS);
  const AA = 4.5;

  /* The darkest point of the gradient, sampled rather than argued: luminance
     is convex along an sRGB interpolation, so the minimum is not always an
     endpoint. */
  const worstTile = (theme) => {
    const ends = stops.map((name) => {
      const value = tokens[theme](name);
      assert.ok(value, 'aria.css declares no opaque value for ' + name + ' in ' + theme);
      return value;
    });
    let worst = null;
    for (let i = 0; i <= 100; i += 1) {
      const point = blend(ends[0], ends[1], i / 100);
      if (!worst || luminance(point) < luminance(worst)) worst = point;
    }
    return worst;
  };

  const share = Number(inkShare) / 100;
  const reached = {};
  for (const theme of ['dark', 'light']) {
    const base = tokens[theme](inkToken);
    assert.ok(base, 'aria.css declares no opaque value for ' + inkToken + ' in ' + theme);
    const painted = blend(KEYWORD_RGB[inkKeyword], base, share);
    reached[theme] = ratio(painted, worstTile(theme));
    assert.ok(reached[theme] >= AA,
      'the avatar ink reaches only ' + reached[theme].toFixed(2) + ':1 in ' + theme
      + ' against the darkest point of its own tile');
  }

  /* And the reason the exception exists: every token aria.css declares, tried
     in the same mix, in both themes. The tile is opaque in both, so what is
     behind the card cannot rescue any of them. */
  /* The sweep's EXTENT, not only its verdict: "the same test tries every one
     of them" is green over an empty list too, so the candidate set is pinned
     before it is filtered -- and pinned on the tokens actually TRIED, not on
     the tokens declared, which is a number thirteen unreadable tokens cannot
     move. Every name the resolver drops is enumerated and named, rather than
     described by a category. */
  const notRead = tokens.names.filter((name) => !tokens.readable.includes(name));
  assert.deepEqual(notRead.slice().sort(), UNREADABLE_TOKENS.map((t) => t.name).sort(),
    'aria.css declares a token this resolver cannot read and UNREADABLE_TOKENS does not '
    + 'name, so the sweep would score it as rejected without ever trying it');
  const sweep = { declared: tokens.names.length, tried: tokens.readable.length,
    notRead: notRead.length };
  assert.deepEqual(sweep, { declared: 33, tried: 20, notRead: 13 });
  console.log('avatar ink sweep judged: ' + JSON.stringify(sweep));

  const couldStandIn = tokens.readable.filter((name) => ['dark', 'light'].every((theme) => {
    const toward = tokens[theme](name);
    const base = tokens[theme](inkToken);
    assert.ok(toward && base, 'a token on the readable list did not resolve: ' + name);
    return ratio(blend(toward, base, share), worstTile(theme)) >= AA;
  }));
  assert.deepEqual(couldStandIn, [],
    'aria.css now declares a token that could paint this ink, so the exception in the '
    + 'sheet\'s docblock has an answer and should be taken: ' + couldStandIn.join(', '));
});
