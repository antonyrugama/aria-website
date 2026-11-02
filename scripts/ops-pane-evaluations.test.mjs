import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, find, findAll } from './ops-dom-harness.mjs';

const SOURCE = new URL('../ops/assets/pane-evaluations.js', import.meta.url);
const WRAPPER_OPEN = '(function (global) {';
const WRAPPER_CLOSE = '})(window);';

function paneBody() {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf(WRAPPER_OPEN);
  const end = source.lastIndexOf(WRAPPER_CLOSE);
  assert.ok(start !== -1, 'pane-evaluations.js wrapper opening is missing');
  assert.ok(end > start, 'pane-evaluations.js wrapper closing is missing');
  return source.slice(start + WRAPPER_OPEN.length, end);
}

function loadPane(call = () => Promise.reject(new Error('unexpected request')), Clock = Date, role = 'operator') {
  const maskContactDetails = (text) => String(text).replace(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g,
    '[hidden contact detail]');
  function element(tag, opts = {}, children = []) {
    let text = opts.text || '';
    const node = {
      tag,
      children: [],
      attributes: {},
      listeners: {},
      style: {},
      className: opts.className || '',
      value: opts.value || '',
      hidden: false,
      disabled: false,
      required: false,
      files: [],
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
      dispatch(name, event = {}) {
        const listener = this.listeners[name];
        assert.equal(typeof listener, 'function', `${tag} ${name} listener is missing`);
        return listener({
          preventDefault() {},
          ...event,
        });
      },
      focus() {},
    };
    Object.defineProperty(node, 'textContent', {
      get() {
        return text;
      },
      set(value) {
        text = String(value);
        if (text === '') this.children = [];
      },
    });
    children.forEach(child => node.appendChild(child));
    node.options = tag === 'select' ? node.children : [];
    return node;
  }
  /* The panel shapes assets/shell-pane-v2.js hands a pane, stubbed to the same
     class names and heading levels. These reproduce the shell rather than run
     it, so nothing that depends on their exact output is asserted here: the
     structural assertions — the stamp partition, the preview, the role gate —
     run against the real shell on the real page in the OpsPaneShell block at
     the end of this file. */
  function cardHead(title, note, end = []) {
    const words = element('div', {}, [element('h3', { className: 'card-title', text: title })]);
    if (note) words.appendChild(element('div', { className: 'card-note', text: note }));
    const head = element('div', { className: 'card-head' }, [words]);
    if (end.length) head.appendChild(element('div', { className: 'card-end' }, end));
    return head;
  }
  function band(title, note, end = []) {
    const head = element('div', { className: 'band-head' }, [
      element('h2', { className: 'band-title', text: title }),
    ]);
    if (note) head.appendChild(element('span', { className: 'band-note', text: note }));
    if (end.length) head.appendChild(element('div', { className: 'band-end' }, end));
    return element('section', { className: 'band' }, [head]);
  }
  const window = {
    crypto: webcrypto,
    /* The pane schedules the approval answer's text one task after it reveals
       the region it lands in (Stadiora/Aria#10809), so the timer has to be
       real here or the answer never arrives. Real, not faked: a stub clock
       would let an assertion pass in an order the browser never runs. */
    setTimeout,
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64');
    },
    /* A width that never matches, so this stub renders the pane the way a
       desktop does: every band open, no fold state. That is the shape the
       assertions below were written against and the shape they still mean.
       The narrow layout and the fold control are bound in real Chrome by
       scripts/ops-narrow-panes.test.mjs, which can resolve a media query, a
       computed style and an accessibility tree; none of those exist here,
       and a fake that answered `matches: true` would be asserting against
       its own opinion of the breakpoint rather than against the sheet. */
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    OpsPaneShell: {
      h: element,
      icon: () => element('svg'),
      definePane: () => {},
      announce: () => {},
      card: className => element('div', { className: `card${className ? ` ${className}` : ''}` }),
      cardHead,
      band,
      stateBlock: (iconName, title, lines = []) => element('div', { className: 'state-block' }, [
        element('div', { className: 'state-icon' }, [element('svg')]),
        element('h2', { className: 'state-title', text: title }),
        ...lines.map(line => element('p', { className: 'state-desc', text: line })),
      ]),
      link: (href, label, className) => element('a', { className: className || 'btn btn-sm', href, text: label }),
      paneHref: paneId => `${paneId}.html`,
    },
    OpsPaneRegistry: {
      maskContactDetails,
    },
    OpsSession: {
      call,
      hasRole: roles => roles.includes(role),
    },
  };
  const context = vm.createContext({
    window,
    global: window,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    console,
  });
  vm.runInContext(paneBody(), context, { filename: 'ops/assets/pane-evaluations.js' });
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function treeText(node) {
  return [node.textContent || '', ...(node.children || []).map(treeText)].join(' ');
}

function treeOrder(root) {
  const out = [];
  (function visit(node) {
    out.push(node);
    for (const child of node.children || []) visit(child);
  })(root);
  return out;
}

function assertBefore(root, first, second, message) {
  const order = treeOrder(root);
  assert.ok(order.indexOf(first) !== -1, 'first node is missing from tree order');
  assert.ok(order.indexOf(second) !== -1, 'second node is missing from tree order');
  assert.ok(order.indexOf(first) < order.indexOf(second), message);
}

function datasetInput() {
  const reference = (id, path) => ({ id, version: 1, path, sha256: 'a'.repeat(64) });
  return {
    datasets: [{
      schemaVersion: 'seval.dataset.v1',
      datasetId: 'dataset.example',
      revision: 1,
      provenance: {
        origin: 'synthetic',
        authoredAt: '2026-09-19T00:00:00Z',
        authorRef: 'author.synthetic',
        sourceRefs: [reference('source.example', 'source.json')],
      },
      cases: [{
        scenario: reference('scenario.example', 'scenario.json'),
        fixtures: [],
        media: [],
        schemas: [reference('schema.example', 'schema.json')],
        rubrics: [reference('rubric.example', 'rubric.json')],
        product: 'product.example',
        capabilityRef: 'seval.g01.athlete-chat',
        locale: 'en',
        risk: { level: 'low', domains: ['training'] },
        split: 'development',
        lineage: {
          personaRefs: ['persona.example'],
          conversationRefs: [],
          incidentRefs: [],
          nearDuplicateGroupRefs: [],
        },
        labels: [],
      }],
    }],
    fixtureDigests: [],
  };
}

function datasetResponse(requestId) {
  return {
    schemaVersion: 'seval.operation.response.v1',
    requestId,
    operationId: 'seval.dataset.validate',
    status: 'success',
    exitCode: 0,
    resource: {
      type: 'seval.dataset-validation',
      id: requestId,
      revision: 1,
      value: {
        valid: true,
        issues: [],
        digests: [{ datasetId: 'dataset.example', revision: 1, sha256: 'b'.repeat(64) }],
      },
    },
  };
}

test('dataset form sends declarations and clears its result when the input changes', async () => {
  const input = datasetInput();
  let observed;
  const view = renderedPane(async (path, options) => {
    observed = { path, options: plain(options) };
    return datasetResponse(options.body.requestId);
  });
  const form = findNode(view.root, node => node.className === 'card dataset-form');
  assert.ok(form, 'dataset validation form is missing');
  view.byId('dataset-input').value = JSON.stringify(input);
  await form.dispatch('submit');

  assert.equal(observed.path, '/api/ops/seval/operations');
  assert.equal(observed.options.method, 'POST');
  assert.deepEqual(Object.keys(observed.options.body).sort(),
    ['schemaVersion', 'requestId', 'operationId', 'mode', 'client', 'input'].sort());
  assert.equal(observed.options.body.schemaVersion, 'seval.operation.request.v1');
  assert.equal(observed.options.body.operationId, 'seval.dataset.validate');
  assert.equal(observed.options.body.mode, 'remote');
  assert.deepEqual(observed.options.body.client, {
    name: 'aria-operations-dashboard',
    version: '1.0.0',
    contractVersions: ['seval.operations.v1'],
  });
  assert.deepEqual(observed.options.body.input, input);
  const result = findNode(view.root, node => node.className === 'dataset-result');
  const text = node => [node.textContent || '', ...(node.children || []).map(text)].join(' ');
  assert.match(text(result), /Declarations valid/);
  assert.match(text(result), /dataset.example/);
  assert.ok(text(result).includes('b'.repeat(64)));
  view.byId('dataset-input').dispatch('input');
  assert.equal(result.children.length, 0, 'a changed declaration must not retain the previous result');
});

function browsePayload(overrides = {}) {
  return {
    catalogue: {
      registryVersion: 'seval.capabilities.v1',
      clients: [{ id: 'client.run-with-aria-mobile', name: 'Run with Aria mobile', status: 'direct', owner: 'mobile-app' }],
      capabilities: [{
        id: 'seval.g01.athlete-chat',
        name: 'Athlete chat',
        owner: 'app-backend/aria-api',
        status: 'reachable',
        products: ['aria'],
        clientRefs: ['client.run-with-aria-mobile'],
        actor: 'athlete',
        subject: 'self',
        coverage: { state: 'draft', scenarioIssue: 'https://github.com/Stadiora/Aria/issues/9784', oracleCount: 2, executionReceiptCount: 0 },
      }, {
        id: 'seval.g99.uncovered',
        name: 'Uncovered disabled capability',
        owner: 'ianrowe12',
        status: 'feature-disabled',
        products: ['aria'],
        clientRefs: [],
        actor: 'athlete',
        subject: 'self',
        coverage: { state: 'uncovered', scenarioIssue: null, oracleCount: 0, executionReceiptCount: 0 },
      }],
    },
    scenarios: [{
      scenarioId: 'scenario.demo.secret-prompt',
      version: 2,
      schemaVersion: 'seval.scenario.v2',
      product: 'aria',
      client: 'client.run-with-aria-mobile',
      role: 'athlete',
      capabilityRef: 'seval.g01.athlete-chat',
      locale: 'en-US',
      risk: { level: 'medium', domains: ['training'] },
      review: { status: 'not_certified', promotionEligibility: 'ineligible', source: 'scenario-v2' },
      criteriaCounts: { critical: 1, required: 0, expected: 1, aspirational: 0 },
      pack: { runnable: true, executed: false, passing: null },
      sourceLinks: [{ label: 'Public coaching source', uri: 'https://example.test/source' }],
    }],
    datasets: {
    partial: true,
    omissions: ['Dataset review state is declaration-only; no approval writer exists on main.'],
    datasets: [{
        datasetId: 'dataset.demo.development',
        revision: 1,
        schemaVersion: 'seval.dataset.v1',
        provenance: { origin: 'synthetic', authoredAt: '2026-09-19T00:00:00Z', authorRef: 'author.synthetic', sourceRefs: [] },
        review: { state: 'proposed', promotionEligibility: 'ineligible' },
        counts: { cases: 1, labels: 1, generatedLabels: 1, humanLabels: 0, qualificationRefs: 0 },
        cases: [{
          scenario: { id: 'scenario.demo.secret-prompt', version: 2, path: 'evals/demo/v1/scenarios.json' },
          rubrics: [{ id: 'rubric.demo.no-retrieval.criteria', version: 1, path: 'evals/demo/v1/rubric.json' }],
          comparison: { state: 'unavailable', reason: 'No comparison validity metadata is recorded.' },
        }],
      }],
    },
    coverage: {
      metrics: [
        { key: 'inventory', numerator: 2, denominator: 2, denominatorKind: 'registered capabilities' },
        { key: 'approved', numerator: 0, denominator: 1, denominatorKind: 'authored capabilities' },
        { key: 'executed', numerator: 0, denominator: 1, denominatorKind: 'runnable capabilities' },
      ],
      flags: {
        unownedCapabilities: [],
        uncoveredCapabilities: ['seval.g99.uncovered'],
        notCertifiedCapabilities: ['seval.g01.athlete-chat'],
        disabledOrUnsupportedCapabilities: [{ id: 'seval.g99.uncovered', status: 'feature-disabled', reason: 'Reserved surface is not supported yet.' }],
        missingCases: [{ capabilityRef: 'seval.g99.uncovered', reason: 'No checked-in scenario references this capability.' }],
        unknownCapabilityRefs: ['capability.example.unregistered'],
      },
    },
    ...overrides,
  };
}

test('browse pane reads SEVAL admin overview, renders honest coverage and applies filters', async () => {
  const calls = [];
  const view = renderedPane(async (path, options = {}) => {
    calls.push({ path, options: plain(options) });
    if (options.query?.product === 'fitmg') {
      return browsePayload({ scenarios: [] });
    }
    return browsePayload();
  });



  view.byId('seval-browse-filters').dispatch('submit');
  await waitFor(() => calls.length === 1, 'browse overview was not loaded');
  const browse = view.byId('seval-browse-panel');
  assert.ok(browse, 'browse panel is missing');
  assert.equal(calls[0].path, '/api/ops/seval/admin/overview');
  await waitFor(() => /scenario\.demo\.secret-prompt/.test(treeText(browse)), 'browse scenarios did not render');
  assert.match(treeText(browse), /scenario\.demo\.secret-prompt/);
  assert.match(treeText(browse), /Not certified/);
  assert.match(treeText(browse), /0 \/ 1 authored capabilities/);
  assert.match(treeText(browse), /dataset\.demo\.development/);
  assert.match(treeText(browse), /seval\.g99\.uncovered/);

  view.byId('seval-filter-product').value = 'fitmg';
  view.byId('seval-browse-filters').dispatch('submit');
  await waitFor(() => calls.length === 2, 'filtered browse read was not sent');
  assert.deepEqual(calls[1].options.query, { product: 'fitmg' });
  await waitFor(() => /No scenarios match these filters/.test(treeText(browse)), 'filtered empty state did not render');
  assert.match(treeText(browse), /No scenarios match these filters/);
  assert.doesNotMatch(treeText(browse), /scenario\.demo\.secret-prompt/);
});

test('browse pane renders full catalogue and backend disclosures without truncation', async () => {
  const capabilities = Array.from({ length: 7 }, (_, index) => ({
    id: `seval.g${String(index + 1).padStart(2, '0')}.capability`,
    name: `Capability ${index + 1}`,
    owner: 'ianrowe12',
    status: index === 6 ? 'feature-disabled' : 'reachable',
    products: ['aria'],
    clientRefs: ['client.run-with-aria-mobile'],
    actor: 'athlete',
    subject: 'self',
    coverage: { state: 'draft', scenarioIssue: null, oracleCount: 0, executionReceiptCount: 0 },
  }));
  const view = renderedPane(() => browsePayload({
    catalogue: {
      registryVersion: 'seval.capabilities.v1',
      clients: [{ id: 'client.run-with-aria-mobile', name: 'Run with Aria mobile', status: 'direct', owner: 'mobile-app' }],
      capabilities,
    },
  }));

  view.byId('seval-browse-filters').dispatch('submit');
  const browse = view.byId('seval-browse-panel');
  await waitFor(() => /Capability 7/.test(treeText(browse)), 'full capability catalogue did not render');
  assert.match(treeText(browse), /Showing 7 of 7 registered capabilities/);
  assert.match(treeText(browse), /Capability 7/);
  assert.match(treeText(browse), /feature-disabled/);
  assert.match(treeText(browse), /capability\.example\.unregistered/);
  assert.match(treeText(browse), /No checked-in scenario references this capability/);
});

test('browse pane loads version-bound scenario and dataset inspection details', async () => {
  const calls = [];
  const view = renderedPane(async (path, options = {}) => {
    calls.push({ path, options: plain(options) });
    if (path === '/api/ops/seval/admin/scenarios/scenario.demo.secret-prompt') {
      return {
        data: {
          ...browsePayload().scenarios[0],
          criteria: {
            critical: [{
              id: 'criterion.critical.safe',
              statement: 'Does not invent a completed workout.',
              evidenceRefs: ['source.public'],
              graderRef: 'grader.no-completion',
              grading: { method: 'not_contains', gating: true },
              authority: { schema: 'v2-authority', tier: 'B', domain: 'training', approvalState: 'none', approvals: [] },
            }],
            required: [],
            expected: [{
              id: 'criterion.expected.helpful',
              statement: 'Mentions planned work.',
              evidenceRefs: ['source.public'],
              graderRef: 'grader.planned',
              grading: { method: 'contains', gating: false },
              authority: {
                schema: 'v2-authority',
                tier: 'B',
                domain: 'training',
                approvalState: 'approved',
                approvals: [{
                  kind: 'expert_reviewed',
                  reviewerRef: 'reviewer.training',
                  qualificationPresent: true,
                  domain: 'training',
                  scenarioVersion: 2,
                }],
              },
            }],
            aspirational: [],
          },
          oracle: { expectedOutcomeKind: 'text', referenceFacts: [{ id: 'fact.public', sourceRef: 'source.public' }] },
          redactions: ['history', 'prompt'],
        },
      };
    }
    if (path === '/api/ops/seval/admin/datasets/dataset.demo.development') {
      return { data: {
        ...browsePayload().datasets.datasets[0],
        cases: [{
          scenario: { id: 'scenario.detail.only', version: 7, path: 'evals/detail-only/scenarios.json', sha256: 'c'.repeat(64) },
          rubrics: [{ id: 'rubric.detail.only', version: 3, path: 'evals/detail-only/rubric.json', sha256: 'd'.repeat(64) }],
          comparison: { state: 'unavailable', reason: 'Detail-only comparison metadata is recorded.' },
        }],
      } };
    }
    return browsePayload();
  });

  view.byId('seval-browse-filters').dispatch('submit');
  const browse = view.byId('seval-browse-panel');
  await waitFor(() => /Inspect scenario/.test(treeText(browse)), 'scenario inspect action did not render');
  findNode(browse, node => node.tag === 'button' && node.textContent === 'Inspect scenario').dispatch('click');
  await waitFor(() => findNode(browse, node => node.className === 'browse-detail' && /Does not invent a completed workout/.test(treeText(node))), 'scenario detail did not render');
  const scenarioDetail = findNode(browse, node => node.className === 'browse-detail' && /Does not invent a completed workout/.test(treeText(node)));
  assert.deepEqual(calls.find(call => call.path.includes('/scenarios/')).options.query, { version: '2' });
  assert.match(treeText(scenarioDetail), /source\.public/);
  assert.match(treeText(scenarioDetail), /Public coaching source/);
  assert.match(treeText(scenarioDetail), /https:\/\/example\.test\/source/);
  assert.match(treeText(scenarioDetail), /Authority: v2-authority · tier B · domain training · approval none/);
  assert.match(treeText(scenarioDetail), /qualification reference present/);
  assert.doesNotMatch(treeText(scenarioDetail), /\bqualified\b/);
  assert.match(treeText(scenarioDetail), /Redacted: history, prompt/);

  findNode(browse, node => node.tag === 'button' && node.textContent === 'Inspect dataset').dispatch('click');
  const datasetArticle = findNode(browse, node => node.className === 'browse-dataset' && /dataset\.demo\.development/.test(treeText(node)));
  await waitFor(() => findNode(datasetArticle, node => node.className === 'browse-detail' && /scenario\.detail\.only/.test(treeText(node))), 'dataset detail did not render');
  const datasetDetail = findNode(datasetArticle, node => node.className === 'browse-detail' && /scenario\.detail\.only/.test(treeText(node)));
  assert.deepEqual(calls.find(call => call.path.includes('/datasets/')).options.query, { revision: '1' });
  assert.match(treeText(datasetDetail), /evals\/detail-only\/scenarios\.json/);
  assert.match(treeText(datasetDetail), /rubric\.detail\.only/);
  assert.match(treeText(datasetDetail), /Detail-only comparison metadata is recorded/);
});

test('browse pane keeps facet options stable after filtered and empty reads', async () => {
  const view = renderedPane(async (_path, options = {}) => {
    if (options.query?.role === 'athlete') {
      return browsePayload({ scenarios: [] });
    }
    return browsePayload({
      scenarios: [
        browsePayload().scenarios[0],
        { ...browsePayload().scenarios[0], scenarioId: 'scenario.demo.coach', role: 'coach' },
      ],
    });
  });

  view.byId('seval-browse-filters').dispatch('submit');
  const roleOptions = () => view.byId('seval-filter-role').children || [];
  await waitFor(() => roleOptions().some(option => option.value === 'coach'), 'coach facet missing initially');
  view.byId('seval-filter-role').value = 'athlete';
  view.byId('seval-browse-filters').dispatch('submit');
  await waitFor(() => /No scenarios match/.test(treeText(view.byId('seval-browse-panel'))), 'empty result did not render');
  assert.equal(view.byId('seval-filter-role').value, 'athlete');
  assert.ok(roleOptions().some(option => option.value === 'coach'), 'coach facet option must remain reachable');
});

test('run launch pane sends only code-owned baseline and candidate manifests and keeps partial failures recoverable', async () => {
  const calls = [];
  const runResponse = (request, status, runId) => ({
    schemaVersion: 'seval.operation.response.v1',
    requestId: request.requestId,
    operationId: 'seval.run.launch',
    status: 'success',
    exitCode: 0,
    resource: {
      type: 'seval.run',
      id: runId,
      revision: 1,
      value: {
        runId,
        revision: 1,
        status,
        mode: request.input.manifest.mode,
        manifestDigest: 'a'.repeat(64),
        budget: {
          estimatedCostCents: request.input.manifest.budget.estimatedCostCents,
          accountedCostCents: 0,
          monthlyCapCents: 30000,
          perRunCapCents: 2500,
          maxProviderConcurrency: 4,
          reservedProviderConcurrency: 0,
        },
        createdAt: '2026-09-19T12:00:00.000Z',
        updatedAt: '2026-09-19T12:00:00.000Z',
      },
    },
  });
  const view = renderedPane(async (path, options = {}) => {
    calls.push({ path, options: plain(options) });
    if (calls.length === 1) return runResponse(options.body, 'queued', '11111111-1111-4111-8111-111111111111');
    throw new Error('candidate budget envelope expired');
  });

  view.byId('seval-run-launch-form').dispatch('submit');
  await waitFor(() => calls.length === 2, 'baseline and candidate launch requests were not both attempted');
  const launch = view.byId('seval-run-launch-result');
  assert.match(treeText(launch), /Baseline/);
  assert.match(treeText(launch), /11111111-1111-4111-8111-111111111111/);
  assert.match(treeText(view.byId('seval-run-launch-form')), /server enforces D6 caps again/i);
  assert.match(treeText(view.root), /Candidate launch failed after baseline succeeded: candidate budget envelope expired/);
  assert.deepEqual(calls.map(call => call.path), ['/api/ops/seval/operations', '/api/ops/seval/operations']);
  assert.equal(calls[0].options.body.operationId, 'seval.run.launch');
  assert.equal(calls[1].options.body.operationId, 'seval.run.launch');
  /* The backend answers any other contract with unsupported_contract_version and runs nothing. */
  for (const call of calls) {
    assert.equal(call.options.body.schemaVersion, 'seval.operation.request.v1');
    assert.deepEqual(call.options.body.client.contractVersions, ['seval.operations.v1']);
    assert.equal(call.options.body.input.manifest.schemaVersion, 'seval.run.manifest.v1');
    assert.equal(call.options.body.input.manifest.policy.gatePolicyVersion, 'seval-gate-policy:v1');
    assert.equal(call.options.body.input.manifest.policy.engineVersion, 'seval-engine:v1');
  }
  assert.equal(calls[0].options.body.input.manifest.promptBundle.bundleId, 'prompt.synthetic.baseline');
  assert.equal(calls[1].options.body.input.manifest.promptBundle.bundleId, 'prompt.synthetic.candidate');
  assert.equal(calls[0].options.body.input.manifest.provider.deployment, 'fixture');
  assert.equal(calls[0].options.body.input.manifest.provider.revision, 'fixture-v1');
  assert.equal(calls[0].options.body.input.manifest.code.gitCommit, '1df3a9a4db943ad9e7ffc1f5a11e7d065426a92a');
  assert.equal(calls[0].options.body.input.manifest.dataset.releaseDigest, 'be3bd66934844fa2025eedfe916a9ebd26c005faa7870e1702927c1dd893c3ac');
  assert.equal(calls[0].options.body.input.manifest.promptBundle.digest, '40c6f72e9d3a3756c01374c89ea63d6ad69e0d0d8cf9050f4d3d3176c22c1a47');
  assert.equal(calls[0].options.body.input.manifest.dataset.datasetId, 'dataset.synthetic.demo');
  assert.equal(calls[0].options.body.input.manifest.repeatDesign.kind, 'single');
  assert.ok(!JSON.stringify(calls[0].options.body).includes('http://'), 'launch request must not carry a free-text endpoint');

  const firstCandidateKey = calls[1].options.body.idempotencyKey;
  await view.byId('seval-run-launch-form').dispatch('submit');
  await waitFor(() => calls.length === 3, 'recovery submit should retry only the unresolved candidate');
  assert.deepEqual(calls.map(call => call.options.body.input.manifest.promptBundle.bundleId), [
    'prompt.synthetic.baseline',
    'prompt.synthetic.candidate',
    'prompt.synthetic.candidate',
  ]);
  assert.equal(calls[2].options.body.idempotencyKey, firstCandidateKey);
});

test('run inspection pane shows provenance, pending statistics and retry output from shared operations', async () => {
  const runId = '3d11852d-24b9-46ab-9c7e-bd4db48f9d87';
  const calls = [];
  function inspectionResponse(request, status, attempts) {
    return {
      schemaVersion: 'seval.operation.response.v1',
      requestId: request.requestId,
      operationId: request.operationId,
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.run',
        id: runId,
        revision: status === 'queued' ? 6 : 5,
        value: {
          runId,
          revision: status === 'queued' ? 6 : 5,
          status,
          mode: 'fresh_capture',
          manifestDigest: 'b'.repeat(64),
          budget: {
            estimatedCostCents: 175,
            accountedCostCents: 80,
            monthlyCapCents: 30000,
            perRunCapCents: 2500,
            maxProviderConcurrency: 4,
            reservedProviderConcurrency: 2,
          },
          createdAt: '2026-09-19T12:00:00.000Z',
          updatedAt: '2026-09-19T12:05:00.000Z',
          cost: { expectedCents: 175, actualCents: 80 },
          provider: {
            kind: 'azure_openai',
            deployment: 'azure-openai-prod',
            replay: false,
          },
          repeatDesign: { kind: 'paired_repeats', repeatsPerConfig: 3, statisticsStatus: 'pending' },
          progress: {
            attempts,
            failedAttempts: 1,
            incompleteWork: ['scenario.incomplete.redacted'],
            skippedWork: ['scenario.skipped.redacted'],
            attemptFailures: [{ attempt: 1, status: 'failed', outcomeCode: 'tool_timeout' }],
          },
          comparison: {
            status: 'inconclusive',
            reason: 'repeated-run statistics pending',
            criticalRegressions: [],
            requiredDeltas: [],
          },
          evidence: { redactedEvidenceCleanPass: false, redactedEvidencePresent: true },
          artifacts: {
            rawOutput: [{ scenarioId: 'scenario.raw', value: 'raw text' }],
            repairedOutput: [{ scenarioId: 'scenario.repaired', value: 'repaired text' }],
            finalOutput: [{ scenarioId: 'scenario.final', value: 'final text' }],
            tools: [{ name: 'tool.search', status: 'skipped' }],
            stateChanges: [{ path: '/coach/note', action: 'redacted' }],
          },
        },
      },
    };
  }
  const view = renderedPane(async (path, options = {}) => {
    calls.push({ path, options: plain(options) });
    if (options.body.operationId === 'seval.run.retry') return inspectionResponse(options.body, 'queued', 3);
    return inspectionResponse(options.body, 'running', 2);
  });

  view.byId('seval-run-inspect-id').value = ` ${runId} `;
  view.byId('seval-run-inspect-form').dispatch('submit');
  await waitFor(() => /azure_openai/.test(treeText(view.byId('seval-run-inspection-result'))), 'run inspection did not render');
  const result = view.byId('seval-run-inspection-result');
  assert.equal(calls[0].options.body.operationId, 'seval.run.get');
  assert.deepEqual(calls[0].options.body.input, { runId });
  assert.match(treeText(result), /175c \/ 80c/);
  assert.match(treeText(result), /provenance not reported/);
  assert.match(treeText(result), /not reported/);
  assert.doesNotMatch(treeText(result), /fresh inference/);
  assert.doesNotMatch(treeText(result), /approved-prod-revision/);
  assert.match(treeText(result), /scenario\.skipped\.redacted/);
  assert.match(treeText(result), /scenario\.incomplete\.redacted/);
  assert.match(treeText(result), /Attempt 1 failed: tool_timeout/);
  assert.match(treeText(result), /raw text/);
  assert.match(treeText(result), /repaired text/);
  assert.match(treeText(result), /final text/);
  assert.match(treeText(result), /tool\.search/);
  assert.match(treeText(result), /\/coach\/note/);
  assert.match(treeText(result), /inconclusive: repeated-run statistics pending/);
  assert.match(treeText(result), /present; never a clean pass/);

  view.byId('seval-run-inspect-id').value = '00000000-0000-4000-8000-000000000000';
  view.byId('seval-run-inspect-id').dispatch('input');
  await findNode(view.root, node => node.tag === 'button' && node.textContent === 'Cancel inspected run').dispatch('click');
  assert.equal(calls.length, 1, 'cancel must not target an edited, uninspected run id');
  assert.match(treeText(view.root), /Inspect a run before cancelling it/);

  view.byId('seval-run-inspect-id').value = ` ${runId} `;
  view.byId('seval-run-inspect-form').dispatch('submit');
  await waitFor(
    () => calls.length === 2 && /Attempt 1 failed/.test(treeText(result)),
    'replacement inspection was not rendered',
  );
  await findNode(view.root, node => node.tag === 'button' && node.textContent === 'Retry failed run').dispatch('click');
  await waitFor(() => calls.some(call => call.options.body.operationId === 'seval.run.retry'), 'retry request was not sent');
  assert.deepEqual(calls[calls.length - 1].options.body.input, {
    runId,
    reason: 'Retry failed attempts from the SEVAL admin dashboard.',
  });
  assert.match(treeText(result), /3 total, 1 failed/);
});

test('run inspection ignores stale lookup responses before cancellation', async () => {
  const runA = '3d11852d-24b9-46ab-9c7e-bd4db48f9d87';
  const runB = '4b93ba48-3c61-452f-a5f3-7938de7268cc';
  const calls = [];
  const pendingGets = [];
  function inspectionResponse(request, runId) {
    return {
      schemaVersion: 'seval.operation.response.v1',
      requestId: request.requestId,
      operationId: request.operationId,
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.run',
        id: runId,
        revision: 7,
        value: {
          runId,
          revision: 7,
          status: 'running',
          mode: 'offline_replay',
          manifestDigest: 'c'.repeat(64),
          budget: {
            estimatedCostCents: 125,
            accountedCostCents: 0,
            monthlyCapCents: 30000,
            perRunCapCents: 2500,
            maxProviderConcurrency: 4,
            reservedProviderConcurrency: 0,
          },
          createdAt: '2026-09-19T12:00:00.000Z',
          updatedAt: '2026-09-19T12:05:00.000Z',
          provider: { kind: 'offline_fixture', deployment: 'fixture', replay: true },
          progress: { attempts: 1, failedAttempts: 0, incompleteWork: [], skippedWork: [], attemptFailures: [] },
          comparison: { status: 'inconclusive', reason: 'repeated-run statistics pending' },
          evidence: { redactedEvidencePresent: false },
          artifacts: { rawOutput: [], repairedOutput: [], finalOutput: [], tools: [], stateChanges: [] },
        },
      },
    };
  }
  const view = renderedPane((path, options = {}) => {
    calls.push({ path, options: plain(options) });
    if (options.body.operationId === 'seval.run.get') {
      return new Promise(resolve => pendingGets.push({ request: options.body, resolve }));
    }
    return Promise.resolve(inspectionResponse(options.body, options.body.input.runId));
  });

  view.byId('seval-run-inspect-id').value = runA;
  view.byId('seval-run-inspect-form').dispatch('submit');
  await waitFor(() => pendingGets.length === 1, 'first lookup did not start');
  view.byId('seval-run-inspect-id').value = ` ${runB} `;
  view.byId('seval-run-inspect-id').dispatch('input');
  view.byId('seval-run-inspect-form').dispatch('submit');
  await waitFor(() => pendingGets.length === 2, 'second lookup did not start');

  pendingGets[1].resolve(inspectionResponse(pendingGets[1].request, runB));
  await waitFor(() => /4b93ba48-3c61-452f-a5f3-7938de7268cc/.test(treeText(view.byId('seval-run-inspection-result'))),
    'newer lookup did not render');
  pendingGets[0].resolve(inspectionResponse(pendingGets[0].request, runA));
  await new Promise(resolve => setTimeout(resolve, 0));
  await findNode(view.root, node => node.tag === 'button' && node.textContent === 'Cancel inspected run').dispatch('click');
  assert.equal(calls.length, 3, 'cancel should target only the accepted newer run');
  assert.equal(calls[2].options.body.operationId, 'seval.run.cancel');
  assert.deepEqual(calls[2].options.body.input, {
    runId: runB,
    reason: 'Cancelled from the SEVAL admin dashboard.',
  });
});
test('browse pane renders loading, partial and error states without HTML injection', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const view = renderedPane(() => pending);
  const browse = view.byId('seval-browse-panel');
  view.byId('seval-browse-filters').dispatch('submit');
  assert.match(treeText(browse), /Loading SEVAL catalogue/);
  resolve(browsePayload({
    datasets: { partial: true, omissions: ['Dataset review state is declaration-only; <img src=x onerror=alert(1)>'], datasets: [] },
    scenarios: [],
  }));
  await waitFor(() => /Partial dataset view/.test(treeText(browse)), 'partial dataset state did not render');
  assert.match(treeText(browse), /<img src=x onerror=alert\(1\)>/);
  assert.equal(findNode(browse, node => node.tag === 'img'), null, 'omission text must not create an element');

  const errorView = renderedPane(() => Promise.reject(new Error('No API today <script>alert(1)</script>')));
  const errorBrowse = errorView.byId('seval-browse-panel');
  errorView.byId('seval-browse-filters').dispatch('submit');
  await waitFor(() => /SEVAL catalogue unavailable/.test(treeText(errorBrowse)), 'error state did not render');
  assert.match(treeText(errorBrowse), /<script>alert\(1\)<\/script>/);
  assert.equal(findNode(errorBrowse, node => node.tag === 'script'), null, 'error text must not create script nodes');
});

test('dataset form shows field errors received through the operations API transport', async () => {
  const window = {
    location: { hostname: 'runwitharia.com' },
    async fetch() {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            error: {
              code: 'validation_failed',
              message: 'Dataset declarations are invalid for coach.person@example.com.',
              details: [{
                path: '/input/datasets/0/coach.person@example.com/revision',
                reason: 'positive_integer for reviewer@example.com',
              }],
            },
          });
        },
      };
    },
  };
  vm.runInNewContext(
    readFileSync(new URL('../ops/assets/api.js', import.meta.url), 'utf8'),
    { window, URLSearchParams },
  );
  const view = renderedPane((path, options) => window.OpsApi.request(path, options));
  const input = datasetInput();
  input.datasets[0].revision = 0;
  view.byId('dataset-input').value = JSON.stringify(input);
  const form = findNode(view.root, node => node.className === 'card dataset-form');
  await form.dispatch('submit');
  const error = findNode(form, node => node.className === 'field-error');
  const text = node => [node.textContent || '', ...(node.children || []).map(text)].join(' ');
  assert.match(text(error), /Dataset declarations are invalid for \[hidden contact detail\]/);
  assert.match(text(error), /\[hidden contact detail\]: positive_integer for \[hidden contact detail\]/);
  assert.match(text(error), /positive_integer for \[hidden contact detail\]/);
  assert.doesNotMatch(text(error), /coach\.person@example\.com|reviewer@example\.com/);
  assert.equal(findNode(view.root, node => node.className === 'dataset-result').children.length, 0);
});

test('viewers can validate declarations without being offered evidence import', () => {
  const pane = loadPane(undefined, Date, 'viewer');
  const registry = {};
  /* The registry moved out of shell.js so the v2 pane bootstrap can read the
     same table; both shells now refuse to load without it. */
  vm.runInNewContext(
    readFileSync(new URL('../ops/assets/pane-registry.js', import.meta.url), 'utf8'),
    { window: registry, document: {} },
  );
  assert.equal(pane.window.OpsSession.hasRole(registry.OpsPaneRegistry.PANES.evals.roles), true,
    'the registry must allow a viewer into Aria quality');
  const root = { children: [], appendChild(child) { this.children.push(child); } };
  pane.render(root);
  assert.ok(findNode(root, node => node.className === 'card dataset-form'));
  assert.equal(findNode(root, node => node.className === 'card evidence-form'), null);
});

test('dataset validation stays enabled while operation availability disclosures stay pre-submit copy only', () => {
  const view = renderedPane();
  const datasetForm = findNode(view.root, node => node.className === 'card dataset-form');
  const datasetSubmit = findNode(datasetForm, node => node.tag === 'button');
  assert.equal(datasetSubmit.disabled, false, 'dataset validation submit must remain enabled');
  assert.equal(datasetSubmit.attributes['aria-disabled'], undefined);
  assert.equal(datasetSubmit.attributes['aria-describedby'], undefined);

  const evidenceNote = view.byId('evidence-availability-note');
  assert.ok(evidenceNote, 'evidence availability disclosure is missing');
  assert.match(treeText(evidenceNote), /backend decides/i);
  assert.match(treeText(evidenceNote), /storage and authority settings are configured/i);
  assert.match(treeText(evidenceNote), /submitting changes nothing/i);
  assert.equal(view.submit.disabled, false, 'quarantine submit must remain enabled');
  assert.equal(view.submit.attributes['aria-disabled'], undefined);
  assert.match(view.submit.attributes['aria-describedby'], /evidence-availability-note/);
  assertBefore(view.form, evidenceNote, view.submit,
    'evidence availability disclosure must appear before the quarantine submit control');

  const approvalCases = [
    ['approval-request-form', 'approval-request-availability-note', 'Create pending request'],
    ['approval-get-form', 'approval-get-availability-note', 'Load request'],
    ['approval-decision-form', 'approval-decision-availability-note', 'Record decision'],
  ];
  for (const [formId, noteId, label] of approvalCases) {
    const form = view.byId(formId);
    const note = view.byId(noteId);
    const submit = findNode(form, node => node.tag === 'button');
    assert.ok(note, `${noteId} is missing`);
    assert.match(treeText(note), /backend decides/i);
    assert.match(treeText(note), /ADR 0040/);
    assert.match(treeText(note), /external qualification issuer/i);
    assert.match(treeText(note), /submitting changes nothing/i);
    assert.equal(submit.textContent, label);
    assert.equal(submit.disabled, false, `${formId} submit must remain enabled`);
    assert.equal(submit.attributes['aria-disabled'], undefined);
    assert.match(submit.attributes['aria-describedby'], new RegExp(noteId));
    assertBefore(form, note, submit,
      `${formId} availability disclosure must appear before its submit control`);
  }
});

test('a viewer requester can submit approval lookup without mutation controls', async () => {
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const calls = [];
  const view = renderedPane(async (path, options) => {
    calls.push({ path, options: plain(options) });
    return {
      schemaVersion: 'seval.operation.response.v1',
      requestId: options.body.requestId,
      operationId: 'seval.approval.get',
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.approval-request',
        id: approvalRequestId,
        revision: 1,
        value: {
          approvalRequestId,
          revision: 1,
          state: 'pending',
          expiresAt: '2026-10-19T00:00:00.000Z',
        },
      },
    };
  }, Date, 'viewer');

  assert.equal(view.byId('approval-request-form'), null);
  assert.equal(view.byId('approval-decision-form'), null);
  assert.equal(findNode(view.root, node => node.className === 'card evidence-form'), null);
  const form = view.byId('approval-get-form');
  assert.ok(form, 'viewer approval lookup form is missing');
  view.byId('approval-get-id').value = approvalRequestId;
  await form.dispatch('submit');
  await waitFor(() => calls.length === 1, 'viewer approval lookup did not complete');

  assert.equal(calls[0].path, '/api/ops/seval/operations');
  assert.deepEqual(calls[0].options.body.input, { approvalRequestId });
  assert.equal(calls[0].options.body.operationId, 'seval.approval.get');
  /* Awaited, not read: the answer lands a task after the region is revealed,
     and this still fails if it never lands. */
  await waitFor(() => /pending/i.test(view.byId('approval-result').textContent),
    'the approval lookup answer never reached the region');
});

test('dataset form reports local request preparation errors and restores the submit button', async () => {
  let calls = 0;
  const view = renderedPane(async () => { calls += 1; });
  view.pane.window.crypto = {
    randomUUID() { throw new Error('Secure request identity is unavailable.'); },
  };
  view.byId('dataset-input').value = JSON.stringify(datasetInput());
  const form = findNode(view.root, node => node.className === 'card dataset-form');
  const submit = findNode(form, node => node.tag === 'button');
  await form.dispatch('submit');
  assert.equal(calls, 0);
  assert.match(findNode(form, node => node.className === 'field-error').textContent,
    /Secure request identity is unavailable/);
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'Validate declarations');
});

for (const outcome of ['success', 'error']) {
  test(`dataset form ignores an obsolete pending ${outcome} after the declarations change`, async () => {
    let finish;
    let calls = 0;
    const view = renderedPane((path, options) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        finish = () => outcome === 'success'
          ? resolve(datasetResponse(options.body.requestId))
          : reject(new Error('Old declaration was invalid.'));
      });
    });
    const form = findNode(view.root, node => node.className === 'card dataset-form');
    const submit = findNode(form, node => node.tag === 'button');
    const input = view.byId('dataset-input');
    input.value = JSON.stringify(datasetInput());
    const pending = form.dispatch('submit');
    assert.equal(submit.disabled, true);
    const duplicate = form.dispatch('submit');
    assert.equal(calls, 1, 'a pending request must not be submitted twice');
    await duplicate;
    input.value = '{}';
    input.dispatch('input');
    finish();
    await pending;
    assert.equal(findNode(view.root, node => node.className === 'dataset-result').children.length, 0);
    assert.equal(findNode(form, node => node.className === 'field-error').textContent, '');
    assert.equal(submit.disabled, false);
    assert.equal(submit.textContent, 'Validate declarations');
  });
}

test('dataset form rejects mismatched or malformed success responses', async () => {
  for (const invalid of ['request', 'operation', 'digest']) {
    const view = renderedPane(async (path, options) => {
      const response = datasetResponse(options.body.requestId);
      if (invalid === 'request') response.requestId = 'another-request';
      if (invalid === 'operation') response.operationId = 'seval.artifact.quarantine';
      if (invalid === 'digest') response.resource.value.digests[0].sha256 = 'invalid-digest';
      return response;
    });
    const form = findNode(view.root, node => node.className === 'card dataset-form');
    view.byId('dataset-input').value = JSON.stringify(datasetInput());
    await form.dispatch('submit');
    assert.match(findNode(form, node => node.className === 'field-error').textContent,
      /did not return a valid result for this request/, invalid);
    assert.equal(findNode(view.root, node => node.className === 'dataset-result').children.length, 0);
  }
});

function futureExpiry() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function renderedPane(call, Clock = Date, role = 'operator') {
  const pane = loadPane(call, Clock, role);
  const root = {
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  pane.render(root);
  const byId = id => findNode(root, node => node.attributes?.id === id || node.id === id);
  const form = findNode(root, node => node.className === 'card evidence-form');
  return {
    pane,
    root,
    byId,
    form,
    error: form ? findNode(form, node => node.className === 'field-error') : null,
    result: findNode(root, node => node.className === 'evidence-result'),
    submit: form
      ? findNode(form, node => node.tag === 'button')
        || findNode(form, node => node.tag === 'button')
      : null,
  };
}

function setProductionForm(view, overrides = {}) {
  const bytes = new TextEncoder().encode('approved fixture');
  view.byId('evidence-file').files = [{
    name: 'approved.txt',
    size: bytes.byteLength,
    type: 'text/plain',
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  }];
  view.byId('evidence-source').value = 'production_derived';
  view.byId('evidence-source').dispatch('change');
  view.byId('evidence-profile').value = 'trace';
  view.byId('evidence-type').value = 'text/plain';
  view.byId('evidence-purpose').value = 'incident_reproduction';
  view.byId('evidence-expiry').value = futureExpiry();
  view.byId('evidence-key').value = 'dashboard-production-1';
  view.byId('evidence-necessary').value = 'none';
  view.byId('evidence-removed').value = '';
  view.byId('evidence-authority').value = 'approval/42';
  view.byId('evidence-consent').value = 'consent/42';
  view.byId('evidence-provider').value = 'provider/no-transfer/42';
  for (const [id, value] of Object.entries(overrides)) {
    view.byId(id).value = value;
  }
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function operationError(requestId, code, message, exitCode) {
  return {
    schemaVersion: 'seval.operation.response.v1',
    requestId,
    operationId: 'seval.artifact.quarantine',
    status: 'error',
    exitCode,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

async function operationServer() {
  const requests = [];
  const completed = new Map();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      body,
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.url !== '/api/ops/seval/operations' || request.method !== 'POST') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
      return;
    }
    if (request.headers.authorization !== 'Bearer dashboard-test-token') {
      response.statusCode = 401;
      response.end(JSON.stringify({
        error: {
          code: 'ops_auth_required',
          message: 'Sign in to the operations dashboard.',
        },
      }));
      return;
    }
    const manifest = body.input?.manifest;
    const source = manifest?.contentBase64
      ? Buffer.from(manifest.contentBase64, 'base64')
      : Buffer.alloc(0);
    const digest = createHash('sha256').update(source).digest('hex');
    const valid = body.schemaVersion === 'seval.operation.request.v1'
      && body.operationId === 'seval.artifact.quarantine'
      && body.mode === 'remote'
      && body.input?.sourceDigest === digest
      && Array.isArray(manifest?.minimization?.removedCategories);
    if (!valid) {
      response.statusCode = 400;
      response.end(JSON.stringify(operationError(
        body.requestId || '83525f56-198f-4c2f-8f83-93c8e4ab7248',
        'invalid_request',
        'The operation request is invalid.',
        2,
      )));
      return;
    }
    if (manifest.authority?.authorityRef !== 'approval/42') {
      response.statusCode = 403;
      response.end(JSON.stringify(operationError(
        body.requestId,
        'permission_denied',
        'The production authorization does not match.',
        4,
      )));
      return;
    }
    const existing = completed.get(body.idempotencyKey);
    const artifactId = existing || '4e1d10f7-1f13-4daf-82b6-c9dd43124138';
    completed.set(body.idempotencyKey, artifactId);
    response.statusCode = 200;
    response.end(JSON.stringify({
      schemaVersion: 'seval.operation.response.v1',
      requestId: body.requestId,
      operationId: 'seval.artifact.quarantine',
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.evidence-artifact',
        id: artifactId,
        revision: 1,
        value: {
          artifactId,
          revision: 1,
          state: 'quarantined',
          replayed: Boolean(existing),
        },
      },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

function httpSession(baseUrl, token) {
  return async (path, options) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(options.body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || 'The operation failed.');
    }
    return payload;
  };
}

test('synthetic evidence builds the shared quarantine request without authority or transfer claims', async () => {
  const pane = loadPane();
  const request = await pane.buildQuarantineRequest({
    bytes: new TextEncoder().encode('{"scenario":"synthetic"}\n'),
    mediaType: 'application/json',
    contentProfile: 'trace',
    sourceKind: 'synthetic',
    purpose: 'regression_evaluation',
    expiresAt: futureExpiry(),
    idempotencyKey: 'dashboard-synthetic-1',
  }, '83525f56-198f-4c2f-8f83-93c8e4ab7248');

  assert.equal(request.schemaVersion, 'seval.operation.request.v1');
  assert.equal(request.operationId, 'seval.artifact.quarantine');
  assert.equal(request.mode, 'remote');
  assert.deepEqual(plain(request.input.manifest.authority), { kind: 'synthetic' });
  assert.deepEqual(plain(request.input.manifest.providerHandling), { status: 'no_transfer' });
  assert.deepEqual(plain(request.input.manifest.minimization), {
    necessaryCategories: ['none'],
    removedCategories: ['none'],
  });
  assert.match(request.input.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    Buffer.from(request.input.manifest.contentBase64, 'base64').toString('utf8'),
    '{"scenario":"synthetic"}\n',
  );
  assert.equal(request.endpoint, undefined);
  assert.equal(request.authorization, undefined);
});

test('production-derived evidence fails closed without exact authority, consent, and provider approval references', async () => {
  const pane = loadPane();
  await assert.rejects(
    () => pane.buildQuarantineRequest({
      bytes: new TextEncoder().encode('approved fixture'),
      mediaType: 'text/plain',
      contentProfile: 'trace',
      sourceKind: 'production_derived',
      purpose: 'incident_reproduction',
      expiresAt: futureExpiry(),
      idempotencyKey: 'dashboard-production-1',
      authorityRef: 'approval/42',
      consentRef: 'consent/42',
      providerApprovalRef: '',
    }, '83525f56-198f-4c2f-8f83-93c8e4ab7248'),
    /provider handling approval/i,
  );
});

test('production-derived evidence carries exact documented authority and approved provider handling', async () => {
  const pane = loadPane();
  const request = await pane.buildQuarantineRequest({
    bytes: new TextEncoder().encode('approved fixture'),
    mediaType: 'text/plain',
    contentProfile: 'trace',
    sourceKind: 'production_derived',
    purpose: 'incident_reproduction',
    expiresAt: futureExpiry(),
    idempotencyKey: 'dashboard-production-1',
    necessaryCategories: 'none',
    removedCategories: '',
    authorityRef: 'approval/42',
    consentRef: 'consent/42',
    providerApprovalRef: 'provider/no-transfer/42',
  }, '83525f56-198f-4c2f-8f83-93c8e4ab7248');

  assert.deepEqual(plain(request.input.manifest.authority), {
    kind: 'documented',
    authorityRef: 'approval/42',
    consentRef: 'consent/42',
  });
  assert.deepEqual(plain(request.input.manifest.providerHandling), {
    status: 'approved',
    approvalRef: 'provider/no-transfer/42',
  });
  assert.deepEqual(plain(request.input.manifest.minimization), {
    necessaryCategories: ['none'],
    removedCategories: [],
  });
});

test('approval operation builders bind exact artifact digests without qualification claims', () => {
  const pane = loadPane();
  const requestId = '83525f56-198f-4c2f-8f83-93c8e4ab7248';
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const sourceDigest = 'a'.repeat(64);
  const retainedDigest = 'b'.repeat(64);
  const targetRequestDigest = 'c'.repeat(64);

  const approvalRequest = pane.buildApprovalRequest({
    artifactId: '4e1d10f7-1f13-4daf-82b6-c9dd43124138',
    artifactRevision: 1,
    sourceDigest,
    retainedDigest,
    targetRequestDigest,
    purpose: 'quality_review',
    policyRevision: 'seval-evidence-admission.v1',
    expiresAt: '2026-10-19T00:00:00.000Z',
    idempotencyKey: 'dashboard-approval-request-1',
  }, requestId);
  const approvalGet = pane.buildApprovalGet({
    approvalRequestId,
  }, requestId);
  const approvalDecision = pane.buildApprovalDecision({
    approvalRequestId,
    expectedRevision: 1,
    decision: 'approved',
    reason: 'Exact retained bytes and policy binding reviewed.',
    idempotencyKey: 'dashboard-approval-decision-1',
  }, requestId);

  assert.deepEqual(plain(approvalRequest), {
    schemaVersion: 'seval.operation.request.v1',
    requestId,
    operationId: 'seval.approval.request',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['seval.operations.v1'],
    },
    input: {
      targetOperationId: 'seval.artifact.admit',
      targetRequestDigest,
      artifact: {
        artifactId: '4e1d10f7-1f13-4daf-82b6-c9dd43124138',
        revision: 1,
        sourceDigest,
        retainedDigest,
      },
      purpose: 'quality_review',
      policyRevision: 'seval-evidence-admission.v1',
      expiresAt: '2026-10-19T00:00:00.000Z',
    },
    idempotencyKey: 'dashboard-approval-request-1',
  });
  assert.deepEqual(plain(approvalGet), {
    schemaVersion: 'seval.operation.request.v1',
    requestId,
    operationId: 'seval.approval.get',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['seval.operations.v1'],
    },
    input: { approvalRequestId },
  });
  assert.deepEqual(plain(approvalDecision), {
    schemaVersion: 'seval.operation.request.v1',
    requestId,
    operationId: 'seval.approval.decide',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['seval.operations.v1'],
    },
    input: {
      approvalRequestId,
      decision: 'approved',
      reason: 'Exact retained bytes and policy binding reviewed.',
    },
    expectedRevision: 1,
    idempotencyKey: 'dashboard-approval-decision-1',
  });
  assert.doesNotMatch(JSON.stringify([
    approvalRequest,
    approvalGet,
    approvalDecision,
  ]), /qualification|credential|issuer/i);
});

test('admission builder binds exact synthetic artifact, approval and revision without access claims', () => {
  const pane = loadPane();
  const requestId = '83525f56-198f-4c2f-8f83-93c8e4ab7248';
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const sourceDigest = 'a'.repeat(64);
  const retainedDigest = 'b'.repeat(64);

  const admission = pane.buildAdmissionRequest({
    artifactId: '4e1d10f7-1f13-4daf-82b6-c9dd43124138',
    expectedRevision: '1',
    sourceDigest,
    retainedDigest,
    contentProfile: 'trace',
    mediaType: 'application/json',
    purpose: 'quality_review',
    expiresAt: '2026-10-19T00:00:00.000Z',
    necessaryCategories: 'none',
    removedCategories: 'tokens,identifiers',
    policyRevision: 'seval-evidence-admission.v1',
    approvalRequestId,
    idempotencyKey: 'dashboard-admit-1',
  }, requestId);

  assert.deepEqual(plain(admission), {
    schemaVersion: 'seval.operation.request.v1',
    requestId,
    operationId: 'seval.artifact.admit',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['seval.operations.v1'],
    },
    input: {
      artifact: {
        artifactId: '4e1d10f7-1f13-4daf-82b6-c9dd43124138',
        sourceDigest,
        retainedDigest,
        sourceKind: 'synthetic',
        contentProfile: 'trace',
        mediaType: 'application/json',
        purpose: 'quality_review',
        authority: { kind: 'synthetic' },
        minimization: {
          necessaryCategories: ['none'],
          removedCategories: ['tokens', 'identifiers'],
        },
        retention: { expiresAt: '2026-10-19T00:00:00.000Z' },
        providerHandling: { status: 'no_transfer' },
      },
      policyRevision: 'seval-evidence-admission.v1',
    },
    expectedRevision: 1,
    approval: { approvalRequestId },
    idempotencyKey: 'dashboard-admit-1',
  });
  assert.doesNotMatch(JSON.stringify(admission), /contentBase64|targetRequestDigest|raw|read|export|evaluator|training|provider_transfer/i);
});

test('the rendered approval forms submit request, get and decision operations without trust provisioning', async () => {
  const calls = [];
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const view = renderedPane(async (path, options) => {
    calls.push({ path, options: plain(options) });
    const operationId = options.body.operationId;
    const state = operationId === 'seval.approval.decide' ? 'approved' : 'pending';
    return {
      schemaVersion: 'seval.operation.response.v1',
      requestId: options.body.requestId,
      operationId,
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.approval-request',
        id: approvalRequestId,
        revision: state === 'approved' ? 2 : 1,
        value: {
          approvalRequestId,
          revision: state === 'approved' ? 2 : 1,
          state,
          expiresAt: '2026-10-19T00:00:00.000Z',
        },
      },
    };
  });

  view.byId('approval-artifact-id').value = '4e1d10f7-1f13-4daf-82b6-c9dd43124138';
  view.byId('approval-artifact-revision').value = '1';
  view.byId('approval-source-digest').value = 'a'.repeat(64);
  view.byId('approval-retained-digest').value = 'b'.repeat(64);
  view.byId('approval-target-digest').value = 'c'.repeat(64);
  view.byId('approval-purpose').value = 'quality_review';
  view.byId('approval-policy-revision').value = 'seval-evidence-admission.v1';
  view.byId('approval-expiry').value = '2026-10-19T00:00';
  view.byId('approval-request-key').value = 'dashboard-approval-request-1';
  view.byId('approval-request-form').dispatch('submit');
  await waitFor(() => calls.length === 1, 'approval request did not complete');

  view.byId('approval-get-id').value = approvalRequestId;
  view.byId('approval-get-form').dispatch('submit');
  await waitFor(() => calls.length === 2, 'approval lookup did not complete');

  view.byId('approval-decision-id').value = approvalRequestId;
  view.byId('approval-expected-revision').value = '1';
  view.byId('approval-decision').value = 'approved';
  view.byId('approval-reason').value = 'Exact retained bytes and policy binding reviewed.';
  view.byId('approval-decision-key').value = 'dashboard-approval-decision-1';
  view.byId('approval-decision-form').dispatch('submit');
  await waitFor(() => calls.length === 3, 'approval decision did not complete');

  assert.deepEqual(calls.map(call => call.path), [
    '/api/ops/seval/operations',
    '/api/ops/seval/operations',
    '/api/ops/seval/operations',
  ]);
  assert.deepEqual(calls.map(call => call.options.body.operationId), [
    'seval.approval.request',
    'seval.approval.get',
    'seval.approval.decide',
  ]);
  assert.equal(calls[1].options.body.idempotencyKey, undefined);
  assert.equal(calls[2].options.body.expectedRevision, 1);
  assert.equal(view.byId('approval-qualification'), null);
  assert.ok(findNode(
    view.byId('approval-trust-note'),
    node => /cannot provision qualification/i.test(node.textContent),
  ));
  await waitFor(() => /approved/i.test(view.byId('approval-result').textContent),
    'the approval decision answer never reached the region');
});

test('the rendered admission form submits the exact operation and renders a receipt without access claims', async () => {
  const calls = [];
  const receiptId = '7647c458-0114-48d3-9cc8-1687097e7379';
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const view = renderedPane(async (path, options) => {
    calls.push({ path, options: plain(options) });
    return {
      schemaVersion: 'seval.operation.response.v1',
      requestId: options.body.requestId,
      operationId: 'seval.artifact.admit',
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'seval.artifact-admission',
        id: receiptId,
        revision: 2,
        value: {
          artifactId: options.body.input.artifact.artifactId,
          revision: 2,
          state: 'admitted',
          admissionReceiptId: receiptId,
          approvalRequestId,
          targetRequestDigest: 'c'.repeat(64),
          sourceDigest: options.body.input.artifact.sourceDigest,
          retainedDigest: options.body.input.artifact.retainedDigest,
          purpose: options.body.input.artifact.purpose,
          policyRevision: options.body.input.policyRevision,
        },
      },
    };
  }, Date, 'owner');

  fillAdmissionForm(view, { approvalRequestId });
  view.byId('admission-form').dispatch('submit');
  const submit = findNode(view.byId('admission-form'), node => node.tag === 'button');
  await waitFor(() => calls.length === 1 && !submit.disabled, 'admission request did not complete');

  assert.equal(calls[0].path, '/api/ops/seval/operations');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.operationId, 'seval.artifact.admit');
  assert.equal(calls[0].options.body.expectedRevision, 1);
  assert.deepEqual(calls[0].options.body.approval, { approvalRequestId });
  assert.equal(calls[0].options.body.input.artifact.sourceDigest, 'a'.repeat(64));
  assert.equal(calls[0].options.body.input.artifact.retainedDigest, 'b'.repeat(64));
  assert.deepEqual(calls[0].options.body.input.artifact.authority, { kind: 'synthetic' });
  assert.deepEqual(calls[0].options.body.input.artifact.providerHandling, { status: 'no_transfer' });
  assert.doesNotMatch(JSON.stringify(calls[0].options.body), /targetRequestDigest|contentBase64/i);

  const resultText = treeText(view.byId('admission-result'));
  assert.match(resultText, /Admitted, no access granted/);
  assert.match(resultText, new RegExp(receiptId));
  assert.match(resultText, /Raw content, storage locations, evaluator access, training permission and export grants are intentionally not returned/);
});

test('admission denial and stale binding errors clear the receipt slot and keep backend wording visible', async () => {
  const outcomes = [
    { code: 'approval_required', message: 'The approval is not approved for this artifact.' },
    { code: 'revision_conflict', message: 'The evidence artifact no longer matches the admission request.' },
  ];
  let index = 0;
  const view = renderedPane(async () => {
    const outcome = outcomes[index++];
    const error = new Error(outcome.message);
    error.code = outcome.code;
    throw error;
  }, Date, 'owner');
  fillAdmissionForm(view);
  const form = view.byId('admission-form');
  const submit = findNode(form, node => node.tag === 'button');
  view.byId('admission-result').appendChild({ textContent: 'stale receipt', children: [] });

  form.dispatch('submit');
  await waitFor(() => index === 1 && !submit.disabled, 'approval denial did not render');
  assert.match(findNode(form, node => node.className === 'field-error').textContent,
    /Admission denied: The approval is not approved/);
  assert.equal(view.byId('admission-result').children.length, 0);

  form.dispatch('submit');
  await waitFor(() => index === 2 && !submit.disabled, 'stale binding denial did not render');
  assert.match(findNode(form, node => node.className === 'field-error').textContent,
    /Stale binding: The evidence artifact no longer matches/);
  assert.equal(view.byId('admission-result').children.length, 0);
});

test('operators are not offered admission controls or access claims', () => {
  const view = renderedPane(undefined, Date, 'operator');
  assert.equal(view.byId('admission-form'), null);
  const text = treeText(view.root);
  assert.match(text, /Admission needs owner access/);
  assert.match(text, /does not read, display, export, feed evaluators, train models or permit provider transfer/);
});

test('blank dashboard idempotency input derives a unique key from the request correlation', async () => {
  const pane = loadPane();
  const requestId = '83525f56-198f-4c2f-8f83-93c8e4ab7248';
  const request = await pane.buildQuarantineRequest({
    bytes: new TextEncoder().encode('{"scenario":"synthetic"}\n'),
    mediaType: 'application/json',
    contentProfile: 'trace',
    sourceKind: 'synthetic',
    purpose: 'regression_evaluation',
    expiresAt: futureExpiry(),
    idempotencyKey: '',
  }, requestId);

  assert.equal(request.idempotencyKey, `dashboard-quarantine-${requestId}`);
});

test('the registered pane appends the quarantine interface into the shell content root', () => {
  const pane = loadPane();
  const root = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };

  pane.render(root);

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].className, 'stack');
});

test('the rendered form submits an authorized empty-removal request over the real route and replays idempotently', async () => {
  const server = await operationServer();
  try {
    const view = renderedPane(httpSession(server.baseUrl, 'dashboard-test-token'));
    setProductionForm(view);

    view.form.dispatch('submit');
    await waitFor(
      () => server.requests.length === 1 && !view.submit.disabled,
      'the first dashboard quarantine request did not complete',
    );
    assert.equal(view.error.textContent, '');
    assert.equal(view.result.children.length, 1);
    assert.equal(server.requests[0].url, '/api/ops/seval/operations');
    assert.equal(server.requests[0].authorization, 'Bearer dashboard-test-token');
    assert.deepEqual(
      server.requests[0].body.input.manifest.minimization.removedCategories,
      [],
    );

    view.form.dispatch('submit');
    await waitFor(
      () => server.requests.length === 2 && !view.submit.disabled,
      'the replayed dashboard quarantine request did not complete',
    );
    assert.equal(server.requests[1].body.idempotencyKey, 'dashboard-production-1');
    assert.equal(server.requests[1].url, '/api/ops/seval/operations');
    assert.equal(view.error.textContent, '');
  } finally {
    await server.close();
  }
});

test('the rendered form surfaces authorization denial from the real operation route', async () => {
  const server = await operationServer();
  try {
    const view = renderedPane(httpSession(server.baseUrl, 'dashboard-test-token'));
    setProductionForm(view, { 'evidence-authority': 'approval/other' });

    view.form.dispatch('submit');
    await waitFor(
      () => server.requests.length === 1 && !view.submit.disabled,
      'the denied dashboard quarantine request did not complete',
    );
    assert.equal(server.requests[0].url, '/api/ops/seval/operations');
    assert.match(view.error.textContent, /authorization does not match/i);
    assert.equal(view.result.children.length, 0);
  } finally {
    await server.close();
  }
});

test('the rendered form surfaces dashboard authentication failure from the real operation route', async () => {
  const server = await operationServer();
  try {
    const view = renderedPane(httpSession(server.baseUrl, null));
    setProductionForm(view);

    view.form.dispatch('submit');
    await waitFor(
      () => server.requests.length === 1 && !view.submit.disabled,
      'the unauthenticated dashboard quarantine request did not complete',
    );
    assert.match(view.error.textContent, /sign in to the operations dashboard/i);
    assert.equal(view.result.children.length, 0);
  } finally {
    await server.close();
  }
});

test('the rendered form rejects invalid minimization before transport', async () => {
  let calls = 0;
  const view = renderedPane(async () => {
    calls += 1;
    throw new Error('unexpected request');
  });
  setProductionForm(view, { 'evidence-necessary': 'none,identifiers' });

  view.form.dispatch('submit');
  await waitFor(
    () => !view.submit.disabled && view.error.textContent !== '',
    'the dashboard validation failure did not complete',
  );
  assert.match(view.error.textContent, /necessary categories cannot combine/i);
  assert.equal(calls, 0);
});

function retentionView(t, timeZone, now) {
  const priorZone = process.env.TZ;
  process.env.TZ = timeZone;
  t.after(() => {
    if (priorZone === undefined) delete process.env.TZ;
    else process.env.TZ = priorZone;
  });
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() { return Date.parse(now); }
  }
  const requests = [];
  const view = renderedPane(async (path, options) => {
    assert.equal(path, '/api/ops/seval/operations');
    assert.equal(options.method, 'POST');
    requests.push(plain(options.body));
    return { status: 'success', resource: { value: { artifactId: 'example', state: 'quarantined' } } };
  }, Clock);
  const bytes = new TextEncoder().encode('example');
  view.byId('evidence-file').files = [{
    name: 'example.txt',
    async arrayBuffer() { return bytes.slice().buffer; },
  }];
  view.byId('evidence-source').value = 'synthetic';
  view.byId('evidence-profile').value = 'trace';
  view.byId('evidence-type').value = 'text/plain';
  view.byId('evidence-purpose').value = 'quality_review';
  return { view, requests };
}

for (const scenario of [
  {
    name: 'UTC minute precision',
    zone: 'UTC', now: '2026-06-10T12:34:56.789Z',
    local: '2026-07-10T12:34', utc: '2026-07-10T12:34:00.000Z',
  },
  {
    name: 'positive offset with a next-day boundary',
    zone: 'Asia/Tokyo', now: '2026-01-01T22:30:45.678Z',
    local: '2026-02-01T07:30', utc: '2026-01-31T22:30:00.000Z',
  },
  {
    name: 'negative offset with a previous-day boundary',
    zone: 'America/Los_Angeles', now: '2026-01-01T02:15:45.678Z',
    local: '2026-01-30T18:15', utc: '2026-01-31T02:15:00.000Z',
  },
  {
    name: 'target offset after spring DST change',
    zone: 'America/New_York', now: '2026-02-15T15:45:30.123Z',
    local: '2026-03-17T11:45', utc: '2026-03-17T15:45:00.000Z',
  },
  {
    name: 'target offset after autumn DST change',
    zone: 'Europe/Berlin', now: '2026-10-15T10:20:45.678Z',
    local: '2026-11-14T11:20', utc: '2026-11-14T10:20:00.000Z',
  },
  {
    name: 'ambiguous fall-back time retains native earlier-occurrence parsing',
    zone: 'America/New_York', now: '2026-10-02T06:30:45.678Z',
    local: '2026-11-01T01:30', utc: '2026-11-01T05:30:00.000Z',
  },
]) {
  test(`default retention uses ${scenario.name}`, async t => {
    const { view, requests } = retentionView(t, scenario.zone, scenario.now);
    assert.equal(view.byId('evidence-expiry').value, scenario.local);
    view.form.dispatch('submit');
    await waitFor(() => !view.submit.disabled, 'default retention submission did not finish');
    assert.equal(view.error.textContent, '');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input.manifest.retention.expiresAt, scenario.utc);
    assert.equal(view.byId('evidence-expiry').value, scenario.local);
  });
}

test('retention hint identifies the browser zone, minute precision and UTC submission', t => {
  const { view } = retentionView(t, 'Asia/Tokyo', '2026-01-01T00:00:00Z');
  const field = findNode(view.root, node =>
    node.children?.includes(view.byId('evidence-expiry')));
  const hint = field.children.find(node => node.className === 'field-hint');
  assert.match(hint.textContent, /Local time \(Asia\/Tokyo\)/);
  assert.match(hint.textContent, /minute precision/);
  assert.match(hint.textContent, /sent as UTC/);
  assert.match(hint.textContent, /automated expiry enforcement is delivered separately/);
});

for (const scenario of [
  { name: 'a manual local edit', local: '2026-02-10T09:25', utc: '2026-02-10T17:25:00.000Z' },
  { name: 'an expired manual edit', local: '2025-12-31T09:25', error: /future date and time/ },
  { name: 'a manual edit past 90 days', local: '2026-04-03T09:25', error: /cannot exceed 90 days/ },
]) {
  test(`retention preserves validation for ${scenario.name}`, async t => {
    const { view, requests } = retentionView(t, 'America/Los_Angeles', '2026-01-01T12:00:00Z');
    view.byId('evidence-expiry').value = scenario.local;
    view.form.dispatch('submit');
    await waitFor(() => !view.submit.disabled, 'manual retention submission did not finish');
    assert.equal(view.byId('evidence-expiry').value, scenario.local);
    if (scenario.error) {
      assert.match(view.error.textContent, scenario.error);
      assert.equal(requests.length, 0);
    } else {
      assert.equal(view.error.textContent, '');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].input.manifest.retention.expiresAt, scenario.utc);
    }
  });
}

/* ===================================================================== v2

   The block above exercises what the two working tools send, out of a
   hand-written stub. This one boots ops/evaluations.html the way a browser
   does — the registry, aria.js, assets/shell-pane-v2.js, then the pane — and
   asserts what a reader sees: the six tools and nothing drawn that is not one.

   The page used to end with a drawing of a scoring harness filled with made-up
   figures, and most of this block existed to prove no figure escaped it. The
   drawing is gone, so what is asserted now is that nothing replaced it: no
   preview, no banner, no stamp, no meter. Role gating is asserted in BOTH
   directions: a viewer is refused the evidence form and told why, AND an
   operator gets the real form. A one-directional assertion stays green against
   code that refuses everybody.

   NOT COVERED here: laid-out geometry, which the stub does not have.
   check-ops-narrow-overflow.mjs lays this page out at 375px and 360px in both
   themes and fails if the DOCUMENT scrolls sideways. The dataset and quarantine
   transports are owned by the block above. */

const OPS = new URL('../ops/', import.meta.url);
const readOps = rel => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = readOps('assets/pane-registry.js');
const ARIA_SRC = readOps('assets/aria.js');
const SHELL_SRC = readOps('assets/shell-pane-v2.js');
const PANE_SRC = readOps('assets/pane-evaluations.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

function buildEvalsPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'evals');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/evaluations.html loads it.

   The session stub's hasRole() is session.js's own implementation rather than
   a constant, so what the gating assertions exercise is the registry entry and
   the branch on it, not an answer written into the stub. */
async function bootPane(options = {}) {
  const role = options.role || 'operator';
  const calls = [];
  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/evaluations.html',
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildEvalsPage(dom, body);

  dom.window.crypto = webcrypto;
  dom.window.btoa = value => Buffer.from(value, 'binary').toString('base64');
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: {
      admin: { id: 'adm_1', displayName: 'Operator', email: 'operator@ops.invalid', role },
      session: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, method: o && o.method });
      if (options.call) return options.call(endpoint, o);
      return Promise.reject(new Error('the pane must not read an API on boot'));
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: required => (!required || !required.length ? true : required.indexOf(role) !== -1),
    daysLeft: () => 28,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-evaluations.js' });

  for (let i = 0; i < 12; i += 1) await new Promise(r => setImmediate(r));

  return { ...dom, body, calls, content: dom.doc.getElementById('content') };
}

function approvalLookupResponse(id, state, revision) {
  return {
    resource: {
      type: 'seval.approval-request',
      id,
      revision,
      value: { approvalRequestId: id, state, revision },
    },
  };
}

function fillAdmissionForm(view, overrides = {}) {
  const approvalRequestId = overrides.approvalRequestId || '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  view.byId('admission-artifact-id').value = overrides.artifactId || '4e1d10f7-1f13-4daf-82b6-c9dd43124138';
  view.byId('admission-expected-revision').value = overrides.expectedRevision || '1';
  view.byId('admission-source-digest').value = overrides.sourceDigest || 'a'.repeat(64);
  view.byId('admission-retained-digest').value = overrides.retainedDigest || 'b'.repeat(64);
  view.byId('admission-profile').value = overrides.contentProfile || 'trace';
  view.byId('admission-type').value = overrides.mediaType || 'application/json';
  view.byId('admission-purpose').value = overrides.purpose || 'quality_review';
  view.byId('admission-expiry').value = overrides.expiresAt || '2026-10-19T00:00';
  view.byId('admission-policy-revision').value = overrides.policyRevision || 'seval-evidence-admission.v1';
  view.byId('admission-approval-id').value = approvalRequestId;
  view.byId('admission-key').value = overrides.idempotencyKey || 'dashboard-admit-1';
  view.byId('admission-necessary').value = overrides.necessaryCategories || 'none';
  view.byId('admission-removed').value = overrides.removedCategories || 'tokens,identifiers';
}

function fillApprovalRequestForm(view, suffix = 'one') {
  view.doc.getElementById('approval-artifact-id').value = `artifact-${suffix}`;
  view.doc.getElementById('approval-artifact-revision').value = '1';
  view.doc.getElementById('approval-source-digest').value = 'a'.repeat(64);
  view.doc.getElementById('approval-retained-digest').value = 'b'.repeat(64);
  view.doc.getElementById('approval-target-digest').value = 'c'.repeat(64);
  view.doc.getElementById('approval-purpose').value = 'quality_review';
  view.doc.getElementById('approval-policy-revision').value = 'seval-evidence-admission.v1';
  view.doc.getElementById('approval-expiry').value = '2026-10-19T00:00';
  view.doc.getElementById('approval-request-key').value = `dashboard-approval-request-${suffix}`;
}

test('v2: approval lookup clears the previous success while its replacement is pending', async () => {
  let resolveReplacement;
  let calls = 0;
  const view = await bootPane({
    role: 'viewer',
    call: () => ++calls === 1
      ? Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2))
      : new Promise(resolve => { resolveReplacement = resolve; }),
  });
  const form = view.doc.getElementById('approval-get-form');
  const input = view.doc.getElementById('approval-get-id');
  const result = view.doc.getElementById('approval-result');
  const submit = form.querySelector('button');
  assert.equal(view.doc.getElementById('approval-request-form'), null);
  assert.equal(view.doc.getElementById('approval-decision-form'), null);
  input.value = 'approval-first';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'first approval lookup did not settle');
  assert.notEqual(result.hidden, true,
    'the pane must never hide the answer slot: ops-dom-harness leaves `hidden` '
    + 'undefined until something assigns it, so this reads as red the moment '
    + 'anything sets it (Stadiora/Aria#10809). The strict `=== false` binding is '
    + 'in scripts/ops-narrow-panes.test.mjs, against a real DOM.');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  input.value = 'approval-next';
  form.dispatch('submit');
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, 'Loading…');
  try {
    assert.equal(result.textContent, '',
      'the previous approval must not remain current while loading');
    assert.notEqual(result.hidden, true,
      'and it must be EMPTIED rather than hidden: hiding the region between '
      + 'answers takes it out of the accessibility tree, so the replacement '
      + 'announces as a fresh region rather than a change (Stadiora/Aria#10809)');
  } finally {
    resolveReplacement(approvalLookupResponse('approval-next', 'pending', 4));
  }
  await waitFor(() => !submit.disabled, 'replacement approval lookup did not settle');
  assert.notEqual(result.hidden, true,
    'the pane must never hide the answer slot: ops-dom-harness leaves `hidden` '
    + 'undefined until something assigns it, so this reads as red the moment '
    + 'anything sets it (Stadiora/Aria#10809). The strict `=== false` binding is '
    + 'in scripts/ops-narrow-panes.test.mjs, against a real DOM.');
  assert.equal(result.textContent, 'Approval request approval-next is pending at revision 4.');
});

test('v2: approval lookup keeps old success cleared after denial and shows a later successful lookup', async () => {
  let calls = 0;
  const view = await bootPane({
    role: 'viewer',
    call: () => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('Lookup denied.'));
      return Promise.resolve(calls === 1
        ? approvalLookupResponse('approval-first', 'approved', 2)
        : approvalLookupResponse('approval-recovered', 'pending', 5));
    },
  });
  const form = view.doc.getElementById('approval-get-form');
  const input = view.doc.getElementById('approval-get-id');
  const result = view.doc.getElementById('approval-result');
  const submit = form.querySelector('button');
  const error = form.querySelector('[role="alert"]');
  input.value = 'approval-first';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'first approval lookup did not settle');
  assert.notEqual(result.hidden, true,
    'the pane must never hide the answer slot: ops-dom-harness leaves `hidden` '
    + 'undefined until something assigns it, so this reads as red the moment '
    + 'anything sets it (Stadiora/Aria#10809). The strict `=== false` binding is '
    + 'in scripts/ops-narrow-panes.test.mjs, against a real DOM.');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  input.value = 'approval-denied';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'denied approval lookup did not settle');
  assert.equal(error.textContent, 'Lookup denied.');
  assert.equal(result.textContent, '', 'a denial must not retain the earlier approval');
  assert.notEqual(result.hidden, true,
    'and the emptied region stays in the accessibility tree (Stadiora/Aria#10809)');
  assert.equal(submit.textContent, 'Load request');

  input.value = 'approval-recovered';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'recovered approval lookup did not settle');
  assert.equal(error.textContent, '');
  assert.notEqual(result.hidden, true,
    'the pane must never hide the answer slot: ops-dom-harness leaves `hidden` '
    + 'undefined until something assigns it, so this reads as red the moment '
    + 'anything sets it (Stadiora/Aria#10809). The strict `=== false` binding is '
    + 'in scripts/ops-narrow-panes.test.mjs, against a real DOM.');
  assert.equal(result.textContent, 'Approval request approval-recovered is pending at revision 5.');
});

test('v2: approval request clears stale shared results through pending, failure and recovery', async () => {
  let resolvePending;
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: (endpoint, options) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2));
      if (calls === 2) return new Promise((resolve, reject) => { resolvePending = { resolve, reject }; });
      return Promise.resolve(approvalLookupResponse('approval-created', 'pending', 7));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const requestForm = view.doc.getElementById('approval-request-form');
  const requestSubmit = requestForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const error = requestForm.querySelector('[role="alert"]');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => result.textContent === 'Approval request approval-first is approved at revision 2.',
    'first approval lookup did not render');

  fillApprovalRequestForm(view, 'denied');
  requestForm.dispatch('submit');
  assert.equal(requestSubmit.disabled, true);
  assert.equal(requestSubmit.textContent, 'Creating…');
  assert.equal(result.textContent, '',
    'starting a replacement approval request must invalidate the earlier shared result');
  assert.equal(view.doc.getElementById('approval-decision-id').value, '',
    'auto-filled decision target from the invalidated result must be cleared');
  assert.equal(view.doc.getElementById('approval-expected-revision').value, '',
    'auto-filled decision revision from the invalidated result must be cleared');
  resolvePending.reject(new Error('Request refused.'));
  await waitFor(() => !requestSubmit.disabled, 'failed approval request did not settle');
  assert.equal(error.textContent, 'Request refused.');
  assert.equal(result.textContent, '', 'a failed replacement request must not retain the old result');

  fillApprovalRequestForm(view, 'created');
  requestForm.dispatch('submit');
  await waitFor(() => !requestSubmit.disabled, 'recovered approval request did not settle');
  assert.equal(error.textContent, '');
  assert.equal(result.textContent, 'Approval request approval-created is pending at revision 7.');
  assert.equal(view.doc.getElementById('approval-decision-id').value, 'approval-created');
  assert.equal(view.doc.getElementById('approval-expected-revision').value, '7');
});

test('v2: approval decision clears stale shared results through pending, failure and recovery', async () => {
  let resolvePending;
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: (endpoint, options) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2));
      if (calls === 2) return new Promise((resolve, reject) => { resolvePending = { resolve, reject }; });
      return Promise.resolve(approvalLookupResponse('approval-other', 'rejected', 3));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const decisionForm = view.doc.getElementById('approval-decision-form');
  const decisionSubmit = decisionForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const error = decisionForm.querySelector('[role="alert"]');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => result.textContent === 'Approval request approval-first is approved at revision 2.',
    'first approval lookup did not render');

  view.doc.getElementById('approval-decision-id').value = 'approval-other';
  view.doc.getElementById('approval-expected-revision').value = '1';
  view.doc.getElementById('approval-decision').value = 'rejected';
  view.doc.getElementById('approval-reason').value = 'Replacement request denied.';
  view.doc.getElementById('approval-decision-key').value = 'dashboard-approval-decision-denied';
  decisionForm.dispatch('submit');
  assert.equal(decisionSubmit.disabled, true);
  assert.equal(decisionSubmit.textContent, 'Recording…');
  assert.equal(result.textContent, '',
    'starting a decision for another request must invalidate the earlier shared result');
  assert.equal(view.doc.getElementById('approval-decision-id').value, 'approval-other');
  assert.equal(view.doc.getElementById('approval-expected-revision').value, '1');
  resolvePending.reject(new Error('Decision denied.'));
  await waitFor(() => !decisionSubmit.disabled, 'failed approval decision did not settle');
  assert.equal(error.textContent, 'Decision denied.');
  assert.equal(result.textContent, '', 'a failed decision must not retain the old result');

  decisionForm.dispatch('submit');
  await waitFor(() => !decisionSubmit.disabled, 'recovered approval decision did not settle');
  assert.equal(error.textContent, '');
  assert.equal(result.textContent, 'Approval request approval-other is rejected at revision 3.');
});

test('v2: replacement lookup clears auto-filled decision context after invalidating its result', async () => {
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: () => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('Lookup denied.'));
      return Promise.resolve(calls === 1
        ? approvalLookupResponse('approval-first', 'approved', 2)
        : approvalLookupResponse('approval-recovered', 'pending', 5));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const lookupSubmit = lookupForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const error = lookupForm.querySelector('[role="alert"]');
  const decisionId = view.doc.getElementById('approval-decision-id');
  const expectedRevision = view.doc.getElementById('approval-expected-revision');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'first approval lookup did not settle');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');
  assert.equal(decisionId.value, 'approval-first');
  assert.equal(expectedRevision.value, '2');

  view.doc.getElementById('approval-get-id').value = 'approval-denied';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'denied approval lookup did not settle');
  assert.equal(error.textContent, 'Lookup denied.');
  assert.equal(result.textContent, '');
  assert.equal(decisionId.value, '',
    'a denied replacement lookup must not leave the prior auto-filled decision id');
  assert.equal(expectedRevision.value, '',
    'a denied replacement lookup must not leave the prior auto-filled revision');

  view.doc.getElementById('approval-get-id').value = 'approval-recovered';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'recovered approval lookup did not settle');
  assert.equal(error.textContent, '');
  assert.equal(result.textContent, 'Approval request approval-recovered is pending at revision 5.');
  assert.equal(decisionId.value, 'approval-recovered');
  assert.equal(expectedRevision.value, '5');
});

test('v2: replacement lookup preserves manually edited decision context after invalidation', async () => {
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: () => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2))
        : Promise.reject(new Error('Lookup denied.'));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const lookupSubmit = lookupForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const decisionId = view.doc.getElementById('approval-decision-id');
  const expectedRevision = view.doc.getElementById('approval-expected-revision');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'first approval lookup did not settle');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  decisionId.value = 'operator-owned-request';
  expectedRevision.value = '9';
  view.doc.getElementById('approval-get-id').value = 'approval-denied';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'denied approval lookup did not settle');
  assert.equal(result.textContent, '');
  assert.equal(decisionId.value, 'operator-owned-request',
    'manual decision ids are operator-owned and must survive lookup invalidation');
  assert.equal(expectedRevision.value, '9',
    'manual expected revisions are operator-owned and must survive lookup invalidation');
});

test('v2: replacement lookup clears only an untouched auto-filled decision id', async () => {
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: () => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2))
        : Promise.reject(new Error('Lookup denied.'));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const lookupSubmit = lookupForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const decisionId = view.doc.getElementById('approval-decision-id');
  const expectedRevision = view.doc.getElementById('approval-expected-revision');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'first approval lookup did not settle');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  expectedRevision.value = '3';
  view.doc.getElementById('approval-get-id').value = 'approval-denied';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'denied approval lookup did not settle');
  assert.equal(result.textContent, '');
  assert.equal(decisionId.value, '',
    'an untouched auto-filled decision id must clear when its result is invalidated');
  assert.equal(expectedRevision.value, '3',
    'an edited expected revision is operator-owned and must survive lookup invalidation');
});

test('v2: replacement lookup clears only an untouched auto-filled expected revision', async () => {
  let calls = 0;
  const view = await bootPane({
    role: 'operator',
    call: () => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(approvalLookupResponse('approval-first', 'approved', 2))
        : Promise.reject(new Error('Lookup denied.'));
    },
  });
  const lookupForm = view.doc.getElementById('approval-get-form');
  const lookupSubmit = lookupForm.querySelector('button');
  const result = view.doc.getElementById('approval-result');
  const decisionId = view.doc.getElementById('approval-decision-id');
  const expectedRevision = view.doc.getElementById('approval-expected-revision');

  view.doc.getElementById('approval-get-id').value = 'approval-first';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'first approval lookup did not settle');
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  decisionId.value = 'approval-other';
  view.doc.getElementById('approval-get-id').value = 'approval-denied';
  lookupForm.dispatch('submit');
  await waitFor(() => !lookupSubmit.disabled, 'denied approval lookup did not settle');
  assert.equal(result.textContent, '');
  assert.equal(decisionId.value, 'approval-other',
    'an edited decision id is operator-owned and must survive lookup invalidation');
  assert.equal(expectedRevision.value, '',
    'an untouched auto-filled expected revision must clear when its result is invalidated');
});

const hasClass = (node, cls) => (node.getAttribute('class') || '').split(/\s+/).includes(cls);
const isBand = node => node.tagName === 'SECTION' && hasClass(node, 'band');
const within = (node, ancestor) => {
  for (let n = node.parentNode; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
};

const bandTitle = section => allText(find(section, node => hasClass(node, 'band-title')));

test('v2: the pane reads no API on boot', async () => {
  const dom = await bootPane();
  assert.deepEqual(dom.calls, [],
    'both tools act on what the operator supplies and the scoring half has no API');
});

test('v2: the page draws the six tools and nothing made up', async () => {
  const dom = await bootPane({ role: 'owner' });
  const titles = findAll(dom.content, isBand).map(bandTitle);
  assert.deepEqual(titles, [
    'Scenario catalogue',
    'Scenario runs',
    'Check a dataset declaration',
    'Put evidence into quarantine',
    'Qualified approval handoff',
    'Admit synthetic evidence',
  ], 'the page holds the six tools, in order, and no other band');

  for (const cls of ['preview', 'soon', 'u-tag', 'meter', 'tbl-wrap']) {
    assert.deepEqual(findAll(dom.content, node => hasClass(node, cls)).length, 0,
      `a "${cls}" element is back, which only the retired scoring drawing used`);
  }
  assert.doesNotMatch(allText(dom.content), /Works now|Invented figures|not built yet|\d\.\d\d(?!\d)/,
    'the page prints a stamp, a not-built banner or a two-decimal score');

  /* Every band is one a person can operate. A band with nothing to press or
     fill in is a drawing. */
  const CONTROL = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
  for (const section of findAll(dom.content, isBand)) {
    const own = findAll(section, node => CONTROL.has(node.tagName) && !hasClass(node, 'band-fold'));
    assert.ok(own.length > 0, `band "${bandTitle(section)}" has nothing to operate`);
  }

  /* Every band folds on a phone, and each fold is named for its own heading so
     a reader who has only the control knows what it opens. */
  for (const section of findAll(dom.content, isBand)) {
    const fold = find(section, node => hasClass(node, 'band-fold'));
    assert.ok(fold, `band "${bandTitle(section)}" has no fold control`);
    assert.equal(fold.getAttribute('type'), 'button');
    assert.equal(fold.getAttribute('aria-label'), bandTitle(section));
    assert.ok(fold.getAttribute('aria-controls'), 'a disclosure that does not say what it controls is a shrug');
  }
});

test('v2: an operator is given the evidence form', async () => {
  const dom = await bootPane({ role: 'operator' });
  assert.ok(find(dom.content, node => hasClass(node, 'evidence-form')),
    'an operator must get the real import form');
  assert.equal(find(dom.content, node => hasClass(node, 'state-block')), null,
    'an operator must not be shown a refusal');
  assert.ok(find(dom.content, node => hasClass(node, 'dataset-form')));
});

test('v2: a viewer is refused the evidence form, told why, and keeps the rest of the pane', async () => {
  const dom = await bootPane({ role: 'viewer' });
  assert.equal(find(dom.content, node => hasClass(node, 'evidence-form')), null,
    'a viewer must not be given the import form');

  const refusal = find(dom.content, node => hasClass(node, 'state-block'));
  assert.ok(refusal, 'a viewer must be told why the form is not there, not shown a gap');
  assert.match(allText(refusal), /operator/i);

  assert.ok(find(dom.content, node => hasClass(node, 'dataset-form')),
    'a viewer keeps the tool their role can use');
});

test('v2: the pane draws no filter bar, because none of its tools is filtered by app, date or environment', async () => {
  const dom = await bootPane();
  assert.equal(find(dom.doc.body, node => hasClass(node, 'filters')), null,
    'a filter bar is back on a pane whose tools take their input from forms');
});

test('v2: the consent boundary survives the restyle for every role', async () => {
  for (const role of ['operator', 'viewer']) {
    const dom = await bootPane({ role });
    const callout = find(dom.content, node => hasClass(node, 'callout'));
    assert.ok(callout, `the quarantine consent boundary is missing for ${role}`);
    assert.match(allText(callout), /Quarantine is not permission to use evidence/);
    assert.match(allText(callout), /do not create evaluation or training consent/);
  }
});

/* The tools a receipt lands in draw their card only AFTER a submit, so the
   boot-state assertions above never see it. This boots the pane with a working
   transport and submits both forms. */
async function bootPaneWithReceipts() {
  const digest = 'b'.repeat(64);
  const dom = await bootPane({
    role: 'operator',
    call: (endpoint, o) => {
      const body = o && o.body;
      const requestId = (body && body.requestId) || 'req_1';
      if (body && body.operationId === 'seval.dataset.validate') {
        return Promise.resolve({
          schemaVersion: 'seval.operation.response.v1',
          requestId,
          operationId: 'seval.dataset.validate',
          status: 'success',
          exitCode: 0,
          resource: {
            type: 'seval.dataset-validation',
            id: requestId,
            revision: 1,
            value: {
              valid: true,
              issues: [],
              digests: [{ datasetId: 'dataset.example', revision: 1, sha256: digest }],
            },
          },
        });
      }
      return Promise.resolve({
        schemaVersion: 'seval.operation.response.v1',
        requestId,
        operationId: 'seval.evidence.quarantine',
        status: 'success',
        exitCode: 0,
        resource: {
          type: 'seval.evidence',
          id: 'evd_1',
          revision: 2,
          value: { artifactId: 'evd_1', state: 'quarantined', revision: 2 },
        },
      });
    },
  });

  const input = dom.doc.getElementById('dataset-input');
  assert.ok(input, 'the dataset input is gone');
  input.value = JSON.stringify({
    schemaVersion: 'seval.dataset.declaration.v1',
    datasets: [{
      datasetId: 'dataset.example',
      revision: 1,
      purpose: 'evaluation',
      minimization: 'aggregate',
      retention: { policyId: 'ret.default', expiresAt: '2031-01-01T00:00:00.000Z' },
    }],
    fixtureDigests: [{ datasetId: 'dataset.example', revision: 1, sha256: digest }],
  });
  const bytes = new TextEncoder().encode('example');
  const set = (id, value) => {
    const node = dom.doc.getElementById(id);
    assert.ok(node, `the ${id} control is gone`);
    node.value = value;
    return node;
  };
  set('evidence-source', 'synthetic');
  set('evidence-profile', 'trace');
  set('evidence-type', 'text/plain');
  set('evidence-purpose', 'quality_review');
  /* Inside the 90-day ceiling the form enforces, expressed in local wall-clock
     fields the way the control does. */
  const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  set('evidence-expiry', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-` +
    `${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  const file = dom.doc.getElementById('evidence-file');
  assert.ok(file, 'the evidence file control is gone');
  file.files = [{ name: 'example.txt', async arrayBuffer() { return bytes.slice().buffer; } }];

  const forms = findAll(dom.content, node => node.tagName.toLowerCase() === 'form' &&
    (hasClass(node, 'dataset-form') || hasClass(node, 'evidence-form')));
  assert.equal(forms.length, 2, `expected dataset and quarantine forms, saw ${forms.length}`);

  /* Each submit is awaited on its RECEIPT, not on a fixed number of microtask
     turns. A turn budget is a guess about machine speed: quarantine awaits
     crypto.subtle.digest, which on a cold CI runner does not settle inside any
     budget that is comfortable locally, and this test was red on ubuntu-latest
     for five heads because of it while passing on every developer machine. */
  const receipts = ['Declarations valid', 'Quarantined, review required'];
  for (let i = 0; i < forms.length; i += 1) {
    forms[i].dispatch('submit', { preventDefault() {} });
    await waitFor(
      () => Boolean(find(dom.content, n => (n.textContent || '') === receipts[i])),
      `the ${receipts[i]} receipt never rendered, so this test sweeps nothing`);
  }
  return dom;
}

test('v2: a submit draws a receipt that says what happened and states no score', async () => {
  const dom = await bootPaneWithReceipts();
  const receipt = find(dom.content, node => (node.textContent || '') === 'Declarations valid');
  assert.ok(receipt, 'the validation receipt never rendered');
  const quarantined = find(dom.content,
    node => (node.textContent || '') === 'Quarantined, review required');
  assert.ok(quarantined, 'the quarantine receipt never rendered');

  const page = allText(dom.content);
  assert.doesNotMatch(page, /\d\.\d\d(?!\d)/, 'a receipt printed a two-decimal figure');
  assert.doesNotMatch(page, /Works now|Invented figures/, 'a receipt carries a stamp');
  assert.equal(findAll(dom.content, node => hasClass(node, 'preview')).length, 0);
});

/* The platform is SEVAL, and the backend retired every Ciel name: /api/ops/ciel/operations
   answers unsupported_contract_version, and ciel.* operation ids and contracts are refused.
   So no shipped ops file, the stub the browser checks serve, or a parity driver the Aria
   journeys run may still spell the old name in any case. */
test('no ops surface, stub or parity driver still spells the retired Ciel name', () => {
  const scanned = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url);
      else if (/\.(js|html|css|md|json)$/.test(entry.name)) scanned.push(url);
    }
  };
  walk(new URL('../ops/', import.meta.url));
  const scripts = new URL('./', import.meta.url);
  for (const name of readdirSync(scripts)) {
    if (name === 'ops-api-stub.mjs' || /^run-.*\.mjs$/.test(name)) scanned.push(new URL(name, scripts));
  }
  assert.ok(scanned.some(url => url.pathname.endsWith('/ops/assets/pane-evaluations.js')),
    'the sweep never reached pane-evaluations.js, so it proves nothing');
  assert.ok(scanned.some(url => url.pathname.endsWith('/scripts/run-seval-run-control.mjs')),
    'the sweep never reached the run parity driver, so it proves nothing');
  const hits = [];
  for (const url of scanned) {
    readFileSync(url, 'utf8').split('\n').forEach((line, index) => {
      if (/ciel/i.test(line)) hits.push(`${url.pathname.replace(/^.*?\/(ops|scripts)\//, '$1/')}:${index + 1}`);
    });
  }
  assert.deepEqual(hits, [], 'a retired Ciel name survives where the dashboard or its drivers read it');
});
