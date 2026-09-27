/* Guards the dashboard's confirmation dialogs against the one failure that
   leaves them fully present in the DOM and unusable on screen: painting behind
   the scrim that is meant to sit behind THEM.

   This is the shape of Stadiora/Aria#10688. The revoke dialog on the Settings
   pane -- the pane's only destructive control -- was declared at z-index 60
   under a scrim at 90, so `document.elementFromPoint` over its confirm button
   returned the scrim and a real mouse click never landed. Every unit test
   passed: the element existed, carried its role, trapped focus and submitted
   from the keyboard. Nothing that reads the DOM can see this.

   Two independent assertions per dialog, because either one alone has a blind
   spot:

     1. POINTER. Every interactive control in the dialog is hit-tested at five
        points -- its centre and four inset corners -- and must return itself
        or a descendant. Corners as well as centre, because an overlay covering
        part of a control leaves the centre reachable and the control still
        half-dead.

     2. PAINT. The dialog is screenshotted, the scrim is removed from the DOM,
        and it is screenshotted again. Almost all of the dialog's pixels must
        be unchanged -- see PAINT_COVERAGE_LIMIT below for why the comparison
        is a coverage threshold rather than byte equality, and for the two
        measured populations the threshold sits between. A scrim carrying
        `pointer-events: none` would pass the hit test while still painting
        62% dim and a 2px blur over the dialog, and the pointer assertion
        could never see it.

   Neither assertion compares z-index values. Stacking is resolved from the
   whole ancestor chain, so two numbers agree with each other whatever a
   containing block between them does; the browser's own answer is the only
   one worth asserting. For the same reason the check also reports which
   ancestors create the stacking contexts involved, so a failure says where to
   look instead of inviting the next person to raise a number until it works.

   The sweep fails rather than skips when it finds nothing to measure: a green
   run having opened zero dialogs is the false green this file exists to
   remove.

   Usage:  node scripts/check-ops-dialog-hit.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { stub } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['dark', 'light'];

/* Every dialog this dashboard can open, with the click that opens it and the
   control that confirms it. A dialog added to a pane and not listed here is
   unmeasured, which is why COUNTS below asserts the total rather than trusting
   this list to stay complete on its own. */
const DIALOGS = [
  {
    name: 'Settings / revoke access',
    page: '/ops/settings.html',
    open: 'button[aria-label^="Revoke access for"]',
    dialog: 'form.modal',
    confirm: 'button.btn-danger',
  },
];

/* The number of dialog measurements a complete run performs. Stated here so
   that a dialog silently failing to open, or a page that stops drawing its
   trigger, fails loudly instead of shrinking the sweep to nothing. */
const COUNTS = { dialogs: DIALOGS.length, measurements: DIALOGS.length * THEMES.length };

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
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

/* Chrome has to be GONE before its profile is deleted: kill() sends SIGTERM and
   returns, and Chrome rewrites Default and Local State while it shuts down --
   after an immediate rmSync has already succeeded, leaving one profile per run
   behind forever on a developer machine. scripts/check-ops-theme-redraw.mjs
   carries the long version of this note and the .gitignore entry that covers
   the run interrupted before it gets here. */
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
  const dir = fs.mkdtempSync(path.join(ROOT, '.ops-dialog-hit-'));
  const child = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-prefers-reduced-motion',
    '--window-size=1280,900', 'about:blank',
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

/* --------------------------------------------------------------- the sweep */

const failures = [];
const notes = [];
let measured = 0;
let dialogsOpened = 0;
let controlsHit = 0;

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

/* Polls from Node in short evaluations rather than looping inside one long
   one. A single ten-second evaluation issued before the navigation commits is
   rejected outright -- `Inspected target navigated or closed` -- when the old
   execution context is torn down under it, so the guard crashed instead of
   reporting whatever it was waiting for. Which failure that hid depended on
   timing: it only showed up on the run where the thing never arrived, which is
   precisely the run whose message matters. */
const POLL_MS = 50;
const POLL_TRIES = 200;

async function waitFor(cdp, expression) {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch (err) {
      /* The context went away mid-navigation; the next poll runs in the new
         one. Anything else is a real fault and is raised. */
      if (!/navigated or closed|Cannot find context/i.test(String(err.message))) throw err;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

/* The dialog is centred with a translate, so its border box lands on
   fractional coordinates. A clip rounded outward would take a sliver of the
   page OUTSIDE the dialog -- which is the scrim -- and report every dialog as
   painting behind its scrim whatever its z-index. Round inward and inset a
   further pixel, so the comparison is over the dialog's own pixels only. */
const CLIP_INSET = 1;


/* Two screenshots of the same dialog are never byte-identical: removing the
   scrim removes a composited layer, and Chrome re-rasterises the text under it
   with different antialiasing. Measured on this dialog, that noise touches 142
   of 130,530 pixels in dark and 159 in light -- about 0.12% -- with a mean
   channel delta of 0.01 and 0.08.

   A scrim painting OVER the dialog is a different order of thing entirely:
   with the defect reinstated (z-index 60) the same comparison reports 127,490
   of 130,530 pixels changed in dark (97.7%, mean 17.6) and 130,517 in light
   (99.99%, mean 87.3). An alpha overlay covers the whole dialog; antialiasing
   traces glyph edges.

   The noise is smaller on the runner than on a laptop, not larger, so the
   threshold is not marginal where it matters: ubuntu-latest reports 0.08% and
   0.10% for the same two measurements macOS reports 0.11% and 0.12% for.

   So the assertion is COVERAGE, not identity, and its threshold sits between
   two measured populations rather than being chosen hopefully: 5% is 40 times
   the observed noise and 19 times below the observed defect. The per-pixel
   delta of 2 is the same idea one level down -- it ignores a single unit of
   rounding without ignoring anything an overlay does. */
const PAINT_PIXEL_DELTA = 2;
const PAINT_COVERAGE_LIMIT = 0.05;

async function paintDelta(cdp, a, b) {
  return evaluate(cdp, `(async () => {
    const load = (d) => new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('the screenshot did not decode'));
      img.src = 'data:image/png;base64,' + d;
    });
    const pixels = async (d) => {
      const img = await load(d);
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const one = await pixels(${JSON.stringify(a)});
    const two = await pixels(${JSON.stringify(b)});
    if (one.length !== two.length) throw new Error('the two screenshots differ in size');
    let changed = 0;
    let sum = 0;
    for (let i = 0; i < one.length; i += 4) {
      const d = Math.max(
        Math.abs(one[i] - two[i]),
        Math.abs(one[i + 1] - two[i + 1]),
        Math.abs(one[i + 2] - two[i + 2])
      );
      if (d > ${PAINT_PIXEL_DELTA}) changed += 1;
      sum += d;
    }
    const total = one.length / 4;
    return { total, changed, coverage: changed / total, mean: sum / total };
  })()`);
}

async function shoot(cdp, box) {
  const left = Math.ceil(box.x) + CLIP_INSET;
  const top = Math.ceil(box.y) + CLIP_INSET;
  const right = Math.floor(box.x + box.width) - CLIP_INSET;
  const bottom = Math.floor(box.y + box.height) - CLIP_INSET;
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: left, y: top, width: right - left, height: bottom - top, scale: 1 },
  });
  return res.data;
}

async function measure(cdp, origin, spec, theme) {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});`
      + `localStorage.setItem('ops-theme', ${JSON.stringify(theme)});`
      + "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));",
  });
  await cdp.send('Page.navigate', { url: origin + spec.page });

  /* Wait for the trigger rather than for a fixed delay: a sleep long enough to
     be safe here would be the slowest thing in the file, and one that is too
     short reports a missing dialog as a stacking failure. */
  const ready = await waitFor(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(spec.open)});
    return !!(el && el.getClientRects().length);
  })()`);
  if (!ready) {
    failures.push(`${spec.name} [${theme}]: the control that opens the dialog `
      + `(${spec.open}) never appeared, so nothing was measured`);
    return;
  }

  await evaluate(cdp, `document.querySelector(${JSON.stringify(spec.open)}).click()`);
  const opened = await waitFor(cdp, `(() => {
    const d = document.querySelector(${JSON.stringify(spec.dialog)});
    return !!(d && d.getClientRects().length);
  })()`);
  if (!opened) {
    failures.push(`${spec.name} [${theme}]: clicking ${spec.open} opened no `
      + `${spec.dialog}, so nothing was measured`);
    return;
  }
  dialogsOpened += 1;
  let broke = false;

  /* ---- 1. pointer ---- */
  const hit = await evaluate(cdp, `(() => {
    const dialog = document.querySelector(${JSON.stringify(spec.dialog)});
    const controls = Array.prototype.slice.call(
      dialog.querySelectorAll('button, input, select, textarea, a[href]')
    ).filter((el) => el.getClientRects().length && !el.disabled);

    const name = (el) => !el ? 'nothing'
      : el.tagName.toLowerCase()
        + (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/).join('.') : '');

    const bad = [];
    let points = 0;
    controls.forEach((el) => {
      const b = el.getBoundingClientRect();
      const inset = Math.min(4, b.width / 4, b.height / 4);
      const spots = [
        ['centre', b.left + b.width / 2, b.top + b.height / 2],
        ['top-left', b.left + inset, b.top + inset],
        ['top-right', b.right - inset, b.top + inset],
        ['bottom-left', b.left + inset, b.bottom - inset],
        ['bottom-right', b.right - inset, b.bottom - inset],
      ];
      spots.forEach(([where, x, y]) => {
        points += 1;
        const got = document.elementFromPoint(x, y);
        if (got !== el && !el.contains(got)) {
          bad.push({ control: name(el), where, got: name(got) });
        }
      });
    });

    /* Where the stacking is decided, so a failure names the element to change
       rather than a number to raise. */
    const context = (el) => {
      const chain = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        const why = [];
        if (s.zIndex !== 'auto' && ['relative', 'absolute', 'fixed', 'sticky'].includes(s.position)) {
          why.push(s.position + ' z-index:' + s.zIndex);
        } else if (s.position === 'fixed' || s.position === 'sticky') why.push(s.position);
        if (s.opacity !== '1') why.push('opacity:' + s.opacity);
        if (s.transform !== 'none') why.push('transform');
        if (s.filter !== 'none') why.push('filter');
        if (s.isolation === 'isolate') why.push('isolation');
        if (s.mixBlendMode !== 'normal') why.push('mix-blend-mode');
        if (why.length) chain.push(name(n) + ' {' + why.join(', ') + '}');
      }
      return chain;
    };

    const scrim = document.querySelector('.scrim');
    const b = dialog.getBoundingClientRect();
    return {
      controls: controls.length,
      points,
      bad,
      dialogContext: context(dialog),
      scrimContext: scrim ? context(scrim) : ['no scrim on the page'],
      box: { x: b.left, y: b.top, width: b.width, height: b.height },
    };
  })()`);

  if (!hit.controls) {
    failures.push(`${spec.name} [${theme}]: the dialog holds no enabled control, `
      + 'so the hit test measured nothing');
    return;
  }
  controlsHit += hit.controls;

  if (hit.bad.length) {
    const worst = hit.bad.slice(0, 4).map((b) => `${b.control} at its ${b.where} is `
      + `covered by ${b.got}`).join('; ');
    failures.push(`${spec.name} [${theme}]: ${hit.bad.length} of ${hit.points} points over `
      + `${hit.controls} controls do not reach the control under them. ${worst}.\n`
      + `      dialog stacking: ${hit.dialogContext.join(' < ') || 'none'}\n`
      + `      scrim stacking:  ${hit.scrimContext.join(' < ') || 'none'}`);
    broke = true;
  }

  /* ---- 2. paint ---- */
  const withScrim = await shoot(cdp, hit.box);
  const removed = await evaluate(cdp, `(() => {
    const s = document.querySelector('.scrim');
    if (!s) return false;
    s.remove();
    return true;
  })()`);
  if (!removed) {
    failures.push(`${spec.name} [${theme}]: the dialog opened without a scrim, so the `
      + 'paint comparison proves nothing and the pane is not making the page inert');
    return;
  }
  const withoutScrim = await shoot(cdp, hit.box);

  const paint = await paintDelta(cdp, withScrim, withoutScrim);
  if (paint.coverage > PAINT_COVERAGE_LIMIT) {
    broke = true;
    failures.push(`${spec.name} [${theme}]: taking the scrim away repainted `
      + `${(paint.coverage * 100).toFixed(1)}% of the pixels inside the dialog `
      + `(mean channel delta ${paint.mean.toFixed(2)}), so the scrim is painting over the `
      + 'dialog rather than behind it. A scrim that does not intercept the pointer can '
      + 'still do this, which is why the hit test above is not enough on its own.\n'
      + `      dialog stacking: ${hit.dialogContext.join(' < ') || 'none'}\n`
      + `      scrim stacking:  ${hit.scrimContext.join(' < ') || 'none'}`);
  }

  measured += 1;
  if (broke) return;
  notes.push(`ok  ${spec.name} [${theme}]: ${hit.points} points over ${hit.controls} `
    + 'controls each reach their own control, and removing the scrim repaints '
    + `${(paint.coverage * 100).toFixed(2)}% of the dialog, so it paints behind it`);
}

/* ------------------------------------------------------------------- run */

const port = await new Promise((r) => server.listen(0, '127.0.0.1', function () {
  r(this.address().port);
}));
const origin = `http://127.0.0.1:${port}`;
const chrome = await launch();

try {
  for (const spec of DIALOGS) {
    for (const theme of THEMES) {
      /* A fresh tab per measurement, so a dialog left open or a seeded
         localStorage from the previous theme cannot carry into the next. */
      const browser = await connect(chrome.wsUrl);
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const list = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
      const entry = list.find((t) => t.id === targetId);
      const tab = await connect(entry.webSocketDebuggerUrl);
      await tab.send('Page.enable');
      await tab.send('Runtime.enable');
      try {
        await measure(tab, origin, spec, theme);
      } finally {
        tab.close();
        await browser.send('Target.closeTarget', { targetId });
        browser.close();
      }
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

if (measured !== COUNTS.measurements) {
  failures.push(`${measured} of ${COUNTS.measurements} dialog measurements completed. `
    + 'A sweep that measures less than it declares is not a passing sweep.');
}
if (dialogsOpened !== COUNTS.measurements) {
  failures.push(`${dialogsOpened} of ${COUNTS.measurements} dialogs opened.`);
}

notes.forEach((n) => console.log(n));
console.log(`\ncounts ${JSON.stringify({
  dialogs: COUNTS.dialogs, themes: THEMES.length, measurements: measured, controlsHit,
})}`);

if (failures.length) {
  console.error('\n' + failures.map((f) => 'FAIL  ' + f).join('\n'));
  process.exit(1);
}
console.log('\nEvery confirmation dialog this dashboard opens receives the pointer over its '
  + 'own controls, and its scrim paints behind it, in both themes.');
