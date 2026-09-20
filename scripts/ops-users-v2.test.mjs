/* Look up a user, on the v2 design system: the page, not the field row.

   scripts/ops-pane-users.test.mjs is the older file and it stays where it is.
   It lifts fieldValue out of the module and drives it directly, which is the
   right instrument for the masking floors and the wrong one for everything
   here: what a lookup paints, which of the four preview states the pane is
   in, and whether the six promises this pane makes to the athlete are on
   screen. Both files run in CI, in the same job.

   THE SIX PROMISES, and how each is tested twice

   The promises are sentences on a page, and a sentence outliving the thing it
   describes is the worse of the two failures this file can miss. So each one
   is asserted as copy AND as behaviour, and the behaviour is asserted in both
   directions wherever it has two:

     1. hidden for every role until a reveal is recorded
          copy      the account card foot, and a privilege pill
          both ways a masked field stays masked with no reveal, AND a recorded
                    reveal actually puts the value on screen
     2. owner only, written reason
          copy      the reveal card's rules
          both ways an owner gets a live control, a non-owner a dead one; a
                    reason under three characters is refused and nothing is
                    sent, a written one is sent in the body
     3. recorded by field name, never by value
          copy      the reveal card's rules
          behaviour the request body carries field and reason and no value,
                    and a response that confirms no record says so on screen
     4. the athlete sees that it happened and who did it
          copy      a privilege pill, and the access card head
          behaviour the access record is on the page with nothing pressed
     5. reveal records outlive the reveal
          copy      the access card foot
          behaviour a revealed entry is still in the access table after the
                    reveal has re-masked itself
     6. request and reply content is not shown, at any role
          copy      the activity card foot
          behaviour the activity table prints label, time and reference and
                    nothing else from the event

   Every test here had a published mutation in PR antonyrugama/aria-website#56:
   the exact file, the exact original line, and the payload that makes that one
   test fail. If you add a test, that claim does not stretch to cover it —
   prove it and say so, or narrow this paragraph.

   NOT COVERED by any published mutation, and stated rather than implied:

     - anything about layout, width, overflow or contrast. Nothing here
       measures anything; scripts/check-ops-narrow-overflow.mjs measures, and
       it is pinned to /ops/alerts.html and does not visit this page. The
       narrow-width readings for this pane are in the pull request as hand-run
       numbers, not as a guard.
     - whether a CSS rule RENDERS. Node has no layout engine, so the hatched
       mask, the accent rail on the danger card and the 720px stack are shape
       assertions here and screenshots in the pull request.
     - focus movement. The stub's focus() sets document.activeElement and
       nothing computes offsetParent, so the re-mask focus fallback is
       exercised but its CHOICE of destination is not asserted.
     - the drawer that used to be here. It is deleted, so there is nothing to
       test; the access record being on the page unpressed is the assertion
       that replaced it. */
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
    recorded: { at: ago(1000), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
    matchCount: 1,
    matches: [
      {
        reference: 'ath_2277',
        maskedEmail: 'a•••@example.invalid',
        state: { key: 'active', label: 'Active', tone: 'ok' },
        tier: { key: 'pro', label: 'Athlete Pro', brand: true },
        platforms: [{ key: 'mobile', label: 'Mobile' }],
        lastActiveAt: ago(3 * 3_600_000),
        flags: [],
      },
    ],
  };
  if (!over) return base;
  const out = over(base);
  return out === undefined ? base : out;
}

function detailFixture(over) {
  const base = {
    reference: 'ath_2277',
    kind: 'athlete',
    state: { key: 'active', label: 'Active', tone: 'ok' },
    tier: { key: 'pro', label: 'Athlete Pro', brand: true },
    memberSince: ago(400 * DAY),
    recorded: { at: ago(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
    summary: {
      fields: [
        { key: 'email', label: 'Email', masked: true, maskedValue: 'a•••@example.invalid', reveal: 'allowed' },
        { key: 'displayName', label: 'Name', masked: true, maskedValue: 'A••• R•••', reveal: 'allowed' },
        { key: 'weight', label: 'Weight', masked: true, reveal: 'never' },
        { key: 'locale', label: 'Locale', masked: false, value: 'es-ES' },
      ],
    },
    activity: {
      windowDays: 7,
      events: [
        { occurredAt: ago(3 * 3_600_000), label: 'Chat reply', tone: 'ok', reference: 'run_88214', href: '/ops/run-history.html' },
        { occurredAt: ago(9 * 3_600_000), label: 'Nutrition plan', tone: 'warn', reference: 'run_87744', href: 'https://elsewhere.example.invalid/x' },
      ],
    },
    devices: [{ label: 'iPhone', appVersion: '1.1.2', os: 'iOS 18.2', lastSeenAt: ago(2 * 3_600_000) }],
    billing: {
      fields: [
        { key: 'tier', label: 'Tier', masked: false, value: 'Athlete Pro' },
        { key: 'renewsAt', label: 'Renews', masked: false, value: '14 Aug 2026' },
      ],
    },
    access: {
      windowDays: 90,
      entries: [
        { occurredAt: ago(2 * DAY), actor: 'ops_owner_1', fields: 'email', reason: 'SUP-4471', revealed: true },
        { occurredAt: ago(5 * DAY), actor: 'ops_operator_2', fields: 'summary', reason: 'SUP-4390', revealed: false },
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

  const dom = makeDom({ tokens: TOKENS, href: HREF, runTimers: opts.runTimers });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  /* The stub document has no contains(); the pane asks it whether the control
     that held focus is still in the tree before moving focus back to it. */
  dom.doc.contains = (node) => dom.root.contains(node);
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: opts.role || 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, method: (o && o.method) || 'GET', body: o && o.body, query: o && o.query });
      const hit = answers.find((a) => a.match.test(endpoint));
      if (!hit) throw new Error('no fixture for ' + endpoint);
      if (hit.pending) return new Promise(() => {});
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

/* --------------------------------------------------------------- lookups */

function field(dom, id) {
  return dom.doc.getElementById(id);
}

/* Runs the search the way a person does: type, then submit the form. */
async function lookUp(dom, identifier = 'ath_2277', reason = 'SUP-4471') {
  field(dom, 'lookupIdentifier').value = identifier;
  field(dom, 'lookupReason').value = reason;
  dom.doc.querySelector('.hunt-form').dispatch('submit');
  await flush();
}

/* The whole happy path: a lookup that matches one account, which the pane
   opens for you because one match is not a choice. */
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

/* Text a person can read. `.hidden` is display:none in
   ops/assets/pane-users-v2.css and allText walks the whole subtree, so a probe
   built on allText would be wrong in BOTH directions on the one row that
   matters: it would read a mask the browser has hidden, and it would read a
   revealed value the browser has hidden. The stylesheet claim is asserted
   below rather than assumed, because this probe is only faithful while it
   holds. */
function visibleText(node) {
  if (!node) return '';
  if (node.tagName && hasClass(node, 'hidden')) return '';
  const own = node.textContent || '';
  const kids = (node.childNodes || []).map(visibleText).join(' ');
  return (own + ' ' + kids).replace(/\s+/g, ' ').trim();
}

test('the probe above is faithful: .hidden really is display:none', () => {
  const css = readFile('assets/pane-users-v2.css');
  assert.match(css, /^\.hidden \{ display: none; \}$/m);
});

function byClass(root, cls) {
  return findAll(root, (n) => hasClass(n, cls));
}

/* One card, found by the text of its head. Whole-pane text is the wrong
   instrument for a claim about one card: the pane has five of them and an
   assertion over all of it passes without the right one being right. */
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

function footOf(dom, title) {
  const box = card(dom, title);
  assert.ok(box, `no card titled ${title}`);
  const foot = byClass(box, 'card-foot')[0];
  assert.ok(foot, `the ${title} card has no foot`);
  return allText(foot);
};

const buttons = (root) => findAll(root, (n) => n.tagName === 'BUTTON');

/* The reveal control for one field, by the row it sits in. */
function revealRow(dom, label) {
  const lines = findAll(panel(dom, 'live'), (n) => n.tagName === 'DIV' &&
    n.childNodes.some((c) => c.tagName === 'DT' && allText(c).trim() === label));
  return lines[0];
}

async function reveal(dom, label, reason = 'checking the bounce reason') {
  const row = revealRow(dom, label);
  assert.ok(row, `no row for ${label}`);
  const open = buttons(row).find((b) => allText(b).trim() === 'Reveal');
  assert.ok(open, `no Reveal control on ${label}`);
  open.dispatch('click');
  const box = findAll(row, (n) => n.tagName === 'INPUT')[0];
  box.value = reason;
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  return row;
}

/* ============================================================ the states */

test('nothing looked up yet is the empty state, and says why there is no list', async () => {
  const dom = await boot({ answers: [] });
  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /Nothing looked up yet/);
  assert.match(emptyText(dom), /no list of accounts to start from/);
});

test('a lookup in flight is the loading state', async () => {
  const dom = await boot({ answers: [{ match: /\/lookup$/, pending: true }] });
  await lookUp(dom);
  assert.equal(shownState(dom), 'loading');
});

test('no account matching is the empty state, echoing the identifier as a coded reference', async () => {
  const dom = await boot({
    answers: [{ match: /\/lookup$/, data: lookupFixture((d) => { d.matches = []; d.matchCount = 0; }) }],
  });
  await lookUp(dom, 'ath_9914');
  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /No account matches that identifier/);
  assert.match(emptyText(dom), /ath_9914/);
  assert.match(emptyText(dom), /Near matches are never returned/);
  assert.ok(dom.announced.includes('No account matches that identifier'));
});

test('an account on screen with both access records confirmed is the live state', async () => {
  const dom = await openAccount();
  assert.equal(shownState(dom), 'live');
  assert.match(liveText(dom), /ath_2277/);
});

/* The one fact that separates live from degraded here. A pane that has
   somebody's record on screen and could not confirm the access record it
   promised is half-read, not healthy, and the two are the same markup, so
   nothing that reads the DOM could tell them apart. */
test('an account whose lookup confirmed no access record is degraded, and says so', async () => {
  const dom = await openAccount({ lookup: lookupFixture((d) => { delete d.recorded; }) });
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /No record was confirmed/);
  assert.match(liveText(dom), /Treat it as unrecorded/);
});

test('an account whose own open confirmed no access record is degraded too', async () => {
  const dom = await openAccount({ detail: detailFixture((d) => { delete d.recorded; }) });
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /handled opening this account without confirming/);
  assert.ok(dom.announced.some((m) => /opened, with no record confirmed/.test(m)));
});

test('a lookup that failed is degraded with a retry, not empty', async () => {
  const err = Object.assign(new Error('the operations API did not answer'), { code: 'ops_unavailable' });
  const dom = await boot({ answers: [{ match: /\/lookup$/, error: err }] });
  await lookUp(dom);
  assert.equal(shownState(dom), 'degraded');
  assert.match(liveText(dom), /Could not look that up/);
  assert.ok(buttons(panel(dom, 'live')).some((b) => allText(b).trim() === 'Try again'));
});

test('a deployment with no lookup route says the routes are missing, not that nothing matched', async () => {
  const err = Object.assign(new Error('no route'), { code: 'ops_route_missing' });
  const dom = await boot({ answers: [{ match: /\/lookup$/, error: err }] });
  await lookUp(dom);
  assert.match(liveText(dom), /This pane has no API yet/);
  assert.match(liveText(dom), /Nothing has been recorded, because nothing was looked up/);
});

/* ================================================= promise 1: hidden by default */

test('promise 1 is on screen: hidden for every role, including this one', async () => {
  const dom = await openAccount();
  assert.match(footOf(dom, 'Account'),
    /Hidden for every role, including this one, until a reveal is recorded\./);
  assert.match(allText(byClass(dom.content, 'privilege')[0]),
    /Personal fields hidden until revealed/);
});

test('promise 1 holds one way: a masked field is not on screen and its value is not in the page', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      /* The payload a careless server sends: the mask AND the value. The pane
         must print neither the value nor anything derived from it. */
      d.summary.fields[0].value = SECRET;
    }),
  });
  assert.ok(!liveText(dom).includes(SECRET), 'the raw value reached the screen');
  assert.match(cardText(dom, 'Account'), /a•••@example\.invalid/);
});

test('promise 1 holds the other way: a recorded reveal does put the value on screen', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 60_000).toISOString(), recorded: { at: ago(0), actor: 'ops_owner_1' } } },
  });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'a recorded reveal did not show the value');
  assert.ok(!visibleText(row).includes('a•••@example.invalid'), 'the mask is still on screen beside the value');
  assert.match(visibleText(row), /Hides itself in 60 seconds/);
  assert.ok(dom.announced.includes('Email revealed and recorded'));
});

/* ================================================ promise 2: owner, with a reason */

test('promise 2 is on screen: owner only, and a written reason', async () => {
  const dom = await openAccount();
  const rules = cardText(dom, 'Revealing a personal field');
  assert.match(rules, /Owner only/);
  assert.match(rules, /A written reason is required, and the server asks for it again\./);
});

test('promise 2 holds both ways on the role: an owner gets a live control, nobody else does', async () => {
  const owner = await openAccount({ role: 'owner' });
  const live = buttons(revealRow(owner, 'Email')).find((b) => allText(b).trim() === 'Reveal');
  assert.ok(live, 'an owner got no Reveal control');
  /* The attribute, not the property: `disabled` is a boolean content attribute
     and the attribute is what the pane writes, so the stub's plain `disabled`
     field would read false for a control the pane had plainly disabled. */
  assert.equal(live.getAttribute('disabled'), null, 'an owner got a dead control');
  assert.ok(!allText(revealRow(owner, 'Email')).includes('Owner action'));

  for (const role of ['operator', 'viewer']) {
    const dom = await openAccount({ role });
    const row = revealRow(dom, 'Email');
    const dead = buttons(row).find((b) => allText(b).trim() === 'Reveal');
    assert.ok(dead, `no placeholder control at role ${role}`);
    assert.equal(dead.getAttribute('disabled'), 'disabled', `the control is live at role ${role}`);
    assert.match(allText(row), /Owner action/);
  }
});

test('promise 2 holds both ways on the reason: a blank one sends nothing, a written one is sent', async () => {
  const dom = await openAccount({ runTimers: false, reveal: { data: { field: 'email', value: SECRET, recorded: {} } } });
  const before = dom.calls.length;

  const row = revealRow(dom, 'Email');
  buttons(row).find((b) => allText(b).trim() === 'Reveal').dispatch('click');
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, before, 'a reveal with no reason was sent anyway');
  assert.match(visibleText(row), /Give a reason\. It is written beside your name\./);
  assert.ok(!visibleText(row).includes(SECRET));

  findAll(row, (n) => n.tagName === 'INPUT')[0].value = 'SUP-4471 bounce check';
  findAll(row, (n) => n.tagName === 'FORM')[0].dispatch('submit');
  await flush();
  assert.equal(dom.calls.length, before + 1, 'a written reason was not sent');
});

/* ============================================= promise 3: by field name, not value */

test('promise 3 is on screen: recorded by field name, never by value', async () => {
  const dom = await openAccount();
  assert.match(cardText(dom, 'Revealing a personal field'), /Recorded by field name, never by value\./);
});

test('promise 3 holds: the reveal request carries the field key and the reason, and no value', async () => {
  const dom = await openAccount({ runTimers: false, reveal: { data: { field: 'email', value: SECRET, recorded: {} } } });
  await reveal(dom, 'Email', 'SUP-4471 bounce check');
  const sent = dom.calls[dom.calls.length - 1];
  assert.equal(sent.endpoint, '/api/ops/users/ath_2277/reveal');
  assert.equal(sent.method, 'POST');
  /* Key by key rather than deepEqual: the body is built inside the vm realm,
     so its prototype is not this realm's Object and deepStrictEqual refuses
     it. Listing the keys is the assertion that matters anyway — it is what
     fails if a value ever joins the field name in the request. */
  assert.deepEqual(Object.keys(sent.body).sort(), ['field', 'reason']);
  assert.equal(sent.body.field, 'email');
  assert.equal(sent.body.reason, 'SUP-4471 bounce check');
});

test('promise 3 stays falsifiable: a reveal the API did not record says so beside the value', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 60_000).toISOString() } },
  });
  const row = await reveal(dom, 'Email');
  assert.match(visibleText(row), /did not confirm a record for it\. Treat it as unrecorded\./);
  assert.ok(dom.announced.includes('Email revealed, with no record confirmed'));
});

test('a reveal with no readable expiry gets the ceiling, and says the page chose it', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: { not: 'a time' }, recorded: {} } },
  });
  const row = await reveal(dom, 'Email');
  assert.match(visibleText(row), /Hides itself in 60 seconds, a limit this page set because the response did not give one\./);
});

/* ======================================== promise 4: the athlete sees who looked */

test('promise 4 is on screen: every reveal is visible to the athlete', async () => {
  const dom = await openAccount();
  assert.match(allText(byClass(dom.content, 'privilege')[0]), /Every reveal is visible to the athlete/);
  assert.match(cardText(dom, 'Who has looked at this account'), /Shown to the athlete on request/);
});

test('promise 4 holds: the access record is on the page with nothing pressed', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Who has looked at this account');
  assert.ok(box, 'the access record is not on the page');
  const text = allText(box);
  assert.match(text, /ops_owner_1/);
  assert.match(text, /ops_operator_2/);
  assert.match(text, /SUP-4390/);
});

test('a revealed access entry is marked with a word, not only a colour', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Who has looked at this account');
  const marks = byClass(box, 'pill').filter((p) => allText(p).includes('email'));
  assert.equal(marks.length, 1, 'the revealed entry carries no pill');
  assert.match(allText(marks[0]), /email/);
  assert.equal(marks[0].querySelectorAll('svg').length, 1, 'the pill carries no glyph');
});

/* ================================= promise 5: reveal records outlive the reveal */

test('promise 5 is on screen: kept for the life of the account, and a reveal cannot erase one', async () => {
  const dom = await openAccount();
  assert.match(footOf(dom, 'Who has looked at this account'),
    /Kept for the life of the account\. A reveal cannot erase one\./);
});

test('promise 5 holds: a reveal that has re-masked itself is still in the access record', async () => {
  /* runTimers defaults to firing every timer the moment it is set, so this
     reveal expires inside the same tick it landed: the field is masked again
     and the earlier entry is still in the table underneath it. */
  const dom = await openAccount({
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 60_000).toISOString(), recorded: {} } },
  });
  const row = await reveal(dom, 'Email');
  assert.ok(!visibleText(row).includes(SECRET), 'the expiry did not re-mask the field');
  assert.ok(visibleText(row).includes('a•••@example.invalid'), 'the expiry left no mask behind');
  assert.ok(dom.announced.includes('Email hidden again automatically'));
  assert.match(allText(card(dom, 'Who has looked at this account')), /ops_owner_1/);
});

/* ============================================ promise 6: no request or reply content */

test('promise 6 is on screen: request and reply content is not shown, for any role', async () => {
  const dom = await openAccount();
  assert.match(footOf(dom, 'Recent activity'), /Request and reply content is not shown, for any role\./);
});

test('promise 6 holds: an event prints its label, time and reference and nothing else it carries', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.activity.events[0].body = 'what the athlete actually typed';
      d.activity.events[0].reply = 'what Aria actually answered';
    }),
  });
  const box = card(dom, 'Recent activity');
  const text = allText(box);
  assert.match(text, /Chat reply/);
  assert.match(text, /run_88214/);
  assert.ok(!text.includes('what the athlete actually typed'));
  assert.ok(!text.includes('what Aria actually answered'));
});

/* ==================================================== the rest of the pane */

test('a health field carries no control and is never printed, whatever the payload says', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.summary.fields[2] = { key: 'weight', label: 'Weight', masked: false, reveal: 'allowed', value: '72.4 kg' };
    }),
  });
  const row = revealRow(dom, 'Weight');
  assert.ok(row, 'no Weight row');
  assert.ok(!allText(row).includes('72.4'), 'a health value reached the screen');
  assert.equal(buttons(row).length, 0, 'a health field got a control');
  assert.match(allText(row), /Health data is never shown here/);
});

test('an off-origin activity href renders as plain text; a same-origin one is a link', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Recent activity');
  const links = findAll(box, (n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'expected exactly one link');
  assert.equal(links[0].getAttribute('href'), '/ops/run-history.html');
  assert.match(allText(box), /run_87744/);
  assert.ok(!findAll(box, (n) => n.tagName === 'A' && (n.getAttribute('href') || '').includes('elsewhere')).length);
});

/* A capped array beside an uncapped count is the "no bulk listing" rule
   breached quietly, so the pane reports the disagreement rather than picking
   whichever number reads better. */
test('a match count larger than the rows sent is reported, not silently believed', async () => {
  const dom = await boot({
    answers: [{
      match: /\/lookup$/,
      data: lookupFixture((d) => {
        d.matchCount = 9;
        d.matches = [d.matches[0], { ...d.matches[0], reference: 'ath_2278' }];
      }),
    }, { match: /\/users\//, data: detailFixture() }],
  });
  await lookUp(dom);
  const box = card(dom, 'Matches');
  assert.match(allText(box), /2 of 9 accounts shown/);
  assert.match(allText(box), /says 9 accounts matched but sent 2/);
  assert.match(allText(box), /Narrow the identifier/);
});

test('a match list that agrees with its count draws no warning', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Matches');
  assert.match(allText(box), /1 account/);
  assert.ok(!allText(box).includes('but sent'));
});

test('the matches table shows coded references and the mask the API sent, and no raw identifier', async () => {
  const dom = await openAccount({
    lookup: lookupFixture((d) => { d.matches[0].email = SECRET; }),
  });
  const box = card(dom, 'Matches');
  assert.match(allText(box), /ath_2277/);
  assert.match(allText(box), /a•••@example\.invalid/);
  assert.ok(!allText(box).includes(SECRET));
  assert.match(footOf(dom, 'Matches'), /masked by the operations API, not by this page/);
});

/* The danger zone. The mock draws four buttons; no route performs one, so the
   band states the requirement and draws nothing pressable. Both halves are
   asserted, because a band that vanished would pass an assertion that only
   counted buttons. */
test('the danger zone states re-authentication and draws no control at all', async () => {
  const dom = await openAccount();
  const box = card(dom, 'Account actions');
  assert.ok(box, 'the danger zone is not on the page');
  assert.match(allText(box), /Re-authentication required/);
  assert.match(allText(box), /Audited, and the athlete is told/);
  assert.equal(buttons(box).length, 0, 'the danger zone drew a control');
  assert.match(allText(box), /needs the athlete's own confirmation/);
});

test('an action the API does report is named, still with no control and still behind re-authentication', async () => {
  const dom = await openAccount({
    detail: detailFixture((d) => {
      d.supportActions.available = [{ key: 'reset_password', label: 'Reset the password' }];
    }),
  });
  const box = card(dom, 'Account actions');
  assert.match(allText(box), /Reset the password/);
  assert.match(allText(box), /Not reachable from this pane/);
  assert.equal(buttons(box).length, 0, 'a reported action became a control');
  assert.equal(byClass(box, 'srow').length, 1);
  assert.match(allText(byClass(box, 'srow')[0]), /Re-authentication required/);
});

/* ================================================= re-masking, in three ways */

test('a new lookup re-masks everything revealed under the old one', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 600_000).toISOString(), recorded: {} } },
  });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'the reveal never landed, so this proves nothing');

  await lookUp(dom, 'ath_2277', 'SUP-4471 second look');
  assert.ok(!liveText(dom).includes(SECRET), 'a revealed value survived a new lookup');
});

test('a scope change re-masks everything revealed, and does not re-run the lookup', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 600_000).toISOString(), recorded: {} } },
  });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET), 'the reveal never landed, so this proves nothing');
  const before = dom.calls.length;

  dom.window.dispatchEvent(new dom.window.CustomEvent('ops:filters', { detail: { scope: 'coaches', range: null, env: 'production' } }));
  await flush();

  assert.ok(!visibleText(row).includes(SECRET), 'a revealed value survived a scope change');
  assert.equal(dom.calls.length, before, 'the scope change ran a lookup nobody asked for');
  assert.match(emptyText(dom), /App filter changed/);
  assert.match(emptyText(dom), /writes another access record, so it is not run for you/);
});

test('Hide again re-masks the field it belongs to', async () => {
  const dom = await openAccount({
    runTimers: false,
    reveal: { data: { field: 'email', value: SECRET, expiresAt: new Date(NOW + 600_000).toISOString(), recorded: {} } },
  });
  const row = await reveal(dom, 'Email');
  assert.ok(visibleText(row).includes(SECRET));
  buttons(row).find((b) => allText(b).trim() === 'Hide again').dispatch('click');
  assert.ok(!visibleText(row).includes(SECRET), 'Hide again left the value on screen');
  assert.ok(visibleText(row).includes('a•••@example.invalid'), 'Hide again left no mask behind');
  assert.ok(dom.announced.includes('Email hidden again'));
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
test('every glyph is decorative and no status is a glyph alone', async () => {
  const dom = await openAccount();
  const svgs = findAll(dom.content, (n) => n.tagName === 'svg');
  assert.ok(svgs.length > 4, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'a glyph is announced');
    assert.equal(svg.getAttribute('role'), null, 'a glyph carries a role');
  }
  for (const p of byClass(panel(dom, 'live'), 'pill')) {
    assert.ok(allText(p).trim().length > 0, 'a pill says nothing but its colour');
  }
});
