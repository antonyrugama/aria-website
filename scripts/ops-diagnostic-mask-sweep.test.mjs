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
const MASKED_TEXT = 'Contact [hidden contact detail] for this failure.';
const RAW_ADDRESS = /Coach\.Person\+run@eu\.example\.com/;
const MASKED_DIAGNOSTIC = /Contact \[hidden contact detail\] for this failure\./;
const OWNER_EMAIL = 'owner@example.invalid';
const ATHLETE_EMAIL = 'athlete.identity@example.invalid';
const BILLING_EMAIL = 'billing.identity@example.invalid';
const REVEALED_EMAIL = 'revealed.identity@example.invalid';

const clone = (value) => JSON.parse(JSON.stringify(value));

const IDENTITY_PATHS = {
  '/api/ops/auth/session': new Set(['data.admin.email']),
  '/api/ops/auth/reauth': new Set(['data.admin.email']),
  '/api/ops/admins': new Set(['data.*.email']),
  '/api/ops/audit': new Set(['data.*.actorEmail']),
  '/api/ops/users/lookup': new Set(['data.recorded.actor', 'data.matches.*.maskedEmail']),
  '/api/ops/users/:reference': new Set([
    'data.recorded.actor',
    'data.summary.fields.*.value',
    'data.record.fields.*.value',
    'data.billing.fields.*.value',
    'data.access.entries.*.actor',
  ]),
  '/api/ops/users/:reference/reveal': new Set(['data.value']),
};

function routeKey(route) {
  const bare = String(route || '').replace(/\?.*$/, '');
  if (bare === '/api/ops/users/lookup') return bare;
  if (/^\/api\/ops\/users\/[^/]+\/reveal$/.test(bare)) return '/api/ops/users/:reference/reveal';
  if (/^\/api\/ops\/users\/[^/]+$/.test(bare)) return '/api/ops/users/:reference';
  return bare;
}

function identityPath(route, path) {
  const paths = IDENTITY_PATHS[routeKey(route)];
  return !!(paths && paths.has(path.join('.')));
}

function injectEveryString(route, value, path = []) {
  if (typeof value === 'string') return identityPath(route, path) ? value : DIAGNOSTIC;
  if (Array.isArray(value)) return value.map((entry) => injectEveryString(route, entry, path.concat('*')));
  if (value && typeof value === 'object') {
    for (const child of Object.keys(value)) value[child] = injectEveryString(route, value[child], path.concat(child));
  }
  return value;
}

function injected(route, payload) {
  return injectEveryString(route, clone(payload));
}

function overviewPayload() {
  const data = clone(SUMMARY);
  for (const key of ['people', 'aiRuns', 'cost', 'release', 'activity']) {
    data[key].availability = { state: 'not_reporting', detail: DIAGNOSTIC };
    data[key].note = DIAGNOSTIC;
  }
  data.consent = { basis: 'operational', detail: DIAGNOSTIC };
  return data;
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
  return data;
}

function spendPayload() {
  return {
    availability: { state: 'ready' },
    range: 'month',
    currency: 'USD',
    generatedAt: ago(5 * 60_000),
    total: { micros: 1_200_000 },
    period: { start: '2026-09-01', endExclusive: '2026-09-08' },
    billedThrough: '2026-09-07',
    daily: {
      label: 'Daily spend',
      hint: DIAGNOSTIC,
      labels: ['2026-09-01', '2026-09-02'],
      series: [{ label: 'Current', color: 's1', values: [500_000, 700_000] }],
      note: DIAGNOSTIC,
    },
    views: {
      resourceGroup: {
        label: 'By resource group',
        hint: DIAGNOSTIC,
        rows: [{
          label: 'rg-aria-prod',
          description: DIAGNOSTIC,
          micros: 1_200_000,
          shareBasisPoints: 10_000,
        }],
      },
    },
  };
}

function usagePayload() {
  return {
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
    features: {
      hint: DIAGNOSTIC,
      rows: [{ label: 'Chat', appLabel: 'Aria', basisPoints: 6400 }],
    },
  };
}

function usersLookupPayload() {
  return clone(USER_LOOKUP);
}

function usersDetailPayload() {
  const data = clone(USER_DETAIL);
  data.summary.fields[1].neverShownNote = DIAGNOSTIC;
  data.summary.fields[2].unavailableNote = DIAGNOSTIC;
  data.record.fields[1].neverShownNote = DIAGNOSTIC;
  data.record.fields[2].unavailableNote = DIAGNOSTIC;
  return data;
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
  return {
    rules,
    channels: [
      { channel: 'teams', label: 'Microsoft Teams', configured: true,
        lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: ago(5 * 60_000), lastSuccessAt: ago(5 * 60_000) },
    ],
  };
}

function diagnosticResponses() {
  const responses = {
    '/api/ops/auth/session': clone(stub('/api/ops/auth/session')),
    '/api/ops/summary': { data: overviewPayload() },
    '/api/ops/alerts/problems': { data: { problems: [clone(PROBLEM)] } },
    '/api/ops/alerts/rules': { data: alertsRulesPayload() },
    '/api/ops/jobs': { data: clone(JOBS) },
    '/api/ops/runs': { data: clone(RUNS) },
    '/api/ops/costs': { data: spendPayload() },
    '/api/ops/releases': { data: releasesPayload() },
    '/api/ops/usage': { data: usagePayload() },
    '/api/ops/users/lookup': { data: usersLookupPayload() },
    '/api/ops/users/ath_123': { data: usersDetailPayload() },
    '/api/ops/admins': { data: clone(ADMINS) },
    '/api/ops/sessions': { data: clone(SESSIONS) },
    '/api/ops/audit': { data: clone(AUDIT) },
    '/api/ops/integrations': { data: clone(INTEGRATIONS) },
  };
  for (const [route, payload] of Object.entries(responses)) responses[route] = injected(route, payload);
  return responses;
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
    s: options.subject || (options.responses ? ADMIN.id : MASKED_TEXT),
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
      const bare = path.replace(/\?.*$/, '');
      const answer = responses[path] || responses[bare] ||
        (/^\/api\/ops\/users\/[^/]+\/reveal$/.test(bare)
          ? responses['/api/ops/users/ath_123/reveal']
          : /^\/api\/ops\/users\/[^/]+$/.test(bare)
            ? responses['/api/ops/users/ath_123']
            : null);
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

test('every non-identity string is masked at the ops data boundary for every loaded pane', async () => {
  for (const [pane, sources, file] of PANES) {
    const dom = await bootPane(pane, sources, { file });
    assertNoRawAddress(dom, pane);
  }
});

function cleanResponses() {
  return {
    '/api/ops/auth/session': clone(stub('/api/ops/auth/session')),
    '/api/ops/summary': { data: clone(SUMMARY) },
    '/api/ops/alerts/problems': { data: { problems: [clone(PROBLEM)] } },
    '/api/ops/alerts/rules': clone(stub('/api/ops/alerts/rules')),
    '/api/ops/jobs': { data: clone(JOBS) },
    '/api/ops/runs': { data: clone(RUNS) },
    '/api/ops/costs': { data: spendPayload() },
    '/api/ops/releases': { data: clone(RELEASES) },
    '/api/ops/usage': { data: usagePayload() },
    '/api/ops/users/lookup': { data: clone(USER_LOOKUP) },
    '/api/ops/users/ath_123': { data: clone(USER_DETAIL) },
    '/api/ops/users/ath_123/reveal': {
      data: { field: 'backupEmail', value: REVEALED_EMAIL, expiresAt: ago(-60_000), recorded: true },
    },
    '/api/ops/admins': { data: clone(ADMINS) },
    '/api/ops/sessions': { data: clone(SESSIONS) },
    '/api/ops/audit': { data: clone(AUDIT) },
    '/api/ops/integrations': { data: clone(INTEGRATIONS) },
  };
}

async function lookUpUser(dom) {
  const identifier = dom.doc.getElementById('lookupIdentifier');
  const reason = dom.doc.getElementById('lookupReason');
  identifier.value = 'ath_123';
  reason.value = 'support';
  dom.doc.querySelector('form').dispatch('submit');
  await settle();
}

test('allowlisted identity paths still render intended email values', async () => {
  const settings = await bootPane('settings', ['settings'], {
    file: 'settings.html',
    responses: cleanResponses(),
  });
  const settingsSurface = allDomTextAndAttrs(settings.body);
  assert.match(settingsSurface, new RegExp(OWNER_EMAIL.replace('.', '\\.')),
    'session administrator email was masked');
  assert.match(settingsSurface, /owner@ops\.invalid/, 'administrator email was masked');
  assert.match(settingsSurface, /operator@ops\.invalid/, 'second administrator email was masked');
  assert.match(settingsSurface, /nobody@ops\.invalid/, 'audit actor email was masked');

  const responses = cleanResponses();
  const detail = clone(USER_DETAIL);
  detail.record.fields.push({
    key: 'backupEmail',
    label: 'Backup email',
    masked: true,
    maskedValue: 'b•••@example.invalid',
    reveal: 'allowed',
  });
  detail.access.entries = [{
    occurredAt: ago(30_000),
    actor: 'access.actor@example.invalid',
    fields: 'contactEmail',
    reason: 'support',
    revealed: true,
  }];
  responses['/api/ops/users/ath_123'] = { data: detail };
  const people = await bootPane('users', ['users'], { file: 'users.html', responses });
  await lookUpUser(people);

  let peopleSurface = allDomTextAndAttrs(people.body);
  assert.match(peopleSurface, /ath\*{5}@example\.invalid/, 'lookup masked email was masked again');
  assert.match(peopleSurface, new RegExp(OWNER_EMAIL.replace('.', '\\.')),
    'lookup or account access-record actor was masked');
  assert.match(peopleSurface, new RegExp(ATHLETE_EMAIL.replaceAll('.', '\\.')),
    'summary or record email value was masked');
  assert.match(peopleSurface, new RegExp(BILLING_EMAIL.replaceAll('.', '\\.')),
    'billing email value was masked');
  assert.match(peopleSurface, /access\.actor@example\.invalid/, 'detail access actor was masked');

  const reveal = [...people.doc.querySelectorAll('button')]
    .find((button) => {
      const text = allDomTextAndAttrs(button);
      return text.includes('Reveal') && !text.includes('Hide again') &&
        !button.disabled && !button.classList.contains('hidden');
    });
  assert.ok(reveal, 'expected a live reveal button for the allowlisted reveal value');
  reveal.dispatch('click');
  const reason = [...people.doc.querySelectorAll('input')]
    .find((input) => input.getAttribute('placeholder') === 'Reason, recorded by field name');
  assert.ok(reason, 'expected the reveal reason input');
  reason.value = 'support';
  reason.closest('form').dispatch('submit');
  await settle();

  peopleSurface = allDomTextAndAttrs(people.body);
  assert.match(peopleSurface, new RegExp(REVEALED_EMAIL.replaceAll('.', '\\.')),
    'owner-authorized reveal value was masked');
});

test('People masks diagnostic notes but leaves intended email values alone', async () => {
  const dom = await bootPane('users', ['users'], { file: 'users.html' });
  await lookUpUser(dom);

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
    ['Overview availability detail', 'overview', ['alertsModel', 'overview'], 'index.html',
      { '/api/ops/summary': { data: overviewPayload() } }],
    ['Overview block and consent notes', 'overview', ['alertsModel', 'overview'], 'index.html',
      { '/api/ops/summary': { data: overviewPayload() } }],
    ['Releases source failure and candidate reason', 'releases', ['releases'], 'releases.html',
      { '/api/ops/releases': { data: releasesPayload() } }],
    ['Spend daily note', 'spend', ['spend'], 'spend.html',
      { '/api/ops/costs': { data: spendPayload() } }],
    ['Analytics cohort and coverage notes', 'analytics', ['analytics'], 'analytics.html',
      { '/api/ops/usage': { data: usagePayload() } }],
    ['Problems insufficient-data reason', 'alerts', ['alertsModel', 'alerts'], 'alerts.html',
      { '/api/ops/alerts/rules': { data: alertsRulesPayload() } }],
  ];
  for (const [name, pane, sources, file, overrides] of cases) {
    const dom = await bootPane(pane, sources, {
      file,
      responses: { ...cleanResponses(), ...overrides },
    });
    assertNoRawDiagnostic(dom, name);
  }

  const users = await bootPane('users', ['users'], { file: 'users.html' });
  await lookUpUser(users);
  assertNoRawDiagnostic(users, 'People neverShownNote and unavailableNote');
});

test('round-3 summary hint and description rows are covered by named cases', async () => {
  const overviewResponses = cleanResponses();
  const overviewProblem = clone(PROBLEM);
  overviewProblem.summary = DIAGNOSTIC;
  overviewResponses['/api/ops/alerts/problems'] = { data: { problems: [overviewProblem] } };
  assertNoRawDiagnostic(
    await bootPane('overview', ['alertsModel', 'overview'], {
      file: 'index.html',
      responses: overviewResponses,
    }),
    'Overview problem summary'
  );

  const problemResponses = cleanResponses();
  const problem = clone(PROBLEM);
  problem.summary = DIAGNOSTIC;
  problemResponses['/api/ops/alerts/problems'] = { data: { problems: [problem] } };
  assertNoRawDiagnostic(
    await bootPane('alerts', ['alertsModel', 'alerts'], {
      file: 'alerts.html',
      responses: problemResponses,
    }),
    'Problems summary'
  );

  const spendResponses = cleanResponses();
  const spend = spendPayload();
  spend.daily.hint = DIAGNOSTIC;
  spend.views.resourceGroup.hint = DIAGNOSTIC;
  spend.views.resourceGroup.rows[0].description = DIAGNOSTIC;
  spendResponses['/api/ops/costs'] = { data: spend };
  assertNoRawDiagnostic(
    await bootPane('spend', ['spend'], {
      file: 'spend.html',
      responses: spendResponses,
    }),
    'Spend hint and description'
  );

  const analyticsResponses = cleanResponses();
  const usage = usagePayload();
  usage.features.hint = DIAGNOSTIC;
  analyticsResponses['/api/ops/usage'] = { data: usage };
  assertNoRawDiagnostic(
    await bootPane('analytics', ['analytics'], {
      file: 'analytics.html',
      responses: analyticsResponses,
    }),
    'Analytics features hint'
  );
});
