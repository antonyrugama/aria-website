/* Boots a real pane page for the guided tour's tests.

   Unlike the per-pane suites, which load a hand-picked list of sources, this
   reads the page's own <script> tags and runs them in order, so a page that
   stops loading assets/tour.js, or loads it before the shell, is a page the
   tour cannot find rather than one a test quietly supplies it for. The two
   tags it does not run are theme.js, which only decides a colour before
   paint, and api.js, whose network transport is replaced by an answer from
   scripts/ops-api-stub.mjs — the same bodies the browser checks serve.

   People and usage is the exception to "the stub's bodies": the shared stub
   answers /api/ops/usage with an empty envelope on purpose (its header says
   why), and an empty envelope draws none of the figures the tour points at.
   usagePayload() below is a small answer in the route's shape, two apps with
   every block present, for that pane only. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { makeDom } from './ops-dom-harness.mjs';
import { ADMIN, stub } from './ops-api-stub.mjs';

const OPS = new URL('../ops/', import.meta.url);
export const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const SKIPPED = new Set(['theme.js', 'api.js']);

/* The registry, executed rather than parsed, so the pane list is the one the
   pages boot from. */
export function registry() {
  const dom = makeDom({});
  vm.createContext(dom.window);
  vm.runInContext(read('assets/pane-registry.js'), dom.window, { filename: 'pane-registry.js' });
  return dom.window.OpsPaneRegistry;
}

/* The assets a page's own <script> tags load, in document order. */
export function pageScripts(file) {
  const html = read(file).replace(/<!--[\s\S]*?-->/g, '');
  return [...html.matchAll(/<script\b[^>]*\bsrc="assets\/([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
}

export function pageSheets(file) {
  const html = read(file).replace(/<!--[\s\S]*?-->/g, '');
  return [...html.matchAll(/<link\b[^>]*\bhref="assets\/([^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
}

const bp = (n, d) => (d > 0 ? Math.round((n / d) * 10000) : 0);

function appColumn(app, label, subtitle, color, active, sessions, featurePeople, scale) {
  return {
    app, label, subtitle, tone: app,
    coverageBasisPoints: 10000,
    metrics: [
      { label: 'Active people', kind: 'count', value: active },
      { label: 'Sessions', kind: 'count', value: sessions },
      { label: 'Sessions per person', kind: 'decimal', digits: 1,
        value: sessions / active, numerator: sessions, denominator: active },
      { label: 'Opened a feature', kind: 'rate', value: bp(featurePeople, active),
        numerator: featurePeople, denominator: active },
    ],
    trend: {
      label: 'Active people per day, ' + label, color,
      values: Array.from({ length: 30 }, (_, i) => Math.round((1000 + i * 7) * scale)),
    },
  };
}

export function usagePayload() {
  const DAY = 86400000;
  const end = new Date(Math.floor(Date.now() / DAY) * DAY);
  const start = new Date(end.getTime() - 30 * DAY);
  return {
    asOf: end.toISOString(),
    window: {
      range: '30d', start: start.toISOString(), endExclusive: end.toISOString(),
      days: 30, grain: 'day', timezone: 'UTC',
      rollupsComputedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
      reportingStart: start.toISOString().slice(0, 10), daysCovered: 30, daysMissingRollups: [],
    },
    filters: { app: 'all', env: 'production' },
    reportingFloor: 50,
    consent: { enforcedAt: 'ingest', detail: 'Product analytics is opt in and defaults off.' },
    availability: { state: 'ready', detail: '' },
    apps: [
      appColumn('mobile', 'Mobile', 'Athlete app', 's1', 1061, 8430, 679, 1),
      appColumn('coaches', 'Coaches Web', 'Coach workspace', 's2', 308, 1204, 249, 0.29),
    ],
    notReporting: [],
    cohorts: [
      { app: 'mobile', label: 'Mobile', offsets: ['W1', 'W2'],
        note: 'A group is the accounts created in that UTC week.',
        rows: [
          { label: '24 Aug', size: 214, cells: [
            { basisPoints: bp(152, 214), returned: 152 }, { basisPoints: bp(112, 214), returned: 112 }] },
          { label: '31 Aug', size: 31, cells: [
            { basisPoints: bp(25, 31), returned: 25 }, { state: 'not_aged' }] },
        ] },
      { app: 'coaches', label: 'Coaches Web', offsets: ['W1'],
        note: 'A group is the accounts created in that UTC week.',
        rows: [{ label: '24 Aug', size: 96, cells: [{ basisPoints: bp(64, 96), returned: 64 }] }] },
    ],
    features: {
      hint: "Share of each app's own active people",
      rows: [
        { label: 'Aria chat', app: 'Mobile', color: 's1', basisPoints: bp(610, 1061),
          users: 610, denominator: 1061 },
        { label: 'Athlete roster', app: 'Coaches Web', color: 's2', basisPoints: bp(210, 308),
          users: 210, denominator: 308 },
      ],
      note: 'Each feature is measured against the active people of the app it belongs to.',
    },
    coverage: {
      shortfall: null,
      versions: [
        { label: 'Mobile 2.9.1', coverageBasisPoints: 10000, sessionShareBasisPoints: 10000,
          note: 'Share is of Mobile sessions.' },
        { label: 'Coaches Web version not reported', coverageBasisPoints: 10000,
          sessionShareBasisPoints: 10000, note: 'Share is of Coaches Web sessions.' },
      ],
    },
  };
}

export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/* The three gates every pane page carries, as the shell expects to find them,
   and the skip link that opens every page outside them. */
function buildPage(dom, body, paneId) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', paneId);
  body.className = 'is-booting';
  el(body, 'a', { class: 'skip', href: '#content' }).textContent = 'Skip to content';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { class: 'app', id: 'app' });
}

/* Boots one pane page and lets its reads settle.

   role       the role the session answers with; owner by default
   storage    localStorage entries to start from, as { key: value }, which is
              how a test stands for a reload: the same storage, a new page
   answer     (path) => { data } | Promise | undefined, consulted before the
              stub; returning undefined falls through to it
   lookup     for Look up a user: run a lookup the way a person does, so the
              pane draws an account

   Every request the page makes is recorded in `calls`, with its method. */
export async function bootPage(paneId, options = {}) {
  const reg = registry();
  const pane = reg.PANES[paneId];
  if (!pane) throw new Error('no such pane: ' + paneId);
  const calls = [];
  const dom = makeDom({
    tokens: TOKENS,
    runTimers: false,
    href: 'https://ops.example.invalid/ops/' + pane.file,
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body, paneId);

  for (const [k, v] of Object.entries(options.storage || {})) dom.window.localStorage.setItem(k, v);
  dom.window.sessionStorage.setItem('ops-access', JSON.stringify({
    token: 'stub-access', expiresAt: Date.now() + 86400000, s: ADMIN.id,
  }));
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };

  const role = options.role || 'owner';
  const admin = { ...ADMIN, role };
  dom.window.OpsApi = {
    OpsApiError: function OpsApiError(status, code, message) {
      this.status = status;
      this.code = code;
      this.message = message;
    },
    request(path, opts = {}) {
      calls.push({ path, method: opts.method || 'GET' });
      const url = new URL(path, 'https://ops.example.invalid');
      if (options.answer) {
        const given = options.answer(url.pathname, opts);
        if (given !== undefined) return Promise.resolve(given);
      }
      if (url.pathname === '/api/ops/usage') return Promise.resolve({ data: usagePayload() });
      const answer = JSON.parse(JSON.stringify(stub(url.pathname, url.search)));
      if (answer.data && answer.data.admin) answer.data.admin = { ...answer.data.admin, role };
      return Promise.resolve(answer);
    },
  };
  dom.window.OpsApi.OpsApiError.prototype = Object.create(Error.prototype);

  vm.createContext(dom.window);
  const scripts = pageScripts(pane.file).filter((f) => !SKIPPED.has(f));
  for (const file of scripts) {
    vm.runInContext(read('assets/' + file), dom.window, { filename: file });
  }
  await settle();

  if (options.lookup) {
    dom.doc.getElementById('lookupIdentifier').value = 'ath_123';
    dom.doc.getElementById('lookupReason').value = 'support request';
    dom.doc.querySelector('.hunt-form').dispatch('submit');
    await settle();
  }

  return { ...dom, body, calls, scripts, admin, pane, paneId, registry: reg };
}

/* The polite live region the shell announces through. */
export function liveRegion(doc) {
  return doc.body.children.find((el) => el.getAttribute('aria-live') === 'polite') || null;
}

export function dialog(doc) {
  return doc.body.children.find((el) => el.classList.contains('tour-modal')) || null;
}
