/* Unit tests for ops/assets/settings.js — the Settings pane on the v2 design
   system.

   Two of the rules this pane has to hold are the kind that pass a badly built
   test by construction, so they are written here first and deliberately:

   THE LIVE-AGAINST-STATIC PARTITION. Four of the six areas on this pane are
   read from an API and two are not, and the whole point of the remodel is
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
const INTEGRATIONS = '/api/ops/integrations';
const COST_CATEGORIES = '/api/ops/settings/cost-categories';
const COST_CATEGORY_OVERRIDES = '/api/ops/settings/cost-categories/overrides';
const ROUTE_FAILURE_REASONS = [
  'auth',
  'timeout',
  'transport',
  'throttled',
  'http_error',
  'malformed',
  'config',
  'untrusted_next_link',
];

const FAILURE_REASON_COPY = {
  auth: 'Authentication failed',
  timeout: 'The service timed out',
  transport: 'The service did not answer',
  throttled: 'The service is throttling requests',
  http_error: 'The service returned an error response',
  malformed: 'The service returned data this dashboard cannot read',
  config: 'Configuration is invalid',
  untrusted_next_link: 'The service returned an unsafe next-page link',
};

const CATEGORY_LABELS = {
  ci_and_build: 'CI and build',
  ai_and_models: 'AI and models',
  data: 'Data',
  application_compute: 'Application compute',
  platform_and_observability: 'Platform and observability',
};

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

function integrationRow(overrides) {
  return {
    pollerKey: overrides.pollerKey,
    label: overrides.label,
    usedFor: overrides.usedFor,
    scopeKey: Object.prototype.hasOwnProperty.call(overrides, 'scopeKey')
      ? overrides.scopeKey
      : '(none)',
    status: Object.prototype.hasOwnProperty.call(overrides, 'status') ? overrides.status : 'ok',
    failureReason: overrides.failureReason || null,
    consecutiveFailures: Object.prototype.hasOwnProperty.call(overrides, 'consecutiveFailures')
      ? overrides.consecutiveFailures
      : 0,
    lastAttemptAt: Object.prototype.hasOwnProperty.call(overrides, 'lastAttemptAt')
      ? overrides.lastAttemptAt
      : back(47 * MINUTE),
    lastSuccessAt: Object.prototype.hasOwnProperty.call(overrides, 'lastSuccessAt')
      ? overrides.lastSuccessAt
      : back(10 * MINUTE),
    connectionState: overrides.connectionState,
    freshnessThreshold: overrides.freshnessThreshold || {
      seconds: 900,
      source: 'server/notification-jobs.ts cron */15 * * * *',
    },
  };
}

function integrationsFixture() {
  return {
    generatedAt: back(MINUTE),
    integrations: [
      integrationRow({
        pollerKey: 'azure_cost',
        label: 'Azure Cost Management',
        usedFor: 'Cloud spend and invoice-backed cost panes.',
        scopeKey: 'sub-example',
        connectionState: 'connected',
        freshnessThreshold: {
          seconds: 86400,
          source:
            'server/notification-jobs.ts cron 20 */8 * * *; shared/operations-cost.ts OPS_BUDGET_STALE_AFTER_MS',
        },
      }),
      integrationRow({
        pollerKey: 'app_store_connect',
        label: 'App Store Connect',
        usedFor: 'TestFlight and App Store release track state.',
        scopeKey: 'com.example.ios',
        status: 'failed',
        failureReason: 'auth',
        consecutiveFailures: 2,
        lastAttemptAt: back(5 * MINUTE),
        lastSuccessAt: back(25 * HOUR),
        connectionState: 'stale',
      }),
      integrationRow({
        pollerKey: 'google_play',
        label: 'Google Play',
        usedFor: 'Play internal, closed, open and production track state.',
        scopeKey: 'com.example.android',
        status: 'failed',
        failureReason: 'transport',
        consecutiveFailures: 3,
        lastAttemptAt: back(3 * MINUTE),
        lastSuccessAt: null,
        connectionState: 'failed',
      }),
      integrationRow({
        pollerKey: 'azure_budget',
        label: 'Azure budgets',
        usedFor: 'Budget targets for the cloud spend overview.',
        status: 'disabled',
        lastSuccessAt: null,
        connectionState: 'disabled',
        lastAttemptAt: back(2 * HOUR),
        freshnessThreshold: {
          seconds: 86400,
          source:
            'server/notification-jobs.ts cron 20 */8 * * *; shared/operations-cost.ts OPS_BUDGET_STALE_AFTER_MS',
        },
      }),
      integrationRow({
        pollerKey: 'ai_cost_reconciliation',
        label: 'AI cost configuration',
        usedFor: 'Nightly comparison between modelled AI usage and the Azure bill.',
        status: 'unconfigured',
        lastAttemptAt: back(90 * MINUTE),
        lastSuccessAt: null,
        connectionState: 'unconfigured',
        freshnessThreshold: { seconds: 86400, source: 'server/notification-jobs.ts cron 20 5 * * *' },
      }),
      integrationRow({
        pollerKey: 'ai_cost_reconciliation',
        label: 'AI cost reconciliation',
        usedFor: 'Nightly comparison between modelled AI usage and the Azure bill.',
        scopeKey: null,
        status: null,
        consecutiveFailures: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        connectionState: 'not_reporting',
        freshnessThreshold: { seconds: 86400, source: 'server/notification-jobs.ts cron 20 5 * * *' },
      }),
    ],
  };
}

function overrideFixture(overrides) {
  return {
    id: overrides.id,
    scope: overrides.scope,
    serviceKey: overrides.serviceKey,
    serviceName: overrides.serviceName,
    resourceGroupKey: overrides.resourceGroupKey,
    resourceGroup: overrides.resourceGroup,
    category: overrides.category,
    createdAt: overrides.createdAt || '2026-09-24T17:45:00.000Z',
    updatedAt: overrides.updatedAt || '2026-09-24T18:00:00.000Z',
  };
}

function costCategoriesFixture() {
  const vmOverride = overrideFixture({
    id: 17,
    scope: 'resource_group_service',
    serviceKey: 'virtual machines',
    serviceName: 'Virtual Machines',
    resourceGroupKey: 'rg-aria-dev',
    resourceGroup: 'rg-aria-dev',
    category: 'application_compute',
  });
  return {
    categories: Object.keys(CATEGORY_LABELS).map((key) => ({ key, label: CATEGORY_LABELS[key] })),
    lines: [
      {
        serviceName: 'Brand New Azure Thing',
        serviceKey: 'brand new azure thing',
        resourceGroup: 'rg-aria-prod',
        resourceGroupKey: 'rg-aria-prod',
        seedCategory: null,
        effectiveCategory: 'ungrouped',
        source: 'ungrouped',
        override: null,
      },
      {
        serviceName: 'Storage',
        serviceKey: 'storage',
        resourceGroup: 'rg-aria-prod',
        resourceGroupKey: 'rg-aria-prod',
        seedCategory: 'data',
        effectiveCategory: 'data',
        source: 'seed',
        override: null,
      },
      {
        serviceName: 'Virtual Machines',
        serviceKey: 'virtual machines',
        resourceGroup: 'rg-aria-dev',
        resourceGroupKey: 'rg-aria-dev',
        seedCategory: 'ci_and_build',
        effectiveCategory: 'application_compute',
        source: 'resource_group_override',
        override: vmOverride,
      },
    ],
    overrides: [vmOverride],
  };
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
    [INTEGRATIONS]: opts.integrations === undefined ? integrationsFixture() : opts.integrations,
    [COST_CATEGORIES]: opts.costCategories === undefined
      ? costCategoriesFixture()
      : opts.costCategories,
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
      if (endpoint === COST_CATEGORY_OVERRIDES && o && o.method === 'PUT') {
        const save = opts.costSave || (() => ({
          override: overrideFixture({
            id: 22,
            scope: o.body.scope,
            serviceKey: String(o.body.serviceName || '').toLowerCase(),
            serviceName: o.body.serviceName,
            resourceGroupKey: o.body.resourceGroup || '',
            resourceGroup: o.body.resourceGroup || null,
            category: o.body.category,
            updatedAt: '2026-09-24T18:30:00.000Z',
          }),
        }));
        const answer = save(o);
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve({ data: answer });
      }
      if (endpoint === COST_CATEGORY_OVERRIDES && o && o.method === 'DELETE') {
        const clear = opts.costClear || (() => ({
          deleted: costCategoriesFixture().overrides[0],
          effective: { category: 'ci_and_build', source: 'seed' },
        }));
        const answer = clear(o);
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

function integrationTableRow(dom, label) {
  const card = cardByTitle(dom, 'Outside connections');
  const body = card.querySelectorAll('tbody')[0];
  assert.ok(body, 'outside connections has no table body');
  const rows = body.children;
  const row = rows.find((r) => allText(r).includes(label));
  assert.ok(row, `outside connections has no row for ${label}`);
  return row;
}

function rowCellText(row, index) {
  assert.ok(row.children[index], `row has no cell ${index}`);
  return allText(row.children[index]);
}

function integrationBandNoteText(dom) {
  const heading = find(livePanel(dom), (n) => n.className === 'band-title'
    && n.textContent === 'Integrations');
  assert.ok(heading, 'the Integrations band title is missing');
  const note = heading.parentNode.querySelector('.band-note');
  assert.ok(note, 'the Integrations band note is missing');
  return allText(note);
}

function costTableRow(dom, service) {
  const card = cardByTitle(dom, 'Cost categories');
  const body = card.querySelectorAll('tbody')[0];
  assert.ok(body, 'cost categories has no table body');
  const row = body.children.find((r) => allText(r).includes(service));
  assert.ok(row, `cost categories has no row for ${service}`);
  return row;
}

function costControl(row, role) {
  const control = find(row, (n) => n.getAttribute && n.getAttribute('data-role') === role);
  assert.ok(control, `cost row has no ${role} control`);
  return control;
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

test('the remaining unwired areas Stadiora/Aria#5442 tracks are the static ones', async () => {
  const dom = await boot();
  const titles = (source) => cards(dom, source)
    .map((c) => allText(find(c, (n) => n.className === 'card-title'))).sort();
  assert.deepEqual(titles('static'), ['Data retention']);
  assert.deepEqual(titles('live'), [
    'Accounts',
    'Cost categories',
    'Outside connections',
    'Signed in now',
    'What was done',
  ]);
});

/* ====================================================== outside connections */

test('outside connections is a live card filled from the integrations route', async () => {
  const dom = await boot();
  const card = cardByTitle(dom, 'Outside connections');

  assert.equal(card.getAttribute('data-source'), 'live');
  assert.equal(card.getAttribute('data-endpoint'), INTEGRATIONS);
  assert.ok(readEndpoints(dom).indexOf(INTEGRATIONS) !== -1,
    'the card claims the integrations route without reading it');
});

/* ========================================================== cost categories */

test('cost categories is a live card filled from the cost-category settings route',
  async () => {
    const dom = await boot();
    const card = cardByTitle(dom, 'Cost categories');

    assert.equal(card.getAttribute('data-source'), 'live');
    assert.equal(card.getAttribute('data-endpoint'), COST_CATEGORIES);
    assert.ok(readEndpoints(dom).indexOf(COST_CATEGORIES) !== -1,
      'the card claims the cost-category settings route without reading it');
  });

test('cost categories shows defaults, overrides and uncategorised lines without raw codes',
  async () => {
    const dom = await boot();
    const cardText = allText(cardByTitle(dom, 'Cost categories'));
    const storage = costTableRow(dom, 'Storage');
    const vm = costTableRow(dom, 'Virtual Machines');
    const newThing = costTableRow(dom, 'Brand New Azure Thing');

    assert.match(rowCellText(storage, 1), /Data/);
    assert.match(rowCellText(storage, 2), /Default/);
    assert.match(rowCellText(vm, 1), /Application compute/);
    assert.match(rowCellText(vm, 2), /Your override/);
    assert.match(rowCellText(vm, 0), /rg-aria-dev/);
    assert.match(rowCellText(newThing, 1), /Uncategorised/);
    assert.match(rowCellText(newThing, 2), /No default or override/);
    assert.doesNotMatch(cardText,
      /resource_group_override|service_override|ci_and_build|application_compute|ungrouped/,
      'backend identifiers leaked into the card copy');
  });

test('saving a cost category sends the selected category, scope and optimistic version',
  async () => {
    const dom = await boot({ runTimers: false });
    const row = costTableRow(dom, 'Storage');
    costControl(row, 'category').value = 'application_compute';
    costControl(row, 'scope').value = 'service';
    costControl(row, 'save').dispatch('click');
    await dom.settle();

    const sent = dom.calls.filter((c) => c.endpoint === COST_CATEGORY_OVERRIDES
      && c.method === 'PUT');
    assert.equal(sent.length, 1, 'saving did not call the override upsert route once');
    assert.deepEqual(Object.keys(sent[0].body).sort(), [
      'category', 'expectedUpdatedAt', 'resourceGroup', 'scope', 'serviceName',
    ].sort());
    assert.equal(sent[0].body.serviceName, 'Storage');
    assert.equal(sent[0].body.scope, 'service');
    assert.equal(sent[0].body.resourceGroup, null);
    assert.equal(sent[0].body.category, 'application_compute');
    assert.equal(sent[0].body.expectedUpdatedAt, null);

    const toast = dom.doc.querySelectorAll('.toast').map((t) => allText(t)).join(' ');
    assert.match(toast, /Saved Application compute for Storage/,
      'saving did not show a clear confirmation');
  });

test('cost-category resource-group edits default to the most specific scope and include the version',
  async () => {
    const dom = await boot();
    const row = costTableRow(dom, 'Virtual Machines');
    assert.equal(costControl(row, 'scope').value, 'resource_group_service');

    costControl(row, 'category').value = 'data';
    costControl(row, 'save').dispatch('click');
    await dom.settle();

    const sent = dom.calls.filter((c) => c.endpoint === COST_CATEGORY_OVERRIDES
      && c.method === 'PUT')[0];
    assert.equal(sent.body.scope, 'resource_group_service');
    assert.equal(sent.body.serviceName, 'Virtual Machines');
    assert.equal(sent.body.resourceGroup, 'rg-aria-dev');
    assert.equal(sent.body.expectedUpdatedAt, '2026-09-24T18:00:00.000Z');
  });

test('using the default clears the effective cost-category override', async () => {
  const dom = await boot({ runTimers: false });
  const row = costTableRow(dom, 'Virtual Machines');
  costControl(row, 'default').dispatch('click');
  await dom.settle();

  const sent = dom.calls.filter((c) => c.endpoint === COST_CATEGORY_OVERRIDES
    && c.method === 'DELETE');
  assert.equal(sent.length, 1, 'Use default did not call the override delete route once');
  assert.equal(sent[0].body.scope, 'resource_group_service');
  assert.equal(sent[0].body.serviceName, 'Virtual Machines');
  assert.equal(sent[0].body.resourceGroup, 'rg-aria-dev');
  assert.equal(sent[0].body.expectedUpdatedAt, '2026-09-24T18:00:00.000Z');

  const toast = dom.doc.querySelectorAll('.toast').map((t) => allText(t)).join(' ');
  assert.match(toast, /Using the default for Virtual Machines/,
    'clearing the override did not show a clear confirmation');
});

test('a stale cost-category save reloads the pane and tells the owner what happened',
  async () => {
    const stale = Object.assign(new Error('raw stale backend text must not render'), {
      code: 'ops_cost_category_override_stale',
      status: 409,
    });
    const dom = await boot({ costSave: () => stale, runTimers: false });
    const row = costTableRow(dom, 'Virtual Machines');
    costControl(row, 'category').value = 'data';
    costControl(row, 'save').dispatch('click');
    await dom.settle();

    assert.equal(readEndpoints(dom).filter((endpoint) => endpoint === COST_CATEGORIES).length, 2,
      'a stale write did not reload the latest cost-category mapping');
    const toast = dom.doc.querySelectorAll('.toast').map((t) => allText(t)).join(' ');
    assert.match(toast, /changed somewhere else/i);
    assert.doesNotMatch(toast, /raw stale backend text|ops_cost_category_override_stale/);
  });

test('a stale cost-category clear reloads the pane and does not print the backend code',
  async () => {
    const stale = Object.assign(new Error('raw stale clear text must not render'), {
      code: 'ops_cost_category_override_stale',
      status: 409,
    });
    const dom = await boot({ costClear: () => stale, runTimers: false });
    const row = costTableRow(dom, 'Virtual Machines');
    costControl(row, 'default').dispatch('click');
    await dom.settle();

    assert.equal(readEndpoints(dom).filter((endpoint) => endpoint === COST_CATEGORIES).length, 2,
      'a stale clear did not reload the latest cost-category mapping');
    const toast = dom.doc.querySelectorAll('.toast').map((t) => allText(t)).join(' ');
    assert.match(toast, /changed somewhere else/i);
    assert.doesNotMatch(toast, /raw stale clear text|ops_cost_category_override_stale/);
  });

test('a fresh-auth refusal on cost-category save gets fixed copy, not the raw API text',
  async () => {
    const reauth = Object.assign(new Error('raw password window text'), {
      code: 'ops_reauth_required',
      status: 403,
    });
    const dom = await boot({ costSave: () => reauth, runTimers: false });
    const row = costTableRow(dom, 'Storage');
    costControl(row, 'category').value = 'application_compute';
    costControl(row, 'save').dispatch('click');
    await dom.settle();

    const toast = dom.doc.querySelectorAll('.toast').map((t) => allText(t)).join(' ');
    assert.match(toast, /Confirm your password to change cost categories/);
    assert.doesNotMatch(toast, /raw password window text|ops_reauth_required/);
  });

test('a cost-category read failure stays inside that card with fixed copy', async () => {
  const noisy = Object.assign(new Error('SQL exploded in production'), {
    code: 'ops_cost_settings_unavailable',
  });
  const dom = await boot({ costCategories: noisy });
  const text = allText(cardByTitle(dom, 'Cost categories'));

  assert.equal(dom.states[dom.states.length - 1], 'degraded');
  assert.match(text, /cost category settings could not be read/i);
  assert.match(text, /Try again/i);
  assert.doesNotMatch(text, /SQL exploded|ops_cost_settings_unavailable/);
  assert.match(liveText(dom), /owner@ops\.invalid/,
    'the account list went away because the cost categories read failed');
});

test('a cost-category role refusal is shown as a denied card, not a raw backend error',
  async () => {
    const refused = Object.assign(new Error('raw owner role text'), {
      code: 'ops_role_insufficient',
      status: 403,
      requiredRoles: ['owner'],
    });
    const dom = await boot({ costCategories: refused });
    const text = allText(cardByTitle(dom, 'Cost categories'));

    assert.match(text, /do not have access/i);
    assert.match(text, /owner role/i);
    assert.doesNotMatch(text, /raw owner role text|ops_role_insufficient|0 cost/i);
  });

test('an empty cost-category read says there are no observed cost lines yet',
  async () => {
    const empty = costCategoriesFixture();
    empty.lines = [];
    empty.overrides = [];
    const dom = await boot({ costCategories: empty });
    const text = allText(cardByTitle(dom, 'Cost categories'));

    assert.match(text, /No observed cost lines yet/i);
    assert.match(text, /Nothing has been guessed/i);
    assert.doesNotMatch(text, /\b0 cost/i);
  });

test('each integration connection state renders as distinct text on its own pill',
  async () => {
    const dom = await boot();
    const card = cardByTitle(dom, 'Outside connections');
    const pills = findAll(card, (n) => n.className && n.className.indexOf('integration-state') !== -1);
    const byText = new Map(pills.map((p) => [allText(p), p.className]));

    assert.deepEqual([...byText.keys()].sort(), [
      'Connected',
      'Connected, stale',
      'Disabled',
      'Failed',
      'Not configured',
      'Not reporting',
    ].sort());
    assert.notEqual(byText.get('Connected, stale'), byText.get('Connected'),
      'stale is styled the same as connected');
    assert.notEqual(byText.get('Connected, stale'), byText.get('Failed'),
      'stale is styled the same as failed');
  });

test('outside connections prints each last-success cell with its own age and window',
  async () => {
    const dom = await boot();
    const connectedLastSuccess = rowCellText(
      integrationTableRow(dom, 'Azure Cost Management'),
      3
    );
    const staleLastSuccess = rowCellText(
      integrationTableRow(dom, 'App Store Connect'),
      3
    );

    assert.match(connectedLastSuccess, /10 minutes ago/,
      'the connected row does not show the age of the last successful run');
    assert.match(connectedLastSuccess, /stale after 24 hours/,
      'the connected row labels the freshness window as a cadence');
    assert.doesNotMatch(connectedLastSuccess, /daily/,
      'the connected row invents a run cadence from the staleness window');
    assert.match(staleLastSuccess, /25 hours ago/,
      'the stale row does not show the older last successful run');
    assert.match(rowCellText(integrationTableRow(dom, 'Google Play'), 3), /Never succeeded/,
      'a poller with no successful run is not separated from a connected one');
    assert.match(rowCellText(integrationTableRow(dom, 'AI cost reconciliation'), 3),
      /No reporting record exists/,
      'not_reporting is not distinguished from a poller that ran and failed');
  });

test('the Integrations band summary counts every non-connected state honestly',
  async () => {
    const dom = await boot({
      integrations: {
        generatedAt: back(MINUTE),
        integrations: [
          integrationRow({
            pollerKey: 'one',
            label: 'Working connection',
            usedFor: 'Reference connected row.',
            connectionState: 'connected',
          }),
          integrationRow({
            pollerKey: 'two',
            label: 'Broken connection',
            usedFor: 'Failure state.',
            status: 'failed',
            failureReason: 'transport',
            consecutiveFailures: 2,
            lastSuccessAt: null,
            connectionState: 'failed',
          }),
          integrationRow({
            pollerKey: 'three',
            label: 'Silent connection',
            usedFor: 'Reporting state.',
            lastAttemptAt: null,
            lastSuccessAt: null,
            connectionState: 'not_reporting',
          }),
        ],
      },
    });
    const heading = find(livePanel(dom), (n) => n.className === 'band-title'
      && n.textContent === 'Integrations');
    const note = heading.parentNode.querySelector('.band-note');

    assert.equal(allText(note), '3 connections · 2 not connected');
  });

test('the default Integrations band summary counts connections and non-connected rows',
  async () => {
  const dom = await boot();
  const heading = find(livePanel(dom), (n) => n.className === 'band-title'
    && n.textContent === 'Integrations');
  const note = heading.parentNode.querySelector('.band-note');

  assert.equal(allText(note), '6 connections · 5 not connected');
});

test('outside connections maps every route failure reason to distinct plain copy',
  async () => {
    const rows = ROUTE_FAILURE_REASONS.map((reason, index) => integrationRow({
      pollerKey: `reason_${index}`,
      label: `Reason ${index + 1}`,
      usedFor: 'Failure reason contract row.',
      status: 'failed',
      failureReason: reason,
      consecutiveFailures: index + 1,
      lastAttemptAt: back((index + 2) * MINUTE),
      lastSuccessAt: null,
      connectionState: 'failed',
    }));
    const dom = await boot({
      integrations: { generatedAt: back(MINUTE), integrations: rows },
    });
    const cardText = allText(cardByTitle(dom, 'Outside connections'));

    assert.equal(new Set(Object.values(FAILURE_REASON_COPY)).size, ROUTE_FAILURE_REASONS.length,
      'the route failure reasons must not collapse into shared copy');
    for (const [index, reason] of ROUTE_FAILURE_REASONS.entries()) {
      const cell = rowCellText(integrationTableRow(dom, `Reason ${index + 1}`), 3);
      assert.match(cell, new RegExp(`${FAILURE_REASON_COPY[reason]} on ${index + 1} attempt`),
        `${reason} did not render its own failure sentence with the failure count`);
      assert.doesNotMatch(cardText, new RegExp(reason),
        `${reason} leaked as a raw backend identifier`);
    }
  });

test('a failed connection that never succeeded still shows its reason and count',
  async () => {
    const dom = await boot({
      integrations: {
        generatedAt: back(MINUTE),
        integrations: [
          integrationRow({
            pollerKey: 'google_play',
            label: 'Google Play',
            usedFor: 'Play internal, closed, open and production track state.',
            status: 'failed',
            failureReason: 'transport',
            consecutiveFailures: 3,
            lastSuccessAt: null,
            connectionState: 'failed',
          }),
        ],
      },
    });
    const lastSuccessCell = rowCellText(integrationTableRow(dom, 'Google Play'), 3);

    assert.match(lastSuccessCell, /Never succeeded/);
    assert.match(lastSuccessCell, /The service did not answer on 3 attempts\./);
  });

test('an unknown integration failure reason gets a safe fallback, not the raw code',
  async () => {
    const dom = await boot({
      integrations: {
        generatedAt: back(MINUTE),
        integrations: [
          integrationRow({
            pollerKey: 'unknown_failure',
            label: 'Unknown failure',
            usedFor: 'Fallback failure reason row.',
            status: 'failed',
            failureReason: 'new_backend_code',
            consecutiveFailures: 1,
            lastSuccessAt: null,
            connectionState: 'failed',
          }),
        ],
      },
    });
    const lastSuccessCell = rowCellText(integrationTableRow(dom, 'Unknown failure'), 3);

    assert.match(lastSuccessCell, /An unrecognised failure reason was reported on 1 attempt\./);
    assert.doesNotMatch(lastSuccessCell, /new_backend_code/);
  });

test('an empty integrations read is treated as unreadable health, not all fine',
  async () => {
    const dom = await boot({ integrations: { generatedAt: back(MINUTE), integrations: [] } });
    const text = allText(cardByTitle(dom, 'Outside connections'));

    assert.match(text, /No connection states came back/i);
    assert.match(text, /not a clean bill/i);
    assert.equal(integrationBandNoteText(dom), 'No connection states came back');
    assert.doesNotMatch(text, /Connected/);
  });

test('an integrations read failure degrades only the Outside connections card', async () => {
  const dom = await boot({ integrations: new Error('The operations API did not answer.') });

  assert.equal(dom.states[dom.states.length - 1], 'degraded');
  assert.match(liveText(dom), /owner@ops\.invalid/,
    'the account list went away because the integrations read failed');

  const card = cardByTitle(dom, 'Outside connections');
  assert.match(allText(card), /could not be read/i);
  assert.match(allText(card), /unread, not absent/i);
  assert.equal(integrationBandNoteText(dom), 'Could not be read');
});

test('an integrations role refusal is shown as a denied card, not a zero state',
  async () => {
    const refused = Object.assign(new Error('Your role does not allow this'), {
      code: 'ops_role_insufficient',
      requiredRoles: ['owner'],
    });
    const dom = await boot({ integrations: refused });
    const text = allText(cardByTitle(dom, 'Outside connections'));

    assert.match(text, /do not have access/i);
    assert.match(text, /owner role/i);
    assert.doesNotMatch(text, /ops_role_insufficient|0 connections/i);
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

/* `more` is the seventh field on the record and the last one load()'s reset
   left describing the window it had just discarded (Stadiora/Aria#10689).

   Both arms, because hiding Load more unconditionally passes the first test on
   its own and takes paging away from the pane entirely -- the same trap the
   section above is built around. The two tests differ only in whether the
   reload's record read answers, so what they isolate is the reset rather than
   anything about the read. */
test('a reload whose record read fails offers no Load more over the rows it lost',
  async () => {
    let zeroth = 0;
    const server = auditServer((offset) => {
      if (offset !== 0) return HOLD;
      zeroth += 1;
      /* A whole first page, so `more` is TRUE when the reload begins. A short
         page would leave it false and the test would pass without the fix. */
      return zeroth === 1 ? auditWindow('boot') : HOLD;
    });
    const dom = await boot({ audit: server.stub });
    const card = () => cardByTitle(dom, 'What was done');
    const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];
    const rowsOn = () => {
      /* The failure body replaces the table rather than emptying it, so
         "no rows" is the absence of a tbody here, not a tbody of length 0. */
      const body = card().querySelectorAll('tbody')[0];
      return body ? body.children.length : 0;
    };

    assert.equal(rowsOn(), AUDIT_PAGE, 'the first window is not on screen');
    assert.equal(moreButton().hidden, false,
      'a whole page was sent and Load more was not offered, so this test would pass '
      + 'against a record whose `more` was already false');

    /* The revoke reloads the pane, and this time the record read fails. */
    const accounts = cardByTitle(dom, 'Accounts');
    buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');
    const form = dom.doc.querySelector('.modal');
    form.querySelector('.modal-input').value = 'Laptop reported lost';
    form.dispatch('submit');
    await dom.settle();
    assert.equal(server.holdCount(), 1, 'the reload answered itself instead of being held');

    server.fail(0, new Error('The operations API did not answer.'));
    await dom.settle();

    assert.match(allText(card()), /could not be read/i,
      'the record read failed and the card is not saying so, so what follows is '
      + 'not the failure state this test is about');
    assert.equal(rowsOn(), 0, 'the failed reload left rows on screen');
    const more = moreButton();
    assert.ok(more, 'the record card lost its Load more control altogether');
    assert.equal(more.hidden, true,
      'the card says it could not read the record and is offering to load more of it');
  });

test('a reload whose record read answers a whole page still offers Load more',
  async () => {
    let zeroth = 0;
    const server = auditServer((offset) => {
      if (offset !== 0) return HOLD;
      zeroth += 1;
      return zeroth === 1 ? auditWindow('boot') : auditWindow('post');
    });
    const dom = await boot({ audit: server.stub });
    const card = () => cardByTitle(dom, 'What was done');
    const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];

    const accounts = cardByTitle(dom, 'Accounts');
    buttonsIn(accounts).filter((b) => /revoke/i.test(allText(b)))[0].dispatch('click');
    const form = dom.doc.querySelector('.modal');
    form.querySelector('.modal-input').value = 'Laptop reported lost';
    form.dispatch('submit');
    await dom.settle();

    assert.deepEqual(server.asked, [0, 0], 'the revoke did not reload the record');
    assert.match(allText(card()), /post_0\b/, 'the reloaded window is not on screen');
    assert.equal(moreButton().hidden, false,
      'the reload answered a whole page and Load more is hidden, so the reset clears '
      + '`more` without the read being allowed to set it again');

    /* And it pages from the reloaded window rather than the discarded one. */
    moreButton().dispatch('click');
    await dom.settle();
    assert.deepEqual(server.asked, [0, 0, AUDIT_PAGE],
      'Load more after the reload asked for the wrong window');
  });

/* The same defect on the other reset. loadRecord(reset) throws the window away
   in its own `if (reset)` block, which #10689's fix did not touch, and the
   Refresh button reaches it -- an operator presses that far more often than
   they revoke an account (Stadiora/Aria#10740).

   Both arms again, and for the same reason: a test that only checks Load more
   is hidden after a failure is satisfied by hiding it always. */
test('a Refresh whose record read fails offers no Load more over the rows it lost',
  async () => {
    let zeroth = 0;
    const server = auditServer((offset) => {
      if (offset !== 0) return HOLD;
      zeroth += 1;
      /* A whole first page, so `more` is TRUE when Refresh is pressed. */
      return zeroth === 1 ? auditWindow('boot') : HOLD;
    });
    const dom = await boot({ audit: server.stub });
    const card = () => cardByTitle(dom, 'What was done');
    const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];
    const refreshButton = () => buttonsIn(card()).filter((b) => /refresh/i.test(allText(b)))[0];
    const rowsOn = () => {
      const body = card().querySelectorAll('tbody')[0];
      return body ? body.children.length : 0;
    };

    assert.equal(rowsOn(), AUDIT_PAGE, 'the first window is not on screen');
    assert.equal(moreButton().hidden, false,
      'a whole page was sent and Load more was not offered, so this test would pass '
      + 'against a record whose `more` was already false');

    refreshButton().dispatch('click');
    await dom.settle();
    assert.deepEqual(server.asked, [0, 0], 'Refresh did not reread the record');
    assert.equal(server.holdCount(), 1, 'the reread answered itself instead of being held');

    server.fail(0, new Error('The operations API did not answer.'));
    await dom.settle();

    assert.match(allText(card()), /could not be read/i,
      'the reread failed and the card is not saying so, so what follows is not the '
      + 'failure state this test is about');
    assert.equal(rowsOn(), 0, 'the failed Refresh left rows on screen');
    const more = moreButton();
    assert.ok(more, 'the record card lost its Load more control altogether');
    assert.equal(more.hidden, true,
      'the card says it could not read the record and is offering to load more of it');
  });

test('a Refresh that answers a whole page still offers Load more', async () => {
  let zeroth = 0;
  const server = auditServer((offset) => {
    if (offset !== 0) return HOLD;
    zeroth += 1;
    return zeroth === 1 ? auditWindow('boot') : auditWindow('post');
  });
  const dom = await boot({ audit: server.stub });
  const card = () => cardByTitle(dom, 'What was done');
  const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];
  const refreshButton = () => buttonsIn(card()).filter((b) => /refresh/i.test(allText(b)))[0];

  refreshButton().dispatch('click');
  await dom.settle();

  assert.deepEqual(server.asked, [0, 0], 'Refresh did not reread the record');
  assert.match(allText(card()), /post_0\b/, 'the reread window is not on screen');
  assert.equal(moreButton().hidden, false,
    'the reread answered a whole page and Load more is hidden, so the reset clears '
    + '`more` without the read being allowed to set it again');

  moreButton().dispatch('click');
  await dom.settle();
  assert.deepEqual(server.asked, [0, 0, AUDIT_PAGE],
    'Load more after the Refresh asked for the wrong window');
});

/* The narrow arm of the same branch: a LATER page failing is not a reset, the
   rows stay on screen, and the window they came from still has more behind it.
   Clearing `more` there too would answer a failed retry by taking the retry
   away -- so the fix above is gated on `reset` and this test is what holds it
   there. */
test('a Load more that fails keeps the rows and keeps offering to try again',
  async () => {
    const server = auditServer((offset) => (offset === 0 ? auditWindow('boot') : HOLD));
    const dom = await boot({ audit: server.stub });
    const card = () => cardByTitle(dom, 'What was done');
    const moreButton = () => buttonsIn(card()).filter((b) => /load more/i.test(allText(b)))[0];
    const rowsOn = () => {
      const body = card().querySelectorAll('tbody')[0];
      return body ? body.children.length : 0;
    };

    moreButton().dispatch('click');
    await dom.settle();
    assert.deepEqual(server.asked, [0, AUDIT_PAGE], 'Load more asked for the wrong window');

    server.fail(0, new Error('The operations API did not answer.'));
    await dom.settle();

    assert.equal(rowsOn(), AUDIT_PAGE, 'a failed later page threw away the rows already read');
    assert.doesNotMatch(allText(card()), /could not be read/i,
      'a failed later page replaced the rows with a failure body');
    assert.equal(moreButton().hidden, false,
      'a later page failed and the pane withdrew the control that retries it');
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
