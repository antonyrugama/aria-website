/* Rendered oracle for what the App releases pane says when a store reports no
   share — Stadiora/Aria#10836.

   WHY THIS FILE EXISTS AND WHY IT IS NOT IN ops-releases-v2.test.mjs

   That file runs in scripts/ops-dom-harness.mjs, which is a fake DOM with no
   cascade and no layout. It can prove the pane WRITES a class name. It cannot
   prove a stylesheet on the page PAINTS it, and the distance between those two
   is the whole defect in Stadiora/Aria#10456: the users pane wrote
   `is-selected` onto a row, every guard was green, and nothing on screen
   changed. Six more instances were found after it. Two of them were this
   pane's.

   The hazard is live here rather than theoretical. The Overview, Happening now
   and What happened panes all render this same `omissions[]` array, and all
   three draw it with `.omit` / `.omit-item` / `.omit-title` / `.omit-desc` —
   class names each of those three declares in ITS OWN stylesheet.
   ops/releases.html loads assets/aria.css, assets/shell-pane-v2.css and
   assets/pane-releases-v2.css and nothing else, so markup copied across from
   any of them would have written four class names no sheet on this page can
   paint. The pane therefore draws the note in its own `.callout`, and this
   file resolves the computed style of the result in a real browser to prove
   the choice actually landed.

   WHAT IS UNDER TEST

     - the note the route's `omissions[]` produces is painted, not just
       present: a box with its own tint, its own ring and its own glyph ink,
       measurably different from the plain `.callout` beside it on the same
       page in the same frame;
     - that tint is NOT the amber warning tint, because an API with no such
       field is not a fault and must not draw like one;
     - the note's text clears WCAG AA against the surface it is really drawn
       on — the note's own translucent tint composited over the page, not the
       page alone;
     - and the four sentences the missing share used to make false: the
       headline, the pane's one share sentence, the pipeline's stage figure and
       the end pill.

   Both arms of every invariant. An element that draws whatever the payload
   says is not evidence, so every test that asserts the note appears has a
   partner asserting it is gone when the share is readable.

   It needs a browser and fails closed without one: CHROME_PATH, or Chrome or
   Chromium on one of the usual paths. There is no fake-DOM fallback, because a
   fake DOM has no cascade and the cascade is the thing under test.

   NOT COVERED here, and stated rather than implied:

     - anything about the route. Whether /api/ops/releases actually emits
       `omissions[]` for an ACTIVE phased release is app-backend's test, in the
       Aria monorepo. This file asserts only what the pane does with an answer
       that carries one.
     - the note at widths other than 1280 and 375. Those are the two the
       screenshots in the pull request cover.
     - the `.omit-list` gap value. The test below asserts the list is a column
       with a non-zero gap, not that the gap is 8px, because the number is a
       taste decision and pinning it would fail on any future adjustment
       without anything being wrong. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { stub, RELEASES } = await import(pathToFileURL(path.join(ROOT, 'scripts/ops-api-stub.mjs')).href);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

/* Which of the two answers the server is handing out. Selected here rather
   than in the URL because the pane asks for /api/ops/releases with no
   querystring and ops-releases-v2.test.mjs asserts that it does. */
let unreadable = true;

/* The answer the route publishes while an iOS phased release is running.
   Built by deep-copying the shared stub's own release payload and changing
   exactly the fields monorepo #10833 changed — the production track's state
   and share, and the `omissions[]` entry that names the gap — so everything
   else on the page is the fixture every other guard sees.

   `unknownTracks` gets an entry so the pane's plain amber `.callout` is on the
   same page in the same frame. Without it the note's tint could only be
   compared against a number typed into this file, which is not a measurement.

   The detail string is the route's, shortened. The pane prints whatever the
   route sends and this file asserts it prints THAT rather than a caption of
   its own, so the wording here only has to be distinctive. */
function unreadableAnswer() {
  const data = JSON.parse(JSON.stringify(RELEASES));
  const ios = data.platforms.find((p) => p.platform === 'ios');
  ios.tracks.find((t) => t.track === 'production').state = 'rolling_out';
  ios.tracks.find((t) => t.track === 'production').rolloutBasisPoints = null;
  ios.unknownTracks = ['promo'];
  data.omissions = [{
    key: 'ios_rollout_share',
    title: 'Share of devices on an iOS phased release',
    detail: 'App Store Connect states that a phased release is under way and states no '
      + 'share for it: the API reports the phase state and the day of the ramp, never a '
      + 'percentage.'
  }];
  return data;
}

/* The same page with nothing unreadable: iOS live at 100% and Google Play
   reporting Android's share as a full rollout. Every "it is drawn" test has a
   partner that runs against this and asserts it is not.

   Android is moved to a finished rollout rather than left on the shared stub's
   staged 20%, and that is load-bearing rather than tidying. On the stub's
   payload the headline reads "1.1.2 is the production build" because ANDROID
   is capped, which has nothing to do with the share this change is about — so
   an arm built on it would confirm the headline is not "live on" for the wrong
   reason and would go on passing against a pane that could never say "live
   on" at all. It was written that way first and this file's own second arm
   caught it. With both stores fully out, the headline, the end pill and the
   "no store is capping" sentence are all reachable, so each test below can
   show the pane still says them when it should. */
function readableAnswer() {
  const data = JSON.parse(JSON.stringify(RELEASES));
  data.platforms.find((p) => p.platform === 'ios').unknownTracks = ['promo'];
  const android = data.platforms.find((p) => p.platform === 'android');
  const prod = android.tracks.find((t) => t.track === 'production');
  prod.state = 'live';
  prod.rolloutBasisPoints = 10_000;
  return data;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const answer = url.pathname.startsWith('/api/ops/releases')
        ? { data: unreadable ? unreadableAnswer() : readableAnswer() }
        : stub(url.pathname);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(answer));
    });
    return;
  }
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
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH. This file cannot ' +
    'fall back to the fake DOM: a fake DOM has no cascade, and whether a class is ' +
    'painted is a question only the cascade can answer.');
}

async function devtoolsPort(dir) {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
      if (res.ok) return await res.json();
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}

let cdp;
let browser;
let profile;
let origin;
let themeScript = null;
let showing = null;

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error('probe threw: ' + (result.exceptionDetails.exception
      ? result.exceptionDetails.exception.description
      : result.exceptionDetails.text));
  }
  return result.result.value;
}

async function waitFor(expression, what) {
  const guarded = `(() => { try { return !!(${expression}); } catch (e) { return false; } })()`;
  for (let i = 0; i < 300; i++) {
    if (await evaluate(guarded)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + what);
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'ops-omit-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const target = await devtools(port, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try {' +
      `localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      '} catch (e) {}'
  });
});

after(async () => {
  if (cdp) cdp.close();
  if (browser) {
    const gone = new Promise((done) => browser.once('exit', done));
    browser.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
  }
  server.close();
  try {
    if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch (e) { /* the runner sweeps it up */ }
});

const UNREADABLE_1280 = { key: 'unreadable/1280/dark', width: 1280, theme: 'dark', unreadable: true };
const UNREADABLE_LIGHT = { key: 'unreadable/1280/light', width: 1280, theme: 'light', unreadable: true };
const UNREADABLE_375 = { key: 'unreadable/375/dark', width: 375, theme: 'dark', unreadable: true };
const READABLE_1280 = { key: 'readable/1280/dark', width: 1280, theme: 'dark', unreadable: false };

async function show(state) {
  if (showing === state.key) return;
  unreadable = state.unreadable;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: state.width, height: 900, deviceScaleFactor: 1, mobile: false
  });
  if (themeScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: themeScript });
  themeScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(state.theme)}); } catch (e) {}`
  })).identifier;
  await cdp.send('Page.navigate', { url: origin + '/ops/releases.html' });
  await waitFor("document.body.classList.contains('is-ready')", 'the shell on /ops/releases.html');
  await waitFor("document.querySelector('.pipe-row')", `the pipeline at ${state.width}`);
  await waitFor(`document.documentElement.getAttribute('data-theme') === ${JSON.stringify(state.theme)}`,
    `the ${state.theme} theme`);
  showing = state.key;
}

/* WCAG relative luminance over a surface resolved from the page rather than
   assumed.

   The surface walk starts at the element ITSELF, not at its parent: the note's
   text sits on the note's own translucent tint, and a walk that starts one
   level up measures it against the page and quietly reports the wrong number.
   Every translucent layer on the way up is composited until an opaque one is
   reached, and the chain is returned with the ratio so a published figure
   names the surface it was measured against. */
const CONTRAST = `
function __rgba(value) {
  const parts = String(value).match(/-?[\\d.]+/g);
  if (!parts) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts.length > 3 ? Number(parts[3]) : 1];
}
function __over(fg, bg) {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}
function __lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function __ratio(a, b) {
  const l1 = __lum(a), l2 = __lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function __name(node) {
  return node.tagName.toLowerCase() +
    (node.className ? '.' + String(node.className).trim().split(/\\s+/).join('.') : '');
}
function __ink(el) {
  const stack = [];
  let node = el;
  while (node) {
    const bg = __rgba(getComputedStyle(node).backgroundColor);
    if (bg && bg[3] > 0) {
      stack.push({ c: bg, on: node });
      if (bg[3] === 1) break;
    }
    node = node.parentElement;
  }
  const last = stack[stack.length - 1];
  const opaque = last && last.c[3] === 1;
  let surface = opaque ? last.c : [255, 255, 255, 1];
  for (let i = stack.length - (opaque ? 2 : 1); i >= 0; i--) surface = __over(stack[i].c, surface);
  const fg = __rgba(getComputedStyle(el).color);
  return {
    ratio: Math.round(__ratio(__over(fg, surface), surface) * 100) / 100,
    against: stack.length ? stack.map((s) => __name(s.on) + '@' + s.c[3]).join(' over ') : 'no painted ancestor'
  };
}
`;

/* One read of the whole page, so every assertion below is made against one
   frame rather than against a page that may have been re-laid-out between
   two separate evaluates. */
async function readPage() {
  return JSON.parse(await evaluate(`(() => {
    ${CONTRAST}
    const note = document.querySelector('.callout.is-note');
    const plain = Array.from(document.querySelectorAll('.callout'))
      .find((n) => !n.classList.contains('is-note')) || null;
    const shareLine = document.querySelector('.share-line');
    const heroTitle = document.querySelector('.hero-title');
    const styleOf = (el) => {
      const cs = getComputedStyle(el);
      const svg = el.querySelector('svg');
      return {
        background: cs.backgroundColor,
        boxShadow: cs.boxShadow,
        display: cs.display,
        padding: cs.paddingTop,
        radius: cs.borderTopLeftRadius,
        glyph: svg ? getComputedStyle(svg).color : null,
        glyphHidden: svg ? svg.getAttribute('aria-hidden') : null,
        glyphRects: svg ? svg.getClientRects().length : 0
      };
    };
    const out = {
      heroTitle: heroTitle ? heroTitle.textContent.trim() : null,
      shareLine: shareLine ? shareLine.textContent.replace(/\\s+/g, ' ').trim() : null,
      figures: Array.from(document.querySelectorAll('.pipe-date')).map((n) => n.textContent.trim()),
      pills: Array.from(document.querySelectorAll('.pipe-row .pill')).map((n) => n.textContent.replace(/\\s+/g, ' ').trim()),
      plain: plain ? styleOf(plain) : null,
      note: null
    };
    if (note) {
      const box = note.getBoundingClientRect();
      const title = note.querySelector('b');
      const list = note.querySelector('.omit-list');
      out.note = Object.assign(styleOf(note), {
        rects: note.getClientRects().length,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        text: note.textContent.replace(/\\s+/g, ' ').trim(),
        bodyInk: __ink(note),
        titleInk: title ? __ink(title) : null,
        list: list ? (() => {
          const cs = getComputedStyle(list);
          return { display: cs.display, direction: cs.flexDirection, gap: parseFloat(cs.rowGap) || 0, rects: list.getClientRects().length };
        })() : null
      });
    }
    return JSON.stringify(out);
  })()`));
}

/* ============ the note exists on screen, not merely in the DOM =========== */

/* MUTATION for the four tests below: delete the `.callout.is-note` rule block
   in ops/assets/pane-releases-v2.css — the two rules opening at
   `.callout.is-note {` and `.callout.is-note svg {`. The note keeps its class
   and its text, so nothing about the markup changes; it simply draws as the
   amber warning instead, and these fail on the tint, the ring and the glyph. */

test('the omissions note is painted, with its own tint and its own ring', async () => {
  await show(UNREADABLE_1280);
  const page = await readPage();

  assert.ok(page.note, 'the route named an omission and the pane drew nothing');
  /* Rendered before measured: a box with no client rect has no colour worth
     asserting, and getBoundingClientRect() reports 0 just as loudly for a box
     that is not rendered as for one with no extent. */
  assert.equal(page.note.rects, 1, 'the note is in the DOM but not rendered');
  assert.ok(page.note.height > 20, `the note collapsed to ${page.note.height}px`);
  assert.ok(page.note.width > 200, `the note is ${page.note.width}px wide`);

  const tint = page.note.background.match(/[\d.]+/g).map(Number);
  assert.ok(tint[3] > 0, 'the note has no background at all, so nothing marks it out');
  assert.notEqual(page.note.boxShadow, 'none', 'the note has no ring');
});

test('the note does not draw in the warning tint the plain callout uses', async () => {
  await show(UNREADABLE_1280);
  const page = await readPage();

  assert.ok(page.plain, 'no plain .callout on the page to compare against — ' +
    'the comparison has to be against a rendered neighbour, not a typed number');
  assert.notEqual(page.note.background, page.plain.background,
    'the note draws in the same tint as the warning callout. An API with no such ' +
    'field is not a fault and must not look like one.');
  assert.notEqual(page.note.boxShadow, page.plain.boxShadow, 'the note has the warning ring');
  assert.notEqual(page.note.glyph, page.plain.glyph, 'the note has the warning glyph ink');
});

test('the note carries its shape from .callout, not from nothing', async () => {
  await show(UNREADABLE_1280);
  const page = await readPage();

  /* `is-note` only changes the tint and the glyph ink. If the base `.callout`
     stopped applying, the box would lose its padding, its radius and its
     row layout while still passing every colour assertion above. */
  assert.equal(page.note.display, 'flex', 'the note is not laid out as a callout row');
  assert.ok(parseFloat(page.note.padding) > 4, `the note has ${page.note.padding} of padding`);
  assert.ok(parseFloat(page.note.radius) > 2, `the note has ${page.note.radius} corners`);
  assert.equal(page.note.glyphHidden, 'true', 'the glyph is announced, and it says nothing');
  assert.equal(page.note.glyphRects, 1, 'the glyph is not rendered');
});

test('.omit-list is a painted column, so two omissions cannot run together', async () => {
  await show(UNREADABLE_1280);
  const page = await readPage();

  assert.ok(page.note.list, 'the note has no .omit-list');
  assert.equal(page.note.list.rects, 1, '.omit-list is not rendered');
  assert.equal(page.note.list.display, 'flex', '.omit-list is unpainted: it fell back to block');
  assert.equal(page.note.list.direction, 'column');
  assert.ok(page.note.list.gap > 0, '.omit-list has no gap, so stacked entries touch');
});

/* ===================== the note reads at AA in both themes =============== */

/* MUTATION: in ops/assets/pane-releases-v2.css, change `.callout.is-note`'s
   background from `color-mix(in srgb, var(--ink-3) 7%, transparent)` to
   `var(--ink-3)`. The tint becomes the ink and the body copy drops to about
   1.2:1 in both themes. */

for (const state of [UNREADABLE_1280, UNREADABLE_LIGHT]) {
  test(`the note's text clears AA against its own tint — ${state.theme}`, async () => {
    await show(state);
    const page = await readPage();

    assert.ok(page.note.bodyInk.against.startsWith('div.callout.is-note'),
      `the ink was measured against ${page.note.bodyInk.against}, which is not the ` +
      'surface the text is drawn on');
    assert.ok(page.note.bodyInk.ratio >= 4.5,
      `note body copy is ${page.note.bodyInk.ratio}:1 against ${page.note.bodyInk.against}`);
    assert.ok(page.note.titleInk.ratio >= 4.5,
      `note title is ${page.note.titleInk.ratio}:1 against ${page.note.titleInk.against}`);
  });
}

/* ============== what the note says comes from the answer ================= */

/* MUTATION: in ops/assets/pane-releases.js, replace `str(entry.detail) ||` in
   omissionsBlock with `'App Store Connect reports no share.' || ` — a caption
   that is true, reads correctly on screen, and is not the route's sentence.
   This test fails; nothing else does. */

test('the note prints the route\'s own sentence, not a caption held here', async () => {
  await show(UNREADABLE_1280);
  const page = await readPage();

  const sent = unreadableAnswer().omissions[0];
  assert.ok(page.note.text.includes(sent.title), 'the note does not carry the route\'s title');
  assert.ok(page.note.text.includes(sent.detail),
    'the note does not carry the route\'s detail verbatim, so a figure that gains a ' +
    'source would keep being explained by a sentence written into the client');
});

/* ================= and it is gone when nothing is missing ================ */

/* The other arm. Every assertion above is about a page where the route named
   an omission; this is the same page where it did not. Without it, a note
   hard-coded into the pane would pass every test in this file. */

test('no omission in the answer means no note on the page', async () => {
  await show(READABLE_1280);
  const page = await readPage();

  assert.equal(page.note, null, 'the pane drew an omissions note the route did not send');
  assert.ok(page.plain, 'the plain callout should still be there — only the note is conditional');
});

/* ========= the four sentences the missing share used to make false ======= */

/* Until the pane told 'no staged rollout' apart from 'a rollout the store will
   not measure', an absent share read as "no ceiling" in four places at once.
   All four are bound here, each against both arms.

   MUTATION for all four: in ops/assets/pane-releases.js, change
   `var UNREADABLE_SHARE_STATES = { rolling_out: true, halted: true };` to
   `var UNREADABLE_SHARE_STATES = {};`. Every reading collapses back to 'none'
   and all four assertions below fail, which is the state this pane shipped
   in after monorepo #10833 removed the modelled percentage. */

test('the headline does not call an unmeasured phased release live', async () => {
  await show(UNREADABLE_1280);
  const unread = await readPage();
  assert.ok(!/is live on/.test(unread.heroTitle),
    `the headline says "${unread.heroTitle}" over a phased release still on its way out`);

  await show(READABLE_1280);
  const readable = await readPage();
  assert.match(readable.heroTitle, /is live on/,
    'the headline stopped saying "live on" even when both stores are fully out, ' +
    'so the test above would pass on a pane that can never say it');
});

test('the share sentence does not claim no store is capping while one is', async () => {
  await show(UNREADABLE_1280);
  const unread = await readPage();
  assert.ok(!/no store is capping/.test(unread.shareLine),
    `the share sentence says "${unread.shareLine}"`);
  assert.match(unread.shareLine, /cannot be read/,
    'the share sentence does not say the ceiling is unreadable either, so the ' +
    'assertion above would pass on a pane that says nothing at all');

  await show(READABLE_1280);
  const readable = await readPage();
  assert.match(readable.shareLine, /no store is capping/,
    'the pane never says "no store is capping" even with both stores fully out, ' +
    'so the assertion above would pass on a pane that lost the sentence entirely');
});

test('the stage figure names the store that will not report the share', async () => {
  await show(UNREADABLE_1280);
  const unread = await readPage();
  assert.ok(unread.figures.some((f) => /Not reported by the App Store/.test(f)),
    `stage figures were ${JSON.stringify(unread.figures)}`);
  assert.ok(unread.figures.some((f) => /% of devices/.test(f)),
    'the Android figure is gone too, so the iOS one is not distinguishable in kind');

  await show(READABLE_1280);
  const readable = await readPage();
  assert.ok(!readable.figures.some((f) => /Not reported by/.test(f)),
    'a readable share still draws as not reported');
});

test('the end pill does not say Rolled out over a running phased release', async () => {
  await show(UNREADABLE_1280);
  const unread = await readPage();
  assert.ok(!unread.pills.includes('Rolled out'),
    `pipeline pills were ${JSON.stringify(unread.pills)} — "Rolled out" is a claim ` +
    'that the rollout finished, and an unreadable share cannot support it');

  await show(READABLE_1280);
  const readable = await readPage();
  assert.ok(readable.pills.includes('Rolled out'),
    'no row says "Rolled out" even when a rollout has finished, so the assertion ' +
    'above would pass on a pane that can never say it');
});

/* ============================ and at 375 ================================= */

test('the note is still a painted box at 375, not a collapsed one', async () => {
  await show(UNREADABLE_375);
  const page = await readPage();

  assert.ok(page.note, 'no note at 375');
  assert.equal(page.note.rects, 1, 'the note is not rendered at 375');
  assert.ok(page.note.width <= 375, `the note is ${page.note.width}px wide inside 375px`);
  assert.ok(page.note.height > 40, `the note is ${page.note.height}px tall, so it wrapped away`);
  assert.equal(page.note.display, 'flex', 'the note lost its callout layout at 375');
});
