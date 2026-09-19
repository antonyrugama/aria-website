import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import vm from 'node:vm';

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
  const window = {
    crypto: webcrypto,
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64');
    },
    OpsShell: {
      h: element,
      icon: () => element('svg'),
      definePane: () => {},
      announce: () => {},
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
  assert.match(text(result), /Dataset declarations valid/);
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
  const shell = { OpsSession: pane.window.OpsSession };
  vm.runInNewContext(
    readFileSync(new URL('../ops/assets/shell.js', import.meta.url), 'utf8'),
    { window: shell, document: {} },
  );
  assert.equal(shell.OpsSession.hasRole(shell.OpsShell.panes.evals.roles), true,
    'the shell must allow a viewer to enter Aria quality');
  const root = { children: [], appendChild(child) { this.children.push(child); } };
  pane.render(root);
  assert.ok(findNode(root, node => node.className === 'card dataset-form'));
  assert.equal(findNode(root, node => node.className === 'card evidence-form'), null);
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

function renderedPane(call, Clock = Date) {
  const pane = loadPane(call, Clock);
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
    error: findNode(form, node => node.className === 'field-error'),
    result: findNode(root, node => node.className === 'evidence-result'),
    submit: findNode(form, node => node.tag === 'button' && node.attributes.type === 'submit')
      || findNode(form, node => node.tag === 'button'),
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
