/* Two things on the operations pages that only a laid-out page can answer.

   1. THE "WHAT THIS COUNTS" BUTTON IS A 44px TARGET THAT COSTS NO LAYOUT.

      The info button beside the people figure is a 17px glyph. BUILD-NOTES
      asks every control for a 44px hit area, and a review measured this one at
      22 x 22 in Chromium. The fix is a 44px box with a -11px margin: a thumb
      can find it, and the 22px the glyph has always occupied is what the page
      around it still sees. Three claims, each of which fails for a different
      edit:

        a. The button's box is at least 44 x 44, and the five points that
           matter on it (the centre and four inset corners) all land on the
           button, so a box that is 44px wide on paper but sits under a
           neighbour is not a target.
        b. The glyph did not grow: it is still the 17px it was.
        c. Nothing else on the page moved. The page is measured twice, once as
           drawn and once with the button forced back to 22px and no margin,
           and every other box has to be where it was. A 44px button with no
           margin passes (a) and (b) and fails here.

      The bubble is one of the boxes compared in (c): it hangs off the button's
      wrapper, so a margin that is not the whole of the difference moves it.

   2. THE ACCOUNT MENU'S FRAGMENT LINKS LAND BELOW THE STICKY HEADER.

      settings.html#sessions scrolls the band to the top of the viewport, where
      the sticky top bar sits. A review measured the band's top at -0.4px under
      a header whose bottom was 74px, so the heading was covered. Above 980px
      the bands carry a scroll margin the size of the header; at 980px and
      under the bar is not sticky and they carry none. The jump also puts
      keyboard focus on the band it scrolled to. Both are read off the page
      the way a person arrives: loaded with the fragment, settled, then
      measured at 390px, at 981px (the narrowest sticky bar, and so the
      tallest) and at 1440px.

   Real Chrome over CDP and the stub API, the way the other rendered oracles
   here work. The test needs a Chrome (CHROME_PATH), as they do.

   NOT COVERED:

     - The mouse. Nothing here moves a pointer; a hit test at five points is
       what "a thumb can find it" reduces to without one.
     - A real phone's touch slop. 44px is the number the design contract asks
       for, not a measurement of any finger.
     - Fragments the Settings pane does not draw a band for. It ignores them,
       which is the existing behaviour and is not changed. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_TARGET = 44;
const GLYPH = 17;
const HEIGHT = 900;
const EPS = 0.01;

/* Phone and desktop, both themes' worth of geometry being the same, so one
   theme each is enough for a layout claim; the dark one is the one reviewed. */
const WIDTHS = [390, 1440];
/* The settings top bar turns sticky above 980px, so 981 is the narrowest
   width where the margin matters and where the bar is tallest. */
const ANCHOR_WIDTHS = [390, 981, 1440];

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(stub(url.pathname)));
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

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-hit-area-'));

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

/* A readiness poll needs its own path: a probe that reaches through a null
   while the document is still being replaced is a wait, not a failure. */
async function waitInPage(expression, what) {
  const guarded = `JSON.stringify({ ok: (() => { try { return !!(${expression}); } catch (e) { return false; } })() })`;
  for (let i = 0; i < 300; i++) {
    if ((await evaluate(guarded)).ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + what);
}

let initScript = null;
async function open(url, width) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try { localStorage.setItem('ops-theme', 'dark'); } catch (e) {}" +
      `try { localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});` +
      " sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' })); } catch (e) {}"
  });
  initScript = res.identifier;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 700 });
  /* The fragment alone does not reload a page that is already on the same
     path, so go through about:blank to make each reading a fresh arrival. */
  await cdp.send('Page.navigate', { url: 'about:blank' });
  cdp.reset();
  await cdp.send('Page.navigate', { url: origin + url });
  await cdp.once('Page.loadEventFired');
  await waitInPage("document.body.classList.contains('is-ready')", `${url} to boot at ${width}px`);
}

/* ============================== the info button ========================== */

const TIP = `(() => {
  const btn = document.querySelector('.tip-btn');
  if (!btn) return JSON.stringify({ error: 'no .tip-btn on the page' });
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const r = btn.getBoundingClientRect();
  /* The centre and four points a quarter of the way in along each diagonal:
     all inside the circle, so a miss is something else sitting on the button. */
  const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
    .map(([a, b]) => [r.left + r.width * a, r.top + r.height * b]);
  const hits = points.map(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { x, y, ok: !!el && (el === btn || btn.contains(el)), landed: el ? (el.tagName + '.' + el.className) : null };
  });
  const svg = btn.querySelector('svg');
  const others = () => [...document.querySelectorAll('#content *')]
    .filter((el) => !btn.contains(el) && el !== btn)
    .map((el) => Object.assign({ at: el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') || '') }, box(el)));
  const before = others();
  const style = document.createElement('style');
  style.textContent = '.tip-btn { width: 22px !important; height: 22px !important; margin: 0 !important; }';
  document.head.appendChild(style);
  const after = others();
  const wrapper = box(btn.parentElement);
  style.remove();
  return JSON.stringify({
    btn: box(btn), svg: svg ? box(svg) : null, wrapper,
    hits, before, after,
    viewport: document.documentElement.clientWidth
  });
})()`;

for (const width of WIDTHS) {
  test(`the info button is a 44px target that moves nothing, at ${width}px`, async () => {
    await open('/ops/index.html', width);
    await waitInPage("document.querySelector('.tip-btn')", 'the info button to draw');
    await new Promise((r) => setTimeout(r, 250));
    const read = await evaluate(TIP);
    assert.equal(read.error, undefined, read.error);
    assert.equal(read.viewport, width, `asked for ${width}px and the document reports ${read.viewport}px`);

    assert.ok(read.btn.w >= MIN_TARGET && read.btn.h >= MIN_TARGET,
      `the button measures ${read.btn.w} x ${read.btn.h}, under ${MIN_TARGET} x ${MIN_TARGET}`);
    for (const hit of read.hits) {
      assert.ok(hit.ok, `the point (${hit.x}, ${hit.y}) on the button lands on ${hit.landed}, not on the button`);
    }

    assert.ok(read.svg, 'the button has no glyph');
    assert.ok(Math.abs(read.svg.w - GLYPH) < EPS && Math.abs(read.svg.h - GLYPH) < EPS,
      `the glyph measures ${read.svg.w} x ${read.svg.h}; it was ${GLYPH} x ${GLYPH} and the hit area must not enlarge it`);

    assert.equal(read.before.length, read.after.length, 'forcing the old size changed how many boxes the page has');
    assert.ok(read.before.length > 40, `only ${read.before.length} boxes were compared, so the page did not draw`);
    const moved = [];
    for (let i = 0; i < read.before.length; i += 1) {
      const a = read.before[i];
      const b = read.after[i];
      if (['x', 'y', 'w', 'h'].some((k) => Math.abs(a[k] - b[k]) > EPS)) {
        moved.push(`${a.at} was at (${a.x}, ${a.y}) ${a.w} x ${a.h} and would be at (${b.x}, ${b.y}) ${b.w} x ${b.h}`);
      }
    }
    assert.deepEqual(moved.slice(0, 5), [], 'the bigger hit area moved the settled layout');
    assert.ok(Math.abs(read.wrapper.w - 22) < EPS && Math.abs(read.wrapper.h - 22) < EPS,
      `the button's wrapper is ${read.wrapper.w} x ${read.wrapper.h}; the layout should still see 22 x 22`);
  });
}

/* ========================== the account menu's anchors =================== */

const ANCHOR = (id) => `(() => {
  const band = document.getElementById(${JSON.stringify(id)});
  const bar = document.getElementById('topbar') || document.querySelector('.topbar');
  if (!band) return JSON.stringify({ error: 'no band with id ${id}' });
  if (!bar) return JSON.stringify({ error: 'no top bar' });
  const active = document.activeElement;
  return JSON.stringify({
    bandTop: band.getBoundingClientRect().top,
    barBottom: bar.getBoundingClientRect().bottom,
    barPosition: getComputedStyle(bar).position,
    scrollY: window.scrollY,
    activeId: active ? active.id : null,
    viewport: document.documentElement.clientWidth
  });
})()`;

for (const width of ANCHOR_WIDTHS) {
  for (const id of ['administrators', 'sessions', 'audit']) {
    test(`settings.html#${id} lands the band below the sticky header and focuses it, at ${width}px`, async () => {
      await open('/ops/settings.html#' + id, width);
      await waitInPage(`document.getElementById('${id}')`, `the ${id} band to draw`);
      /* The jump happens on the first draw that has the band; let it, and the
         smooth-scroll the browser may have started, finish. */
      await new Promise((r) => setTimeout(r, 600));
      const read = await evaluate(ANCHOR(id));
      assert.equal(read.error, undefined, read.error);
      assert.equal(read.viewport, width);
      /* Above 980px the bar is sticky and covers what it overlaps; under it
         the bar scrolls away and only the viewport's own edge is in the way. */
      assert.equal(read.barPosition, width > 980 ? 'sticky' : 'static',
        `the top bar is ${read.barPosition} at ${width}px, so this measurement is of a different layout`);
      const clear = read.barPosition === 'sticky' ? read.barBottom : 0;
      assert.ok(read.bandTop >= clear - 0.5,
        `the ${id} band's top is ${read.bandTop}px, under the ${clear}px the header covers`);
      if (read.barPosition === 'static') {
        assert.ok(read.bandTop <= 4,
          `the ${id} band's top is ${read.bandTop}px with no bar in the way, a gap the jump should not leave`);
      }
      assert.equal(read.activeId, id, `focus is on "${read.activeId}", not on the band the link named`);
      if (id !== 'administrators') {
        assert.ok(read.scrollY > 0, `the page did not scroll to ${id}, so where it landed proves nothing`);
      }
    });
  }
}
