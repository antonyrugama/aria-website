/* The length limit on the note an operator writes when closing a problem.

   Stadiora/Aria#5498's third defect. The close endpoint keeps 500 characters
   of a note and drops the rest, and the field offered no limit at all, so a
   longer note was accepted on screen and silently shortened on the way to the
   record.

   Half of that has since been fixed: the textarea carries `maxlength`, which
   stops TYPING at the limit. The half that was still live is the paste. A
   paste longer than `maxlength` is truncated by the browser without a word,
   so the operator gets a note ending mid-sentence and no sign anything was
   dropped — and this is the one field on the pane whose whole purpose is to
   say why a problem was closed, read by whoever finds it next.

   Two separate mechanisms, so two separate bindings:

     - the attribute, which is what actually stops the text, asserted against
       the limit written HERE rather than read out of the pane. A test that
       reads its expectation from the file under test moves with the mutation
       and cannot fail.

     - the sentence, which is what tells a person it happened, driven through
       a real `input` event on the real listener rather than by inspecting
       source.

   NOT COVERED: that a real browser truncates a paste at `maxlength`. That is
   the browser's behaviour, not this pane's, and the fake DOM these tests run
   in does not enforce the attribute — which is why the length here is set on
   the element directly. What is covered is that the attribute is present and
   correct, and that the pane speaks when the value reaches the limit. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-alerts.js');

const TOKENS = { '--cyan': '#22D3EE', '--ink': '#E6EDF3', '--line-2': '#1F2A36' };

/* What `POST /api/ops/alerts/problems/:id/close` keeps of a note. Stated
   here, not read from the pane, so that changing the pane's number without
   changing the endpoint's turns this red. */
const SERVER_NOTE_LIMIT = 500;

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

const PROBLEMS = {
  problems: [{
    id: 'p1', reference: 'PRB-1', title: 'Checkout latency', severity: 'critical',
    status: 'open', category: 'performance', firedAt: hoursAgo(3), workPane: 'alerts',
  }],
};

const RULES = {
  rules: [{
    id: 'r1', name: 'Checkout latency', enabled: true, thresholdUnit: 'ms',
    lastEvaluatedAt: hoursAgo(1), lastEvaluationStatus: 'ok',
  }],
  summary: { armed: 1, total: 1 },
  channels: [{ key: 'email', configured: true }],
};

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'alerts');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

async function boot() {
  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/alerts.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      if (endpoint === '/api/ops/alerts/problems') {
        const status = o && o.query && o.query.status;
        return Promise.resolve({ data: status === 'closed' ? { problems: [] } : PROBLEMS });
      }
      if (endpoint === '/api/ops/alerts/rules') return Promise.resolve({ data: RULES });
      return Promise.reject(new Error('no stub for ' + endpoint));
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: (roles) => !roles || roles.indexOf('owner') !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-alerts.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
  return dom;
}

function livePanel(dom) {
  return dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf('live') !== -1)[0];
}

/* The close form, opened the way an operator opens it. */
async function openCloseForm(dom) {
  const live = livePanel(dom);
  const button = findAll(live,
    (n) => n.tagName === 'BUTTON' && /^Close/.test(allText(n)))[0];
  assert.ok(button, 'the pane drew no Close control, so there is no form to test');
  button.dispatch('click');
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));

  const note = findAll(livePanel(dom), (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(note, 'the close form has no note field');
  const describedBy = note.getAttribute('aria-describedby');

  /* Find the message the way a reader of the RENDER would — the live region
     in the close form — and not by following the very reference the tests
     below check. Resolving it through `describedBy` makes
     `hint.id === describedBy` true by construction: round 2 caught that
     assertion comparing an attribute with itself, and moving the comparison
     without moving the lookup only relocated the tautology. */
  const hint = findAll(livePanel(dom),
    (n) => n.tagName === 'P' && n.getAttribute('role') === 'status')[0] || null;
  return { note, hint, describedBy };
}

/* Typing, as far as this DOM is concerned: set the value and tell the pane. */
function type(note, length) {
  note.value = 'x'.repeat(length);
  note.dispatch('input');
}

test('the note field stops at the number of characters the record keeps', async () => {
  const dom = await boot();
  const { note } = await openCloseForm(dom);
  assert.equal(note.getAttribute('maxlength'), String(SERVER_NOTE_LIMIT),
    'the field accepts more of a note than the close endpoint stores');
});

test('the note field says nothing until the limit is reached', async () => {
  const dom = await boot();
  const { note, hint } = await openCloseForm(dom);
  assert.ok(hint, 'the note field is described by nothing, so nothing can tell a person');
  assert.equal(allText(hint).trim(), '',
    'the field carried a message before there was anything to report');

  type(note, SERVER_NOTE_LIMIT - 1);
  assert.equal(allText(hint).trim(), '',
    'the field reported a limit that had not been reached');
});

test('the note field says so when the limit is reached', async () => {
  const dom = await boot();
  const { note, hint } = await openCloseForm(dom);

  type(note, SERVER_NOTE_LIMIT);
  const said = allText(hint).trim();
  assert.notEqual(said, '',
    'the note stopped taking text and the operator was told nothing');
  assert.match(said, new RegExp(String(SERVER_NOTE_LIMIT)),
    'the message does not say what the limit is');
});

test('the message goes away again when the note is shortened', async () => {
  const dom = await boot();
  const { note, hint } = await openCloseForm(dom);

  type(note, SERVER_NOTE_LIMIT);
  assert.notEqual(allText(hint).trim(), '', 'the limit message never appeared');

  type(note, 10);
  assert.equal(allText(hint).trim(), '',
    'the field still claimed to be full after it was emptied');
});

test('the message is announced rather than only drawn', async () => {
  const dom = await boot();
  const { note, hint, describedBy } = await openCloseForm(dom);
  assert.equal(hint.getAttribute('role'), 'status',
    'the limit message is not in a live region, so it reaches nobody who cannot see it');
  assert.equal(hint.getAttribute('id'), describedBy,
    'the note field points at an id that is not the message element, so the reference '
    + 'dangles and nothing is announced with the field');
});
