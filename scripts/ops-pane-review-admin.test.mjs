import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = new URL('../ops/assets/pane-review-admin.js', import.meta.url);
const CSS = new URL('../ops/assets/pane-review-admin.css', import.meta.url);
const HTML = new URL('../ops/review.html', import.meta.url);
const WRAPPER_OPEN = '(function (global) {';
const WRAPPER_CLOSE = '})(window);';

function paneBody() {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf(WRAPPER_OPEN);
  const end = source.lastIndexOf(WRAPPER_CLOSE);
  assert.ok(start !== -1, 'pane-review-admin.js wrapper opening is missing');
  assert.ok(end > start, 'pane-review-admin.js wrapper closing is missing');
  return source.slice(start + WRAPPER_OPEN.length, end);
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
    disabled: false,
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'value') this.value = String(value); },
    getAttribute(name) { return this.attributes[name] || null; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    dispatch(name, event = {}) {
      assert.equal(typeof this.listeners[name], 'function', `${tag} ${name} listener is missing`);
      return this.listeners[name]({ preventDefault() {}, ...event });
    },
  };
  Object.keys(opts).forEach((key) => {
    if (key !== 'className' && key !== 'text') node.setAttribute(key, opts[key]);
  });
  Object.defineProperty(node, 'textContent', {
    get() { return text; },
    set(value) { text = String(value); if (text === '') this.children = []; },
  });
  children.forEach(child => node.appendChild(child));
  if (tag === 'select' && children[0]) node.value = children[0].value || children[0].getAttribute('value') || '';
  return node;
}

function treeText(node) {
  return [node.textContent || '', ...(node.children || []).map(treeText)].join(' ');
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

function loadPane(call) {
  let renderer = null;
  const toasts = [];
  const window = {
    OpsPaneShell: {
      h: element,
      definePane(id, render) { assert.equal(id, 'review'); renderer = render; },
      card: className => element('div', { className: `card${className ? ` ${className}` : ''}` }),
      cardHead: (title, note, end = []) => element('div', { className: 'card-head' }, [
        element('h3', { className: 'card-title', text: title }),
        Array.isArray(note) ? element('p', { className: 'card-note', text: note.filter(Boolean).join(' · ') }) : (note ? element('p', { className: 'card-note', text: note }) : null),
        ...end,
      ].filter(Boolean)),
      band: (title, note) => element('section', { className: 'band' }, [element('h2', { text: title }), element('p', { text: note })]),
      stateBlock: (_icon, title, lines = []) => element('div', { className: 'state-block' }, [element('h2', { text: title }), ...lines.map(line => element('p', { text: line }))]),
      toast: (_icon, text) => { toasts.push(text); },
      failureMessage: error => String(error && error.message || error),
    },
    OpsSession: { call },
  };
  vm.runInContext(paneBody(), vm.createContext({ window, global: window, console, setTimeout }), { filename: 'ops/assets/pane-review-admin.js' });
  assert.equal(typeof renderer, 'function', 'review pane renderer must register');
  const root = element('main');
  renderer(root, {});
  return { root, toasts };
}

const queueItem = {
  reviewItemId: 'review-item.demo-training',
  outcomeDigest: 'a'.repeat(64),
  criterionDigest: 'b'.repeat(64),
  resultDigest: 'c'.repeat(64),
  status: 'open',
  rubric: { statement: 'Judge the rubric only.', authority: { domain: 'training' } },
  evidence: { outcomePreview: 'Blinded output only.', comments: [] },
  redactions: ['candidateIdentity', 'baselineIdentity', 'modelFamily', 'modelConfig'],
  labelCounts: { submitted: 0, disputes: 0, adjudications: 0 },
};

test('review pane reads a blinded queue and hides labels before independent submission', async () => {
  const calls = [];
  const { root, toasts } = loadPane((path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/api/ops/ciel/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    if (path === '/api/ops/ciel/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: false, otherLabelsVisible: false }, labels: [] } });
    }
    if (path === '/api/ops/ciel/admin/reviews/labels') return Promise.resolve({ data: { record: { reviewId: 'review.1' } } });
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  assert.match(treeText(root), /Blinded review queue/, 'review pane must announce blinded queue');
  assert.doesNotMatch(treeText(root), /gpt|claude|candidate model|baseline model/i, 'queue must not reveal model or treatment identity');

  const button = find(root, node => node.tag === 'button' && /Review blinded output/.test(node.textContent));
  assert.ok(button, 'queue card must expose a review action');
  await button.dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Hidden until you submit your own label/, 'other labels remain hidden before own label');

  const rationale = find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale');
  const comments = find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'comments');
  rationale.value = 'The blinded output satisfies the rubric.';
  comments.value = 'Independent human comment.';
  const form = find(root, node => node.tag === 'form');
  await form.dispatch('submit');
  await Promise.resolve();
  const submitted = calls.find(call => call.path === '/api/ops/ciel/admin/reviews/labels');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.opts.body)), {
    reviewItemId: 'review-item.demo-training',
    outcomeDigest: 'a'.repeat(64),
    criterionDigest: 'b'.repeat(64),
    label: 'pass',
    uncertainty: 'low',
    authority: 'expert_reviewed',
    domain: 'training',
    rationale: 'The blinded output satisfies the rubric.',
    comments: 'Independent human comment.',
  });
  assert.deepEqual(toasts, ['Review label recorded']);
});

test('review pane adjudicates disputed labels with exact digest bindings', async () => {
  const calls = [];
  const visibleLabels = [
    { reviewId: 'review.pass', reviewerRef: 'operator@stadioralabs.com', label: 'pass' },
    { reviewId: 'review.fail', reviewerRef: 'second@stadioralabs.com', label: 'fail' },
  ];
  const { root, toasts } = loadPane((path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/api/ops/ciel/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    if (path === '/api/ops/ciel/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: true, otherLabelsVisible: true }, labels: visibleLabels } });
    }
    if (path === '/api/ops/ciel/admin/reviews/adjudications') return Promise.resolve({ data: { record: { adjudicationId: 'adjudication.1' } } });
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  const button = find(root, node => node.tag === 'button' && /Review blinded output/.test(node.textContent));
  await button.dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Adjudicate disputed labels/, 'visible disputed labels must expose adjudication');

  const form = find(root, node => node.tag === 'form' && /review-adjudication/.test(node.className));
  const decision = find(form, node => node.tag === 'select' && node.getAttribute('name') === 'decision');
  const rationale = find(form, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale');
  decision.value = 'fail';
  rationale.value = 'The failing label cites the gating rubric.';
  await form.dispatch('submit');
  await Promise.resolve();
  const submitted = calls.find(call => call.path === '/api/ops/ciel/admin/reviews/adjudications');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.opts.body)), {
    reviewItemId: 'review-item.demo-training',
    outcomeDigest: 'a'.repeat(64),
    criterionDigest: 'b'.repeat(64),
    reviewIds: ['review.pass', 'review.fail'],
    decision: 'fail',
    domain: 'training',
    rationale: 'The failing label cites the gating rubric.',
  });
  assert.deepEqual(toasts, ['Adjudication recorded']);
});

test('review pane renders partial-failure recovery state without browser rendering', async () => {
  const { root } = loadPane(() => Promise.reject(new Error('network unavailable')));
  await Promise.resolve();
  assert.match(treeText(root), /Could not load review queue/, 'queue read failures need a visible recovery state');
  assert.match(treeText(root), /network unavailable/, 'failure detail should be visible near the failed state');
});

test('review pane markup and CSS are responsive and CSP-safe', () => {
  const html = readFileSync(HTML, 'utf8');
  const css = readFileSync(CSS, 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'review page must be mobile-first');
  assert.doesNotMatch(html, /style="/i, 'review page must not rely on inline styles');
  assert.match(css, /@media \(max-width: 760px\)/, 'review CSS must include a narrow-width breakpoint');
  assert.match(css, /\.review-toolbar, \.review-list, \.review-form \{ grid-template-columns: 1fr; \}/, 'narrow layout must collapse dense grids to one column');
  assert.match(css, /min-height: 44px/, 'review controls must meet minimum touch target height');
});
