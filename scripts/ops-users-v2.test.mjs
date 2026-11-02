/* Look up a user: what the pane paints, which state it is in, and what it
   will and will not put on screen.

   scripts/ops-pane-users.test.mjs is the older file and stays. It lifts
   fieldValue out of the module and drives it directly, which is the right
   instrument for the masking floors. This file loads the page the way
   ops/users.html does and drives the whole pane through the real shell.

   What it asserts, in the order it asserts it:
     - the header's hand-off, and the form refusing an empty search
     - the four states, and the one fact that separates live from degraded
     - masking and reveal, both ways: owner and not, reason and none, a
       recorded reveal and an unrecorded one, and every way a value goes back
       behind its mask
     - the access history, the activity links and the subscription card
     - the match picker: four channels of selection, and the count check
     - the three narrowings: they reach the lookup, and a change invalidates
       what was already on screen
     - the rail names no destination, and the page is lean

   What it cannot assert. Node has no layout engine, so nothing here says a
   rule wins the cascade, that a line fits at 320px, or what is painted; the
   one stylesheet test only says a rule EXISTS for the class the pane gains.
   The rendered claims are in scripts/ops-users-rendered.test.mjs, in the
   guards in scripts/check-ops-*.mjs, and in the screenshots on the pull
   request. Focus movement is exercised but its destination is not asserted:
   the stub's focus() sets document.activeElement and nothing more. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const readFile = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = readFile('assets/pane-registry.js');
const ARIA_SRC = readFile('assets/aria.js');
const SHELL_SRC = readFile('assets/shell-pane-v2.js');
const PANE_SRC = readFile('assets/pane-users.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const ORIGIN = 'https://ops.example.invalid';
const HREF = ORIGIN + '/ops/users.html';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 20, 6, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();

/* The value that must never reach the screen on its own. Every fixture that
   carries a real personal value carries this one, so one assertion covers
   every path a disclosure could take. */
const SECRET = 'athlete@example.invalid';

/* ------------------------------------------------------------- fixtures */

function lookupFixture(over) {
  const base = {
    recorded: { at: ago(1000), actor: 'ops_owner_1', fields: 'identifier', reason: 'SUP-4471' },
    matchCount: 1,
    matches: [
      {
        reference: 'usr-2277',
        maskedEmail: 'a•••@example.invalid',
        state: { key: 'active', label: 'Active', tone: 'ok' },
        tier: { key: 'pro', label: 'Pro', brand: true },
        platforms: ['iOS'],
        lastActiveAt: ago(3 * 3_600_000),
        flags: [],
      },
    ],
  };
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
}

const plain = (key, label, value) => ({ key, label, masked: false, value });

function detailFixture(over) {
  const base = {
    reference: 'usr-2277',
    kind: 'athlete',
    state: { key: 'active', label: 'Active', tone: 'ok' },
    tier: { key: 'pro', label: 'Pro', brand: true },
    memberSince: '2026-08-30T10:00:00.000Z',
    recorded: { at: ago(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
    summary: {
      fields: [
        { key: 'email', label: 'Email', masked: true, maskedValue: 'a•••@example.invalid', reveal: 'allowed' },
        { key: 'displayName', label: 'Name', masked: true, maskedValue: 'A••• R•••', reveal: 'allowed' },
        { key: 'weight', label: 'Weight', masked: true, reveal: 'never' },
        plain('authProvider', 'Sign-in method', 'apple'),
        plain('emailVerified', 'Email verified', 'Verified'),
        plain('locale', 'Locale', 'es-ES'),
      ],
    },
    activity: {
      windowDays: 30,
      events: [
        { occurredAt: ago(3 * 3_600_000), label: 'Chat reply', tone: 'ok', reference: 'run_88214', href: '/ops/run-history.html' },
        { occurredAt: ago(9 * 3_600_000), label: 'Nutrition plan', tone: 'warn', reference: 'run_87744', href: 'https://elsewhere.example.invalid/x' },
      ],
    },
    devices: [{ label: 'iPhone', appVersion: '1.1.2', os: 'iOS 18.2', lastSeenAt: ago(2 * 3_600_000) }],
    billing: {
      fields: [
        plain('tier', 'Tier', 'pro'),
        plain('billingStatus', 'Subscription status', 'active'),
        plain('billingPlatform', 'Store', 'apple'),
        plain('billingCycle', 'Billing cycle', 'monthly'),
        plain('currentPeriodStart', 'Period start', '2026-09-12T00:00:00.000Z'),
        plain('currentPeriodEnd', 'Period end', '2026-10-12T00:00:00.000Z'),
      ],
    },
    access: {
      windowDays: 90,
      entries: [
        { occurredAt: ago(2 * DAY), actor: 'ops_owner_1', fields: 'Email', reason: 'SUP-4471', revealed: true },
        { occurredAt: ago(5 * DAY), actor: 'ops_operator_2', fields: 'Summary only', reason: 'SUP-4390', revealed: false },
      ],
    },
    supportActions: { available: [] },
  };
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'users');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

const flush = async (n = 8) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

/* Loads the page the way ops/users.html loads it.

   `answers` is a list of { match, data } or { match, error }, consulted in
   order for every session.call. A call nothing matches is a test that asked
   for something the pane does not request, so it throws rather than resolving
   to an empty object: an unmatched route resolving to {} is the shape that
   makes a pane look like it read something it never asked for. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = opts.answers || [];

  const dom = makeDom({ tokens: TOKENS, href: opts.href || HREF, runTimers: opts.runTimers });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  /* The stub document has no contains(); the pane asks it whether the control
     that held focus is still in the tree before moving focus back to it. */
  dom.doc.contains = (node) => dom.root.contains(node);
  buildPage(dom, body);

  /* The header's search hands its text over through sessionStorage, before
     this page loads. */
  if (opts.handedOver) dom.window.sessionStorage.setItem('ops-user-lookup', opts.handedOver);

  /* A browser ignores focus() on anything it is hiding, and the application is
     hidden until the shell opens the gate. The stub's focus() always works, so
     `blindWhileBooting` makes it ignore the call the way the browser does. */
  if (opts.blindWhileBooting) {
    let active = null;
    Object.defineProperty(dom.doc, 'activeElement', {
      configurable: true,
      get() { return active; },
      set(el) { if (!/\bis-booting\b/.test(String(body.className))) active = el; },
    });
  }

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: opts.role || 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, method: (o && o.method) || 'GET', body: o && o.body, query: o && o.query });
      const hit = answers.find((a) => a.match.test(endpoint));
      if (!hit) throw new Error('no fixture for ' + endpoint);
      if (hit.pending) return new Promise(() => {});
      /* A call that is still out when the next thing happens. `pending` never
         resolves, which cannot test what a late response does; this hands the
         test the resolve function so it can land one deliberately. */
      if (hit.defer) return new Promise((resolve) => { hit.defer.release = () => resolve({ data: hit.data }); });
      if (hit.error) return Promise.reject(hit.error);
      return Promise.resolve({ data: hit.data });
    },
    signOut: () => Promise.resolve(),
    role: () => opts.role || 'owner',
    hasRole: (roles) => roles.indexOf(opts.role || 'owner') !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  dom.window.Date = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(NOW);
      else super(...args);
    }

    static now() { return NOW; }
  };
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });

  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (s) {
    states.push(String(s));
    return applyState.call(dom.window.Aria, s);
  };

  const announced = [];
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-users.js' });
  const announce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = function (message) {
    announced.push(String(message));
    return announce.call(dom.window.OpsPaneShell, message);
  };

  await flush();

  return { ...dom, body, calls, states, announced, content: dom.doc.getElementById('content') };
}

const field = (dom, id) => dom.doc.getElementById(id);

/* Runs the search the way a person does: type, then submit the form. */
async function lookUp(dom, identifier = 'usr-2277', reason = 'SUP-4471') {
  field(dom, 'lookupIdentifier').value = identifier;
  field(dom, 'lookupReason').value = reason;
  dom.doc.querySelector('.u-find').dispatch('submit');
  await flush();
}

/* The happy path: a lookup that matches one account, which the pane opens for
   you because one match is not a choice. */
async function openAccount(options) {
  const opts = options || {};
  const dom = await boot({
    role: opts.role,
    runTimers: opts.runTimers,
    answers: [
      { match: /\/reveal$/, ...(opts.reveal || { data: {} }) },
      { match: /\/lookup$/, data: opts.lookup === undefined ? lookupFixture() : opts.lookup },
      { match: /\/users\//, data: opts.detail === undefined ? detailFixture() : opts.detail },
    ],
  });
  await lookUp(dom, opts.identifier, opts.reason);
  return dom;
}

/* ---------------------------------------------------------------- probes */

function panel(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').includes(state))[0];
}

function shownState(dom) {
  const applied = dom.states[dom.states.length - 1];
  const on = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => n.hasAttribute('data-shown'));
  assert.equal(on.length, 1, 'exactly one panel is shown');
  assert.ok((on[0].getAttribute('data-state') || '').split(' ').includes(applied),
    `the shown panel belongs to ${applied}`);
  return applied;
}

const liveText = (dom) => allText(panel(dom, 'live'));
const emptyText = (dom) => allText(panel(dom, 'empty'));

const hasClass = (node, cls) => (node.className || '').split(/\s+/).includes(cls);

/* Text a person can read. `.hidden` is display:none in the pane's stylesheet
   and allText walks the whole subtree, so a probe built on allText would be
   wrong in BOTH directions on the one row that matters: it would read a mask
   the browser has hidden, and it would read a revealed value the browser has
   hidden. The stylesheet claim is asserted below rather than assumed. */
function visibleText(node) {
  if (!node) return '';
  if (node.tagName && hasClass(node, 'hidden')) return '';
  const own = node.textContent || '';
  const kids = (node.childNodes || []).map(visibleText).join(' ');
  return (own + ' ' + kids).replace(/\s+/g, ' ').trim();
}

test('the probe above is faithful: .hidden really is display:none, under the reveal form', () => {
  const css = readFile('assets/pane-users-v2.css');
  assert.match(css, /^\.hidden \{ display: none; \}$/m);
  assert.match(css, /^\.users \.hidden \{ display: none; \}$/m);
});

function byClass(root, cls) {
  return findAll(root, (n) => hasClass(n, cls));
}

/* One card, found by the text of its head. Whole-pane text is the wrong
   instrument for a claim about one card. */
function card(dom, title) {
  return byClass(panel(dom, 'live'), 'card').find((box) => {
    const head = byClass(box, 'card-title')[0];
    return head && allText(head).trim() === title;
  });
}

const cardText = (dom, title) => {
  const box = card(dom, title);
  assert.ok(box, `no card titled ${title}`);
  return allText(box);
};

const buttons = (root) => findAll(root, (n) => n.tagName === 'BUTTON');

/* One labelled row of a card: the div holding a dt with that text. */
function rowOf(dom, label) {
  return findAll(panel(dom, 'live'), (n) => n.tagName === 'DIV' &&
    n.childNodes.some((c) => c.tagName === 'DT' && allText(c).trim() === label))[0];
}

async function reveal(dom, label, reason = 'checking the bounce reason') {
  const row = rowOf(dom, label);
  assert.ok(row, `no row for ${label}`);
  const open = buttons(row).find((b) => allText(b).trim() === 'Reveal');
  assert.ok(open, `no Reveal control on ${label}`);
  open.dispatch('click');
  findAll(row, (n) => n.tagName === 'INPUT')[0].value = reason;
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  return row;
}

const revealAnswer = (over) => ({
  data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 600_000).toISOString(), recorded: {}, ...over },
});

/* ============================ the header's hand-off ====================== */

test('a search handed over from another page fills the account and puts the cursor in the reason once the page is open', async () => {
  const dom = await boot({ handedOver: 'usr-2277', blindWhileBooting: true });
  assert.equal(field(dom, 'lookupIdentifier').value, 'usr-2277');
  assert.equal(field(dom, 'lookupReason').value, '', 'a handed-over search was run without a reason');
  assert.equal(dom.doc.activeElement, field(dom, 'lookupReason'),
    'the reason field does not have the cursor once the page is open: it was focused behind the ready gate, where a browser drops it, or never');
  assert.equal(dom.calls.length, 0, 'handing a search over ran it');
});

test('a search handed over while the pane is already open focuses the reason straight away, once', async () => {
  const dom = await boot({ blindWhileBooting: true });
  assert.notEqual(dom.doc.activeElement, field(dom, 'lookupReason'));
  dom.window.sessionStorage.setItem('ops-user-lookup', 'usr-9001');
  dom.window.dispatchEvent(new dom.window.CustomEvent('ops:lookup'));
  assert.equal(field(dom, 'lookupIdentifier').value, 'usr-9001');
  assert.equal(dom.doc.activeElement, field(dom, 'lookupReason'));
});

test('a page opened with nothing handed over leaves the cursor alone', async () => {
  const dom = await boot({ blindWhileBooting: true });
  assert.equal(field(dom, 'lookupIdentifier').value, '');
  assert.notEqual(dom.doc.activeElement, field(dom, 'lookupReason'));
});

test('a search with no account, or no reason, sends nothing and marks the field it is complaining about', async () => {
  const dom = await boot({ answers: [] });
  const form = dom.doc.querySelector('.u-find');

  form.dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, 0);
  assert.equal(field(dom, 'lookupIdentifier').getAttribute('aria-invalid'), 'true');
  assert.equal(field(dom, 'lookupReason').getAttribute('aria-invalid'), null);
  assert.match(allText(byClass(form, 'field-error')[0]), /Enter an account/);

  field(dom, 'lookupIdentifier').value = 'usr-2277';
  field(dom, 'lookupReason').value = 'ab';
  form.dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, 0, 'a two-character reason was sent');
  assert.equal(field(dom, 'lookupIdentifier').getAttribute('aria-invalid'), null,
    'the account is marked wrong after it was filled in');
  assert.equal(field(dom, 'lookupReason').getAttribute('aria-invalid'), 'true');
  assert.match(allText(byClass(form, 'field-error')[0]), /Add a reason/);
});

/* ============================================================ the states */

test('nothing looked up yet is the empty state, and asks for the two things a lookup needs', async () => {
  const dom = await boot({ answers: [] });
  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /Nothing looked up yet/);
  assert.match(emptyText(dom), /reference or email, and a reason/);
  assert.equal(dom.calls.length, 0);
});

test('a lookup in flight is the loading state', async () => {
  const dom = await boot({ answers: [{ match: /\/lookup$/, pending: true }] });
  await lookUp(dom);
  assert.equal(shownState(dom), 'loading');
});

test('no account matching is the empty state, echoing what was asked for as a coded reference', async () => {
  const dom = await boot({
    answers: [{ match: /\/lookup$/, data: lookupFixture((d) => { d.matches = []; d.matchCount = 0; }) }],
  });
  await lookUp(dom, 'usr-9914');
  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /No account found/);
  assert.match(emptyText(dom), /Matches are exact/);
  assert.deepEqual(byClass(panel(dom, 'empty'), 'code').map((n) => allText(n)), ['usr-9914']);
  assert.ok(dom.announced.includes('No account found'));
});

test('an account on screen with both access records confirmed is live, and says nothing about recording', async () => {
  const dom = await openAccount();
  assert.equal(shownState(dom), 'live');
  assert.match(liveText(dom), /usr-2277/);
  assert.ok(!/No record confirmed/.test(liveText(dom)), 'a confirmed record drew a warning');
  assert.equal(byClass(panel(dom, 'live'), 'note-warn').length, 0);
});

/* The one fact that separates live from degraded here. A pane that has
   somebody's record on screen and could not confirm the access record every
   lookup is meant to write is half-read, not healthy, and the two are the same
   markup, so nothing that reads the DOM could tell them apart. */
test('an account whose lookup confirmed no access record is degraded, and says so', async () => {
  const dom = await openAccount({ lookup: lookupFixture((d) => { delete d.recorded; }) });
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /No record confirmed/);
  assert.match(liveText(dom), /for this lookup/);
});

test('an account whose own open confirmed no access record is degraded too, and announced as such', async () => {
  const dom = await openAccount({ detail: detailFixture((d) => { delete d.recorded; }) });
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /for opening this account/);
  assert.ok(dom.announced.some((m) => /opened, with no record confirmed/.test(m)));
  assert.ok(!dom.announced.some((m) => /opened and recorded/.test(m)));
});

test('a lookup that failed is degraded with the reason and a retry that runs it again', async () => {
  const err = Object.assign(new Error('The lookup service did not answer.'), { code: 'ops_unavailable' });
  const dom = await boot({ answers: [{ match: /\/lookup$/, error: err }] });
  await lookUp(dom);
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /Could not look that up/);
  assert.match(liveText(dom), /The lookup service did not answer/);

  const again = buttons(panel(dom, 'live')).find((b) => allText(b).trim() === 'Try again');
  assert.ok(again, 'no retry');
  again.dispatch('click');
  await flush();
  assert.equal(dom.calls.length, 2, 'Try again did not look up again');
});

test('a deployment with no lookup route says there is no API, not that nothing matched', async () => {
  const err = Object.assign(new Error('no route'), { code: 'ops_route_missing' });
  const dom = await boot({ answers: [{ match: /\/lookup$/, error: err }] });
  await lookUp(dom);
  assert.match(liveText(dom), /No API yet/);
  assert.ok(!/No account found/.test(liveText(dom)));
});

/* ================================================== masking and reveal */

test('a masked field is not on screen and its value is not in the page, whatever the payload carries', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      /* The payload a careless server sends: the mask AND the value. The pane
         must print neither the value nor anything derived from it. */
      d.summary.fields[0].value = SECRET;
      d.summary.fields[1].value = 'Athlete Roe';
    }),
  });
  assert.ok(!liveText(dom).includes(SECRET), 'the raw email reached the screen');
  assert.ok(!liveText(dom).includes('Athlete Roe'), 'the raw name reached the screen');
  assert.match(cardText(dom, 'Account'), /a•••@example\.invalid/);
});

test('a recorded reveal puts the value on screen, takes the mask off, and says when it hides', async () => {
  const dom = await openAccount({ runTimers: false, reveal: revealAnswer({ expiresAt: new Date(NOW + 60_000).toISOString(), recorded: { at: ago(0), actor: 'ops_owner_1' } }) });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'a recorded reveal did not show the value');
  assert.ok(!visibleText(row).includes('a•••@example.invalid'), 'the mask is still on screen beside the value');
  assert.match(visibleText(row), /Hides in 60 seconds · Logged/);
  assert.ok(buttons(row).some((b) => !hasClass(b, 'hidden') && allText(b).trim() === 'Hide'));
  assert.ok(dom.announced.includes('Email revealed and recorded'));
});

test('an owner gets a live Reveal control and nobody else does', async () => {
  const owner = await openAccount({ role: 'owner' });
  const live = buttons(rowOf(owner, 'Email')).find((b) => allText(b).trim() === 'Reveal');
  assert.ok(live, 'an owner got no Reveal control');
  /* The attribute, not the property: the pane writes the attribute, and the
     stub's plain `disabled` field would read false for a control the pane had
     plainly disabled. */
  assert.equal(live.getAttribute('disabled'), null, 'an owner got a dead control');
  assert.ok(!allText(rowOf(owner, 'Email')).includes('Owner action'));

  for (const role of ['operator', 'viewer']) {
    const dom = await openAccount({ role });
    const row = rowOf(dom, 'Email');
    const dead = buttons(row).find((b) => allText(b).trim() === 'Reveal');
    assert.ok(dead, `no placeholder control at role ${role}`);
    assert.equal(dead.getAttribute('disabled'), 'disabled', `the control is live at role ${role}`);
    assert.match(allText(row), /Owner action/);
  }
});

test('a blank reason sends nothing and a written one is sent, carrying the field and the reason and no value', async () => {
  const dom = await openAccount({ runTimers: false, reveal: revealAnswer() });
  const before = dom.calls.length;

  const row = rowOf(dom, 'Email');
  buttons(row).find((b) => allText(b).trim() === 'Reveal').dispatch('click');
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, before, 'a reveal with no reason was sent anyway');
  assert.match(visibleText(row), /Add a reason/);
  assert.ok(!visibleText(row).includes(SECRET));

  findAll(row, (n) => n.tagName === 'INPUT')[0].value = 'SUP-4471 bounce check';
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, before + 1, 'a written reason was not sent');

  const sent = dom.calls[dom.calls.length - 1];
  assert.equal(sent.endpoint, '/api/ops/users/usr-2277/reveal');
  assert.equal(sent.method, 'POST');
  /* Key by key rather than deepEqual: the body is built inside the vm realm,
     so its prototype is not this realm's Object. Listing the keys is the
     assertion that matters anyway — it is what fails if a value ever joins
     the field name in the request. */
  assert.deepEqual(Object.keys(sent.body).sort(), ['field', 'reason']);
  assert.equal(sent.body.field, 'email');
  assert.equal(sent.body.reason, 'SUP-4471 bounce check');
});

test('a reveal the API did not record says so beside the value, and so does the announcement', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 60_000).toISOString() } },
  });
  const row = await reveal(dom, 'Email');
  assert.match(visibleText(row), /Hides in 60 seconds · No record confirmed/);
  assert.ok(dom.announced.includes('Email revealed, with no record confirmed'));
});

test('a reveal with no readable expiry gets the ceiling, and says the page chose it', async () => {
  const dom = await openAccount({ runTimers: false, reveal: revealAnswer({ expiresAt: { not: 'a time' } }) });
  const row = await reveal(dom, 'Email');
  assert.match(visibleText(row), /Hides in 60 seconds \(page limit\) · Logged/);
});

test('a health field carries no row and no control, and its value is never printed, whatever the payload says', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.summary.fields[2] = { key: 'weight', label: 'Weight', masked: false, reveal: 'allowed', value: '72.4 kg' };
    }),
  });
  assert.ok(!liveText(dom).includes('72.4'), 'a health value reached the screen');
  assert.equal(rowOf(dom, 'Weight'), undefined, 'a health field drew a row');
});

test('a revealed value re-masks when its time is up, and the access history still holds the entry', async () => {
  /* runTimers defaults to firing every timer the moment it is set, so this
     reveal expires inside the same tick it landed. */
  const dom = await openAccount({ reveal: revealAnswer({ expiresAt: new Date(NOW + 60_000).toISOString() }) });
  const row = await reveal(dom, 'Email');
  assert.ok(!visibleText(row).includes(SECRET), 'the expiry did not re-mask the field');
  assert.ok(visibleText(row).includes('a•••@example.invalid'), 'the expiry left no mask behind');
  assert.ok(dom.announced.includes('Email hidden again automatically'));
  assert.match(cardText(dom, 'Access history'), /ops_owner_1/);
});

test('Hide re-masks the field it belongs to', async () => {
  const dom = await openAccount({ runTimers: false, reveal: revealAnswer() });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET));
  buttons(row).find((b) => allText(b).trim() === 'Hide').dispatch('click');
  assert.ok(!visibleText(row).includes(SECRET), 'Hide left the value on screen');
  assert.ok(visibleText(row).includes('a•••@example.invalid'), 'Hide left no mask behind');
  assert.ok(dom.announced.includes('Email hidden again'));
});

/* Three mechanisms keep the re-mask promise between them — the repaint that
   replaces the old result, clearReveals() hiding what is on screen, and
   clearReveals() cancelling what is still in flight — and they are tested
   apart because a test covering all three is pinned by whichever one happens
   to act first. Both tests below make the SECOND lookup return two matches:
   one match is opened for you, and that open is a third clearReveals() which
   would stand in for whichever one a mutation removed. */
function twoMatches() {
  return lookupFixture((d) => {
    d.matchCount = 2;
    d.matches = [d.matches[0], { ...d.matches[0], reference: 'usr-9001' }];
  });
}

test('a new lookup replaces what is on screen, so a value revealed under the old account goes with it', async () => {
  const lookup = { match: /\/lookup$/, data: lookupFixture() };
  const dom = await boot({
    runTimers: false,
    answers: [{ match: /\/reveal$/, ...revealAnswer() }, lookup, { match: /\/users\//, data: detailFixture() }],
  });
  await lookUp(dom);
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'the reveal never landed, so this proves nothing');

  lookup.data = twoMatches();
  await lookUp(dom, 'usr-22', 'SUP-4471 second look');
  assert.ok(!liveText(dom).includes(SECRET), 'a revealed value survived a new lookup');
  assert.ok(!dom.root.contains(row), 'the account opened under the old lookup is still in the document');
  assert.ok(!visibleText(row).includes(SECRET), 'the replaced row still holds the value it was shown');
});

test('a reveal still out when a new lookup starts is cancelled: nothing lands, nothing is announced', async () => {
  const defer = {};
  const lookup = { match: /\/lookup$/, data: lookupFixture() };
  const dom = await boot({
    answers: [{ match: /\/reveal$/, defer, ...revealAnswer() }, lookup, { match: /\/users\//, data: detailFixture() }],
  });
  await lookUp(dom);
  const row = await reveal(dom, 'Email');
  assert.equal(typeof defer.release, 'function', 'the reveal request was never made');
  assert.ok(!visibleText(row).includes(SECRET), 'the response landed before it was meant to');

  lookup.data = twoMatches();
  await lookUp(dom, 'usr-22', 'SUP-4471 second look');
  defer.release();
  await flush();

  assert.ok(!liveText(dom).includes(SECRET), 'a late reveal put a value on the new screen');
  assert.deepEqual(dom.announced.filter((m) => /revealed/.test(m)), [],
    'a reveal abandoned by a new lookup announced itself anyway');
  /* The stub's setTimeout is fire-or-drop and records nothing, so the timer
     is observed through the only thing it does: with runTimers left on, an
     armed re-mask runs immediately and announces itself. */
  assert.deepEqual(dom.announced.filter((m) => /hidden again/.test(m)), [],
    'a reveal abandoned by a new lookup armed a re-mask timer');
});

/* ================================================== the records on screen */

test('the access history is on the page with nothing pressed, and a revealed entry carries a word', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Access history');
  assert.ok(box, 'the access history is not on the page');
  const text = allText(box);
  assert.match(text, /ops_owner_1/);
  assert.match(text, /ops_operator_2/);
  assert.match(text, /SUP-4390/);

  const marks = byClass(box, 'u-revealed');
  assert.equal(marks.length, 1, 'exactly the revealed entry is marked');
  assert.match(allText(marks[0]), /Revealed Email/);
  assert.equal(marks[0].querySelectorAll('svg').length, 1, 'the mark carries no glyph');
  assert.ok(!/Revealed/.test(allText(box).replace(allText(marks[0]), '')),
    'an entry that revealed nothing is marked as if it had');
});

test('an event prints its label and time and links only to this dashboard, and nothing else it carries', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.activity.events[0].body = 'what the athlete actually typed';
      d.activity.events[0].reply = 'what Aria actually answered';
    }),
  });
  const box = card(dom, 'Recent activity');
  const links = findAll(box, (n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'expected exactly one link');
  assert.equal(links[0].getAttribute('href'), '/ops/run-history.html');
  assert.match(allText(box), /Nutrition plan/, 'an off-origin event lost its label');
  assert.ok(!allText(box).includes('elsewhere'));
  assert.ok(!allText(box).includes('what the athlete actually typed'));
  assert.ok(!allText(box).includes('what Aria actually answered'));
});

test('the subscription card reads the billing record as words, and an empty one names the tier and nothing more', async () => {
  const dom = await openAccount();
  const text = cardText(dom, 'Subscription');
  assert.match(text, /Tier\s*Pro/);
  assert.match(text, /Status\s*Active/);
  assert.match(text, /Store\s*App Store/);
  assert.match(text, /Cycle\s*Monthly/);
  assert.match(text, /Period\s*Sep 12–Oct 12/);
  assert.match(text, /Access until\s*Oct 12/);

  /* Whole text per arm, so the card cannot drop the tier's name and cannot add
     a classification of the account in a spelling a predicate did not expect. */
  const empty = async (tier) => allText(card(await openAccount({
    detail: detailFixture((d) => { d.billing = { fields: [] }; if (tier === null) delete d.tier; else d.tier = tier; }),
  }), 'Subscription'));
  assert.equal(await empty({ key: 'free', label: 'Free' }), 'Subscription No subscription · Free');
  assert.equal(await empty({ key: 'coach_team', label: 'Coach team' }), 'Subscription No subscription · Coach team');
  assert.equal(await empty(null), 'Subscription No subscription');
});

test('what the API did not send is said as not shared or not reported, not drawn as an empty list', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      delete d.activity;
      delete d.access;
      d.devices = [{ label: 'iPhone', appVersion: null, os: 'iOS 26', lastSeenAt: ago(3_600_000) }];
    }),
  });
  assert.match(cardText(dom, 'Recent activity'), /Not shared/);
  assert.match(cardText(dom, 'Access history'), /Not reported/);
  assert.match(cardText(dom, 'Devices'), /App version\s*Not reported/);
  assert.equal(byClass(card(dom, 'Access history'), 'u-log').length, 0);

  const quiet = await openAccount({
    detail: detailFixture((d) => { d.activity.events = []; d.access.entries = []; d.devices = []; }),
  });
  assert.match(cardText(quiet, 'Recent activity'), /No activity/);
  assert.match(cardText(quiet, 'Access history'), /No access recorded/);
  assert.match(cardText(quiet, 'Devices'), /No device reported/);
});

test('the fields the card does not lead with are one control deeper, and still go through the reveal rules', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.summary.fields.push({ key: 'guardianEmail', label: 'Guardian email', masked: true, maskedValue: 'g•••@example.invalid', reveal: 'allowed' });
    }),
  });
  const more = byClass(card(dom, 'Account'), 'u-extra')[0];
  assert.ok(more, 'the leftover fields are nowhere');
  assert.equal(more.getAttribute('hidden'), 'hidden', 'the leftovers are open before anyone asked');
  assert.match(allText(more), /Locale\s*es-ES/);
  const guardian = findAll(more, (n) => n.tagName === 'DIV' &&
    n.childNodes.some((c) => c.tagName === 'DT' && allText(c).trim() === 'Guardian email'))[0];
  assert.ok(buttons(guardian).some((b) => allText(b).trim() === 'Reveal'), 'a leftover personal field lost its reveal');
  assert.ok(!allText(more).includes(SECRET));

  const toggle = buttons(card(dom, 'Account')).find((b) => allText(b).trim() === 'More');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(more.getAttribute('hidden'), null);
  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('hidden'), 'hidden', 'the toggle opened the leftovers and never closed them');
});

test('the head says who, in what state, since when, and takes its initial from the API\'s own mask', async () => {
  const dom = await openAccount();
  const head = byClass(panel(dom, 'live'), 'u-head')[0];
  assert.ok(head, 'no head');
  assert.equal(allText(byClass(head, 'u-ref')[0]), 'usr-2277');
  assert.match(allText(byClass(head, 'u-meta')[0]), /Active/);
  assert.match(allText(byClass(head, 'u-meta')[0]), /Pro/);
  assert.match(allText(byClass(head, 'u-meta')[0]), /Member since Aug 30/);
  assert.equal(allText(byClass(head, 'u-av')[0]).trim(), 'A');
  assert.equal(findAll(byClass(head, 'u-ro')[0], (n) => n.tagName === 'svg').length, 1);
  assert.match(allText(byClass(head, 'u-ro')[0]), /Read only/);

  /* No letter to take: a mask that is all dots, a name that cannot be
     revealed, and a payload that carries the real name beside its mask. */
  const glyphOnly = async (over) => {
    const d = await openAccount({ detail: detailFixture(over) });
    const av = byClass(panel(d, 'live'), 'u-av')[0];
    assert.equal(allText(av).trim(), '', 'the avatar carries text');
    assert.equal(av.querySelectorAll('svg').length, 1, 'the avatar has no person glyph');
  };
  await glyphOnly((d) => { d.summary.fields[1].maskedValue = '••••'; });
  await glyphOnly((d) => { d.summary.fields[1].reveal = 'unavailable'; });
  await glyphOnly((d) => { d.summary.fields = d.summary.fields.filter((f) => f.key !== 'displayName'); });

  const named = await openAccount({
    detail: detailFixture((d) => { d.summary.fields[1].value = 'Zed Roe'; }),
  });
  assert.equal(allText(byClass(panel(named, 'live'), 'u-av')[0]).trim(), 'A',
    'the avatar was taken from the value instead of the mask');
});

test('the title carries the date, in UTC, and the pane draws nothing else there', async () => {
  const dom = await boot({ answers: [] });
  const slot = dom.doc.getElementById('pageSub');
  assert.ok(slot, 'the shell drew no slot under the title');
  assert.deepEqual(byClass(slot, 'sub-date').map((n) => allText(n)), ['Sun, Sep 20, 2026']);
  assert.equal(slot.childNodes.length, 1);
});

/* ================================================================ matches */

const matchRows = (dom) => byClass(panel(dom, 'live'), 'match-row');

const rowMarks = (row) => {
  const pick = byClass(row, 'match-row-btn')[0];
  return {
    klass: hasClass(row, 'is-selected'),
    current: row.getAttribute('aria-current'),
    pressed: pick && pick.getAttribute('aria-pressed'),
    word: byClass(row, 'sel-mark').map((n) => allText(n).trim()).join(' '),
  };
};
const refsOf = (dom) => matchRows(dom).map((r) => byClass(r, 'match-row-btn')[0].getAttribute('data-ref'));

const PICKED = { klass: true, current: 'true', pressed: 'true', word: 'Selected' };
const UNPICKED = { klass: false, current: null, pressed: 'false', word: '' };

/* Three matches, so nothing is opened for the operator and so there is a row
   to move the mark OFF as well as one to move it on. */
const threeMatches = () => lookupFixture((d) => {
  d.matchCount = 3;
  d.matches = [
    d.matches[0],
    { ...d.matches[0], reference: 'usr-2419' },
    { ...d.matches[0], reference: 'usr-2530' },
  ];
});

async function pick(dom, reference) {
  const btn = findAll(panel(dom, 'live'), (n) => hasClass(n, 'match-row-btn') &&
    n.getAttribute('data-ref') === reference)[0];
  assert.ok(btn, `no control for ${reference}`);
  btn.dispatch('click');
  await flush();
  return btn;
}

const threeAnswers = (extra) => ({
  answers: [{ match: /\/lookup$/, data: threeMatches() }, extra || { match: /\/users\//, data: detailFixture() }],
});

test('one match is opened for you, not offered', async () => {
  const dom = await openAccount();
  assert.equal(matchRows(dom).length, 0, 'a single match drew a picker');
  assert.equal(dom.calls.filter((c) => /\/users\/usr-2277$/.test(c.endpoint)).length, 1);
  assert.ok(card(dom, 'Account'));
});

test('several matches are offered, and nothing is opened until one is picked', async () => {
  const dom = await boot(threeAnswers());
  await lookUp(dom);
  assert.deepEqual(refsOf(dom), ['usr-2277', 'usr-2419', 'usr-2530']);
  assert.equal(dom.calls.filter((c) => c.method === 'GET').length, 0, 'an account was opened unasked');
  assert.equal(card(dom, 'Account'), undefined);
  assert.match(liveText(dom), /Pick an account/);
  assert.match(cardText(dom, 'Matches'), /3 accounts/);
});

test('a picked match is marked in four channels, and the row it left is unmarked', async () => {
  const dom = await boot(threeAnswers());
  await lookUp(dom);
  assert.deepEqual(matchRows(dom).map(rowMarks), [UNPICKED, UNPICKED, UNPICKED],
    'a row was marked before anything was picked');

  await pick(dom, 'usr-2419');
  assert.deepEqual(matchRows(dom).map(rowMarks), [UNPICKED, PICKED, UNPICKED]);

  /* The other direction. A mark that is set and never cleared reads as three
     picked rows, and the fact the pane is trying to state — which ONE account
     everything below is describing — is then stated about all of them. */
  await pick(dom, 'usr-2530');
  assert.deepEqual(matchRows(dom).map(rowMarks), [UNPICKED, UNPICKED, PICKED]);
  assert.match(allText(matchRows(dom)[2]), /Selected/);
  assert.ok(!allText(matchRows(dom)[1]).includes('Selected'));
});

test('a picked row is marked before the account it picked has answered, and stays marked after', async () => {
  const held = {};
  const dom = await boot(threeAnswers({ match: /\/users\//, defer: held, data: detailFixture() }));
  await lookUp(dom);
  await pick(dom, 'usr-2419');

  assert.ok(byClass(panel(dom, 'live'), 'skel').length > 0,
    'the account column already landed, so this proves nothing');
  assert.deepEqual(rowMarks(matchRows(dom)[1]), PICKED);

  held.release();
  await flush();
  assert.deepEqual(rowMarks(matchRows(dom)[1]), PICKED, 'the mark did not survive the response');
  assert.ok(card(dom, 'Account'));
});

test('the class a picked row gains is a class the stylesheet has a rule for, with a wash and a rail', async () => {
  const dom = await boot(threeAnswers());
  await lookUp(dom);
  await pick(dom, 'usr-2419');

  /* Taken off the rendered rows rather than written down here, so renaming the
     class in pane-users.js and not in the stylesheet turns this red. */
  const classes = (row) => (row.className || '').split(/\s+/).filter(Boolean);
  const rows = matchRows(dom);
  const gained = classes(rows[1]).filter((c) => !classes(rows[0]).includes(c));
  assert.deepEqual(gained, ['is-selected']);

  const css = readFile('assets/pane-users-v2.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter((r) => r.selector.includes(`.${gained[0]}`));
  assert.ok(rules.length > 0, `pane-users-v2.css has no rule for .${gained[0]}, so picking a match draws nothing`);

  const declared = rules.flatMap((r) => r.body.split(';')).map((d) => d.split(':')[0].trim()).filter(Boolean);
  assert.ok(declared.includes('background'), 'the picked row has no wash');
  const rail = rules.flatMap((r) => r.body.split(';')).find((d) => d.split(':')[0].trim() === 'box-shadow');
  assert.ok(rail, 'the picked row is drawn in colour alone');
  assert.match(rail, /inset\s+[1-9]/, 'the rail has no width, so it draws nothing');
});

/* A capped array beside an uncapped count is the "no bulk listing" rule
   breached quietly, so the pane reports the disagreement rather than picking
   whichever number reads better. */
test('a match count larger than the rows sent is reported, and one that agrees draws no warning', async () => {
  const dom = await boot({
    answers: [{
      match: /\/lookup$/,
      data: lookupFixture((d) => {
        d.matchCount = 9;
        d.matches = [d.matches[0], { ...d.matches[0], reference: 'usr-2278' }];
      }),
    }],
  });
  await lookUp(dom);
  assert.match(cardText(dom, 'Matches'), /2 of 9 accounts/);
  assert.match(cardText(dom, 'Matches'), /says 9 accounts matched but sent 2/);

  const agree = await boot(threeAnswers());
  await lookUp(agree);
  assert.match(cardText(agree, 'Matches'), /3 accounts/);
  assert.ok(!cardText(agree, 'Matches').includes('but sent'));
});

/* Round 1, finding 4. The warning used to live inside the picker, and a single
   match has no picker: the pane opens the account itself. One row beside a
   count of nine is the same contradiction, and the "no bulk listing" rule is
   breached the same way, so the answer must not depend on how many rows came. */
test('one row beside a larger count is reported too, and the account is still opened for you', async () => {
  const lookup = lookupFixture((d) => { d.matchCount = 9; });
  const dom = await openAccount({ lookup });
  const text = cardText(dom, 'Matches');
  assert.match(text, /1 of 9 accounts shown/);
  assert.match(text, /says 9 accounts matched but sent 1/);
  assert.ok(card(dom, 'Account'), 'the warning stopped the account opening');
  assert.match(dom.announced.join(' | '), /1 of 9 accounts shown/, 'a screen reader was told "1 account matched"');
  assert.ok(!dom.announced.some((m) => m === '1 account matched'));
  assert.equal(dom.calls.filter((c) => c.method === 'GET').length, 1);
});

test('one row beside a count that agrees draws no Matches card and no warning', async () => {
  const dom = await openAccount();
  assert.equal(card(dom, 'Matches'), undefined, 'a single match drew a picker');
  assert.ok(!liveText(dom).includes('but sent'));
  assert.ok(dom.announced.includes('1 account matched'));
});

test('a count the API did not send as a number draws no warning', async () => {
  for (const bad of [undefined, null, 'nine', NaN]) {
    const dom = await openAccount({ lookup: lookupFixture((d) => { d.matchCount = bad; }) });
    assert.equal(card(dom, 'Matches'), undefined, `matchCount ${String(bad)} drew a card`);
  }
});

/* Round 1, finding 3. The reason is captured once at Search time, before the
   lookup is sent, because the operator may edit the field while the request is
   out. The detail GET carries that reason so the audit row for the opened
   account says why, not the router's generic fallback. */
const detailCall = (dom) => dom.calls.find((c) => c.method === 'GET' && /\/users\/[^/]+$/.test(c.endpoint));

test('a single match is opened with the reason the lookup was made under', async () => {
  const dom = await openAccount({ reason: 'SUP-4471' });
  const call = detailCall(dom);
  assert.ok(call, 'no detail call was made');
  assert.equal(call.query && call.query.reason, 'SUP-4471', 'the account was opened without the reason it was looked up for');
  assert.deepEqual(Object.keys(call.query), ['reason'], 'the detail call carried more than the reason');
});

test('a picked match is opened with the same reason, and an edit after Search does not change it', async () => {
  const dom = await boot(threeAnswers());
  await lookUp(dom, 'usr-2277', '  SUP-4471  ');
  field(dom, 'lookupReason').value = 'something else entirely';
  await pick(dom, 'usr-2419');
  const call = detailCall(dom);
  assert.equal(call.endpoint, '/api/ops/users/usr-2419');
  assert.equal(call.query && call.query.reason, 'SUP-4471', 'the pick carried a reason the lookup was not made under');
});

test('a second search replaces the reason the next account is opened with', async () => {
  const dom = await boot(threeAnswers());
  await lookUp(dom, 'usr-2277', 'SUP-1111');
  await lookUp(dom, 'usr-2277', 'SUP-2222');
  await pick(dom, 'usr-2530');
  assert.equal(detailCall(dom).query.reason, 'SUP-2222');
});

test('the reason rides the query, and the account identifier never does', async () => {
  const dom = await openAccount({ identifier: 'person@example.invalid', reason: 'SUP-4471' });
  const call = detailCall(dom);
  assert.equal(call.endpoint, '/api/ops/users/usr-2277', 'the detail route is addressed by the coded reference');
  assert.ok(!JSON.stringify(call).includes('person@example.invalid'), 'the typed identifier reached the detail call');
  assert.equal(call.body, undefined, 'a GET carried a body');
});

test('the matches show coded references and the mask the API sent, and no raw identifier', async () => {
  const lookup = lookupFixture((d) => {
    d.matchCount = 2;
    d.matches = [{ ...d.matches[0], email: SECRET }, { ...d.matches[0], reference: 'usr-2419' }];
  });
  const dom = await boot({ answers: [{ match: /\/lookup$/, data: lookup }] });
  await lookUp(dom);
  const text = cardText(dom, 'Matches');
  assert.match(text, /usr-2277/);
  assert.match(text, /a•••@example\.invalid/);
  assert.ok(!text.includes(SECRET));
});

/* ============================================================ narrowings */

test('the app list is the registry\'s, and the shell draws no App control over a pane that has its own', async () => {
  const dom = await boot({ answers: [] });
  const { SCOPES, PANES } = dom.window.OpsPaneRegistry;
  const options = findAll(field(dom, 'lookupScope'), (n) => n.tagName === 'OPTION')
    .map((o) => ({ v: o.getAttribute('value'), l: allText(o).trim() }));
  assert.equal(JSON.stringify(options), JSON.stringify(SCOPES.map((s) => ({ v: s.v, l: s.l }))));
  /* The pane still HAS an App filter: the shell reads it off the URL, writes it
     back and hands it to the other panes. Only the place it is drawn moved. */
  assert.equal(PANES.users.scope, true, 'the shell was told this pane has no App filter, so it stops reading ?scope=');
  assert.equal(PANES.users.scopeInPane, true);
  assert.equal(dom.doc.getElementById('filters'), null, 'the shell drew a filter bar over a pane that has its own');
  assert.equal(dom.doc.querySelectorAll('.seg').length, 0, 'the shell drew an App segment beside the pane\'s own control');
});

/* Round 1, finding 1. On main `?scope=coaches` was read by the shell, which is
   why a link from Analytics or a reload kept the App. The first version of this
   pane told the registry it had no App filter, which turned that reading off,
   so the same address searched every app. */
const href = (qs) => HREF + qs;
const emptyAnswers = [{ match: /\/lookup$/, data: lookupFixture((d) => { d.matches = []; d.matchCount = 0; }) }];
const scopeBody = (dom) => dom.calls.find((c) => /\/lookup$/.test(c.endpoint)).body.scope;

test('address: ?scope=coaches starts the App control on Coaches, and the lookup sends it', async () => {
  const dom = await boot({ href: href('?scope=coaches'), answers: emptyAnswers });
  assert.equal(field(dom, 'lookupScope').value, 'coaches', 'the control ignored the address it was opened with');
  assert.equal(allText(buttons(dom.doc.querySelector('.u-find')).find((b) => /^Filters/.test(allText(b).trim()))).trim(),
    'Filters · 1', 'the Filters count does not know an App is already chosen');
  await lookUp(dom);
  assert.equal(scopeBody(dom), 'coaches', 'a deep link to one App searched every app');
});

test('address: an address with no App, or one that is not an App, searches everything and says nothing', async () => {
  for (const qs of ['', '?scope=aria', '?scope=']) {
    const dom = await boot({ href: href(qs), answers: emptyAnswers });
    assert.equal(field(dom, 'lookupScope').value, 'all', `${qs || 'no query'} did not fall back to All`);
    await lookUp(dom);
    assert.equal(scopeBody(dom), 'all');
  }
});

test('address: picking an App writes it to the address, keeps the other parameters, and reaches the rail links', async () => {
  const dom = await boot({ href: href('?range=7d'), answers: emptyAnswers });
  const before = dom.window.history.entries.length;
  field(dom, 'lookupScope').value = 'mobile';
  field(dom, 'lookupScope').dispatch('change');
  assert.equal(dom.window.history.entries.length, before + 1, 'a pick did not touch the address');
  const written = dom.window.history.entries[dom.window.history.entries.length - 1];
  assert.equal(new URL(written, ORIGIN).searchParams.get('scope'), 'mobile');
  assert.equal(new URL(written, ORIGIN).pathname, '/ops/users.html');
  assert.equal(dom.window.OpsPaneShell.filters().scope, 'mobile');
  assert.equal(new URL(dom.window.OpsPaneShell.paneHref('analytics'), ORIGIN).searchParams.get('scope'), 'mobile',
    'a link to another pane dropped the App picked here');

  /* Back to All is a write too: a stale ?scope=mobile would re-narrow the
     next reload. */
  field(dom, 'lookupScope').value = 'all';
  field(dom, 'lookupScope').dispatch('change');
  const cleared = dom.window.history.entries[dom.window.history.entries.length - 1];
  assert.equal(new URL(cleared, ORIGIN).searchParams.get('scope'), 'all');
  await lookUp(dom);
  assert.equal(scopeBody(dom), 'all');
});

test('address: the address never carries the account or the reason', async () => {
  const dom = await boot({ href: href('?scope=coaches'), answers: [
    { match: /\/lookup$/, data: lookupFixture() },
    { match: /\/users\//, data: detailFixture() },
  ] });
  await lookUp(dom, 'person@example.invalid', 'SUP-4471');
  field(dom, 'lookupScope').value = 'mobile';
  field(dom, 'lookupScope').dispatch('change');
  for (const entry of dom.window.history.entries) {
    assert.ok(!/person|usr-2277|SUP-4471|example\.invalid/.test(String(entry)), 'the lookup leaked into the address: ' + entry);
  }
});

test('address: an unchanged pick writes nothing to it', async () => {
  const dom = await boot({ href: href('?scope=coaches'), answers: emptyAnswers });
  const before = dom.window.history.entries.length;
  field(dom, 'lookupScope').value = 'coaches';
  field(dom, 'lookupScope').dispatch('change');
  assert.equal(dom.window.history.entries.length, before, 'an unchanged App rewrote the address');
});

test('the narrowings reach the lookup, and an untouched one is not sent', async () => {
  const dom = await boot({ answers: [{ match: /\/lookup$/, data: lookupFixture((d) => { d.matches = []; d.matchCount = 0; }) }] });
  await lookUp(dom);
  let body = dom.calls[0].body;
  assert.equal(body.scope, 'all');
  assert.equal(body.state, undefined, 'an unset state was sent');
  assert.equal(body.tier, undefined, 'an unset tier was sent');
  assert.equal(body.identifier, 'usr-2277');
  assert.equal(body.reason, 'SUP-4471');

  for (const [id, value] of [['lookupScope', 'coaches'], ['lookupState', 'suspended'], ['lookupTier', 'free']]) {
    field(dom, id).value = value;
    field(dom, id).dispatch('change');
  }
  await lookUp(dom);
  body = dom.calls[dom.calls.length - 1].body;
  assert.equal(body.scope, 'coaches');
  assert.equal(body.state, 'suspended');
  assert.equal(body.tier, 'free');
});

test('the Filters control counts what is narrowed, and opens the three controls', async () => {
  const dom = await boot({ answers: [] });
  const toggle = buttons(dom.doc.querySelector('.u-find')).find((b) => /^Filters/.test(allText(b).trim()));
  assert.equal(allText(toggle).trim(), 'Filters');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'lookupFilters');
  assert.equal(field(dom, 'lookupFilters').getAttribute('hidden'), 'hidden');

  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(field(dom, 'lookupFilters').getAttribute('hidden'), null);

  field(dom, 'lookupState').value = 'suspended';
  field(dom, 'lookupState').dispatch('change');
  field(dom, 'lookupScope').value = 'mobile';
  field(dom, 'lookupScope').dispatch('change');
  assert.equal(allText(toggle).trim(), 'Filters · 2');

  field(dom, 'lookupScope').value = 'all';
  field(dom, 'lookupScope').dispatch('change');
  assert.equal(allText(toggle).trim(), 'Filters · 1', 'App "All" counted as a narrowing');
});

test('changing a narrowing re-masks, clears the stale result, and does not run the lookup again', async () => {
  const dom = await openAccount({ runTimers: false, reveal: revealAnswer() });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'the reveal never landed, so this proves nothing');
  const before = dom.calls.length;

  field(dom, 'lookupTier').value = 'free';
  field(dom, 'lookupTier').dispatch('change');
  await flush();

  assert.ok(!visibleText(row).includes(SECRET), 'a revealed value survived a narrowing change');
  assert.equal(dom.calls.length, before, 'the change ran a lookup nobody asked for');
  assert.match(emptyText(dom), /Filters changed/);
  assert.match(emptyText(dom), /Search again/);
  assert.ok(!liveText(dom).includes('usr-2277'), 'the old account is still on screen under a different filter');
});

test('a lookup still out when a narrowing changes is dropped, not drawn under the old value', async () => {
  const defer = {};
  const dom = await boot({ answers: [{ match: /\/lookup$/, defer, data: lookupFixture() }, { match: /\/users\//, data: detailFixture() }] });
  await lookUp(dom);
  assert.equal(shownState(dom), 'loading');

  field(dom, 'lookupTier').value = 'free';
  field(dom, 'lookupTier').dispatch('change');
  defer.release();
  await flush();

  assert.match(emptyText(dom), /Filters changed/);
  assert.equal(dom.calls.filter((c) => c.method === 'GET').length, 0, 'a dropped lookup still opened an account');
  assert.ok(!liveText(dom).includes('usr-2277'));
});

/* ======================================================= the rail and lean */

test('the rail and the phone bar mark no destination on this page', async () => {
  const dom = await boot({ answers: [] });
  for (const surface of ['rail', 'bottomNav']) {
    const bar = dom.doc.getElementById(surface);
    assert.ok(bar, `the shell drew no ${surface}`);
    assert.ok(bar.querySelectorAll('.nav-item, .tab-item').length > 1, `the ${surface} has no items, so "none marked" says nothing`);
    assert.equal(bar.querySelectorAll('[aria-current]').length, 0, `the ${surface} marks a page current on a page that is in none`);
    assert.equal(bar.querySelectorAll('.on').length, 0, `the ${surface} lights an item on a page that is in none`);
  }
});

test('with everything confirmed the account is cards and rows: no footers, no banners, no rules card, no danger zone', async () => {
  const dom = await openAccount();
  const live = panel(dom, 'live');
  assert.equal(byClass(live, 'card-foot').length, 0, 'a card drew a footer');
  assert.equal(byClass(live, 'note').length, 0, 'a banner is on a screen with nothing to warn about');
  assert.equal(byClass(live, 'privilege').length, 0);
  assert.deepEqual(byClass(live, 'card-title').map((n) => allText(n).trim()),
    ['Account', 'Subscription', 'Devices', 'Recent activity', 'Access history']);
  assert.equal(findAll(live, (n) => n.tagName === 'P').filter((n) => hasClass(n, 'u-fine')).length, 1,
    'more than the one line the disclosure needs');
});

/* ================================================================ the page */

test('the page loads the v2 system and none of v1', () => {
  const html = readFile('users.html');
  for (const want of ['assets/aria.css', 'assets/shell-pane-v2.css', 'assets/pane-users-v2.css',
    'assets/shell-pane-v2.js', 'assets/pane-users.js']) {
    assert.ok(html.includes(want), `users.html does not load ${want}`);
  }
  for (const banned of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js']) {
    assert.ok(!html.includes(banned), `users.html still loads ${banned}`);
  }
  assert.match(html, /Content-Security-Policy/);
  assert.ok(!/\sstyle="/.test(html), 'users.html carries a style attribute');
});

test('the pane module writes no markup and no style attribute', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'pane-users.js reaches for innerHTML');
  assert.ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(PANE_SRC));
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(PANE_SRC), 'pane-users.js writes a style attribute');
});

/* The one thing a screen reader needs and no screenshot shows. The pane has no
   chart, so every svg on it is an icon: decorative, hidden, and never the only
   carrier of a fact. */
test('every glyph is decorative, and a state is a word as well as a dot', async () => {
  const dom = await openAccount();
  const svgs = findAll(dom.content, (n) => n.tagName === 'svg');
  assert.ok(svgs.length > 4, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'a glyph is announced');
    assert.equal(svg.getAttribute('role'), null, 'a glyph carries a role');
  }
  const dots = byClass(panel(dom, 'live'), 'dot');
  assert.ok(dots.length >= 2, 'no dots, so this proves nothing');
  for (const dot of dots) {
    assert.equal(dot.getAttribute('aria-hidden'), 'true');
    assert.ok(allText(dot.parentNode).trim().length > 0, 'a dot says nothing but its colour');
  }
});
