/* Overview, and strings that are present but say nothing.

   Stadiora/Aria#10799: the pane's `textOf()` accepted any non-empty string,
   so a field holding nothing but spaces was treated as a field with words in
   it. On the severity path that split Overview from the Problems pane on one
   payload -- the disagreement #10630 was filed about, surviving on the other
   pane. Off the severity path it printed punctuation with nothing inside it:
   a trailing comma with no environment after it, an empty pair of brackets
   after a version, a footnote box holding no note.

   Three of the seventeen call sites were the reason the fix is more than one
   line. They used `textOf(x)` as a PREDICATE and then rendered the raw `x`,
   so trimming the predicate alone would have decided with a trimmed value and
   drawn an untrimmed one -- the same defect wearing its own fix. Those three
   are `people.environment`, `platform.versionCode` and `appendNote()`, and
   each has a test below.

   How these bind, and why it is not a source grep:

     - Every assertion reads the RENDERED panel. Asserting that the source
       contains `.trim()` would pin the characters and not the drawing, and a
       call site that resolved the value elsewhere would walk straight past.

     - Every absence assertion is preceded by the same finder locating the
       thing on a render that DOES have it. A finder that matches nothing
       passes an absence test for the wrong reason, and that is how a sweep on
       another pane classified nothing at all and stayed green.

   NOT COVERED here:

     - The severity path. `scripts/ops-alerts-severity-retry.test.mjs`'s
       "Problems and Overview give one word for one state" already runs
       Overview's own `severityWords()` over Overview's own lifted `textOf()`
       and compares it against the Problems pane's rendered pill, for all four
       of that file's hostile payloads including the whitespace one. Repeating
       it here would be a second place to update and no new binding.

     - The other fourteen `textOf()` call sites. They pass the resolved value
       into `text:` directly, so trimming the function is the whole of their
       behaviour and there is no predicate/value split to get wrong. The three
       tested here are the three where the two could diverge. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { makeDom, findAll } from './ops-dom-harness.mjs';

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-overview.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

/* ------------------------------------------------------------- fixtures */

/* A healthy answer carrying all three of the fields under test with real
   words in them. Each test replaces exactly one of those words with spaces,
   so the difference between the two renders is one field and not a fixture. */
function summaryFixture() {
  return {
    generatedAt: '2026-09-20T06:00:00.000Z',
    consent: { basis: 'operational', detail: 'Operational data only.' },
    people: {
      availability: { state: 'ready' },
      platform: { active: 1102, previousActive: 980 },
      apps: [
        { key: 'aria', label: 'Aria', active: 870, tone: 's1' },
        { key: 'ariaxii', label: 'Aria XII', active: 412, tone: 's2' },
      ],
      window: { days: 7 },
      comparison: { days: 7, label: 'the 7 days before' },
      reportingFloor: 50,
      environment: 'production',
    },
    aiRuns: {
      availability: { state: 'ready' },
      window: { days: 7 }, runs: 4210, previous: { runs: 3900 },
    },
    cost: {
      availability: { state: 'ready' },
      window: { days: 7 }, total: { usd: 128.4 },
      comparison: { changeBasisPoints: -420 },
    },
    release: {
      availability: { state: 'ready' },
      version: '2.4.1',
      releasedAt: hoursAgo(50),
      platforms: [
        { platform: 'ios', label: 'iOS', versionName: '2.4.1', versionCode: '2410' },
        { platform: 'android', label: 'Android', versionName: '2.4.1', versionCode: '2411' },
      ],
    },
    /* Empty days, so `activityCard()` takes its no-line branch and reaches
       `appendNote()` with the note -- the shorter of that function's two
       callers and the one that needs no chart data to get to. */
    activity: { availability: { state: 'ready' }, days: [], note: 'Backfilled on 3 Sep.' },
    omissions: [],
  };
}

function problemsFixture() {
  return { problems: [] };
}

function rulesFixture() {
  return {
    rules: [{
      id: 'r1', name: 'Crash-free rate', enabled: true,
      lastEvaluationStatus: 'ok', lastEvaluatedAt: hoursAgo(1), lastFiredAt: null,
    }],
    channels: [],
  };
}

/* ------------------------------------------------------------------ boot */

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
  const app = el(appGate, 'div', { id: 'app' });
  const rail = el(app, 'nav', { id: 'rail' });
  el(rail, 'a', { class: 'nav-item', href: 'alerts.html' }).textContent = 'Problems';
}

async function boot(summary) {
  const answers = {
    '/api/ops/summary': summary,
    '/api/ops/alerts/problems': problemsFixture(),
    '/api/ops/alerts/rules': rulesFixture(),
  };

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/index.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint) => {
      const answer = answers[endpoint];
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
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
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-overview.js' });

  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
  return dom;
}

/* ------------------------------------------------------- what is drawn */

const hasClass = (node, name) =>
  String(node.className || '').split(/\s+/).indexOf(name) !== -1;

function livePanel(dom) {
  const boxes = dom.doc.getElementById('content').querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf('live') !== -1);
  assert.equal(boxes.length, 1, 'the live panel is not a single element to read');
  return boxes[0];
}

/* The text of a node and everything under it, with NOTHING done to the
   whitespace.

   `allText()` from the harness ends in `.replace(/\s+/g, ' ').trim()`, so
   every "this must not carry its own padding" assertion routed through it
   read a string the HARNESS had already tidied. Two drafts of this file were
   blind that way: the first trimmed in the finder, and the second stopped
   trimming in the finder while still calling `allText`, which trims one layer
   down. Both passed while the pane rendered `",   staging  "`. The mutation
   battery's M3, M4 and M5 -- the three payloads that put the predicate/value
   split back -- came back green over the second draft and are what found it.

   Presence is asserted with `includes`, which does not care either way.
   Padding is asserted on this, which is the only thing that can see it. */
function rawText(node) {
  if (!node) return '';
  const own = node.textContent || '';
  const kids = (node.childNodes || []).map(rawText).join('');
  return own + kids;
}

const textsWithClass = (dom, name) =>
  findAll(livePanel(dom), (n) => hasClass(n, name)).map(rawText);

/* The small grey sentence under a tile saying which window and which
   environment the figure came from. */
const whyTexts = (dom) => textsWithClass(dom, 'kpi-why');

/* Every version string in the release tile's rows. */
const versionTexts = (dom) => textsWithClass(dom, 'num');

/* Every card foot on the pane, which is the box `appendNote()` draws into. */
const footTexts = (dom) => textsWithClass(dom, 'card-foot');

/* ------------------------------------------------- the environment suffix */

test('an environment of nothing but spaces does not print a comma with nothing after it',
  async () => {
    /* The finder first has to FIND the suffix on a render that has one.
       Without this the assertion below would pass on a pane that stopped
       drawing `why` lines entirely, which is the failure mode an absence test
       is blind to. */
    const named = whyTexts(await boot(summaryFixture()));
    const withEnvironment = named.filter((t) => t.includes(', production'));
    assert.equal(withEnvironment.length, 1,
      'no line on the healthy render carries ", production", so the absence below reads a '
      + 'pane that never draws the suffix rather than one that suppressed it');

    const blank = summaryFixture();
    blank.people.environment = '   ';
    const texts = whyTexts(await boot(blank));

    assert.equal(texts.length, named.length,
      'the blank environment changed how many why-lines are drawn, so the two renders '
      + 'are not comparable');
    for (const text of texts) {
      assert.doesNotMatch(text.trimEnd(), /,$/,
        `"${text}" ends in a comma with nothing after it -- the pane committed to naming an `
        + 'environment and then named none');
    }
  });

test('an environment with words either side of the spaces still prints the words',
  async () => {
    /* The other direction of the same trim, and the one that stops the fix
       from being "drop the field whenever it looks odd". `'  staging  '` is a
       real environment badly typed, and it must survive. */
    const padded = summaryFixture();
    padded.people.environment = '  staging  ';
    const texts = whyTexts(await boot(padded));

    assert.equal(texts.filter((t) => t.includes(', staging')).length, 1,
      'a padded environment name did not reach the screen, so the trim is deleting text '
      + 'rather than tidying it');
    for (const text of texts) {
      assert.doesNotMatch(text, /,\s\s/,
        `"${text}" carries the field's own padding onto the screen, so the predicate and the `
        + 'value disagree about what the string is');
    }
  });

/* ----------------------------------------------------- the version code */

test('a version code of nothing but spaces does not print empty brackets', async () => {
  const named = versionTexts(await boot(summaryFixture()));
  assert.equal(named.filter((t) => t.includes('(2410)')).length, 1,
    'no version row carries "(2410)" on the healthy render, so the absence below proves '
    + 'nothing about brackets');

  const blank = summaryFixture();
  blank.release.platforms[0].versionCode = '   ';
  const texts = versionTexts(await boot(blank));

  assert.equal(texts.length, named.length,
    'the blank version code changed how many version rows are drawn');
  for (const text of texts) {
    assert.doesNotMatch(text, /\(\s*\)/,
      `"${text}" prints an empty pair of brackets where a build number belongs`);
  }
  assert.equal(texts.filter((t) => t.includes('(2411)')).length, 1,
    'the OTHER platform lost its build number too, so the blank one took down a row it '
    + 'has nothing to do with');
});

test('a version code padded with spaces prints without its padding', async () => {
  /* The third site's padded case, which the first draft of this file did not
     have. The blank case cannot see the predicate/value split here -- a code
     of three spaces resolves to null either way and draws no brackets -- so
     without this test the site was bound in one direction only. Battery row
     M4 stayed green until it existed. */
  const padded = summaryFixture();
  padded.release.platforms[0].versionCode = '  2410  ';
  const texts = versionTexts(await boot(padded));

  assert.ok(texts.some((t) => t.includes('(2410)')),
    `the padded build number drew as ${JSON.stringify(texts)} rather than "(2410)"`);
  for (const text of texts) {
    assert.doesNotMatch(text, /\(\s|\s\)/,
      `"${text}" carries the field's own padding inside the brackets, so the predicate `
      + 'trimmed and the render did not');
  }
});

/* ------------------------------------------------------------- the note */

test('a note of nothing but spaces does not draw an empty footnote', async () => {
  const named = footTexts(await boot(summaryFixture()));
  assert.ok(named.some((t) => t.includes('Backfilled on 3 Sep.')),
    'the healthy render does not carry the note at all, so the absence below reads a pane '
    + 'that never draws notes');

  const blank = summaryFixture();
  blank.activity.note = '   ';
  const texts = footTexts(await boot(blank));

  assert.equal(texts.length, named.length - 1,
    `the blank note drew ${texts.length} card feet against ${named.length - 1} expected -- `
    + 'an element holding no words is an element an operator cannot see and cannot skip');
  for (const text of texts) {
    assert.notEqual(text.trim(), '',
      'a card foot reached the screen with nothing in it');
  }
});

test('a note padded with spaces prints without its padding', async () => {
  const padded = summaryFixture();
  padded.activity.note = '  Backfilled on 3 Sep.  ';
  const texts = footTexts(await boot(padded));

  assert.ok(texts.some((t) => t.includes('Backfilled on 3 Sep.')),
    'the padded note did not reach the screen as its own words');
  for (const text of texts) {
    assert.doesNotMatch(text, /^\s|\s$/,
      `"${text}" carries its own padding into the DOM, so the predicate trimmed and the `
      + 'render did not');
  }
});
