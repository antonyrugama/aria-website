/* Unit tests for ops/assets/settings.js — the Settings pane on the v2 design
   system.

   Two of the rules this pane has to hold are the kind that pass a badly built
   test by construction, so they are written here first and deliberately:

   THE LIVE-AGAINST-STATIC PARTITION. Three of the six areas on this pane are
   read from an API and three are not, and the whole point of the remodel is
   that a reader can tell which is which. Asserting that a marker element
   EXISTS is the classic false green: it stays green when the marker is on
   every card, on none, or on the wrong ones. So the assertion here is the
   PARTITION. Every card the pane marks as read names an endpoint the pane
   actually requested on that boot and prints at least one numeral; every card
   it marks as static names no endpoint and prints none; every card in the
   panel is marked as one or the other; and neither set is empty. Moving one
   card across the line fails it in both directions.

   OWNER-ONLY GATING. A test that only checks an operator is refused stays
   green if refusal is hard-coded for everybody, which would take the pane away
   from the person it is for. Both directions are asserted: an operator gets
   the shell's named refusal and the pane reads nothing at all, and an owner
   gets the real pane.

   Every test here has a published mutation in the pull request: the exact
   file and the exact original line whose removal or inversion makes that test
   fail, at the deletion site with its original gating.

   NOT COVERED by any published mutation, and stated rather than implied:

     - the visual half of the partition. The dashed, hatched, unlit surface of
       a static card and the shared neutral tone of the two source chips are
       declared in ops/assets/pane-settings-v2.css, and nothing in this stub
       DOM resolves a stylesheet. What is proven here is the half a screen
       reader gets: the word on the chip, the endpoint on the card, and the
       absence of figures. The rest is the narrow-width screenshots on the
       pull request.
     - the focus trap and the inert backdrop in confirmAction(). The stub has
       no isConnected, no real focus order and no inert, so a mutation to the
       Tab branch would not be detected here. The dialog's behaviour that IS
       covered is what it sends and what it says.
     - whether ops/settings.html loads the right stylesheets in the right
       order. scripts/check-ops-shell-v2.mjs boots the real page in headless
       Chrome and is where that is answered.
     - the ++ in `var token = ++record.token;` in loadRecord(). Replacing it
       with `var token = record.token;` leaves the whole suite green, and that
       mutant is published on the pull request as a stated green rather than
       left out: record.busy already means one record read at a time, so under
       correct code no two record requests are ever in flight to tell the two
       spellings apart. The line that carries the fix is the increment in
       load(), and deleting that one turns this section red.
     - a Load more issued BETWEEN load()'s reset and the render that answers
       it. The token is bumped once per load(), at the reset, so a request
       made inside that window is current when its answer arrives and lands on
       top of the freshly-rendered first page. It is not reachable from the
       pane: aria.css line 888 is
       `[data-state]:not([data-shown]) { display: none !important; }`, and
       region.loading() takes data-shown off the live panel for exactly that
       window, so the Load more button is display:none while it lasts. The
       stub has no layout and would let a test click it anyway, which is why
       this is stated here instead of asserted. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, find, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const PANE_SRC = read('assets/settings.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const ADMINS = '/api/ops/admins';
const SESSIONS = '/api/ops/sessions';
const AUDIT = '/api/ops/audit';

/* -------------------------------------------------------------- fixtures

   Everything under ops/ is world-readable, so every address here is .invalid
   and every network address is from RFC 5737's documentation range. No
   fixture carries a real person, a real mailbox or a real host. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Relative to now rather than to a frozen clock, because the pane prints ages
   through fmt.ago, which reads Date.now() itself. */
const back = (ms) => new Date(Date.now() - ms).toISOString();
const forward = (ms) => new Date(Date.now() + ms).toISOString();

function adminsFixture() {
  return [
    {
      id: 'adm_owner', email: 'owner@ops.invalid', displayName: 'Owner', role: 'owner',
      status: 'active', mustChangePassword: false,
      lastLoginAt: back(2 * HOUR), activeSessionExpiresAt: forward(30 * DAY - 2 * HOUR),
    },
    {
      id: 'adm_op', email: 'operator@ops.invalid', displayName: 'Operator', role: 'operator',
      status: 'active', mustChangePassword: false,
      lastLoginAt: back(30 * HOUR), activeSessionExpiresAt: forward(30 * DAY - 30 * HOUR),
    },
    {
      id: 'adm_view', email: 'viewer@ops.invalid', displayName: 'Viewer', role: 'viewer',
      status: 'disabled', mustChangePassword: false,
      lastLoginAt: null, activeSessionExpiresAt: null,
    },
  ];
}

/* Four rows, one of them already past its expiry, so the pane has something to
   drop as well as something to draw. Every live one was issued with the same
   thirty-day window, which is what the ceiling chip measures. */
function sessionsFixture() {
  return [
    {
      id: 'ses_owner_current', adminId: 'adm_owner', current: true,
      createdAt: back(2 * HOUR), lastUsedAt: back(5 * MINUTE),
      expiresAt: forward(30 * DAY - 2 * HOUR), revokedAt: null,
    },
    {
      id: 'ses_operator_1', adminId: 'adm_op', current: false,
      createdAt: back(30 * HOUR), lastUsedAt: back(3 * HOUR),
      expiresAt: forward(30 * DAY - 30 * HOUR), revokedAt: null,
    },
    {
      id: 'ses_operator_2', adminId: 'adm_op', current: false,
      createdAt: back(5 * DAY), lastUsedAt: back(DAY),
      expiresAt: forward(25 * DAY), revokedAt: null,
    },
    {
      id: 'ses_expired_9', adminId: 'adm_view', current: false,
      createdAt: back(40 * DAY), lastUsedAt: back(35 * DAY),
      expiresAt: back(10 * DAY), revokedAt: null,
    },
  ];
}

function auditFixture() {
  return [
    {
      id: 'aud_1', occurredAt: back(5 * MINUTE), actorEmail: 'owner@ops.invalid',
      actorRole: 'owner', action: 'admin.session_revoke', outcome: 'success',
      targetType: 'ops_admin_session', targetId: 'ses_retired_4',
      reason: 'Laptop reported lost', ipAddress: '198.51.100.7',
    },
    {
      id: 'aud_2', occurredAt: back(40 * MINUTE), actorEmail: 'operator@ops.invalid',
      actorRole: 'operator', action: 'admin.login', outcome: 'success',
      targetType: null, targetId: null, reason: null, ipAddress: '198.51.100.9',
    },
    {
      id: 'aud_3', occurredAt: back(3 * HOUR), actorEmail: 'nobody@ops.invalid',
      actorRole: null, action: 'admin.login_failed', outcome: 'refused',
      targetType: null, targetId: null, reason: null, ipAddress: '203.0.113.4',
    },
  ];
}

/* ---------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'settings');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/settings.html loads it: registry, aria.js, the
   bootstrap, then the pane module.

   The session stub's hasRole() is session.js's own implementation rather than
   a constant, so what the gating tests exercise is the registry entry and the
   shell's branch on it, not an answer written into the stub. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const states = [];
  const blobs = [];
  const role = opts.role || 'owner';

  const answers = {
    [ADMINS]: opts.admins === undefined ? adminsFixture() : opts.admins,
    [SESSIONS]: opts.sessions === undefined ? sessionsFixture() : opts.sessions,
    [AUDIT]: opts.audit === undefined ? auditFixture() : opts.audit,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/settings.html',
    runTimers: opts.runTimers,
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  /* The stub has no HTMLAnchorElement, so the export's own download link has
     no click(). Given rather than faked away: the export is asserted on what
     it put in the Blob, and the click is only how a browser is handed it. */
  const created = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const node = created(tag);
    if (!node.click) node.click = () => {};
    return node;
  };

  /* URL.createObjectURL and Blob are browser surface the stub does not carry.
     Subclassed rather than patched onto Node's own URL, so one test cannot
     leave object-URL statics on the class every other test resolves through. */
  const RealURL = dom.window.URL;
  class ShimURL extends RealURL {}
  ShimURL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:ops-test'; };
  ShimURL.revokeObjectURL = () => {};
  dom.window.URL = ShimURL;
  dom.window.Blob = function Blob(parts, o) {
    this.parts = parts;
    this.type = o && o.type;
  };

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: {
      admin: {
        id: 'adm_owner', displayName: 'Owner', email: 'owner@ops.invalid', role,
      },
      session: { expiresAt: forward(28 * DAY) },
    },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query, method: o && o.method, body: o && o.body });
      if (endpoint.indexOf(SESSIONS + '/') === 0) {
        const revoke = opts.revoke || (() => ({}));
        const answer = revoke(endpoint.slice((SESSIONS + '/').length), o);
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve({ data: answer });
      }
      let answer = answers[endpoint];
      if (typeof answer === 'function') answer = answer(o);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer instanceof Promise) return answer;
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (required) => {
      if (!required || !required.length) return true;
      return required.indexOf(role) !== -1;
    },
    daysLeft: () => 28,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });

  /* Which preview state was applied is the one thing the stub DOM cannot read
     back: the live box and the degraded box are the same element, so both end
     with the same data-shown. aria.js is the one that knows, so it is asked. */
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = (name) => {
    states.push(name);
    return applyState(name);
  };

  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'settings.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));

  return {
    ...dom,
    body,
    calls,
    states,
    blobs,
    settle: async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); },
    content: dom.doc.getElementById('content'),
  };
}

/* The panel the operator can actually see. The loading and empty panels are
   siblings of it and are hidden by aria.css, so reading the whole region would
   read text nobody is looking at. */
function panel(dom, state) {
  const content = dom.doc.getElementById('content');
  if (!content) return null;
  return content.querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(/\s+/).indexOf(state) !== -1)[0];
}

const livePanel = (dom) => panel(dom, 'live');
const liveText = (dom) => allText(livePanel(dom));

function cards(dom, source) {
  const host = livePanel(dom);
  if (!host) return [];
  const all = host.querySelectorAll('.card');
  if (!source) return all;
  return all.filter((c) => c.getAttribute('data-source') === source);
}

/* One card, by the title in its head. Whole-panel text is the wrong instrument
   for a claim about one card: another sentence elsewhere carries the same
   words and the assertion passes without that card being right. */
function cardByTitle(dom, title) {
  return cards(dom).filter((c) => {
    const heading = find(c, (n) => n.className === 'card-title');
    return heading && heading.textContent === title;
  })[0];
}

/* Every endpoint this boot actually read. DELETE is excluded: a revoke is a
   write, and a card claiming to be filled from one would be claiming
   something it cannot be. */
function readEndpoints(dom) {
  return dom.calls.filter((c) => !c.method).map((c) => c.endpoint);
}

function buttonsIn(node) {
  return findAll(node, (n) => n.tagName === 'BUTTON');
}

function buttonLabels(node) {
  return buttonsIn(node).map((b) => allText(b));
}

/* ============================================================ the partition */

test('every card says whether it is read from an API, and no card says nothing',
  async () => {
    const dom = await boot();
    const all = cards(dom);
    assert.ok(all.length >= 6, `expected the six areas, got ${all.length} cards`);
    const unmarked = all.filter((c) => !c.hasAttribute('data-source'));
    assert.deepEqual(
      unmarked.map((c) => allText(find(c, (n) => n.className === 'card-title'))), [],
      'a card carrying neither treatment is a card a reader cannot place');
  });

test('the live half and the static half are both real, and the split is not a marker '
  + 'sprayed on everything', async () => {
  const dom = await boot();
  const live = cards(dom, 'live');
  const still = cards(dom, 'static');

  /* Either set being empty is the failure mode a presence check cannot see:
     mark every card live and a presence check still passes. */
  assert.ok(live.length > 0, 'no card is marked as read from an API');
  assert.ok(still.length > 0, 'no card is marked as having no API behind it');
  assert.equal(live.length + still.length, cards(dom).length);
});

test('a card marked live names an endpoint the pane really requested, and prints a figure',
  async () => {
    const dom = await boot();
    const endpoints = readEndpoints(dom);

    for (const card of cards(dom, 'live')) {
      const title = allText(find(card, (n) => n.className === 'card-title'));
      const endpoint = card.getAttribute('data-endpoint');
      assert.ok(endpoint, `the live card "${title}" names no endpoint`);
      assert.ok(endpoints.indexOf(endpoint) !== -1,
        `the live card "${title}" claims ${endpoint}, which this boot never requested`);
      assert.match(allText(card), /[0-9]/,
        `the live card "${title}" prints no figure, so nothing on it came from a read`);
    }

    /* And the other way: a read whose card lost its chip would leave an
       endpoint nothing on the pane claims. */
    const claimed = cards(dom, 'live').map((c) => c.getAttribute('data-endpoint'));
    for (const endpoint of new Set(endpoints)) {
      assert.ok(claimed.indexOf(endpoint) !== -1,
        `${endpoint} was read and no card on the pane says so`);
    }
  });

test('a card with no API behind it names no endpoint and prints no numeral at all',
  async () => {
    const dom = await boot();
    for (const card of cards(dom, 'static')) {
      const title = allText(find(card, (n) => n.className === 'card-title'));
      assert.equal(card.getAttribute('data-endpoint'), null,
        `the static card "${title}" names an endpoint`);
      const text = allText(card);
      assert.doesNotMatch(text, /[0-9]/,
        `the static card "${title}" prints a figure, which is a number nobody can check`);
    }
  });

test('the source chips differ in their word, not in their colour', async () => {
  const dom = await boot();
  const chipOf = (card) => find(card, (n) => n.className && n.className.indexOf('src-chip') !== -1);

  const liveChips = cards(dom, 'live').map(chipOf);
  const staticChips = cards(dom, 'static').map(chipOf);
  assert.ok(liveChips.length && staticChips.length);
  assert.ok(liveChips.every(Boolean), 'a live card has no source chip');
  assert.ok(staticChips.every(Boolean), 'a static card has no source chip');

  /* Same classes, so the tone carries none of the distinction and a reader who
     cannot separate two tints still gets the answer. */
  const classes = new Set(liveChips.concat(staticChips).map((c) => c.className));
  assert.equal(classes.size, 1,
    `the two chips are styled differently (${[...classes].join(' | ')}), so the split `
    + 'is being carried by something other than the word');

  const words = (chips) => new Set(chips.map((c) => allText(c)));
  assert.deepEqual([...words(liveChips)], ['Live']);
  assert.deepEqual([...words(staticChips)], ['No API yet']);
});

test('the three areas Stadiora/Aria#5442 will wire up are the static ones', async () => {
  const dom = await boot();
  const titles = (source) => cards(dom, source)
    .map((c) => allText(find(c, (n) => n.className === 'card-title'))).sort();
  assert.deepEqual(titles('static'), ['Cost categories', 'Data retention', 'Outside connections']);
  assert.deepEqual(titles('live'), ['Accounts', 'Signed in now', 'What was done']);
});

/* ======================================================== owner-only gating */

test('an operator gets the named refusal, and the pane reads nothing at all', async () => {
  const dom = await boot({ role: 'operator' });

  const text = allText(dom.content);
  assert.match(text, /do not have access/i);
  assert.match(text, /owner/i, 'the refusal does not say which role would be needed');

  /* The second half is the one that matters. A pane that draws a refusal and
     issues its reads anyway has not been gated, it has been hidden. */
  const reads = dom.calls.filter((c) => c.endpoint.indexOf('/api/ops/') === 0);
  assert.deepEqual(reads, [], `the refused pane still called ${reads.map((c) => c.endpoint)}`);

  assert.ok(!livePanel(dom), 'the refused pane still built its preview region');
});

test('an owner gets the real pane, not the refusal', async () => {
  const dom = await boot({ role: 'owner' });

  assert.doesNotMatch(allText(dom.content), /do not have access/i);
  assert.ok(livePanel(dom), 'the owner got no pane');
  assert.match(liveText(dom), /owner@ops\.invalid/,
    'the owner got a pane with none of the account list in it');
  assert.ok(readEndpoints(dom).indexOf(ADMINS) !== -1, 'the owner pane read no accounts');
});

/* ========================================================= the four states */

test('while the reads are in flight the pane shows skeletons, not an empty record',
  async () => {
    const dom = await boot({ admins: new Promise(() => {}) });
    assert.deepEqual(dom.states, ['loading']);
    const loading = panel(dom, 'loading');
    assert.ok(loading.querySelectorAll('.skel').length > 0, 'the loading state draws nothing');
    assert.doesNotMatch(allText(loading), /nothing recorded/i);
  });

test('an account list that came back empty is reported as the store not answering, '
  + 'not as nobody having access', async () => {
  const dom = await boot({ admins: [] });
  assert.equal(dom.states[dom.states.length - 1], 'empty');

  const empty = panel(dom, 'empty');
  const text = allText(empty);
  assert.match(text, /did not answer/i);
  assert.match(text, /always at least one owner/i);
  assert.doesNotMatch(text, /\b0 (administrators|accounts|people)\b/i,
    'an empty read is being printed as a count of zero');
});

test('a session list that will not load degrades the pane instead of taking the '
  + 'account list off the screen', async () => {
  const boom = new Error('The operations API did not answer.');
  const dom = await boot({ sessions: boom });

  assert.equal(dom.states[dom.states.length - 1], 'degraded');
  assert.match(liveText(dom), /owner@ops\.invalid/,
    'the account list went away because a different read failed');

  const sessionsCard = cardByTitle(dom, 'Signed in now');
  assert.match(allText(sessionsCard), /could not be read/i);
  assert.match(allText(sessionsCard), /unread, not absent/i,
    'an unreadable list is being allowed to read as an empty one');
});

test('with every read answered the pane is live, not degraded', async () => {
  const dom = await boot();
  assert.equal(dom.states[dom.states.length - 1], 'live');
});

test('when the sessions are unread no Revoke button is drawn against the guess', async () => {
  const dom = await boot({ sessions: new Error('nope') });
  const accounts = cardByTitle(dom, 'Accounts');
  assert.deepEqual(buttonLabels(accounts).filter((l) => /revoke/i.test(l)), []);
  assert.match(allText(accounts), /sessions unread/);
});

/* ==================================================== the four substance items */

test('the session window is measured from the sessions, not printed from a constant',
  async () => {
    const fourteen = sessionsFixture().map((row) => ({
      ...row,
      createdAt: back(2 * HOUR),
      expiresAt: forward(14 * DAY - 2 * HOUR),
    })).slice(0, 3);
    const dom = await boot({ sessions: fourteen });
    assert.match(liveText(dom), /Sessions end after 14 days/,
      'the ceiling did not follow the sessions it is measured from');
    assert.doesNotMatch(liveText(dom), /Sessions end after 30 days/);
  });

test('nothing on the pane offers to edit or delete an entry in the access record',
  async () => {
    const dom = await boot();
    const record = cardByTitle(dom, 'What was done');

    /* A whitelist rather than a blocklist. "No button matching /delete/"
       passes the day somebody adds one called "Tidy up". */
    const labels = buttonLabels(record).map((l) => l.replace(/\s+/g, ' ').trim()).sort();
    assert.deepEqual(labels, ['Export what is loaded', 'Load more', 'Refresh'],
      'the access record has grown a control that is not Refresh, Export or Load more');
    assert.match(allText(record), /append only/i);
    assert.match(allText(record), /including an owner/i,
      'the append-only rule does not say that it binds the person reading it');
  });

test('the retention card keeps the difference between a shorter window and deleted rows',
  async () => {
    const dom = await boot();
    const retention = cardByTitle(dom, 'Data retention');
    assert.equal(retention.getAttribute('data-source'), 'static');
    const text = allText(retention);
    assert.match(text, /deletes rows on the next nightly pass/i);
    assert.match(text, /not a filter on what is read back/i);
    assert.match(text, /fixed by policy/i);
    assert.match(text, /who looked at an athlete/i,
      'the locked windows do not say why they are locked');
  });

test('the roles are stated as three fixed ones with no custom permission set', async () => {
  const dom = await boot();
  const text = liveText(dom);
  assert.match(text, /Three fixed roles/);
  assert.match(text, /no custom permission set/);
  for (const role of ['Owner', 'Operator', 'Viewer']) {
    assert.match(text, new RegExp(role + ' '), `the roles note does not say what ${role} does`);
  }
});

test('the sessions card says the ceiling is not an idle timeout', async () => {
  const dom = await boot();
  const sessionsCard = cardByTitle(dom, 'Signed in now');
  const text = allText(sessionsCard);
  assert.match(text, /hard ceiling, not an idle timeout/i);
  assert.match(text, /next request/i,
    'the card does not say when a revoked browser actually loses the dashboard');
});

/* ============================================================== revoking */

test('a revoke sends the typed reason to the server', async () => {
  const dom = await boot();
  const accounts = cardByTitle(dom, 'Accounts');
  const revoke = buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0];
  assert.ok(revoke, 'no account can be revoked');

  revoke.dispatch('click');
  const form = dom.doc.querySelector('.modal');
  assert.ok(form, 'the revoke fired without asking');

  form.querySelector('.modal-input').value = 'Laptop reported lost';
  form.dispatch('submit');
  await dom.settle();

  const sent = dom.calls.filter((c) => c.method === 'DELETE');
  assert.equal(sent.length, 2, 'both of that account\'s live sessions should have been ended');
  for (const call of sent) {
    /* Read field by field rather than deep-compared: the body was built inside
       the vm context, so its prototype is that realm's and a strict deep
       equality fails on an object that is otherwise identical. */
    assert.deepEqual(Object.keys(call.body), ['reason']);
    assert.equal(call.body.reason, 'Laptop reported lost',
      'the reason the operator typed did not reach the server');
  }
});

test('a revoke with no reason never reaches the server', async () => {
  const dom = await boot();
  const accounts = cardByTitle(dom, 'Accounts');
  buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');

  const form = dom.doc.querySelector('.modal');
  form.querySelector('.modal-input').value = '   ';
  form.dispatch('submit');
  await dom.settle();

  assert.deepEqual(dom.calls.filter((c) => c.method === 'DELETE'), []);
  const alertBox = form.querySelector('.modal-alert');
  assert.equal(alertBox.hidden, false, 'the refusal was not shown to anybody');
  assert.match(allText(alertBox), /give a reason/i);
});

test('a refusal from the server is shown in the dialog that asked for it', async () => {
  const refusal = new Error('That session belongs to an account you may not change.');
  const dom = await boot({ revoke: () => refusal });
  const accounts = cardByTitle(dom, 'Accounts');
  buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');

  const form = dom.doc.querySelector('.modal');
  form.querySelector('.modal-input').value = 'Suspected shared password';
  form.dispatch('submit');
  await dom.settle();

  assert.ok(dom.doc.querySelector('.modal'), 'the dialog closed over the refusal');
  const alertBox = form.querySelector('.modal-alert');
  assert.equal(alertBox.hidden, false);
  assert.match(allText(alertBox), /may not change/);
  assert.match(allText(alertBox), /Nothing has been revoked/,
    'a refused revoke does not say that nothing changed');
});

test('a revoke that stopped halfway says how much of it ran', async () => {
  let seen = 0;
  const dom = await boot({
    revoke: () => {
      seen += 1;
      return seen === 1 ? {} : new Error('The operations API did not answer.');
    },
  });
  const accounts = cardByTitle(dom, 'Accounts');
  buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');

  const form = dom.doc.querySelector('.modal');
  form.querySelector('.modal-input').value = 'Suspected shared password';
  form.dispatch('submit');
  await dom.settle();

  const alertBox = form.querySelector('.modal-alert');
  assert.match(allText(alertBox), /1 session had already been revoked/,
    'a partly completed revoke is being reported as if nothing happened');
  assert.doesNotMatch(allText(alertBox), /Nothing has been revoked/);
});

/* ================================================================ the record */

test('a second page of the record does not print a row that is already on screen',
  async () => {
    const first = auditFixture();
    const page = (o) => {
      const offset = o && o.query ? o.query.offset : 0;
      /* A newest-first log that is still being written: one entry arrived
         between the two requests, so the second page repeats aud_3. */
      if (offset === 0) return first;
      if (offset === 3) {
        return [first[2], {
          id: 'aud_4', occurredAt: back(6 * HOUR), actorEmail: 'owner@ops.invalid',
          actorRole: 'owner', action: 'admin.login', outcome: 'success',
          targetType: null, targetId: null, reason: null, ipAddress: '198.51.100.7',
        }];
      }
      return [];
    };
    const dom = await boot({ audit: page });
    const record = cardByTitle(dom, 'What was done');

    /* Three rows arrived first, the second page carries one of them again plus
       one new one, so four distinct rows should be on screen. */
    const more = buttonsIn(record).filter((b) => /load more/i.test(allText(b)))[0];
    more.hidden = false;
    more.dispatch('click');
    await dom.settle();

    const rows = record.querySelectorAll('tbody')[0].children;
    assert.equal(rows.length, 4, 'the repeated entry was printed twice');

    /* The third request is the whole point of clicking twice. Up to here the
       server has sent every row the pane kept, so an offset advanced by what
       SURVIVED the de-duplication is indistinguishable from one advanced by
       what was SENT: both read 3. It is the page that repeated a row which
       separates them - sent 2, kept 1 - and only the request after it can
       show which of the two the pane counted. */
    more.hidden = false;
    more.dispatch('click');
    await dom.settle();

    const offsets = dom.calls.filter((c) => c.endpoint === AUDIT).map((c) => c.query.offset);
    assert.deepEqual(offsets, [0, 3, 5],
      'the offset did not advance by what the server sent');
    assert.equal(record.querySelectorAll('tbody')[0].children.length, 4,
      'the end of the record changed what was on screen');
  });

test('an unrecognised action is shown as recorded rather than relabelled', async () => {
  const dom = await boot({
    audit: [{
      id: 'aud_x', occurredAt: back(MINUTE), actorEmail: 'owner@ops.invalid', actorRole: 'owner',
      action: 'admin.something_new', outcome: 'success',
      targetType: null, targetId: null, reason: null, ipAddress: '198.51.100.7',
    }],
  });
  const record = cardByTitle(dom, 'What was done');
  assert.match(allText(record), /admin\.something_new/,
    'an action with no wording was given a guess instead of its own name');
});

test('an empty record says that nothing has happened, not that recording is off', async () => {
  const dom = await boot({ audit: [] });
  const record = cardByTitle(dom, 'What was done');
  const text = allText(record);
  assert.match(text, /nothing recorded yet/i);
  assert.match(text, /not that recording is off/i);
});

/* ============================================== the record across a reload

   Stadiora/Aria#10408. load() resets the record - it runs on boot, on the
   failure-state retry and after a successful revoke - and a Load more page
   already in flight when it does belongs to the window the pane has just
   thrown away. Landing it appends rows from before the reload and advances
   record.offset past them, so the next Load more asks for the wrong window
   and a page of the record is skipped.

   Nothing here is timed. The audit endpoint below HOLDS the page and hands
   the test a promise to resolve, so the order the pane sees its answers in is
   chosen rather than raced: a race reproduced by sleeping is a race
   reproduced some of the time.

   Both arms are bound, because a guard that drops everything drops Load more
   with it and would pass an armless test:

     - a page from before the reload must NOT land        (stale, drifting)
     - a page asked for after the reload MUST land        (Load more works)
     - a FAILURE from before the reload must not be shown (the other arm of
       the same response)
     - a page from before the reload must not make the pane think it is idle
       while a newer read is in flight (the guard runs before the state it
       protects, not after it) */

/* The pane's page size. Stated here rather than read back off the pane: a
   fixture sized from the pane's own request would agree with it whatever it
   asked for. The first assertion in each test below checks the pane really
   does ask for this many, so a change to the constant fails loudly instead of
   quietly turning every window in this file into a short page - and a short
   page is the end of the record, which hides Load more altogether. */
const AUDIT_PAGE = 50;

/* A full page of the record. The marker travels in the reason column, which
   is the one column printed whole, so which window is on screen can be read
   off the card rather than inferred from a count. */
function auditWindow(prefix, count) {
  const n = count === undefined ? AUDIT_PAGE : count;
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i}`,
    occurredAt: back((i + 1) * MINUTE),
    actorEmail: 'owner@ops.invalid',
    actorRole: 'owner',
    action: 'admin.login',
    outcome: 'success',
    targetType: null,
    targetId: null,
    reason: `${prefix}_${i}`,
    ipAddress: '198.51.100.7',
  }));
}

const HOLD = Symbol('hold');

/* An audit endpoint that answers by offset and can be told to hold a page.
   plan(offset, nth) returns the rows to answer with, or HOLD to hand back a
   promise this test resolves by hand later.

   It discriminates on the offset it is given: every request is recorded and
   the plan branches on it, so an assertion about where the next page starts
   is an assertion about what the pane asked for, not about a fixture handed
   back regardless. */
function auditServer(plan) {
  const asked = [];
  const holds = [];
  return {
    asked,
    holdCount: () => holds.length,
    land: (n, rows) => {
      assert.ok(holds[n], `no page ${n} is being held`);
      holds[n].resolve({ data: rows });
    },
    fail: (n, err) => {
      assert.ok(holds[n], `no page ${n} is being held`);
      holds[n].reject(err);
    },
    stub: (o) => {
      const query = o && o.query;
      assert.ok(query, 'the record was read with no querystring');
      assert.equal(query.limit, AUDIT_PAGE,
        'the pane no longer pages the record at the size these fixtures are built to');
      asked.push(query.offset);
      const answer = plan(query.offset, asked.length);
      if (answer !== HOLD) return Promise.resolve({ data: answer });
      let settle;
      const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      holds.push(settle);
      return promise;
    },
  };
}

/* Boot, then hold a Load more page, then revoke - which is what makes load()
   reset the record underneath it. Every step asserts the state it leaves
   behind, so a test whose interleaving did not happen fails saying so instead
   of quietly asserting something else. */
async function reloadUnderAPage(server, options) {
  const dom = await boot({ audit: server.stub, ...(options || {}) });
  const card = () => cardByTitle(dom, 'What was done');
  const rowsOn = () => card().querySelectorAll('tbody')[0].children.length;
  const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];
  const refreshButton = () => buttonsIn(card()).filter((b) => /refresh/i.test(allText(b)))[0];

  assert.deepEqual(server.asked, [0], 'boot read something other than the first page');
  assert.equal(rowsOn(), AUDIT_PAGE, 'the first window is not on screen');

  const more = moreButton();
  assert.equal(more.hidden, false,
    'a whole page was sent and Load more was not offered, so nothing below can be clicked');
  more.dispatch('click');
  await dom.settle();
  assert.deepEqual(server.asked, [0, AUDIT_PAGE], 'Load more asked for the wrong window');
  assert.equal(server.holdCount(), 1, 'the second page was answered instead of held');

  const accounts = cardByTitle(dom, 'Accounts');
  buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');
  const form = dom.doc.querySelector('.modal');
  form.querySelector('.modal-input').value = 'Laptop reported lost';
  form.dispatch('submit');
  await dom.settle();

  assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0],
    'the revoke did not reload the record, so the page below is not in flight across a reset');
  assert.equal(server.holdCount(), 1, 'the held page answered itself');
  assert.match(allText(card()), /post_0\b/, 'the reloaded record is not the one on screen');

  return { dom, card, rowsOn, moreButton, refreshButton };
}

/* The two windows every test in this section boots with: what was there
   before the revoke, and what is there after it. Separate ids, so a row from
   the first can be recognised on screen rather than counted. */
const beforeWindow = () => auditWindow('boot');
const afterWindow = () => auditWindow('post');

function reloadingPlan(before, after) {
  let zeroth = 0;
  return (offset) => {
    if (offset === 0) {
      zeroth += 1;
      return zeroth === 1 ? before : after;
    }
    return HOLD;
  };
}

test('a Load more page in flight when a revoke reloads the pane does not land', async () => {
  const before = beforeWindow();
  const after = afterWindow();
  const stale = auditWindow('stale');
  const server = auditServer(reloadingPlan(before, after));
  const { dom, card, rowsOn, moreButton } = await reloadUnderAPage(server);

  /* Only now does the page asked for before the reload arrive. */
  server.land(0, stale);
  await dom.settle();

  assert.doesNotMatch(allText(card()), /stale_/,
    'a page from the window before the reload was appended to the one after it');
  assert.equal(rowsOn(), after.length,
    'the record is showing more rows than the window it was reloaded with holds');

  /* Where the next page starts is the contract, and it is stated by the
     fixture rather than read out of the pane: the window on screen is
     after.length rows long, so the page after it starts there. */
  const more = moreButton();
  assert.equal(more.hidden, false, 'a whole page was sent and Load more is not offered');
  more.dispatch('click');
  await dom.settle();
  assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0, after.length],
    'the offset drifted by a page the pane had already thrown away, so the next '
    + 'Load more asks past rows nobody has seen');
});

test('Load more still pages the record after a revoke has reloaded the pane', async () => {
  const before = beforeWindow();
  const after = afterWindow();
  const next = auditWindow('next');
  let zeroth = 0;
  const server = auditServer((offset) => {
    if (offset === 0) {
      zeroth += 1;
      return zeroth === 1 ? before : after;
    }
    /* Held on the first ask, which is the page the reload orphans, and
       answered on the second, which is the page the fresh card asks for. */
    return zeroth === 1 ? HOLD : next;
  });
  const { dom, card, rowsOn, moreButton } = await reloadUnderAPage(server);

  server.land(0, auditWindow('stale'));
  await dom.settle();

  /* The other arm. A guard that drops the orphaned page by dropping every
     page passes the test above and takes Load more away from the pane
     entirely, and nothing but this would notice. */
  moreButton().dispatch('click');
  await dom.settle();

  assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0, after.length],
    'the page after the reloaded window was asked for at the wrong offset');
  assert.equal(rowsOn(), after.length + next.length,
    'Load more no longer adds anything to the record');
  assert.match(allText(card()), /next_0\b/, 'the page that was asked for is not on screen');
});

test('a Load more page that fails after a revoke reloaded the pane is not reported',
  async () => {
    const server = auditServer(reloadingPlan(beforeWindow(), afterWindow()));
    /* runTimers: false, or the stub runs a toast's own four-second removal the
       moment it is scheduled and every toast this pane raises is gone before
       it can be read. An assertion about toasts under the default stub is
       vacuous in both directions. */
    const { dom, card, rowsOn } = await reloadUnderAPage(server, { runTimers: false });
    const after = afterWindow();

    /* The revoke posts its own confirmation, so the record of what is on
       screen is taken here and compared, rather than asserted to be empty. */
    const toasts = () => dom.doc.querySelectorAll('.toast').map((t) => allText(t));
    const before = toasts();
    assert.ok(before.length,
      'no toast survives in this stub, so comparing toasts before and after proves nothing');

    server.fail(0, new Error('The operations API did not answer.'));
    await dom.settle();

    assert.deepEqual(toasts(), before,
      'the pane complained about a page it had already thrown away');
    assert.equal(rowsOn(), after.length,
      'a failure belonging to the window before the reload disturbed the one after it');
    assert.doesNotMatch(allText(card()), /could not be read|did not answer/i,
      'the reloaded record was replaced by a failure it did not suffer');
  });

test('a Load more page from before a reload cannot make the pane think it is idle',
  async () => {
    const before = beforeWindow();
    const after = afterWindow();
    let zeroth = 0;
    const server = auditServer((offset) => {
      if (offset !== 0) return HOLD;
      zeroth += 1;
      if (zeroth === 1) return before;
      if (zeroth === 2) return after;
      /* Every reread after the reload is held too, so this test chooses when
         the refresh below lands rather than having it answer itself. */
      return HOLD;
    });
    const { dom, refreshButton } = await reloadUnderAPage(server);

    /* Refresh is never disabled - only Load more is - so a reload asked for
       while a read is in flight is reachable, and the pane holds it rather
       than running a second read. */
    refreshButton().dispatch('click');
    await dom.settle();
    assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0, 0], 'Refresh did not reread the record');
    assert.equal(server.holdCount(), 2, 'the refresh answered itself');

    /* The orphaned page lands while that refresh is still in flight. It must
       not clear the flag the refresh owns. */
    server.land(0, auditWindow('stale'));
    await dom.settle();

    refreshButton().dispatch('click');
    await dom.settle();
    assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0, 0],
      'a page from before the reload unstuck the read in flight, so a second Refresh '
      + 'ran a concurrent read instead of being held');

    /* And the held reload really does run when the read it waited for lands:
       the same flag that must not be cleared early must still be cleared. */
    server.land(1, auditWindow('again'));
    await dom.settle();
    assert.deepEqual(server.asked, [0, AUDIT_PAGE, 0, 0, 0],
      'the reload that was held never ran');
    assert.equal(server.holdCount(), 3);
  });

/* ================================================================ the export */

test('a record cell that a spreadsheet would run as a formula is defused', async () => {
  const dom = await boot({
    audit: [{
      id: 'aud_evil', occurredAt: back(MINUTE), actorEmail: '=HYPERLINK("x")@ops.invalid',
      actorRole: 'owner', action: 'admin.login_failed', outcome: 'refused',
      targetType: null, targetId: null,
      reason: '+1-555 "quoted" reason', ipAddress: '198.51.100.7',
    }],
  });
  const record = cardByTitle(dom, 'What was done');
  buttonsIn(record).filter((b) => /export/i.test(allText(b)))[0].dispatch('click');

  assert.equal(dom.blobs.length, 1, 'nothing was exported');
  const csv = dom.blobs[0].parts.join('');
  assert.match(csv, /"'=HYPERLINK\(""x""\)@ops\.invalid"/,
    'a cell beginning with = was written so that opening the file runs it');
  assert.match(csv, /"'\+1-555 ""quoted"" reason"/,
    'a cell beginning with + was written so that opening the file runs it');
});

test('the export covers the rows on screen, and says so', async () => {
  const dom = await boot();
  const record = cardByTitle(dom, 'What was done');
  const button = buttonsIn(record).filter((b) => /export/i.test(allText(b)))[0];
  assert.match(allText(button), /what is loaded/i,
    'the export button claims more than it sends');

  button.dispatch('click');
  const csv = dom.blobs[0].parts.join('');
  /* One header line plus one line per row that is on screen. */
  assert.equal(csv.split('\r\n').length, auditFixture().length + 1);
});

/* ========================================================== the pane surface */

test('Settings draws no filter bar, because the registry gives it no filters', async () => {
  const dom = await boot();
  assert.ok(!dom.doc.querySelector('.filters'),
    'a control that changes nothing is worse than no control');
  const pane = dom.window.OpsPaneRegistry.PANES.settings;
  assert.equal(!!(pane.scope || pane.range || pane.env || pane.filterNote || pane.scopeNote),
    false, 'the registry now declares a filter the pane is not drawing');
});

test('every table can be scrolled from a keyboard rather than only from a pointer',
  async () => {
    const dom = await boot();
    const tables = livePanel(dom).querySelectorAll('.tbl');
    assert.ok(tables.length >= 3, `expected the three tables, got ${tables.length}`);
    for (const tbl of tables) {
      const wrap = tbl.parentNode;
      assert.ok(wrap.className.indexOf('tbl-wrap') !== -1,
        'a table is not inside the box that scrolls it');
      assert.equal(wrap.getAttribute('tabindex'), '0');
      assert.equal(wrap.getAttribute('role'), 'region');
      assert.ok(wrap.getAttribute('aria-label'), 'the scrollable region has no name');
    }
  });

test('a session row carries neither an IP address nor a user agent', async () => {
  const withTrail = sessionsFixture().map((row) => ({
    ...row,
    ipAddress: '198.51.100.23',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) TestAgent/1.0',
  }));
  const dom = await boot({ sessions: withTrail });
  const text = allText(cardByTitle(dom, 'Signed in now'));
  assert.doesNotMatch(text, /198\.51\.100\.23/, 'a session row is printing a network address');
  assert.doesNotMatch(text, /TestAgent/, 'a session row is printing a user agent string');
});

test('nothing this pane draws carries a style attribute', async () => {
  const dom = await boot();
  const styled = findAll(livePanel(dom), (n) => n.hasAttribute('style'));
  assert.deepEqual(styled.map((n) => n.tagName), [],
    'the page CSP carries no unsafe-inline, so a style attribute is a broken element');
});
