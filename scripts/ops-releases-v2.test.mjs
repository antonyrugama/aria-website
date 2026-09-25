/* Unit tests for ops/assets/pane-releases.js — App releases on the v2 design
   system.

   The pane's one claim is the thing worth testing here: a version sitting at
   20% of Android sessions BECAUSE THE PLAY ROLLOUT IS STAGED is a different
   fact from a version stalled at 20% because nobody is updating, and the pane
   has to say which. That reading is derived in one place and then spent in
   four — the stage figure, the end pill, the hero line and the share sentence
   — so every one of those is asserted against a payload that only a reading
   of the right kind produces.

   Everything else under test is a rule about NOT drawing something, which is
   what neither a screenshot nor a headless-Chrome overflow check can see:

     - the empty state is a claim about the stores, not about the builds, so it
       is derived from the source statuses and can never say "both sources
       answered" over a store that was never connected;
     - a rollout the store does not report is an absence, never 0%;
     - a crash-free figure with no floor behind it carries no verdict colour,
       because green is the outcome of a comparison that did not happen;
     - degraded means a read that failed, not a source nobody configured;
     - a failing poller ages the rows it fed and only those rows.

   Plus the one that is easy to re-break by accident: the version-share bar is
   role="img", which is children-presentational, so its accessible NAME has to
   carry the reading. Nothing inside it is announced to anybody.

   Every test here has a published mutation — the exact file, the exact
   original line, and the payload that makes that one test fail. 49 tests, 53
   rows: 43 in PR antonyrugama/aria-website#55, 2 for the 44th ("a pipeline
   row states the build number once") in the follow-up that added it, one
   mutation in each direction because the invariant is a count and a count has
   two ways to be wrong, and 8 in the omissions change, which added 5 tests
   here and moved the wording one existing test reads. Rows exceed tests
   whenever a test has more than one way to fail; they are not the same number
   and the breakdown is the check on both.

   The omissions rows were EMITTED BY the battery that ran them rather than
   written up afterwards, so a row cannot name a line nobody mutated. That
   harness caught two things a hand-written table would have published: an
   anchor that named the rule above the one the payload landed in, and a
   mutation — disabling the share sentence's bare unreadable branch — that
   left this file green, because every fixture in it kept Android staged and
   so only ever reached that clause by appending it to a measured ceiling.
   The 49th test exists because of that row.

   That claim is checked by counting `test(` names against row names rather
   than by eye: the first round of #55's review found the claim was 38 of 39,
   because one test had been added without a row, and round 3 found the number
   itself had gone stale at 41 while the file declared 43. **The count in the
   sentence above is part of the claim.** If you add a test here, neither the
   number nor the "every" stretches to cover it. Prove it and say so, or
   narrow this paragraph.

   Both directions are published for every invariant that has two — "stays
   masked" and "does show once it should" are two tests, not one.

   NOT COVERED by any published mutation, and stated rather than implied:

     - anything about layout, width or overflow. Nothing here measures
       anything; scripts/check-ops-narrow-overflow.mjs measures, and since
       Stadiora/Aria#10492 it does lay this page out — at 375px and 360px, in
       both themes, against a stub of the release shapes below. What it reads
       is the width of the document, so an overflow of the page is caught and
       nothing finer is. The 320px readings for this pane are in the pull
       request as hand-run numbers, not as a guard.
     - whether a CSS rule RENDERS. Node has no layout engine. The rule that
       drops the duplicate share from a key whose bucket already carries a
       chip is half markup and half stylesheet, and the test below proves only
       that the two halves still name the same classes. What it looks like on
       screen was checked in a browser by hand and published.
     - the contrast of the version-share label chip. The ratio is a property of
       ops/assets/aria.css's tokens, which this change may not edit, so the
       test below pins the chip's SHAPE — a <b> inside the segment — and says
       nothing about its colour. */
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
const PANE_SRC = read('assets/pane-releases.js');

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

const DAY = 86_400_000;
/* The clock these tests run against, frozen below inside the sandbox.
   Every relative reading on this pane — "6 days unchanged", "read 2 days ago",
   "a minute ago" — is computed from Date.now(), so a fixture written against
   a fixed instant and run against a moving one is a test that passes today
   and fails on a date nobody chose. */
const NOW = Date.UTC(2026, 8, 20, 6, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();

/* A whole, healthy answer: both stores read, iOS fully rolled out, Android
   parked by the Play Console at 20% and not moving. Every test below starts
   here and changes one thing, because almost every rule under test is a rule
   about a payload that is missing something. */
function releasesFixture(over) {
  const base = {
    generatedAt: ago(90_000),
    platforms: [
      {
        platform: 'ios',
        label: 'iOS',
        appIdentifier: 'com.example.invalid',
        sourceKey: 'app_store_connect',
        tracks: [
          { track: 'internal', versionName: '1.1.3', versionCode: '4412', state: 'processing', testerCount: 12, fetchedAt: ago(90_000) },
          { track: 'external', versionName: '1.1.3', versionCode: '4412', state: 'in_review', testerCount: 240, fetchedAt: ago(90_000) },
          { track: 'production', versionName: '1.1.2', versionCode: '4398', state: 'live', rolloutBasisPoints: 10_000, rolloutObservedSince: ago(9 * DAY), releasedAt: ago(9 * DAY), fetchedAt: ago(90_000) },
        ],
        unknownTracks: [],
      },
      {
        platform: 'android',
        label: 'Android',
        appIdentifier: 'com.example.invalid',
        sourceKey: 'google_play',
        tracks: [
          { track: 'internal', versionName: '1.1.3', versionCode: '4412', state: 'live', testerCount: 9, fetchedAt: ago(90_000) },
          { track: 'beta', versionName: '1.1.3', versionCode: '4412', state: 'live', testerCount: 1180, fetchedAt: ago(90_000) },
          { track: 'production', versionName: '1.1.2', versionCode: '4398', state: 'rolling_out', rolloutBasisPoints: 2000, rolloutObservedSince: ago(6 * DAY), releasedAt: ago(9 * DAY), fetchedAt: ago(90_000) },
        ],
        unknownTracks: [],
      },
    ],
    sources: [
      { key: 'app_store_connect', label: 'App Store Connect', status: 'ok', lastSuccessAt: ago(90_000), lastAttemptAt: ago(90_000), pollSeconds: 900, mode: 'poll' },
      { key: 'google_play', label: 'Google Play', status: 'ok', lastSuccessAt: ago(150_000), lastAttemptAt: ago(150_000), pollSeconds: 900, mode: 'poll' },
    ],
    production: { versionName: '1.1.2', builds: [{ platform: 'ios', versionCode: '4398' }, { platform: 'android', versionCode: '4398' }] },
    adoption: {
      latestVersion: '1.1.2',
      sampleSessions: 18_422,
      buckets: [
        { key: 'latest', label: '1.1.2', basisPoints: 6120 },
        { key: 'previous', label: '1.1.1', basisPoints: 2740 },
        { key: 'older', label: 'Older', basisPoints: 1140 },
      ],
    },
    crashFree: { basisPoints: 9962, floorBasisPoints: 9950, windowHours: 24 },
    health: {
      platform: 'android',
      current: '1.1.2',
      previous: '1.1.1',
      signals: [
        { key: 'crash_rate', label: 'Crash rate', unit: 'rate_bp', previous: 52, current: 38, verdict: 'better' },
        { key: 'cold_start', label: 'Cold start', unit: 'millis', previous: 1840, current: 2130, verdict: 'slightly_worse' },
        { key: 'anr', label: 'App not responding', unit: 'per_1k', previous: 1.4, current: 1.4, verdict: 'no_change' },
      ],
    },
  };
  if (!over) return base;
  /* An override that mutates in place and returns nothing must not read back
     as "no override" — that would quietly serve the untouched fixture and a
     test written to take a field away would pass against a payload that still
     had it. */
  const out = over(base);
  return out === undefined ? base : out;
}

/* The production track of one platform, for the overrides below. */
function production(data, platform) {
  return data.platforms
    .find((p) => p.platform === platform)
    .tracks.find((t) => t.track === 'production');
}

function source(data, key) {
  return data.sources.find((s) => s.key === key);
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'releases');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/releases.html loads it: registry, aria.js, the
   bootstrap, then the pane module. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const answer = opts.releases === undefined ? releasesFixture() : opts.releases;

  const dom = makeDom({ tokens: TOKENS, href: 'https://ops.example.invalid/ops/releases.html' });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role: 'owner' } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({ endpoint, query: o && o.query });
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => 'owner',
    hasRole: () => true,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  /* Frozen, so the relative readings are the same in a year as they are today.
     Set on the sandbox itself rather than through a script, so every module
     below resolves the global Date to this one. */
  dom.window.Date = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(NOW);
      else super(...args);
    }

    static now() { return NOW; }
  };
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });

  /* The state the pane ASKED for, which the DOM cannot be asked about: `live`
     and `degraded` are two states of one panel, so both leave the same
     attribute behind and a test that read the markup could never tell a
     healthy pane from a half-read one. The bootstrap holds the Aria object
     rather than the function, so patching it here is seen by the shell. */
  const states = [];
  const applyState = dom.window.Aria.applyState;
  dom.window.Aria.applyState = function (s) {
    states.push(String(s));
    return applyState.call(dom.window.Aria, s);
  };

  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-releases.js' });

  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { ...dom, body, calls, states, content: dom.doc.getElementById('content') };
}

/* One panel, by the state it belongs to. Reading the whole region would read
   text the operator cannot see: the loading, empty and live panels are
   siblings and aria.css hides the ones that are not current. */
function panel(dom, state) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').includes(state))[0];
}

function shownState(dom) {
  const applied = dom.states[dom.states.length - 1];
  const on = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => n.hasAttribute('data-shown'));
  assert.equal(on.length, 1, 'exactly one panel is shown');
  assert.ok((on[0].getAttribute('data-state') || '').split(' ').includes(applied),
    `the shown panel belongs to ${applied}`);
  return applied;
}

const liveText = (dom) => allText(panel(dom, 'live'));
const emptyText = (dom) => allText(panel(dom, 'empty'));

/* One platform's row on the ladder. Whole-pane text is the wrong instrument
   for a rule about one row: the other platform's row carries the same words
   and an assertion over both passes without the right one being right. */
function pipeRow(dom, platform) {
  const rows = findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('pipe-row'));
  return rows.find((row) => {
    const who = findAll(row, (n) => (n.className || '').split(/\s+/).includes('t-main'))[0];
    return who && allText(who).trim() === platform;
  });
}

const rowText = (dom, platform) => allText(pipeRow(dom, platform));

function heroText(dom) {
  const hero = findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('hero'))[0];
  return hero ? allText(hero) : '';
}

/* The version-share bar: the only element on this pane that is a picture of
   data rather than an icon. An icon carries aria-hidden and no role. */
function shareBar(dom) {
  return findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('stackbar'))[0];
}

function shareSegments(dom) {
  const bar = shareBar(dom);
  return bar ? bar.childNodes.filter((n) => n.tagName === 'I') : [];
}

/* The key beneath the bar: one span per bucket, each a swatch, a name and a
   share. Reached through the bar so a second .legend elsewhere on the pane
   could never be mistaken for this one. */
function shareKeys(dom) {
  const stack = shareBar(dom) && shareBar(dom).parentNode;
  if (!stack) return [];
  const legend = stack.childNodes.filter(
    (n) => (n.className || '').split(/\s+/).includes('legend'))[0];
  return legend ? legend.childNodes.filter((n) => n.tagName === 'SPAN') : [];
}

function keyPct(key) {
  const el = key.childNodes.filter(
    (n) => (n.className || '').split(/\s+/).includes('share-key-pct'))[0];
  return el ? allText(el).trim() : null;
}

function shareCardText(dom) {
  const stack = findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('share-stack'))[0];
  return stack ? allText(stack) : '';
}

/* The version-share card, reached through its own title rather than by asking
   for the first node whose text starts with "Version share" — which is the
   grid that holds it, and carries the store card's text too. */
function shareCardEl(dom) {
  const title = findAll(panel(dom, 'live'),
    (n) => n.tagName === 'H3' && allText(n) === 'Version share')[0];
  return title.closest('.card');
}

function crashFreeValue(dom) {
  return findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('figure-val'))[0];
}

function healthRegion(dom) {
  return findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('tbl-scroll'))[0];
}

/* Every numeral on a fragment, so a rule about never printing one can be
   checked without guessing which element it would have landed in. */
const numerals = (text) => (text.match(/\d/g) || []).length;

/* Any age mark on a ladder row at all, whatever the age. Matching only the
   age the failing store happens to have would pass over a mark applied to
   every row: the healthy store's own last read is ninety seconds old, so it
   reads "a minute" and not "2 days". */
const AGE_MARK = /Read (a|an|\d+) (second|minute|hour|day)|Never read/;

/* ===================== the reading this pane exists for ================== */

test('a rollout parked at a share of the field says the store set it, and says separately that it is not moving', async () => {
  const dom = await boot({});
  const row = rowText(dom, 'Android');

  /* Both halves of the fact, in the two slots that carry them: the stage
     figure has the number and how long it has held, the end pill has the
     reading. "Stalled" on its own is the wrong reading — it is what this pane
     exists to tell APART from a store-set ceiling. */
  assert.match(row, /20% of devices/);
  assert.match(row, /6 days unchanged/);
  assert.match(row, /Staged, not moving/);
  assert.doesNotMatch(row, /\bStalled\b/);
});

test('the same 20%, read one day in, is staged and is not called stalled', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      production(data, 'android').rolloutObservedSince = ago(1 * DAY);
    }),
  });
  const row = rowText(dom, 'Android');

  assert.match(row, /20% of devices/);
  assert.match(row, /1 day unchanged/);
  assert.match(row, /Staged by the store/);
  assert.doesNotMatch(row, /not moving/);
});

test('a rollout at the whole field is rolled out, and the share sentence says the share is take-up', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const track = production(data, 'android');
      track.rolloutBasisPoints = 10_000;
      track.state = 'live';
    }),
  });

  assert.match(rowText(dom, 'Android'), /100% of devices/);
  assert.match(rowText(dom, 'Android'), /Rolled out/);
  assert.match(shareCardText(dom), /no store is capping the rollout, so this share is take-up/);
  assert.doesNotMatch(shareCardText(dom), /ceiling/);
});

test('a store that reports no rollout share says so, and never prints it as zero', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const track = production(data, 'android');
      delete track.rolloutBasisPoints;
      delete track.rolloutObservedSince;
      track.state = 'live';
    }),
  });
  const row = rowText(dom, 'Android');

  assert.match(row, /No staged rollout/);
  assert.doesNotMatch(row, /0% of devices/);
  assert.doesNotMatch(row, /Staged/);
});

test('the share sentence names the ceiling on the platform that has one, not on the bar', async () => {
  const dom = await boot({});

  /* The bar is every platform at once, and one store capping its own devices
     does not cap the whole field. The sentence has to name Android. */
  assert.match(shareCardText(dom),
    /Android at 20%: a ceiling the store set, so that part of the share is not take-up\./);
  assert.doesNotMatch(shareCardText(dom), /iOS at/);
});

/* The editorial rule this whole remodel is for, in the one place it had no
   guard: one fact, one slot. A count is the right instrument and a `match` is
   not — "the build number is on the row" is true whether it is there once or
   twice, which is how it came to be there twice.

   The expectation is the fixture's own build number, read out of the payload
   rather than off the rendered row, so the assertion cannot move with the code
   it is checking. It is asserted per row, because both platforms carry the
   same build and a count over the whole pane would read 2 when each row is
   right and 2 when one row is wrong. */
test('a pipeline row states the build number once, not once in the subtitle and again on a stage', async () => {
  const fixture = releasesFixture();
  const build = fixture.platforms
    .find((p) => p.platform === 'android').tracks
    .find((t) => t.track === 'production').versionCode;
  const dom = await boot({ releases: fixture });

  const occurrences = (text) => text.split(new RegExp('\\b' + build + '\\b')).length - 1;

  assert.strictEqual(occurrences(rowText(dom, 'Android')), 1,
    'the Android row should carry build ' + build + ' exactly once');
  assert.strictEqual(occurrences(rowText(dom, 'iOS')), 1,
    'the iOS row should carry build ' + build + ' exactly once');

  /* And it is the subtitle that carries it, not some other slot that happens
     to hold one copy. Without this the test passes if the subtitle drops the
     build and a stage figure picks it up. */
  assert.match(rowText(dom, 'Android'), /1\.1\.2 · build 4398/);
});

/* ============================== the hero ================================= */

test('the hero refuses "live on both stores" while one store is still holding the build back', async () => {
  const dom = await boot({});

  assert.match(heroText(dom), /1\.1\.2 is the production build/);
  assert.doesNotMatch(heroText(dom), /is live on/);
  /* And the fact it refuses to flatten is still on screen, in the one line
     under the title. */
  assert.match(heroText(dom), /Android held at 20% for 6 days/);
});

test('the approved release-contents band is acknowledged as not answerable yet', async () => {
  const dom = await boot({});
  const text = liveText(dom);

  assert.match(text, /What this pane cannot answer yet/,
    'the cannot-answer band is not on the pane');
  assert.match(text, /What is in 1\.1\.2/,
    'the approved release-contents band is still silent');
  assert.match(text, /Nothing records release contents yet\./,
    'the release-contents cause is missing or too vague');
});

test('the hero does say live on both stores once both stores have finished', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const track = production(data, 'android');
      track.rolloutBasisPoints = 10_000;
      track.state = 'live';
    }),
  });

  assert.match(heroText(dom), /1\.1\.2 is live on the App Store and the Play Store/);
  assert.doesNotMatch(heroText(dom), /held at/);
});

test('the hero line carries only figures the answer actually reported', async () => {
  const whole = await boot({});
  assert.match(heroText(whole), /61% of sessions/);
  assert.match(heroText(whole), /crash free 99\.6%/);

  const thin = await boot({
    releases: releasesFixture((data) => {
      delete data.crashFree;
      delete data.adoption;
    }),
  });
  assert.doesNotMatch(heroText(thin), /of sessions/);
  assert.doesNotMatch(heroText(thin), /crash free/);
  /* And the line that is left is still the one fact that was reported, not a
     padded sentence about the ones that were not. */
  assert.match(heroText(thin), /Android held at 20% for 6 days/);
});

/* ======================= empty is never zero ============================= */

test('two stores that both answered and are both empty say exactly that', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      data.platforms.forEach((p) => { p.tracks = []; p.unknownTracks = []; });
    }),
  });

  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /No builds in flight/);
  assert.match(emptyText(dom), /both sources answered, and both are empty/);
});

test('an empty ladder over two stores that could not be read never claims they answered', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      data.platforms.forEach((p) => { p.tracks = []; p.unknownTracks = []; });
      source(data, 'app_store_connect').status = 'unconfigured';
      const play = source(data, 'google_play');
      play.status = 'failed';
      play.failureReason = 'The service account was refused';
      play.lastSuccessAt = ago(3 * DAY);
    }),
  });

  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /Neither store can be read/);
  assert.doesNotMatch(emptyText(dom), /both sources answered/);
  assert.doesNotMatch(emptyText(dom), /No builds in flight/);
  /* The evidence, not just the claim: which store, and how long ago. */
  assert.match(emptyText(dom), /App Store Connect is not connected yet/);
  assert.match(emptyText(dom), /Google Play was last read successfully 3 days ago/);
});

test('one store empty and one unreadable is neither of the other two sentences', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      data.platforms.forEach((p) => { p.tracks = []; p.unknownTracks = []; });
      const play = source(data, 'google_play');
      play.status = 'failed';
      play.failureReason = 'The service account was refused';
      play.lastSuccessAt = ago(2 * DAY);
    }),
  });

  assert.equal(shownState(dom), 'empty');
  assert.match(emptyText(dom), /One store answered, one could not be read/);
  assert.match(emptyText(dom), /App Store Connect answered and reports no build on any track/);
  assert.doesNotMatch(emptyText(dom), /both sources answered/);
});

test('a track the ladder has no rung for is still a build, so the pane is not empty', async () => {
  const withUnknown = await boot({
    releases: releasesFixture((data) => {
      data.platforms.forEach((p) => { p.tracks = []; });
      data.platforms.find((p) => p.platform === 'android').unknownTracks = ['qa-holdback'];
    }),
  });

  assert.notEqual(shownState(withUnknown), 'empty');
  assert.match(liveText(withUnknown), /One track has no rung on this ladder/);
  assert.match(liveText(withUnknown), /Android qa-holdback/);

  /* The other direction: take the unknown track away and the same payload is
     empty. Without this, a hard-coded "never empty" would pass the test
     above. */
  const without = await boot({
    releases: releasesFixture((data) => {
      data.platforms.forEach((p) => { p.tracks = []; p.unknownTracks = []; });
    }),
  });
  assert.equal(shownState(without), 'empty');
});

/* ===================== degraded is a read that failed ==================== */

test('a store that was polled and refused puts the pane in its degraded state', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const play = source(data, 'google_play');
      play.status = 'failed';
      play.failureReason = 'The service account was refused';
      play.lastSuccessAt = ago(2 * DAY);
    }),
  });

  assert.equal(shownState(dom), 'degraded');
});

test('a store nobody has connected is a known absence, not a failed read', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      source(data, 'app_store_connect').status = 'unconfigured';
      data.platforms.find((p) => p.platform === 'ios').tracks = [];
    }),
  });

  /* Still live, not degraded: nothing failed. And the absence is stated in
     words rather than left to be read as an empty row. */
  assert.equal(shownState(dom), 'live');
  assert.match(rowText(dom, 'iOS'), /Not connected/);
  assert.match(rowText(dom, 'iOS'), /Store not connected/);
});

test('a source that is deliberately not polled is also not a failure', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      source(data, 'app_store_connect').status = 'disabled';
      data.platforms.find((p) => p.platform === 'ios').tracks = [];
    }),
  });

  assert.equal(shownState(dom), 'live');
  assert.match(rowText(dom, 'iOS'), /Not polled/);
});

/* ================= a failing poller ages the rows it fed ================= */

test('a failing poller marks the age of the figures on the row it fed, and only that row', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const play = source(data, 'google_play');
      play.status = 'failed';
      play.failureReason = 'The service account was refused';
      play.lastSuccessAt = ago(2 * DAY);
    }),
  });

  /* "6 days unchanged" read two days ago is a claim about last Thursday, and
     the row that carries it has to say so where it is read. */
  assert.match(rowText(dom, 'Android'), /Read 2 days/);
  /* The other store is reading normally and its row must not be aged at all.
     Asserting only that iOS does not carry ANDROID's age would pass over a
     mark applied to every row, because iOS's own last read is ninety seconds
     old and reads "a minute" rather than "2 days". */
  assert.doesNotMatch(rowText(dom, 'iOS'), AGE_MARK);
});

test('a poller that is reading normally ages nothing', async () => {
  const dom = await boot({});

  assert.doesNotMatch(rowText(dom, 'Android'), AGE_MARK);
  assert.doesNotMatch(rowText(dom, 'iOS'), AGE_MARK);
});

test('freshness is stated once per store: relatively when it is reading, absolutely when it is not', async () => {
  const healthy = await boot({});
  /* The pill carries the age; the block below it does not spell the same
     instant out again. */
  assert.match(liveText(healthy), /Read a minute ago|Read \d+ minutes ago/);
  assert.doesNotMatch(liveText(healthy), /Last good read/);

  const failing = await boot({
    releases: releasesFixture((data) => {
      const play = source(data, 'google_play');
      play.status = 'failed';
      play.failureReason = 'The service account was refused';
      play.lastSuccessAt = ago(2 * DAY);
    }),
  });
  /* Failing: the pill says only that, and the stamp below carries when. */
  assert.match(allText(panel(failing, 'live')), /Failing/);
  assert.doesNotMatch(allText(panel(failing, 'live')), /Failing · last read/);
  assert.match(allText(panel(failing, 'live')), /Last good read/);
  assert.match(allText(panel(failing, 'live')), /18 Sep 2026 \d\d:\d\d UTC/);
});

/* ============ the share bar's accessible name carries the data =========== */

test('the version-share bar names every bucket and its share, because nothing inside it is announced', async () => {
  const dom = await boot({});
  const bar = shareBar(dom);

  assert.ok(bar, 'the bar is drawn');
  assert.equal(bar.getAttribute('role'), 'img');

  /* role="img" is children-presentational. The <b> label chips inside the
     segments are announced to nobody, so the name is the whole reading. */
  const name = bar.getAttribute('aria-label');
  assert.match(name, /^Version share: /);
  assert.match(name, /1\.1\.2 61%/);
  assert.match(name, /1\.1\.1 27%/);
  assert.match(name, /Older 11%/);
});

test('a bucket too narrow to hold a chip is still in the bar, the legend and the name', async () => {
  const dom = await boot({});
  const segments = shareSegments(dom);
  assert.equal(segments.length, 3, 'one segment per bucket');

  const chips = segments.map((seg) => seg.childNodes.filter((n) => n.tagName === 'B').length);
  assert.deepEqual(chips, [1, 1, 0], '61% and 27% hold a chip, 11% does not');

  /* The chip is the sanctioned fix for the label's contrast over a washing
     gradient (monorepo #10293): a reading surface of its own, sitting on the
     segment. The segment's own fill is the data and is never re-toned to make
     ink readable on it, so a bucket that cannot hold a chip carries no ink at
     all and reads off the legend instead. */
  assert.equal(allText(segments[0]).trim(), '61%');
  assert.equal(allText(segments[2]).trim(), '');
  assert.match(shareCardText(dom), /Older 11%/);
  assert.match(shareBar(dom).getAttribute('aria-label'), /Older 11%/);
});

/* The chip clips its own tail, and its width is whatever its text needs. An
   earlier build of this pane put the bucket name in the chip as well as the
   share, which made that width unbounded: at a 16/70/14 split with the name
   `1.1.2` the tail the ellipsis ate WAS the percentage, and between 561px
   and 650px of viewport the 16% bucket stated its share nowhere on screen.

   The chip carries the share alone, so the widest string it can ever hold is
   `100%`. That is what turns the threshold below into a claim about pixels
   that can be checked rather than a guess: 42.4px of chip against a bar no
   narrower than 497px anywhere chips are drawn at all.

   This pins the BOUND, not the rendering. Node has no layout; the width
   sweep proving the rule renders is in the PR. */
test('a chip states the share and nothing else, so no bucket name can widen it', async () => {
  const fixture = releasesFixture();
  fixture.adoption.buckets = [
    { key: 'latest', label: '1.1.2', basisPoints: 2100 },
    { key: 'previous', label: '1.1.1', basisPoints: 6500 },
    { key: 'older', label: 'Older', basisPoints: 1400 },
  ];
  const dom = await boot({ releases: fixture });

  const chips = shareSegments(dom).map((seg) => allText(seg).trim());
  assert.deepEqual(chips, ['21%', '65%', ''], 'the chip is the share, exactly');

  /* The shape as well as the value, so nothing longer can creep back in
     under a different separator. */
  chips.filter(Boolean).forEach((text) => {
    assert.match(text, /^\d{1,3}%$/, JSON.stringify(text) + ' is wider than a share');
  });

  /* The other direction: the names did not vanish with the chips, they are
     on the keys, tied to their segments by the same tone. */
  assert.deepEqual(shareKeys(dom).map((k) => allText(k).replace(keyPct(k), '').trim()),
    ['1.1.2', '1.1.1', 'Older']);
});

/* The threshold itself, at the boundary and on both sides of it. Without
   this, moving it is invisible: the everyday fixture's 61/27/11 sits clear
   of any value between 12% and 26%, so the number could drift a long way
   before a test noticed. */
test('a segment holds a chip at 20% of the bar and not one basis point below', async () => {
  const fixture = releasesFixture();
  fixture.adoption.buckets = [
    { key: 'latest', label: '1.1.2', basisPoints: 2000 },
    { key: 'previous', label: '1.1.1', basisPoints: 6001 },
    { key: 'older', label: 'Older', basisPoints: 1999 },
  ];
  const dom = await boot({ releases: fixture });

  assert.deepEqual(shareSegments(dom).map((seg) => allText(seg).trim()),
    ['20%', '60%', ''], '2000bp draws a chip, 1999bp does not');
  assert.deepEqual(
    shareKeys(dom).map((k) => (k.getAttribute('class') || '').split(/\s+/).includes('has-chip')),
    [true, true, false], 'and the keys agree with the bar about which is which');
  assert.deepEqual(shareKeys(dom).map(keyPct), ['20%', '60%', '20%'],
    'every key still holds its own share, marked or not');
});

/* The share is one fact and takes one slot at a given width. The bar and the
   key beneath it are the two candidate slots, and which one holds the number
   is decided per bucket by whether the segment was wide enough for a chip.
   Asserted in both directions: a bucket whose chip carries the share is
   marked so the stylesheet can drop the duplicate, and a bucket with no chip
   is NOT marked, because dropping its number would leave the share of that
   bucket nowhere on screen at all. */
test('a bucket that carries a chip is marked so its key can drop the duplicate share, and a bucket without one is not', async () => {
  const dom = await boot({});
  const keys = shareKeys(dom);
  assert.equal(keys.length, 3, 'one key per bucket');

  /* Stated as literals rather than read back off the segments: an expectation
     derived from the thing under test moves with the mutation. 61% and 27%
     clear the 20% a chip needs, 11% does not. */
  const marked = keys.map((k) => (k.getAttribute('class') || '').split(/\s+/).includes('has-chip'));
  assert.deepEqual(marked, [true, true, false]);

  /* Every key still HOLDS its share, in its own element. The marked ones have
     it hidden by the stylesheet above 560px and shown again below it, where
     no chip is drawn; the unmarked one is never hidden. */
  assert.deepEqual(keys.map(keyPct), ['61%', '27%', '11%']);
  assert.deepEqual(keys.map((k) => allText(k).replace(keyPct(k), '').trim()),
    ['1.1.2', '1.1.1', 'Older']);
});

/* The rule above is half markup and half stylesheet, and the two halves meet
   at two class names. This does not prove the stylesheet renders — node has
   no layout — it proves the names have not drifted apart, which is the way a
   split rule silently stops applying. The rendered halves were checked in a
   browser by hand and the measurements are published in the pull request. */
test('the class the key is marked with is the class the stylesheet keys on', async () => {
  const css = read('assets/pane-releases-v2.css');

  assert.match(css, /\.legend \.share-key\.has-chip \.share-key-pct \{ display: none; \}/);
  assert.match(css,
    /@media \(max-width: 560px\) \{[^}]*\.stackbar > i > b \{ display: none; \}\s*\.legend \.share-key\.has-chip \.share-key-pct \{ display: inline-flex; \}/);
});

test('the segment width is written through the CSSOM and the colour never is', async () => {
  const dom = await boot({});
  const segments = shareSegments(dom);

  /* The page's CSP carries no 'unsafe-inline', so a style ATTRIBUTE would be
     refused by the browser and silently drop the bar to zero width. A custom
     property set through the CSSOM is not an attribute. */
  assert.equal(segments[0].getAttribute('style'), null);
  assert.equal(segments[0].style['--w'], '61.2%');
  assert.equal(segments[1].style['--w'], '27.4%');
  /* Colour is a class, shared with the legend, so a segment and its key can
     never disagree. */
  assert.equal(segments[0].getAttribute('class'), 'tone-cyan');
  assert.equal(segments[1].getAttribute('class'), 'tone-violet');
});

/* Three ways for version share to be missing, each with its own guard in
   adoptionOf() and its own mutation in the pull request. They are three tests
   rather than one because a single test would be killed by whichever guard
   the first payload happened to reach, and the other two would be unpinned. */

test('version share that nobody reported is stated as absent, with no bar and no numeral', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => { delete data.adoption; }),
  });

  assert.equal(shareBar(dom), undefined);
  const card = shareCardEl(dom);
  assert.match(allText(card), /Version share is not reported/);
  assert.match(allText(card), /nothing here is a zero/);
  assert.equal(numerals(allText(card).replace(/Version share/g, '')), 0);
});

test('version share reported without any buckets is the same absence', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      data.adoption = { latestVersion: '1.1.2', sampleSessions: 18_422 };
    }),
  });

  assert.equal(shareBar(dom), undefined);
  assert.match(allText(shareCardEl(dom)), /Version share is not reported/);
});

test('buckets that all came back unreported draw no bar rather than an empty one', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      data.adoption.buckets = [
        { key: 'latest', label: '1.1.2', basisPoints: null },
        { key: 'previous', label: '1.1.1', basisPoints: null },
      ];
    }),
  });

  /* A bar of three zero-width segments is a bar claiming nobody is on any
     version, which is a reading. Nothing reported one. */
  assert.equal(shareBar(dom), undefined);
  assert.match(allText(shareCardEl(dom)), /Version share is not reported/);
});

/* ================= a verdict is the outcome of a comparison ============== */

test('a crash-free figure with no floor behind it carries no verdict colour', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => { data.crashFree.floorBasisPoints = null; }),
  });
  const value = crashFreeValue(dom);

  assert.equal(value.getAttribute('class'), 'figure-val');
  assert.match(liveText(dom), /No floor is set for this figure/);
});

test('a crash-free figure above its floor is marked better, and below it worse', async () => {
  const above = await boot({});
  assert.match(above.doc.getElementById('content') && crashFreeValue(above).getAttribute('class'),
    /\bv-better\b/);
  assert.match(liveText(above), /Above the 99\.5% floor/);

  const below = await boot({
    releases: releasesFixture((data) => { data.crashFree.basisPoints = 9900; }),
  });
  assert.match(crashFreeValue(below).getAttribute('class'), /\bv-worse\b/);
  assert.match(liveText(below), /Below the 99\.5% floor/);
});

test('a crash-free rate nobody sent draws no figure rather than a zero', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => { delete data.crashFree; }),
  });

  assert.equal(crashFreeValue(dom), undefined);
  assert.match(liveText(dom), /Crash reporting has sent no figure/);
});

/* ======================== the health comparison ========================== */

test('a unit means what it says: millis and seconds are not the same number', async () => {
  const dom = await boot({});
  /* 1840 millis is 1.8s. The same figure sent as `seconds` would be 1840.0s,
     and a client that treated the two alike would print one of them a
     thousand times wrong. */
  assert.match(liveText(dom), /1\.8s/);
  assert.match(liveText(dom), /2\.1s/);

  const asSeconds = await boot({
    releases: releasesFixture((data) => {
      const cold = data.health.signals.find((s) => s.key === 'cold_start');
      cold.unit = 'seconds';
      cold.previous = 1.84;
      cold.current = 2.13;
    }),
  });
  assert.match(liveText(asSeconds), /1\.8s/);
  assert.match(liveText(asSeconds), /2\.1s/);
});

test('the health table is a named, keyboard-reachable region and the name is the table caption', async () => {
  const dom = await boot({});
  const region = healthRegion(dom);

  /* The four columns do not wrap, so under about 360px the box scrolls. A box
     that scrolls and cannot be focused hands its hidden columns to pointer
     users only. */
  assert.ok(region, 'the table is inside a scroll box');
  assert.equal(region.getAttribute('role'), 'region');
  assert.equal(region.getAttribute('tabindex'), '0');

  const caption = findAll(region, (n) => n.tagName === 'CAPTION')[0];
  assert.equal(region.getAttribute('aria-labelledby'), caption.getAttribute('id'));
  assert.equal(allText(caption),
    'Release health: 1.1.1 compared with 1.1.2 on Android');
});

test('a comparison with a version missing from it never reads "undefined"', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      delete data.health.previous;
      delete data.health.platform;
    }),
  });
  const caption = findAll(healthRegion(dom), (n) => n.tagName === 'CAPTION')[0];

  assert.equal(allText(caption),
    'Release health: the previous build compared with 1.1.2 on the reported platform');
  assert.doesNotMatch(liveText(dom), /undefined/);
});

test('a signal with nothing to compare says so instead of drawing an empty table', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => { data.health.signals = []; }),
  });

  assert.equal(healthRegion(dom), undefined);
  assert.match(liveText(dom), /No comparison yet/);
  assert.match(liveText(dom), /nothing to compare rather than nothing to worry about/);
});

/* ========================= status is never colour ======================== */

test('every state on the ladder carries a word, not only a tone', async () => {
  const dom = await boot({});

  /* The pill the row ends on, the chip beside the title and the stage name
     are all words. A reader who cannot tell amber from emerald reads the same
     three facts. */
  assert.match(heroText(dom), /iOS · Live/);
  assert.match(heroText(dom), /Android · Rolling out/);
  assert.match(rowText(dom, 'iOS'), /Rolled out/);
  assert.match(rowText(dom, 'Android'), /Staged, not moving/);
});

test('a rejected build says it was rejected rather than borrowing the stage name', async () => {
  const dom = await boot({
    releases: releasesFixture((data) => {
      const track = production(data, 'ios');
      track.state = 'rejected';
      delete track.rolloutBasisPoints;
      delete track.releasedAt;
    }),
  });

  /* "In review" and "Rejected" are the same rung and opposite facts, so the
     current stage takes the store's own word for it. */
  assert.match(rowText(dom, 'iOS'), /Rejected/);
  assert.match(heroText(dom), /iOS · Rejected/);
});

/* ============================ the read itself =========================== */

test('the pane asks its own endpoint once and sends no querystring', async () => {
  const dom = await boot({});

  const releases = dom.calls.filter((c) => c.endpoint === '/api/ops/releases');
  assert.equal(releases.length, 1);
  /* The registry gives this pane no filter and the route takes no parameter.
     A querystring here would be a control that changes nothing. */
  assert.equal(releases[0].query, undefined);
});

test('a read that never landed is the degraded state, not the empty one', async () => {
  const dom = await boot({ releases: new Error('boom') });

  assert.equal(shownState(dom), 'degraded');
  assert.match(allText(panel(dom, 'live')), /This pane could not be read/);
  assert.match(allText(panel(dom, 'live')), /Nothing here is a zero/);
});

/* ==================== the page loads one design system =================== */

test('the clock these tests read is frozen, or every relative reading below rots', async () => {
  const dom = await boot({});

  /* "6 days unchanged" and "read 2 days ago" are computed against Date.now().
     Unfrozen, the fixture drifts from the assertion by one day per day and
     this suite starts failing on a date nobody chose — or worse, passes for
     the wrong reason because the drift happened to land on another bucket. */
  assert.equal(vm.runInContext('Date.now()', dom.window), NOW);
  assert.equal(vm.runInContext('new Date().toISOString()', dom.window),
    '2026-09-20T06:00:00.000Z');
  /* And a constructed instant is still a real one, so the formatters are not
     being tested against a stub of themselves. */
  assert.equal(vm.runInContext('new Date("2026-09-18T06:00:00.000Z").getTime()', dom.window),
    Date.UTC(2026, 8, 18, 6, 0, 0));
});

test('releases.html loads the v2 system and none of the v1 one', async () => {
  const html = read('releases.html');

  /* Both systems define .card, .rail, .topbar, .btn, .seg, .pill, .tbl and
     .nav-item from different token sets, so a page loads one or the other. */
  assert.match(html, /assets\/shell-pane-v2\.js/);
  assert.match(html, /assets\/pane-releases-v2\.css/);
  assert.doesNotMatch(html, /assets\/ops\.css/);
  assert.doesNotMatch(html, /assets\/operate\.css/);
  assert.doesNotMatch(html, /assets\/shell\.js/);
  assert.match(html, /<body data-pane="releases"/);

  /* The strict CSP is what makes "no style attribute, no innerHTML" an
     enforced rule rather than a convention. */
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(html, /unsafe-inline/);
});

test('nothing in the pane module builds markup from a string', async () => {
  const dom = await boot({});

  /* The runtime half. The stub's elements are plain objects with no innerHTML
     accessor, so an assignment would leave an own property behind on whatever
     node received it. This catches the thing itself rather than a spelling of
     it. */
  const touched = [];
  (function walk(node) {
    if (node.nodeType === 1) {
      ['innerHTML', 'outerHTML'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          touched.push(node.tagName + '.' + key);
        }
      });
      if (node.hasAttribute('style')) touched.push(node.tagName + '[style]');
    }
    node.childNodes.forEach(walk);
  })(dom.doc.getElementById('content'));
  assert.deepEqual(touched, []);

  /* And the source half, for the branches these fixtures do not reach.
     Comments are stripped first: this module's own docblock contains the
     sentence "Nothing here uses innerHTML", and a scan that matched its own
     promise would be green no matter what the code did. */
  const src = PANE_SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(src, /innerHTML/);
  assert.doesNotMatch(src, /outerHTML/);
  assert.doesNotMatch(src, /insertAdjacentHTML/);
  assert.doesNotMatch(src, /document\.write/);
  /* The page's CSP refuses a style attribute, which is why the bar's width
     goes through setProperty instead. */
  assert.doesNotMatch(src, /setAttribute\(\s*['"]style['"]/);
});

/* The stripper above is load-bearing, so it is checked rather than trusted: a
   comment-stripping regex that quietly ate the code as well would make every
   assertion in the test above pass over an empty string. */
test('the comment stripper leaves the code it is meant to leave', () => {
  const src = PANE_SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  assert.match(src, /S\.definePane\('releases'/);
  assert.match(src, /setProperty\('--w'/);
  assert.match(src, /'\/api\/ops\/releases'/);
  /* The docblock sentence that made a bare scan meaningless is gone. */
  assert.doesNotMatch(src, /Nothing here uses/);
  assert.ok(src.length > PANE_SRC.length / 2, 'the stripper removed comments, not the module');
});

/* ============== an absent share is two opposite facts, not one ============ */

/* One store's block under "What the stores say". Whole-pane text is the wrong
   instrument again: both stores carry the "Staged rollout" label. */
function storeText(dom, label) {
  const box = findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('inset'))
    .find((n) => findAll(n, (c) => (c.className || '').split(/\s+/)
      .includes('inset-title')).some((t) => allText(t).trim() === label));
  assert.ok(box, `no store block labelled ${label}`);
  return allText(box);
}

/* These four run in the fake DOM on purpose. The four sentences a browser has
   to see — the headline, the end pill, the stage figure and the share line
   over a RUNNING phased release — are bound in scripts/ops-releases-
   omissions.test.mjs, which lays the page out in Chrome. What is left here is
   the edge of the predicate, where a browser adds nothing and a matrix of
   fixtures is cheap: which store states count as unreadable, and what the
   note does with a malformed entry. */

/* PAUSED arrives as `halted`, and Apple reports no share for it either. The
   pane reaches it down a different branch from `rolling_out`: halted is stage
   2, so the rollout stage is never REACHED and carries no figure at all. The
   fact therefore has to land in the store block and the share sentence, which
   is why this is asserted rather than assumed to follow from the running
   case. */
test('a paused phased release reports no share rather than none', async () => {
  const data = releasesFixture();
  const ios = production(data, 'ios');
  ios.state = 'halted';
  ios.rolloutBasisPoints = null;
  const dom = await boot({ releases: data });

  assert.match(storeText(dom, 'App Store Connect'), /Staged rollout\s*Not reported/,
    'a paused rollout is not saying its share is unreported');
  assert.doesNotMatch(storeText(dom, 'App Store Connect'), /Under way/,
    'the store block says "Under way" directly under a stopped-release pill');
  assert.match(shareCardText(dom), /cannot be read/,
    'the share sentence does not say a paused ceiling is unreadable');

  /* The other arm: a halted track that DOES carry a share still prints it, so
     the assertions above are about the absent number and not about the state. */
  ios.rolloutBasisPoints = 3_000;
  const withShare = await boot({ releases: data });
  assert.doesNotMatch(storeText(withShare, 'App Store Connect'), /Not reported/);
  assert.match(storeText(withShare, 'App Store Connect'), /30%/);
});

/* The boundary the route draws and the pane must not blur: a live version with
   no phased release at all, and a COMPLETE one, resolve to a genuine reading
   of the whole field. Only ACTIVE and PAUSED are unreadable. A predicate that
   fired on any absent share would relabel a finished release as unmeasured
   and put a note on the page saying the store would not answer a question
   nobody asked. */
test('a live track with no staged rollout is an absence, not an unreadable share', async () => {
  const data = releasesFixture();
  const ios = production(data, 'ios');
  ios.state = 'live';
  ios.rolloutBasisPoints = null;
  const dom = await boot({ releases: data });

  const row = rowText(dom, 'iOS');
  assert.doesNotMatch(row, /Not reported by/,
    'a live track with no staged rollout is being drawn as an unreadable share');
  assert.doesNotMatch(liveText(dom), /cannot be read/);
  assert.match(row, /No staged rollout/,
    'the row lost the words for an absent rollout, so the assertions above ' +
    'would pass on a row that says nothing');
});

/* The note prints what the answer carries. An entry with neither a title nor a
   key names nothing, so it is dropped rather than drawn as an empty bullet
   with a full stop in front of it. */
test('an omission that names nothing is dropped, not drawn blank', async () => {
  const data = releasesFixture();
  data.omissions = [{ key: '', title: '   ', detail: 'orphan' }];
  const dom = await boot({ releases: data });
  assert.doesNotMatch(liveText(dom), /orphan/,
    'an omission with no name is being drawn');

  /* The other arm, because "nothing is drawn" also describes a pane that
     cannot draw omissions at all. */
  data.omissions = [{ key: 'ios_rollout_share', title: '', detail: 'orphan' }];
  const named = await boot({ releases: data });
  assert.match(liveText(named), /ios_rollout_share\. orphan/,
    'an omission carrying only a key falls back to the key');
});

/* The route publishes `omissions` conditionally, so every older answer still
   in flight has no such field. */
test('an answer with no omissions field draws no note and does not fail', async () => {
  const data = releasesFixture();
  delete data.omissions;
  const dom = await boot({ releases: data });

  assert.equal(shownState(dom), 'live', 'the pane fell out of its live state');
  const notes = findAll(panel(dom, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('is-note'));
  assert.equal(notes.length, 0, 'a note was drawn with nothing to put in it');

  /* The other arm, so "no note" is not simply what this pane always does. */
  data.omissions = [{ key: 'k', title: 'Held back', detail: 'why' }];
  const withOne = await boot({ releases: data });
  assert.equal(findAll(panel(withOne, 'live'),
    (n) => (n.className || '').split(/\s+/).includes('is-note')).length, 1);
});

/* The configuration this pane will actually be in most often, and the one the
   battery found unbound: Android finished, iOS still phasing. Every other
   fixture here leaves Android staged at 20%, so the share sentence reaches the
   unreadable clause by being APPENDED to a measured ceiling, and the branch
   that returns the clause on its own is never taken. With no measured ceiling
   the next branch is "no store is capping the rollout, so this share is
   take-up" — the exact false claim, in the case where nothing else on the
   sentence contradicts it. */
test('one store phasing and the other finished still says the ceiling is unreadable', async () => {
  const data = releasesFixture();
  const ios = production(data, 'ios');
  ios.state = 'rolling_out';
  ios.rolloutBasisPoints = null;
  const android = production(data, 'android');
  android.state = 'live';
  android.rolloutBasisPoints = 10_000;
  const dom = await boot({ releases: data });

  assert.doesNotMatch(shareCardText(dom), /no store is capping/,
    'the sentence claims no store is capping while Apple is capping by an ' +
    'amount it will not report');
  assert.match(shareCardText(dom), /iOS: a phased release the store does not measure/,
    'the sentence does not name the unreadable ceiling either, so the ' +
    'assertion above would pass on a sentence that says nothing');
  assert.doesNotMatch(shareCardText(dom), /a ceiling the store set/,
    'a measured ceiling is being reported where there is none, which would ' +
    'mean this fixture never reached the branch under test');
});
