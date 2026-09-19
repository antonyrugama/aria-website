import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = new URL('../ops/assets/pane-evaluations.js', import.meta.url);
const WRAPPER_OPEN = '(function (global) {';
const WRAPPER_CLOSE = '})(window);';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function paneBody() {
  const source = readFileSync(SOURCE, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  assert.equal(digest, required('CIEL_PARITY_PANE_SHA256'), 'pane source digest does not match');
  const start = source.indexOf(WRAPPER_OPEN);
  const end = source.lastIndexOf(WRAPPER_CLOSE);
  assert.notEqual(start, -1, 'pane-evaluations.js wrapper opening is missing');
  assert.ok(end > start, 'pane-evaluations.js wrapper closing is missing');
  return {
    body: source.slice(start + WRAPPER_OPEN.length, end),
    digest,
  };
}

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

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function endpoint() {
  const url = new URL(required('CIEL_PARITY_ENDPOINT'));
  assert.equal(url.protocol, 'http:', 'parity endpoint must use loopback HTTP');
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'parity endpoint must be loopback',
  );
  assert.equal(url.username, '', 'parity endpoint must not include credentials');
  assert.equal(url.password, '', 'parity endpoint must not include credentials');
  assert.equal(url.search, '', 'parity endpoint must not include a query');
  assert.equal(url.hash, '', 'parity endpoint must not include a fragment');
  return url.origin;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function main() {
  const pane = paneBody();
  const requestId = required('CIEL_PARITY_REQUEST_ID');
  const baseUrl = endpoint();
  const transactions = [];
  const deterministicCrypto = {
    subtle: webcrypto.subtle,
    randomUUID() {
      return requestId;
    },
  };
  const window = {
    crypto: deterministicCrypto,
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
      async call(path, options) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${required('CIEL_PARITY_ACCESS_TOKEN')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options.body),
        });
        const body = await response.json();
        transactions.push({
          path,
          method: options.method,
          request: options.body,
          status: response.status,
          response: body,
        });
        if (!response.ok) {
          throw new Error(body?.error?.message || 'The operation failed.');
        }
        return body;
      },
    },
  };
  const context = vm.createContext({
    window,
    global: window,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Date,
    crypto: deterministicCrypto,
    console,
  });
  vm.runInContext(pane.body, context, { filename: 'ops/assets/pane-evaluations.js' });

  const root = {
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  context.render(root);
  const byId = id => findNode(root, node => node.attributes?.id === id);
  const form = findNode(root, node => node.tag === 'form');
  const error = findNode(root, node => node.className === 'field-error');
  const result = findNode(root, node => node.className === 'evidence-result');
  const submit = findNode(root, node => node.tag === 'button' && node.attributes.type === 'submit')
    || findNode(root, node => node.tag === 'button');
  assert.ok(form && error && result && submit, 'quarantine form did not render');

  const bytes = new TextEncoder().encode('approved fixture');
  byId('evidence-file').files = [{
    name: 'approved.txt',
    size: bytes.byteLength,
    type: 'text/plain',
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  }];
  byId('evidence-source').value = 'production_derived';
  byId('evidence-source').dispatch('change');
  byId('evidence-profile').value = 'trace';
  byId('evidence-type').value = 'text/plain';
  byId('evidence-purpose').value = 'incident_reproduction';
  byId('evidence-expiry').value = required('CIEL_PARITY_RETENTION_EXPIRES_AT');
  byId('evidence-key').value = required('CIEL_PARITY_IDEMPOTENCY_KEY');
  byId('evidence-necessary').value = 'none';
  byId('evidence-removed').value = '';
  byId('evidence-authority').value = required('CIEL_PARITY_AUTHORITY_REF');
  byId('evidence-consent').value = 'consent/42';
  byId('evidence-provider').value = 'provider/no-transfer/42';

  form.dispatch('submit');
  await waitFor(
    () => transactions.length === 1 && !submit.disabled,
    'dashboard quarantine request did not complete',
  );
  process.stdout.write(`${JSON.stringify({
    paneSha256: pane.digest,
    transaction: transactions[0],
    errorText: error.textContent,
    renderedResultCount: result.children.length,
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
