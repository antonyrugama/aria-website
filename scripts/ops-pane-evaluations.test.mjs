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

function loadPane(call = () => Promise.reject(new Error('unexpected request'))) {
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
    },
  };
  const context = vm.createContext({
    window,
    global: window,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Date,
    crypto: webcrypto,
    console,
  });
  vm.runInContext(paneBody(), context, { filename: 'ops/assets/pane-evaluations.js' });
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function renderedPane(call) {
  const pane = loadPane(call);
  const root = {
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  pane.render(root);
  const byId = id => findNode(root, node => node.attributes?.id === id);
  return {
    pane,
    root,
    byId,
    form: findNode(root, node => node.tag === 'form'),
    error: findNode(root, node => node.className === 'field-error'),
    result: findNode(root, node => node.className === 'evidence-result'),
    submit: findNode(root, node => node.tag === 'button' && node.attributes.type === 'submit')
      || findNode(root, node => node.tag === 'button'),
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
