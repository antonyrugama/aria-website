import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeDom, allText } from './ops-dom-harness.mjs';
import { MODERATION_REPORTS } from './ops-api-stub.mjs';

const source = readFileSync(new URL('../ops/assets/pane-ugc.js', import.meta.url), 'utf8');
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function fixture(items, respond = async () => ({})) {
  const dom = makeDom();
  function h(tag, props = {}, children = []) {
    const node = dom.element(tag);
    let text = '';
    Object.defineProperty(node, 'textContent', {
      get: () => text, set: value => {
        text = String(value);
        while (node.childNodes.length) node.removeChild(node.childNodes[0]);
      },
    });
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key === 'className' ? 'class' : key, value);
    }
    children.forEach(child => node.appendChild(child));
    node.click = () => { dom.window.downloads.push(node.getAttribute('href')); };
    return node;
  }
  const content = h('div', { id: 'content' });
  dom.root.appendChild(content);
  dom.doc.documentElement.lang = 'en';
  const calls = [];
  const toasts = [];
  dom.window.downloads = [];
  dom.window.URL = {
    createObjectURL: blob => { assert.ok(blob instanceof Blob); return 'blob:private-proof'; },
    revokeObjectURL: () => {},
  };
  dom.window.OpsPaneShell = {
    h, card: name => h('article', { className: name }), cardHead: title => h('h3', { text: title }),
    stateBlock: (_icon, title, detail) => h('p', { text: [title, ...detail].join(' ') }),
    failureMessage: error => error.message, toast: (_icon, title) => toasts.push(title),
  };
  dom.window.OpsSession = {
    hasRole: () => true,
    call: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/ops/moderation/reports') {
        return { data: { items: options.query.afterId === 0 ? items : [], nextCursor: options.query.afterId === 0 ? 25 : null } };
      }
      return respond(path, options);
    },
  };
  vm.runInNewContext(source, { window: dom.window, Promise, Date, Number, JSON, Array, Error });
  dom.window.OpsUgc.render(content);
  return { dom, content, calls, toasts };
}
const report = {
  id: 1, targetType: 'post', status: 'open', category: 'safety', note: 'Synthetic safe test fixture',
  actionDueAt: '2020-01-02T00:00:00Z', target: { caption: 'Synthetic training post' },
  notifications: [{ channel: 'teams', status: 'delivered' }, { channel: 'email', status: 'failed', failureReason: 'unconfigured' }],
};
function button(content, label) {
  return content.querySelectorAll('button').find(node => node.textContent === label);
}

test('backend-shaped chat evidence renders reported conversation messages as literal text without a direct preview', async () => {
  const chat = MODERATION_REPORTS.find(item => item.targetType === 'chat_message');
  assert.equal(chat.target.kind, 'chat_message', 'chat target follows the backend evidence envelope');
  assert.equal(Object.hasOwn(chat.target, 'body'), false, 'backend chat targets have no direct body');
  const messages = chat.target.evidence.contextSnapshot.messages;
  assert.ok(Array.isArray(messages) && messages.length >= 1, 'backend chat snapshot contains conversation messages');
  const { content } = fixture([chat]);
  await settle();
  const snapshot = content.querySelector('pre.ugc-preview');
  assert.deepEqual(JSON.parse(snapshot.textContent).messages, messages,
    'reported chat conversation messages remain literal text');
  assert.equal(snapshot.childNodes.length, 0, 'hostile chat messages create no child elements');
  assert.equal(snapshot.getAttribute('tabindex'), '0', 'long chat evidence is keyboard-scrollable');
  assert.equal(snapshot.getAttribute('role'), 'region', 'preserved evidence is a named scroll region');
  assert.equal(snapshot.getAttribute('aria-label'), 'Preserved report context', 'preserved evidence has an accessible name');
  assert.equal(content.querySelector('p.ugc-preview').textContent, '', 'chat evidence does not invent a content preview');
});

test('oldest-first private queue exposes overdue/unconfigured delivery, profile-safe actions, and cursor paging', async () => {
  const { content, calls } = fixture([report, { ...report, id: 2, targetType: 'profile', actionDueAt: 'invalid', notifications: [] }]);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.query)), { limit: 25, afterId: 0 });
  assert.match(allText(content), /Overdue/, 'missed 24h deadline is visible');
  assert.match(allText(content), /Not configured/, 'missing notification configuration never looks delivered');
  assert.match(allText(content), /No delivery record/, 'missing channel records are visible');
  assert.match(allText(content), /No deadline: review this report now/, 'invalid deadlines fail visibly');
  const profile = content.querySelectorAll('article')[1];
  assert.equal(button(profile, 'Remove content'), undefined, 'profile cannot falsely claim a remove action');
  assert.ok(button(profile, 'Remove access'), 'profile can eject the author');
  button(content, 'Load next reports').dispatch('click');
  await settle();
  assert.equal(calls.at(-1).options.query.afterId, 25, 'next page follows the server cursor');
  assert.equal(content.querySelectorAll('article').length, 0, 'next page removes the old page');
});

test('real action form requires a reason and explicit confirmation, fences duplicate actions, and waits for audited result', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { content, calls, toasts } = fixture([report], async () => pending);
  await settle();
  button(content, 'Remove content').dispatch('click');
  assert.equal(calls.length, 1, 'opening confirmation does not remove content');
  const form = content.querySelector('form');
  form.dispatch('submit');
  assert.equal(calls.length, 1, 'blank reason cannot send an action');
  assert.match(allText(form), /Enter a reason/);
  form.querySelector('textarea').value = ' Reviewed safe synthetic fixture ';
  form.dispatch('submit');
  assert.equal(calls.length, 2, 'explicit confirmation dispatches exactly once');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options.body)), { action: 'remove', reason: 'Reviewed safe synthetic fixture' });
  assert.equal(button(content, 'Refresh').disabled, true, 'refresh cannot discard an in-flight confirmation');
  assert.equal(content.querySelector('select').disabled, true, 'language cannot detach a pending form');
  button(content, 'Remove access').dispatch('click');
  form.dispatch('submit');
  assert.equal(calls.length, 2, 'another action cannot bypass the pending request');
  assert.equal(toasts.length, 0, 'pending action cannot claim an audit');
  finish({ data: { reportId: 1, action: 'remove', status: 'resolved', authorEjected: false } });
  await settle();
  assert.deepEqual(toasts, ['Decision recorded in the audit']);
  assert.equal(content.querySelectorAll('article').length, 0, 'confirmed disposition removes the queue row');
});

test('failed audit remains retryable; private evidence uses authenticated binary transport and never a public link', async () => {
  let mode = 'audit-error';
  const item = { ...report, target: { evidence: { snapshot: { kind: 'synthetic' }, media: [{ contentPath: '/api/ops/moderation/evidence/aaaa-bbbb/media/cccc-dddd' }] } } };
  const { content, calls, toasts, dom } = fixture([item], async (path, options) => {
    if (options.responseType === 'blob') return new Blob(['synthetic']);
    if (mode === 'audit-error') throw new Error('Audit transaction failed');
    return { data: { reportId: mode === 'mismatch' ? 99 : 1, action: 'dismiss', status: 'dismissed', authorEjected: false } };
  });
  await settle();
  button(content, 'Download private evidence').dispatch('click');
  await settle();
  assert.equal(calls.at(-1).options.responseType, 'blob', 'evidence travels through the authenticated session binary API');
  assert.deepEqual(dom.window.downloads, ['blob:private-proof'], 'download is a temporary private blob, not an API/public link');
  assert.equal(content.querySelectorAll('a').length, 0, 'no evidence link remains in the page');
  button(content, 'Dismiss report').dispatch('click');
  const form = content.querySelector('form');
  form.querySelector('textarea').value = 'No violation in synthetic fixture';
  form.dispatch('submit');
  await settle();
  assert.match(allText(form), /Audit transaction failed/, 'audit failure is visible');
  assert.equal(toasts.length, 0, 'failed audit never claims success');
  assert.equal(button(content, 'Confirm decision').disabled, false, 'failed decision can retry');
  mode = 'mismatch';
  form.dispatch('submit'); await settle();
  assert.equal(toasts.length, 0, 'mismatched audit response cannot claim success');
  assert.equal(content.querySelectorAll('article').length, 1, 'unconfirmed disposition keeps the queue row');
  mode = 'success';
  form.dispatch('submit'); await settle();
  assert.deepEqual(toasts, ['Decision recorded in the audit']);
});
