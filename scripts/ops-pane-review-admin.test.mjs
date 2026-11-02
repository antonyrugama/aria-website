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

test('review detail result classes are painted by the loaded pane stylesheet', () => {
  const css = readFileSync(CSS, 'utf8');
  assert.match(css, /\.review-detail\s*\{/, 'review detail result container has a loaded style rule');
  assert.match(css, /\.review-detail\s+\.evidence-meta-row\s*\{[^}]*display:\s*grid/s, 'review evidence metadata rows have a loaded style rule');
});

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
  rubric: { statement: 'Judge the rubric only.', grading: { method: 'qualified_human' }, authority: { domain: 'training' } },
  evidence: { outcomePreview: 'Answer text only.', evidenceRefs: ['evidence.demo.output'], comments: ['Evidence comment.'] },
  redactions: ['candidateIdentity', 'baselineIdentity', 'modelFamily', 'modelConfig'],
  labelCounts: { submitted: 0, disputes: 0, adjudications: 0 },
};

test('review pane lists answers as plain rows and hides ratings before independent submission', async () => {
  const calls = [];
  const { root, toasts } = loadPane((path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/api/ops/seval/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    if (path === '/api/ops/seval/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: false, otherLabelsVisible: false }, correction: { activeReviewId: null }, labels: [] } });
    }
    if (path === '/api/ops/seval/admin/reviews/labels') return Promise.resolve({ data: { record: { reviewId: 'review.1' } } });
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  assert.match(treeText(root), /Judge the rubric only\./, 'the row names what the answer is judged on');
  assert.match(treeText(root), /Training · Open · 0 ratings/, 'the row says who it is for, its state and how many ratings it has');
  assert.doesNotMatch(treeText(root), /blind/i, 'the list does not use the word blinded');
  assert.doesNotMatch(treeText(root), /evidence\.demo\.output|aaaaaaaa|candidateIdentity/, 'the row carries no digests, evidence references or redactions');
  assert.doesNotMatch(treeText(root), /gpt|claude|candidate model|baseline model/i, 'queue must not reveal model or treatment identity');

  const button = find(root, node => node.tag === 'button' && /^Review$/.test(node.textContent));
  assert.ok(button, 'queue row must expose a review action');
  assert.equal(button.getAttribute('aria-label'), 'Review: Judge the rubric only.', 'the action is named for its row');
  await button.dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Hidden until you submit yours/, 'other ratings remain hidden before own rating');
  assert.match(treeText(root), /evidence\.demo\.output/, 'authorized evidence references render with the answer');
  assert.match(treeText(root), /qualified_human/, 'grading metadata renders with the rubric');
  assert.match(treeText(root), new RegExp(`Outcome digest\\s+${'a'.repeat(64)}(?![0-9a-f])`), 'the opened detail names the exact outcome version being rated, in full');
  assert.match(treeText(root), new RegExp(`Criterion digest\\s+${'b'.repeat(64)}(?![0-9a-f])`), 'the opened detail names the exact criterion version it is rated against, in full');
  assert.doesNotMatch(treeText(root), /blind/i, 'the detail does not use the word blinded');

  const rationale = find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale');
  const comments = find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'comments');
  assert.equal(rationale.getAttribute('id'), 'review-label-rationale', 'rationale control has a programmatic label target');
  assert.equal(find(root, node => node.tag === 'label' && node.getAttribute('for') === 'review-label-rationale')?.textContent, 'Rationale');
  rationale.value = 'The answer satisfies the rubric.';
  comments.value = 'Independent human comment.';
  const form = find(root, node => node.tag === 'form');
  await form.dispatch('submit');
  await Promise.resolve();
  const submitted = calls.find(call => call.path === '/api/ops/seval/admin/reviews/labels');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.opts.body)), {
    reviewItemId: 'review-item.demo-training',
    outcomeDigest: 'a'.repeat(64),
    criterionDigest: 'b'.repeat(64),
    label: 'pass',
    uncertainty: 'low',
    domain: 'training',
    rationale: 'The answer satisfies the rubric.',
    comments: 'Independent human comment.',
    supersedesReviewId: null,
  });
  assert.deepEqual(toasts, ['Rating recorded']);
});

test('review detail says a digest was not reported rather than leaving it blank', async () => {
  const { root } = loadPane((path) => {
    if (path === '/api/ops/seval/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    return Promise.resolve({ data: { ...queueItem, outcomeDigest: undefined, criterionDigest: '', reviewerState: { submittedOwnLabel: false, otherLabelsVisible: false }, correction: { activeReviewId: null }, labels: [] } });
  });
  await Promise.resolve();
  await find(root, node => node.tag === 'button' && /^Review$/.test(node.textContent)).dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Outcome digest\s+Not reported/, 'a detail without an outcome digest says so');
  assert.match(treeText(root), /Criterion digest\s+Not reported/, 'a detail without a criterion digest says so');
});

test('review pane sends the active review id for corrections', async () => {
  const calls = [];
  const { root } = loadPane((path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/api/ops/seval/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    if (path === '/api/ops/seval/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: true, otherLabelsVisible: true }, correction: { activeReviewId: 'review.current' }, labels: [] } });
    }
    if (path === '/api/ops/seval/admin/reviews/labels') return Promise.resolve({ data: { record: { reviewId: 'review.corrected' } } });
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  await find(root, node => node.tag === 'button' && /^Review$/.test(node.textContent)).dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Append correction/, 'existing own labels advertise corrections');
  find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale').value = 'Correction rationale.';
  find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'comments').value = 'Correction comment.';
  await find(root, node => node.tag === 'form').dispatch('submit');
  await Promise.resolve();
  const submitted = calls.find(call => call.path === '/api/ops/seval/admin/reviews/labels');
  assert.equal(submitted.opts.body.supersedesReviewId, 'review.current', 'correction submits the active review id');
});

test('review pane adjudicates disputed labels with exact digest bindings', async () => {
  const calls = [];
  const visibleLabels = [
    { reviewId: 'review.pass', reviewerRef: 'operator@stadioralabs.com', label: 'pass', uncertainty: 'low', rationale: 'Grounded pass rationale.', comments: 'Pass evidence comment.' },
    { reviewId: 'review.fail', reviewerRef: 'second@stadioralabs.com', label: 'fail', uncertainty: 'high', rationale: 'Grounded fail rationale.', comments: 'Fail evidence comment.' },
  ];
  const { root, toasts } = loadPane((path, opts = {}) => {
    calls.push({ path, opts });
    if (path === '/api/ops/seval/admin/reviews/queue') return Promise.resolve({ data: { items: [queueItem] } });
    if (path === '/api/ops/seval/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: false, otherLabelsVisible: true }, correction: { activeReviewId: null }, adjudication: { visible: true, eligible: true, reason: 'ready' }, labels: visibleLabels } });
    }
    if (path === '/api/ops/seval/admin/reviews/adjudications') return Promise.resolve({ data: { record: { adjudicationId: 'adjudication.1' } } });
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  const button = find(root, node => node.tag === 'button' && /^Review$/.test(node.textContent));
  await button.dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Settle the disagreement/, 'visible disputed labels must expose adjudication');
  assert.doesNotMatch(treeText(root), /Submit rating/, 'adjudicators who have seen labels cannot start an independent rating');
  assert.match(treeText(root), /you cannot add your own/, 'adjudication mode explains why an independent rating is unavailable');
  assert.match(treeText(root), /Grounded pass rationale/, 'adjudication view renders first label rationale');
  assert.match(treeText(root), /Grounded fail rationale/, 'adjudication view renders second label rationale');

  const form = find(root, node => node.tag === 'form' && /review-adjudication/.test(node.className));
  const decision = find(form, node => node.tag === 'select' && node.getAttribute('name') === 'decision');
  const rationale = find(form, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale');
  assert.equal(decision.getAttribute('id'), 'review-adjudication-decision', 'decision control has a programmatic label target');
  assert.equal(find(form, node => node.tag === 'label' && node.getAttribute('for') === 'review-adjudication-decision')?.textContent, 'Decision');
  decision.value = 'fail';
  rationale.value = 'The failing label cites the gating rubric.';
  await form.dispatch('submit');
  await Promise.resolve();
  const submitted = calls.find(call => call.path === '/api/ops/seval/admin/reviews/adjudications');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.opts.body)), {
    reviewItemId: 'review-item.demo-training',
    outcomeDigest: 'a'.repeat(64),
    criterionDigest: 'b'.repeat(64),
    reviewIds: ['review.pass', 'review.fail'],
    decision: 'fail',
    domain: 'training',
    rationale: 'The failing label cites the gating rubric.',
  });
  assert.deepEqual(toasts, ['Decision recorded']);
});

test('review pane retries nonempty partial queues without clearing the active draft', async () => {
  let queueReads = 0;
  const { root } = loadPane((path) => {
    if (path === '/api/ops/seval/admin/reviews/queue') {
      queueReads += 1;
      return Promise.resolve({
        data: {
          items: [queueItem],
          partial: queueReads === 1,
          omissions: queueReads === 1 ? ['review source timed out'] : [],
        },
      });
    }
    if (path === '/api/ops/seval/admin/reviews/items/review-item.demo-training') {
      return Promise.resolve({ data: { ...queueItem, reviewerState: { submittedOwnLabel: false, otherLabelsVisible: false }, correction: { activeReviewId: null }, labels: [] } });
    }
    throw new Error(`unexpected path ${path}`);
  });
  await Promise.resolve();
  assert.match(treeText(root), /Some reviews could not be read/, 'nonempty partial queues disclose their partial state');
  const button = find(root, node => node.tag === 'button' && /^Review$/.test(node.textContent));
  await button.dispatch('click');
  await Promise.resolve();
  const rationale = find(root, node => node.tag === 'textarea' && node.getAttribute('name') === 'rationale');
  rationale.value = 'Draft rationale must survive a queue retry.';
  await find(root, node => node.tag === 'button' && /^Reload$/.test(node.textContent)).dispatch('click');
  await Promise.resolve();
  assert.equal(queueReads, 2, 'partial retry reloads the queue data');
  assert.equal(rationale.value, 'Draft rationale must survive a queue retry.', 'partial retry preserves the active review draft');
  assert.match(treeText(root), /Answer to rate/, 'partial retry keeps the active detail mounted');
  assert.doesNotMatch(treeText(root), /Some reviews could not be read/, 'partial retry clears stale partial metadata after a complete queue response');
});

test('review pane renders partial-failure recovery state without browser rendering', async () => {
  let attempts = 0;
  const { root } = loadPane(() => {
    attempts += 1;
    return attempts === 1
      ? Promise.resolve({ data: { items: [], partial: true, omissions: ['review source timed out'] } })
      : Promise.reject(new Error('network unavailable'));
  });
  await Promise.resolve();
  assert.match(treeText(root), /Review list not fully read/, 'partial empty queues are not described as genuinely empty');
  assert.match(treeText(root), /review source timed out/, 'partial queue omissions are visible');
  await find(root, node => node.tag === 'button' && /^Reload$/.test(node.textContent)).dispatch('click');
  await Promise.resolve();
  assert.match(treeText(root), /Reviews could not be read/, 'queue read failures need a visible recovery state');
  assert.match(treeText(root), /network unavailable/, 'failure detail should be visible near the failed state');
  assert.ok(find(root, node => node.tag === 'button' && /^Try again$/.test(node.textContent)), 'total failures offer retry');
});

test('review pane says an empty queue is empty', async () => {
  const { root } = loadPane(() => Promise.resolve({ data: { items: [], partial: false, omissions: [] } }));
  await Promise.resolve();
  assert.match(treeText(root), /Nothing to review/, 'a complete empty queue reads as nothing to review');
  assert.doesNotMatch(treeText(root), /not fully read/, 'a complete empty queue is not called incomplete');
});

/* What the controls measure (44px tall, 14px text) is asserted in a browser by
   scripts/ops-review-controls-rendered.test.mjs. Searching this stylesheet for
   a `min-height: 44px` or for small font sizes could not bind to the element:
   it passed while the Review action's own rule fell to 20px and while the
   shared .btn-sm, which sets the action's text size, fell to 10px. */
test('review pane markup is mobile-first and CSP-safe, with a narrow layout', () => {
  const html = readFileSync(HTML, 'utf8');
  const css = readFileSync(CSS, 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, 'review page must be mobile-first');
  assert.doesNotMatch(html, /style="/i, 'review page must not rely on inline styles');
  assert.match(css, /@media \(max-width: 760px\)/, 'review CSS must include a narrow-width breakpoint');
  assert.match(css, /\.review-form \{ grid-template-columns: 1fr; \}/, 'narrow layout must collapse the form to one column');
});
