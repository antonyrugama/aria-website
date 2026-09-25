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
  return { body: source.slice(start + WRAPPER_OPEN.length, end), digest };
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
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    dispatch(name, event = {}) {
      const listener = this.listeners[name];
      assert.equal(typeof listener, 'function', `${tag} ${name} listener is missing`);
      return listener({ preventDefault() {}, ...event });
    },
    focus() {},
  };
  Object.defineProperty(node, 'textContent', {
    get() { return text; },
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
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'parity endpoint must be loopback');
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
  const requestIds = (process.env.CIEL_PARITY_REQUEST_IDS || required('CIEL_PARITY_REQUEST_ID')).split(',');
  let nextRequestId = 0;
  const deterministicCrypto = {
    subtle: webcrypto.subtle,
    randomUUID() {
      return requestIds[Math.min(nextRequestId++, requestIds.length - 1)];
    },
  };
  const baseUrl = endpoint();
  const transactions = [];
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
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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
        ...lines.map(line => element('p', { className: 'state-desc', text: line })),
      ]),
      link: (href, label, className) => element('a', { href, className, text: label }),
      paneHref: paneId => `${paneId}.html`,
    },
    OpsPaneRegistry: {
      maskContactDetails(value) {
        return String(value);
      },
    },
    OpsSession: {
      hasRole(roles) { return roles.includes(process.env.CIEL_PARITY_ADMIN_ROLE || 'operator'); },
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
    localStorage: { getItem: key => key === 'ops-api-base' ? baseUrl : null },
  });
  vm.runInContext(readFileSync(new URL('../ops/assets/api.js', import.meta.url), 'utf8'), context, { filename: 'ops/assets/api.js' });
  vm.runInContext(pane.body, context, { filename: 'ops/assets/pane-evaluations.js' });

  const root = { children: [], appendChild(child) { this.children.push(child); return child; } };
  context.render(root);
  const byId = id => findNode(root, node => node.attributes?.id === id);
  const operation = process.env.CIEL_PARITY_RUN_OPERATION || 'get';

  if (operation === 'launch') {
    const form = byId('ciel-run-launch-form');
    assert.ok(form, 'run launch form did not render');
    form.dispatch('submit');
    await waitFor(() => transactions.length === 2, 'dashboard launch pair did not complete');
  } else {
    const form = byId('ciel-run-inspect-form');
    assert.ok(form, 'run inspect form did not render');
    byId('ciel-run-inspect-id').value = required('CIEL_PARITY_RUN_ID');
    form.dispatch('submit');
    await waitFor(() => transactions.length === 1, 'dashboard run inspection did not complete');
    if (operation === 'retry') {
      await findNode(root, node => node.tag === 'button' && node.textContent === 'Retry failed run').dispatch('click');
      await waitFor(() => transactions.length === 2, 'dashboard run retry did not complete');
    } else if (operation === 'cancel') {
      await findNode(root, node => node.tag === 'button' && node.textContent === 'Cancel inspected run').dispatch('click');
      await waitFor(() => transactions.length === 2, 'dashboard run cancel did not complete');
    } else {
      assert.equal(operation, 'get', 'unsupported Ciel run parity operation');
    }
  }

  process.stdout.write(`${JSON.stringify({
    paneSha256: pane.digest,
    transactions,
    renderedResultText: textOf(byId('ciel-run-inspection-result')) || textOf(byId('ciel-run-launch-result')),
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
