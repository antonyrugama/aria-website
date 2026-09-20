import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
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
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64');
    },
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

function datasetInput() {
  const reference = (id, path) => ({ id, version: 1, path, sha256: 'a'.repeat(64) });
  return {
    datasets: [{
      schemaVersion: 'ciel.dataset.v1',
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
        capabilityRef: 'ciel.g01.athlete-chat',
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
    schemaVersion: 'ciel.operation.response.v1',
    requestId,
    operationId: 'ciel.dataset.validate',
    status: 'success',
    exitCode: 0,
    resource: {
      type: 'ciel.dataset-validation',
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

  assert.equal(observed.path, '/api/ops/ciel/operations');
  assert.equal(observed.options.method, 'POST');
  assert.deepEqual(Object.keys(observed.options.body).sort(),
    ['schemaVersion', 'requestId', 'operationId', 'mode', 'client', 'input'].sort());
  assert.equal(observed.options.body.schemaVersion, 'ciel.operation.request.v1');
  assert.equal(observed.options.body.operationId, 'ciel.dataset.validate');
  assert.equal(observed.options.body.mode, 'remote');
  assert.deepEqual(observed.options.body.client, {
    name: 'aria-operations-dashboard',
    version: '1.0.0',
    contractVersions: ['ciel.operations.v1'],
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
              message: 'Dataset declarations are invalid.',
              details: [{
                path: '/input/datasets/0/revision',
                reason: 'positive_integer',
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
  assert.match(text(error), /Dataset declarations are invalid/);
  assert.match(text(error), /\/input\/datasets\/0\/revision/);
  assert.match(text(error), /positive_integer/);
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

test('a viewer requester can submit approval lookup without mutation controls', async () => {
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const calls = [];
  const view = renderedPane(async (path, options) => {
    calls.push({ path, options: plain(options) });
    return {
      schemaVersion: 'ciel.operation.response.v1',
      requestId: options.body.requestId,
      operationId: 'ciel.approval.get',
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'ciel.approval-request',
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

  assert.equal(calls[0].path, '/api/ops/ciel/operations');
  assert.deepEqual(calls[0].options.body.input, { approvalRequestId });
  assert.equal(calls[0].options.body.operationId, 'ciel.approval.get');
  assert.match(view.byId('approval-result').textContent, /pending/i);
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
      if (invalid === 'operation') response.operationId = 'ciel.artifact.quarantine';
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
  const byId = id => findNode(root, node => node.attributes?.id === id);
  const form = findNode(root, node => node.className === 'card evidence-form');
  return {
    pane,
    root,
    byId,
    form,
    error: form ? findNode(form, node => node.className === 'field-error') : null,
    result: findNode(root, node => node.className === 'evidence-result'),
    submit: form
      ? findNode(form, node => node.tag === 'button' && node.attributes.type === 'submit')
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
    schemaVersion: 'ciel.operation.response.v1',
    requestId,
    operationId: 'ciel.artifact.quarantine',
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
    if (request.url !== '/api/ops/ciel/operations' || request.method !== 'POST') {
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
    const valid = body.schemaVersion === 'ciel.operation.request.v1'
      && body.operationId === 'ciel.artifact.quarantine'
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
      schemaVersion: 'ciel.operation.response.v1',
      requestId: body.requestId,
      operationId: 'ciel.artifact.quarantine',
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'ciel.evidence-artifact',
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

  assert.equal(request.schemaVersion, 'ciel.operation.request.v1');
  assert.equal(request.operationId, 'ciel.artifact.quarantine');
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
    policyRevision: 'ciel-evidence-admission.v1',
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
    schemaVersion: 'ciel.operation.request.v1',
    requestId,
    operationId: 'ciel.approval.request',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['ciel.operations.v1'],
    },
    input: {
      targetOperationId: 'ciel.artifact.admit',
      targetRequestDigest,
      artifact: {
        artifactId: '4e1d10f7-1f13-4daf-82b6-c9dd43124138',
        revision: 1,
        sourceDigest,
        retainedDigest,
      },
      purpose: 'quality_review',
      policyRevision: 'ciel-evidence-admission.v1',
      expiresAt: '2026-10-19T00:00:00.000Z',
    },
    idempotencyKey: 'dashboard-approval-request-1',
  });
  assert.deepEqual(plain(approvalGet), {
    schemaVersion: 'ciel.operation.request.v1',
    requestId,
    operationId: 'ciel.approval.get',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['ciel.operations.v1'],
    },
    input: { approvalRequestId },
  });
  assert.deepEqual(plain(approvalDecision), {
    schemaVersion: 'ciel.operation.request.v1',
    requestId,
    operationId: 'ciel.approval.decide',
    mode: 'remote',
    client: {
      name: 'aria-operations-dashboard',
      version: '1.0.0',
      contractVersions: ['ciel.operations.v1'],
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

test('the rendered approval forms submit request, get and decision operations without trust provisioning', async () => {
  const calls = [];
  const approvalRequestId = '3b61b63d-3e27-47df-91e7-32c4ab857ed5';
  const view = renderedPane(async (path, options) => {
    calls.push({ path, options: plain(options) });
    const operationId = options.body.operationId;
    const state = operationId === 'ciel.approval.decide' ? 'approved' : 'pending';
    return {
      schemaVersion: 'ciel.operation.response.v1',
      requestId: options.body.requestId,
      operationId,
      status: 'success',
      exitCode: 0,
      resource: {
        type: 'ciel.approval-request',
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
  view.byId('approval-policy-revision').value = 'ciel-evidence-admission.v1';
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
    '/api/ops/ciel/operations',
    '/api/ops/ciel/operations',
    '/api/ops/ciel/operations',
  ]);
  assert.deepEqual(calls.map(call => call.options.body.operationId), [
    'ciel.approval.request',
    'ciel.approval.get',
    'ciel.approval.decide',
  ]);
  assert.equal(calls[1].options.body.idempotencyKey, undefined);
  assert.equal(calls[2].options.body.expectedRevision, 1);
  assert.equal(view.byId('approval-qualification'), null);
  assert.ok(findNode(
    view.byId('approval-trust-note'),
    node => /cannot provision qualification/i.test(node.textContent),
  ));
  assert.match(view.byId('approval-result').textContent, /approved/i);
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
    assert.equal(server.requests[0].url, '/api/ops/ciel/operations');
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
    assert.equal(server.requests[1].url, '/api/ops/ciel/operations');
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
    assert.equal(server.requests[0].url, '/api/ops/ciel/operations');
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
    assert.equal(path, '/api/ops/ciel/operations');
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
   asserts the one thing this pane can get wrong in a way that matters:
   whether a reader can tell the two figures that were measured from the
   hundred that were made up.

   Two of these are the shapes this repository has shipped false greens in
   before, so they are built deliberately:

     - "Nothing invented looks real" is NOT asserted by looking for a stamp.
       A stamp assertion stays green if every band is stamped, if none is, or
       if the wrong ones are. What is asserted is the PARTITION: every band
       inside the preview carries the invented stamp, every band outside it
       carries the working stamp, neither set is empty, and neither a
       two-decimal score nor a listed invented phrase appears outside the
       preview in the two render states swept. Move one band across that
       boundary and seven tests in this file go red.

     - Role gating is asserted in BOTH directions: a viewer is refused the
       evidence form and told why, AND an operator gets the real form. A
       one-directional assertion stays green against code that refuses
       everybody.

   NOT COVERED here, deliberately, and not implied to be:

     - Laid-out geometry, except the width of the document. The stub has no
       layout, so nothing about the dashed hairline, the hatch or the contrast
       of the preview is asserted here, and check-ops-shell-v2.mjs only asserts
       this page renders with no console error, which stays true when the
       preview is widened past the viewport. One thing is guarded, since
       Stadiora/Aria#10492: check-ops-narrow-overflow.mjs lays this page out at
       375px and 360px in both themes and fails if the DOCUMENT scrolls
       sideways, which is what this pane's 89-character registry filterNote
       does when BOTH copies of `white-space: normal` are taken away — the one
       in shell-pane-v2.css's `.filter-note` block and the one at
       pane-evaluations-v2.css:41, which is `.filters .filter-note` and so wins
       on specificity. Deleting only the shell copy leaves this page green;
       deleting both gives the measured scrollWidth 514 against a 375px
       viewport, the note named as the offender. Anything finer than the
       document width — an element that overruns inside a container that clips
       it, the 390px reading on the PR — is still a hand-run number and not a
       regression test.
     - The CSS that draws the stamp. These assert the word and the class the
       pane writes, not what pane-evaluations-v2.css paints them.
     - That INVENTED_FIGURES and INVENTED_PHRASES are COMPLETE. They are two
       hand-written inventories, and the sweeps can only look for what is in
       them plus any two-decimal score plus a digit inside a stamp. A made-up
       string outside all three of those shapes — a bare count like the "3"
       and "11" in the comparison panel, a new sentence with a round number
       in it — can be printed outside the preview and nothing here will see
       it. Adding invented data to the pane means adding it to an inventory
       by hand; there is no mechanism that notices you did not.
     - RENDER STATES BEYOND TWO. The outward sweeps read the page as it boots,
       and again after each of the two working tools has been submitted and
       answered. The ERROR branches are a third state and nothing reads them:
       a two-decimal score and a listed phrase appended to the JSON-parse
       catch in datasetValidationSection leave the whole suite green, while the
       same string on a boot-state hint in evidenceQuarantineSection turns
       three tests red. So the gap is the render state, not the string. Both
       are published rows of the battery on the PR. Named by function rather
       than by line, because a line number is the one citation that rots on
       every edit above it, and this one already went stale once.
     - A FIGURE SPLIT MID-TOKEN across two elements. The sweeps read one
       string built from <body> with the preview subtree removed, joining
       element boundaries with a single space the way allText does. A phrase
       or score split across SIBLING elements is found — <b>180</b> inside a
       sentence is this file's own idiom, and a per-element sweep walked past
       it until a reviewer demonstrated it. But "0.8" and "2" in two adjacent
       elements join as "0.8 2" here and as "0.82" in a browser.
     - THAT THE POST-SUBMIT SWEEP'S WAIT IS FAST ENOUGH, proven locally. It
       waits for the receipt itself now rather than for a fixed number of
       microtask turns, and there is no local mutation behind that: the turn
       budget it replaced was green on every machine it was written on and red
       on ubuntu-latest for five heads, so the platform that shows the defect
       is the only one that can show the fix. The evidence is CI's own red at
       f3a38ff and green after, linked on the PR, not a row of the battery. An
       attempt to reproduce it locally by settling the receipt on a timer is
       recorded on the PR as contaminated and was withdrawn rather than
       published. What IS asserted here is that a wait which ends early cannot
       pass silently: the two receipts are looked for by name and the failure
       message says the test swept nothing.
     - The dataset and quarantine transports, which the block above owns. */

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

/* Written out here rather than read back off the pane. An expectation derived
   from the thing under test moves with the mutation, which is the "the mock
   ignores the query" failure wearing a different hat. If the pane's INVENTED
   table changes, this list has to be changed by hand to match — which is the
   point, because adding a made-up figure should be a deliberate act. */
const INVENTED_FIGURES = [
  '0.82', '0.88', '0.90', '0.87', '0.86', '0.79', '0.96', '0.84', '0.83',
  '0.74', '0.91', '0.62', '0.71', '0.70', '0.81', '0.68', '0.78', '0.89',
  '0.85',
  /* A movement carries its direction as a sign, because a glyph nobody
     announces and a tint are not a direction. */
  '-0.29', '-0.17', '-0.14', '-0.13', '-0.08', '-0.06', '-0.02', '-0.03',
  '-0.01', '-0.09', '+0.03', '+0.02',
  /* Two more that live inside a sentence rather than in a cell: the
     regressions threshold, and the safety floor. Dropping either went
     unnoticed until a reviewer looked for them. */
  '0.05', '0.95',
];

/* Made-up strings that are NOT two-decimal scores. The sweep below sees a
   score and nothing else, so a duration, a case count, a timestamp or a
   made-up case id walks straight past it — which is how a banner chip reading
   "Last scored 29 Jul, 180 cases, 41 minutes" could sit above the boundary
   with this whole file green.

   Written out by hand, like the figures, and deliberately restricted to
   strings distinctive enough that a real value from the working half cannot
   collide with one. Bare counts the design prints in the comparison panel
   ("3" and "11" cases below 0.70) are NOT here for that reason, and are named
   in the NOT COVERED block above. */
const INVENTED_PHRASES = [
  '180 cases', '41 minutes', '02:14 UTC', '$3.18', '73% of sessions',
  'Held since 29 Jul', 'first scored', 'Cases below 0.70',
  'tc_0147', 'tc_0312', 'tc_0208', 'tc_0455', 'tc_0091',
  '14 Jul', '30 Jun', '12 Jun', '28 May', '14 May', '2 May',
];

/* A score is written to two decimals everywhere on this pane, so this is the
   shape of "a figure somebody could quote". It is asserted to appear only
   inside the preview. Nothing real on this pane is written this way: the two
   working tools print a 64-character digest, a byte count and a timestamp. */
const SCORE = /\d\.\d\d(?!\d)/;

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
      type: 'ciel.approval-request',
      id,
      revision,
      value: { approvalRequestId: id, state, revision },
    },
  };
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
  assert.equal(result.hidden, false);
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  input.value = 'approval-next';
  form.dispatch('submit');
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, 'Loading…');
  try {
    assert.equal(result.hidden, true, 'the previous approval must not remain current while loading');
    assert.equal(result.textContent, '');
  } finally {
    resolveReplacement(approvalLookupResponse('approval-next', 'pending', 4));
  }
  await waitFor(() => !submit.disabled, 'replacement approval lookup did not settle');
  assert.equal(result.hidden, false);
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
  assert.equal(result.hidden, false);
  assert.equal(result.textContent, 'Approval request approval-first is approved at revision 2.');

  input.value = 'approval-denied';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'denied approval lookup did not settle');
  assert.equal(error.textContent, 'Lookup denied.');
  assert.equal(result.hidden, true, 'a denial must not retain the earlier approval');
  assert.equal(result.textContent, '');
  assert.equal(submit.textContent, 'Load request');

  input.value = 'approval-recovered';
  form.dispatch('submit');
  await waitFor(() => !submit.disabled, 'recovered approval lookup did not settle');
  assert.equal(error.textContent, '');
  assert.equal(result.hidden, false);
  assert.equal(result.textContent, 'Approval request approval-recovered is pending at revision 5.');
});

const hasClass = (node, cls) => (node.getAttribute('class') || '').split(/\s+/).includes(cls);
const isBand = node => node.tagName === 'SECTION' && hasClass(node, 'band');
const within = (node, ancestor) => {
  for (let n = node.parentNode; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
};

/* Everything a reader meets on the page EXCEPT the preview, as one string.
   Four things this buys over asking each element for its own text:

   - A phrase split across sibling elements is still found. <b>180</b> inside a
     sentence is this file's own idiom (u-list-row bolds a score that way), and
     a per-element sweep walks straight past it.
   - It starts at <body>, not at #content, so the shell's live region is swept.
     announce() is how a screen-reader operator receives every success message
     on this pane, and the stamps are visual chips; an invented figure announced
     there would reach a blind operator with nothing marking it invented.
   - It collects text carried on ATTRIBUTES, not only textContent, and the LIVE
     `value` a control is holding, which is a property and not always an
     attribute — `expiry.value = ...` and `mediaType.value = ...` in this pane
     set one without the other, and a sweep that asks getAttribute walks past
     what is painted in the box. The attribute list is SPOKEN_ATTRS below and
     that is the only place it is written down, because an enumeration repeated
     in prose goes stale the round after the list is widened — which is how
     `value` came to be missing from one and present in the other. Two shapes
     justify the class: text PAINTED on screen (a field's value, a placeholder
     shown until the operator types), and text a screen reader SUBSTITUTES for
     the element's own (aria-label, title, alt). The second is worse than the
     live region, because it also suppresses the real words underneath it. This
     pane already uses all three idioms.
   - There is one string and one place to be wrong, rather than a rule applied
     per node.

   Element boundaries join with a single space, the way allText does, so a
   figure split MID-TOKEN across two elements is not found. That is disclosed
   below rather than chased. */
const SPOKEN_ATTRS = ['value', 'placeholder', 'title', 'aria-label',
  'aria-description', 'aria-valuetext', 'alt', 'aria-roledescription'];

function textOutside(node, excluded) {
  if (!node || node === excluded) return '';
  const own = node.textContent || '';
  const spoken = node.getAttribute
    ? SPOKEN_ATTRS.map(name => node.getAttribute(name) || '').join(' ')
    : '';
  /* The property, separately from the attribute of the same name. A control
     whose value was assigned in JS has no value attribute at all. */
  const held = typeof node.value === 'string' ? node.value : '';
  const kids = (node.childNodes || []).map(kid => textOutside(kid, excluded)).join(' ');
  return (own + ' ' + spoken + ' ' + held + ' ' + kids).replace(/\s+/g, ' ').trim();
}

/* A readable slice around a hit, so a failure names where to look. */
const around = (haystack, needle) => {
  const at = haystack.indexOf(needle);
  return haystack.slice(Math.max(0, at - 60), at + needle.length + 60);
};

function scoresOutside(text) {
  const out = [];
  const re = new RegExp(SCORE.source, 'g');
  let hit;
  while ((hit = re.exec(text))) out.push(around(text, hit[0]));
  return out;
}

const phrasesOutside = text => INVENTED_PHRASES
  .filter(phrase => text.includes(phrase))
  .map(phrase => `${phrase} — ${around(text, phrase)}`);

function previewOf(dom) {
  return find(dom.content, node => hasClass(node, 'preview'));
}

/* The stamp a band carries, as the word a reader sees plus whether it is the
   working variant. Read off .band-end so a chip sitting somewhere else in the
   band cannot stand in for the one in the status slot. */
function bandStamp(section) {
  const end = find(section, node => hasClass(node, 'band-end'));
  if (!end) return null;
  const chip = find(end, node => hasClass(node, 'u-tag'));
  if (!chip) return null;
  return { word: allText(chip), works: hasClass(chip, 'works') };
}

const bandTitle = section => allText(find(section, node => hasClass(node, 'band-title')));

test('v2: the pane reads no API on boot', async () => {
  const dom = await bootPane();
  assert.deepEqual(dom.calls, [],
    'both tools act on what the operator supplies and the scoring half has no API');
});

test('v2: every band in the preview is stamped invented and every band outside it is stamped working', async () => {
  const dom = await bootPane();
  const preview = previewOf(dom);
  assert.ok(preview, 'the deferred scoring preview is missing');

  const bands = findAll(dom.content, isBand);
  const inside = bands.filter(b => within(b, preview));
  const outside = bands.filter(b => !within(b, preview));

  /* Neither half may be empty. A partition with one side empty is the shape
     that stays green when every card is marked, or none is. */
  assert.ok(inside.length >= 3, `the preview must hold the drawn bands, saw ${inside.length}`);
  assert.ok(outside.length >= 2, `the working tools must be bands too, saw ${outside.length}`);
  assert.equal(inside.length + outside.length, bands.length);

  for (const section of inside) {
    const stamp = bandStamp(section);
    assert.ok(stamp, `preview band "${bandTitle(section)}" carries no stamp`);
    assert.equal(stamp.word, 'Invented figures',
      `preview band "${bandTitle(section)}" is stamped "${stamp.word}"`);
    assert.equal(stamp.works, false,
      `preview band "${bandTitle(section)}" carries the working stamp`);
  }
  for (const section of outside) {
    const stamp = bandStamp(section);
    assert.ok(stamp, `working band "${bandTitle(section)}" carries no stamp`);
    assert.equal(stamp.word, 'Works now',
      `working band "${bandTitle(section)}" is stamped "${stamp.word}"`);
    assert.equal(stamp.works, true,
      `working band "${bandTitle(section)}" carries the invented stamp`);
  }
});

test('v2: no score reaches the page outside the preview', async () => {
  const dom = await bootPane();
  const offenders = scoresOutside(textOutside(dom.body, previewOf(dom)));
  assert.deepEqual(offenders, [],
    'a two-decimal figure outside the preview is a made-up number with no stamp over it');
});

test('v2: every invented figure the design prints is inside the preview', async () => {
  const dom = await bootPane();
  const preview = previewOf(dom);
  /* Tokens rather than whole node text, because a figure is allowed to sit in
     a sentence — the regressions threshold does. Trailing punctuation is
     trimmed back to the last digit, so "0.85." matches and "ships." cannot. */
  const printed = new Set(allText(preview).split(/\s+/)
    .map(word => word.replace(/^[^0-9+-]+/, '').replace(/[^0-9]+$/, ''))
    .filter(Boolean));
  const missing = INVENTED_FIGURES.filter(figure => !printed.has(figure));
  assert.deepEqual(missing, [],
    'the drawn design lost a figure, or printed one somewhere this test cannot see it');
});

test('v2: the banner says the harness is not built and that the figures below are invented', async () => {
  const dom = await bootPane();
  const banner = find(dom.content, node => hasClass(node, 'soon'));
  assert.ok(banner, 'the not-built banner is missing');
  assert.equal(within(banner, previewOf(dom)), false, 'the banner must not be inside what it warns about');

  const words = allText(banner);
  assert.match(words, /not built yet/, 'the banner must say the harness is not built');
  assert.match(words, /figures somebody made up/, 'the banner must say the figures are invented');
  assert.match(words, /No harness/);
  assert.match(words, /No stored scores/);

  /* Order matters: a warning a reader meets after the thing it warns about has
     already been read is not a warning. */
  const flat = findAll(dom.content, () => true);
  assert.ok(flat.indexOf(banner) < flat.indexOf(previewOf(dom)),
    'the banner must come before the preview in reading order');
});

test('v2: the preview holds no control and the working bands do', async () => {
  const dom = await bootPane();
  const preview = previewOf(dom);
  const CONTROL = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);

  const dead = findAll(preview, node => CONTROL.has(node.tagName))
    .map(node => `${node.tagName.toLowerCase()} "${allText(node)}"`);
  assert.deepEqual(dead, [],
    'a drawing of a pane must not put a control that changes nothing into the tab order');

  /* Everything else the preview puts in the tab order, enumerated rather than
     assumed absent: a table that scrolls sideways has to be reachable from a
     keyboard, and that is the one thing in here allowed to take focus. It
     changes nothing — it moves the view — and it carries a name. */
  const focusable = findAll(preview, node => node.getAttribute('tabindex') === '0');
  assert.equal(focusable.length, 1, 'the preview should hold exactly one focus stop');
  assert.equal(hasClass(focusable[0], 'tbl-wrap'), true);
  assert.equal(focusable[0].getAttribute('role'), 'region');
  assert.match(focusable[0].getAttribute('aria-label') || '', /invented/i,
    'the scroll region must carry a name, and the name must repeat the warning');

  const working = findAll(dom.content, isBand).filter(b => !within(b, preview));
  for (const section of working) {
    assert.ok(findAll(section, node => CONTROL.has(node.tagName)).length > 0,
      `working band "${bandTitle(section)}" has nothing to operate`);
  }
});

test('v2: every meter in the preview is decoration beside a printed number', async () => {
  const dom = await bootPane();
  const preview = previewOf(dom);
  const meters = findAll(preview, node => hasClass(node, 'meter'));
  assert.ok(meters.length >= 5, `expected the drawn bars, saw ${meters.length}`);
  for (const bar of meters) {
    assert.equal(bar.getAttribute('aria-hidden'), 'true',
      'a bar with no accessible name must not be announced as an unnamed thing');
    assert.match(allText(bar.parentNode), /\d/,
      'a bar is only decoration when its value is printed next to it');
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
  assert.ok(previewOf(dom), 'a viewer sees the same deferred design');
});

test('v2: the pane keeps the registry note saying why it has no filters', async () => {
  const dom = await bootPane();
  const bar = find(dom.doc.body, node => hasClass(node, 'filters'));
  assert.ok(bar, 'the filter bar carrying the note is missing');
  assert.match(allText(bar),
    /These actions use supplied declarations or evidence, not app, date or environment filters/);
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

/* Two facts a reader of this pane has to be able to trust, each found by a
   reviewer as a green suite hiding a live defect.

   The banner draws the boundary between the half that runs and the half that
   is drawn, so nothing above that boundary may make a claim a reader could
   quote. A chip there reading "Design agreed 12 Jul 2026" wearing the marker
   this pane uses for "this really runs" shipped past every other test in this
   file, because the sweep below only looks for a two-decimal score. */
test('v2: the banner states no figure and claims nothing that runs', async () => {
  const dom = await bootPane();
  const banner = find(dom.content, node => hasClass(node, 'soon'));
  assert.ok(banner, 'the coming-soon banner is gone');
  const text = allText(banner);
  assert.ok(!/\d/.test(text),
    `the banner prints a figure, and a figure above the boundary is a claim: ${text}`);

  /* And no stamp chip anywhere on the pane carries a figure. A stamp is a
     status marker, so a digit inside one is a claim wearing a status. Every
     chip the pane draws is a word: "Works now", "Invented figures",
     "No access granted", "No harness", "No stored scores", "No alerting". */
  const chips = findAll(dom.content, node => hasClass(node, 'u-tag'));
  assert.ok(chips.length >= 6, `expected the drawn stamps, saw ${chips.length}`);
  const numeric = chips.map(node => allText(node)).filter(chip => /\d/.test(chip));
  assert.deepEqual(numeric, [],
    'a stamp carries a figure, which is a claim wearing a status marker');

  const preview = previewOf(dom);
  const bands = findAll(dom.content, isBand);
  const working = bands.filter(section => !within(section, preview));
  assert.ok(working.length >= 2, `expected the working bands, saw ${working.length}`);
  const marked = findAll(dom.content,
    node => hasClass(node, 'u-tag') && hasClass(node, 'works'));
  assert.ok(marked.length >= 2,
    `nothing wears the working marker, so this test proves nothing: ${marked.length}`);
  const stray = marked
    .filter(node => !working.some(section => within(node, section)))
    .map(node => allText(node));
  assert.deepEqual(stray, [],
    'the marker for "this really runs" is worn by something outside a working band');
});

/* A rise and a fall reached a screen reader as the same three characters,
   because the direction lived only in an aria-hidden glyph and a tint.
   assets/pane-overview.js:796 carries the same repair. */
test('v2: a rise and a fall do not announce the same thing', async () => {
  const dom = await bootPane();
  const preview = previewOf(dom);
  const pills = findAll(preview, node => hasClass(node, 'u-move'));
  assert.ok(pills.length >= 10, `expected the drawn change pills, saw ${pills.length}`);
  const rises = pills.filter(node => hasClass(node, 'up')).map(node => allText(node).trim());
  const falls = pills.filter(node => hasClass(node, 'down')).map(node => allText(node).trim());
  assert.ok(rises.length >= 1, `the design draws no rise, so this test proves nothing`);
  assert.ok(falls.length >= 2, `the design draws ${falls.length} falls, expected the drawn set`);

  const shared = rises.filter(text => falls.includes(text));
  assert.deepEqual(shared, [],
    'a rise and a fall announce the same text, so direction is carried by colour alone');
  assert.deepEqual(rises.filter(text => !text.startsWith('+')), [],
    'a rising change does not announce its sign');
  assert.deepEqual(falls.filter(text => !text.startsWith('-')), [],
    'a falling change does not announce its sign');
});

/* The sweep for two-decimal scores is the narrowest possible reading of "no
   invented figure escapes the preview". A reviewer showed four made-up strings
   leaving it with the suite green: a duration, a case count, a timestamp and a
   made-up case id. These two tests widen it to the inventory, in both
   directions, and the NOT COVERED block above states what is still outside
   them. */
test('v2: every invented phrase the design prints is inside the preview', async () => {
  const dom = await bootPane();
  const text = allText(previewOf(dom));
  const missing = INVENTED_PHRASES.filter(phrase => !text.includes(phrase));
  assert.deepEqual(missing, [],
    'the drawn design stopped printing a made-up string, or moved it out of the preview');
});

test('v2: no invented phrase reaches the page outside the preview', async () => {
  const dom = await bootPane();
  const offenders = phrasesOutside(textOutside(dom.body, previewOf(dom)));
  assert.deepEqual(offenders, [],
    'a made-up string outside the preview is an unstamped claim');
});

/* Every sweep above reads the page as it boots, and the two working tools each
   draw a card only AFTER a submit — a validation receipt and a quarantine
   receipt. A reviewer printed round one's dated chip onto the receipt and the
   whole suite stayed green: the partition was asserted over a DOM that does
   not contain the half most likely to grow a claim, because that is where the
   server's answer lands.

   This boots the pane with a working transport, submits both forms, and runs
   the three outward-facing sweeps again over the page that results. */
async function bootPaneWithReceipts() {
  const digest = 'b'.repeat(64);
  const dom = await bootPane({
    role: 'operator',
    call: (endpoint, o) => {
      const body = o && o.body;
      const requestId = (body && body.requestId) || 'req_1';
      if (body && body.operationId === 'ciel.dataset.validate') {
        return Promise.resolve({
          schemaVersion: 'ciel.operation.response.v1',
          requestId,
          operationId: 'ciel.dataset.validate',
          status: 'success',
          exitCode: 0,
          resource: {
            type: 'ciel.dataset-validation',
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
        schemaVersion: 'ciel.operation.response.v1',
        requestId,
        operationId: 'ciel.evidence.quarantine',
        status: 'success',
        exitCode: 0,
        resource: {
          type: 'ciel.evidence',
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
    schemaVersion: 'ciel.dataset.declaration.v1',
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

  /* One reading per submit, not one at the end. The shell's live region is a
     single node that each announce() overwrites, so a figure announced by the
     first tool is gone by the time the second has answered. Reading only the
     final DOM would see the last announcement and call the rest covered.

     Each reading waits for the RECEIPT, not for a fixed number of microtask
     turns. A turn budget is a guess about machine speed: quarantine awaits
     crypto.subtle.digest, which on a cold CI runner does not settle inside any
     budget that is comfortable locally, and this test was red on ubuntu-latest
     for five heads because of it while passing on every developer machine. */
  const snapshots = [];
  const receipts = ['Declarations valid', 'Quarantined, review required'];
  for (let i = 0; i < forms.length; i += 1) {
    forms[i].dispatch('submit', { preventDefault() {} });
    await waitFor(
      () => Boolean(find(dom.content, n => (n.textContent || '') === receipts[i])),
      `the ${receipts[i]} receipt never rendered, so this test sweeps nothing`);
    snapshots.push(textOutside(dom.body, previewOf(dom)));
  }
  return { ...dom, snapshots };
}

test('v2: the sweeps hold over the cards a submit draws, not only over the boot', async () => {
  const dom = await bootPaneWithReceipts();
  /* The receipt has to actually be on the page, or every assertion below is
     about a DOM that never grew the thing it is sweeping for. */
  const receipt = find(dom.content, node => (node.textContent || '') === 'Declarations valid');
  assert.ok(receipt, 'the validation receipt never rendered, so this test sweeps nothing');
  const quarantined = find(dom.content,
    node => (node.textContent || '') === 'Quarantined, review required');
  assert.ok(quarantined, 'the quarantine receipt never rendered, so this test sweeps nothing');

  /* True by construction today: bootPaneWithReceipts asserts the dataset and quarantine forms and
     pushes one reading each, and THAT assertion is what catches an unread
     tool. This one holds the shape if a future edit makes the push
     conditional. */
  assert.equal(dom.snapshots.length, 2, 'one reading per submit');
  for (const outside of dom.snapshots) {
    assert.deepEqual(scoresOutside(outside), [],
      'a two-decimal figure reached a card a submit drew, outside the preview');
    assert.deepEqual(phrasesOutside(outside), [],
      'a made-up string reached a card a submit drew, outside the preview');
  }

  const chips = findAll(dom.content, node => hasClass(node, 'u-tag'));
  /* Nine at boot, including approval, plus the quarantine receipt's one.
     The validation receipt carries no chip. */
  assert.ok(chips.length >= 10,
    `expected the boot stamps plus the quarantine receipt's stamp, saw ${chips.length}`);
  const numeric = chips.map(node => allText(node)).filter(chip => /\d/.test(chip));
  assert.deepEqual(numeric, [],
    'a stamp on a card a submit drew carries a figure');
});
