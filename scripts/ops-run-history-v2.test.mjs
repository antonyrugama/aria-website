/* Unit tests for ops/assets/pane-run-history-v2.js — What happened, on the v2
   design system, now that GET /api/ops/runs exists behind it.

   This file was rewritten wholesale for Stadiora/Aria#5563. It previously
   asserted the ALERTING record, because that was the only record any route
   served and the pane drew it as a stand-in for the runs. The pane now draws
   the runs, so every assertion about problems, rules and watching coverage
   went with them: a test that still passed against a pane that no longer
   reads /api/ops/alerts/problems would be passing for a reason nobody
   intended.

   What is worth testing here is everything the pane refuses to do, because
   almost every rule in that file's docblock is a rule about NOT drawing
   something, and none of them is visible to a screenshot or to a headless
   overflow check:

     - the three empties are three different sentences, and the one that means
       "nothing was ever recorded" draws no figure at all;
     - a figure nobody measured renders words and never a numeral, and every
       median carries the count it was taken over;
     - the operator's selection reaches the read rather than the drawing;
     - the narrowing controls offer only what the window actually holds, and
       say so rather than silently resetting when it stops holding it;
     - nothing starts a timer, so nothing is left running when the operator
       leaves;
     - a failed detail read degrades the pane rather than emptying it;
     - run content is hidden at every role, the owner included, with no control
       that could never succeed and no value node in the markup at all;
     - anything address-shaped is masked before it reaches the DOM.

   Every test here has a published mutation in the pull request: the exact
   file, the exact line, and the exact edit whose presence makes that test
   fail. A test with no such line is a test that pins nothing.

   The page-shape tests at the bottom read ops/run-history.html as text rather
   than booting it. Their mutation is the page itself. */
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
const JOB_ACTIONS_SRC = read('assets/job-actions-v2.js');
const PANE_SRC = read('assets/pane-run-history-v2.js');
const SETTINGS_SRC = read('assets/settings.js');
const PAGE_SRC = read('run-history.html');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/* Stated here rather than imported from the shell, so the expectation is an
   independent contract instead of a restatement of the formatter under test. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
  'Nov', 'Dec'];
const DAY = 24 * HOUR;

/* Timestamps are built relative to now, because the window under test is
   relative to now. A fixed date in a fixture ages into a different test. */
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') {
      depth -= 1;
      if (!depth) return i;
    }
  }
  return -1;
}

function mediaApplies(query, viewportWidth) {
  const min = query.match(/min-width:\s*(\d+)px/);
  const max = query.match(/max-width:\s*(\d+)px/);
  if (min && viewportWidth < Number(min[1])) return false;
  if (max && viewportWidth > Number(max[1])) return false;
  return true;
}

function cssRules(css, viewportWidth = 1280) {
  const rules = [];
  let order = 0;

  function collect(src) {
    let at = 0;
    while (at < src.length) {
      while (/\s/.test(src[at] || '')) at += 1;
      if (at >= src.length) break;

      if (src.startsWith('@media', at)) {
        const open = src.indexOf('{', at);
        const close = open < 0 ? -1 : matchingBrace(src, open);
        if (open < 0 || close < 0) break;
        const query = src.slice(at + '@media'.length, open).trim();
        if (mediaApplies(query, viewportWidth)) collect(src.slice(open + 1, close));
        at = close + 1;
        continue;
      }

      if (src[at] === '@') {
        const semi = src.indexOf(';', at);
        const open = src.indexOf('{', at);
        if (open >= 0 && (semi < 0 || open < semi)) {
          const close = matchingBrace(src, open);
          at = close < 0 ? src.length : close + 1;
        } else {
          at = semi < 0 ? src.length : semi + 1;
        }
        continue;
      }

      const open = src.indexOf('{', at);
      if (open < 0) break;
      const close = matchingBrace(src, open);
      if (close < 0) break;
      const selector = src.slice(at, open).trim();
      const declarations = src.slice(open + 1, close).split(';').map((part) => {
        const colon = part.indexOf(':');
        if (colon < 0) return null;
        const prop = part.slice(0, colon).trim();
        const raw = part.slice(colon + 1).trim();
        return {
          prop,
          value: raw.replace(/\s*!important\s*$/, '').trim(),
          important: /\s!important\s*$/.test(raw),
        };
      }).filter(Boolean);
      rules.push({ selector, declarations, order: order += 1 });
      at = close + 1;
    }
  }

  collect(withoutComments(css));
  return rules;
}

function selectorMatches(selector, el) {
  return selector.split(',').some((raw) => {
    let part = raw.trim();
    if (!part || /[\s>+~]/.test(part)) return false;
    if (part.includes(':focus-visible')) {
      if (!el.focusVisible) return false;
      part = part.replace(':focus-visible', '');
    }
    if (part.includes('[hidden]') && !el.hidden) return false;
    part = part.replace('[hidden]', '');

    const classes = [...part.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    if (classes.some((name) => !el.classes.includes(name))) return false;
    part = part.replace(/\.[A-Za-z0-9_-]+/g, '').trim();
    return part === '' || part.toLowerCase() === el.tag;
  });
}

function cssValue(css, el, prop, viewportWidth = 1280) {
  let winner = null;
  for (const rule of cssRules(css, viewportWidth)) {
    if (!selectorMatches(rule.selector, el)) continue;
    for (const declaration of rule.declarations) {
      if (declaration.prop !== prop) continue;
      if (!winner || Number(declaration.important) > Number(winner.important) ||
          declaration.important === winner.important && rule.order > winner.order) {
        winner = { ...declaration, order: rule.order };
      }
    }
  }
  return winner ? winner.value : null;
}

/* ------------------------------------------------------------- fixtures */

/* One window answer, whole. Every test below starts here and changes one
   thing, because the rules under test are rules about a single difference.

   Two deliberate properties of this fixture, both of which a mutation would
   otherwise walk through unseen:

     completed (7) and failed (3) differ, and neither equals runs (11), so a
     tile that read the wrong count cannot coincide with the right one;

     durationMeasured (9) differs from runs (11), so "measured on 9 of 11" is
     a sentence a mutation can break, rather than one that happens to be true
     whichever field it reads. */
function windowAnswer(over) {
  const base = {
    window: {
      range: '7d',
      startAt: at(7 * DAY),
      endExclusiveAt: at(0),
    },
    selection: { type: null, outcome: null, limit: 50 },
    coverage: {
      state: 'ready',
      recordingSince: at(30 * DAY),
      lastRecordedAt: at(3 * MINUTE),
      coversWindow: true,
    },
    summary: {
      runs: 11,
      completed: 7,
      failed: 3,
      canceled: 1,
      failureReasons: 2,
      unfinished: 2,
      duration: { p50Ms: 8400, measured: 9, total: 11 },
      queued: { p50Ms: 1200, measured: 10, total: 11 },
    },
    facets: {
      types: [
        { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true, runs: 6 },
        { value: 'program_generation', label: 'Training program', labelled: true, runs: 5 },
      ],
      outcomes: [
        { value: 'completed', label: 'Worked', runs: 7 },
        { value: 'failed', label: 'Failed', runs: 3 },
        { value: 'canceled', label: 'Cancelled', runs: 1 },
      ],
    },
    failures: [
      {
        failureCode: 'model_timeout',
        runs: 2,
        retryable: true,
        firstSeenAt: at(2 * DAY),
        lastSeenAt: at(4 * HOUR),
        byType: [
          {
            type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true },
            runs: 2,
          },
        ],
      },
      {
        failureCode: null,
        runs: 1,
        retryable: null,
        firstSeenAt: at(DAY),
        lastSeenAt: at(DAY),
        byType: [
          {
            type: { value: 'program_generation', label: 'Training program', labelled: true },
            runs: 1,
          },
        ],
      },
    ],
    runs: [
      runRow(),
      runRow({
        jobId: '22222222-2222-4222-8222-222222222222',
        outcome: 'failed',
        outcomeLabel: 'Failed',
        failureCode: 'model_timeout',
        retryable: true,
        durationMs: 61_000,
        finishedAt: at(4 * HOUR),
      }),
    ],
    truncated: false,
  };
  return over ? over(base) ?? base : base;
}

function runRow(over) {
  return Object.assign({
    jobId: '11111111-1111-4111-8111-111111111111',
    type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true },
    outcome: 'completed',
    outcomeLabel: 'Worked',
    failureCode: null,
    retryable: null,
    modelUsed: 'gpt-5-mini',
    queuedMs: 900,
    durationMs: 8400,
    finishedAt: at(2 * HOUR),
  }, over || {});
}

function detailAnswer(over) {
  const base = {
    window: { range: '7d', startAt: at(7 * DAY), endExclusiveAt: at(0) },
    run: {
      jobId: '22222222-2222-4222-8222-222222222222',
      type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true },
      outcome: 'failed',
      outcomeLabel: 'Failed',
      startedAt: at(4 * HOUR + 2 * MINUTE),
      finishedAt: at(4 * HOUR),
      queuedMs: 1500,
      durationMs: 61_000,
      failureCode: 'model_timeout',
      retryable: true,
      modelUsed: 'gpt-5-mini',
      attempts: 2,
    },
    stages: [
      {
        status: 'queued', label: 'Queued', occurredAt: at(4 * HOUR + 3 * MINUTE),
        queuedMs: null, durationMs: null, failureCode: null, retryable: null, modelUsed: null,
      },
      {
        status: 'running', label: 'Running', occurredAt: at(4 * HOUR + 2 * MINUTE),
        queuedMs: 1500, durationMs: null, failureCode: null, retryable: null,
        modelUsed: 'gpt-5-mini',
      },
      {
        status: 'failed', label: 'Failed', occurredAt: at(4 * HOUR),
        queuedMs: null, durationMs: 61_000, failureCode: 'model_timeout', retryable: true,
        modelUsed: 'gpt-5-mini',
      },
    ],
    stagesTruncated: false,
    shared: {
      failureCode: 'model_timeout',
      runs: 4,
      accounts: 3,
      runsWithoutAccount: 1,
      firstSeenAt: at(2 * DAY),
      lastSeenAt: at(4 * HOUR),
      byType: [
        { type: { value: 'nutrition_plan', label: 'Nutrition plan', labelled: true }, runs: 3, accounts: 2 },
        { type: { value: 'program_generation', label: 'Training program', labelled: true }, runs: 1, accounts: 1 },
      ],
      isolated: false,
      countIncludesThisRun: true,
    },
  };
  return over ? over(base) ?? base : base;
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'history');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/run-history.html loads it: registry, aria.js, the
   bootstrap, then the pane module. assets/alerts-model.js is deliberately not
   in this list, and neither is it in the page any more. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answers = {
    '/api/ops/runs': opts.runs === undefined ? windowAnswer() : opts.runs,
  };
  if (opts.detail !== undefined) {
    answers['/api/ops/runs/' + (opts.detailFor || '22222222-2222-4222-8222-222222222222')] =
      opts.detail;
  }

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/run-history.html' + (opts.query || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  const role = opts.role || 'owner';
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query, method: o && o.method, body: o && o.body });
      if (o && o.method === 'POST') {
        if (/^\/api\/ops\/runs\/[^/]+\/reveal$/.test(endpoint)) {
          const answer = opts.revealResponses && opts.revealResponses.shift
            ? opts.revealResponses.shift()
            : opts.revealResponse;
          if (answer instanceof Error) {
            if (answer.code === 'ops_reauth_required' && !opts.skipPromptReauth) {
              return dom.window.OpsSession.promptReauth(answer.maxAgeSeconds).then((confirmed) => {
                if (!confirmed) return Promise.reject(answer);
                calls.push({ endpoint, query: o && o.query, method: o && o.method, body: o && o.body });
                const retry = opts.revealResponses && opts.revealResponses.shift
                  ? opts.revealResponses.shift()
                  : opts.revealResponse;
                if (retry instanceof Error) return Promise.reject(retry);
                return Promise.resolve({ data: retry });
              });
            }
            return Promise.reject(answer);
          }
          if (answer === undefined) return Promise.reject(new Error('no reveal stub for ' + endpoint));
          if (answer && typeof answer.then === 'function') {
            return answer.then((data) => ({ data }));
          }
          return Promise.resolve({ data: answer });
        }
        const action = opts.actionResponses && opts.actionResponses[endpoint];
        if (action instanceof Error) return Promise.reject(action);
        if (action === undefined) return Promise.reject(new Error('no action stub for ' + endpoint));
        return Promise.resolve({ data: action });
      }
      /* An answer may be a function of the query rather than a fixed payload.
         Keying answers by path alone made a whole class of state unreachable
         from a test: narrowing re-reads the same path, so a narrowed read
         always came back with the populated window and no test could ever
         arrive at the empty state by the route an operator arrives at it.
         Review of PR #117 found the pane dropping keyboard focus on exactly
         that path, unreachable by every focus test in this file. */
      let answer = answers[endpoint];
      if (typeof answer === 'function') answer = answer((o && o.query) || {});
      /* A thenable answer IS the call: it is handed back unwrapped so a test
         can hold a read open and release it later, which is the only way to
         put two reads in flight at once. */
      if (answer && typeof answer.then === 'function') return answer;
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    promptReauth: () => {
      calls.push({ endpoint: '/api/ops/auth/reauth', method: 'PROMPT' });
      return Promise.resolve(true);
    },
    role: () => role,
    hasRole: (roles) => (roles || []).indexOf(role) !== -1,
    daysLeft: () => 12,
  };

  /* The harness has no setInterval, so a pane that started one would throw
     rather than fail an assertion. Supplying a counting one turns "this pane
     starts no timer" into a fact a test can read, which is the whole of the
     pane's answer to what stops it when the operator leaves. */
  const timers = { intervals: 0, cleared: 0, timeouts: 0, frames: 0 };
  dom.window.setInterval = () => { timers.intervals += 1; return 77; };
  dom.window.clearInterval = () => { timers.cleared += 1; };

  /* setTimeout and requestAnimationFrame count too, and they are wrapped
     rather than replaced, because the harness and the shell both use the real
     ones. Review of PR #117 proved the point: a one-line
     `setTimeout(function () { load(); }, 30000)` reinstates a background poll
     and the interval counter alone cannot see it. A self-rescheduling timeout
     is the ordinary way to write a poll, so counting only intervals reads a
     narrower fact than the test's name claims. */
  const realTimeout = dom.window.setTimeout;
  dom.window.setTimeout = function () {
    timers.timeouts += 1;
    return realTimeout.apply(this, arguments);
  };
  const realFrame = dom.window.requestAnimationFrame;
  if (realFrame) {
    dom.window.requestAnimationFrame = function () {
      timers.frames += 1;
      return realFrame.apply(this, arguments);
    };
  }

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(JOB_ACTIONS_SRC, dom.window, { filename: 'job-actions-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-run-history-v2.js' });

  /* Which of the four states the pane asked for, in order. The live and
     degraded panels are the same element — aria.css shows one element for both
     words — so the DOM alone cannot tell a degraded pane from a whole one, and
     that difference is the point of two of the tests below. The shell reaches
     aria.js through this property at call time, so recording it here records
     what the pane actually asked for. */
  const applied = [];
  const realApply = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    applied.push(String(state));
    return realApply.apply(this, arguments);
  };

  await settle();

  return { ...dom, body, calls, answers, applied, timers, content: dom.doc.getElementById('content') };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
}

/* The panel the operator can see. The loading, empty and live panels are
   siblings and aria.css hides the ones that are not current, so reading the
   whole region would read text nobody is looking at. */
function panelFor(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0];
}

const livePanel = (dom) => panelFor(dom, 'live');
const emptyPanel = (dom) => panelFor(dom, 'empty');
const liveText = (dom) => allText(livePanel(dom));
const emptyText = (dom) => allText(emptyPanel(dom));

/* The one panel the pane last asked for, whichever it is. A test that reads
   the live panel when the pane went empty reads an empty string and passes
   every doesNotMatch in this file. */
function shownText(dom) {
  const state = stateOf(dom);
  return state === 'empty' ? emptyText(dom) : liveText(dom);
}

test('run-history table scrollers are named keyboard regions only while they overflow', async () => {
  const dom = await boot({});
  const wraps = livePanel(dom).querySelectorAll('.tbl-wrap');
  assert.equal(wraps.length, 2, 'What happened should draw exactly two sideways table scrollers');

  assert.deepEqual(wraps.map((wrap) => ({
    tabindex: wrap.getAttribute('tabindex'),
    role: wrap.getAttribute('role'),
    label: wrap.getAttribute('aria-label'),
  })), [
    { tabindex: null, role: null, label: null },
    { tabindex: null, role: null, label: null },
  ], 'a table that does not overflow should not add a dead tab stop');

  wraps[0].clientWidth = 320;
  wraps[0].scrollWidth = 640;
  wraps[1].clientWidth = 320;
  wraps[1].scrollWidth = 640;
  dom.window.dispatchEvent({ type: 'resize' });

  assert.deepEqual(wraps.map((wrap) => ({
    tabindex: wrap.getAttribute('tabindex'),
    role: wrap.getAttribute('role'),
    label: wrap.getAttribute('aria-label'),
  })), [
    { tabindex: '0', role: 'region', label: 'Why things failed' },
    { tabindex: '0', role: 'region', label: 'The runs' },
  ]);

  wraps[0].scrollWidth = 320;
  wraps[1].scrollWidth = 320;
  dom.window.dispatchEvent({ type: 'resize' });

  assert.deepEqual(wraps.map((wrap) => ({
    tabindex: wrap.getAttribute('tabindex'),
    role: wrap.getAttribute('role'),
    label: wrap.getAttribute('aria-label'),
  })), [
    { tabindex: null, role: null, label: null },
    { tabindex: null, role: null, label: null },
  ], 'a scroller that stops clipping should remove its focusable region attributes');
});

test('run-history scrollers keep their focus ring inside the table box', () => {
  const css = read('assets/pane-run-history-v2.css');
  assert.equal(cssValue(css, {
    tag: 'div',
    classes: ['tbl-wrap'],
    focusVisible: true,
  }, 'outline-offset'), '-2px');
});

test('settings Load more stays hidden when the shared button display rule also matches it', () => {
  assert.match(SETTINGS_SRC, /className: 'btn btn-sm'[\s\S]+text: 'Load more'/);
  const css = read('assets/aria.css');
  assert.equal(cssValue(css, {
    tag: 'button',
    classes: ['btn', 'btn-sm'],
    hidden: true,
  }, 'display'), 'none');
});

function retryableRunWindow(failedJobId) {
  return windowAnswer((base) => {
    base.runs = [
      runRow({
        jobId: failedJobId,
        outcome: 'failed',
        outcomeLabel: 'Failed',
        failureCode: 'model_timeout',
        retryable: true,
        reference: 'job_222222',
        actions: {
          canCancel: false,
          cancelReason: 'Only queued or running jobs can be cancelled.',
          canRetry: true,
          retryReason: null,
        },
      }),
    ];
    return base;
  });
}

async function submitRetry(dom) {
  buttonsIn(livePanel(dom), /^Retry$/)[0].dispatch('click', {});
  await settle();
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_222222';
  input.dispatch('input', {});
  buttonsIn(dom.body, /^Retry job$/)[0].dispatch('click', {});
  await settle();
}

test('run-history retry uses the job action contract and refreshes the window', async () => {
  const failedJobId = '22222222-2222-4222-8222-222222222222';
  const retryJobId = '33333333-3333-4333-8333-333333333333';
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.runs = [
        runRow({
          jobId: failedJobId,
          outcome: 'failed',
          outcomeLabel: 'Failed',
          failureCode: 'model_timeout',
          retryable: true,
          reference: 'job_222222',
          actions: {
            canCancel: false,
            cancelReason: 'Only queued or running jobs can be cancelled.',
            canRetry: true,
            retryReason: null,
          },
        }),
      ];
      return base;
    }),
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(failedJobId) + '/retry']: {
        originalJobId: failedJobId,
        jobId: retryJobId,
        status: 'queued',
      },
    },
  });

  const heard = [];
  const realAnnounce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = (message) => { heard.push(message); return realAnnounce(message); };

  const retry = buttonsIn(livePanel(dom), /^Retry$/)[0];
  assert.ok(retry, 'the failed run did not draw a Retry button from its capability block');
  assert.match(liveText(dom), /Cancel: Only queued or running jobs can be cancelled\./,
    'a false cancel capability on a run-history row did not print the server reason');
  retry.focus();
  retry.dispatch('click', {});
  await settle();

  assert.match(allText(dom.body), /Retry: creates a new job linked to this one; the failed run stays in history\./,
    'the retry confirmation did not say what retrying does');
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_222222';
  input.dispatch('input', {});
  buttonsIn(dom.body, /^Retry job$/)[0].dispatch('click', {});
  await settle();

  assert.deepEqual(dom.calls.map((c) => [c.method || 'GET', c.endpoint]), [
    ['GET', '/api/ops/runs'],
    ['POST', '/api/ops/jobs/' + failedJobId + '/retry'],
    ['GET', '/api/ops/runs'],
  ], 'retry should post once to the jobs route and refresh the run window once');
  assert.equal(JSON.stringify(dom.calls[1].body), JSON.stringify({ confirmation: 'job_222222' }),
    'retry did not send the typed confirmation body');
  assert.ok(heard.some((message) => /Retry created: job_333333/.test(message)),
    'the success announcement did not make the replacement job findable');
  assert.equal(heard.filter((message) => /Retry created: job_333333/.test(message)).length, 1,
    'the action message was announced more than once around the reload');
  assert.match(lastSaid(dom) || '', /Retry created: job_333333/,
    'the polite region did not end on the action message after the reload announcement');
  assert.match(heard.at(-1) || '', /Retry created: job_333333/,
    'the action message was not announced after the reload summary');
});

test('run-history stale retry leaves the stale message after the reload summary exactly once', async () => {
  const failedJobId = '22222222-2222-4222-8222-222222222222';
  const stale = new Error('raw backend text must not render');
  stale.status = 409;
  stale.code = 'ops_jobs_retry_stale';
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.runs = [
        runRow({
          jobId: failedJobId,
          outcome: 'failed',
          outcomeLabel: 'Failed',
          failureCode: 'model_timeout',
          retryable: true,
          reference: 'job_222222',
          actions: {
            canCancel: false,
            cancelReason: 'Only queued or running jobs can be cancelled.',
            canRetry: true,
            retryReason: null,
          },
        }),
      ];
      return base;
    }),
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(failedJobId) + '/retry']: stale,
    },
  });

  const staleMessage = 'That job changed state elsewhere. The list was refreshed; nothing was claimed.';
  const heard = [];
  const realAnnounce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = (message) => { heard.push(message); return realAnnounce(message); };

  buttonsIn(livePanel(dom), /^Retry$/)[0].dispatch('click', {});
  await settle();
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_222222';
  input.dispatch('input', {});
  buttonsIn(dom.body, /^Retry job$/)[0].dispatch('click', {});
  await settle();

  assert.equal(heard.filter((message) => message === staleMessage).length, 1,
    'the stale retry message was not announced exactly once around the reload');
  assert.equal(lastSaid(dom), staleMessage,
    'the polite region did not end on the stale retry message after the reload announcement');
  assert.equal(heard.at(-1), staleMessage,
    'the stale retry message was not announced after the reload summary');
});

test('run-history success action followed by a failed reload still announces the action once', async () => {
  const failedJobId = '22222222-2222-4222-8222-222222222222';
  const retryJobId = '33333333-3333-4333-8333-333333333333';
  const actionMessage = 'Retry created: job_333333.';
  let reads = 0;
  const dom = await boot({
    runs: () => {
      reads += 1;
      return reads === 1 ? retryableRunWindow(failedJobId) : new Error('reload failed');
    },
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(failedJobId) + '/retry']: {
        originalJobId: failedJobId,
        jobId: retryJobId,
        status: 'queued',
      },
    },
  });

  const heard = [];
  const realAnnounce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = (message) => { heard.push(message); return realAnnounce(message); };

  await submitRetry(dom);

  assert.equal(heard.filter((message) => message === actionMessage).length, 1,
    'the successful retry message was not announced exactly once when the reload failed');
  assert.ok(heard.some((message) => /could not be read/.test(message)),
    'the failed reload was not also announced after the successful retry');
});

test('run-history stale action followed by a failed reload still announces the stale result once', async () => {
  const failedJobId = '22222222-2222-4222-8222-222222222222';
  const stale = new Error('raw backend text must not render');
  stale.status = 409;
  stale.code = 'ops_jobs_retry_stale';
  const staleMessage = 'That job changed state elsewhere. The list was refreshed; nothing was claimed.';
  let reads = 0;
  const dom = await boot({
    runs: () => {
      reads += 1;
      return reads === 1 ? retryableRunWindow(failedJobId) : new Error('reload failed');
    },
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(failedJobId) + '/retry']: stale,
    },
  });

  const heard = [];
  const realAnnounce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = (message) => { heard.push(message); return realAnnounce(message); };

  await submitRetry(dom);

  assert.equal(heard.filter((message) => message === staleMessage).length, 1,
    'the stale retry message was not announced exactly once when the reload failed');
  assert.ok(heard.some((message) => /could not be read/.test(message)),
    'the failed reload was not also announced after the stale retry');
});

test('run-history action message does not leak into the next successful read after reload failure', async () => {
  const failedJobId = '22222222-2222-4222-8222-222222222222';
  const retryJobId = '33333333-3333-4333-8333-333333333333';
  const actionMessage = 'Retry created: job_333333.';
  let readMode = 'initial';
  const dom = await boot({
    runs: () => {
      if (readMode === 'initial') return retryableRunWindow(failedJobId);
      if (readMode === 'fail') return new Error('reload failed');
      return windowAnswer();
    },
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(failedJobId) + '/retry']: {
        originalJobId: failedJobId,
        jobId: retryJobId,
        status: 'queued',
      },
    },
  });

  const heard = [];
  const realAnnounce = dom.window.OpsPaneShell.announce;
  dom.window.OpsPaneShell.announce = (message) => { heard.push(message); return realAnnounce(message); };

  readMode = 'fail';
  await submitRetry(dom);
  assert.equal(heard.filter((message) => message === actionMessage).length, 1,
    'the successful retry message was not announced exactly once when the reload failed');

  readMode = 'success';
  buttonsIn(livePanel(dom), /^Try again$/)[0].dispatch('click', {});
  await settle();

  assert.ok(heard.some((message) => /11 runs finished/.test(message)),
    'the later successful read did not announce its fresh summary');
  assert.equal(heard.filter((message) => message === actionMessage).length, 1,
    'the old successful retry message leaked into a later successful read');
});

test('owners reveal retained and missing run content after giving a reason', async () => {
  const jobId = '22222222-2222-4222-8222-222222222222';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: {
      jobId,
      jobType: 'nutrition_plan',
      sections: [
        {
          key: 'input',
          label: 'Stored input',
          source: 'generation_jobs.input_payload',
          owner: 'app-backend',
          status: 'retained',
          contentType: 'application/json',
          value: '{"prompt":"Build plan","nested":{"email":"[redacted email]"}}',
          characterCount: 58,
          notRetainedReason: null,
        },
        {
          key: 'output',
          label: 'Stored output',
          source: 'generation_jobs.result_payload',
          owner: 'app-backend',
          status: 'not_retained',
          contentType: 'application/json',
          value: null,
          characterCount: null,
          notRetainedReason: 'The result payload was swept after retention expired.',
        },
      ],
      recorded: {
        at: at(0),
        actor: 'owner@example.invalid',
        reason: 'Investigating failed generation',
      },
    },
  });

  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  const show = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.ok(show, 'an opened run did not offer the owner a reveal action');
  show.dispatch('click', {});
  await settle();

  const textarea = dom.body.querySelector('textarea');
  assert.ok(textarea, 'the reveal dialog did not ask for a written reason');
  assert.equal(textarea.getAttribute('aria-describedby').split(/\s+/).length >= 2, true,
    'the reason field is not bound to both hint and validation text');
  textarea.value = 'short';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();
  assert.equal(textarea.getAttribute('aria-invalid'), 'true',
    'a too-short reason did not mark the field invalid');
  assert.match(allText(dom.body), /Use 10 to 500 characters/,
    'the reason error was not visible beside the field');

  textarea.value = 'Investigating failed generation';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();

  assert.equal(JSON.stringify(dom.calls.filter((c) => c.method === 'POST').map((c) => [c.endpoint, c.body])),
    JSON.stringify([['/api/ops/runs/' + jobId + '/reveal', { reason: 'Investigating failed generation' }]]),
    'the reveal route was not called once with the written reason');

  const content = sectionWithHeading(dom, /Stored content/);
  assert.ok(content, 'successful reveal did not render the stored content band');
  const regions = findAll(content, (n) => n.getAttribute('role') === 'region');
  assert.deepEqual(regions.map((n) => ({
    label: n.getAttribute('aria-label'),
    tab: n.getAttribute('tabindex'),
  })), [
    { label: 'Stored input content', tab: '0' },
    { label: 'Stored output content', tab: '0' },
  ], 'revealed sections were not keyboard-readable regions');
  assert.match(allText(regions[0]), /"prompt": "Build plan"/,
    'retained JSON was not pretty-printed as readable text');
  assert.match(allText(regions[1]), /Not kept: The result payload was swept after retention expired\./,
    'not-retained content did not show the server reason');
  buttonsIn(content, /^Hide content$/)[0].dispatch('click', {});
  await settle();
  assert.doesNotMatch(liveText(dom), /"prompt": "Build plan"/,
    'Hide content left revealed text in the DOM');
});

test('a stale fresh-auth gate retries reveal without retyping the reason', async () => {
  const jobId = '22222222-2222-4222-8222-222222222222';
  const stale = new Error('fresh auth required');
  stale.status = 403;
  stale.code = 'ops_reauth_required';
  stale.maxAgeSeconds = 300;
  const dom = await boot({
    detail: detailAnswer(),
    revealResponses: [
      stale,
      {
        jobId,
        jobType: 'nutrition_plan',
        sections: [
          {
            key: 'input',
            label: 'Stored input',
            source: 'generation_jobs.input_payload',
            owner: 'app-backend',
            status: 'retained',
            contentType: 'application/json',
            value: '{"ok":true}',
            characterCount: 11,
            notRetainedReason: null,
          },
        ],
        recorded: { at: at(0), actor: 'owner@example.invalid', reason: 'Auditing customer report' },
      },
    ],
  });

  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  buttonsIn(livePanel(dom), /^Show content$/)[0].dispatch('click', {});
  await settle();
  const textarea = dom.body.querySelector('textarea');
  textarea.value = 'Auditing customer report';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();

  assert.equal(JSON.stringify(dom.calls.filter((c) => c.method === 'POST').map((c) => c.body)),
    JSON.stringify([
      { reason: 'Auditing customer report' },
      { reason: 'Auditing customer report' },
    ]), 'fresh-auth retry did not preserve the typed reason across re-authentication');
  assert.deepEqual(dom.calls.filter((c) => c.method === 'PROMPT').map((c) => c.endpoint),
    ['/api/ops/auth/reauth'], 'the stale reveal did not use the shared re-auth prompt');
  assert.match(liveText(dom), /"ok": true/,
    'the reveal result did not render after the fresh-auth retry');
});

test('operators get no run-content reveal control or owner-only hint', async () => {
  const dom = await boot({ role: 'operator', detail: detailAnswer() });

  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();

  assert.doesNotMatch(liveText(dom), /Show content|Only an owner can reveal|owner action/,
    'operators were shown a content-reveal affordance or hint');
});

function revealAnswer(value) {
  return {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobType: 'nutrition_plan',
    sections: [
      {
        key: 'input',
        label: 'Stored input',
        source: 'generation_jobs.input_payload',
        owner: 'app-backend',
        status: 'retained',
        contentType: 'application/json',
        value: JSON.stringify({ private: value }),
        characterCount: value.length + 14,
        notRetainedReason: null,
      },
    ],
    recorded: { at: at(0), actor: 'owner@example.invalid', reason: 'Review probe reason' },
  };
}

function twoSectionRevealAnswer(value) {
  return {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobType: 'video_analysis',
    sections: [
      {
        key: 'input',
        label: 'Stored input',
        source: 'generation_jobs.input_payload',
        owner: 'app-backend',
        status: 'retained',
        contentType: 'application/json',
        value: JSON.stringify({ private: value }),
        characterCount: value.length + 14,
        notRetainedReason: null,
      },
      {
        key: 'output',
        label: 'Stored output',
        source: 'generation_jobs.result_payload',
        owner: 'app-backend',
        status: 'not_retained',
        contentType: 'application/json',
        value: null,
        characterCount: null,
        notRetainedReason: 'The result payload was swept after retention expired.',
      },
    ],
    recorded: { at: at(0), actor: 'owner@example.invalid', reason: 'Review probe reason' },
  };
}

async function revealOpenedRun(dom, reason = 'Review probe reason') {
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  const show = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.ok(show, 'review probe setup did not find Show content');
  show.focus();
  show.dispatch('click', {});
  await settle();
  const textarea = dom.body.querySelector('textarea');
  textarea.value = reason;
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();
  assert.match(allText(dom.body), /Stored content/, 'review probe setup did not reveal content');
}

test('review probe: reload removes revealed content while the next window is still loading', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_LOADING';
  let resolveNext;
  let calls = 0;
  const dom = await boot({
    runs: () => {
      calls += 1;
      if (calls === 1) return windowAnswer();
      return new Promise((resolve) => { resolveNext = resolve; });
    },
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click');
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe loading cleanup failed: revealed content survived in a hidden panel');
  resolveNext(windowAnswer());
  await settle();
});

test('review probe: an empty reread removes revealed content from the whole document', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_EMPTY';
  let empty = false;
  const dom = await boot({
    runs: () => (empty ? emptyWindow() : windowAnswer()),
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  empty = true;
  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click');
  await settle();

  assert.equal(stateOf(dom), 'empty', 'review probe did not reach the empty state');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe empty cleanup failed: revealed content survived outside the live panel');
});

test('review probe: an error reread removes revealed content from the whole document', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_ERROR';
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('review probe read failed') : windowAnswer()),
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  broken = true;
  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click', {});
  await settle();

  assert.equal(stateOf(dom), 'degraded', 'review probe did not reach the degraded failure state');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe error cleanup failed: revealed content survived outside the live panel');
});

test('review probe: opening another run removes previously revealed content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_RUN_CHANGE';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  buttonsIn(livePanel(dom), /^Open$/)[0].dispatch('click', {});
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe run-change cleanup failed: revealed content survived opening another run');
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe run-change cleanup failed: reopening the original run reused revealed content');
});

test('review probe: closing the pane detail removes revealed content from the whole document', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_PANE_LEAVE';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');
  const card = dom.body.querySelector('.rh-content-card');
  assert.ok(card, 'review probe setup did not find the revealed content card');
  let removals = 0;
  const realRemove = card.remove;
  card.remove = function () {
    removals += 1;
    return realRemove.apply(card, arguments);
  };

  buttonsIn(livePanel(dom), /^Close$/)[0].dispatch('click', {});
  await settle();

  assert.equal(removals, 1,
    'review probe pane-leave cleanup failed: Close did not remove the revealed card directly');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe pane-leave cleanup failed: revealed content survived closing the detail pane');
});

test('review probe: pagehide and bfcache restore purge revealed content and stale callbacks', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_PAGEHIDE';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe pagehide cleanup failed: revealed content remained in the DOM');
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe bfcache restore cleanup failed: revealed content came back');
});

test('review probe R4: pagehide bfcache cleanup returns Hide focus to connected Show content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_HIDE_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const hide = buttonsIn(livePanel(dom), /^Hide content$/)[0];
  assert.ok(hide, 'review probe setup did not find Hide content');
  hide.focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedShow = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.equal(dom.doc.activeElement, connectedShow,
    'review probe R4 Hide bfcache focus restore failed: focus did not land on the connected Show content button');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R4 Hide bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R6: pagehide bfcache cleanup preserves Close focus outside reveal area', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_CLOSE_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const close = buttonsIn(livePanel(dom), /^Close$/)[0];
  assert.ok(close, 'review probe setup did not find Close');
  close.focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedClose = buttonsIn(livePanel(dom), /^Close$/)[0];
  assert.equal(dom.doc.activeElement, connectedClose,
    'review probe R6 Close bfcache focus preservation failed: focus did not stay on connected Close');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R6 Close bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R6: pagehide bfcache cleanup preserves job-action focus outside reveal area', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_JOB_ACTION_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer((base) => {
      base.run.reference = 'job_222222';
      base.run.actions = {
        canCancel: false,
        cancelReason: 'Only queued or running jobs can be cancelled.',
        canRetry: true,
        retryReason: null,
      };
      return base;
    }),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const retry = buttonsIn(livePanel(dom), /^Retry$/)[0];
  assert.ok(retry, 'review probe setup did not find the detail Retry job action');
  retry.focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedRetry = buttonsIn(livePanel(dom), /^Retry$/)[0];
  assert.equal(dom.doc.activeElement, connectedRetry,
    'review probe R6 job-action bfcache focus preservation failed: focus did not stay on connected Retry');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R6 job-action bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R4: pagehide bfcache cleanup returns content-region focus to connected Show content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_REGION_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const region = livePanel(dom).querySelector('.rh-content-region');
  assert.ok(region, 'review probe setup did not find the revealed content region');
  region.focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedShow = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.equal(dom.doc.activeElement, connectedShow,
    'review probe R4 content-region bfcache focus restore failed: focus did not land on the connected Show content button');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R4 content-region bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R5: pagehide bfcache cleanup returns second content-region focus to connected Show content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_SECOND_REGION_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: twoSectionRevealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const regions = livePanel(dom).querySelectorAll('.rh-content-region');
  assert.equal(regions.length, 2, 'review probe setup did not render the two-section reveal shape');
  regions[1].focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedShow = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.equal(dom.doc.activeElement, connectedShow,
    'review probe R5 second content-region bfcache focus restore failed: focus did not land on the connected Show content button');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R5 second content-region bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R6: pagehide bfcache cleanup returns footer Hide focus to connected Show content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_FOOTER_HIDE_BFCACHE_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  const card = livePanel(dom).querySelector('.rh-content-card');
  assert.ok(card, 'review probe setup did not render a revealed content card');
  const footerHide = buttonsIn(card, /^Hide content$/)[0];
  assert.ok(footerHide, 'review probe setup did not find footer Hide content');
  footerHide.focus();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  const connectedShow = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.equal(dom.doc.activeElement, connectedShow,
    'review probe R6 footer Hide bfcache focus restore failed: focus did not land on the connected Show content button');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R6 footer Hide bfcache cleanup failed: revealed content survived bfcache cleanup');
});

test('review probe R4: live state exposes a connected focus fallback target', async () => {
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer('REVIEW_PRIVATE_SENTINEL_STATE_FALLBACK'),
  });
  const stateTarget = livePanel(dom).querySelector('[data-rh-focus="rh-state"]');
  assert.ok(stateTarget,
    'review probe R4 state fallback failed: live state did not expose an rh-state target');
  stateTarget.focus();

  assert.equal(dom.doc.activeElement, stateTarget,
    'review probe R4 state fallback failed: the live rh-state target was not focusable');
});

test('review probe: pagehide invalidates a late reveal callback before it can repopulate content', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_LATE_CALLBACK';
  let resolveReveal;
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: new Promise((resolve) => { resolveReveal = resolve; }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  const show = buttonsIn(livePanel(dom), /^Show content$/)[0];
  show.focus();
  show.dispatch('click', {});
  await settle();
  const textarea = dom.body.querySelector('textarea');
  textarea.value = 'Review probe reason';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  resolveReveal(revealAnswer(sentinel));
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe late callback cleanup failed: reveal content was repopulated after pagehide');
});

test('review probe R2: hidden visibility settles a pending reveal dialog before the late response lands', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_PENDING_VISIBILITY';
  let resolveReveal;
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: new Promise((resolve) => { resolveReveal = resolve; }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  const show = buttonsIn(livePanel(dom), /^Show content$/)[0];
  show.focus();
  show.dispatch('click', {});
  await settle();
  const textarea = dom.body.querySelector('textarea');
  textarea.value = 'Review probe reason';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();
  assert.ok(dom.body.querySelector('.modal'), 'review probe setup did not leave the reveal dialog open');

  dom.doc.visibilityState = 'hidden';
  dom.doc.dispatch('visibilitychange', {});
  dom.doc.visibilityState = 'visible';
  dom.doc.dispatch('visibilitychange', {});
  resolveReveal(revealAnswer(sentinel));
  await settle();

  assert.equal(dom.body.querySelector('.modal'), null,
    'review probe R2 pending visibility cleanup failed: the busy reveal dialog remained mounted');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R2 pending visibility cleanup failed: late reveal content rendered after cleanup');
  assert.equal(dom.doc.activeElement && dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-reveal-show',
    'review probe R2 pending visibility cleanup failed: focus did not return to Show content');
});

test('review probe R2: pagehide bfcache cleanup settles a pending reveal dialog before the late response lands', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_PENDING_PAGEHIDE';
  let resolveReveal;
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: new Promise((resolve) => { resolveReveal = resolve; }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click', {});
  await settle();
  const show = buttonsIn(livePanel(dom), /^Show content$/)[0];
  show.focus();
  show.dispatch('click', {});
  await settle();
  const textarea = dom.body.querySelector('textarea');
  textarea.value = 'Review probe reason';
  textarea.dispatch('input', {});
  buttonsIn(dom.body, /^Show content$/).slice(-1)[0].dispatch('click', {});
  await settle();
  assert.ok(dom.body.querySelector('.modal'), 'review probe setup did not leave the reveal dialog open');

  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  const connectedShow = buttonsIn(livePanel(dom), /^Show content$/)[0];
  assert.equal(dom.doc.activeElement, connectedShow,
    'review probe R3 bfcache focus restore failed: persisted pageshow did not focus the connected Show content button');
  resolveReveal(revealAnswer(sentinel));
  await settle();

  assert.equal(dom.body.querySelector('.modal'), null,
    'review probe R2 pending pagehide cleanup failed: the busy reveal dialog remained mounted');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R2 pending pagehide cleanup failed: late reveal content rendered after cleanup');
  assert.equal(dom.doc.activeElement && dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-reveal-show',
    'review probe R2 pending pagehide cleanup failed: focus did not return to Show content');
});

test('review probe: persisted pageshow alone purges revealed content on bfcache restore', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_PAGESHOW';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe pageshow cleanup failed: a bfcache restore kept revealed content');
});

test('review probe: hidden visibility purges revealed content before the pane is backgrounded', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_VISIBILITY';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });
  await revealOpenedRun(dom);
  assert.match(allText(dom.body), new RegExp(sentinel), 'review probe setup did not put the sentinel in the DOM');

  dom.doc.visibilityState = 'hidden';
  dom.doc.dispatch('visibilitychange', {});
  await settle();

  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe visibility cleanup failed: revealed content survived backgrounding');
});

test('review probe: Show and Hide keep focus on connected reveal controls', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_FOCUS';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });

  await revealOpenedRun(dom);

  assert.ok(dom.body.contains(dom.doc.activeElement),
    'review probe Show focus failed: focus stayed on a detached control after reveal');
  assert.equal(dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-content-first',
    'review probe Show focus failed: focus did not land on the revealed content region');

  const hide = buttonsIn(livePanel(dom), /^Hide content$/)[0];
  hide.focus();
  hide.dispatch('click', {});
  await settle();

  assert.ok(dom.body.contains(dom.doc.activeElement),
    'review probe Hide focus failed: focus stayed on a detached Hide button');
  assert.equal(dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-reveal-show',
    'review probe Hide focus failed: focus did not return to Show content');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe Hide cleanup failed: revealed content survived Hide');
});

test('review probe R2: footer Hide keeps focus on the connected Show content button', async () => {
  const sentinel = 'REVIEW_PRIVATE_SENTINEL_FOOTER_HIDE';
  const dom = await boot({
    detail: detailAnswer(),
    revealResponse: revealAnswer(sentinel),
  });

  await revealOpenedRun(dom);
  const card = dom.body.querySelector('.rh-content-card');
  assert.ok(card, 'review probe setup did not render a revealed content card');
  const footerHide = buttonsIn(card, /^Hide content$/)[0];
  assert.ok(footerHide, 'review probe setup did not find the footer Hide button');
  footerHide.focus();
  footerHide.dispatch('click', {});
  await settle();

  assert.ok(dom.body.contains(dom.doc.activeElement),
    'review probe R2 footer Hide focus failed: focus stayed on a detached footer Hide button');
  assert.equal(dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-reveal-show',
    'review probe R2 footer Hide focus failed: focus did not return to Show content');
  assert.doesNotMatch(allText(dom.body), new RegExp(sentinel),
    'review probe R2 footer Hide cleanup failed: revealed content survived footer Hide');
});

function stateOf(dom) {
  return dom.applied[dom.applied.length - 1] || null;
}

function sectionWithHeading(dom, pattern) {
  return findAll(livePanel(dom), (n) => n.tagName === 'SECTION')
    .filter((n) => pattern.test(allText(n)))[0];
}

function rowsOfTable(dom, heading) {
  const section = sectionWithHeading(dom, heading);
  if (!section) return [];
  const bodies = findAll(section, (n) => n.tagName === 'TBODY');
  return bodies.length ? findAll(bodies[0], (n) => n.tagName === 'TR') : [];
}

function tileText(dom, heading) {
  const tile = findAll(livePanel(dom), (n) => (n.getAttribute('class') || '').indexOf('kpi') !== -1)
    .filter((n) => heading.test(allText(n)))[0];
  return tile ? allText(tile) : '';
}

function numerals(text) {
  return (text.match(/\d/g) || []).length;
}

function buttonsIn(node, label) {
  return findAll(node, (n) => n.tagName === 'BUTTON')
    .filter((n) => label.test(allText(n)));
}

function selectsIn(dom) {
  return findAll(livePanel(dom), (n) => n.tagName === 'SELECT');
}

function linksIn(node, label) {
  return findAll(node, (n) => n.tagName === 'A')
    .filter((n) => label.test(allText(n)));
}

const runCalls = (dom) => dom.calls.filter((c) => c.endpoint === '/api/ops/runs');

/* The shell's own absence marker, read from the shell rather than restated
   here: a test that hard-coded the character would pass while the pane drew a
   different one, which is the shape it exists to catch. */
const NONE = /var NONE = '(.*)';/.exec(SHELL_SRC)[1];

/* ================= three empties, three different sentences ============= */

test('a pipeline that was never connected draws no figure at all', async () => {
  /* The founding defect of this whole dashboard, in one test. A table with no
     rows in it can answer no question, and a pane that printed 0 over it would
     be telling an operator the system is healthy using data it never got. */
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'never_recorded', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
      base.summary.runs = 0;
      base.summary.completed = 0;
      base.summary.failed = 0;
      base.summary.canceled = 0;
      base.summary.unfinished = 0;
      base.runs = [];
      base.failures = [];
    }),
  });

  assert.equal(stateOf(dom), 'empty', 'a pipeline that never recorded was drawn as a live pane');
  const text = emptyText(dom);
  assert.match(text, /has ever been recorded/,
    'the never-recorded state did not say the record is empty rather than the window');
  assert.match(text, /holds nothing at all/,
    'the never-recorded state did not say the table itself is empty');
  assert.match(text, /not a quiet system|not nothing for this window/,
    'nothing distinguished an unread pipeline from a quiet one');
  assert.doesNotMatch(liveText(dom), /Runs finished/,
    'the summary strip was drawn over a table that holds nothing');
});

test('an empty window over a readable record is a genuine zero, and says which', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.summary.runs = 0;
      base.summary.completed = 0;
      base.summary.failed = 0;
      base.summary.canceled = 0;
      base.summary.failureReasons = 0;
      base.summary.unfinished = 0;
      base.summary.duration = { p50Ms: null, measured: 0, total: 0 };
      base.summary.queued = { p50Ms: null, measured: 0, total: 0 };
      base.runs = [];
      base.failures = [];
    }),
  });

  assert.equal(stateOf(dom), 'empty');
  const text = emptyText(dom);
  assert.match(text, /No run finished/, 'a quiet window did not say the window was quiet');
  assert.match(text, /quiet window rather than a missing one|readable/,
    'a quiet window did not say the record behind it is readable');
  assert.doesNotMatch(text, /has ever been recorded/,
    'a quiet window and an unconnected pipeline read as the same sentence, which is the ' +
    'one thing this pane exists to prevent');
});

test('the two empties cannot be told apart by their figures, only by their words', async () => {
  /* Both draw nothing. If they also SAID the same thing, the distinction would
     exist only in the payload, where no operator can see it. */
  const quiet = await boot({
    runs: windowAnswer((base) => {
      base.summary.runs = 0; base.summary.completed = 0; base.summary.failed = 0;
      base.summary.canceled = 0; base.summary.unfinished = 0;
      base.runs = []; base.failures = [];
    }),
  });
  const unread = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'never_recorded', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
      base.summary.runs = 0; base.summary.completed = 0; base.summary.failed = 0;
      base.summary.canceled = 0; base.summary.unfinished = 0;
      base.runs = []; base.failures = [];
    }),
  });
  assert.notEqual(emptyText(quiet), emptyText(unread),
    'a quiet window and a pipeline that never recorded produced identical screens');
});

test('a record that starts inside the window says so above the figures', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'partial',
        recordingSince: at(2 * DAY),
        lastRecordedAt: at(3 * MINUTE),
        coversWindow: false,
      };
    }),
  });

  const text = liveText(dom);
  assert.match(text, /Recording started at/, 'a partial window was drawn as a whole one');
  assert.match(text, /not from the start of the window/,
    'nothing said the figures cover less than the window they are labelled with');
  assert.match(text, /Runs finished/,
    'partial coverage emptied the pane instead of qualifying it');

  const whole = await boot({});
  assert.doesNotMatch(liveText(whole), /Recording started at/,
    'a window the record fully covers was also called partial, so the note means nothing');
});

/* ===================== absence is never zero-filled ===================== */

test('a median nobody measured renders words and never a numeral', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.summary.duration = { p50Ms: null, measured: 0, total: 11 };
    }),
  });

  const tile = tileText(dom, /Half of them took under/);
  assert.match(tile, /Not measured/, 'an unmeasured median did not say it was unmeasured');
  assert.match(tile, /nothing recorded a figure to measure/,
    'an unmeasured median did not say why it is unmeasured');
  assert.equal(numerals(tile.replace(/Half of them took under/, '')), 0,
    'an unmeasured median printed a numeral, which reads as a measurement');
});

test('every median carries the number of runs it was taken over', async () => {
  const dom = await boot({});
  assert.match(tileText(dom, /Half of them took under/), /measured on 9 of 11/,
    'a median was published without the count behind it, so a p50 over 9 of 11 runs and a ' +
    'p50 over all 11 read identically');
  assert.match(tileText(dom, /Half of them waited under/), /measured on 10 of 11/);
});

test('a run with no recorded duration keeps an em dash rather than a zero', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.runs = [runRow({ durationMs: null, queuedMs: null, modelUsed: null })];
    }),
  });
  const rows = rowsOfTable(dom, /The runs/);
  assert.equal(rows.length, 1);
  const text = allText(rows[0]);
  assert.doesNotMatch(text, /\b0ms\b|\b0s\b/,
    'a duration nobody recorded was drawn as a zero-length run');
  const cells = findAll(rows[0], (n) => n.tagName === 'TD').map((n) => allText(n).trim());
  assert.equal(cells.filter((c) => c === NONE).length, 3,
    'took, waited and model are three absences and ' +
    cells.filter((c) => c === NONE).length + ' of them were drawn as one');
});

test('runs that moved and never finished are counted rather than dropped', async () => {
  const dom = await boot({});
  assert.match(tileText(dom, /Runs finished/), /2 more moved and never finished/,
    'unfinished runs vanished from the page, so "11 runs" reads as the whole window');
});

/* ================== the selection reaches the read ====================== */

test('the read carries the window, the narrowing and the page size', async () => {
  const dom = await boot({ query: '?range=24h' });
  const call = runCalls(dom)[0];
  assert.ok(call, 'the pane never read /api/ops/runs');
  assert.equal(call.query.range, '24h',
    'the operator window was not sent, so the answer is for a window nobody picked');
  assert.equal(call.query.type, 'all');
  assert.equal(call.query.outcome, 'all');
  assert.equal(call.query.limit, 50);
});

test('the pane reads once on boot, not twice', async () => {
  /* The shell fires ops:filters with the starting selection, so a pane that
     also reads directly issues two requests whose answers race. */
  const dom = await boot({});
  assert.equal(runCalls(dom).length, 1,
    'the window was read ' + runCalls(dom).length + ' times on boot');
});

test('picking a request type re-reads with it, and does not filter what is already drawn', async () => {
  const dom = await boot({});
  const select = selectsIn(dom)[0];
  assert.ok(select, 'there is no request type control');

  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();

  const calls = runCalls(dom);
  assert.equal(calls.length, 2, 'changing the request type did not re-read');
  assert.equal(calls[1].query.type, 'nutrition_plan',
    'the request type was applied to the drawing rather than to the read, so every figure ' +
    'above the list stayed counted over everything');
  assert.equal(calls[1].query.range, calls[0].query.range,
    'narrowing the type silently changed the window as well');
});

test('picking an outcome re-reads with it', async () => {
  const dom = await boot({});
  const select = selectsIn(dom)[1];
  assert.ok(select, 'there is no outcome control');
  select.value = 'failed';
  select.dispatch('change');
  await settle();
  const calls = runCalls(dom);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.outcome, 'failed');
});

test('the narrowing controls offer only what the window actually holds', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.facets.types = [
        { value: 'video_analysis', label: 'Sprint video analysis', labelled: true, runs: 4 },
      ];
    }),
  });
  const options = findAll(selectsIn(dom)[0], (n) => n.tagName === 'OPTION')
    .map((n) => n.getAttribute('value'));
  assert.deepEqual(options, ['all', 'video_analysis'],
    'the control was built from a fixed list rather than from the window, so it offers a ' +
    'request type nobody ran');
});

test('a narrowing the new window no longer holds is named rather than silently dropped', async () => {
  const dom = await boot({});
  const select = selectsIn(dom)[0];
  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();

  /* The same narrowing, against a window whose facet list no longer has it —
     pick a type, then move to a window in which nothing of that type ran. */
  dom.answers['/api/ops/runs'] = windowAnswer((base) => {
    base.facets.types = [
      { value: 'program_generation', label: 'Training program', labelled: true, runs: 5 },
    ];
    base.selection = { type: 'nutrition_plan', outcome: null, limit: 50 };
  });
  buttonsIn(livePanel(dom), /Read again/)[0].dispatch('click');
  await settle();

  const text = liveText(dom);
  assert.match(text, /nothing in this window/,
    'a narrowing the window cannot offer was dropped without saying so, so the pane quietly ' +
    'answered a different question from the one on screen');
});

test('the read stamp is on screen, because nothing refreshes it on its own', async () => {
  const dom = await boot({});
  assert.match(liveText(dom), /Read at .* UTC/,
    'the figures carry no read time, so nothing on screen says how old they are');
});

/* ============================ keyboard focus =========================== */

/* Every redraw replaces the whole pane, so without a guard the control the
   operator just used is destroyed under them and focus falls to <body>. From
   row forty of a long window that is a long way back. These read
   `doc.activeElement`, which the harness maintains through `focus()`.

   Attachment is checked before the key is read, and that check is the whole
   probe. A browser moves focus to <body> when the focused node leaves the
   document; this harness does not -- `removeChild` clears `parentNode` and
   leaves `activeElement` pointing at the orphan. So a redraw that restores
   nothing still answers with the key of the node it destroyed, and an
   assertion that the key is unchanged passes over a pane that dropped focus
   on the floor. Measured: deleting the `settleFocus()` call in `render()`
   left both same-key tests green until this walk was added. */

const attached = (dom, node) => {
  for (var at = node; at; at = at.parentNode) if (at === dom.doc.documentElement) return true;
  return false;
};

const focusKey = (dom) => {
  const live = dom.doc.activeElement;
  if (!live || !live.getAttribute || !attached(dom, live)) return null;
  /* Attached is not the same as on screen, and the difference is a whole class
     of false green. `region.empty()` fills the empty box and aria.js moves
     `data-shown` to it; the live box keeps its children, so the control the
     operator was standing on is still in the document with `display:none`
     over it. Chrome drops focus to <body> for that node; this harness has no
     CSS, so it happily answers with the key of a control nobody can see.
     Review of PR #117 measured `active=BODY` in real Chrome on exactly the
     states five of this file's assertions were passing over. */
  if (!shown(dom, live)) return null;
  /* And focusable. `h2.focus()` is a no-op in a browser unless the heading
     carries a tabindex, but this harness's `focus()` sets `activeElement` on
     anything handed to it -- so a pane that keys a heading and forgets the
     tabindex beside it reads as a successful landing here and as <body> in
     Chrome. Proven: dropping the `tabindex` line left the empty-state focus
     assertions green until this check existed. */
  if (!focusable(live)) return null;
  return live.getAttribute('data-rh-focus');
};

const NATIVELY_FOCUSABLE = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A'];
function focusable(node) {
  if (node.getAttribute('tabindex') !== null) return true;
  return NATIVELY_FOCUSABLE.indexOf(node.tagName) !== -1;
}

/* Walk to the document, refusing any ancestor that is a state box without
   `data-shown`. Mirrors aria.css's `[data-state]:not([data-shown])` rule,
   which is the only thing that hides these panels. */
function shown(dom, node) {
  let cur = node;
  while (cur && cur !== dom.doc.documentElement) {
    if (cur.getAttribute && cur.getAttribute('data-state') !== null
      && cur.getAttribute('data-shown') === null) return false;
    cur = cur.parentNode;
  }
  return true;
}

/* The shell's polite live region, which is a div it appends to <body> and
   whose textContent it replaces. Toasts also carry role="status", so the
   aria-live attribute is what separates them. */
const lastSaid = (dom) => {
  const region = findAll(dom.body, (n) => n.getAttribute
    && n.getAttribute('role') === 'status'
    && n.getAttribute('aria-live') === 'polite')[0];
  return region ? allText(region) : null;
};

test('a picker the operator is standing on keeps focus across the re-read', async () => {
  const dom = await boot({});
  const select = selectsIn(dom)[0];
  select.focus();
  assert.equal(focusKey(dom), 'rh-type', 'the harness did not put focus on the picker');

  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();

  assert.notEqual(selectsIn(dom)[0], select, 'the redraw did not replace the picker, so this ' +
    'test is not exercising the thing it names');
  assert.equal(focusKey(dom), 'rh-type',
    'focus fell to ' + (focusKey(dom) || 'nowhere in this pane') + ' after narrowing, so a ' +
    'keyboard operator is dropped to the top of the document by the pane\'s main control');
});

test('Read again keeps focus on Read again', async () => {
  const dom = await boot({});
  const again = buttonsIn(livePanel(dom), /Read again/)[0];
  again.focus();
  assert.equal(focusKey(dom), 'rh-read-again', 'the harness did not put focus on Read again');

  again.dispatch('click');
  await settle();

  assert.equal(focusKey(dom), 'rh-read-again',
    'focus fell to ' + (focusKey(dom) || 'nowhere in this pane') + ' after a fresh reading');
});

test('live doorway links keep focus on their connected equivalents across cleanup redraws', async () => {
  const dom = await boot({});
  for (const [label, expectedKey] of [
    [/^What the watchers caught$/, 'rh-doorway-live-alerts'],
    [/^Look up a user$/, 'rh-doorway-live-users'],
  ]) {
    const link = linksIn(livePanel(dom), label)[0];
    assert.ok(link, 'the live pane did not draw the doorway link named ' + label);
    link.focus();
    assert.equal(focusKey(dom), expectedKey, 'the doorway link carries no stable focus key');

    dom.window.dispatchEvent({ type: 'pagehide' });
    await settle();

    const connected = linksIn(livePanel(dom), label)[0];
    assert.ok(connected && dom.body.contains(connected) && shown(dom, connected),
      'the redraw did not leave a connected equivalent link');
    assert.notEqual(connected, link, 'the cleanup redraw did not replace the doorway link');
    assert.equal(dom.doc.activeElement, connected,
      'focus did not reconnect to the equivalent ' + allText(connected).trim() + ' doorway');
    assert.equal(dom.doc.activeElement.getAttribute('data-rh-focus'), expectedKey,
      'focus landed on the wrong keyed doorway after redraw');
  }
});

test('empty doorway links keep focus on their connected equivalents across cleanup redraws', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'never_recorded', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
      base.runs = [];
      base.failures = [];
    }),
  });
  for (const [label, expectedKey] of [
    [/^What is running now$/, 'rh-doorway-empty-jobs'],
    [/^What the watchers caught$/, 'rh-doorway-empty-alerts'],
  ]) {
    const link = linksIn(emptyPanel(dom), label)[0];
    assert.ok(link, 'the empty pane did not draw the doorway link named ' + label);
    link.focus();
    assert.equal(focusKey(dom), expectedKey, 'the empty doorway link carries no stable focus key');

    dom.window.dispatchEvent({ type: 'pagehide' });
    await settle();

    const connected = linksIn(emptyPanel(dom), label)[0];
    assert.ok(connected && dom.body.contains(connected) && shown(dom, connected),
      'the redraw did not leave a connected empty doorway link');
    assert.notEqual(connected, link, 'the cleanup redraw did not replace the empty doorway link');
    assert.equal(dom.doc.activeElement, connected,
      'focus did not reconnect to the equivalent ' + allText(connected).trim() + ' empty doorway');
    assert.equal(dom.doc.activeElement.getAttribute('data-rh-focus'), expectedKey,
      'focus landed on the wrong empty doorway key after redraw');
  }
});

test('a doorway link that disappears on reread falls back to the live state target', async () => {
  let noFailures = false;
  const dom = await boot({
    runs: () => windowAnswer((base) => {
      if (noFailures) {
        base.summary.failed = 0;
        base.failures = [];
      }
      return base;
    }),
  });
  const link = linksIn(livePanel(dom), /^What the watchers caught$/)[0];
  assert.ok(link, 'the live pane did not draw the doorway that can disappear');
  link.focus();
  assert.equal(focusKey(dom), 'rh-doorway-live-alerts',
    'the disappearing doorway link carries no stable focus key');

  noFailures = true;
  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click');
  await settle();

  assert.equal(linksIn(livePanel(dom), /^What the watchers caught$/).length, 0,
    'the reread still drew the doorway link, so this test did not exercise the fallback');
  assert.equal(dom.doc.activeElement && dom.doc.activeElement.getAttribute('data-rh-focus'), 'rh-state',
    'focus did not fall back to the live state target after the doorway disappeared');
  assert.ok(dom.doc.activeElement && dom.body.contains(dom.doc.activeElement)
      && shown(dom, dom.doc.activeElement),
    'focus landed on a disconnected node after the doorway disappeared');
});

test('opening a run moves focus into the run, and Close puts it back on the row', async () => {
  const dom = await boot({ detail: detailAnswer() });
  const open = buttonsIn(livePanel(dom), /^Open$/)[1];
  const backKey = open.getAttribute('data-rh-focus');
  assert.match(backKey || '', /^rh-open-/, 'the Open button carries no focus key');
  open.focus();

  open.dispatch('click');
  await settle();

  assert.equal(focusKey(dom), 'rh-detail-close',
    'focus fell to ' + (focusKey(dom) || 'nowhere in this pane') + ' when the run opened, so ' +
    'the operator has to tab back down to the run they just asked for');

  buttonsIn(livePanel(dom), /^Close$/)[0].dispatch('click');
  await settle();

  assert.equal(focusKey(dom), backKey,
    'Close left focus at ' + (focusKey(dom) || 'nowhere in this pane') + ' rather than on the ' +
    'row the run was opened from');
});

test('a pointer user is not yanked: nothing moves focus when focus was not here', async () => {
  const dom = await boot({});
  assert.equal(focusKey(dom), null, 'boot moved focus on its own');

  buttonsIn(livePanel(dom), /Read again/)[0].dispatch('click');
  await settle();
  assert.equal(focusKey(dom), null, 'a click with focus nowhere pulled focus onto a control');

  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  assert.equal(focusKey(dom), null, 'opening a run by pointer pulled focus into the detail');
});

test('a run whose read fails still lands focus somewhere in the pane', async () => {
  /* Open sends focus to Close, and a failed read draws no Close. Without a
     second place to land, the operator is left on a button that no longer
     exists in the document. */
  const dom = await boot({});
  const open = buttonsIn(livePanel(dom), /^Open$/)[1];
  open.focus();
  open.dispatch('click');
  await settle();

  assert.equal(focusKey(dom), 'rh-detail-retry',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after a run failed to ' +
    'read, so the operator is standing on a node the redraw removed');
});

/* The three states round 3 could not reach. `render()` returned before
   `settleFocus()` on both empty paths and never called it on the failed one,
   so three of the pane's four states dropped a keyboard operator to <body> --
   and no test in this file could arrive at any of them, because the stub
   answered by path and a narrowed re-read therefore came back populated. */

const emptyWindow = (over) => windowAnswer((base) => {
  base.summary.runs = 0; base.summary.completed = 0; base.summary.failed = 0;
  base.summary.canceled = 0; base.summary.unfinished = 0;
  base.runs = []; base.failures = [];
  if (over) over(base);
});

/* Populated until narrowed, empty once narrowed: the shape an operator meets
   when they pick a type nothing matched. */
const emptyOnceNarrowed = (query) => (
  query && query.type && query.type !== 'all' ? emptyWindow() : windowAnswer());

test('narrowing into an empty window keeps the operator inside the pane', async () => {
  const dom = await boot({ runs: emptyOnceNarrowed });
  const select = selectsIn(dom)[0];
  select.focus();
  assert.equal(focusKey(dom), 'rh-type', 'the harness did not put focus on the picker');

  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();

  assert.match(emptyText(dom), /Nothing matched the request type and outcome you picked/,
    'the narrowed read did not reach the empty state, so this test is not exercising it');
  assert.ok(focusKey(dom),
    'focus fell out of the pane entirely after narrowing into an empty window, so the '
    + 'operator is at the top of the document with no way back but Tab');
});

test('Read again on a window that empties keeps the operator inside the pane', async () => {
  /* The un-narrowed empty state, which draws no picker and no Clear button --
     the state with the fewest controls to land on, and the one most likely to
     have nothing. */
  let empty = false;
  const dom = await boot({ runs: () => (empty ? emptyWindow() : windowAnswer()) });
  const again = buttonsIn(livePanel(dom), /^Read again$/)[0];
  again.focus();
  assert.equal(focusKey(dom), 'rh-read-again', 'the harness did not put focus on Read again');

  empty = true;
  again.dispatch('click');
  await settle();

  assert.match(emptyText(dom), /No run finished in the last 7 days/,
    'the re-read did not reach the empty state, so this test is not exercising it');
  assert.ok(focusKey(dom),
    'focus fell out of the pane after a re-read came back empty');
});

test('a window that stops being recorded at all keeps the operator inside the pane', async () => {
  let gone = false;
  const dom = await boot({
    runs: () => (gone
      ? emptyWindow((base) => {
        base.coverage = {
          state: 'never_recorded', recordingSince: null, lastRecordedAt: null,
          coversWindow: false,
        };
      })
      : windowAnswer()),
  });
  const again = buttonsIn(livePanel(dom), /^Read again$/)[0];
  again.focus();

  gone = true;
  again.dispatch('click');
  await settle();

  assert.match(emptyText(dom), /No run has ever been recorded here/,
    'the re-read did not reach the never-recorded state');
  assert.ok(focusKey(dom),
    'focus fell out of the pane after a re-read found nothing recorded at all');
});

test('a failed window read lands the operator on its retry', async () => {
  /* The measured case from review: 13 tab stops from <body> to the only
     control left on the pane, for the operator who pressed Read again during
     an incident. */
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('upstream refused') : windowAnswer()),
  });
  const again = buttonsIn(livePanel(dom), /^Read again$/)[0];
  again.focus();
  assert.equal(focusKey(dom), 'rh-read-again', 'the harness did not put focus on Read again');

  broken = true;
  again.dispatch('click');
  await settle();

  assert.match(liveText(dom), /This pane could not be read/,
    'the re-read did not fail, so this test is not exercising the failure');
  assert.equal(focusKey(dom), 'rh-window-retry',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after the window read '
    + 'failed, so the retry this pane advertises is reachable only by tabbing from the top '
    + 'of the document');
});

/* Round 5 found the drawn twin of the sentence round 3 blocked on still on
   screen, plus three more: the figures band head over the four tiles, the
   Failed tile's "no failure in this window" over a genuine zero, the failure
   band foot and the runs band foot. All seven window-scoped claims now come
   from one `coveredWords()`. */
const partialPopulated = () => windowAnswer((base) => {
  base.coverage = {
    state: 'partial',
    recordingSince: at(3 * HOUR),
    lastRecordedAt: at(MINUTE),
    coversWindow: false,
  };
});

const stampOf = (iso) => {
  const d = new Date(iso);
  return d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
};

test('no figure on a partly covered screen is scoped to the window that was picked', async () => {
  const answer = partialPopulated();
  const dom = await boot({ runs: answer });
  const text = liveText(dom);
  const stamp = stampOf(answer.coverage.recordingSince);

  assert.match(text, /Recording started at/,
    'the partial note did not draw, so this screen is not the one under test');
  assert.match(text, /What the record shows/,
    'the figures band did not draw, so there are no figures to scope');

  /* The picked window is seven days; every sentence naming it over a record
     three hours old is a claim the pane cannot support. */
  assert.ok(!/the last 7 days/.test(text),
    'a partly covered screen still names the picked window: "'
    + (/[^.]*the last 7 days[^.]*\./.exec(text) || ['?'])[0].trim() + '"');
  assert.ok(!/in this window/.test(text),
    'a partly covered screen still says "in this window": "'
    + (/[^.]*in this window[^.]*\./.exec(text) || ['?'])[0].trim() + '"');
  const named = text.split('what the record covers, which starts at ' + stamp).length - 1;
  assert.ok(named >= 3,
    'only ' + named + ' surfaces on this screen name the covered span, so some figures are '
    + 'published without the window they cover');
});

test('a partly covered window with no failures does not publish a clean seven days', async () => {
  const answer = windowAnswer((base) => {
    base.coverage = {
      state: 'partial', recordingSince: at(3 * HOUR), lastRecordedAt: at(MINUTE),
      coversWindow: false,
    };
    base.summary.failed = 0;
    base.summary.failureReasons = 0;
    base.failures = [];
  });
  const dom = await boot({ runs: answer });
  const tile = tileText(dom, /Failed/);

  assert.match(tile, /\b0\b/, 'the Failed tile did not draw a zero, so this is not the case '
    + 'the finding names');
  assert.ok(!/no failure in this window/.test(tile),
    'the Failed tile reads "' + tile.replace(/\s+/g, ' ').trim() + '", which is a confident '
    + 'zero over seven days for a figure covering three hours');
  assert.match(tile, new RegExp('what the record covers, which starts at '
    + stampOf(answer.coverage.recordingSince)),
    'the Failed tile published a zero without naming what it covers');
});

/* A prose rule costs one issue per violation forever. Three review rounds
   found this same class at four different sites, so it is a guard. */
const WINDOW_SCOPED = /WINDOW_LABEL\[|'[^']*\bthis window\b[^']*'|"[^"]*\bthis window\b[^"]*"/;

/* Block and line comments removed before scanning, because a comment ABOUT
   this class reads identically to a violation of it -- the first version of
   this guard reported two of its own explanatory comments and one of the
   pane's, which is the shape where a guard that is broken and a guard that
   found something look the same from outside. */
const codeLines = (() => {
  const out = [];
  let inBlock = false;
  PANE_SRC.split('\n').forEach((line) => {
    let kept = '';
    for (let i = 0; i < line.length; i += 1) {
      if (inBlock) {
        if (line[i] === '*' && line[i + 1] === '/') { inBlock = false; i += 1; }
        continue;
      }
      if (line[i] === '/' && line[i + 1] === '*') { inBlock = true; i += 1; continue; }
      if (line[i] === '/' && line[i + 1] === '/') break;
      kept += line[i];
    }
    /* A `coveredWords(...)` argument is not a violation, it IS the one place:
       the third argument is that function's covered-case wording. Exempting
       the function rather than listing its call sites means a seventh caller
       is exempt the day it is written, and a sentence that does NOT go
       through it is still named. */
    out.push(kept.replace(/coveredWords\([^()]*\)/g, 'coveredWords()'));
  });
  return out;
})();

/* Every line that legitimately names the picked window and is NOT a figure
   being scoped. Frozen per site -- there is deliberately no whole-function
   sanction, because the two functions that would need one (`announceRead`,
   `nothingFinished`) are the exact two that produced this defect class in
   rounds 3 and 4, and a blanket exemption there covers the next sentence
   somebody adds beside them. */
const NOT_A_FIGURE = [
  {
    why: 'the truncation note scopes the LIST, not the figures; the figures clause beside it '
      + 'goes through coveredWords',
    find: "'is the most recent part of this window rather than all of it. The figures above it ' +",
  },
  {
    why: 'the rail badge’s covered branch; its partial branch is the ternary directly above '
      + 'and is bound by its own test',
    find: ": ' in this window';",
  },
  {
    why: 'inside coveredWords() itself: this IS the one place, and it is the covered-case '
      + 'branch that every other site defers to',
    find: ": (whenCovered || WINDOW_LABEL[selection.range] || 'the window you picked');",
  },
  {
    why: 'announceRead’s span variable; its partly-covered branch is guarded by '
      + 'partlyCovered() and returns before this is used, bound by its own test',
    find: "var words = WINDOW_LABEL[selection.range] || 'the window you picked';",
  },
  {
    why: 'nothingFinished’s span variable, used only on the branch where coverage is '
      + 'whole -- the partial branch names the record start instead',
    find: "var words = WINDOW_LABEL[selection.range] || 'this window';",
  },
  {
    why: 'the unread-before-the-record sentence: it names the window in order to say the '
      + 'span BEFORE it is unread, which is the opposite of scoping a figure to it',
    find: "'this window, so the window before that is unread rather than empty.';",
  },
  {
    why: 'the readable-record sentence states the record reaches PAST the window start, '
      + 'which is what makes the zero genuine rather than a shortfall',
    find: "'is readable and reaches back past the start of this window.';",
  },
  {
    why: 'the same sentence in its other arm; both are bound by the genuine-zero tests',
    find: "first = 'The record is readable and reaches back past the start of this window, so ' +",
  },
  {
    why: 'the never-recorded sentence is the one place the phrase is CONTRASTED with a figure '
      + 'rather than scoping one -- it says the table holds nothing at all, not nothing here',
    find: "'The run history table holds nothing at all — not nothing for this window, nothing ' +",
  },
  {
    why: 'the partial-coverage note is what ANNOUNCES the shortfall every other sentence then '
      + 'defers to; it names the window in order to say the figures do not cover it',
    find: "'this window. Every figure below covers from then, not from the start of the window, ' +",
  },
];

/* What this guard actually does, stated so nobody reads more into a green
   run than it earns: it freezes the known sites that spell `this window` or
   index `WINDOW_LABEL[` in SINGLE- or DOUBLE-QUOTED source, outside a
   `coveredWords()` argument list. It does not see template literals, and it
   does not see a window spelled out longhand (`'the last 7 days'`). It is a
   freeze on the sites that exist, not a proof that no eighth can be written.
   The drawn screen tests remain the real binding; this one stops a silent
   edit to a site they do not render. */
test('the known window-naming sites in the pane are exactly the frozen ones', () => {
  /* Each exception must still reproduce, or the freeze list rots in the
     direction nobody notices: a stale entry silently widens the guard. */
  NOT_A_FIGURE.forEach((e) => {
    assert.equal(codeLines.filter((l) => l.trim() === e.find.trim()).length, 1,
      'the exception "' + e.find.trim() + '" no longer appears exactly once in the pane, so '
      + 'this guard is sanctioning a site that has moved or gone');
  });

  const offenders = [];
  codeLines.forEach((line, i) => {
    if (!WINDOW_SCOPED.test(line)) return;
    if (NOT_A_FIGURE.some((e) => e.find.trim() === line.trim())) return;
    let owner = '?';
    for (let j = i; j >= 0; j -= 1) {
      const m = /^\s*function ([A-Za-z0-9_]+)\(/.exec(codeLines[j]);
      if (m) { owner = m[1]; break; }
    }
    offenders.push(owner + '() line ' + (i + 1) + ': ' + line.trim());
  });

  assert.deepEqual(offenders, [],
    'these lines name the picked window and are not on the freeze list. Either the sentence '
    + 'should go through coveredWords(), or -- if it legitimately names the window rather than '
    + 'scoping a figure -- it needs its own NOT_A_FIGURE entry saying why:\n  '
    + offenders.join('\n  '));
});

/* Round 5, second blocking finding: two of the six `load()` triggers did not
   discard an open run, so a window read racing an in-flight detail read left
   `detail` at `{ loading: true }` for good -- a "One run" band of skeleton
   rows with no Close and nothing keyed, on every later redraw. */
test('reading the window again while a run is open does not strand it as a skeleton', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const dom = await boot({
    detail: held,
    detailFor: '11111111-1111-4111-8111-111111111111',
  });
  buttonsIn(livePanel(dom), /^Open$/)[0].dispatch('click');
  await settle();
  assert.match(liveText(dom), /One run/,
    'the detail band did not draw, so no run is open and this test proves nothing');

  const again = buttonsIn(livePanel(dom), /^Read again$/)[0];
  again.focus();
  again.dispatch('click');
  await settle();
  release({ data: detailAnswer() });
  await settle();

  assert.ok(!/One run/.test(liveText(dom)),
    'a window read racing an open run left the "One run" band on screen; it has no Close and '
    + 'nothing keyed in it, so the operator cannot get out of it');
  assert.equal(buttonsIn(livePanel(dom), /^Close$/).length, 0,
    'the stranded detail band is still drawing controls');
});

test('a failed window read does not strand an open run either', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('upstream refused') : windowAnswer()),
    detail: held,
    detailFor: '11111111-1111-4111-8111-111111111111',
  });
  buttonsIn(livePanel(dom), /^Open$/)[0].dispatch('click');
  await settle();
  assert.match(liveText(dom), /One run/, 'no run is open, so this test proves nothing');

  broken = true;
  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click');
  await settle();
  release({ data: detailAnswer() });
  await settle();
  broken = false;
  buttonsIn(livePanel(dom), /^Try again$/)[0].dispatch('click');
  await settle();

  assert.ok(!/could not be read/.test(liveText(dom)),
    'the recovery read failed, so this test is not looking at a recovered pane');
  assert.ok(!/One run/.test(liveText(dom)),
    'the run opened before the failure is still on screen as a skeleton after recovery');
});

/* Round 4 of review measured the fix above working on the FIRST failure only.
   `settleFocus()` clears the request when it lands, so by the time the
   operator presses the retry the pane just handed them there is no request
   left to redirect: 0 of 15 tab stops, both viewports, in real Chrome. */
test('pressing the retry the pane handed you, onto a read that fails again, still lands', async () => {
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('upstream refused') : windowAnswer()),
  });
  const again = buttonsIn(livePanel(dom), /^Read again$/)[0];
  again.focus();
  broken = true;
  again.dispatch('click');
  await settle();
  assert.equal(focusKey(dom), 'rh-window-retry',
    'the first failure did not land on the retry, so this test never reaches the repeat case');

  const retry = buttonsIn(livePanel(dom), /^Try again$/)[0];
  assert.ok(retry, 'the failure card offered no retry to press');
  retry.dispatch('click');
  await settle();

  assert.match(liveText(dom), /This pane could not be read/,
    'the second read did not fail, so this test is not exercising the repeat failure');
  assert.equal(focusKey(dom), 'rh-window-retry',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after pressing the retry '
    + 'the pane had just handed the operator, so the second failure drops them to the top of '
    + 'the document mid-incident');
});

/* The likelier half of the same defect: a first-load failure, which is how an
   operator most often meets this pane during a rollout. No request was ever
   created, so there was never anything to redirect. */
test('a retry pressed after a first-load failure lands rather than dropping to the document', async () => {
  const dom = await boot({ runs: new Error('the operations API did not answer') });
  const retry = buttonsIn(livePanel(dom), /^Try again$/)[0];
  assert.ok(retry, 'the boot failure offered no retry to press');

  retry.focus();
  assert.equal(focusKey(dom), 'rh-window-retry',
    'the harness did not put focus on the retry, so this test starts outside the pane');
  retry.dispatch('click');
  await settle();

  assert.match(liveText(dom), /This pane could not be read/,
    'the retry succeeded, so this test is not exercising a failure');
  assert.equal(focusKey(dom), 'rh-window-retry',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after retrying a '
    + 'first-load failure');
});

/* The guard the fix must not cost: a read nobody was standing in still must
   not reach out and take focus. */
test('a failed read the operator was not standing in does not take their focus', async () => {
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('upstream refused') : windowAnswer()),
  });
  const outside = dom.doc.getElementById('fRange');
  assert.ok(outside, 'the shell drew no range picker, so there is nowhere outside to stand');
  outside.focus();
  assert.equal(focusKey(dom), null, 'the shell control is keyed, so this test proves nothing');

  broken = true;
  dom.window.dispatchEvent({ type: 'ops:filters', detail: { range: '30d' } });
  await settle();

  assert.match(liveText(dom), /This pane could not be read/,
    'the read did not fail, so this test is not exercising the failure path');
  assert.equal(dom.doc.activeElement, outside,
    'a failed read the operator was not standing in pulled focus into the pane');
});

/* Clearing a stale narrowing can land in a window that is itself empty, which
   draws no pickers at all. Measured at 0 of 16 tab stops. */
test('clearing a narrowing into an empty window keeps the operator inside the pane', async () => {
  /* The way an operator reaches it: narrow in a busy window, then move the
     range to a window that is empty narrowed OR not -- the stale narrowing
     `picker()` documents. Clearing it draws no pickers to land on. */
  let quiet = false;
  const dom = await boot({
    runs: (query) => (quiet || (query.type && query.type !== 'all')
      ? emptyWindow() : windowAnswer()),
  });
  const select = selectsIn(dom)[0];
  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();
  quiet = true;
  dom.window.dispatchEvent({ type: 'ops:filters', detail: { range: '30d' } });
  await settle();

  const clear = buttonsIn(emptyPanel(dom), /Clear the narrowing/)[0];
  assert.ok(clear, 'the narrowed empty state offered no way to clear the narrowing');
  clear.focus();
  assert.equal(focusKey(dom), 'rh-clear-narrowing',
    'the harness did not put focus on the clear control');

  clear.dispatch('click');
  await settle();

  assert.ok(!/Clear the narrowing/.test(emptyText(dom)),
    'the narrowing was not cleared, so this test is not in the un-narrowed state');
  assert.equal(focusKey(dom), 'rh-state',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after clearing a '
    + 'narrowing into a window that is also empty');
});

/* And the hold the drop must not cost: opening a run redraws twice and Close
   only exists on the second. */
test('opening a run still lands on Close across the two redraws it takes', async () => {
  const dom = await boot({
    detail: detailAnswer(),
    detailFor: '11111111-1111-4111-8111-111111111111',
  });
  const open = buttonsIn(livePanel(dom), /^Open$/)[0];
  open.focus();
  assert.match(focusKey(dom) || '', /^rh-open-/,
    'the harness did not put focus on an Open control');
  open.dispatch('click');
  await settle();

  assert.equal(focusKey(dom), 'rh-detail-close',
    'focus ended at ' + (focusKey(dom) || 'nowhere in this pane') + ' after opening a run, so '
    + 'dropping unlanded requests cost the one case that legitimately needs holding');
});

/* Over a partly covered record the figures are NOT counted over the picked
   window, and the truncation note sat directly above them saying they were --
   phrased as the reassurance, so an operator reading top-down met the false
   claim first and the two true sentences after it. */
test('the truncation note does not claim the whole window over a partly covered record', async () => {
  const since = at(3 * HOUR);
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.truncated = true;
      base.coverage = {
        state: 'partial', recordingSince: since, lastRecordedAt: at(MINUTE), coversWindow: false,
      };
    }),
  });
  const text = liveText(dom);

  assert.match(text, /is the most recent part of this window rather than all of it/,
    'the truncation note did not draw, so this test is not looking at it');
  assert.match(text, /Recording started at/,
    'the partial note did not draw, so the two claims are not on the same screen');
  assert.ok(!/counted over the whole window/.test(text),
    'the truncation note still tells the operator the figures cover the whole window, directly '
    + 'under the note telling them they do not');

  const day = new Date(since);
  const stamp = day.getUTCDate() + ' ' + MONTH_NAMES[day.getUTCMonth()];
  assert.ok(text.indexOf('are counted over everything the record holds, which starts at '
    + stamp) !== -1,
    'the truncation note names no coverage start, so it publishes a figure without the window '
    + 'it covers');
});

/* The rail is the one surface with no controls beside it to explain its
   figure, and it already learned this for narrowing. */
test('the rail badge names the record start rather than the window over partial coverage', async () => {
  const since = at(3 * HOUR);
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'partial', recordingSince: since, lastRecordedAt: at(MINUTE), coversWindow: false,
      };
    }),
  });
  const item = dom.doc.getElementById('rail').querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  assert.ok(item, 'the rail has no What happened item to badge');
  const said = allText(item.querySelectorAll('.nav-badge-sr')[0] || item);
  assert.match(said, /runs failed/, 'no failure badge was drawn, so there is no wording to read');

  const day = new Date(since);
  assert.ok(!/ in this window/.test(said),
    'the badge says "' + said + '" over a record covering three hours of a seven-day window');
  assert.match(said,
    new RegExp('since the record starts at ' + day.getUTCDate() + ' '
      + MONTH_NAMES[day.getUTCMonth()]),
    'the badge published a failure count without naming what it covers');
});

/* Four sites decided "partial" for themselves and two of them left out the
   instant, so a state with `partial` and no `recordingSince` headed "since the
   record starts" over a footer printing the picked window. Not reachable from
   today's route, which is why it is bound here rather than left to it. */
test('a partial state with no record start is not described as one the pane can place', async () => {
  const dom = await boot({
    runs: emptyWindow((base) => {
      base.coverage = {
        state: 'partial', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
    }),
  });
  const text = emptyText(dom);

  assert.match(text, /No run finished/, 'the empty state did not draw');
  assert.ok(!/since the record starts/.test(text),
    'the pane says the record starts somewhere while the route sent no instant, so the '
    + 'heading and the footer under it describe two different windows');
  assert.ok(!/(^|[^\w])(null|undefined|Invalid Date|NaN)([^\w]|$)/.test(text),
    'a missing instant reached the screen as "' + text.slice(0, 120) + '"');
});

/* Review found the narrowed half of the partial-empty state unbound: swapping
   it for the plain narrowed text, which asserts the record "reaches back past
   the start of this window", left the suite green. */
test('a partial window that is also narrowed does not claim the record reaches back', async () => {
  const dom = await boot({
    runs: (query) => (query.type && query.type !== 'all' ? partialEmpty() : windowAnswer()),
  });
  const select = selectsIn(dom)[0];
  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();
  const text = emptyText(dom);

  assert.match(text, /Clear the narrowing/,
    'the narrowed empty state did not draw, so this test is not in the narrowed arm');
  assert.match(text, /No run finished since the record starts/,
    'the narrowed partial state is headed "' + text.slice(0, 60) + '", which does not name the '
    + 'record start');
  assert.ok(!/reaches back past the start of this window/.test(text),
    'a narrowed partial window claims the record reaches back past the start of the window, '
    + 'which is the one thing a partial record does not do');
});

test('the partial-empty state is toned as a warning, not as a settled zero', async () => {
  /* The icon carries no name in the DOM, so the oracle is the drawn glyph:
     the partial state's icon must not be the same shape as the settled
     zero's beside it. */
  const glyph = (dom) => {
    const found = [];
    const walk = (n) => {
      if (n.getAttribute && /(^| )state-icon( |$)/.test(n.getAttribute('class') || '')) {
        const paths = [];
        const dig = (m) => {
          if (m.getAttribute && m.getAttribute('d')) paths.push(m.getAttribute('d'));
          (m.children || []).forEach(dig);
        };
        dig(n);
        found.push(paths.join('|'));
      }
      (n.children || []).forEach(walk);
    };
    walk(emptyPanel(dom));
    return found.join('///');
  };

  const partial = glyph(await boot({ runs: partialEmpty() }));
  const quiet = glyph(await boot({ runs: emptyWindow() }));

  assert.ok(quiet.length, 'the genuine-zero state drew no state icon, so there is no baseline');
  assert.ok(partial.length, 'the partial-empty state drew no state icon');
  assert.notEqual(partial, quiet,
    'the partial-empty state draws the same icon as the settled zero beside it, so the one '
    + 'glance-level signal separating an unread window from a quiet one is gone');
});

test('a failed window read says so, rather than leaving the last figures standing', async () => {
  let broken = false;
  const dom = await boot({
    runs: () => (broken ? new Error('upstream refused') : windowAnswer()),
  });
  await settle();
  assert.match(lastSaid(dom) || '', /\d/,
    'the first read announced no figures, so this test cannot show them being withdrawn');

  broken = true;
  buttonsIn(livePanel(dom), /^Read again$/)[0].dispatch('click');
  await settle();

  const said = lastSaid(dom) || '';
  assert.match(said, /could not be read/,
    'the live region said "' + said + '" after a failed read, so a screen-reader operator is '
    + 'left standing behind figures the pane has stopped standing behind');
  assert.ok(!/\b214\b|\b11 runs\b/.test(said), 'the withdrawn figures were repeated');
});

/* A record that begins inside the window is not a genuine zero, and round 3
   published it as one: headed with the whole window, footed with the whole
   window, and carrying the one sentence this pane uses to separate a measured
   zero from an unread one. */

const partialEmpty = () => emptyWindow((base) => {
  base.coverage = {
    state: 'partial',
    recordingSince: at(3 * HOUR),
    lastRecordedAt: at(3 * HOUR),
    coversWindow: false,
  };
});

test('an empty window over a record that starts inside it is not called quiet', async () => {
  const dom = await boot({ runs: partialEmpty() });
  const text = emptyText(dom);

  assert.match(text, /No run finished/, 'the partial empty window did not draw the empty state');
  assert.ok(!/quiet window rather than a missing one/.test(text),
    'a window the record covers three hours of was called a quiet one, which is the sentence '
    + 'this pane uses to mean the opposite');
  assert.match(text, /unread rather than empty/,
    'nothing on screen said the rest of the window is unread');
  assert.ok(!/^No run finished in the last 7 days/m.test(text),
    'the heading asserted a zero across seven days the record cannot speak for');
});

test('an empty window over a partial record publishes the span it covers, not the one picked',
  async () => {
    const dom = await boot({ runs: partialEmpty() });
    const foot = emptyText(dom);

    /* The two instants are seven days apart, so the calendar day the pane
       prints is enough to tell which one it published -- and the expectation
       is computed from the fixture's own ISO strings rather than read back out
       of the pane, so it cannot move with the code under test. */
    const day = (iso) => {
      const t = new Date(iso);
      return t.getUTCDate() + ' ' + MONTH_NAMES[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
    };
    const recordStarts = day(at(3 * HOUR));
    const windowOpens = day(at(7 * DAY));
    assert.notEqual(recordStarts, windowOpens,
      'the fixture put both instants on the same day, so this test cannot tell them apart');

    const counted = /Counted over ([^,]+?) up to but not including/.exec(foot);
    assert.ok(counted, 'no window was published under the figure at all');
    assert.ok(counted[1].indexOf(recordStarts) === 0,
      'the footer published "' + counted[1] + '", but the record only reaches back to '
      + recordStarts + ', so the figure is labelled with a window it does not cover');
    assert.ok(counted[1].indexOf(windowOpens) === -1,
      'the footer published the picked window the record cannot speak for');
  });

test('a run that could not be read can still be dismissed', async () => {
  /* Without a Close the only control on a failed detail band is the one that
     reloads it, so a run whose read keeps failing is a band the operator
     cannot get rid of -- and the retry beside it asks focus for exactly this
     control by name. Measured in real Chrome before it was added. */
  const dom = await boot({});
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  const band = sectionWithHeading(dom, /One run/);
  assert.ok(band, 'no One run band at all, so this test is not measuring the failure state');
  const text = allText(band);
  assert.match(text, /could not be read/, 'the band is not in its failure state');
  const labels = findAll(band, (n) => n.tagName === 'BUTTON').map((b) => allText(b).trim());
  assert.ok(labels.indexOf('Close') !== -1,
    'a failed run band offers no way out; its controls were ' + JSON.stringify(labels));

  /* Pressing it, not only finding it. A button READING `Close` that does
     nothing passes every assertion above, which is this repo's "asserts a
     mechanism exists, not that it is applied" shape -- and it is the shape
     this test's own name disclaims. */
  buttonsIn(band, /^Close$/)[0].dispatch('click');
  await settle();
  assert.ok(!sectionWithHeading(dom, /One run/),
    'the failed run band is still on screen after Close was pressed');
});

test('Close dismisses the run that was read, not only the one that failed', async () => {
  /* The success band's Close is the pane's whole dismissal path and nothing
     bound that it dismisses: the one focus test that presses it asserts where
     focus went, which resolves whether or not the band survives. */
  const dom = await boot({ detail: detailAnswer() });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  const band = sectionWithHeading(dom, /One run/);
  assert.ok(band, 'no One run band, so this test is not measuring a dismissal');
  assert.ok(!/could not be read/.test(allText(band)),
    'the band is in its failure state, so this is not the success band');
  assert.ok(buttonsIn(band, /^Close$/).length === 1,
    'the success band has ' + buttonsIn(band, /^Close$/).length + ' Close controls');

  buttonsIn(band, /^Close$/)[0].dispatch('click');
  await settle();
  assert.ok(!sectionWithHeading(dom, /One run/),
    'the run band is still on screen after Close was pressed');
  assert.match(lastSaid(dom), /Closed the run/,
    'closing the run said "' + lastSaid(dom) + '", so a screen reader gets no confirmation');
});

test('a second failed attempt leaves the operator on Try again, not on nothing', async () => {
  /* The retry asks for `rh-detail-close` and falls back to itself. The first
     failure is bound elsewhere; this is the SECOND, which goes through the
     fallback inside the retry handler -- a different call site from the one
     in `openRun`. Without it focus lands on a node the redraw removed. */
  const dom = await boot({});
  const open = buttonsIn(livePanel(dom), /^Open$/)[1];
  /* Focused before each press, because the pane only redirects focus when the
     operator was standing in it -- an unfocused click is a programmatic one
     and correctly moves nothing. A test that skips this measures the guard,
     not the handover. */
  open.focus();
  open.dispatch('click');
  await settle();
  const first = sectionWithHeading(dom, /One run/);
  assert.match(allText(first), /could not be read/, 'the first read did not fail');
  assert.equal(focusKey(dom), 'rh-detail-retry', 'the first failure did not land on the retry');

  const retry = buttonsIn(first, /^Try again$/)[0];
  retry.focus();
  retry.dispatch('click');
  await settle();
  const second = sectionWithHeading(dom, /One run/);
  assert.match(allText(second), /could not be read/,
    'the second attempt did not fail, so this test is not measuring a second failure');
  assert.equal(focusKey(dom), 'rh-detail-retry',
    'after a second failure focus is at ' + JSON.stringify(focusKey(dom))
    + ', so the operator is standing on a node the redraw removed');
});

test('a partial state with no instant is not announced as partial at all', async () => {
  /* Every partial sentence names where the record starts. A partial state
     carrying no instant cannot, so the note that ANNOUNCES the shortfall must
     not fire either -- it would publish "Recording started at undefined" and
     then tell the operator to distrust figures that are in fact whole. */
  const answer = windowAnswer((base) => {
    base.coverage = { state: 'partial', recordingSince: null, coversWindow: false };
  });
  const dom = await boot({ runs: answer });
  /* `shownText`, not the region root: a negative assertion read off a panel
     the pane never drew into passes for free, which is how the first version
     of this test stayed green under its own mutation. */
  const txt = shownText(dom);
  assert.ok(/./.test(txt), 'the fixture drew nothing, so the assertions below are vacuous');
  assert.ok(!/Recording started at/.test(txt),
    'announced a record start it has no instant for');
  assert.ok(!/undefined|null|Invalid Date/.test(txt),
    'leaked an absent instant into the page');
});

test('a populated partial window publishes the span it covers too', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'partial', recordingSince: at(2 * DAY), lastRecordedAt: at(3 * MINUTE),
        coversWindow: false,
      };
    }),
  });
  const text = liveText(dom);
  assert.match(text, /where the record starts rather than where/,
    'the figures were footed with the picked window over a record that starts inside it');
});

test('a partly-covered window is announced over the span it covers, not the one picked',
  async () => {
    /* Screen and speech have to publish the same span. The screen was fixed
       for this in round 4; the live region still said "0 runs finished in the
       last 7 days" over a three-hour-old record until this test existed. */
    const dom = await boot({ runs: partialEmpty() });
    await settle();
    const said = lastSaid(dom) || '';

    assert.match(said, /Partly covered/, 'a partly-covered read was announced as a whole one');
    assert.ok(!/finished in the last 7 days/.test(said),
      'the live region said "' + said + '", naming a window the record cannot speak for');
    assert.match(said, /since the record starts at/,
      'nothing spoken said where the figure actually starts');
    assert.match(said, /is unread/, 'nothing spoken said the rest of the window is unread');

    /* The phrase is not the claim: the instant beside it is. Pinning only the
       words let the sentence speak the picked window's start under the label
       "the record starts at" and stay green. Both days computed from the
       fixture's own ISO strings. */
    const day = (iso) => {
      const t = new Date(iso);
      return t.getUTCDate() + ' ' + MONTH_NAMES[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
    };
    const spoken = /since the record starts at ([^,]+?), which is inside/.exec(said);
    assert.ok(spoken, 'the sentence named no instant at all');
    assert.equal(spoken[1].split(' ').slice(0, 3).join(' '), day(at(3 * HOUR)),
      'the live region said the record starts at "' + spoken[1] + '", which is not where it '
      + 'starts');
    assert.ok(spoken[1].indexOf(day(at(7 * DAY))) === -1,
      'the live region spoke the picked window\u2019s start as the record\u2019s start');
  });

test('a window whose runs all moved and never finished is not called quiet', async () => {
  /* The gate that separates the empty state from the populated one reads
     `!summary.unfinished` as well as `!summary.runs`. Without that clause a
     window whose only runs are still in flight draws "No run finished ... a
     quiet window" and drops them off the screen. */
  const dom = await boot({
    runs: emptyWindow((base) => { base.summary.unfinished = 4; }),
  });

  assert.ok(!/quiet window rather than a missing one/.test(emptyText(dom)),
    'a window holding four runs that moved and never finished was called quiet');
  assert.match(liveText(dom), /Runs finished/,
    'runs that moved and never finished emptied the pane instead of being counted');
});

test('a run that arrives is announced, not only the intent to read it', async () => {
  const dom = await boot({ detail: detailAnswer() });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  const said = lastSaid(dom);
  assert.ok(said, 'the pane announced nothing at all');
  assert.ok(!/^Opening one run\.$/.test(said),
    'the last thing said was the intent, so a screen reader is told a read started and never ' +
    'told how it ended');
  assert.match(said, /Nutrition plan/,
    'the arrival said "' + said + '", which does not name the run that landed');
});

test('a run that fails to arrive says so, rather than leaving the intent standing', async () => {
  const dom = await boot({});
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  const said = lastSaid(dom);
  assert.ok(!/^Opening one run\.$/.test(said),
    'a failed read left "Opening one run." as the last thing said');
  assert.match(said, /could not be read/,
    'the failure said "' + said + '", which does not say the read failed');
});

test('nothing starts a timer, of any of the three kinds', async () => {
  /* The whole of this pane's answer to "what stops it when the operator
     leaves". Nothing is started, so nothing has to be stopped.

     All three kinds, because a poll can be written with any of them and only
     one of them is called an interval. Boot alone is not the whole claim, so
     the two things that redraw without a fresh selection -- Read again and
     opening a run -- are driven here too. */
  const dom = await boot({});
  assert.deepEqual(
    { intervals: dom.timers.intervals, timeouts: dom.timers.timeouts, frames: dom.timers.frames },
    { intervals: 0, timeouts: 0, frames: 0 },
    'boot started a timer, so the pane keeps working after the operator has gone and ' +
    'something now has to stop it');

  buttonsIn(livePanel(dom), /Read again/)[0].dispatch('click');
  await settle();
  buttonsIn(livePanel(dom), /^Open$/)[0].dispatch('click');
  await settle();

  assert.deepEqual(
    { intervals: dom.timers.intervals, timeouts: dom.timers.timeouts, frames: dom.timers.frames },
    { intervals: 0, timeouts: 0, frames: 0 },
    'reading again or opening a run started a timer');
});

test('Read again re-reads with the selection that is on screen', async () => {
  const dom = await boot({ query: '?range=30d' });
  const again = buttonsIn(livePanel(dom), /Read again/)[0];
  assert.ok(again, 'there is no way to take a fresh reading');
  again.dispatch('click');
  await settle();
  const calls = runCalls(dom);
  assert.equal(calls.length, 2, 'Read again did not read');
  assert.equal(calls[1].query.range, '30d',
    'Read again dropped back to the default window rather than the one on screen');
});

/* ========================= why things failed =========================== */

test('a failure with no label says so rather than leaving the cell blank', async () => {
  const dom = await boot({});
  const rows = rowsOfTable(dom, /Why things failed/);
  assert.equal(rows.length, 2, 'the failure groups did not reach the table');
  assert.match(allText(rows[1]), /No reason recorded/,
    'an unlabelled failure drew an empty reason, which reads as a missing row rather than a ' +
    'run whose worker recorded no label');
});

test('retryable has three answers, not two', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.failures[1].retryable = false;
    }),
  });
  const rows = rowsOfTable(dom, /Why things failed/).map(allText);
  assert.match(rows[0], /\bYes\b/, 'a retryable failure did not say so');
  assert.match(rows[1], /\bNo\b/, 'a failure the worker called permanent did not say so');

  const unknown = await boot({});
  assert.match(allText(rowsOfTable(unknown, /Why things failed/)[1]), /Not recorded/,
    'a failure the worker said nothing about was drawn as a definite No, which puts a word ' +
    'on screen the record does not have');
});

test('a reason seen in more than one request type says so', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.failures[0].byType.push({
        type: { value: 'program_generation', label: 'Training program', labelled: true },
        runs: 1,
      });
    }),
  });
  assert.match(allText(rowsOfTable(dom, /Why things failed/)[0]), /and 1 other request type/,
    'a reason spanning two request types was drawn as though it only ever hit one');
});

/* ============================== one run ================================ */

test('opening a run reads that run, and draws its transitions in order', async () => {
  const dom = await boot({ detail: detailAnswer() });
  const open = buttonsIn(livePanel(dom), /^Open$/);
  assert.ok(open.length >= 2, 'the run list has no way into a single run');
  open[1].dispatch('click');
  await settle();

  const detailCall = dom.calls
    .filter((c) => c.endpoint === '/api/ops/runs/22222222-2222-4222-8222-222222222222')[0];
  assert.ok(detailCall, 'opening a run read nothing');
  assert.equal(detailCall.query.range, '7d',
    'the run was read without the window, so the comparison beside it covers a different ' +
    'window from the figures above it');

  const section = sectionWithHeading(dom, /One run/);
  assert.ok(section, 'the run did not draw');
  const stageList = findAll(section,
    (n) => (n.getAttribute('class') || '').split(/\s+/).includes('rh-stage-list'))[0];
  assert.ok(stageList, 'the transition list did not draw');
  const steps = findAll(stageList, (n) => n.tagName === 'LI').map(allText);
  assert.equal(steps.length, 3, 'the transition list dropped a step');
  assert.match(steps[0], /Queued/);
  assert.match(steps[1], /Running/);
  assert.match(steps[2], /Failed/);
  assert.match(allText(section), /Picked up by a worker.*2 times/s,
    'a run that was retried did not say it had been picked up twice');
});

test('the shared-fault card names what the record covers, not the window picked', async () => {
  /* The card review found saying "Everything in this window" over a record
     three hours old. The source guard freezes the site, but it cannot see a
     window spelled longhand, so the binding that matters is this one: the
     card is DRAWN over a partly covered window and read back. */
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'partial', recordingSince: at(3 * HOUR), lastRecordedAt: at(MINUTE),
        coversWindow: false,
      };
    }),
    detail: detailAnswer(),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  const card = sectionWithHeading(dom, /One run/);
  assert.ok(card, 'no One run band, so the shared-fault card was never drawn');
  const text = allText(card);
  assert.match(text, /happening to other people/i,
    'the shared-fault card is not on screen, so this test is not reading it');
  assert.ok(!/last 7 days|7 days|this window|the window you picked/.test(text),
    'the shared-fault card scoped itself to the picked window over a partly covered '
    + 'record; it said: ' + JSON.stringify(text.slice(0, 200)));
  assert.match(text, /what the record covers, which starts at/,
    'the card does not name the span it can actually speak for');
});

test('a run that failed says how many other runs and accounts hit the same fault', async () => {
  const dom = await boot({ detail: detailAnswer() });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  const text = allText(sectionWithHeading(dom, /One run/));
  assert.match(text, /happening to other people/i,
    'the question this pane is named for was not answered');
  assert.match(text, /Runs that hit it/);
  assert.match(text, /Accounts affected/);
  assert.match(text, /1 run had no account left to count/,
    'runs whose account has been deleted were folded into the account figure, which ' +
    'undercounts the accounts and overcounts nothing');
});

test('an uncounted fault says nobody could be counted, not that nobody was hit', async () => {
  /* The route sends null rather than nought when the window holds no run under
     the label. Drawing `0` here would be a confident reassurance over an empty
     read, which is the defect this whole pane exists to make impossible. */
  const dom = await boot({
    detail: detailAnswer((base) => {
      base.shared.runs = null;
      base.shared.accounts = null;
      base.shared.runsWithoutAccount = null;
      base.shared.firstSeenAt = null;
      base.shared.lastSeenAt = null;
      /* Null, matching the wire: `[]` would be the comparison having run and
         found no other request type, which is a counted zero. */
      base.shared.byType = null;
      base.shared.isolated = null;
      base.shared.countIncludesThisRun = false;
    }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  const text = allText(sectionWithHeading(dom, /One run/));
  assert.match(text, /Nobody could be counted/, 'an empty count drew no explanation at all');
  assert.match(text, /not a count of nought/,
    'the pane did not say that nothing counted is different from nobody hit');
  assert.doesNotMatch(text, /Runs that hit it/,
    'an empty count still drew the figure grid, so absence was rendered as a number');
  assert.doesNotMatch(text, /only run that hit it/,
    'an empty count was read as proof this run is alone');
});

test('a run outside the compared window refuses to call itself isolated', async () => {
  const dom = await boot({
    detail: detailAnswer((base) => {
      base.shared.runs = 1;
      base.shared.accounts = 1;
      base.shared.isolated = null;
      base.shared.countIncludesThisRun = false;
    }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  const text = allText(sectionWithHeading(dom, /One run/));
  assert.match(text, /finished outside the window these figures cover/,
    'figures taken over a window this run is not in were presented as being about it');
  assert.match(text, /Counted, but not around this run/,
    'the heading answered a question the figures cannot answer about this run');
  assert.doesNotMatch(text, /only run that hit it/,
    'a count that never saw this run was read as proof it is alone');
  assert.match(text, /Runs that hit it/,
    'the figures were true about the window and should still be shown');
});

test('a run that did not fail says there is nothing to compare, rather than comparing to nothing', async () => {
  const dom = await boot({
    detail: detailAnswer((base) => {
      base.run.outcome = 'completed';
      base.run.outcomeLabel = 'Worked';
      base.run.failureCode = null;
      base.shared = null;
    }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  const text = allText(sectionWithHeading(dom, /One run/));
  assert.match(text, /did not fail, so there is no fault to compare/,
    'a run that worked drew a comparison card with nothing in it');
  assert.doesNotMatch(text, /Runs that hit it/,
    'a run that worked drew a count of how many others hit a fault it never had');
});

test('a failed run read degrades the pane rather than emptying it', async () => {
  const dom = await boot({ detail: new Error('the run could not be read') });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  assert.equal(stateOf(dom), 'degraded',
    'one unreadable run took the whole pane down to a live or empty state');
  const text = liveText(dom);
  assert.match(text, /This run could not be read/, 'the failed read was silent');
  assert.match(text, /Runs finished/,
    'a failed detail read emptied the window figures, which had come back perfectly well');
  assert.ok(buttonsIn(livePanel(dom), /Try again/).length,
    'a failed run read offered no way to try it again');
});

test('the stage list says when it is not the whole run', async () => {
  const dom = await boot({
    detail: detailAnswer((base) => { base.stagesTruncated = true; }),
  });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  assert.match(allText(sectionWithHeading(dom, /One run/)), /more transitions than this page reads/,
    'a run whose transition list hit its ceiling was drawn as though it were complete');
});

/* ======================= the list is a page ============================= */

test('a truncated list says it is the newest part of the window, not all of it', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => { base.truncated = true; base.summary.runs = 4000; }),
  });
  const text = liveText(dom);
  assert.match(text, /newest 50/, 'a page of 50 out of 4,000 was drawn as the whole window');
  assert.match(text, /counted over the whole window/,
    'nothing said the figures above the list still cover everything, so the truncation ' +
    'reads as applying to them too');

  const whole = await boot({});
  assert.doesNotMatch(liveText(whole), /newest 50/,
    'a complete list was also called truncated, so the warning means nothing');
});

/* ===================== every figure carries its window ================== */

test('the window is printed, as an interval rather than a name', async () => {
  const dom = await boot({});
  assert.match(liveText(dom), /Counted over .* up to but not including .* UTC/,
    'the figures carry no window, so "3 failed" is a claim about an unstated period');
});

test('a request type this build has no name for still draws, and says it has no name', async () => {
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.runs = [runRow({ type: { value: 'future_type', label: 'future_type', labelled: false } })];
    }),
  });
  assert.match(allText(rowsOfTable(dom, /The runs/)[0]), /no name for/,
    'a request type with no label printed its raw token as though it were a name');
});

test('an unnamed request type is named as unnamed in the control too, not only the table',
  async () => {
    const dom = await boot({
      runs: windowAnswer((base) => {
        base.facets.types = [
          { value: 'future_type', label: 'future_type', labelled: false, runs: 4 },
        ];
      }),
    });
    /* The control and the rows under it have to agree. A picker printing the
       raw token beside a table saying the page has no name for it reads as
       two different request types, and the operator picks between them. */
    const options = findAll(livePanel(dom), (n) => n.tagName === 'OPTION')
      .map((n) => allText(n))
      .filter((t) => t.includes('future_type'));
    assert.ok(options.length, 'the control does not offer the unnamed type at all');
    for (const text of options) {
      assert.match(text, /no name on this page/,
        'the control offers "' + text + '", printing a raw token as though it were a name');
    }
  });

/* ============================ privacy ================================== */

test('run content is hidden at every role, the owner included', async () => {
  for (const role of ['owner', 'operator', 'viewer']) {
    const dom = await boot({ role });
    const text = liveText(dom);
    assert.match(text, /What was asked/, `${role}: the privacy band is missing`);
    assert.match(text, /What Aria answered/, `${role}: the privacy band is incomplete`);
    assert.match(text, /Athlete details the run read/, `${role}: the privacy band is incomplete`);
    assert.equal(buttonsIn(livePanel(dom), /Reveal|Unlock|Show/).length, 0,
      `${role}: a reveal control is on the page, and this pane records no reveal`);
  }
});

test('a locked row carries a field name and no value node at all', async () => {
  const dom = await boot({});
  const rows = findAll(livePanel(dom),
    (n) => (n.getAttribute('class') || '').split(/\s+/).includes('locked-row'));
  assert.equal(rows.length, 3, 'the locked rows did not draw');
  for (const row of rows) {
    const text = allText(row);
    assert.match(text, /Hidden/, 'a locked row did not say it was hidden');
    assert.match(text, /Never shown here/,
      'a locked row left open the possibility of a reveal on a pane that records none');
    assert.doesNotMatch(text, /[•●▪]{3,}|\*{3,}/,
      'a locked row drew a masked value, so a value node exists for a later change to fill');
  }
});

test('the guarantees are on screen as sentences, not as properties of the code', async () => {
  const dom = await boot({});
  const text = liveText(dom);
  for (const claim of [
    /sends no account identity at all/,
    /stay out of the run table/,
    /recorded by field name and never by content/,
    /athlete can see that a reveal happened/,
    /outlive the view/,
  ]) {
    assert.match(text, claim, 'a guarantee is in the code but not on the page');
  }
});

test('address-shaped text is masked before it reaches the screen', async () => {
  /* The route sends no address. That is a fact about today's route rather than
     a promise it makes, so the pane enforces it on every payload string it
     draws rather than trusting it. */
  const dom = await boot({
    runs: windowAnswer((base) => {
      base.failures[0].failureCode = 'bounced_for_athlete@example.invalid';
      base.runs[0].modelUsed = 'model-for-coach@example.invalid';
      base.facets.types[0].label = 'Plans for athlete@example.invalid';
    }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /@example\.invalid/,
    'an address in the payload reached the screen');
  assert.match(text, /\[hidden contact detail\]/,
    'the address was deleted silently, so the sentence has an unexplained hole in it');
});

/* The same floor, on the surfaces a screen reader reads. The test above reads
   the visible panel only; the announcement and the rail's badge description
   are written outside it, and review of PR #117 found both carrying an address
   the panel had masked, so a screen-reader operator was read what the pane had
   decided not to show. The failed-detail sentence is drawn in the panel but
   comes from the API's own error text. */
test('address-shaped text is masked on the surfaces a screen reader reads', async () => {
  const ADDRESS = /@example\.invalid/;

  const opened = await boot({
    detail: detailAnswer((base) => {
      base.run.type.label = 'Plans for athlete@example.invalid';
      base.run.outcomeLabel = 'Failed for coach@example.invalid';
    }),
  });
  buttonsIn(livePanel(opened), /^Open$/)[1].dispatch('click');
  await settle();
  const announced = lastSaid(opened) || '';
  assert.match(announced, /finished .*recorded\./,
    'opening a run announced "' + announced + '", which is not the run sentence this reads');
  assert.doesNotMatch(announced, ADDRESS,
    'the announcement read out "' + announced + '", an address the panel masks');
  assert.match(announced, /\[hidden contact detail\]/,
    'the announcement dropped the address silently: "' + announced + '"');
  /* The same run, on the card it opened: the heading is visible text built
     from the same two fields. */
  const card = liveText(opened);
  assert.match(card, /Plans for \[hidden contact detail\] \u00b7 /,
    'the opened run card has no heading built from the run, so the check below reads nothing');
  assert.doesNotMatch(card, ADDRESS,
    'the opened run card printed an address the announcement masks');
  assert.match(card, /\u00b7 Failed for \[hidden contact detail\]/,
    'the run card heading dropped the outcome rather than masking it');

  const narrowed = await boot({
    runs: windowAnswer((base) => {
      base.facets.types[0].label = 'Plans for athlete@example.invalid';
      base.facets.outcomes[1].label = 'Failed for coach@example.invalid';
    }),
  });
  const typeSelect = selectsIn(narrowed)[0];
  typeSelect.value = 'nutrition_plan';
  typeSelect.dispatch('change');
  await settle();
  const outcomeSelect = selectsIn(narrowed)[1];
  outcomeSelect.value = 'failed';
  outcomeSelect.dispatch('change');
  await settle();
  const item = narrowed.doc.getElementById('rail').querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  const sr = item && item.querySelectorAll('.nav-badge-sr')[0];
  const badgeSaid = sr ? allText(sr) : '';
  assert.match(badgeSaid, /among .* and .* only$/,
    'the badge said "' + badgeSaid + '", so both narrowings are not on the path this reads');
  assert.doesNotMatch(badgeSaid, ADDRESS,
    'the rail badge read out "' + badgeSaid + '", an address the picker masks');
  assert.equal((badgeSaid.match(/\[hidden contact detail\]/g) || []).length, 2,
    'the badge did not mask both narrowings: "' + badgeSaid + '"');

  /* A narrowing the new window no longer holds is named by its raw value,
     and that value is still the route's: the picker option it came from was
     built out of the facets. */
  const dropped = await boot({
    runs: windowAnswer((base) => {
      base.facets.types[0].value = 'nutrition_plan_for_athlete@example.invalid';
    }),
  });
  const droppedSelect = selectsIn(dropped)[0];
  droppedSelect.value = 'nutrition_plan_for_athlete@example.invalid';
  droppedSelect.dispatch('change');
  await settle();
  dropped.answers['/api/ops/runs'] = windowAnswer((base) => {
    base.facets.types = [
      { value: 'program_generation', label: 'Training program', labelled: true, runs: 5 },
    ];
  });
  buttonsIn(livePanel(dropped), /Read again/)[0].dispatch('click');
  await settle();
  const droppedItem = dropped.doc.getElementById('rail').querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  const droppedSr = droppedItem && droppedItem.querySelectorAll('.nav-badge-sr')[0];
  const droppedSaid = droppedSr ? allText(droppedSr) : '';
  assert.match(droppedSaid, /among .* only$/,
    'the badge said "' + droppedSaid + '", so the dropped narrowing is not on the path this reads');
  assert.doesNotMatch(droppedSaid, ADDRESS,
    'the rail badge read out "' + droppedSaid + '" for a narrowing the window no longer holds');
  assert.match(droppedSaid, /among \[hidden contact detail\] only$/,
    'the badge dropped the narrowing rather than masking it: "' + droppedSaid + '"');

  const failed = await boot({ detail: new Error('No run for athlete@example.invalid') });
  buttonsIn(livePanel(failed), /^Open$/)[1].dispatch('click');
  await settle();
  const band = allText(sectionWithHeading(failed, /One run/));
  assert.match(band, /This run could not be read/, 'the band is not in its failure state');
  assert.doesNotMatch(band, ADDRESS,
    'the failed run band printed the API\'s error text with an address in it');
  assert.match(band, /No run for \[hidden contact detail\]/,
    'the failed run band dropped the API\'s message rather than masking it: "' + band + '"');
});

test('no job id reaches the screen', async () => {
  /* A job id is not a person, and it is also not an operator-facing fact: it
     is a join key. Printing one invites it to be pasted somewhere that
     resolves it to an account. */
  const dom = await boot({ detail: detailAnswer() });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();
  assert.doesNotMatch(liveText(dom), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    'a job id was printed on the page');
});

/* ==================== what it cannot answer yet ======================== */

test('the four things this pane cannot answer are named rather than drawn empty', async () => {
  const dom = await boot({});
  const section = sectionWithHeading(dom, /cannot answer yet/);
  assert.ok(section, 'the band naming the gaps is gone, so the gaps are invisible');
  const text = allText(section);
  assert.match(text, /What a run cost/, 'the missing cost figure is not named');
  assert.match(text, /Who the run was for/, 'the missing identity is not named');
  assert.match(text, /Which app asked/, 'the missing app facet is not named');
  assert.match(text, /refused on safety grounds/i, 'the missing refused outcome is not named');
  assert.doesNotMatch(liveText(dom), /\$\d/,
    'a dollar figure is on the page, and nothing behind it can produce one');
});

/* The band's own subtitle promises the gaps are "named rather than drawn as an
   empty figure", and a name with no reason under it is the same dead end as an
   empty figure: the operator learns the pane will not answer and not why, so
   they cannot tell a deliberate refusal from a broken read. The titles above
   are bound; nothing bound the reasons, so all four could be emptied and this
   file stayed green. Asserted as presence and not as wording, because pinning
   the sentences would freeze the copy rather than the contract. */
test('every gap the pane names carries a reason, not just a title', async () => {
  const dom = await boot({});
  const section = sectionWithHeading(dom, /cannot answer yet/);
  const items = section.querySelectorAll('.omit-item');
  assert.equal(items.length, 4, 'the band no longer draws four gaps');
  for (const item of items) {
    const title = allText(item.querySelectorAll('.omit-title')[0] || null).trim();
    const descNode = item.querySelectorAll('.omit-desc')[0];
    assert.ok(descNode, `"${title}" is named with no reason node at all`);
    const desc = allText(descNode).trim();
    assert.ok(desc.length > 0, `"${title}" is named with an empty reason`);
    assert.notEqual(desc, title, `"${title}" repeats its own title instead of giving a reason`);
  }
});

/* ============================== the rail =============================== */

test('the rail badge counts failures, and clears rather than zeroing when nothing was read', async () => {
  const withFailures = await boot({});
  const rail = withFailures.doc.getElementById('rail');
  const item = rail.querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  assert.ok(item, 'the rail has no What happened item to badge');
  assert.match(allText(item), /\b3\b/, 'three failed runs did not reach the rail');

  const unread = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'never_recorded', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
      base.summary.runs = 0; base.summary.failed = 0; base.summary.completed = 0;
      base.summary.canceled = 0; base.summary.unfinished = 0;
      base.runs = []; base.failures = [];
    }),
  });
  const unreadItem = unread.doc.getElementById('rail').querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  assert.equal(unreadItem.querySelectorAll('.nav-badge').length, 0,
    'a pipeline that never recorded put a 0 beside the pane name, which states as fact the ' +
    'one thing the pane does not know');
});

test('a readable window with nothing failing clears the badge rather than printing a zero',
  async () => {
    /* The other half of the same rule, and the half the never-recorded case
       cannot reach: here the record IS readable and the window IS a genuine
       zero. A 0 beside the pane name still reads, at a glance down the rail,
       as a figure that was measured -- which is the one thing a cleared badge
       and a zeroed one disagree about. */
    const quiet = await boot({
      runs: windowAnswer((base) => {
        base.summary.failed = 0;
        base.summary.completed = base.summary.runs;
        base.failures = [];
        base.runs = base.runs.map((r) => ({ ...r, outcome: 'completed', failureCode: null }));
      }),
    });
    const item = quiet.doc.getElementById('rail').querySelectorAll('.nav-item')
      .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
    assert.equal(item.querySelectorAll('.nav-badge').length, 0,
      'a readable window with no failures put "' + allText(item) + '" on the rail, so a ' +
      'measured zero and an unread pane look the same from the rail');
  });

test('the rail badge says what it counted, once the operator narrows the window', async () => {
  /* The rail is the one place on screen with no controls beside it. A 3 that
     becomes a 1 because the operator narrowed to one request type is a
     different number over a different set, and nothing next to it says so. */
  const dom = await boot({});
  const railItem = () => dom.doc.getElementById('rail').querySelectorAll('.nav-item')
    .filter((n) => n.getAttribute('data-rail-id') === 'history')[0];
  const said = () => {
    const sr = railItem().querySelectorAll('.nav-badge-sr')[0];
    return sr ? allText(sr) : null;
  };

  assert.match(said() || '', /3 runs failed in this window$/,
    'unnarrowed, the badge said "' + said() + '"');

  const select = selectsIn(dom)[0];
  select.value = 'nutrition_plan';
  select.dispatch('change');
  await settle();

  assert.match(said() || '', /among Nutrition plan only$/,
    'after narrowing to one request type the badge said "' + said() + '", which publishes a ' +
    'count without the set it covers: the rail reads as every failure in the window');
});

/* ============================ the whole read =========================== */

test('a failed window read degrades the pane and says the figures are unread', async () => {
  const dom = await boot({ runs: new Error('the operations API did not answer') });
  assert.equal(stateOf(dom), 'degraded', 'a failed read emptied the pane');
  const text = liveText(dom);
  assert.match(text, /could not be read/);
  assert.match(text, /unread, not absent/,
    'a failed read did not say its blanks are unread rather than zero');
  assert.ok(buttonsIn(livePanel(dom), /Try again/).length, 'a failed read offered no retry');
});

/* ============================== doorways =============================== */

test('every doorway points at the pane the registry says owns it', async () => {
  const dom = await boot({});
  const links = findAll(livePanel(dom), (n) => n.tagName === 'A')
    .map((n) => (n.getAttribute('href') || '').split('?')[0])
    .filter((href) => href && href.endsWith('.html'));
  assert.ok(links.length, 'the pane offers no doorway to the panes that own what it cannot say');

  /* The three panes are named here as ids and resolved to files through the
     registry, rather than compared against "some file the registry declares".
     The weaker form passes while a doorway points at the wrong pane, because
     every pane's file is a file the registry declares — which is the defect
     this test is named for. */
  const panes = dom.window.OpsPaneShell.panes;
  const fileOf = (id) => {
    assert.ok(panes[id], 'the registry no longer declares ' + id);
    return panes[id].file;
  };
  assert.deepEqual([...new Set(links)].sort(), [fileOf('alerts'), fileOf('users')].sort(),
    'the drawn pane offers ' + [...new Set(links)].join(', ') + ': what the watchers caught '
    + 'belongs to Problems and where a reveal is recorded to Look up a user.');

  /* The empty states carry a different doorway, because what an operator
     wants from a pane with nothing in it is the pane that has something. */
  const bare = await boot({
    runs: windowAnswer((base) => {
      base.coverage = {
        state: 'never_recorded', recordingSince: null, lastRecordedAt: null, coversWindow: false,
      };
      base.runs = [];
      base.failures = [];
    }),
  });
  const bareLinks = [...new Set(findAll(emptyPanel(bare), (n) => n.tagName === 'A')
    .map((n) => (n.getAttribute('href') || '').split('?')[0])
    .filter((href) => href && href.endsWith('.html')))].sort();
  assert.deepEqual(bareLinks, [fileOf('alerts'), fileOf('jobs')].sort(),
    'the unread pane offers ' + bareLinks.join(', ') + ': what is running now belongs to '
    + 'Happening now, and what the watchers caught to Problems.');
});

/* ============================= the page ================================ */

test('the page mentions no API path, because only scripts are parsed', () => {
  assert.doesNotMatch(PAGE_SRC, /\/api\/ops/,
    'an ops path in the HTML reds the route-parity guard in the backend repository');
});

test('the page no longer loads the alerting model it no longer uses', () => {
  assert.doesNotMatch(PAGE_SRC, /alerts-model\.js/,
    'the page still loads the Problems pane model, which this pane no longer reads');
});

test('every glyph is decorative and no status is a glyph alone', async () => {
  const dom = await boot({ detail: detailAnswer() });
  buttonsIn(livePanel(dom), /^Open$/)[1].dispatch('click');
  await settle();

  const svgs = findAll(livePanel(dom), (n) => n.tagName === 'svg');
  assert.ok(svgs.length, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true',
      'a glyph is exposed to a screen reader, so its shape is carrying meaning');
  }
  for (const pill of findAll(livePanel(dom),
    (n) => (n.getAttribute('class') || '').split(/\s+/).includes('pill'))) {
    assert.ok(allText(pill).trim().length,
      'a status pill is colour alone, so it says nothing to anyone who cannot see the hue');
  }
});

test('the bar offers a window and nothing else, and says why', async () => {
  const dom = await boot({});
  const bar = findAll(dom.root,
    (n) => (n.getAttribute('class') || '').split(/\s+/).includes('filters'))[0];
  assert.ok(bar, 'the pane drew no filter bar at all');

  const labels = findAll(bar,
    (n) => (n.getAttribute('class') || '').split(/\s+/).includes('filter-label'))
    .map((n) => allText(n));
  assert.deepEqual(labels, ['Range'],
    'the bar drew ' + labels.join(', ') + '. Only the window narrows anything at the shell ' +
    'level here, which is why the registry declares only that.');

  assert.match(allText(bar), /no app or environment/,
    'the bar dropped two controls and does not say why');
  const offered = findAll(bar, (n) => n.tagName === 'OPTION')
    .map((n) => n.getAttribute('value'));
  assert.deepEqual(offered, ['24h', '7d', '30d'],
    'the bar offered ' + offered.join(', ') + ' rather than the three windows this pane ' +
    'really applies');
  assert.ok(!offered.includes('custom'),
    'a custom window is offered, and no bar on this dashboard can supply a start and an end');
});

test('a window the pane does not offer is clamped back to the one it starts on', async () => {
  const dom = await boot({ query: '?range=custom' });
  assert.equal(runCalls(dom)[0].query.range, '7d',
    'a window nobody offers reached the read, where it can only be refused');
});
