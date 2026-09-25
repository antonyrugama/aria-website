import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allDomTextAndAttrs } from './ops-dom-harness.mjs';
import {
  ADMIN, SUMMARY, RELEASES, RULES, PROBLEM, JOBS, RUNS, ADMINS, SESSIONS,
  AUDIT, INTEGRATIONS, USER_LOOKUP, USER_DETAIL, ago, DAY, stub,
} from './ops-api-stub.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const SRC = {
  registry: read('assets/pane-registry.js'),
  session: read('assets/session.js'),
  aria: read('assets/aria.js'),
  shell: read('assets/shell-pane-v2.js'),
  alertsModel: read('assets/alerts-model.js'),
  overview: read('assets/pane-overview.js'),
  jobs: read('assets/pane-jobs-live-v2.js'),
  history: read('assets/pane-run-history-v2.js'),
  alerts: read('assets/pane-alerts.js'),
  analytics: read('assets/pane-analytics.js'),
  spend: read('assets/pane-spend.js'),
  releases: read('assets/pane-releases.js'),
  users: read('assets/pane-users.js'),
  settings: read('assets/settings.js'),
};

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const DIAGNOSTIC = 'Contact Coach.Person+run@eu.example.com for this failure.';
const RAW_ADDRESS = /Coach\.Person\+run@eu\.example\.com/;
const MASKED_DIAGNOSTIC = /Contact \[hidden contact detail\] for this failure\./;

const clone = (value) => JSON.parse(JSON.stringify(value));

function diagnosticKey(key) {
  return ['detail', 'note', 'reason', 'message', 'explanation'].includes(key)
    || /(?:Reason|Note|Detail)$/.test(key);
}

function injectDiagnostics(value, key = null) {
  if (typeof value === 'string') return key && diagnosticKey(key) ? DIAGNOSTIC : value;
  if (Array.isArray(value)) return value.map((entry) => injectDiagnostics(entry));
  if (value && typeof value === 'object') {
    for (const child of Object.keys(value)) value[child] = injectDiagnostics(value[child], child);
  }
  return value;
}

function overviewPayload() {
  const data = clone(SUMMARY);
  for (const key of ['people', 'aiRuns', 'cost', 'release', 'activity']) {
    data[key].availability = { state: 'not_reporting', detail: DIAGNOSTIC };
    data[key].note = DIAGNOSTIC;
  }
  data.consent = { basis: 'operational', detail: DIAGNOSTIC };
  return injectDiagnostics(data);
}

function releasesPayload() {
  const data = clone(RELEASES);
  data.sources[0].status = 'failed';
  data.sources[0].failureReason = DIAGNOSTIC;
  data.candidate = {
    versionName: '1.2.0',
    status: 'blocked',
    reason: DIAGNOSTIC,
    checkLabel: 'Preflight',
    checkValue: 'blocked',
  };
  return injectDiagnostics(data);
}

function spendPayload() {
  return injectDiagnostics({
    availability: { state: 'ready' },
    range: 'month',
    currency: 'USD',
    generatedAt: ago(5 * 60_000),
    total: { micros: 1_200_000 },
    period: { start: '2026-09-01', endExclusive: '2026-09-08' },
    billedThrough: '2026-09-07',
    daily: {
      label: 'Daily spend',
      labels: ['2026-09-01', '2026-09-02'],
      series: [{ label: 'Current', color: 's1', values: [500_000, 700_000] }],
      note: DIAGNOSTIC,
    },
    views: {},
  });
}

function usagePayload() {
  return injectDiagnostics({
    availability: { state: 'ready' },
    reportingFloor: 10,
    window: { days: 7 },
    apps: [
      {
        key: 'aria',
        label: 'Aria',
        coverageBasisPoints: 10_000,
        metrics: [{ key: 'sessions', label: 'Sessions', kind: 'count', value: 120 }],
        trend: { color: 's1', values: [80, 92, 120] },
      },
      {
        key: 'coaches',
        label: 'Coaches Web',
        coverageBasisPoints: 10_000,
        metrics: [{ key: 'sessions', label: 'Sessions', kind: 'count', value: 42 }],
        trend: { color: 's2', values: [30, 34, 42] },
      },
    ],
    cohorts: [{
      label: 'Aria accounts',
      note: DIAGNOSTIC,
      offsets: [0, 1],
      rows: [{
        label: '1 Sep',
        size: 24,
        cells: [{ basisPoints: 5000 }, { state: 'not_aged' }],
      }],
    }],
    coverage: {
      versions: [
        { label: '2.9.1', sessions: 90, basisPoints: 7500, reportingBasisPoints: 10000,
          note: DIAGNOSTIC },
        { label: '2.9.0', sessions: 30, basisPoints: 2500, reportingBasisPoints: 10000,
          note: DIAGNOSTIC },
      ],
    },
  });
}

function usersLookupPayload() {
  return injectDiagnostics(clone(USER_LOOKUP));
}

function usersDetailPayload() {
  const data = clone(USER_DETAIL);
  data.summary.fields[1].neverShownNote = DIAGNOSTIC;
  data.summary.fields[2].unavailableNote = DIAGNOSTIC;
  data.record.fields[1].neverShownNote = DIAGNOSTIC;
  data.record.fields[2].unavailableNote = DIAGNOSTIC;
  return injectDiagnostics(data);
}

function alertsRulesPayload() {
  const rules = clone(RULES).map((rule) => ({
    severity: 'warning',
    category: 'ai_reliability',
    lastEvaluatedAt: ago(2 * 60_000),
    lastFiredAt: null,
    ...rule,
  }));
  rules[1].enabled = true;
  rules[1].lastEvaluationStatus = 'insufficient_data';
  rules[1].lastInsufficientReason = DIAGNOSTIC;
  return injectDiagnostics({
    rules,
    channels: [
      { channel: 'teams', label: 'Microsoft Teams', configured: true,
        lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: ago(5 * 60_000), lastSuccessAt: ago(5 * 60_000) },
    ],
  });
}

function diagnosticResponses() {
  return {
    '/api/ops/auth/session': clone(stub('/api/ops/auth/session')),
    '/api/ops/summary': { data: overviewPayload() },
    '/api/ops/alerts/problems': { data: injectDiagnostics({ problems: [clone(PROBLEM)] }) },
    '/api/ops/alerts/rules': { data: alertsRulesPayload() },
    '/api/ops/jobs': { data: injectDiagnostics(clone(JOBS)) },
    '/api/ops/runs': { data: injectDiagnostics(clone(RUNS)) },
    '/api/ops/costs': { data: spendPayload() },
    '/api/ops/releases': { data: releasesPayload() },
    '/api/ops/usage': { data: usagePayload() },
    '/api/ops/users/lookup': { data: usersLookupPayload() },
    '/api/ops/users/ath_123': { data: usersDetailPayload() },
    '/api/ops/admins': { data: injectDiagnostics(clone(ADMINS)) },
    '/api/ops/sessions': { data: injectDiagnostics(clone(SESSIONS)) },
    '/api/ops/audit': { data: injectDiagnostics(clone(AUDIT)) },
    '/api/ops/integrations': { data: injectDiagnostics(clone(INTEGRATIONS)) },
  };
}

function buildPage(dom, body, pane) {
  const add = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', pane);
  body.className = 'is-booting';
  const boot = add(body, 'main', { class: 'gate gate-boot gate-center' });
  add(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  add(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = add(body, 'div', { class: 'gate gate-app' });
  add(appGate, 'div', { id: 'app' });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function bootPane(pane, paneSources, options = {}) {
  const responses = options.responses || diagnosticResponses();
  const calls = [];
  const dom = makeDom({
    tokens: TOKENS,
    runTimers: false,
    href: 'https://ops.example.invalid/ops/' + (options.file || pane + '.html'),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body, pane);

  dom.window.sessionStorage.setItem('ops-access', JSON.stringify({
    token: 'stub-access',
    expiresAt: Date.now() + DAY,
    s: ADMIN.id,
  }));
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsApi = {
    OpsApiError: function OpsApiError(status, code, message) {
      this.status = status;
      this.code = code;
      this.message = message;
    },
    request(path) {
      calls.push(path);
      const answer = responses[path] || responses[path.replace(/\?.*$/, '')];
      if (!answer) return Promise.resolve({ data: {} });
      return Promise.resolve(clone(answer));
    },
  };
  dom.window.OpsApi.OpsApiError.prototype = Object.create(Error.prototype);

  vm.createContext(dom.window);
  vm.runInContext(SRC.registry, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(SRC.session, dom.window, { filename: 'session.js' });
  vm.runInContext(SRC.aria, dom.window, { filename: 'aria.js' });
  vm.runInContext(SRC.shell, dom.window, { filename: 'shell-pane-v2.js' });
  for (const source of paneSources) vm.runInContext(SRC[source], dom.window, { filename: source + '.js' });
  await settle();
  return { ...dom, body, calls, responses };
}

function assertNoRawDiagnostic(dom, label) {
  const surface = allDomTextAndAttrs(dom.body);
  assert.doesNotMatch(surface, RAW_ADDRESS, label + ' leaked the raw diagnostic address');
  assert.match(surface, MASKED_DIAGNOSTIC, label + ' did not render a masked diagnostic control');
}

function assertNoRawAddress(dom, label) {
  assert.doesNotMatch(allDomTextAndAttrs(dom.body), RAW_ADDRESS,
    label + ' leaked the raw diagnostic address');
}

const PANES = [
  ['overview', ['alertsModel', 'overview'], 'index.html'],
  ['releases', ['releases'], 'releases.html'],
  ['spend', ['spend'], 'spend.html'],
  ['analytics', ['analytics'], 'analytics.html'],
  ['alerts', ['alertsModel', 'alerts'], 'alerts.html'],
  ['jobs', ['jobs'], 'jobs-live.html'],
  ['history', ['history'], 'run-history.html'],
  ['settings', ['settings'], 'settings.html'],
];

test('diagnostic prose keys are masked at the ops data boundary for every loaded pane', async () => {
  for (const [pane, sources, file] of PANES) {
    const dom = await bootPane(pane, sources, { file });
    assertNoRawAddress(dom, pane);
  }
});

test('People masks diagnostic notes but leaves intended email values alone', async () => {
  const dom = await bootPane('users', ['users'], { file: 'users.html' });
  const identifier = dom.doc.getElementById('lookupIdentifier');
  const reason = dom.doc.getElementById('lookupReason');
  identifier.value = 'ath_123';
  reason.value = 'support';
  dom.doc.querySelector('form').dispatch('submit');
  await settle();

  const surface = allDomTextAndAttrs(dom.body);
  assert.doesNotMatch(surface, RAW_ADDRESS,
    'People leaked diagnostic prose through neverShownNote or unavailableNote');
  assert.match(surface, MASKED_DIAGNOSTIC,
    'People did not render the masked diagnostic notes');
  assert.match(surface, /athlete\.identity@example\.invalid/,
    'People masked an intended unmasked identity email value');
  assert.match(surface, /billing\.identity@example\.invalid/,
    'People masked an intended unmasked billing email value');
});

test('round-2 reviewed diagnostic rows are covered by the boundary sweep', async () => {
  const cases = [
    ['Overview availability detail', 'overview', ['alertsModel', 'overview'], 'index.html'],
    ['Overview block and consent notes', 'overview', ['alertsModel', 'overview'], 'index.html'],
    ['Releases source failure and candidate reason', 'releases', ['releases'], 'releases.html'],
    ['Spend daily note', 'spend', ['spend'], 'spend.html'],
    ['Analytics cohort and coverage notes', 'analytics', ['analytics'], 'analytics.html'],
    ['Problems insufficient-data reason', 'alerts', ['alertsModel', 'alerts'], 'alerts.html'],
  ];
  for (const [name, pane, sources, file] of cases) {
    const dom = await bootPane(pane, sources, { file });
    assertNoRawDiagnostic(dom, name);
  }

  const users = await bootPane('users', ['users'], { file: 'users.html' });
  users.doc.getElementById('lookupIdentifier').value = 'ath_123';
  users.doc.getElementById('lookupReason').value = 'support';
  users.doc.querySelector('form').dispatch('submit');
  await settle();
  assertNoRawDiagnostic(users, 'People neverShownNote and unavailableNote');
});
