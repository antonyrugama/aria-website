/* The shared hero's column layout on a narrow viewport — Stadiora/Aria#10397.
 *
 * WHAT IS BEING BOUND
 *
 * `.hero` is `grid-template-columns: auto minmax(0, 1fr) auto` (aria.css:447),
 * and under 980px it drops to `auto minmax(0, 1fr)`. The first track is `auto`,
 * so it sizes to the widest item that lands in it. Exactly one element is meant
 * to live there: the 46px `.hero-orb`.
 *
 * The approved design ends a hero with `<div class="hero-chips">`. With nothing
 * placing it, the chips auto-place into column 1 of the next row, the `auto`
 * track grows to the chips, and `minmax(0, 1fr)` — the title column — gives up
 * whatever they took. The title gets narrower the more the pane has to say,
 * which is backwards.
 *
 * WHY A PAGE-LEVEL OVERFLOW CHECK CANNOT SEE THIS, AND WHY THIS FILE EXISTS
 *
 * `.hero` sets `overflow: hidden` (aria.css:439). It absorbs its own overflow,
 * so `document.documentElement.scrollWidth` never moves and a sweep that reads
 * the document comes back byte-identical to its control. That is recorded as a
 * NOT COVERED bullet in `check-ops-narrow-overflow.mjs` and is the reason the
 * hero half of #10397 stayed open after PR #66 closed the guard half. This file
 * reads the used grid tracks and the elements' own boxes instead, which is the
 * layer the defect actually lives in.
 *
 * WHAT IT MEASURES
 *
 * Real Chrome over CDP, real HTTP, used values — not source text, and not the
 * declarations under test. Three contracts per (theme x width), all pure
 * geometry read off the laid-out page:
 *
 *   1. NARROW, the `auto` track is sized by the orb.  first track === orb width.
 *   2. NARROW, the chips are on a row of their own.   chips width === the hero's
 *      content-box width, and the chips start at the content-box left edge.
 *   3. WIDE, nothing moved.  three tracks, chips in the third, first still the
 *      orb. This is the regression guard for the fix itself.
 *
 * Contract 1 is the one the defect breaks: measured on `origin/main` at 375px
 * the first track is 73.66px against a 46px orb, and the title column is
 * 205.34px instead of 233px. The magnitude scales with how wide the chips are,
 * which is why panes carrying more chips than this page collapsed further.
 *
 * THE SUBJECT
 *
 * `/ops/shell-v2.html`. It is the only page that loads `ops/assets/aria.css`
 * ALONE — every `/ops/*.html` pane also loads a `pane-*-v2.css`, and four of
 * those currently carry their own copy of the `.hero > .hero-chips` line. On a
 * pane the shared rule therefore cannot be observed to do anything; on the
 * shell it is the only thing standing between the hero and the defect. The
 * shell also carries the approved mock's hero markup verbatim (orb, title
 * block, `.hero-chips`), so it is the shape every v2 pane is built from.
 *
 * NOT COVERED — deliberately, and measured rather than assumed:
 *
 *  - The ten `/ops/*.html` pane pages. They gate on a session and build their
 *    heroes from API data, so driving them needs the ~400 lines of fixtures
 *    that `check-ops-narrow-overflow.mjs` already carries; that guard drives
 *    all ten on every run. Nothing here would be visible on them anyway:
 *    `pane-alerts-v2.css:42`, `pane-overview-v2.css:24`,
 *    `pane-releases-v2.css:300` and `pane-settings-v2.css:188` each carry an
 *    identical scoped copy of the rule this file binds, so their heroes are
 *    already correct and would stay correct if the shared rule were deleted.
 *    Removing those now-redundant copies is the remaining half of #10397 and
 *    belongs to whoever owns those files.
 *  - `.hero > .row:last-child`, the pre-existing sibling rule. No page in this
 *    repository ends a hero with a `.row`, so there is nothing to measure. It
 *    is untouched by this change.
 *  - The magnitude of the collapse on a real pane. This page's single "Sample"
 *    chip is 73.66px wide, so the harm it can demonstrate is 27.66px of stolen
 *    title. The unbounded version needs a pane's chips and is out of reach
 *    here for the reason above.
 *  - `/ops/shell-v2.html` overflows its document at 375px (449px against 375px)
 *    entirely because of `.topbar-end`, the preview-state switcher. That is a
 *    separate defect of this page's own chrome, it is NOT the hero, and this
 *    file neither fixes nor judges it. The hero clips and contributes nothing
 *    to that number, before or after.
 *  - The `trackKeywords` refusal — the check that no authored keyword (`auto`,
 *    `minmax`, `1fr`) survives into the value this file reads — is NOT bound by
 *    any mutation. Mutation G2 rewrote it to compare the value with itself and
 *    the suite stayed green, because no browser tested here ever returns an
 *    unresolved value from `gridTemplateColumns` on a laid-out grid. It is a
 *    fail-closed guard against a browser that stops resolving used track sizes,
 *    kept deliberately and unproven honestly.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';
const THEMES = ['dark', 'light'];

/* The breakpoint is `max-width: 980px` (aria.css:918). 980 and 981 are the two
   sides of it; 360 and 375 are the phone widths the rest of the ops checks
   use. Stated here as the contract's own inputs rather than read back out of
   the stylesheet, so a media query edited to a different number fails this
   file instead of moving with it. */
const BREAKPOINT = 980;
const NARROW = [360, 375, 768, BREAKPOINT];
const WIDE = [BREAKPOINT + 1, 1280];
const HEIGHT = 900;

/* Used grid tracks come back from Chrome as fractional pixels. One hundredth
   of a pixel is below anything layout can mean and well above float noise. */
const EPS = 0.01;

/* Every pass must judge at least this many heroes. A layout oracle that
   silently measured nothing — a renamed class, a hero that stopped rendering,
   a navigation that failed, a width list emptied — would otherwise report that
   everything passes.
   
   Written as a literal rather than `(NARROW.length + WIDE.length) * THEMES.length`,
   which is what it said first. A floor counted from the same arrays the sweep
   iterates shrinks with them: emptying NARROW took the floor from 12 to 4 and
   the suite stayed green while measuring no narrow hero at all. Mutation G1
   demonstrated that, which is the only reason it is not still written that way.
   Two themes, four narrow widths, two wide ones. */
const SITE_FLOOR = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const abs = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

/* -------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    try {
      const p = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (p > 0) return p;
    } catch { /* browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
      if (res.ok) return await res.json();
    } catch { /* browser not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const waiters = [];
  const seen = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method, timeoutMs = 30000) {
      if (seen.has(method)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for ' + method)), timeoutMs);
        const check = (m) => {
          if (m === method) { clearTimeout(timer); resolve(); }
          else waiters.push(check);
        };
        waiters.push(check);
      });
    },
    reset() { seen.delete('Page.loadEventFired'); }
  };
}

/* ------------------------------------------------------------- the reading */

/* Everything the three contracts need, read in one pass off the laid-out page.
 *
 * `gridTemplateColumns` on a grid container resolves to the USED track sizes in
 * pixels — not the authored `auto minmax(0, 1fr)` — which is the whole reason
 * this is measurable at all. That is asserted rather than trusted: a value that
 * still contains a keyword is reported as unreadable and fails.
 *
 * Widths come from getBoundingClientRect() so they are fractional. The integer
 * scrollWidth/clientWidth pair is deliberately NOT used anywhere in this file:
 * it rounds, and it is read on the wrong element for a container that clips. */
const READ = `(() => {
  const hero = document.querySelector('.hero');
  if (!hero) return JSON.stringify({ error: 'no .hero on the page' });
  const orb = hero.querySelector('.hero-orb');
  const chips = hero.querySelector('.hero-chips');
  const title = hero.querySelector('.hero-title');
  if (!orb) return JSON.stringify({ error: 'the hero has no .hero-orb' });
  if (!chips) return JSON.stringify({ error: 'the hero has no .hero-chips' });
  if (!title) return JSON.stringify({ error: 'the hero has no .hero-title' });
  if (hero.lastElementChild !== chips) {
    return JSON.stringify({ error: 'the hero does not end with .hero-chips; it ends with ' +
      (hero.lastElementChild ? hero.lastElementChild.className || hero.lastElementChild.tagName : 'nothing') });
  }

  const cs = getComputedStyle(hero);
  const tracks = cs.gridTemplateColumns.trim().split(/\\s+/);
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const hr = hero.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft);
  const padR = parseFloat(cs.paddingRight);

  return JSON.stringify({
    display: cs.display,
    overflow: cs.overflowX,
    tracksRaw: cs.gridTemplateColumns,
    tracks: tracks.map((t) => parseFloat(t)),
    trackKeywords: tracks.filter((t) => !/^[0-9.]+px$/.test(t)),
    hero: box(hero),
    content: { left: hr.left + padL, right: hr.right - padR, width: hr.width - padL - padR },
    orb: box(orb),
    chips: box(chips),
    titleCol: box(title.parentElement),
    theme: document.documentElement.getAttribute('data-theme'),
    viewport: document.documentElement.clientWidth
  });
})()`;

/* -------------------------------------------------------------- the sweep */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-hero-'));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

const cdpPort = await devtoolsPort(profile);
const targets = await devtools(cdpPort, '/json/list');
const target = targets.find((t) => t.type === 'page');
const cdp = connect(target.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { cdp.close(); } catch { /* already gone */ }
  try { browser.kill(); } catch { /* already gone */ }
  try { server.close(); } catch { /* already gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}
after(cleanup);
process.on('exit', cleanup);

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error('page threw: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return JSON.parse(res.result.value);
}

let initScript = null;
async function setTheme(theme) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)}); } catch (e) {}`
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme, so a failed storage write
     cannot look like a success. The theme that painted is asserted below. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

/* One reading at one (theme, width). The viewport is set before the navigation
   so the media query is already resolved when the page first lays out, rather
   than relying on a resize being observed. */
async function measure(theme, width) {
  await setTheme(theme);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });
  cdp.reset();
  await cdp.send('Page.navigate', { url: origin + SHELL });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, 250));
  const read = await evaluate(READ);
  const where = `${theme}/${width}px`;
  assert.equal(read.error, undefined, `${where}: ${read.error}`);
  assert.equal(read.theme, theme,
    `${where}: asked for the ${theme} theme and the page painted ${read.theme}`);
  assert.equal(read.viewport, width,
    `${where}: asked for a ${width}px viewport and the document reports ${read.viewport}px`);
  assert.equal(read.display, 'grid', `${where}: .hero is display:${read.display}, not a grid`);
  assert.deepEqual(read.trackKeywords, [],
    `${where}: gridTemplateColumns did not resolve to used pixel sizes — got "${read.tracksRaw}". ` +
    'Every contract in this file reads those numbers, so an unresolved value is a refusal, not a pass.');
  return Object.assign(read, { where, width, theme });
}

const px = (n) => `${Math.round(n * 100) / 100}px`;

/* ------------------------------------------------------------------ tests */

/* The inputs, before anything is measured with them. Every other test in this
   file loops over these lists, so a list that lost its widths would make those
   loops assert nothing and pass. The contract is stated here in literals that
   do not move when the lists do. */
test('the sweep declares the widths its contracts are about', () => {
  for (const w of [360, 375, BREAKPOINT]) {
    assert.ok(NARROW.includes(w), `NARROW must contain ${w}px; it is [${NARROW.join(', ')}]`);
  }
  assert.ok(NARROW.every((w) => w <= BREAKPOINT),
    `every NARROW width must be at or below the ${BREAKPOINT}px breakpoint; got [${NARROW.join(', ')}]`);
  assert.ok(WIDE.includes(BREAKPOINT + 1),
    `WIDE must contain ${BREAKPOINT + 1}px, the first width the media query does not cover; it is [${WIDE.join(', ')}]`);
  assert.ok(WIDE.every((w) => w > BREAKPOINT),
    `every WIDE width must be above the breakpoint; got [${WIDE.join(', ')}]`);
  assert.equal(THEMES.length * (NARROW.length + WIDE.length), SITE_FLOOR,
    `the declared sweep is ${THEMES.length} x ${NARROW.length + WIDE.length} readings, ` +
    `which is not the ${SITE_FLOOR} this file contracts to judge`);
  /* The tolerance is a rounding allowance, not a budget. Mutation G4 inflated it
     to 1000 and the narrow numeric contract swallowed the real 27.66px defect;
     only the wide co-location check, which uses EPS as a strict margin, caught
     it. This states the intended size independently: sub-pixel. */
  assert.ok(EPS > 0 && EPS < 1,
    `EPS must be a sub-pixel rounding allowance, not a budget that can absorb a layout defect; it is ${EPS}`);
});

/* The instrument next. If `gridTemplateColumns` did not report used pixel
   sizes, or the page's own hero were not the shape the contracts assume, every
   assertion below would be measuring something else. */
test('the hero is a grid whose used track sizes can be read', async () => {
  const wide = await measure('dark', 1280);
  assert.equal(wide.tracks.length, 3,
    `above the breakpoint the hero should keep three tracks, got ${wide.tracks.length} (${wide.tracksRaw})`);
  assert.ok(wide.tracks.every((t) => Number.isFinite(t) && t >= 0),
    `track sizes should be finite pixel lengths, got "${wide.tracksRaw}"`);
  assert.equal(wide.overflow, 'hidden',
    'the hero should still clip. If it stopped clipping, the page-level overflow checks would ' +
    'begin to see this defect and the premise of this file would need revisiting.');
  assert.ok(Math.abs(wide.tracks[0] - wide.orb.width) < EPS,
    `the first track should be the orb at a wide viewport too: track ${px(wide.tracks[0])} vs orb ${px(wide.orb.width)}`);
});

/* CONTRACT 1 and 2 — the defect itself. */
test('under the breakpoint the orb sizes the first track and the chips take their own row', async () => {
  const failures = [];
  let judged = 0;
  for (const theme of THEMES) {
    for (const width of NARROW) {
      const m = await measure(theme, width);
      judged++;

      if (m.tracks.length !== 2) {
        failures.push(`${m.where}: expected the two-column narrow hero, got ${m.tracks.length} tracks (${m.tracksRaw})`);
        continue;
      }

      /* 1. The `auto` track is sized by the orb, the only element meant to be
            in it. When the chips share the column this is the chips' width. */
      if (Math.abs(m.tracks[0] - m.orb.width) >= EPS) {
        const culprit = Math.abs(m.tracks[0] - m.chips.width) < EPS ? ' — which is exactly the chips\' width' : '';
        failures.push(
          `${m.where}: the hero's first track is ${px(m.tracks[0])} but the orb is ${px(m.orb.width)}${culprit}. ` +
          `The title column took the difference: ${px(m.titleCol.width)} instead of ${px(m.titleCol.width + (m.tracks[0] - m.orb.width))}.`);
      }

      /* 2. ...because the chips are on a row of their own, spanning the hero's
            whole content box rather than sitting in one column of it. */
      if (Math.abs(m.chips.width - m.content.width) >= EPS) {
        failures.push(
          `${m.where}: .hero-chips is ${px(m.chips.width)} wide inside a ${px(m.content.width)} content box, ` +
          'so it is sharing a row rather than spanning one.');
      }
      if (Math.abs(m.chips.left - m.content.left) >= EPS) {
        failures.push(
          `${m.where}: .hero-chips starts at ${px(m.chips.left)}, not at the content-box left edge ${px(m.content.left)}.`);
      }

      /* ...and below the orb, not beside it. Auto-placement already puts them
         on the second row, so this holds before the fix too; it is here so a
         future `grid-row` change cannot quietly move them back up. */
      if (m.chips.top < m.orb.bottom - EPS) {
        failures.push(
          `${m.where}: .hero-chips starts at y ${px(m.chips.top)}, above the orb's bottom edge ${px(m.orb.bottom)}.`);
      }
    }
  }
  assert.deepEqual(failures, [], `narrow hero layout:\n  ${failures.join('\n  ')}`);
  console.log(`  hero narrow: judged ${judged} hero(es) at ${NARROW.join('/')}px across ${THEMES.join(' and ')}`);
});

/* CONTRACT 3 — the regression guard for the fix. The rule lives inside
   `@media (max-width: 980px)`, so one pixel the other side of the breakpoint
   nothing may have moved: three tracks, chips back in the third. */
test('above the breakpoint the hero keeps its three columns and the chips stay in the third', async () => {
  const failures = [];
  let judged = 0;
  for (const theme of THEMES) {
    for (const width of WIDE) {
      const m = await measure(theme, width);
      judged++;
      if (m.tracks.length !== 3) {
        failures.push(`${m.where}: expected three tracks above the breakpoint, got ${m.tracks.length} (${m.tracksRaw})`);
        continue;
      }
      if (Math.abs(m.tracks[0] - m.orb.width) >= EPS) {
        failures.push(`${m.where}: first track ${px(m.tracks[0])} is not the orb's ${px(m.orb.width)}`);
      }
      if (Math.abs(m.tracks[2] - m.chips.width) >= EPS) {
        failures.push(`${m.where}: third track ${px(m.tracks[2])} is not the chips' ${px(m.chips.width)}`);
      }
      if (Math.abs(m.chips.right - m.content.right) >= EPS) {
        failures.push(
          `${m.where}: the chips should end at the content-box right edge ${px(m.content.right)}, they end at ${px(m.chips.right)}`);
      }
      /* Beside the orb, not below it — the opposite of the narrow case, and
         the thing a rule that forgot its media query would break. */
      if (m.chips.top >= m.orb.bottom - EPS) {
        failures.push(
          `${m.where}: the chips dropped below the orb at a wide viewport — ` +
          `chips top ${px(m.chips.top)} vs orb bottom ${px(m.orb.bottom)}. The narrow rule has escaped its media query.`);
      }
    }
  }
  assert.deepEqual(failures, [], `wide hero layout:\n  ${failures.join('\n  ')}`);
  console.log(`  hero wide: judged ${judged} hero(es) at ${WIDE.join('/')}px across ${THEMES.join(' and ')}`);
});

/* The floor. Every test above loops; a loop that ran zero times asserts
   nothing and passes. This counts the readings that actually happened. */
test('the sweep measured every hero it declared', async () => {
  let judged = 0;
  for (const theme of THEMES) {
    for (const width of [...NARROW, ...WIDE]) {
      const m = await measure(theme, width);
      assert.ok(m.tracks.length >= 2, `${m.where}: hero had ${m.tracks.length} track(s)`);
      judged++;
    }
  }
  assert.ok(judged >= SITE_FLOOR,
    `only ${judged} of ${SITE_FLOOR} declared hero readings were judged, under the floor of ${SITE_FLOOR}`);
  console.log(`  hero sweep: judged ${judged} hero(es) across ${THEMES.length} themes x ${NARROW.length + WIDE.length} widths`);
});
