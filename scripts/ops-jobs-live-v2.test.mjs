/* Unit tests for ops/assets/pane-jobs-live-v2.js — Happening now, reading the
   real /api/ops/jobs route (Stadiora/Aria#5562).

   WHERE THE FIXTURES COME FROM, AND WHY IT IS THE FIRST THING IN THIS FILE

   The round-1 review of PR #120 found two defects of the same shape: the pane
   read `lane.jobTypes` as objects when the route publishes `string[]`, and
   mapped `capacity.reason` through a lookup keyed on codes the route never
   emits. Both survived a green suite, because the fixtures were hand-written
   from the same guess as the pane. They agreed with each other and neither
   agreed with the route. That is "the expectation is derived from the thing
   under test" wearing an unfamiliar coat.

   So the fixture here is not written. `scripts/fixtures/ops-jobs-live-view.json`
   is the literal output of app-backend's `buildOpsJobsView`, captured from the
   merged route (Stadiora/Aria PR #10828, 365d3aaa9) by calling the function
   under tsx and writing what it returned. Every test below deep-merges its
   case onto that payload, so the SHAPE is the route's by construction and only
   the values under test are this file's. A field renamed in app-backend makes
   these tests read `undefined` and go red, which is the point.

   The timestamps in the capture are re-based onto the current instant on every
   load — see `viewFixture` — because a fixed date in a fixture ages into a
   different test.

   WHAT THIS PANE EXISTS TO GET RIGHT

   Absence is never zero. The whole reason this pane was worth building is that
   `Happening now` used to say "The live queue is not being served yet", and the
   thing that replaces it must not swing the other way and print a confident
   zero over a read that failed. So most of what is below drives an absent,
   unread, bounded or contradictory payload and asserts on the sentence.

   Every test here has a published mutation in the pull request: the file, the
   line, the edit, and the place the edit goes back. A test with no such line
   pins nothing.

   The refresh tests use a controllable clock installed over the harness's
   `setTimeout`, which otherwise runs its callback immediately and would make
   the pane's own chain unbounded. The clock records delays, so the backoff is
   asserted as numbers rather than inferred from wall time. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const PANE_SRC = read('assets/pane-jobs-live-v2.js');
const PAGE_SRC = read('jobs-live.html');

const CAPTURE = JSON.parse(
  readFileSync(new URL('./fixtures/ops-jobs-live-view.json', import.meta.url), 'utf8'),
);

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const ENDPOINT = '/api/ops/jobs';

/* ------------------------------------------------------------- fixtures */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* Arrays and nulls replace wholesale; objects merge key by key. A test that
   wants one lane says so with a one-element array rather than by describing
   the two it does not care about, and a test that wants a field GONE says
   `undefined` — which `merge` deletes, because that is the only way to drive
   the absence branches. */
function merge(base, patch) {
  if (!isObject(patch)) return patch;
  const out = isObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete out[key];
    else out[key] = merge(out[key], patch[key]);
  }
  return out;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/* The capture, with every ISO instant in it shifted so that `generatedAt`
   lands on now. Ages the pane derives from those instants therefore read the
   same on every run, whatever the capture's own date was. */
function viewFixture(patch) {
  const shift = Date.now() - Date.parse(CAPTURE.generatedAt);
  const rebase = (value) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) {
      return new Date(Date.parse(value) + shift).toISOString();
    }
    if (Array.isArray(value)) return value.map(rebase);
    if (isObject(value)) {
      const out = {};
      for (const key of Object.keys(value)) out[key] = rebase(value[key]);
      return out;
    }
    return value;
  };
  return merge(rebase(CAPTURE), patch === undefined ? {} : patch);
}

/* A job row in the route's shape. Defaults come off the capture's first job so
   a field this factory forgets is still the route's. */
const jobFixture = (patch) => merge(clone(CAPTURE.workingSet.jobs[0]), patch || {});
const laneFixture = (patch) => merge(clone(CAPTURE.queue.lanes[0]), patch || {});

/* --------------------------------------------------------------- booting */

function buildPage(dom, body) {
  const add = (parent, tag, attrs) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  /* The shell reads its pane id off the body, and builds its own #content
     inside #app once the session resolves. Everything here is the markup
     ops/jobs-live.html ships; nothing below it is the pane's. */
  body.setAttribute('data-pane', 'jobs');
  body.className = 'is-booting';
  const boot = add(body, 'main', { class: 'gate gate-boot gate-center' });
  add(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  add(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = add(body, 'div', { class: 'gate gate-app' });
  add(appGate, 'div', { id: 'app' });
}

/* A clock that records rather than runs. The harness's own setTimeout calls
   its callback synchronously, which would turn this pane's refresh chain into
   an unbounded loop the moment it booted; and a chain that runs itself cannot
   be asked when it meant to run. */
function makeClock() {
  let seq = 0;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    setTimeout(fn, delay) {
      seq += 1;
      pending.set(seq, fn);
      delays.push(delay);
      return seq;
    },
    clearTimeout(id) { pending.delete(id); },
    /** How many timers are armed right now. */
    get armed() { return pending.size; },
    /** Fire every armed timer once, in order. */
    async fire() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, fn] of due) fn();
      await settle();
    },
  };
}

async function boot(options) {
  const opts = options || {};
  const calls = [];
  /* A list of answers consumed one per read, so a test can say "this read
     works, the next ones fail". The last entry repeats once the list runs
     out — a refresh loop makes more reads than a test wants to enumerate. */
  const answers = opts.answers
    || [opts.view === undefined ? viewFixture() : opts.view];

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/jobs-live.html' + (opts.query || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  const clock = makeClock();
  dom.window.setTimeout = clock.setTimeout;
  dom.window.clearTimeout = clock.clearTimeout;

  const role = opts.role || 'owner';
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => (roles || []).indexOf(role) !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-jobs-live-v2.js' });

  const applied = [];
  const realApply = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    applied.push(String(state));
    return realApply.apply(this, arguments);
  };

  await settle();

  return {
    ...dom, body, calls, applied, clock,
    content: dom.doc.getElementById('content'),
  };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
}

function panelFor(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1)[0];
}

const livePanel = (dom) => panelFor(dom, 'live');
const paneText = (dom) => allText(dom.content);
const liveText = (dom) => allText(livePanel(dom));

function buttonNamed(dom, label) {
  return findAll(dom.content, (n) => n.tagName === 'BUTTON')
    .filter((b) => allText(b).trim() === label)[0] || null;
}

/* ====================== what the pane asks for ========================= */

test('the pane reads the jobs route and nothing else', async () => {
  const dom = await boot({});
  assert.deepEqual(dom.calls.map((c) => c.endpoint), [ENDPOINT],
    'Happening now read something other than, or as well as, the jobs route');
});

test('the read carries no querystring, because this pane declares no filter', async () => {
  const dom = await boot({});
  /* The registry pins every filter for this pane. A query here would be a
     selection nobody made, applied to a queue that is not windowed. */
  assert.equal(dom.calls[0].query, undefined,
    'the jobs read carried a querystring the operator never chose');
});

/* ========================= counts, and absence ========================= */

test('the three open-state counts are drawn from the route', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        open: 19,
        byState: [
          { state: 'queued', jobs: 11 },
          { state: 'running', jobs: 6 },
          { state: 'canceling', jobs: 2 },
        ],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Aria is working on 19 things/,
    'the open count was not drawn, or was not pluralised from the route figure');
  for (const [label, n] of [['Waiting', 11], ['Running', 6], ['Stopping', 2]]) {
    assert.match(text, new RegExp(label + '\\s*' + n),
      'the ' + label + ' tile did not carry the route figure');
  }
});

test('a state the route did not report reads absent, never zero', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        open: 11,
        /* `canceling` omitted entirely: the route did not answer for it. */
        byState: [{ state: 'queued', jobs: 11 }, { state: 'running', jobs: 0 }],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Stopping\s*-/,
    'a state the route never reported was drawn as a zero, which reads as a measurement');
  assert.match(text, /Running\s*0/,
    'a state the route reported as zero was not drawn as zero, so a real zero was lost');
  assert.match(text, /Not reported/,
    'the absent state was not labelled, so a dash has to be guessed at');
});

test('an empty queue says it was counted, so it cannot be read as unread', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        open: 0,
        byState: [
          { state: 'queued', jobs: 0 },
          { state: 'running', jobs: 0 },
          { state: 'canceling', jobs: 0 },
        ],
        lanes: [laneFixture({ open: 0, jobTypes: [], oldestQueued: { state: 'none' } })],
      },
      workingSet: { returned: 0, truncated: false, jobs: [] },
      attention: { completeness: 'whole_queue', stuck: [], abandoned: [] },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Aria has nothing in flight/,
    'an empty queue was not stated as empty');
  assert.match(text, /Counted, not assumed/,
    'an idle queue was not distinguished from an unread one, which is this pane whole job');
  assert.match(text, /idle queue, not an unread one/,
    'the distinction was implied rather than said');
});

test('an uncountable queue says so rather than printing a figure', async () => {
  const dom = await boot({ view: viewFixture({ queue: { open: undefined } }) });
  const text = liveText(dom);
  assert.match(text, /The queue could not be counted/,
    'a queue with no open count was still given a sentence claiming one');
  assert.doesNotMatch(text, /Aria has nothing in flight/,
    'an unread count was rounded down to an empty queue');
});

test('an entirely empty payload draws absence everywhere and no zeros', async () => {
  const dom = await boot({ view: {} });
  const text = liveText(dom);
  assert.match(text, /The queue could not be counted/,
    'an empty payload produced a counted queue');
  assert.doesNotMatch(text, /Aria has nothing in flight/,
    'an empty payload was drawn as an idle platform');
  assert.match(text, /No lane was reported/,
    'an empty payload drew a lanes section over nothing without saying so');
  assert.match(text, /which is not the same as work not being distributed/,
    'the lanes absence was not distinguished from an undistributed platform');
});

/* ===================== the scope of the action list ==================== */

test('a bounded read states its scope even when it flagged nothing', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'working_set_only', stuck: [], abandoned: [] },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Nothing flagged in what was read/,
    'a bounded read with an empty finding list drew no band at all, so a narrow claim was '
    + 'published as a broad one by silence');
  assert.match(text, /not the whole queue/,
    'the band was drawn without the sentence that bounds it');
});

test('a whole-queue read says so, and does not borrow the bounded wording', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'whole_queue', stuck: ['job_2'], abandoned: [] },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Read over the whole queue/,
    'a complete read did not say it was complete');
  assert.doesNotMatch(text, /not the whole queue/,
    'a complete read carried the bounded caveat');
});

test('a bounded read that reached nothing refuses to cover anything', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: { returned: 0, truncated: true, jobs: [] },
      attention: { completeness: 'working_set_only', stuck: [], abandoned: [] },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /reached no jobs at all/,
    'a read that returned nothing claimed to have covered something');
  assert.doesNotMatch(text, /Read over the first 0 jobs/,
    'the zero case fell through to wording that is not a sentence');
  assert.match(text, /not a statement that nothing is wrong/,
    'an empty bounded read was allowed to read as a clean bill of health');
});

test('a working set that returned nothing while calling itself bounded is shown', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: { limit: 200, returned: 0, truncated: true, jobs: [] },
    }),
  });
  assert.match(liveText(dom), /still reports itself as bounded at 200/,
    'a contradictory read was swallowed, so "no work in flight" was published over a read '
    + 'that says it did not reach the end of the queue');
});

test('the overdue sentence uses the multiple the route applied', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'whole_queue', stuck: ['job_2'], abandoned: [] },
      baseline: { stuckMedianMultiple: 7 },
    }),
  });
  assert.match(liveText(dom), /past 7 times the usual duration/,
    'the pane printed its own threshold instead of the route figure');
});

test('with no multiple published the sentence stops short of naming one', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'whole_queue', stuck: ['job_2'], abandoned: [] },
      baseline: { stuckMedianMultiple: undefined },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /past the multiple of the usual duration/,
    'an unpublished threshold was filled in with a number');
  assert.doesNotMatch(text, /past 3 times/,
    'an unpublished threshold was filled in with this pane own guess');
});

/* ============================== the lanes ============================== */

test('lane job types are drawn as the names the route publishes', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        lanes: [laneFixture({ lane: 'gpu', jobTypes: ['video_analysis', 'form_check'] })],
      },
    }),
  });
  const text = liveText(dom);
  /* opsJobsView.ts:324 builds this as
     `[...new Set(laneCounts.map(r => r.jobType))].sort()` — a sorted array of
     strings. Read as objects it prints a row of dashes, which reads as
     absence rather than as a bug. */
  assert.match(text, /In this lane now: video analysis, form check\./,
    'lane job types were not drawn as names');
  assert.doesNotMatch(text, /In this lane now: -/,
    'lane job types were read as the wrong shape and printed as absence');
});

test('a lane whose types come back unreadable says unread, not nothing', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        lanes: [laneFixture({
          lane: 'gpu',
          byState: [{ state: 'queued', jobs: 4 }],
          jobTypes: [{ jobType: 'video_analysis', jobs: 4 }],
        })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /shape this page cannot read/,
    'a lane listing four waiting jobs said it held nothing of any kind, which is a '
    + 'confident claim over a payload the pane did not understand');
  assert.doesNotMatch(text, /Nothing of any kind in this lane right now/,
    'an unreadable shape was reported as an empty lane');
});

test('a lane that is genuinely empty still says so', async () => {
  const dom = await boot({
    view: viewFixture({ queue: { lanes: [laneFixture({ lane: 'gpu', jobTypes: [] })] } }),
  });
  assert.match(liveText(dom), /Nothing of any kind in this lane right now/,
    'a measured-empty lane lost its sentence');
});

test('the three oldest-queued answers are three different sentences', async () => {
  const cases = [
    [{ state: 'none' }, /Nothing waiting\./],
    [{ state: 'known', ageMs: 125000 }, /Longest wait 2m 05s\./],
    [{ state: 'unknown', reason: 'beyond_working_set' },
      /Something is waiting and its age is past the end of this read/],
  ];
  for (const [oldestQueued, pattern] of cases) {
    const dom = await boot({
      view: viewFixture({ queue: { lanes: [laneFixture({ oldestQueued })] } }),
    });
    assert.match(liveText(dom), pattern,
      'oldestQueued ' + oldestQueued.state + ' did not produce its own sentence');
  }
});

test('a lane whose oldest job fell past the bound is never drawn as empty', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: {
        lanes: [laneFixture({ oldestQueued: { state: 'unknown', reason: 'beyond_working_set' } })],
      },
    }),
  });
  assert.doesNotMatch(liveText(dom), /Nothing waiting\./,
    'a queue whose age is unknown was reported as no queue — the one reading that sends '
    + 'an operator away');
});

/* ============================ the work itself ========================== */

test('a running job is graded with the baseline it was graded against', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({
          id: 'job_9', jobType: 'video_analysis', state: 'running',
          queuedMs: 4000, runningMs: 126000, baselineMedianMs: 42000,
          progressGrade: 'stuck',
        })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Overdue/, 'a stuck run was not graded on the row');
  assert.match(text, /2m 06s/, 'the run elapsed time was not drawn');
  assert.match(text, /42s/, 'the baseline the verdict was drawn against was not published');
});

test('a job with no grade reads as not started rather than as healthy', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({
          id: 'job_9', state: 'queued', progressGrade: null,
          runningMs: null, baselineMedianMs: null,
        })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Not started/, 'an ungraded job was given a verdict');
  assert.doesNotMatch(text, /On time/, 'an ungraded job was rounded up to healthy');
});

test('an unmeasurable grade is not painted in a colour that decides it', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({ id: 'job_9', state: 'running', progressGrade: 'unknown' })],
      },
    }),
  });
  const verdict = findAll(livePanel(dom),
    (n) => (n.getAttribute('class') || '').indexOf('pill') === 0)
    .filter((n) => allText(n).indexOf('Not measurable') !== -1)[0];
  assert.ok(verdict, 'an unknown grade was not drawn as its own verdict');
  assert.equal(verdict.getAttribute('class'), 'pill',
    'an unknown grade carried a tone modifier, so "we cannot tell" was painted as an answer');
});

test('a duration nothing recorded prints absence, never a zero-second run', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({
          id: 'job_9', queuedMs: null, runningMs: null, baselineMedianMs: null,
        })],
      },
    }),
  });
  assert.doesNotMatch(liveText(dom), /\b0s\b/,
    'an untimed job was drawn as 0s, which reads as "just started"');
});

test('a truncated table says how much of the queue it is showing', async () => {
  const dom = await boot({
    view: viewFixture({ workingSet: { limit: 200, returned: 8, truncated: true } }),
  });
  const text = liveText(dom);
  assert.match(text, /Showing the oldest 8 of 200 this read will carry/,
    'a bounded table did not publish its bound');
  assert.match(text, /The queue is longer/,
    'a bounded table did not say there is more behind it');
});

test('a complete table says it is the whole queue', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: { returned: 1, truncated: false, jobs: [jobFixture({ id: 'job_9' })] },
    }),
  });
  assert.match(liveText(dom), /This is the whole queue, not a page of it/,
    'a complete table did not say so, so it reads as a page');
});

/* ============================== throughput ============================= */

test('a ratio travels with both of its numbers', async () => {
  const dom = await boot({
    view: viewFixture({
      throughput: {
        completed: 124, failed: 9, finished: 136,
        successRate: { numerator: 124, denominator: 133 },
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /93\.2%/, 'the rate was not drawn');
  assert.match(text, /124 of 133/,
    'a percentage was published without its denominator — 1 of 1 and 847 of 848 are both '
    + '100% and are not the same evidence');
});

test('nothing finished is absent rather than a hundred per cent', async () => {
  const dom = await boot({
    view: viewFixture({
      throughput: { completed: 0, failed: 0, finished: 0, successRate: null },
    }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /100%/, 'a rate over no runs was drawn as a perfect one');
  assert.match(text, /Nothing finished to divide/,
    'an absent rate was not explained, so a dash has to be guessed at');
});

test('a rate over a zero denominator is absent rather than infinite', async () => {
  const dom = await boot({
    view: viewFixture({ throughput: { successRate: { numerator: 0, denominator: 0 } } }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /NaN|Infinity/, 'a zero denominator reached the screen');
  assert.match(text, /Nothing finished to divide/,
    'a zero denominator was not reported as nothing to divide');
});

test('every throughput figure is published with the window it covers', async () => {
  const dom = await boot({});
  assert.match(liveText(dom), /60 minutes|last hour|hour/i,
    'a period figure was published with no window against it');
});

test('an unrecorded throughput is absent, and says which kind of absent', async () => {
  const never = await boot({
    view: viewFixture({
      throughput: null,
      recording: { state: 'never_recorded', lastRecordedAt: null },
    }),
  });
  const neverText = liveText(never);
  assert.match(neverText, /Nothing has been recorded yet/,
    'an unrecorded window drew figures');
  assert.match(neverText, /absent rather than zero/,
    'an unrecorded window was not distinguished from a calm one');

  const stopped = await boot({
    view: viewFixture({ throughput: null, recording: { state: 'recording' } }),
  });
  assert.match(liveText(stopped), /stopped answering/,
    'a recorder that stopped was reported as one that never started');
});

test('an unread window never takes the queue down with it', async () => {
  const dom = await boot({
    view: viewFixture({
      throughput: null,
      recording: { state: 'never_recorded', lastRecordedAt: null },
      queue: { open: 19 },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Aria is working on 19 things/,
    'an unread throughput blanked a queue that was read fine');
  assert.match(text, /counted from the jobs themselves/,
    'the pane did not say why the queue survives an unread window');
});

/* ========================== the admitted gaps ========================== */

test('the capacity gap is printed in the route own words', async () => {
  const reason = 'Nothing records how many workers exist, so in-flight work has no denominator.';
  const dom = await boot({ view: viewFixture({ capacity: { slots: null, reason } }) });
  /* opsJobsView.ts:393 publishes a finished sentence, not a machine code. A
     lookup keyed on codes sends every live read to a fallback while a DELETED
     field reads correctly — which is how this survived round 1. */
  assert.match(liveText(dom), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the route explanation was not drawn, so the pane is guessing at the wording');
});

test('a capacity gap with no wording still names the gap', async () => {
  const dom = await boot({
    view: viewFixture({ capacity: { slots: null, reason: undefined } }),
  });
  assert.match(liveText(dom), /worker|capacity|in flight/i,
    'with no explanation published the gap vanished from the page entirely');
});

/* =========================== masking, still ============================ */

test('address-shaped text is masked before it reaches the screen', async () => {
  const dom = await boot({
    view: viewFixture({
      queue: { lanes: [laneFixture({ jobTypes: ['video_ops@example.invalid'] })] },
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({ id: 'job_9', jobType: 'plan_athlete@example.invalid' })],
      },
    }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /@example\.invalid/,
    'an address the route sent was drawn in the clear');
  /* Counted per source rather than in total, because one masked call site
     would otherwise let the other leak. */
  assert.match(text, /In this lane now: video \[address hidden\]/,
    'an address inside a lane job type was not replaced by a named hole');
  assert.match(text, /plan \[address hidden\]/,
    'an address inside a table job type was not replaced by a named hole');
});

/* ======================== the refresh lifecycle ======================== */

test('a successful read arms exactly one timer, at the cadence', async () => {
  const dom = await boot({});
  assert.equal(dom.clock.armed, 1,
    'a read left ' + dom.clock.armed + ' timers armed; anything but one is either a '
    + 'stopped pane or two chains racing');
  assert.deepEqual(dom.clock.delays, [15000], 'the refresh cadence is not 15s');
});

test('the chain cannot overlap itself', async () => {
  const dom = await boot({});
  await dom.clock.fire();
  await dom.clock.fire();
  assert.equal(dom.calls.length, 3, 'firing the chain twice did not produce two more reads');
  assert.equal(dom.clock.armed, 1,
    'the chain armed a second timer, so two loops are now running over one pane');
});

test('hiding the tab cancels the chain, and returning reads at once', async () => {
  const dom = await boot({});
  dom.doc.hidden = true;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  assert.equal(dom.clock.armed, 0,
    'a hidden tab kept a timer armed — this is the #5543 shape, a pane still polling over '
    + 'an operator who has gone');
  const reads = dom.calls.length;

  dom.doc.hidden = false;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  assert.equal(dom.calls.length, reads + 1,
    'returning to the tab did not read immediately, so the first thing an operator sees is '
    + 'up to a cadence stale');
  assert.equal(dom.clock.armed, 1, 'returning did not re-arm exactly one timer');
});

test('leaving the page cancels the chain', async () => {
  const dom = await boot({});
  dom.window.dispatchEvent({ type: 'pagehide' });
  await settle();
  assert.equal(dom.clock.armed, 0,
    'a pane that has been navigated away from is still holding a timer');
});

test('pausing stops the chain and resuming reads once', async () => {
  const dom = await boot({});
  const pause = buttonNamed(dom, 'Pause');
  assert.ok(pause, 'there is no way to stop this pane refreshing');
  assert.equal(pause.getAttribute('aria-pressed'), 'false',
    'the toggle does not report its state');

  pause.dispatch('click', {});
  await settle();
  assert.equal(dom.clock.armed, 0, 'pausing left the chain running');
  const reads = dom.calls.length;

  const resume = buttonNamed(dom, 'Resume');
  assert.ok(resume, 'a paused pane cannot be restarted');
  resume.dispatch('click', {});
  await settle();
  assert.equal(dom.calls.length, reads + 1, 'resuming did not read');
  assert.equal(dom.clock.armed, 1,
    'resuming armed ' + dom.clock.armed + ' timers; two would be two chains');
});

test('a paused pane does not restart because the tab was hidden and shown', async () => {
  const dom = await boot({});
  buttonNamed(dom, 'Pause').dispatch('click', {});
  await settle();
  dom.doc.hidden = true;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  dom.doc.hidden = false;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  assert.equal(dom.clock.armed, 0,
    'a paused pane started refreshing again because the tab was hidden and shown');
});

test('failures back off, and the pane keeps showing the last reading', async () => {
  const dom = await boot({ answers: [viewFixture(), new Error('gateway')] });
  assert.match(liveText(dom), /Aria is working on/, 'the first read did not draw');

  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    await dom.clock.fire();
    seen.push(dom.clock.delays[dom.clock.delays.length - 1]);
  }
  assert.deepEqual(seen, [30000, 60000, 120000, 120000],
    'the backoff did not double to its cap; a pane that retries at full speed through an '
    + 'outage is the load the outage did not need');
  assert.match(liveText(dom), /Aria is working on/,
    'a failed REFRESH blanked a pane that already had a reading — the reading is stale, '
    + 'not wrong');
  assert.match(paneText(dom), /last refresh failed/i,
    'the pane hid the fact that what it shows is no longer current');
});

test('the chain gives up, says so, and offers a way back', async () => {
  const dom = await boot({ answers: [viewFixture(), new Error('gateway')] });
  for (let i = 0; i < 5; i += 1) await dom.clock.fire();

  assert.equal(dom.clock.armed, 0, 'the pane kept retrying past its own give-up threshold');
  assert.match(paneText(dom), /Stopped refreshing after 5 failed reads/,
    'the pane stopped refreshing without telling anyone, so a stale page looks live');

  const again = buttonNamed(dom, 'Start again');
  assert.ok(again, 'a stopped pane offers no way to start it again');
  const reads = dom.calls.length;
  again.dispatch('click', {});
  await settle();
  assert.equal(dom.calls.length, reads + 1, 'Start again did not read');
});

test('a first read that fails takes the pane, because there is nothing to keep', async () => {
  const dom = await boot({ answers: [new Error('gateway')] });
  /* `degraded`, not `empty`: the shell's own distinction. A read that never
     landed has not earned "there is nothing here"
     (shell-pane-v2.js:645-648). */
  assert.equal(dom.applied[dom.applied.length - 1], 'degraded',
    'a pane with no reading at all drew something other than its unreadable state');
  assert.match(paneText(dom), /could not be read/i,
    'a failed first read did not say the figures are unread');
  assert.match(paneText(dom), /Nothing here is a zero/,
    'a failed first read did not distinguish unread figures from absent ones');
  assert.doesNotMatch(paneText(dom), /Aria has nothing in flight/,
    'a failed first read was drawn as an idle platform');
});

test('Read now during a read in flight does not start a second one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const dom = await boot({});
  /* Counted at the wrapper rather than at dom.calls, because the whole point
     is that the inner call has NOT happened yet — a test that counted the
     inner one would pass while two overlapping reads were in flight. */
  let started = 0;
  const realCall = dom.window.OpsSession.call;
  dom.window.OpsSession.call = (endpoint, o) => {
    started += 1;
    return gate.then(() => realCall(endpoint, o));
  };

  buttonNamed(dom, 'Read now').dispatch('click', {});
  await settle();
  assert.equal(started, 1, 'Read now did not read at all');
  buttonNamed(dom, 'Read now').dispatch('click', {});
  await settle();
  assert.equal(started, 1,
    'a second Read now while one was in flight started an overlapping read');
  release();
  await settle();
});

/* ========================== the scroll region ========================== */

test('the table scroll box is named and reachable', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: { returned: 1, truncated: false, jobs: [jobFixture({ id: 'job_9' })] },
    }),
  });
  const box = findAll(livePanel(dom),
    (n) => (n.getAttribute('class') || '').indexOf('u-scroll') !== -1)[0];
  assert.ok(box, 'the table has no scroll box, so seven columns squeeze onto a phone');
  assert.equal(box.getAttribute('tabindex'), '0',
    'a scroll region a keyboard cannot reach fails WCAG 2.1.1');
  assert.equal(box.getAttribute('role'), 'region', 'the scroll box announces no role');
  assert.ok(box.getAttribute('aria-label'),
    'the scroll box is reachable and announces nothing when it is reached');
});

/* ============================ the page shape =========================== */

test('the page loads one design system, not two', () => {
  assert.match(PAGE_SRC, /assets\/aria\.css/, 'the v2 design system is missing');
  assert.match(PAGE_SRC, /assets\/shell-pane-v2\.css/, 'the v2 pane chrome is missing');
  assert.match(PAGE_SRC, /assets\/pane-jobs-live-v2\.css/, "the pane's own sheet is missing");
  for (const v1 of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js', 'assets/icons.js']) {
    assert.ok(PAGE_SRC.indexOf(v1) === -1,
      v1 + ' is loaded beside the v2 system, and both define .card, .rail, .btn and .pill');
  }
});

test('the scripts load in the order the bootstrap needs', () => {
  const order = ['assets/theme.js', 'assets/pane-registry.js', 'assets/api.js', 'assets/session.js',
    'assets/aria.js', 'assets/shell-pane-v2.js', 'assets/pane-jobs-live-v2.js'];
  let last = -1;
  for (const src of order) {
    const at = PAGE_SRC.indexOf(src);
    assert.ok(at > last, src + ' is missing or loads out of order');
    last = at;
  }
});

test('the page mentions no API path, because only scripts are parsed', () => {
  /* scripts/check-ops-route-calls.mjs parses the pane scripts and refuses to
     report a pass when a path it checks turns up somewhere it cannot parse.
     An /api/ops string in this HTML blinds the guard rather than feeding it. */
  assert.ok(PAGE_SRC.indexOf('/api/ops') === -1,
    'the route guard cannot parse HTML, and fails closed when a path appears in one');
});

test('the pane module writes no markup and no style attribute', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'pane-jobs-live-v2.js reaches for innerHTML');
  assert.ok(!/outerHTML|insertAdjacentHTML|document\.write/.test(PANE_SRC));
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(PANE_SRC),
    'pane-jobs-live-v2.js writes a style attribute');
  assert.ok(!/\sstyle="/.test(PAGE_SRC), 'jobs-live.html carries a style attribute');
});

test('the pane writes no class only the v1 sheet defines', () => {
  /* The page loads aria.css, shell-pane-v2.css and its own sheet. A class from
     ops.css — the v1 sheet — is written into the DOM and painted by nothing,
     which fails silently and looks like a design choice (Stadiora/Aria#10646,
     #10647). This is the cheap source-level catch; the resolved-value proof,
     which is the one that cannot be fooled by a selector that is present and
     overridden, is in ops-jobs-live-painted.test.mjs. */
  const sheets = ['assets/aria.css', 'assets/shell-pane-v2.css', 'assets/pane-jobs-live-v2.css']
    .map((f) => read(f)).join('\n');
  for (const name of ['tile', 'tile-value', 'tile-label', 'tile-meta', 'badge', 'badge-info',
    'cell-strong', 'page-question', 'small']) {
    const written = new RegExp("className: '[^']*\\b" + name + "\\b").test(PANE_SRC);
    const painted = new RegExp('\\.' + name + '(?![\\w-])').test(sheets);
    assert.ok(!written || painted,
      'the pane writes .' + name + ', which only ops.css defines and this page does not load');
  }
});

test('every glyph is decorative and no status is a glyph alone', async () => {
  const dom = await boot({});
  const svgs = findAll(dom.content, (n) => n.tagName === 'svg');
  assert.ok(svgs.length > 4, 'no glyphs at all, so this proves nothing');
  for (const svg of svgs) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'a glyph is announced');
    assert.equal(svg.getAttribute('role'), null, 'a glyph carries a role');
  }
});

test('the shared awaiting-data module is gone and nothing reaches for it', () => {
  assert.ok(!existsSync(new URL('assets/pane-awaiting-data.js', OPS)),
    'pane-awaiting-data.js still exists, and no page loads it any more');
  assert.ok(PAGE_SRC.indexOf('pane-awaiting-data') === -1,
    'jobs-live.html still loads the module this change retires');
});

test('the pane no longer loads the alerting model it used to fall back to', () => {
  /* Read off the script tags, not the file text. The page carries a comment
     explaining WHY the module was dropped, and a blunt substring search over
     the whole file matches that explanation and calls it a regression. */
  const loaded = [...PAGE_SRC.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!loaded.includes('assets/alerts-model.js'),
    'jobs-live.html still loads the alerting model, which this pane no longer reads');
  assert.ok(PANE_SRC.indexOf('alerts/problems') === -1,
    'the pane still reaches for the alerting record it was built to replace');
});
