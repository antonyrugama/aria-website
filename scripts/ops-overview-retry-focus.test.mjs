/* The retry, focus and announcement behaviour of the Today page.

   Every section of Today draws from its own reads and offers its own Try
   again, because the halves of this page come from different tables and an
   operator who cannot see spend can still act on a critical problem. Pressing
   one re-reads only the read that failed and redraws only the sections that
   draw from it, which DESTROYS the button that was pressed. Two things follow
   from that and are what this file binds:

     - Focus falls to <body> unless the pane puts it somewhere on purpose: a
       keyboard operator is thrown to the top of the page by the control they
       just used. It lands on the heading of the section that was re-read,
       made focusable for the purpose, whether the retry worked or not.

     - A screen-reader operator hears nothing about what happened to the read
       unless it is said, so the outcome is announced: the section came back,
       or the same failure is still there.

   How these bind behaviour rather than sentences:

     - Focus is asserted as CONTAINMENT in the section host, inside the panel
       the operator can see, not as `activeElement !== body`. The harness leaves
       activeElement pointing at the detached button after a re-render, which is
       not what a browser does, but a detached node is not inside the shown
       panel in either, so the containment question has the same answer in
       both.

     - Every retry this page can draw is pressed IN THIS FILE and each one's
       read is counted through `dom.calls`, so a button wired to a no-op fails.

     - Two batches of reads can be held in flight at once and released in an
       order the test chooses (`dom.hold` / `dom.release`). Which of two
       overlapping retries is allowed to move focus and draw is decided by that
       order, not by a sleep, so the answer is the same on a laptop and on the
       runner.

     - The button's name and the announcement are asserted against the heading
       they were composed from, resolved through the button's own
       aria-labelledby, so a heading that changes is caught.

   NOT COVERED here, deliberately:

     - What a real browser does to focus when a focused element is removed. The
       harness has no focus manager. What is asserted is where this code PUTS
       focus, which is the half this page owns.

     - Whether the announcement is spoken. A `role="status"` region's text is
       what a test can see; the speaking is the screen reader's.

     - What a browser does with a rapid double-press. The race test decides the
       completion order itself; what is bound is the consequence, that an
       obsolete read must not move focus or draw over a newer one. */
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
const PANE_SRC = read('assets/pane-overview.js');

const TOKENS = {
  '--cyan': '#00E5FF', '--violet': '#8B5CF6', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#F87171', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#F5F5F7',
};

/* ------------------------------------------------------------- fixtures */

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const GOOD = {
  summary: () => ({
    generatedAt: '2026-11-01T09:41:00.000Z',
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [{ app: 'mobile', label: 'Mobile', active: 870 }],
      window: { start: '2026-10-25T00:00:00.000Z', endExclusive: '2026-11-01T00:00:00.000Z', days: 7 },
      comparison: { days: 7 },
    },
    aiRuns: {
      availability: { state: 'ready' }, runs: 4820, previous: { runs: 4410, daysReported: 7 },
      daysMissing: [], daysReported: 7, window: { days: 7 },
    },
  }),
  usage: () => ({
    window: { endExclusive: '2026-11-01T00:00:00.000Z', daysCovered: 7, daysMissingRollups: [] },
    availability: { state: 'ready' },
    apps: [{ app: 'mobile', label: 'Mobile', trend: { values: [3, 4, 5, 6, 7, 8, 9] } }],
  }),
  problems: () => ({ problems: [], total: 0 }),
  rules: () => ({
    rules: [{ key: 'q', enabled: true, lastEvaluatedAt: minutesAgo(5), lastEvaluationStatus: 'ok' }],
    channels: [{ key: 'teams', configured: true }],
  }),
  jobs: () => ({
    generatedAt: '2026-11-01T09:40:00.000Z',
    queue: { open: 3, byState: [{ state: 'running', jobs: 1 }, { state: 'queued', jobs: 2 }] },
    attention: { completeness: 'whole_queue', stuck: [] },
  }),
  runs: () => ({
    window: { range: '24h' }, coverage: { state: 'ready', coversWindow: true },
    summary: { completed: 9, failed: 1 },
  }),
  costs: () => ({
    availability: { state: 'ready' }, currency: 'USD',
    period: { start: '2026-10-01T00:00:00.000Z', actualThrough: '2026-10-31T00:00:00.000Z', billedDays: 3 },
    total: { micros: 300_000_000 },
    daily: { series: [{ values: [90_000_000, 100_000_000, 110_000_000] }] },
  }),
};

const URL_OF = {
  summary: '/api/ops/summary', usage: '/api/ops/usage',
  problems: '/api/ops/alerts/problems', rules: '/api/ops/alerts/rules',
  jobs: '/api/ops/jobs', runs: '/api/ops/runs', costs: '/api/ops/costs',
};

/* The failures' messages are distinct on purpose: every "the right failure
   reached the screen" assertion below would pass on the wrong one if they
   read alike. */
const boom = (what) => Object.assign(new Error(what + ' is down'), { status: 503 });

/* The failure each read can make on screen, what it says, where it lives, what
   is said when it comes back, and what repairs it. This table is the claim
   under test: a failure that is not here has no way to be asked again. */
const CASES = [
  { name: 'problems', section: 'health', headline: 'Problems unread', spoken: 'Health',
    reads: ['problems'], fail: { problems: boom('problems') } },
  { name: 'rules', section: 'health', headline: 'Checks unread', spoken: 'Health',
    reads: ['rules'], fail: { rules: boom('rules') } },
  { name: 'summary, in the people figure', section: 'people', headline: 'Active people could not be read',
    spoken: 'Active people', reads: ['summary'], fail: { summary: boom('summary') } },
  { name: 'summary, in the AI tile', section: 'ai', headline: 'AI runs could not be read',
    spoken: 'Aria AI', reads: ['summary'], fail: { summary: boom('summary') } },
  { name: 'usage', section: 'charts', headline: 'The daily lines could not be read',
    spoken: 'Daily lines', reads: ['usage'], fail: { usage: boom('usage') } },
  { name: 'jobs', section: 'jobs', headline: 'Jobs could not be read',
    spoken: 'Happening now', reads: ['jobs'], fail: { jobs: boom('jobs') } },
  { name: 'runs', section: 'ai', headline: 'Last 24h could not be read',
    spoken: 'Aria AI', reads: ['runs'], fail: { runs: boom('runs') } },
  { name: 'costs', section: 'spend', headline: 'Cloud spend could not be read',
    spoken: 'Cloud spend', reads: ['costs'], fail: { costs: boom('costs') } },
];

/* --------------------------------------------------------------- booting */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'overview');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* `failing` replaces the named reads' answers with their failure. The answer
   table is handed back live, so a test can repair a read between loads and
   watch the section recover. */
async function boot(failing) {
  const answers = {};
  for (const key of Object.keys(URL_OF)) {
    answers[URL_OF[key]] = (failing && failing[key]) || GOOD[key]();
  }
  const calls = {};
  const settle = async (n) => {
    for (let i = 0; i < (n || 12); i += 1) await new Promise((r) => setImmediate(r));
  };

  /* Reads that can be held and released in an order the test chooses. Two
     presses in quick succession are two batches in flight at once, and which
     one lands first is the whole question, so it is decided deliberately.
     Held answers are read at RELEASE time, the way a server answers late, so a
     test can repair or break a read between the press and the reply. */
  const held = new Set();
  const waiting = [];

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/index.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  const batchOf = (endpoint) => waiting.filter((w) => w.endpoint === endpoint).length;
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      calls[endpoint] = (calls[endpoint] || 0) + 1;
      const now = () => {
        const answer = answers[endpoint];
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
        return Promise.resolve({ data: answer });
      };
      if (!held.has(endpoint)) return now();
      return new Promise((resolve, reject) => {
        waiting.push({ endpoint, batch: batchOf(endpoint), send: () => now().then(resolve, reject) });
      });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  /* Every time the shell re-seats the pane's content. It takes the content out
     of the document and puts it back, which is what drops a browser's focus,
     so a read that is not allowed to touch the page must not cause one. */
  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (state) {
    states.push(String(state));
    return applyState.call(dom.window.Aria, state);
  };
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });

  await settle();
  const hold = (...endpoints) => endpoints.forEach((e) => held.add(e));
  /* `endpoints` narrows the release to those reads, for two retries of
     different sections whose reads are each in their own batch zero. */
  const release = async (batch, ...endpoints) => {
    const mine = waiting.filter((w) => w.batch === batch
      && (!endpoints.length || endpoints.includes(w.endpoint)));
    assert.ok(mine.length, 'nothing is waiting in batch ' + batch);
    mine.forEach((w) => {
      waiting.splice(waiting.indexOf(w), 1);
      w.send();
    });
    await settle(20);
  };
  const repair = (...keys) => keys.forEach((k) => { answers[URL_OF[k]] = GOOD[k](); });
  const breakAgain = (...keys) => keys.forEach((k) => { answers[URL_OF[k]] = boom(k); });
  return Object.assign(dom, { answers, calls, states, settle, hold, release, waiting, repair, breakAgain });
}

/* ---------------------------------------------------------- what is drawn */

const classesOf = (n) => String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);

/* Whichever of the shell's three panels is the one showing. They all sit in
   #content at once and only data-shown says which the operator sees, so a test
   that reads one unconditionally reads a hidden one for a render that went
   elsewhere. */
function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once, so "what the operator sees" `
    + 'is not a single answer and nothing below means what it says');
  return boxes[0];
}

const retriesIn = (root) => findAll(root, (n) => n.getAttribute && n.getAttribute('data-retry') !== null);
const retryFor = (dom, headline) => retriesIn(shownPanel(dom)).filter((n) => n.getAttribute('data-retry') === headline);
const host = (dom, id) => dom.doc.getElementById('today-' + id);

const inside = (node, root) => {
  for (let n = node; n; n = n.parentNode) if (n === root) return true;
  return false;
};

/* The heading a retry is named after, reached the way a browser reaches it:
   through the second id in aria-labelledby, resolved against the document.
   Never through data-retry, which is the value under test in one of these. */
function namingHeading(dom, button) {
  const ids = String(button.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 2,
    'a retry should be named by its own word plus one heading, got: ' + ids.join(','));
  assert.equal(ids[0], button.getAttribute('id'), 'a retry is not part of its own name');
  const head = dom.doc.getElementById(ids[1]);
  assert.ok(head, 'aria-labelledby points at ' + ids[1] + ', which is not in the document');
  return head;
}

/* What the shell's polite region is currently saying. The toast host also uses
   role=status, so this narrows on the live region's own class. */
function announcement(dom) {
  const said = findAll(dom.doc.body, (n) => n.getAttribute
    && n.getAttribute('role') === 'status'
    && classesOf(n).includes('sr'));
  return said.length ? String(said[said.length - 1].textContent || '') : '';
}

/* Press a control and let every promise it started settle. */
async function press(dom, button) {
  tap(button);
  await dom.settle(20);
}

/* Press without waiting: the half of a press a race test needs, because the
   second press has to happen while the first read is still in flight. */
function tap(button) {
  button.focus();
  button.dispatchEvent({ type: 'click' });
}

const asked = (dom, key) => dom.calls[URL_OF[key]] || 0;
const wholeCardButton = (dom) => findAll(shownPanel(dom), (n) => n.tagName === 'BUTTON' && allText(n) === 'Try again')[0];
const WHOLE = 'This pane could not be read';

/* ================================ the buttons ============================ */

test('every read that can fail has exactly one way to ask again, in the section it failed in', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    const found = retryFor(dom, c.headline);
    assert.equal(found.length, 1, c.name + ': expected exactly one retry named "' + c.headline + '"');
    assert.equal(found[0].tagName, 'BUTTON');
    assert.equal(found[0].getAttribute('type'), 'button');
    assert.equal(allText(found[0]), 'Try again');
    assert.ok(inside(found[0], host(dom, c.section)), c.name + ': the retry is not in the ' + c.section + ' section');
  }
});

test('a retry is named by its own word and the heading beside it, and says the same heading when it speaks', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    const [button] = retryFor(dom, c.headline);
    const head = namingHeading(dom, button);
    assert.equal(allText(head), c.headline, c.name + ': the name and the data-retry value are different headings');
    assert.ok(inside(head, host(dom, c.section)), c.name + ': the heading is in another section');
  }
});

test('a failure is stated once on a screen, never twice', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    const text = allText(shownPanel(dom));
    assert.equal(text.split(c.headline).length - 1, 1, c.name + ': "' + c.headline + '" is on the screen more than once');
  }
});

test('the retries on one screen each have a name of their own', async () => {
  const dom = await boot({
    summary: boom('summary'), usage: boom('usage'), jobs: boom('jobs'), runs: boom('runs'),
    costs: boom('costs'), problems: boom('problems'),
  });
  const retries = retriesIn(shownPanel(dom));
  assert.equal(retries.length, 7, 'every failed section has a retry');
  const names = retries.map((b) => allText(namingHeading(dom, b)));
  assert.equal(new Set(names).size, names.length, 'two retries share a name: ' + names.join(' | '));
  const ids = retries.map((b) => b.getAttribute('id'));
  assert.equal(new Set(ids).size, ids.length, 'two retries share an id');
});

/* ================================ pressing ================================ */

test('pressing a retry asks for its own read again, and for nothing else', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    const before = Object.fromEntries(Object.keys(URL_OF).map((k) => [k, asked(dom, k)]));
    await press(dom, retryFor(dom, c.headline)[0]);
    for (const key of Object.keys(URL_OF)) {
      const expected = before[key] + (c.reads.includes(key) ? 1 : 0);
      assert.equal(asked(dom, key), expected,
        c.name + ': ' + key + ' was asked ' + asked(dom, key) + ' times, wanted ' + expected);
    }
  }
});

test('a read that comes back takes its own failure off the screen and draws the section', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    dom.repair(...c.reads);
    await press(dom, retryFor(dom, c.headline)[0]);
    assert.equal(retryFor(dom, c.headline).length, 0, c.name + ': the failure is still on the screen');
    assert.ok(!allText(shownPanel(dom)).includes(c.headline), c.name + ': the headline is still on the screen');
    assert.equal(retriesIn(shownPanel(dom)).length, 0, c.name + ': a retry is left with nothing to retry');
  }
});

test('a read that is still down keeps one retry in the same place and says it is still down', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    await press(dom, retryFor(dom, c.headline)[0]);
    const again = retryFor(dom, c.headline);
    assert.equal(again.length, 1, c.name + ': expected one retry after a failed retry, found ' + again.length);
    assert.ok(inside(again[0], host(dom, c.section)));
    assert.equal(announcement(dom), c.headline + ' again.', c.name);
  }
});

test('a retry can be pressed again and again, and asks each time', async () => {
  const dom = await boot({ jobs: boom('jobs') });
  for (let n = 2; n <= 4; n += 1) {
    await press(dom, retryFor(dom, 'Jobs could not be read')[0]);
    assert.equal(asked(dom, 'jobs'), n);
  }
  dom.repair('jobs');
  await press(dom, retryFor(dom, 'Jobs could not be read')[0]);
  assert.equal(retryFor(dom, 'Jobs could not be read').length, 0);
});

test('one read behind two failures is asked once, and both failures go when it comes back', async () => {
  const dom = await boot({ summary: boom('summary') });
  assert.equal(retryFor(dom, 'Active people could not be read').length, 1);
  assert.equal(retryFor(dom, 'AI runs could not be read').length, 1);
  dom.repair('summary');
  await press(dom, retryFor(dom, 'Active people could not be read')[0]);
  assert.equal(asked(dom, 'summary'), 2, 'the summary was asked once per press');
  assert.equal(retriesIn(shownPanel(dom)).length, 0, 'the AI failure outlived the read it was about');
});

/* ================================== focus ================================= */

test('focus lands on the heading of the section that was re-read, whether it came back or not', async () => {
  for (const repaired of [true, false]) {
    for (const c of CASES) {
      const dom = await boot(c.fail);
      if (repaired) dom.repair(...c.reads);
      await press(dom, retryFor(dom, c.headline)[0]);
      const focus = dom.doc.activeElement;
      const label = c.name + (repaired ? ' (came back)' : ' (still down)');
      assert.ok(focus, label + ': nothing has focus');
      assert.ok(inside(focus, shownPanel(dom)), label + ': focus is outside the panel the operator can see');
      assert.ok(inside(focus, host(dom, c.section)), label + ': focus is not in the ' + c.section + ' section');
      assert.ok(classesOf(focus).some((k) => k === 'sec-title' || k === 'state-title'), label + ': focus is not on a heading');
    }
  }
});

test('the heading that takes focus is focusable, not merely focused', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    await press(dom, retryFor(dom, c.headline)[0]);
    assert.equal(dom.doc.activeElement.getAttribute('tabindex'), '-1',
      c.name + ': a heading with no tabindex cannot hold focus in a browser');
  }
});

test('each retry lands in its own section rather than in the first one', async () => {
  const dom = await boot({ jobs: boom('jobs'), costs: boom('costs') });
  await press(dom, retryFor(dom, 'Cloud spend could not be read')[0]);
  assert.ok(inside(dom.doc.activeElement, host(dom, 'spend')), 'focus did not land in the section that was retried');
  assert.ok(!inside(dom.doc.activeElement, host(dom, 'jobs')));
  await press(dom, retryFor(dom, 'Jobs could not be read')[0]);
  assert.ok(inside(dom.doc.activeElement, host(dom, 'jobs')));
  assert.equal(asked(dom, 'jobs'), 2);
  assert.equal(asked(dom, 'costs'), 2, 'the first retry was asked for again by the second');
});

test('focus still lands when the retry works and deletes its own control', async () => {
  const dom = await boot({ jobs: boom('jobs') });
  const [button] = retryFor(dom, 'Jobs could not be read');
  dom.repair('jobs');
  await press(dom, button);
  assert.equal(inside(button, shownPanel(dom)), false, 'the pressed button is still on the screen');
  assert.notEqual(dom.doc.activeElement, button, 'focus stayed on a node that is gone');
  assert.ok(inside(dom.doc.activeElement, host(dom, 'jobs')));
});

/* ============================== the announcement ========================= */

test('a read that came back is announced as having come back, under the section\'s name', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    dom.repair(...c.reads);
    await press(dom, retryFor(dom, c.headline)[0]);
    assert.equal(announcement(dom), c.spoken + ' was read again.', c.name);
  }
});

test('a read that is still down is announced with the heading its button was named after', async () => {
  for (const c of CASES) {
    const dom = await boot(c.fail);
    const heading = allText(namingHeading(dom, retryFor(dom, c.headline)[0]));
    await press(dom, retryFor(dom, c.headline)[0]);
    assert.equal(announcement(dom), heading + ' again.', c.name);
  }
});

test('two failures on one screen announce the one that was retried', async () => {
  const dom = await boot({ jobs: boom('jobs'), costs: boom('costs') });
  await press(dom, retryFor(dom, 'Jobs could not be read')[0]);
  assert.equal(announcement(dom), 'Jobs could not be read again.');
  await press(dom, retryFor(dom, 'Cloud spend could not be read')[0]);
  assert.equal(announcement(dom), 'Cloud spend could not be read again.');
  dom.repair('jobs');
  await press(dom, retryFor(dom, 'Jobs could not be read')[0]);
  assert.equal(announcement(dom), 'Happening now was read again.',
    'the retried read came back, and the failure beside it is not the news');
});

/* ============================ the whole-pane card ======================== */

const EVERY_CORE = ['summary', 'usage', 'problems', 'rules', 'jobs', 'runs', 'costs'];
const allDown = () => Object.fromEntries(EVERY_CORE.map((k) => [k, boom(k)]));

test('when every read is down the pane says so once, with one way to ask again', async () => {
  const dom = await boot(allDown());
  const text = allText(shownPanel(dom));
  assert.ok(text.includes(WHOLE), text);
  assert.equal(text.split(WHOLE).length - 1, 1);
  assert.equal(retriesIn(shownPanel(dom)).length, 0, 'the sections are not drawn behind the card');
  assert.equal(host(dom, 'health'), null, 'a section is on a screen that failed as a whole');
  assert.ok(wholeCardButton(dom), 'the card has no Try again');
});

test('the whole-pane retry asks for every read again and lands focus when they come back', async () => {
  const dom = await boot(allDown());
  dom.repair(...EVERY_CORE);
  await press(dom, wholeCardButton(dom));
  for (const key of Object.keys(URL_OF)) assert.equal(asked(dom, key), 2, key + ' was not asked again');
  assert.ok(host(dom, 'health') && inside(host(dom, 'health'), shownPanel(dom)), 'the page did not come back');
  assert.ok(!allText(shownPanel(dom)).includes(WHOLE));
  assert.ok(inside(dom.doc.activeElement, shownPanel(dom)), 'focus is not in the panel the operator can see');
  assert.equal(dom.doc.activeElement.getAttribute('tabindex'), '-1');
  assert.equal(announcement(dom), 'Today was read again.');
});

test('the whole-pane retry that fails again lands on the card and says so', async () => {
  const dom = await boot(allDown());
  await press(dom, wholeCardButton(dom));
  assert.ok(allText(shownPanel(dom)).includes(WHOLE));
  assert.ok(inside(dom.doc.activeElement, shownPanel(dom)));
  assert.equal(allText(dom.doc.activeElement), WHOLE);
  assert.equal(announcement(dom), WHOLE + ' again.');
});

test('a whole-pane retry that brings back only some of the page says how much is still down', async () => {
  const dom = await boot(allDown());
  dom.repair('summary', 'usage', 'problems', 'rules', 'jobs');
  await press(dom, wholeCardButton(dom));
  assert.ok(host(dom, 'health'), 'the page that did come back is not drawn');
  assert.equal(retriesIn(shownPanel(dom)).length, 2, 'runs and costs are still down');
  assert.equal(announcement(dom), 'Today was read again. 2 parts could not be read.');
});

test('a section retry announces the section, never the whole page', async () => {
  const dom = await boot({ runs: boom('runs') });
  dom.repair('runs');
  await press(dom, retryFor(dom, 'Last 24h could not be read')[0]);
  assert.equal(announcement(dom), 'Aria AI was read again.');
});

/* ================================ a late answer ========================== */

test('a superseded whole-pane retry does not draw over a newer one or take focus back', async () => {
  const dom = await boot(allDown());
  dom.hold(...Object.values(URL_OF));
  const button = wholeCardButton(dom);
  tap(button);
  tap(button);
  await dom.settle();
  assert.equal(dom.waiting.length, 14, 'two batches of seven reads are in flight');

  /* The newer press is answered with a healthy system, the older one lands
     last and is answered with a failure. Whatever it carries must not reach
     the screen. */
  dom.repair(...EVERY_CORE);
  await dom.release(1);
  assert.ok(host(dom, 'health'), 'the newer answer did not draw');
  const focused = dom.doc.activeElement;
  dom.breakAgain(...EVERY_CORE);
  await dom.release(0);
  assert.ok(host(dom, 'health') && !allText(shownPanel(dom)).includes(WHOLE),
    'an older answer replaced the newer one');
  assert.equal(retriesIn(shownPanel(dom)).length, 0, 'an older answer drew failures over a healthy page');
  assert.equal(dom.doc.activeElement, focused, 'an older answer took focus');
  assert.equal(announcement(dom), 'Today was read again.', 'an older answer spoke');
});

test('a superseded press that finishes first draws nothing, and the newer one draws when it lands', async () => {
  const dom = await boot(allDown());
  dom.hold(...Object.values(URL_OF));
  const button = wholeCardButton(dom);
  tap(button);
  tap(button);
  await dom.settle();
  dom.repair(...EVERY_CORE);
  await dom.release(0);
  assert.equal(host(dom, 'health'), null, 'the older press drew while a newer one was still in flight');
  await dom.release(1);
  assert.ok(host(dom, 'health'), 'the newer press did not draw');
});

/* ============================= a late section answer ===================== */

/* The same race on the path a keyboard operator actually reaches: a section's
   own Try again, pressed twice, or two sections' retries overlapping. The
   whole-pane tests above never touch it. */

test('a superseded section retry does not draw over a newer one, take focus back or speak', async () => {
  const dom = await boot({ summary: boom('summary') });
  dom.hold(URL_OF.summary);
  const button = retryFor(dom, 'Active people could not be read')[0];
  tap(button);
  tap(button);
  await dom.settle();
  assert.equal(dom.waiting.length, 2, 'two reads of the summary are in flight');

  dom.repair('summary');
  await dom.release(1);
  assert.ok(allText(host(dom, 'people')).includes('1,102'), 'the newer answer did not draw');
  assert.equal(retriesIn(shownPanel(dom)).length, 0);
  const focused = dom.doc.activeElement;
  assert.ok(inside(focused, host(dom, 'people')), 'the newer answer did not land focus on its section');
  const redrawn = dom.states.length;

  dom.breakAgain('summary');
  await dom.release(0);
  assert.ok(allText(host(dom, 'people')).includes('1,102'), 'an older failure replaced the newer reading');
  assert.equal(retriesIn(shownPanel(dom)).length, 0, 'an older failure drew a failure over a healthy page');
  assert.equal(dom.doc.activeElement, focused, 'an older answer took focus');
  assert.equal(announcement(dom), 'Active people was read again.', 'an older answer spoke');
  assert.equal(dom.states.length, redrawn, 'an older answer re-seated the page');
});

test('a superseded section retry that finishes first draws nothing, and the newer one draws when it lands', async () => {
  const dom = await boot({ summary: boom('summary') });
  dom.hold(URL_OF.summary);
  const button = retryFor(dom, 'Active people could not be read')[0];
  tap(button);
  tap(button);
  await dom.settle();

  dom.repair('summary');
  await dom.release(0);
  assert.ok(!allText(host(dom, 'people')).includes('1,102'), 'the older press drew while a newer one was still in flight');
  assert.equal(retryFor(dom, 'Active people could not be read').length, 1, 'the failure the operator pressed was taken away');
  assert.equal(announcement(dom), '', 'the older press spoke while a newer one was still in flight');
  const before = dom.states.length;

  await dom.release(1);
  assert.ok(allText(host(dom, 'people')).includes('1,102'), 'the newer press did not draw');
  assert.ok(inside(dom.doc.activeElement, host(dom, 'people')));
  assert.equal(announcement(dom), 'Active people was read again.');
  assert.ok(dom.states.length > before);
});

test('two buttons for one read supersede each other the same way, and the section that did not ask is redrawn', async () => {
  const dom = await boot({ summary: boom('summary') });
  dom.hold(URL_OF.summary);
  tap(retryFor(dom, 'Active people could not be read')[0]);
  tap(retryFor(dom, 'AI runs could not be read')[0]);
  await dom.settle();
  assert.equal(dom.waiting.length, 2);

  dom.repair('summary');
  await dom.release(1);
  dom.breakAgain('summary');
  await dom.release(0);
  assert.ok(allText(host(dom, 'people')).includes('1,102'), 'the older retry took the people figure away');
  assert.equal(retriesIn(shownPanel(dom)).length, 0, 'the older retry drew a failure over a healthy page');
  assert.ok(inside(dom.doc.activeElement, host(dom, 'ai')), 'focus went to the retry that lost');
  assert.equal(announcement(dom), 'Aria AI was read again.');
});

test('retries of different sections overlap without discarding each other, in either order', async () => {
  for (const first of ['jobs', 'costs']) {
    const second = first === 'jobs' ? 'costs' : 'jobs';
    const headline = { jobs: 'Jobs could not be read', costs: 'Cloud spend could not be read' };
    const spoken = { jobs: 'Happening now was read again.', costs: 'Cloud spend was read again.' };
    const dom = await boot({ jobs: boom('jobs'), costs: boom('costs') });
    dom.hold(URL_OF.jobs, URL_OF.costs);
    tap(retryFor(dom, headline[first])[0]);
    tap(retryFor(dom, headline[second])[0]);
    await dom.settle();
    assert.equal(dom.waiting.length, 2, 'one read of each is in flight');

    dom.repair('jobs', 'costs');
    /* The press made second answers first; the one made first answers last.
       Neither read was asked for again, so both are the newest of their own. */
    await dom.release(0, URL_OF[second]);
    assert.equal(retryFor(dom, headline[second]).length, 0, second + ' did not draw');
    assert.equal(retryFor(dom, headline[first]).length, 1, first + ' drew before it was answered');
    await dom.release(0, URL_OF[first]);
    assert.equal(retriesIn(shownPanel(dom)).length, 0, first + ' was discarded by the other section\'s retry');
    const sectionOf = { jobs: 'jobs', costs: 'spend' };
    assert.ok(inside(dom.doc.activeElement, host(dom, sectionOf[first])), 'focus is not on the last answer to land');
    assert.equal(announcement(dom), spoken[first]);
  }
});

/* ================================= a throw =============================== */

/* A payload that makes drawing throw: a getter that fails when the pane reads
   people out of it. The reads themselves cannot reject, so this is the one
   failure that reaches the pane's own catch. */
const walkable = () => GOOD.summary();
const hostile = () => ({ get people() { throw new Error('summary shape is wrong'); }, aiRuns: {} });

test('a render that throws leaves the whole-pane card with a retry that lands focus', async () => {
  const dom = await boot({ summary: hostile() });
  assert.ok(allText(shownPanel(dom)).includes(WHOLE), 'a render that threw left nothing to say so');
  assert.equal(retriesIn(shownPanel(dom)).length, 0);
  const button = wholeCardButton(dom);
  assert.ok(button, 'a render that threw left no way to ask again');
  await press(dom, button);
  assert.equal(asked(dom, 'summary'), 2, 'the retry did not ask again');
  assert.ok(inside(dom.doc.activeElement, shownPanel(dom)), 'focus did not land in the panel that is shown');
  assert.equal(announcement(dom), WHOLE + ' again.');
});

test('a render that throws recovers when the payload it choked on comes back walkable', async () => {
  const dom = await boot({ summary: hostile() });
  dom.answers[URL_OF.summary] = walkable();
  await press(dom, wholeCardButton(dom));
  assert.ok(host(dom, 'people'), 'the page did not come back');
  assert.ok(!allText(shownPanel(dom)).includes(WHOLE));
  assert.equal(allText(host(dom, 'people')).includes('1,102'), true);
  assert.ok(inside(dom.doc.activeElement, shownPanel(dom)));
  assert.equal(announcement(dom), 'Today was read again.');
});
