/* Overview, and strings that are present but say nothing.

   Stadiora/Aria#10799: the pane's `textOf()` accepted any non-empty string,
   so a field holding nothing but spaces was treated as a field with words in
   it. On the severity path that split Overview from the Problems pane on one
   payload -- the disagreement #10630 was filed about, surviving on the other
   pane. Off the severity path it printed punctuation with nothing inside it:
   a trailing comma with no environment after it, an empty pair of brackets
   after a version, a footnote box holding no note.

   FIVE call sites were the reason the fix is more than one line. They used `textOf(x)` as a PREDICATE and then rendered the raw `x`,
   so trimming the predicate alone would have decided with a trimmed value and
   drawn an untrimmed one -- the same defect wearing its own fix. They are
   `people.environment`, `platform.versionCode`, `appendNote()`,
   `platform.versionName` and `omissionsCard()`'s `entry.key`, and each has a
   test below.

   The last two of those five were found by the independent review of PR #124,
   not by the sweep. SIX MORE were found by the rendered sweep at the bottom
   of this file, and not one of the six is a `textOf()` call site at all -- so
   no census of `textOf()` calls, however carefully counted, could ever have
   reached them. That is the argument for the sweep in one line: it asks the
   screen what it drew rather than asking the source what it should have.

   The six are not listed here. A list in a comment is what this file is
   arguing against, and three of them were counted wrong in the first
   draft of this very paragraph. `git log -p` has them; the sweep at the
   bottom of the file has the invariant.

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

     - No enumeration of the other call sites, by name, by line or by count.
       Two rounds of review found two different censuses wrong: the first
       said "the other fourteen have no predicate/value split to get wrong"
       and had missed two, and the REPLACEMENT -- eleven sites named with
       line numbers -- was wrong in most of its line numbers and in two of
       its classifications, written inside the commit that was fixing the
       first one.

       A census in a comment is a claim nothing executes, and it goes stale
       on the next edit to the file it describes. `padding any string the
       answer carries changes nothing on the screen`, at the bottom of this
       file, is what replaced it: the invariant the census existed to assert,
       checked against the render. It binds every call site the fixtures'
       own strings reach -- which is not all of them, and the block above
       that test says which parts of the pane it does not reach. */
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
      /* `micros`, not `total.usd`. Round 3 of PR #124's review found the
         earlier shape meant `costTile()` read `cost.micros` as null and every
         sweep render took the tile's unavailable branch -- so the whole tile,
         including `cost.comparison.label`, was outside the experiment while
         the sweep looked like it covered it. The baseline gate below now
         asserts the figure reached the screen. */
      micros: 128_400_000, currency: 'USD',
      window: { days: 7, dayOfPeriod: 12, daysInPeriod: 31 },
      comparison: { changeBasisPoints: -420, label: 'the same days last month' },
      basis: 'spend',
      asOf: hoursAgo(20),
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
    /* One real omission, so `omissionsCard()`'s own strings are inside the
       sweep rather than beside it. */
    omissions: [
      { key: 'budget', title: 'No budget bar', detail: 'Nothing here records a cloud budget.' },
    ],
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

/* --------------------------------------------------- the version NAME

   Sites four and five, found by the independent review of PR #124 rather
   than by the sweep that reported three. `releaseTile()` filters platforms
   with `textOf(platform.versionName)` at :1311 and drew the RAW field at
   :1330 -- one line below the `versionCode` half the same sweep did fix. */

test('a version name padded with spaces prints without its padding', async () => {
  const named = versionTexts(await boot(summaryFixture()));
  assert.equal(named.filter((t) => t.includes('2.4.1 (2410)')).length, 1,
    'no version row reads "2.4.1 (2410)" on the healthy render, so the padding assertion '
    + 'below is reading the wrong element');

  const padded = summaryFixture();
  padded.release.platforms[0].versionName = '  2.4.1  ';
  const texts = versionTexts(await boot(padded));

  assert.equal(texts.length, named.length,
    'the padded version name changed how many version rows are drawn');
  assert.ok(texts.some((t) => t === '2.4.1 (2410)'),
    `the padded version name drew as ${JSON.stringify(texts)} rather than "2.4.1 (2410)"`);
  for (const text of texts) {
    assert.doesNotMatch(text, /^\s|\s\s/,
      `"${text}" carries the field's own padding, so the predicate trimmed and the render `
      + 'did not');
  }
});

test('a platform with no usable name of its own is still named', async () => {
  const named = versionTexts(await boot(summaryFixture()));
  assert.equal(named.length, 2, 'the healthy render does not draw two platform rows');

  const blank = summaryFixture();
  blank.release.platforms[0].label = '   ';
  blank.release.platforms[0].platform = '   ';
  const dom = await boot(blank);

  assert.equal(versionTexts(dom).length, 2,
    'the nameless platform took its own row down rather than being named');
  const plats = textsWithClass(dom, 'kpi-plat');
  for (const text of plats) {
    assert.notEqual(text.trim(), '',
      'a platform row reached the screen with no name in it at all, which reads as a row '
      + 'that is not there');
  }
  assert.ok(plats.some((t) => t === 'Unnamed platform'),
    `the nameless platform drew as ${JSON.stringify(plats)} rather than "Unnamed platform"`);
});

/* ------------------------------------------- omissionsCard()'s entry key */

const omitTitles = (dom) => textsWithClass(dom, 'omit-title');

function withOmission(entry) {
  const fixture = summaryFixture();
  fixture.omissions = [entry];
  return fixture;
}

test('an omission named only by a padded key prints the key without its padding',
  async () => {
    const named = omitTitles(await boot(withOmission({ key: 'spend_budget' })));
    assert.deepEqual(named, ['spend_budget'],
      'the healthy render does not draw the key as the omission title, so the padding '
      + 'assertion below is reading the wrong element');

    const padded = withOmission({ title: '  ', key: '  spend_budget  ' });
    const texts = omitTitles(await boot(padded));

    assert.deepEqual(texts, ['spend_budget'],
      `the padded key drew as ${JSON.stringify(texts)} -- omissionsCard() decided with `
      + 'textOf(entry.key) at :1623 and rendered the raw field at :1640');
  });

test('an omission with nothing usable to name it is not drawn at all', async () => {
  assert.deepEqual(omitTitles(await boot(withOmission({ key: 'spend_budget' }))),
    ['spend_budget'], 'the finder does not see an omission that IS drawn');

  const blank = withOmission({ title: '   ', key: '   ' });
  assert.deepEqual(omitTitles(await boot(blank)), [],
    'an omission with no words in either field drew a heading holding nothing');
});

/* ===================================================================== */
/* A resolved label that resolves to NOTHING                             */
/* ===================================================================== */

/* The chart's spoken name, which is where a `null` would be heard. */
function chartNames(dom) {
  return findAll(livePanel(dom), (n) => n.getAttribute && n.getAttribute('aria-label'))
    .map((n) => n.getAttribute('aria-label'))
    .filter((s) => /People active each day/.test(s));
}

/* The two day labels under the chart, with their whitespace untouched. */
const axisTexts = (dom) =>
  findAll(livePanel(dom), (n) => hasClass(n, 'axis-x')).map(rawText);

test('a day label that resolves to nothing is left out, not said as the word "null"',
  async () => {
    /* Round 3 of PR #124's review. `labelAt()` resolves a day label through
       `textOf()`, which is the point -- but three of its callers guard the
       null it returns and `chartName()` CONCATENATED it, so the fix for a
       blank label replaced the blank with the four characters `null`.

       Only the concatenation. The x axis hands the same null to `S.h`,
       which assigns it to `textContent` with no `String()`, and the DOM
       setter maps null to the empty string -- so the axis prints nothing
       and needs the different assertion further down. (`aria.js`'s own
       `h()` DOES coerce, and would have printed the word; this pane does
       not use it. Reading the wrong `h` is how the first draft of this
       test came to assert something that could not fail.)

       The concatenation is worse than the defect it replaced: a blank
       prints nothing, and `null` prints a word the answer never sent, into
       a `role="img"` label that is the only thing a screen-reader user
       gets from this chart. */
    const good = await boot(chartedFixture());
    const saidWell = chartNames(good);
    assert.equal(saidWell.length, 1,
      'the finder does not see a chart name on a render that HAS one, so every '
      + 'assertion below would pass over nothing');
    assert.match(saidWell[0], /14 Sep to 20 Sep/,
      `the baseline chart name is "${saidWell[0]}" -- it does not name its own days, so `
      + 'this test is not reading the sentence it means to');
    assert.equal(axisTexts(good).length, 1, 'the axis finder sees no axis on a drawn chart');
    assert.match(axisTexts(good)[0], /14 Sep/, 'the axis does not carry the fixture label');

    for (const [label, what] of [['   ', 'spaces'], ['', 'empty'], [20260914, 'a number']]) {
      const fixture = chartedFixture();
      fixture.activity.labels[0] = label;
      const dom = await boot(fixture);

      const said = chartNames(dom);
      assert.equal(said.length, 1, `the chart stopped being drawn at all on ${what}`);
      assert.doesNotMatch(said[0], /null/,
        `a label of ${what} made the chart say "${said[0]}" -- textOf() returned null and `
        + 'it was concatenated into the accessible name');
      assert.doesNotMatch(said[0], /, +to 20 Sep/,
        `a label of ${what} left a dangling range in "${said[0]}"`);

      /* The axis is a different mechanism and needs a different assertion.
         `S.h` is `if (opts.text !== undefined) el.textContent = opts.text`,
         with no `String()`, and the DOM setter maps null to the empty
         string -- so the axis cannot print "null" the way a concatenation
         can, and asserting that it does not would assert nothing.

         What it CAN do, and did before this PR, is print the label's own
         padding. So the axis is pinned to exactly what should be left:
         the end that resolved, and nothing standing in for the one that
         did not. */
      assert.deepEqual(axisTexts(dom), ['20 Sep'],
        `a label of ${what} drew the axis as ${JSON.stringify(axisTexts(dom))}`);
    }
  });

test('a day range is named only when both of its ends resolve', async () => {
  /* Half a range is worse than none: "over the last 7 whole UTC days, 14 Sep"
     reads as a one-day window. The window is already stated, so a pair that
     cannot be completed says neither end. */
  const fixture = chartedFixture();
  fixture.activity.labels[6] = '   ';
  const said = chartNames(await boot(fixture));
  assert.equal(said.length, 1, 'the chart stopped being drawn');
  assert.doesNotMatch(said[0], /14 Sep/,
    `only the near end resolved and the chart still said it: "${said[0]}"`);
  assert.match(said[0], /over the last 7 whole UTC days\./,
    `the window sentence did not close cleanly: "${said[0]}"`);

  /* And the series sentence's own use of the same label drops its clause
     rather than carrying the null into it. */
  assert.doesNotMatch(said[0], /on null|ending [\d,]+ on\b/,
    `the series sentence carried an unresolved day: "${said[0]}"`);
});

/* ===================================================================== */
/* The sweep itself, rather than a list claiming one happened             */
/* ===================================================================== */

/* Round 1 of PR #124's review found two predicate/value splits this file had
   declared absent. Round 2 found that the REPLACEMENT -- an enumeration of
   the other eleven call sites by name and line -- was itself wrong in most of
   its line numbers and in two of its classifications.

   Twice is a pattern, and the pattern is that a census written by hand into a
   comment is a claim nothing executes. It drifts on the next edit, and it
   drifted inside the very commit that was fixing the previous drift.

   So the census is gone, and this is what replaced it: the invariant the
   census existed to assert, checked against the render instead of against a
   reading of the source. PADDING A FIELD MUST CHANGE NOTHING ON SCREEN.

   What it binds, stated exactly, because round 3 of the review found the
   first wording of this paragraph claiming more than it does:

     - Every call site THE FIXTURE'S OWN STRINGS REACH. It walks
       `stringPaths(fixture)`, not the source, so a field the fixture does
       not carry is not swept, and a branch the fixture does not enter is
       not swept either. The `exercised` list and the baseline gate below
       are what keep that honest: the gate names a value from release,
       people, cost, omissions, consent and activity, plus the chart's own
       accessible name on the fixture that draws one, and fails if any of
       them is missing from the render.

     - Sites added after this was written, on fields the fixture carries.

   It cannot go stale against a line number, because it does not know any.

   NOT SWEPT, and named rather than left to be discovered:

     - The queue. `problemsFixture()` is `{ problems: [] }`, so nothing in
       `queueItem()` is reached -- `problem.summary`, `problem.title`,
       `problem.workPaneLabel`, `problem.reference`,
       `problem.acknowledgedByEmail`, `severityWords()` and `PANE_FILE`.
       The severity half is covered by
       `scripts/ops-alerts-severity-retry.test.mjs`; the rest is not.
       Sweeping it would need four more lookup exceptions -- `severity`,
       `status`, `workPane` and the tone key -- and an exception list that
       large stops meaning anything.

     - Any field `/api/ops/summary` can send that neither fixture carries.
       `stringPaths()` reports 34 paths for `summaryFixture()` and 47 for
       `chartedFixture()`, of which 27 and 39 are swept and the rest are
       lookups; the route's full shape is larger than either.

     - Anything the pane puts somewhere `saidBy()` does not read. It reads
       text nodes and `aria-label`, and nothing else -- not `title`, `alt`,
       `aria-description`, `placeholder` or `data-*`. `pane-overview.js`
       puts `one.key || one.label` into `data-series`, unresolved, and this
       sweep cannot see it. Nothing renders `data-series` to a user today. */

/* The same fixture with a drawn chart, so `chartCard()`'s legend and
   `seriesSentence()` are on screen. `summaryFixture()` deliberately carries
   no days -- it needs `activityCard()`'s no-line branch to reach
   `appendNote()` -- and two sites live only on the other side of that
   branch. Battery rows M30 and M31 came back GREEN against a charted-less
   sweep, which is not a blind test and not a null payload but the third
   thing: the experiment never reached the code. */
function chartedFixture() {
  const fixture = summaryFixture();
  fixture.activity = {
    availability: { state: 'ready' },
    labels: ['14 Sep', '15 Sep', '16 Sep', '17 Sep', '18 Sep', '19 Sep', '20 Sep'],
    series: [
      { key: 'aria', label: 'Aria', color: 's1', values: [910, 940, 1001, 980, 1040, 1077, 1102] },
      { key: 'ariaxii', label: 'Aria XII', color: 's2', values: [380, 402, 396, 410, 421, 404, 412] },
    ],
    daysMissingRollups: [],
    window: { days: 7 },
    note: 'Backfilled on 3 Sep.',
  };
  return fixture;
}

/* What the pane SAYS, which is more than what it draws.

   `rawText` reads text nodes. The chart's name is an `aria-label`, so a
   screen-reader user is the only person who hears it -- and two of the
   sites this sweep exists to bind live only there. Battery rows M31 and M35
   came back GREEN against a text-only sweep for that reason: not a blind
   test and not a null payload, but a probe that could not reach the thing it
   was aimed at. A sweep for "does a padded field reach a user" that ignores
   the accessible name answers the question for sighted users only. */
function saidBy(panel) {
  const spoken = findAll(panel, (n) => n.getAttribute && n.getAttribute('aria-label'))
    .map((n) => n.getAttribute('aria-label'));
  return rawText(panel) + '\u0000' + spoken.join('\u0000');
}

/* Every string leaf in the fixture, as a path. */
function stringPaths(node, prefix = []) {
  if (typeof node === 'string') return [prefix];
  if (Array.isArray(node)) {
    return node.flatMap((v, i) => stringPaths(v, prefix.concat(String(i))));
  }
  if (node && typeof node === 'object') {
    return Object.keys(node).flatMap((k) => stringPaths(node[k], prefix.concat(k)));
  }
  return [];
}

const getPath = (obj, path) => path.reduce((o, k) => o[k], obj);
const setPath = (obj, path, value) => {
  const last = path[path.length - 1];
  path.slice(0, -1).reduce((o, k) => o[k], obj)[last] = value;
};
const withPath = (obj, path, value) => { setPath(obj, path, value); return obj; };

/* Not a date, not an ISO 4217 code, not an availability state, and holding
   no whitespace for a render to normalise away. */
const SENTINEL = 'Zq7Sentinel';

/* Fields whose value is not a word the pane prints but a key it looks
   something up by, so padding them legitimately changes the render. Named
   one at a time and justified, because "the sweep has exceptions" is how a
   sweep stops meaning anything.

   Each of these is verified below to be a LOOKUP, two ways: padding it
   changes the render, so the exception is not stale; and SUBSTITUTING an
   unrecognisable value for it leaves nothing of that value on the screen,
   so the field is looked up rather than printed. The substitution is the
   one that matters -- review round 4 walked past two different string tests
   over the padded render, and a padded value can be reformatted into
   anything while a substituted one cannot hide. */
const LOOKUP_FIELDS = new Set([
  /* Parsed as a date, not printed as a word. */
  'generatedAt',
  'cost.asOf',
  /* Enum keys the route sends, matched exactly against a state table. A
     padded one SHOULD fall to "unavailable" -- that is the pane refusing to
     read a state it does not recognise, which is the behaviour the honesty
     rules ask for, not a rendering defect. */
  'people.availability.state',
  'aiRuns.availability.state',
  'release.availability.state',
  'cost.availability.state',
  /* An ISO 4217 code handed to Intl.NumberFormat, which throws on a padded
     one and drops the tile to an unsymbolled number. A currency code is not
     a word this pane prints. */
  'cost.currency',
]);

async function sweep(make, extraLookups, expectSwept, extraReached = []) {
  const base = make();
  const paths = stringPaths(base);
  assert.ok(paths.length >= 15,
    `the walker found ${paths.length} string fields in the fixture, which is too few to `
    + 'be reading it properly');

  const clean = saidBy(livePanel(await boot(make())));
  /* Each of these is a value from a DIFFERENT region of the fixture, so a
     region that silently stopped rendering cannot sit inside the sweep
     looking covered. The cost tile did exactly that: `costTile()` reads
     `cost.micros` and the fixture carried `total.usd`, so every render took
     the unavailable branch and `clean.includes('128')` was false while the
     two values checked here were both true. A sweep that cannot say which
     parts of the screen it reached is not a sweep.

     Round 5 of the review then read the list against the claim above it.
     It said "a value from each region" and named release, people, cost and
     omissions -- nothing from `consent`, and nothing from `activity`, which
     supplies fourteen of the charted sweep's thirty-nine paths and is the
     entire reason `chartedFixture()` exists. The chart region was in fact
     being drawn, so this was an overclaiming sentence rather than a blind
     spot; it is now a true one, with the chart's own accessible name gated
     by the caller because only one of the two fixtures draws a chart. */
  for (const reached of ['2.4.1', 'production', '128.40', 'No budget bar',
    'Operational data only.', 'Backfilled on 3 Sep.', ...extraReached]) {
    assert.ok(clean.includes(reached),
      `the baseline render does not carry "${reached}", so the region of the fixture `
      + 'that value comes from was never drawn and every comparison below passes over '
      + 'nothing');
  }

  const drifted = [];
  const exercised = [];
  for (const path of paths) {
    const key = path.join('.');
    const fixture = make();
    setPath(fixture, path, '  ' + getPath(base, path) + '  ');
    const padded = saidBy(livePanel(await boot(fixture)));
    if (LOOKUP_FIELDS.has(key) || extraLookups.has(key)) {
      /* The exception list is checked in BOTH directions: a field on it that
         has stopped mattering is a stale exception hiding a real site. */
      assert.notEqual(padded, clean,
        `"${key}" is on the lookup-exception list but padding it changes nothing, so the `
        + 'exception is stale and is hiding whatever it now covers');
      /* And it differs the RIGHT way. "This is a lookup, so a padded value
         legitimately changes the render" was asserted by nobody until round
         3 of the review pointed out that a listed field which started
         carrying its padding onto the screen would satisfy the line above
         and be hidden by the exception that excuses it.

         Round 4 then broke the obvious check. Rejecting a verbatim echo of
         the padding walks past a payload that prints the padded value with
         its whitespace COLLAPSED -- `128.40 ( USD )` -- and so does counting
         occurrences of the value, because that payload prints the currency
         in BOTH renders and the count does not move. Both passed 64/64.

         So this is a different experiment rather than a better string test.
         A padded value can be reformatted into anything; a SUBSTITUTED one
         cannot hide. Replace the field with a sentinel that is not a date,
         not a currency code and not a state name, and ask whether it reaches
         the screen. A field that is looked up cannot print a key it does not
         recognise. A field that is printed prints the sentinel, in whatever
         spelling -- there is no whitespace in it to normalise away. */
      const swapped = saidBy(livePanel(await boot(withPath(make(), path, SENTINEL))));
      assert.ok(!swapped.includes(SENTINEL),
        `"${key}" is excused as a lookup, but substituting an unrecognisable value put `
        + 'it on the screen -- the field is being printed, not looked up, and the '
        + 'exception is hiding a real call site');
      continue;
    }
    exercised.push(key);
    /* Reported with the first character that differs and forty either side.
       "these fields drifted" sends the next person hunting; "here is where"
       does not, and seven of the eleven sites this sweep found were located
       from this line rather than from the source. */
    if (padded !== clean) {
      let at = 0;
      while (at < clean.length && padded[at] === clean[at]) at += 1;
      drifted.push(`${key} (${JSON.stringify(clean.slice(Math.max(0, at - 40), at + 40))}`
        + ` => ${JSON.stringify(padded.slice(Math.max(0, at - 40), at + 40))})`);
    }
  }

  /* Pinned exactly, not floored. A floor cannot tell "the fixture lost a
     field" from "the fixture never had it", and the whole reason this sweep
     had to be narrowed is that nobody could say what it reached. Change the
     fixture, change this number, and the diff says which happened. */
  assert.equal(exercised.length, expectSwept,
    `${exercised.length} fields were swept, not ${expectSwept}: ${JSON.stringify(exercised)}`);
  assert.deepEqual(drifted, [],
    `padding these fields changed the rendered text: ${JSON.stringify(drifted)} -- each `
    + 'is a textOf() call site that decides with the resolved value and draws the raw '
    + 'one, or one that never resolved at all');
}

test('padding any string the answer carries changes nothing on the screen', async () => {
  await sweep(summaryFixture, new Set(), 27);
});

test('padding any string changes nothing on the screen with the chart drawn too',
  async () => {
    /* The same invariant over the branch the other sweep cannot reach.
       `summaryFixture()` carries no days on purpose -- it needs
       `activityCard()`'s no-line branch to get to `appendNote()` -- and the
       legend and the spoken sentence live on the other side of it. */
    await sweep(chartedFixture, new Set([
      'activity.availability.state',
    ]), 39, ['14 Sep to 20 Sep', 'Aria XII']);
  });
