/* Look up a user: masking floors.

   This repository has no build step and no package manager, so this test uses
   only what ships with Node: `node:test`, `node:assert`, and `node:vm`. It is
   run by .github/workflows/ops-pane-tests.yml.

   ops/assets/pane-users.js is an IIFE that exports nothing, because nothing on
   the page needs it to. Rather than change that shape for the sake of a test,
   the body of the wrapper is lifted out and run inside a vm context, which
   makes its inner declarations — `fieldValue` among them — properties of that
   context. The DOM the pane draws into is a stub small enough to read: element
   nodes with a class list, children, attributes, and text.

   What is under test is the rule that a payload contradicting itself is read
   the safe way round: `reveal: 'never'` wins over `masked: false`, at every
   role, and a field the API plainly said is not personal still renders in the
   clear.
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SOURCE = new URL('../ops/assets/pane-users.js', import.meta.url);

/* ------------------------------------------------------------ DOM stub */

function classesOf(node) {
  return typeof node.className === 'string' && node.className
    ? node.className.split(/\s+/).filter(Boolean)
    : [];
}

function createElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    attributes: Object.create(null),
    listeners: Object.create(null),
    parentNode: null,
    value: '',
    disabled: false,
    offsetParent: null,
    _text: ''
  };

  Object.defineProperty(node, 'textContent', {
    get() {
      return node._text + node.children.map((child) => child.textContent).join('');
    },
    set(next) {
      node._text = next === null || next === undefined ? '' : String(next);
      node.children.length = 0;
    }
  });

  node.classList = {
    add(...names) {
      const list = classesOf(node);
      names.forEach((name) => { if (!list.includes(name)) list.push(name); });
      node.className = list.join(' ');
    },
    remove(...names) {
      node.className = classesOf(node).filter((name) => !names.includes(name)).join(' ');
    },
    contains(name) {
      return classesOf(node).includes(name);
    }
  };

  node.appendChild = (child) => {
    node.children.push(child);
    child.parentNode = node;
    return child;
  };
  node.setAttribute = (key, value) => { node.attributes[key] = String(value); };
  node.getAttribute = (key) => (key in node.attributes ? node.attributes[key] : null);
  node.removeAttribute = (key) => { delete node.attributes[key]; };
  node.addEventListener = (type, fn) => {
    (node.listeners[type] = node.listeners[type] || []).push(fn);
  };
  node.removeEventListener = () => {};
  node.focus = () => {};
  node.querySelectorAll = () => [];
  node.contains = (other) => {
    if (other === node) return true;
    return node.children.some((child) => child.contains && child.contains(other));
  };

  return node;
}

function createTextNode(text) {
  return {
    tagName: '#text',
    children: [],
    textContent: text === null || text === undefined ? '' : String(text),
    contains: () => false
  };
}

/* --------------------------------------------------------- pane loading */

const WRAPPER_OPEN = '(function (global) {';
const WRAPPER_CLOSE = '})(window);';

/* Lift the wrapper body out of the source file. If the file's shape changes
   this throws rather than silently testing nothing. */
function paneBody() {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf(WRAPPER_OPEN);
  const end = source.lastIndexOf(WRAPPER_CLOSE);
  assert.ok(start !== -1, `pane-users.js no longer opens with "${WRAPPER_OPEN}"`);
  assert.ok(end > start, `pane-users.js no longer closes with "${WRAPPER_CLOSE}"`);
  return source.slice(start + WRAPPER_OPEN.length, end);
}

const BODY = paneBody();

/* A fresh pane per test: module state inside it (revealed fields, pending
   requests, the selected account) must not leak between cases. */
function loadPane(role) {
  const document = {
    activeElement: null,
    createElement,
    createTextNode,
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    contains: () => false
  };
  document.body = createElement('body');

  /* Same six lines as OpsShell.h in ops/assets/shell.js. */
  function h(tag, opts, children) {
    const el = document.createElement(tag);
    opts = opts || {};
    if (opts.className) el.className = opts.className;
    if (opts.text !== undefined) el.textContent = opts.text;
    Object.keys(opts).forEach((key) => {
      if (key === 'className' || key === 'text') return;
      el.setAttribute(key, opts[key]);
    });
    (children || []).forEach((child) => { if (child) el.appendChild(child); });
    return el;
  }

  const window = {
    location: { href: 'https://runwitharia.com/ops/users.html', origin: 'https://runwitharia.com' },
    addEventListener: () => {},
    setTimeout: () => null,
    clearTimeout: () => {},
    OpsShell: {
      h,
      icon: (name) => h('span', { className: 'icon icon-' + name }),
      definePane: () => {},
      announce: () => {},
      stateBlock: () => h('div', { className: 'state-block' }),
      wireTabs: () => {},
      filters: () => ({ scope: 'all' })
    },
    OpsSession: {
      hasRole: (roles) => roles.indexOf(role) !== -1,
      call: () => new Promise(() => {})
    }
  };

  const context = vm.createContext({ document, global: window, window, URL, console });
  vm.runInContext(BODY, context, { filename: 'ops/assets/pane-users.js' });
  assert.equal(typeof context.fieldValue, 'function', 'fieldValue was not declared by the pane');
  return context;
}

/* ------------------------------------------------------------- helpers */

function findAll(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  (node.children || []).forEach((child) => findAll(child, predicate, found));
  return found;
}

const withClass = (node, cls) => findAll(node, (n) => classesOf(n).includes(cls));
const withTag = (node, tag) => findAll(node, (n) => n.tagName === tag.toUpperCase());

/* Every role the pane distinguishes, plus one it does not recognise. */
const ROLES = ['owner', 'operator', 'viewer', 'none'];

const SECRET = 'athlete@example.com';

/* ------------------------------------------------------------- the tests */

/* The hostile payload. `reveal: 'never'` and `masked: false` never travel
   together in the server contract, so a payload carrying both is one this
   client cannot take at its word, and the safe reading is the restrictive
   one. */
test("reveal:'never' masks the field even when the payload also says masked:false", async (t) => {
  for (const role of ROLES) {
    await t.test(`role ${role}`, () => {
      const pane = loadPane(role);
      const row = pane.fieldValue('acct_1', {
        key: 'email',
        label: 'Email',
        masked: false,
        reveal: 'never',
        value: SECRET
      });

      assert.ok(
        !row.textContent.includes(SECRET),
        `the raw value reached the screen at role ${role}: ${row.textContent}`
      );
      assert.ok(classesOf(row).includes('reveal-row'), 'expected the masked row shape');
      assert.equal(withClass(row, 'reveal-never').length, 1, 'expected the never-shown line');
      assert.equal(withTag(row, 'button').length, 0, 'a never-shown field gets no control');

      const masked = withClass(row, 'masked');
      assert.equal(masked.length, 1, 'expected exactly one mask');
      assert.equal(masked[0].textContent, 'Hidden');
    });
  }
});

/* The same contradiction with a mask beside it, which is the shape the
   pane already refused before, kept here so the two halves of
   `unmaskedByDesign` cannot regress independently. */
test("reveal:'never' masks the field when a maskedValue is present too", () => {
  const pane = loadPane('owner');
  const row = pane.fieldValue('acct_1', {
    key: 'email',
    label: 'Email',
    masked: false,
    maskedValue: 'a•••@example.com',
    reveal: 'never',
    value: SECRET
  });

  assert.ok(!row.textContent.includes(SECRET));
  assert.equal(withClass(row, 'reveal-never').length, 1);
  assert.equal(withClass(row, 'masked')[0].textContent, 'a•••@example.com');
});

/* The fix must not turn the pane into one that masks everything. A field the
   API said is not personal is still printed. */
test('a field the API says is not personal still renders in the clear', () => {
  for (const field of [
    { key: 'tier', label: 'Tier', masked: false, value: 'Free' },
    { key: 'tier', label: 'Tier', masked: false, reveal: 'allowed', value: 'Free' },
    { key: 'tier', label: 'Tier', masked: false, reveal: 'unavailable', value: 'Free' }
  ]) {
    const pane = loadPane('viewer');
    const node = pane.fieldValue('acct_1', field);
    assert.ok(classesOf(node).includes('reveal-value'), 'expected a plain value');
    assert.equal(node.textContent, 'Free');
  }
});

/* And a genuinely revealable masked field still offers the control, so the
   never-branch cannot swallow the case the pane exists to serve. */
test("a masked reveal:'allowed' field still offers the control to an owner", () => {
  const pane = loadPane('owner');
  const row = pane.fieldValue('acct_1', {
    key: 'email',
    label: 'Email',
    masked: true,
    maskedValue: 'a•••@example.com',
    reveal: 'allowed'
  });

  assert.equal(withClass(row, 'reveal-never').length, 0);
  const reveal = withTag(row, 'button').filter((b) => b.textContent === 'Reveal');
  assert.equal(reveal.length, 1, 'expected a Reveal control');
  assert.equal(reveal[0].disabled, false);
});
