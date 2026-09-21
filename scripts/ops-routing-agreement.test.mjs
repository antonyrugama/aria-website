/* Overview and Problems on one question: is this destination set up?

   `alerts-model.js` says the answer is spelled `=== true` in all three
   places that ask it, and names what goes wrong when it is not: a row
   reading "Connected" while the note above the queue reads "No destination
   is set" is Stadiora/Aria#10630 -- two panes disagreeing during one
   incident -- happening inside one render.

   PR #124 aligned two of the three. `armedState()`'s `configured` filter and
   the Problems pane's routing chip are both bound by
   `scripts/ops-alerts-never-ran.test.mjs`. THE THIRD had nothing on it:
   `pane-overview.js`'s "N routes not set up" chip, which is the one an
   operator sees FIRST, on the pane they are already looking at when a
   problem opens. Round 5 of that PR's review mutated it to `!c.configured`
   and the full 852-test suite stayed green.

   A payload of `configured: 'yes'` -- a string where the column holds a
   boolean, which is what a JSON encoder that stringifies booleans produces --
   made Overview drop the chip entirely while Problems still said "No
   destination has been set" on every row. Overview would have shown a clean
   header over an incident nothing could be sent about.

   So this file asks both panes the same question on the same payload and
   requires the same answer. It renders both rather than comparing source,
   because the agreement that matters is the one on screen. */
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
const OVERVIEW_SRC = read('assets/pane-overview.js');
const ALERTS_SRC = read('assets/pane-alerts.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

/* ------------------------------------------------------------- fixtures */

function summaryFixture() {
  return {
    generatedAt: hoursAgo(0),
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [{ key: 'aria', label: 'Aria', active: 870, tone: 's1' }],
      window: { days: 7 },
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 50,
    },
    aiRuns: { availability: { state: 'ready' }, window: { days: 7 }, runs: 4210 },
    cost: { availability: { state: 'unavailable', reason: 'not_published' } },
    release: { availability: { state: 'unavailable', reason: 'not_published' } },
    activity: { availability: { state: 'unavailable', reason: 'not_published' } },
    omissions: [],
  };
}

/* One enabled rule that reached a verdict, so the rules read is healthy and
   the only thing either pane can be unhappy about is the destination. */
function rulesFixture(channels) {
  return {
    rules: [{
      ruleKey: 'data_silence', id: 'r1', title: 'Data silence', name: 'Data silence',
      category: 'ingestion', categoryLabel: 'Ingestion', severity: 'critical',
      enabled: true, threshold: 'no rows for 6h', thresholdLabel: 'no rows for 6h',
      scopeLabel: 'All sources', scopeDescription: 'All sources',
      lastEvaluationStatus: 'ok', lastEvaluatedAt: hoursAgo(1),
      lastInsufficientReason: null, lastFiredAt: null,
    }],
    channels,
  };
}

function channelsWith(configured) {
  return [
    { channel: 'teams', label: 'Microsoft Teams', configured,
      lastDeliveryStatus: null, lastFailureReason: 'config', consecutiveFailures: 0,
      lastAttemptAt: null, lastSuccessAt: null },
    { channel: 'email', label: 'Email', configured,
      lastDeliveryStatus: null, lastFailureReason: 'config', consecutiveFailures: 0,
      lastAttemptAt: null, lastSuccessAt: null },
  ];
}

/* ------------------------------------------------------------------ boot */

function buildPage(dom, body, pane) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', pane);
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  const app = el(appGate, 'div', { id: 'app' });
  const rail = el(app, 'nav', { id: 'rail' });
  el(rail, 'a', { class: 'nav-item', href: 'alerts.html' }).textContent = 'Problems';
}

async function boot(pane, channels) {
  const answers = {
    '/api/ops/summary': summaryFixture(),
    '/api/ops/alerts/problems': { problems: [] },
    '/api/ops/alerts/rules': rulesFixture(channels),
  };
  const page = pane === 'overview' ? 'index.html' : 'alerts.html';

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/' + page });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body, pane);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      const path = String(endpoint).split('?')[0];
      const answer = answers[path];
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + path));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(pane === 'overview' ? OVERVIEW_SRC : ALERTS_SRC, dom.window,
    { filename: pane === 'overview' ? 'pane-overview.js' : 'pane-alerts.js' });

  for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r));
  return dom;
}

/* ------------------------------------------------------- what is drawn */

const hasClass = (node, name) =>
  String(node.className || '').split(/\s+/).indexOf(name) !== -1;

function shownPanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => n.getAttribute('data-shown') !== null);
  assert.equal(boxes.length, 1,
    `the shell has ${boxes.length} panels on screen at once`);
  return boxes[0];
}

const panelText = (dom) => allText(shownPanel(dom)).replace(/\s+/g, ' ').trim();

/* Overview's chips, each as its own string, so "the header carries this
   chip" is asked of a chip and not of the whole panel. */
function chips(dom) {
  return findAll(shownPanel(dom), (n) => hasClass(n, 'pill'))
    .map((n) => allText(n).replace(/\s+/g, ' ').trim());
}

const routeChip = (dom) => chips(dom).filter((t) => /not set up/.test(t));

/* ------------------------------------------------------------- the tests */

test('Overview says a destination is not set up on every payload Problems does',
  async () => {
    /* The finder, shown working in both directions on values nobody disputes,
       so neither the presence nor the absence below is read off a probe that
       matches everything or nothing. */
    const wired = await boot('overview', channelsWith(true));
    assert.equal(routeChip(wired).length, 0,
      `two configured destinations drew ${JSON.stringify(routeChip(wired))} on Overview`);
    assert.ok(chips(wired).length >= 1,
      'Overview drew no chips at all, so the absence above proves nothing');

    const off = await boot('overview', channelsWith(false));
    assert.deepEqual(routeChip(off), ['2 routes not set up'],
      `two unconfigured destinations drew ${JSON.stringify(chips(off))} on Overview`);

    /* The payload the three spellings disagree on. A string is what an
       encoder that stringifies booleans sends, and it is truthy -- so
       `!c.configured` reads it as configured and `c.configured !== true`
       does not. */
    for (const hostile of ['yes', 'false', 0, 1, null, undefined, {}]) {
      const overview = await boot('overview', channelsWith(hostile));
      const problems = await boot('alerts', channelsWith(hostile));
      const said = panelText(problems);

      const overviewSaysUnset = routeChip(overview).length > 0;
      const problemsSaysUnset = /No destination has been set/.test(said);

      assert.equal(overviewSaysUnset, problemsSaysUnset,
        `on configured: ${JSON.stringify(hostile)} Overview ${overviewSaysUnset
          ? 'says' : 'does not say'} a destination is not set up while Problems `
        + `${problemsSaysUnset ? 'does' : 'does not'} -- the two panes an operator moves `
        + 'between during one incident disagree about whether anyone will be told');

      if (hostile !== true) {
        assert.ok(overviewSaysUnset,
          `configured: ${JSON.stringify(hostile)} is not the boolean the column holds, and `
          + 'Overview read it as set up -- a clean header over an incident nothing can be '
          + 'sent about');
      }
    }
  });
