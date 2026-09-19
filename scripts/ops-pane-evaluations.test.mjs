import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

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

function loadPane() {
  function element(tag, opts = {}, children = []) {
    const node = {
      tag,
      children: [],
      attributes: {},
      className: opts.className || '',
      textContent: opts.text || '',
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
      addEventListener() {},
      focus() {},
    };
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
      call: () => Promise.reject(new Error('unexpected request')),
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
