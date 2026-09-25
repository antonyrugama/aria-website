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

import { makeDom, allText, allDomTextAndAttrs, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const JOB_ACTIONS_SRC = read('assets/job-actions-v2.js');
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
      calls.push({ endpoint, query: o && o.query, method: o && o.method, body: o && o.body });
      if (o && o.method === 'POST') {
        const action = opts.actionResponses && opts.actionResponses[endpoint];
        if (action instanceof Error) return Promise.reject(action);
        if (action === undefined) return Promise.reject(new Error('no action stub for ' + endpoint));
        return Promise.resolve({ data: action });
      }
      const readIndex = calls.filter((call) => call.method !== 'POST').length - 1;
      const answer = answers[Math.min(readIndex, answers.length - 1)];
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
  vm.runInContext(JOB_ACTIONS_SRC, dom.window, { filename: 'job-actions-v2.js' });
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

test('a read that never said its scope is unread, not whole', async () => {
  /* The third reading. `completeness` absent is the one case where the two
     obvious branches agree wrongly: `=== working_set_only` and
     `!== whole_queue` differ ONLY here, and the first silently promotes an
     unknown scope to a whole-queue claim. On this dashboard that is the same
     defect as printing 0 critical over data that never arrived (PR #98). */
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: undefined, stuck: ['job_2'], abandoned: [] },
    }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /Read over the whole queue/,
    'a read that published no scope was drawn as a whole-queue read');
  assert.match(text, /unread rather than whole/,
    'a read with no scope did not say its scope was unread');
});

test('a band with no findings is still drawn when the scope is unread', async () => {
  /* Hiding the band would publish "nothing is wrong" on the strength of a
     read whose reach is unknown. Silence is a claim here. */
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: undefined, stuck: [], abandoned: [] },
    }),
  });
  assert.match(liveText(dom), /unread rather than whole/,
    'an empty findings list over an unknown scope was drawn as silence');
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

/* `Nothing waiting.` is the answer to `state: 'none'` and to nothing else.
   Reached by a lane whose `oldestQueued` is missing, and by one carrying a
   state this pane has no sentence for — a fourth variant, or a renamed one.
   Both are unreachable against today's closed union, which is exactly why
   nothing bound them: the branch that catches them was the same `else` that
   draws a genuine empty lane, so an unread field printed the sentence for a
   measured zero. Every other absence surface on this pane degrades to a dash,
   an absent card or an "unread" scope; this one degraded to a confident
   English claim that a lane has no queue. */
for (const [name, oldestQueued] of [
  ['missing entirely', undefined],
  ['a state this pane has no sentence for', { state: 'estimated', ageMs: 125000 }],
]) {
  test(`a lane whose oldest-queued answer is ${name} says the read did not say`, async () => {
    const dom = await boot({
      view: viewFixture({ queue: { lanes: [laneFixture({ oldestQueued })] } }),
    });
    const text = liveText(dom);
    assert.match(text, /This read did not say whether anything is waiting here\./,
      'an unreadable oldest-queued answer did not say so');
    assert.doesNotMatch(text, /Nothing waiting\./,
      'an unreadable oldest-queued answer was drawn as a measured empty lane');
    assert.doesNotMatch(text, /Longest wait/,
      'an unreadable oldest-queued answer was drawn as a measured wait');
  });
}

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

test('a run the route gave up on says so on its row, and is not read as on time', async () => {
  /* The most consequential single reading on this pane: the platform has
     stopped hearing from the worker and the reaper will fail this run. It is
     the opposite of "On time", and until this test existed the two could be
     swapped with every guard in the repository staying green. */
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({
          id: 'job_gone', jobType: 'video_analysis', state: 'running',
          queuedMs: 4000, runningMs: 900000, baselineMedianMs: 42000,
          progressGrade: 'abandoned',
        })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Given up on/, 'a run graded abandoned was not read as given up on');
  assert.doesNotMatch(text, /On time/,
    'a run the route gave up on was read as on time, which is the opposite of what it is');
});

test('the attention band counts the runs given up on and says what that means', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'working_set_only', stuck: [], abandoned: ['job_gone', 'job_x'] },
      workingSet: {
        returned: 1,
        truncated: false,
        jobs: [jobFixture({ id: 'job_gone', progressGrade: 'abandoned' })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /2 runs given up on/,
    'the band did not count the runs the route reported as given up on');
  assert.match(text, /reaper will fail/,
    'the band counted them without saying what being given up on means');
  assert.doesNotMatch(text, /Nothing flagged/,
    'the band reported nothing flagged while carrying two runs given up on');
});

test('a whole-queue read flags runs given up on even when nothing is overdue', async () => {
  /* The headline count is what decides the band exists at all. With the stuck
     half non-empty in every other fixture, the abandoned half was never the
     reason anything was drawn, so half the count could be deleted and the band
     would still appear -- for the wrong runs. */
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'whole_queue', stuck: [], abandoned: ['job_gone'] },
      workingSet: {
        returned: 1, truncated: false,
        jobs: [jobFixture({ id: 'job_gone', progressGrade: 'abandoned' })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Not clearing/,
    'a queue holding a run given up on drew no attention band at all');
  assert.match(text, /1 run given up on/,
    'the band was drawn but did not count the run that caused it');
  assert.doesNotMatch(text, /Nothing flagged/,
    'the band reported nothing flagged over a run the platform had given up on');
});

test('a whole-queue read flags overdue runs even when nothing was given up on', async () => {
  const dom = await boot({
    view: viewFixture({
      attention: { completeness: 'whole_queue', stuck: ['job_slow'], abandoned: [] },
      workingSet: {
        returned: 1, truncated: false,
        jobs: [jobFixture({ id: 'job_slow', progressGrade: 'stuck' })],
      },
    }),
  });
  const text = liveText(dom);
  assert.match(text, /Not clearing/,
    'a queue holding an overdue run drew no attention band at all');
  assert.match(text, /1 run overdue/,
    'the band was drawn but did not count the overdue run that caused it');
  assert.doesNotMatch(text, /0 runs overdue/,
    'the band printed a zero over the very runs it was drawn for');
  assert.doesNotMatch(text, /given up on/,
    'the band reported runs given up on when none were');
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

test('job action controls come only from the capability block and false actions are reasons', async () => {
  const dom = await boot({
    view: viewFixture({
      workingSet: {
        returned: 3,
        truncated: false,
        jobs: [
          jobFixture({
            id: '9f1c2d00-1111-4111-8111-111111111111',
            reference: 'job_9f1c2d',
            state: 'queued',
            actions: {
              canCancel: true,
              cancelReason: null,
              canRetry: false,
              retryReason: 'Only failed jobs can be retried.',
            },
          }),
          jobFixture({
            id: 'aa2c2d00-1111-4111-8111-111111111111',
            state: 'running',
            actions: {
              canCancel: false,
              cancelReason: "This job type can't be stopped once it has started.",
              canRetry: false,
              retryReason: 'Only failed jobs can be retried.',
            },
          }),
          jobFixture({
            id: 'bb3c2d00-1111-4111-8111-111111111111',
            state: 'running',
            actions: {
              canCancel: false,
              cancelReason: 'Your role can view jobs but cannot change them.',
              canRetry: false,
              retryReason: 'Your role can view jobs but cannot change them.',
            },
          }),
        ],
      },
    }),
  });

  const buttons = findAll(livePanel(dom), (n) => n.tagName === 'BUTTON').map((b) => allText(b).trim());
  assert.equal(buttons.filter((label) => label === 'Cancel').length, 1,
    'Cancel was drawn for a row whose capability block did not allow it, or omitted for one that did');
  assert.equal(buttons.filter((label) => label === 'Retry').length, 0,
    'Retry was drawn without a row whose capability block allows retry');
  const text = liveText(dom);
  assert.match(text, /Cancel: This job type can't be stopped once it has started\./,
    'a false cancel capability did not print the server reason');
  assert.match(text, /Retry: Only failed jobs can be retried\./,
    'a false retry capability did not print the server reason');
  assert.match(text, /Your role can view jobs but cannot change them\./,
    'a viewer capability block was hidden instead of explaining why there is no button');
});

test('cancelling a job requires the typed reference, posts it, refreshes, and restores focus', async () => {
  const jobId = 'job_9f1c2d00-\"quoted';
  const encodedJobId = encodeURIComponent(jobId);
  const dom = await boot({
    answers: [
      viewFixture({
        workingSet: {
          returned: 1,
          truncated: false,
          jobs: [jobFixture({
            id: jobId,
            reference: 'job_9f1c2d',
            state: 'queued',
            actions: {
              canCancel: true,
              cancelReason: null,
              canRetry: false,
              retryReason: 'Only failed jobs can be retried.',
            },
          })],
        },
      }),
      viewFixture({ workingSet: { returned: 0, truncated: false, jobs: [] } }),
    ],
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(jobId) + '/cancel']: { jobId, status: 'canceled' },
    },
  });

  const cancel = buttonNamed(dom, 'Cancel');
  assert.ok(cancel, 'the actionable row did not draw a Cancel button');
  cancel.focus();
  cancel.dispatch('click', {});
  await settle();

  assert.match(allText(dom.body), /Cancel this queued job/,
    'the confirmation dialog did not say what cancelling a queued job does');
  assert.match(allText(dom.body), /Reference: job_9f1c2d/,
    'the confirmation dialog did not show the typed reference');
  const input = dom.doc.getElementById(dom.body.querySelector('.field-input').getAttribute('id'));
  const go = buttonNamed({ content: dom.body }, 'Cancel job');
  assert.equal(go.disabled, true, 'the destructive button enabled before the exact reference was typed');
  input.value = 'JOB_9F1C2D';
  input.dispatch('input', {});
  assert.equal(go.disabled, true, 'the destructive button accepted a differently cased reference');
  input.value = ' job_9f1c2d ';
  input.dispatch('input', {});
  assert.equal(go.disabled, false, 'the destructive button did not enable for the trimmed reference');
  go.dispatch('click', {});
  await settle();

  assert.deepEqual(dom.calls.map((c) => [c.method || 'GET', c.endpoint]), [
    ['GET', ENDPOINT],
    ['POST', '/api/ops/jobs/' + encodedJobId + '/cancel'],
    ['GET', ENDPOINT],
  ], 'a successful cancellation should post once and refresh the list once');
  assert.equal(JSON.stringify(dom.calls[1].body), JSON.stringify({ confirmation: 'job_9f1c2d' }),
    'the cancellation did not send the trimmed confirmation body');
  assert.match(allText(dom.body), /Cancelled job_9f1c2d/,
    'the success announcement did not use the committed action response');
  assert.equal(allText(dom.doc.activeElement).trim(), 'Read now',
    'focus did not land on the surviving read control after the cancelled row disappeared');
});



test('post-action focus matches a wire id by attribute value instead of selector text', async () => {
  const jobId = 'job_selector_"quoted';
  const stillQueued = jobFixture({
    id: jobId,
    reference: 'job_9f1c2d',
    state: 'queued',
    actions: {
      canCancel: true,
      cancelReason: null,
      canRetry: false,
      retryReason: 'Only failed jobs can be retried.',
    },
  });
  const dom = await boot({
    answers: [
      viewFixture({ workingSet: { returned: 1, truncated: false, jobs: [stillQueued] } }),
      viewFixture({ workingSet: { returned: 1, truncated: false, jobs: [stillQueued] } }),
    ],
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(jobId) + '/cancel']: { jobId, status: 'canceling' },
    },
  });

  buttonNamed(dom, 'Cancel').dispatch('click', {});
  await settle();
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_9f1c2d';
  input.dispatch('input', {});
  buttonNamed({ content: dom.body }, 'Cancel job').dispatch('click', {});
  await settle();

  assert.equal(dom.doc.activeElement.getAttribute('data-retain'), 'jobs-row-' + jobId,
    'post-action focus did not return to the same row when the wire id would break a selector');
});

test('a job action refresh queued during an in-flight read lands after that read settles', async () => {
  const jobId = '9f1c2d00-1111-4111-8111-111111111111';
  let releaseInFlight;
  const inFlight = new Promise((resolve) => { releaseInFlight = resolve; });
  const beforeAction = viewFixture({
    workingSet: {
      returned: 1,
      truncated: false,
      jobs: [jobFixture({
        id: jobId,
        reference: 'job_9f1c2d',
        state: 'queued',
        actions: {
          canCancel: true,
          cancelReason: null,
          canRetry: false,
          retryReason: 'Only failed jobs can be retried.',
        },
      })],
    },
  });
  const afterAction = viewFixture({ workingSet: { returned: 0, truncated: false, jobs: [] } });
  const dom = await boot({
    view: beforeAction,
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(jobId) + '/cancel']: { jobId, status: 'canceled' },
    },
  });

  let heldRead = true;
  const realCall = dom.window.OpsSession.call;
  dom.window.OpsSession.call = (endpoint, o) => {
    if (!o || o.method !== 'POST') {
      dom.calls.push({ endpoint, query: o && o.query, method: o && o.method, body: o && o.body });
      if (heldRead) {
        heldRead = false;
        return inFlight.then(() => ({ data: beforeAction }));
      }
      return Promise.resolve({ data: afterAction });
    }
    return realCall(endpoint, o);
  };

  buttonNamed(dom, 'Read now').dispatch('click', {});
  await settle();
  buttonNamed(dom, 'Cancel').dispatch('click', {});
  await settle();
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_9f1c2d';
  input.dispatch('input', {});
  buttonNamed({ content: dom.body }, 'Cancel job').dispatch('click', {});
  await settle();
  assert.equal(dom.calls.filter((c) => c.method !== 'POST').length, 2,
    'the action refreshed before the in-flight read settled instead of queuing behind it');

  releaseInFlight();
  await settle();

  assert.deepEqual(dom.calls.map((c) => [c.method || 'GET', c.endpoint]), [
    ['GET', ENDPOINT],
    ['GET', ENDPOINT],
    ['POST', '/api/ops/jobs/' + jobId + '/cancel'],
    ['GET', ENDPOINT],
  ], 'the action refresh was not replayed once the in-flight read settled');
  assert.doesNotMatch(liveText(dom), /job_9f1c2d/,
    'the row still showed the pre-action state after the queued refresh settled');
  assert.equal(allText(dom.doc.activeElement).trim(), 'Read now',
    'focus did not land on the surviving read control after the queued refresh removed the actioned row');
});

test('a stale cancellation reloads the list and never claims the action happened', async () => {
  const jobId = '9f1c2d00-1111-4111-8111-111111111111';
  const stale = new Error('raw backend text must not render');
  stale.status = 409;
  stale.code = 'ops_jobs_cancel_stale';
  const dom = await boot({
    answers: [
      viewFixture({
        workingSet: {
          returned: 1,
          truncated: false,
          jobs: [jobFixture({
            id: jobId,
            reference: 'job_9f1c2d',
            state: 'queued',
            actions: { canCancel: true, cancelReason: null, canRetry: false, retryReason: 'Only failed jobs can be retried.' },
          })],
        },
      }),
      viewFixture({ workingSet: { returned: 0, truncated: false, jobs: [] } }),
    ],
    actionResponses: {
      ['/api/ops/jobs/' + encodeURIComponent(jobId) + '/cancel']: stale,
    },
  });

  buttonNamed(dom, 'Cancel').dispatch('click', {});
  await settle();
  const input = dom.body.querySelector('.field-input');
  input.value = 'job_9f1c2d';
  input.dispatch('input', {});
  buttonNamed({ content: dom.body }, 'Cancel job').dispatch('click', {});
  await settle();

  assert.equal(dom.calls.filter((c) => c.method !== 'POST').length, 2,
    'a stale action did not refresh the list');
  const text = allText(dom.body);
  assert.match(text, /changed state elsewhere/,
    'a stale action did not use the fixed stale-state copy');
  assert.doesNotMatch(text, /raw backend text/,
    'raw API text reached the UI for a stale action');
  assert.doesNotMatch(text, /Cancelled job_9f1c2d/,
    'a stale action was announced as though it committed');
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

test('a rate whose two numbers are not numbers is absent, not computed', async () => {
  /* The route's contract says numerator/denominator are numbers. If it ever
     sends something else, arithmetic over it yields NaN and a percentage of
     NaN on an ops page during an incident is worse than a blank. Absence is
     the only honest reading of a figure that could not be computed. */
  const dom = await boot({
    view: viewFixture({ throughput: { successRate: { numerator: null, denominator: '133' } } }),
  });
  const text = liveText(dom);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/,
    'an uncomputable rate reached the screen as arithmetic wreckage');
  assert.doesNotMatch(text, /Got through \d/,
    'a rate was printed from two values that were not both numbers');
});

test('every throughput figure is published with the window it covers', async () => {
  const dom = await boot({});
  assert.match(liveText(dom), /60 minutes|last hour|hour/i,
    'a period figure was published with no window against it');
});

/* Stadiora/Aria#5562: no figure without the window it covers. "Usually" is a
   median over the baseline's own window, not the throughput one, so its
   period has to come off `baseline.window` and move when that does. */
test('the "Usually" column is published with the baseline window it was taken over', async () => {
  const week = await boot({
    view: viewFixture({
      workingSet: { returned: 1, truncated: false, jobs: [jobFixture({ id: 'job_1' })] },
      baseline: { window: { days: 7, from: '2026-09-15T09:00:00.000Z', to: '2026-09-22T09:00:00.000Z' } },
    }),
  });
  assert.match(liveText(week), /over the 7 days from 15 Sep 2026 to 22 Sep 2026/,
    'the median was printed without the window it was taken over');

  const month = await boot({
    view: viewFixture({
      workingSet: { returned: 1, truncated: false, jobs: [jobFixture({ id: 'job_1' })] },
      baseline: { window: { days: 30, from: '2026-08-23T09:00:00.000Z', to: '2026-09-22T09:00:00.000Z' } },
    }),
  });
  assert.match(liveText(month), /over the 30 days from 23 Aug 2026 to 22 Sep 2026/,
    'a different baseline window left the printed period unchanged');

  const unstated = await boot({
    view: viewFixture({
      workingSet: { returned: 1, truncated: false, jobs: [jobFixture({ id: 'job_1' })] },
      baseline: { window: null },
    }),
  });
  assert.match(liveText(unstated), /median over a window this read did not state/,
    'a baseline with no window was not called out as unstated');
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
  /* Deliberately NOT the sentence this pane falls back to. An earlier draft
     of this test used the fallback wording as its fixture, so replacing
     `capacity.reason` with the fallback produced identical output and the
     test passed over a pane that had stopped reading the route at all. The
     expectation has to be distinguishable from the thing it is testing. */
  const reason = 'Worker headroom is not published by any process that runs today.';
  const dom = await boot({ view: viewFixture({ capacity: { slots: null, reason } }) });
  /* opsJobsView.ts:393 publishes a finished sentence, not a machine code. A
     lookup keyed on codes sends every live read to a fallback while a DELETED
     field reads correctly — which is how this survived round 1. */
  assert.match(liveText(dom), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the route explanation was not drawn, so the pane is guessing at the wording');
  assert.doesNotMatch(liveText(dom), /Nothing records how many workers exist, so in-flight/,
    'the pane drew its own fallback wording over a reason the route did publish');
});

test('a capacity diagnostic masks contact details before the DOM sees it', async () => {
  const reason = 'Contact Coach.Person+run@eu.example.com for this failure.';
  const dom = await boot({ view: viewFixture({ capacity: { slots: null, reason } }) });
  const surface = allDomTextAndAttrs(dom.content);
  assert.doesNotMatch(surface, /Coach\.Person\+run@eu\.example\.com/,
    'the capacity reason reached DOM text or attributes with an address in it');
  assert.match(surface, /Contact \[hidden contact detail\] for this failure\./,
    'the route diagnostic was not drawn with its contact detail masked');
});

test('a capacity gap with no wording still names the gap', async () => {
  const dom = await boot({
    view: viewFixture({ capacity: { slots: null, reason: undefined } }),
  });
  assert.match(liveText(dom), /worker|capacity|in flight/i,
    'with no explanation published the gap vanished from the page entirely');
});

/* =========================== masking, still ============================ */

test('the diagnostic leak surface includes attributes as well as visible text', () => {
  const dom = makeDom();
  const node = dom.element('div');
  node.setAttribute('title', 'Contact Coach.Person+run@eu.example.com for this failure.');
  assert.match(allDomTextAndAttrs(node), /Coach\.Person\+run@eu\.example\.com/,
    'a DOM leak check that ignores attributes can pass while an accessible copy leaks');
});

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
  assert.match(text, /In this lane now: video \[hidden contact detail\]/,
    'an address inside a lane job type was not replaced by a named hole');
  assert.match(text, /plan \[hidden contact detail\]/,
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
  const reads = dom.calls.length;
  dom.doc.hidden = true;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  dom.doc.hidden = false;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  assert.equal(dom.clock.armed, 0,
    'a paused pane started refreshing again because the tab was hidden and shown');
  /* Both directions. The timer alone is not the invariant: returning to the
     tab reads IMMEDIATELY before it schedules anything, so a handler that
     forgot `paused` sends a read and then correctly declines to arm a timer —
     and an assertion that only counted timers would pass over it. */
  assert.equal(dom.calls.length, reads,
    'a paused pane read anyway when the tab came back, without arming a timer to show for it');
});

test('a read that lands while the tab is hidden does not arm the next one', async () => {
  /* The other half of the hidden-tab rule, and the one a cancel-on-hide test
     cannot see. Hiding cancels the PENDING timer; this is about the read
     already in flight when the operator left, whose success handler schedules
     the next tick after they have gone. */
  let release;
  const gate = new Promise((r) => { release = r; });
  const dom = await boot({});
  const realCall = dom.window.OpsSession.call;
  dom.window.OpsSession.call = (endpoint, o) => gate.then(() => realCall(endpoint, o));

  buttonNamed(dom, 'Read now').dispatch('click', {});
  await settle();
  dom.doc.hidden = true;
  dom.doc.dispatch('visibilitychange', {});
  await settle();
  release();
  await settle();
  assert.equal(dom.clock.armed, 0,
    'a read that landed after the operator left armed the next tick anyway, so the chain '
    + 'outlived the tab being visible');
});

test('a read that lands while paused does not arm the next one', async () => {
  /* The Pause analogue of the hidden-tab rule above, and the one case the
     `paused` term in scheduleTick() exists for. Pausing with the chain idle
     only cancels a pending timer; a read ALREADY IN FLIGHT when Pause is
     pressed lands afterwards and its success handler schedules the next tick.
     Without this the pane can keep polling while the footer says it is
     stopped, which is Stadiora/Aria#5543's shape exactly. */
  let release;
  const gate = new Promise((r) => { release = r; });
  const dom = await boot({});
  const realCall = dom.window.OpsSession.call;
  dom.window.OpsSession.call = (endpoint, o) => gate.then(() => realCall(endpoint, o));

  buttonNamed(dom, 'Read now').dispatch('click', {});
  await settle();
  buttonNamed(dom, 'Pause').dispatch('click', {});
  await settle();
  release();
  await settle();

  assert.equal(dom.clock.armed, 0,
    'a read that landed after Pause armed the next tick anyway, so the pane kept polling '
    + 'while its own footer said nothing was changing');

  const reads = dom.calls.length;
  await dom.clock.fire();
  assert.equal(dom.calls.length, reads,
    'a paused pane read again, so the pause was cosmetic');
  assert.ok(buttonNamed(dom, 'Resume'), 'the footer did not report the pane as paused');
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

test('pausing a pane whose last read failed keeps the staleness caveat', async () => {
  /* The operator most in need of "this is not a current reading" is the one
     who pauses a pane that has just started failing. An earlier draft passed
     the error into the footer, so the pause branch — which has no error to
     pass — deleted both the failure and the caveat over figures exactly as
     stale as they were a moment before. */
  const dom = await boot({ answers: [viewFixture(), new Error('gateway')] });
  await dom.clock.fire();
  assert.match(paneText(dom), /not a current one/,
    'a failed refresh did not caveat the reading it left on screen');

  buttonNamed(dom, 'Pause').dispatch('click', {});
  await settle();
  const text = paneText(dom);
  assert.match(text, /not a current one/,
    'pausing deleted the caveat saying the figures are stale');
  assert.match(text, /had already failed/,
    'pausing deleted the fact that the last read failed');
});

test('resuming reports the button state before the read lands', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const dom = await boot({});
  buttonNamed(dom, 'Pause').dispatch('click', {});
  await settle();

  const realCall = dom.window.OpsSession.call;
  dom.window.OpsSession.call = (endpoint, o) => gate.then(() => realCall(endpoint, o));
  buttonNamed(dom, 'Resume').dispatch('click', {});
  await settle();
  /* Still in flight. The toggle must already say Pause: a control that keeps
     reporting the state the pane left, until a network round trip completes,
     is announcing a promise as a fact. */
  const pause = buttonNamed(dom, 'Pause');
  assert.ok(pause, 'the toggle still said Resume while the pane was already resumed');
  assert.equal(pause.getAttribute('aria-pressed'), 'false',
    'the toggle still reported itself pressed while the pane was already resumed');
  release();
  await settle();
});

test('the chain gives up, says so, and offers a way back', async () => {
  const dom = await boot({ answers: [viewFixture(), new Error('gateway')] });
  for (let i = 0; i < 5; i += 1) await dom.clock.fire();

  assert.equal(dom.clock.armed, 0, 'the pane kept retrying past its own give-up threshold');
  assert.match(paneText(dom), /Stopped refreshing after 5 failed reads/,
    'the pane stopped refreshing without telling anyone, so a stale page looks live');

  const again = buttonNamed(dom, 'Start again');
  assert.ok(again, 'a stopped pane offers no way to start it again');
  /* It is the only way back from a stopped chain, so it is drawn as the
     primary action rather than as one option among several. A class check is
     the only handle on that here: the sweep cannot see a class that has been
     REMOVED from the source, since it compares source literals against the
     DOM and a deleted literal is simply no longer asked about. */
  assert.ok((again.getAttribute('class') || '').split(/\s+/).includes('btn-primary'),
    'the only way back from a stopped chain was not drawn as the primary action');
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

/* ------------------ what a refresh must not take away ------------------ */

/* The pane rebuilds itself every fifteen seconds and `region.show` swaps the
   whole box out. Everything below is about the operator's own position in the
   page surviving that swap, because a pane that steals focus and rewinds the
   table four times a minute is unusable with a keyboard and close to unusable
   on a phone, where the table is 311 wide against 643 of content. */

const scrollBox = (dom) => findAll(livePanel(dom),
  (n) => (n.getAttribute('class') || '').indexOf('u-scroll') !== -1)[0] || null;

const WITH_ROWS = () => viewFixture({
  workingSet: {
    returned: 2, truncated: false,
    jobs: [jobFixture({ id: 'job_1' }), jobFixture({ id: 'job_2' })],
  },
});

test('a refresh keeps the table where the operator scrolled it', async () => {
  const dom = await boot({ view: WITH_ROWS() });
  const before = scrollBox(dom);
  assert.ok(before, 'no scroll box, so this proves nothing');
  before.scrollLeft = 220;

  await dom.clock.fire();

  const after = scrollBox(dom);
  /* Without this the test passes when the pane never redraws at all, which is
     a different pane from the one under test. */
  assert.notStrictEqual(after, before, 'the refresh did not rebuild the table');
  assert.equal(after.scrollLeft, 220,
    'the refresh rewound the table to column one, hiding the columns the '
    + 'operator had scrolled to');
});

test('a refresh keeps focus on the scroll region the operator had tabbed to', async () => {
  const dom = await boot({ view: WITH_ROWS() });
  const before = scrollBox(dom);
  before.focus();
  assert.strictEqual(dom.doc.activeElement, before, 'the box did not take focus');

  await dom.clock.fire();

  const after = scrollBox(dom);
  assert.notStrictEqual(after, before, 'the refresh did not rebuild the table');
  assert.strictEqual(dom.doc.activeElement, after,
    'the refresh dropped focus, so a keyboard operator is returned to the top '
    + 'of the document every fifteen seconds');
});

test('a refresh keeps focus on the Pause button', async () => {
  const dom = await boot({ view: WITH_ROWS() });
  const before = buttonNamed(dom, 'Pause');
  before.focus();
  assert.strictEqual(dom.doc.activeElement, before);

  await dom.clock.fire();

  const after = buttonNamed(dom, 'Pause');
  assert.notStrictEqual(after, before, 'the refresh did not rebuild the footer');
  assert.strictEqual(dom.doc.activeElement, after, 'the refresh dropped focus off Pause');
});

function linkNamed(dom, label) {
  return findAll(dom.content, (n) => n.tagName === 'A')
    .filter((l) => allText(l).trim() === label)[0] || null;
}

for (const label of ['What happened', 'Open Problems']) {
  test(`a refresh keeps focus on the ${label} link`, async () => {
    const dom = await boot({ view: WITH_ROWS() });
    const before = linkNamed(dom, label);
    assert.ok(before, `no ${label} link, so this proves nothing`);
    before.focus();
    assert.strictEqual(dom.doc.activeElement, before, 'the link did not take focus');

    await dom.clock.fire();

    const after = linkNamed(dom, label);
    assert.notStrictEqual(after, before, 'the refresh did not rebuild the footer');
    assert.strictEqual(dom.doc.activeElement, after,
      `the refresh dropped focus off ${label}`);
  });
}

test('a refresh does not steal focus from somewhere else on the page', async () => {
  const dom = await boot({ view: WITH_ROWS() });
  /* Focus outside the pane, on a node that happens to carry the same retain
     name the pane uses. The pane must decide by "was this inside my own tree",
     not by a global name match — otherwise a refresh yanks focus out of the
     shell and into the pane while the operator is using something else. */
  const outside = dom.doc.getElementById('content');
  outside.setAttribute('data-retain', 'jobs-toggle');
  dom.doc.activeElement = outside;

  await dom.clock.fire();

  assert.strictEqual(dom.doc.activeElement, outside,
    'the refresh pulled focus into the pane from outside it');
});

test('pressing Pause leaves focus on the button that was pressed', async () => {
  const dom = await boot({ view: WITH_ROWS() });
  const pause = buttonNamed(dom, 'Pause');
  pause.focus();
  pause.dispatch('click');
  await settle();

  /* Pause redraws only the footer, but that still swaps the button out. A
     keyboard operator who pressed it must not be dropped to the top of the
     document for having used the control the pane offers them. */
  const resume = buttonNamed(dom, 'Resume');
  assert.ok(resume, 'Pause did not become Resume');
  assert.strictEqual(dom.doc.activeElement, resume,
    'pressing Pause threw focus away, so the keyboard path out of it is lost');
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
    'assets/aria.js', 'assets/shell-pane-v2.js', 'assets/job-actions-v2.js',
    'assets/pane-jobs-live-v2.js'];
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

test('the pane writes no class only the v1 sheet defines', async () => {
  /* The page loads aria.css, shell-pane-v2.css and its own sheet. A class from
     ops.css -- the v1 sheet -- written into the DOM is painted by nothing,
     which fails silently and looks like a design choice (Stadiora/Aria#10646,
     #10647).

     This guard READS THE DOM rather than parsing the source, and that is the
     whole point of it. Three earlier versions parsed: a hand-kept list of
     names, then the literals next to `className:`, then those plus the values
     of the lookup maps a className expression references. Each one was green
     over a class delivered in a shape it had not been taught -- `mono`, then
     the tone classes, then `S.link()`'s third argument. A parser has to know
     every delivery shape in advance and silently passes the ones it does not;
     booting the pane and reading `class` off what it actually built has no
     shapes to miss.

     The limit that remains is honest and statable: it sees the classes the
     states below cause to be drawn, so a class that only appears in a state
     nobody boots is outside it. Each state must contribute, or a boot that
     quietly stopped drawing would shrink this guard without failing it.

     Still a PRESENCE check: it asks whether the name appears in a selector the
     page loads, so it cannot tell `.mono` from `.pill .mono`. The resolved
     proof, in real Chrome against the rules that actually reach each node, is
     scripts/check-ops-result-view.mjs. */
  const sheets = ['assets/aria.css', 'assets/shell-pane-v2.css', 'assets/pane-jobs-live-v2.css']
    .map((f) => read(f)).join('\n');

  const states = [
    ['a full reading', { view: viewFixture({
      workingSet: { limit: 200, returned: 2, truncated: true,
        jobs: [jobFixture({ id: 'job_1', progressGrade: 'healthy' }),
          jobFixture({ id: 'job_2', progressGrade: 'stuck' })] },
      attention: { completeness: 'working_set_only', stuck: ['job_2'], abandoned: ['job_1'] },
    }) }],
    ['an idle queue', { view: viewFixture({
      queue: { open: 0, scope: 'all_open_states', byState: [], lanes: [] },
      workingSet: { limit: 200, returned: 0, truncated: false, jobs: [] },
    }) }],
    ['a bounded read that came back empty', { view: viewFixture({
      workingSet: { limit: 200, returned: 0, truncated: true, jobs: [] },
    }) }],
    ['a reading with nothing in it', { view: {} }],
    ['a failed first read', { answers: [new Error('the read failed')] }],
    /* The pane's own stopped branch (:392, "Start again") is reachable only by
       interaction, and it was the one pane-authored literal no state reached.
       It looked reached, because the SHELL writes `btn-primary` on its own
       failure card -- see the limit stated below. */
    ['a chain that gave up', { answers: [viewFixture(), new Error('gateway')] },
      async (dom) => { for (let i = 0; i < 5; i += 1) await dom.clock.fire(); }],
  ];

  /* The state list is pinned, because nothing else binds it. Measured: with
     six states every class this guard names is reached by more than one of
     them, so deleting ANY single state left the whole file green -- the guard
     would have shrunk silently, which is the one failure mode a coverage
     ratchet exists to prevent. Removing a state now has to be a deliberate
     edit here, stating what stopped being swept. */
  assert.deepStrictEqual(states.map((state) => state[0]), [
    'a full reading',
    'an idle queue',
    'a bounded read that came back empty',
    'a reading with nothing in it',
    'a failed first read',
    'a chain that gave up',
  ], 'the sweep lost or renamed a state, and every state dropped here narrows what it covers');

  const written = new Map();
  for (const [label, opts, drive] of states) {
    const dom = await boot(opts);
    if (drive) await drive(dom);
    let carried = 0;
    for (const node of findAll(livePanel(dom), (n) => n.getAttribute('class'))) {
      carried += 1;
      for (const name of (node.getAttribute('class') || '').trim().split(/\s+/)) {
        if (name && !written.has(name)) written.set(name, label);
      }
    }
    /* Per state, not across them: a sweep whose later boots quietly stopped
       drawing would otherwise coast on the classes the first one found. */
    assert.ok(carried > 0, `${label} drew no class-bearing node at all, so it is `
      + 'contributing nothing to this sweep');
  }

  /* One named class per delivery shape that has previously walked past a
     version of this guard, so that a sweep which stops seeing one of them
     fails on the shape rather than on a total. A count floor would not: it
     cannot fail for the shape it was added for, which is how the parser this
     replaced kept its own coverage looking healthy while it lost a shape. */
  for (const need of ['job-id', 'u-scroll', 'tbl', 'kpi', 'pill', 'up', 'btn', 'btn-sm']) {
    assert.ok(written.has(need), `the DOM sweep never saw ${need}, so its delivery shape is `
      + 'outside the states this test boots');
  }

  /* The states above are the one axis a DOM sweep can be short on, and adding
     one state per round as somebody finds it is the treadmill the parser was
     already on. So the parser comes back -- not as the oracle, but pointed the
     other way: every plain `className: '...'` literal in the pane is a class
     some branch writes, and one the sweep never saw means that branch was
     never booted.

     Its reach is exactly this and no more, and the second half of it cost a
     review round to find: it catches an unreached branch only when NO OTHER
     NODE IN THE SWEPT PANEL carries that class -- and that includes nodes the
     SHELL wrote, not just other pane branches. `btn-primary` is the worked
     example. The pane writes it once, at :392, reachable only by interaction;
     the shell writes it too, on the failure card it draws for `region.failed()`.
     So the failed-read state made `btn-primary` look reached while the pane's
     own branch was not, and a class change inside that branch survived the
     whole repository. The state below drives the interaction, but the masking
     is general: a shell-written name can hide a pane branch from this check.

     So it narrows the state axis rather than closing it. What closes it for a
     given band is a test asserting that band's own words, the way :433 does
     for the bounded-empty one; what closes the class question in the resolved
     sense is scripts/check-ops-result-view.mjs, in a real browser. */
  const source = read('assets/pane-jobs-live-v2.js');
  const inSource = new Set();
  for (const m of source.matchAll(/className:\s*'([^']*)'/g)) {
    for (const name of m[1].trim().split(/\s+/)) if (name) inSource.add(name);
  }
  assert.ok(inSource.size >= 20, `only ${inSource.size} literal classes found in the pane source`);
  const unreached = [...inSource].filter((name) => !written.has(name)).sort();
  assert.deepStrictEqual(unreached, [],
    'the pane writes these classes in a branch no state below boots, so the sweep '
    + 'is not covering them: ' + unreached.join(', '));

  const unpainted = [...written.keys()]
    .filter((name) => !new RegExp('\\.' + name + '(?![\\w-])').test(sheets))
    .sort();
  assert.deepStrictEqual(unpainted, [],
    'the pane writes classes no sheet this page loads defines: '
    + unpainted.map((n) => `${n} (first seen in ${written.get(n)})`).join(', '));
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
