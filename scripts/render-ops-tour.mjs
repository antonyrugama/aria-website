/* Renders the guided tour on every pane, in both themes, at a desktop width
   and a phone width, and writes the pictures to .probe/tour-render/ with an
   index.md that says what each one shows.

   This is VISUAL PROOF, not a guard. It asserts nothing about what the
   pictures contain beyond the tour having opened and pointed at something on
   screen; a person reads the images. It exists because
   scripts/ops-tour-dialog.test.mjs drives the tour through a hand-written DOM
   and says in its own NOT COVERED that layout and paint are outside it, and
   no browser check opens the tour. Stadiora/Aria#12255 asks for one batch
   render on CI in dark and light, narrow and wide, rather than screenshots
   taken on a developer machine, so .github/workflows/ops-tour-render.yml runs
   this on dispatch and uploads the directory as an artifact.

   What each picture is:

     <pane>-<theme>-<width>-<NN>.png
       Every step of the pane's guide, NN counting from 01. The pane page is
       loaded with the theme stored the way theme.js reads it, the guide is
       opened through its real entry point -- the "What am I looking at?"
       button, .tour-entry, pressed with a real pointer click at its centre,
       which fails the load if anything covers it -- and each step is
       photographed before Next is pressed. A step whose anchor the page did
       not draw is photographed too: what the tour says then is part of what
       it does. A load that photographs fewer steps than the tour declares
       for the pane (window.OpsTour.stepsFor) fails.

     <pane>-tour-<theme>-<width>.png
       The whole-dashboard tour opened from the rail's "Take the tour"
       button on the first registry pane, which is where it starts.

     tour-rail-<theme>-<width>.png
       The rail's "Take the tour" block on the first registry pane. On the
       phone width the rail is a drawer, so it is opened through its own
       toggle first. The block's box is checked; nothing here hit-tests it.

   The pane list is read out of ops/assets/pane-registry.js, executed in a vm
   the way scripts/check-ops-narrow-overflow.mjs reads it, so a pane added
   there is rendered here with no edit to this file.

   The API is scripts/ops-api-stub.mjs, the substrate the other browser checks
   stand on, with one exception taken from scripts/ops-tour-harness.mjs:
   /api/ops/usage is answered with that harness's usagePayload() rather than
   the stub's empty envelope, because the empty envelope draws none of the
   figures the People and usage steps point at. It is the same answer the
   tour's own tests use.

   A page load that fails is written to index.md as FAILED with the reason,
   the run carries on, and the process exits 1 at the end if any did. A run
   that attempted fewer page loads than it planned is a failure as well.

   Usage:  node scripts/render-ops-tour.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { stub } from './ops-api-stub.mjs';
import { usagePayload } from './ops-tour-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'ops/assets/pane-registry.js';
const OUT = path.join(ROOT, '.probe', 'tour-render');
const THEMES = ['dark', 'light'];
const WIDTHS = [
  { name: 'wide', width: 1440, height: 900, mobile: false },
  { name: 'narrow', width: 375, height: 812, mobile: true },
];

/* How long a pane is given after its ready gate to finish its reads and lay
   itself out, as scripts/check-ops-narrow-overflow.mjs gives it. Every read
   is against the stub on loopback. */
const SETTLE_MS = 2500;
/* After the tour scrolls its anchor into view, or the drawer opens, before
   the picture is taken. Motion is already forced off by the launch flags. */
const PAINT_MS = 400;
/* One capture that hangs must not take the rest of the run with it. */
const CAPTURE_TIMEOUT_MS = 180000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------- the panes */

/* The pane list, out of the registry rather than out of a second copy of it
   here, exactly as scripts/check-ops-narrow-overflow.mjs reads it. */
function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: REGISTRY });
  const registry = sandbox.window.OpsPaneRegistry;
  if (!registry || !registry.PANES) {
    throw new Error(`${REGISTRY} defined no window.OpsPaneRegistry.PANES`);
  }
  return registry.PANES;
}

const DECLARED = readRegistry();
const PANES = Object.keys(DECLARED).map((key) => ({
  key,
  label: DECLARED[key].label,
  url: '/ops/' + DECLARED[key].file,
}));

/* ---------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    const body = url.pathname === '/api/ops/usage'
      ? { data: usagePayload() }
      : stub(url.pathname, url.search);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
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

/* ------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let next = 1;
    const waiting = new Map();
    socket.onopen = () => resolve({
      send(method, params) {
        const id = next++;
        socket.send(JSON.stringify({ id, method, params: params || {} }));
        return new Promise((ok, no) => waiting.set(id, { ok, no }));
      },
      close: () => socket.close(),
    });
    socket.onerror = reject;
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !waiting.has(msg.id)) return;
      const { ok, no } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) no(new Error(msg.error.message));
      else ok(msg.result);
    };
  });
}

/* Chrome has to be GONE before its profile is deleted; see
   scripts/check-ops-dialog-hit.mjs and scripts/check-ops-theme-redraw.mjs,
   which this copies, and the .gitignore entry for the interrupted run. */
const KILL_GRACE_MS = 5000;
const STARTUP_TRIES = 300;
const STARTUP_POLL_MS = 100;
const PROFILE_RM_TRIES = 50;
const PROFILE_RM_DELAY_MS = 200;

function exitsWithin(child, ms) {
  return new Promise((resolve) => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(false); }, ms);
    child.once('exit', onExit);
  });
}

async function stopBrowser(child) {
  const gone = () => child.exitCode !== null || child.signalCode !== null;
  if (gone()) return true;
  const terminated = exitsWithin(child, KILL_GRACE_MS);
  child.kill();
  if (await terminated) return true;
  if (gone()) return true;
  const killed = exitsWithin(child, KILL_GRACE_MS);
  child.kill('SIGKILL');
  return (await killed) || gone();
}

async function removeProfile(dir) {
  let last = null;
  for (let i = 0; i < PROFILE_RM_TRIES; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return true;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, PROFILE_RM_DELAY_MS));
    }
  }
  if (last && last.code !== 'ENOENT') throw last;
  return true;
}

async function launch() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(ROOT, '.ops-tour-render-'));
  const child = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-prefers-reduced-motion',
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < STARTUP_TRIES; i += 1) {
    await new Promise((r) => setTimeout(r, STARTUP_POLL_MS));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      return { child, dir, port, wsUrl: info.webSocketDebuggerUrl };
    } catch (e) { /* not listening yet */ }
  }
  await stopBrowser(child);
  await removeProfile(dir);
  throw new Error('Chrome did not start');
}

async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description
      || res.exceptionDetails.text || 'evaluation failed');
  }
  return res.result.value;
}

/* Polls from Node in short evaluations rather than one long one, for the
   reason scripts/check-ops-dialog-hit.mjs gives: a long evaluation issued
   before a navigation commits is torn down with the old context. */
const POLL_MS = 50;
const POLL_TRIES = 200;

async function waitFor(cdp, expression) {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch (err) {
      if (!/navigated or closed|Cannot find context/i.test(String(err.message))) throw err;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ the render */

/* A fresh tab per picture, as scripts/check-ops-dialog-hit.mjs opens one per
   measurement: the viewport, the emulated colour scheme and the seeded
   storage are all per tab. Runs `work(tab)` and always closes the tab. */
async function inTab(chrome, work) {
  const browser = await connect(chrome.wsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
  const entry = list.find((t) => t.id === targetId);
  const tab = await connect(entry.webSocketDebuggerUrl);
  try {
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    return await work(tab);
  } finally {
    tab.close();
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    browser.close();
  }
}

/* Loads one pane page at one width in one theme and waits until it is laid
   out. Throws with the reason when it never gets there, which the caller
   writes into index.md.

   The theme is stored the way theme.js reads it, and the colour scheme is
   emulated to the OPPOSITE, as scripts/check-ops-contrast.mjs does, so a
   storage write that silently failed shows up as the wrong theme rather than
   as the right one by accident. The tour's progress key is cleared before the
   page runs: storage is shared across tabs, and a guide left open by the
   previous picture would otherwise reopen itself on load and the entry point
   would never be pressed. */
async function loadPane(tab, origin, pane, theme, size) {
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.mobile,
  });
  await tab.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }],
  });
  await tab.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'try {'
      + `localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});`
      + `localStorage.setItem('ops-theme', ${JSON.stringify(theme)});`
      + "localStorage.removeItem('ops-tour-progress');"
      /* session.js records every refresh token it presents and refuses to
         present one again once that record is old, which is right for a real
         credential. Every page load here presents the same stub token, so after
         a load that takes more than a few seconds -- stepping through a guide --
         the next page would sign itself out. */
      + "localStorage.removeItem('ops-spent');"
      + "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));"
      + '} catch (e) {}',
  });
  await tab.send('Page.navigate', { url: origin + pane.url });

  const ready = await waitFor(tab, `(() => {
    const entry = document.querySelector('.tour-entry');
    return !!(entry && entry.getClientRects().length);
  })()`);
  if (!ready) {
    const where = await evaluate(tab, 'location.pathname').catch(() => '(unreadable)');
    throw new Error(`the "What am I looking at?" button never appeared on screen (page ${where})`);
  }
  await sleep(SETTLE_MS);
  await evaluate(tab, 'document.fonts ? document.fonts.ready.then(() => true) : true');

  const seen = await evaluate(tab, `({
    pane: document.body.getAttribute('data-pane'),
    theme: document.documentElement.getAttribute('data-theme'),
    width: window.innerWidth,
  })`);
  if (seen.pane !== pane.key) {
    throw new Error(`the page says it is pane "${seen.pane}", not "${pane.key}"`);
  }
  if (seen.theme !== theme) {
    throw new Error(`asked for the ${theme} theme and the page applied ${seen.theme}`);
  }
  if (seen.width !== size.width) {
    throw new Error(`asked for a ${size.width}px viewport and the page reports ${seen.width}px`);
  }
}

async function capture(tab, file) {
  const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64'));
}

/* Presses an element with the mouse rather than with element.click(), so the
   press goes wherever the browser's own hit test sends it. Refuses when the
   element's centre is covered by something else, which would otherwise be a
   click that lands on the cover and a picture of a tour that never opened. */
async function pointerClick(tab, selector) {
  const at = await evaluate(tab, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reaches: !!hit && (hit === el || el.contains(hit)) };
  })()`);
  if (!at) throw new Error(`${selector} is not on the page to be pressed`);
  if (!at.reaches) throw new Error(`${selector} is covered at its centre, so a pointer cannot press it`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await tab.send('Input.dispatchMouseEvent', {
      type, x: at.x, y: at.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
    });
  }
}

/* Where the tour dialog stands: its step title and kicker, whether the
   outlined anchor is inside the viewport, and what the forward button says.
   Next is pressed only while it reads exactly "Next": on the last step of the
   guide it reads "Done" and closes the dialog. */
const TOUR_STATE = `(() => {
  const box = document.querySelector('.tour-modal');
  if (!box) return null;
  const text = (sel) => {
    const n = box.querySelector(sel);
    return n ? n.textContent.replace(/\\s+/g, ' ').trim() : '';
  };
  const anchor = document.querySelector('[data-tour-anchor]');
  let onScreen = false;
  if (anchor && anchor.getClientRects().length) {
    const r = anchor.getBoundingClientRect();
    onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
      && r.top < window.innerHeight && r.left < window.innerWidth;
  }
  const next = box.querySelector('.btn-primary');
  return {
    title: text('.tour-title'),
    kicker: text('.tour-kicker'),
    anchored: !!anchor,
    onScreen,
    next: next ? next.textContent.trim() : '',
  };
})()`;

/* One pane, one theme, one width: open the guide from its entry point and
   photograph every step. Returns one record per picture. */
async function renderPane(tab, origin, pane, theme, size, base) {
  await loadPane(tab, origin, pane, theme, size);

  const declared = await evaluate(tab,
    `window.OpsTour ? window.OpsTour.stepsFor(${JSON.stringify(pane.key)}).length : 0`);
  if (!declared) throw new Error('the tour declares no steps for this pane');

  await pointerClick(tab, '.tour-entry');
  const opened = await waitFor(tab, `(() => {
    const d = document.querySelector('.tour-modal');
    return !!(d && d.getClientRects().length && d.querySelector('.tour-title'));
  })()`);
  if (!opened) throw new Error('pressing "What am I looking at?" (.tour-entry) opened no tour dialog');

  const shots = [];
  for (;;) {
    await sleep(PAINT_MS);
    const state = await evaluate(tab, TOUR_STATE);
    if (!state) throw new Error(`the tour dialog closed after ${shots.length} of ${declared} steps`);
    const file = `${base}-${String(shots.length + 1).padStart(2, '0')}.png`;
    await capture(tab, file);
    shots.push({ file, step: state });
    if (state.next !== 'Next') break;
    if (shots.length >= declared) {
      throw new Error(`the guide still offers Next after all ${declared} declared steps`);
    }
    await evaluate(tab, "document.querySelector('.tour-modal .btn-primary').click()");
  }
  if (shots.length !== declared) {
    throw new Error(`photographed ${shots.length} steps; the tour declares ${declared}`);
  }
  return shots;
}

/* The whole-dashboard tour, opened from the rail's "Take the tour" button on
   the pane it starts from. The button is pressed through the DOM rather than
   the pointer: on a phone it sits in the closed drawer, and the tour closes
   the drawer itself when it opens. */
async function renderTourMode(tab, origin, pane, theme, size, file) {
  await loadPane(tab, origin, pane, theme, size);
  const pressed = await evaluate(tab, `(() => {
    const start = document.querySelector('.tour-rail .tour-start');
    if (!start) return false;
    start.click();
    return true;
  })()`);
  if (!pressed) throw new Error('the rail carries no "Take the tour" button (.tour-rail .tour-start)');
  const opened = await waitFor(tab, `(() => {
    const d = document.querySelector('.tour-modal');
    return !!(d && d.getClientRects().length && d.querySelector('.tour-title'));
  })()`);
  if (!opened) throw new Error('pressing "Take the tour" opened no tour dialog');
  await sleep(PAINT_MS);
  const state = await evaluate(tab, TOUR_STATE);
  await capture(tab, file);
  return [{ file, step: state }];
}

/* The rail's "Take the tour" block, on the first registry pane. On a phone
   the rail is a drawer, opened through its own toggle as a person opens it. */
async function renderRail(tab, origin, pane, theme, size, file) {
  await loadPane(tab, origin, pane, theme, size);

  const drawer = await evaluate(tab, `(() => {
    const toggle = document.getElementById('railToggle');
    return !!(toggle && toggle.getClientRects().length);
  })()`);
  if (drawer) {
    await evaluate(tab, "document.getElementById('railToggle').click()");
    const open = await waitFor(tab, `(() => {
      const rail = document.getElementById('rail');
      return !!(rail && rail.classList.contains('is-open'));
    })()`);
    if (!open) throw new Error('pressing the rail toggle (#railToggle) did not open the drawer');
  }

  const found = await evaluate(tab, `(() => {
    const block = document.querySelector('.tour-rail');
    if (!block) return 'the rail carries no .tour-rail block';
    const start = block.querySelector('.tour-start');
    if (!start) return 'the .tour-rail block carries no .tour-start button';
    block.scrollIntoView({ block: 'center' });
    return '';
  })()`);
  if (found) throw new Error(found);
  await sleep(PAINT_MS);

  const seen = await evaluate(tab, `(() => {
    const block = document.querySelector('.tour-rail');
    const r = block.getBoundingClientRect();
    return {
      label: block.querySelector('.tour-start').textContent.trim(),
      inside: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0
        && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      box: [r.left, r.top, r.width, r.height].map(Math.round).join(', '),
    };
  })()`);
  if (!seen.inside) {
    throw new Error(`the "Take the tour" block is not wholly inside the ${size.width}x${size.height} `
      + `viewport after scrolling to it (left, top, width, height: ${seen.box})`);
  }
  await capture(tab, file);
  return [{ file, step: { title: `rail block, button reads "${seen.label}"`, kicker: '' } }];
}

function withTimeout(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------- run */

const rows = [];
/* Page loads, not pictures: how many steps a pane has is the tour's to say,
   and each load checks its own count against window.OpsTour.stepsFor. */
const planned = PANES.length * THEMES.length * WIDTHS.length + 2 * THEMES.length * WIDTHS.length;
let attempted = 0;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const port = await new Promise((r) => server.listen(0, '127.0.0.1', function () {
  r(this.address().port);
}));
const origin = `http://127.0.0.1:${port}`;
const chrome = await launch();

async function one(pane, theme, size, file, render) {
  const where = `${file} (${pane.key}, ${theme}, ${size.name})`;
  attempted += 1;
  try {
    const shots = await withTimeout(
      inTab(chrome, (tab) => render(tab, origin, pane, theme, size, file)),
      CAPTURE_TIMEOUT_MS, where);
    for (const shot of shots) {
      rows.push({ file: shot.file, pane, theme, size, step: shot.step, error: null });
      console.log(`ok    ${shot.file}: ${shot.step.title}`);
    }
  } catch (err) {
    rows.push({ file, pane, theme, size, step: null, error: String(err && err.message || err) });
    console.error(`FAIL  ${where}: ${err && err.message || err}`);
  }
}

try {
  for (const pane of PANES) {
    for (const theme of THEMES) {
      for (const size of WIDTHS) {
        await one(pane, theme, size, `${pane.key}-${theme}-${size.name}`, renderPane);
      }
    }
  }
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      await one(PANES[0], theme, size, `${PANES[0].key}-tour-${theme}-${size.name}.png`, renderTourMode);
      await one(PANES[0], theme, size, `tour-rail-${theme}-${size.name}.png`, renderRail);
    }
  }
} finally {
  const stopped = await stopBrowser(chrome.child);
  try {
    await removeProfile(chrome.dir);
  } catch {
    if (!stopped) console.warn(`warn  Chrome did not exit, so ${chrome.dir} may survive.`);
  }
  server.close();
}

/* ------------------------------------------------------------- the index */

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const failed = rows.filter((r) => r.error);
const lines = [
  '# Guided tour render',
  '',
  `Commit: ${process.env.RENDER_HEAD_SHA || process.env.GITHUB_SHA || '(not recorded)'}`,
  `Rendered: ${new Date().toISOString()}`,
  `Pictures: ${rows.length - failed.length} captured; page loads: ${attempted} of ${planned} `
    + `planned, ${failed.length} failed.`,
  '',
  'Each pane has one picture per step of its guide, opened from "What am I looking at?". '
    + '"On screen" says whether the step\'s outlined anchor is inside the viewport; "not drawn" '
    + 'means the page drew no anchor and the step explains why. Wide is 1440x900, narrow is '
    + '375x812. Written by scripts/render-ops-tour.mjs.',
  '',
  '| File | Pane | Theme | Width | Step | Result |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.error ? cell(r.file) : `[${cell(r.file)}](${r.file})`} `
    + `| ${cell(`${r.pane.label} (${r.pane.key})`)} | ${r.theme} `
    + `| ${r.size.name} ${r.size.width}x${r.size.height} `
    + `| ${r.step ? cell(r.step.title + (r.step.kicker ? ` (${r.step.kicker})` : '')
      + ('anchored' in r.step ? (r.step.onScreen ? ', on screen' : r.step.anchored ? ', off screen' : ', not drawn') : '')) : ''} `
    + `| ${r.error ? `FAILED: ${cell(r.error)}` : 'ok'} |`),
  '',
];
fs.writeFileSync(path.join(OUT, 'index.md'), lines.join('\n'));
console.log(`\nwrote ${path.relative(ROOT, path.join(OUT, 'index.md'))}: `
  + `${rows.length - failed.length} pictures from ${attempted} of ${planned} page loads`);

if (failed.length || attempted !== planned) {
  if (attempted !== planned) {
    console.error(`FAIL  ${attempted} of ${planned} planned page loads were attempted.`);
  }
  process.exit(1);
}
