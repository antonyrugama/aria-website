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

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function textOf(node) {
  return [node.textContent || '', ...(node.children || []).map(textOf)].join(' ');
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
    location: { hostname: '127.0.0.1' },
    async fetch(url, options) {
      const response = await fetch(url, options);
      transactions.push({
        path: new URL(url).pathname,
        method: options.method,
        request: JSON.parse(options.body),
        status: response.status,
        response: await response.clone().json(),
      });
      return response;
    },
    btoa(value) {
      return Buffer.from(value, 'binary').toString('base64');
    },
    OpsPaneShell: {
      h: element,
      icon: () => element('svg'),
      definePane: () => {},
      announce: () => {},
      card: className => element('div', { className: `card${className ? ` ${className}` : ''}` }),
      cardHead: (title, note, end = []) => element('div', { className: 'card-head' }, [
        element('h3', { className: 'card-title', text: title }),
        element('div', { className: 'card-note', text: note || '' }),
        ...end,
      ]),
      band: (title, note, end = []) => element('section', { className: 'band' }, [
        element('div', { className: 'band-head' }, [
          element('h2', { className: 'band-title', text: title }),
          element('span', { className: 'band-note', text: note || '' }),
          element('div', { className: 'band-end' }, end),
        ]),
      ]),
      stateBlock: (iconName, title, lines = []) => element('div', { className: 'state-block' }, [
        element('h2', { className: 'state-title', text: title }),
        ...lines.map(text => element('p', { className: 'state-desc', text })),
      ]),
      link: (href, label, className) => element('a', { href, className, text: label }),
      paneHref: paneId => `${paneId}.html`,
    },
    OpsSession: {
      hasRole(roles) {
        return roles.includes(process.env.CIEL_PARITY_ADMIN_ROLE || 'operator');
      },
      call(path, options) {
        return window.OpsApi.request(path, {
          ...options,
          token: required('CIEL_PARITY_ACCESS_TOKEN'),
        });
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
    URLSearchParams,
    localStorage: {
      getItem(key) {
        return key === 'ops-api-base' ? baseUrl : null;
      },
    },
  });
  vm.runInContext(
    readFileSync(new URL('../ops/assets/api.js', import.meta.url), 'utf8'),
    context,
    { filename: 'ops/assets/api.js' },
  );
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
  function report(error, result) {
    assert.equal(transactions.length, 1, 'form must submit exactly one operation');
    process.stdout.write(`${JSON.stringify({
      paneSha256: pane.digest,
      transaction: transactions[0],
      errorText: textOf(error),
      renderedResultCount: result.children.length,
      renderedResultText: textOf(result),
    })}\n`);
  }
  const operationId = process.env.CIEL_PARITY_OPERATION_ID || 'ciel.artifact.quarantine';
  if (operationId === 'ciel.dataset.validate') {
    const form = findNode(root, node => node.className === 'card dataset-form');
    assert.ok(form, 'dataset form did not render');
    const error = findNode(form, node => node.className === 'field-error');
    const result = findNode(root, node => node.className === 'dataset-result');
    const input = byId('dataset-input');
    assert.ok(error && result && input, 'dataset form controls did not render');
    input.value = readFileSync(required('CIEL_PARITY_DATASET_INPUT_PATH'), 'utf8');
    await form.dispatch('submit');
    report(error, result);
    return;
  }
  if (operationId.startsWith('ciel.approval.')) {
    const result = byId('approval-result');
    assert.ok(result, 'approval result did not render');
    if (operationId === 'ciel.approval.request') {
      const form = byId('approval-request-form');
      const error = findNode(form, node => node.className === 'field-error');
      const submit = findNode(form, node => node.tag === 'button');
      assert.ok(form && error && submit, 'approval request form did not render');
      byId('approval-artifact-id').value = required('CIEL_PARITY_APPROVAL_ARTIFACT_ID');
      byId('approval-artifact-revision').value =
        required('CIEL_PARITY_APPROVAL_ARTIFACT_REVISION');
      byId('approval-source-digest').value =
        required('CIEL_PARITY_APPROVAL_SOURCE_DIGEST');
      byId('approval-retained-digest').value =
        required('CIEL_PARITY_APPROVAL_RETAINED_DIGEST');
      byId('approval-target-digest').value =
        required('CIEL_PARITY_APPROVAL_TARGET_DIGEST');
      byId('approval-purpose').value = required('CIEL_PARITY_APPROVAL_PURPOSE');
      byId('approval-policy-revision').value =
        required('CIEL_PARITY_APPROVAL_POLICY_REVISION');
      byId('approval-expiry').value = required('CIEL_PARITY_APPROVAL_EXPIRES_AT');
      byId('approval-request-key').value = required('CIEL_PARITY_IDEMPOTENCY_KEY');
      form.dispatch('submit');
      await waitFor(
        () => transactions.length === 1 && !submit.disabled,
        'dashboard approval request did not complete',
      );
      report(error, result);
      return;
    }
    if (operationId === 'ciel.approval.get') {
      const form = byId('approval-get-form');
      const error = findNode(form, node => node.className === 'field-error');
      const submit = findNode(form, node => node.tag === 'button');
      assert.ok(form && error && submit, 'approval lookup form did not render');
      byId('approval-get-id').value = required('CIEL_PARITY_APPROVAL_REQUEST_ID');
      form.dispatch('submit');
      await waitFor(
        () => transactions.length === 1 && !submit.disabled,
        'dashboard approval lookup did not complete',
      );
      report(error, result);
      return;
    }
    if (operationId === 'ciel.approval.decide') {
      const form = byId('approval-decision-form');
      const error = findNode(form, node => node.className === 'field-error');
      const submit = findNode(form, node => node.tag === 'button');
      assert.ok(form && error && submit, 'approval decision form did not render');
      byId('approval-decision-id').value = required('CIEL_PARITY_APPROVAL_REQUEST_ID');
      byId('approval-expected-revision').value =
        required('CIEL_PARITY_APPROVAL_EXPECTED_REVISION');
      byId('approval-decision').value = required('CIEL_PARITY_APPROVAL_DECISION');
      byId('approval-reason').value = required('CIEL_PARITY_APPROVAL_REASON');
      byId('approval-decision-key').value = required('CIEL_PARITY_IDEMPOTENCY_KEY');
      form.dispatch('submit');
      await waitFor(
        () => transactions.length === 1 && !submit.disabled,
        'dashboard approval decision did not complete',
      );
      report(error, result);
      return;
    }
  }
  assert.equal(operationId, 'ciel.artifact.quarantine', 'unsupported form operation');
  const form = findNode(root, node => node.className === 'card evidence-form');
  assert.ok(form, 'quarantine form did not render');
  const error = findNode(form, node => node.className === 'field-error');
  const result = findNode(root, node => node.className === 'evidence-result');
  const submit = findNode(form, node => node.tag === 'button' && node.attributes.type === 'submit')
    || findNode(form, node => node.tag === 'button');
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
  report(error, result);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
