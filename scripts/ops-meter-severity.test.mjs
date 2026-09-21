/* Meter severity, measured as painted pixels rather than declared colours.
 *
 * Stadiora/Aria#10825: `.meter.ok/.warn/.bad/.vio` differed in exactly one
 * declaration, `--c`, so severity was carried by hue and nothing else. A
 * reader who cannot separate those hues -- and roughly one man in twelve
 * cannot separate the amber from the emerald -- receives a bar that means
 * "in trouble" and a bar that means "fine" as the same bar. WCAG 2.2 SC 1.4.1.
 *
 * WHAT THE FIX IS
 *
 * Severity is now also a NOTCH COUNT: ok runs clean, warn carries one notch,
 * bad two, vio three. Notches are grooves cut into the fill's trailing end in
 * the page background colour, drawn as pseudo-element BORDERS because a
 * border is geometry -- `forced-colors` recolours it instead of discarding it.
 *
 * WHAT THIS FILE MEASURES, AND WHY IT IS PIXELS
 *
 * Asserting that aria.css contains a `border-right-width` pins a string, not a
 * notch. Three separate defects found while building this fix were invisible
 * to any source assertion and visible in a screenshot:
 *
 *   1. A notch flush with the fill's trailing edge is not a notch. It just
 *      makes the bar 2px shorter, so `warn` rendered identically to `ok`.
 *   2. The reset in aria.css is `*`, which does not match a pseudo-element,
 *      so these ran as content-box and every offset was 4px out -- landing
 *      `vio`'s third groove exactly on top of its second and rendering `vio`
 *      as `bad`. No pane draws a `vio` meter today, so only a synthetic tone
 *      in a real document can catch that one, and claim 4 is that arm.
 *   3. The first groove colour, `color-mix(var(--c) 30%, var(--bg))`,
 *      measured 2.67:1 against a light-theme `bad` fill. Below 1.4.11, and
 *      no source assertion would ever have said so.
 *
 * So every number here comes from `Page.captureScreenshot` of the meter's own
 * box, decoded, and read along the row through the middle of the bar.
 *
 * A groove is found, never assumed to be at a known offset: the row's MEDIAN
 * luminance is the fill level (grooves are at most 6px of a 120px bar, so the
 * median cannot be one), and a groove is a run of pixels standing clear of
 * that level. The separation is wide and was measured, not picked: the
 * smoothest ungrooved fill varies by 1.10:1 end to end, the weakest real
 * groove clears 4.5:1, and the detection threshold sits at 1.8:1 between them.
 *
 * THE BOX IS THE CLIPPED BOX
 *
 * `.meter` is `overflow: hidden` and `getBoundingClientRect` is blind to
 * clipping -- the lesson of Stadiora/Aria#10706, which cost a wrong reading
 * again while this file was being written. Every box below is the
 * INTERSECTION of the fill's rect and the track's, so a fill reported as
 * 120px wide inside a 20px track is measured as 20px.
 *
 * NOT COVERED
 *
 * - No greyscale arm. It would not be independent evidence: relative
 *   luminance already discards hue, so a greyscale pass measures the same
 *   numbers a second time. The hue-free claim IS claim 5.
 * - Real forced-colors, as opposed to `Emulation.setEmulatedMedia`. Chromium
 *   maps the emulated palette to one fixed high-contrast scheme; a Windows
 *   user's own palette is not driven here.
 * - `.meter-fill`, the v1 spelling, which takes tone classes of its own. It
 *   is styled only in `ops.css`, which no pane loads -- `login.html` and
 *   `setup.html` are its only two pages and neither draws a meter.
 * - Whether three notches remain countable to a reader at arm's length. The
 *   claims here are that they are painted, counted and contrast; legibility
 *   at a distance is a judgement no oracle makes.
 * - A groove displaced onto UNFILLED track. This was claimed and then
 *   withdrawn, because it was measured and the instrument cannot see it.
 *   Pushing the first groove 6px past the fill's trailing edge moves the
 *   bare-track region by 1.21-1.27:1 on the 18 of 96 readings it reaches --
 *   per-reading figures, from comparing a mutated run against a clean one,
 *   not from anything printed below. What IS printed, by `METER_SUMMARY=1`,
 *   is the sweep-wide widest deviation from track level: 1.29:1, and it does
 *   not move when the payload is applied. That single number settles the
 *   withdrawal on its own and settles it harder than the per-reading pair
 *   does: the track's own noise floor, 1.29:1, is ALREADY ABOVE the 1.27:1
 *   the defect produces, so the signal is not merely under this scan's 1.8:1
 *   detect threshold, it is inside the noise. Lowering the threshold to reach
 *   it would key the instrument to the payload. The GEOMETRY regression that
 *   produces a stray groove is bound -- that exact payload is battery row T8,
 *   killed by three notch-count claims -- so what is not covered is the stray
 *   mark itself, not the fault that makes one.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { stub } = await import(path.join(ROOT, 'scripts/ops-api-stub.mjs'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

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
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch { /* browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
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

/* Minimal decoder for the 8-bit images Chromium's screenshots produce.
   Dependency-free on purpose: this repository has no package manager. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }

  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
    } else if (colorType === 4) { r = g = b = out[i * 2]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; }
    data[i * 3] = r; data[i * 3 + 1] = g; data[i * 3 + 2] = b;
  }
  /* A screenshot composited onto the page is opaque; an alpha channel that is
     not 255 would mean the sample is not the painted colour. Chromium returns
     colour type 2 here, so this is a guard on a decode path that could change
     rather than a mechanism this page exercises. */
  if (colorType === 4 || colorType === 6) {
    for (let i = 0, n = width * height; i < n; i++) {
      const a = colorType === 4 ? out[i * 2 + 1] : out[i * 4 + 3];
      if (a !== 255) throw new Error('screenshot pixel is not opaque, so it is not a painted colour');
    }
  }
  return { width, height, data };
}

function relativeLuminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/* ------------------------------------------------------------------ claims */

/* Rank is the contract: how many notches each tone owes. A meter with no tone
   owes none, which is why `ok` and an untoned bar are allowed to look alike --
   neither is reporting a problem. */
const RANK = { ok: 0, warn: 1, bad: 2, vio: 3 };
const TONES = Object.keys(RANK);

/* Between 1.10:1, the widest end-to-end variation an ungrooved gradient fill
   showed, and 4.54:1, the weakest groove any theme produced. Both measured. */
const GROOVE_DETECT = 1.8;

/* WCAG 2.2 SC 1.4.11. The groove is the severity channel, so it is a part of
   a graphic required to understand the content, and it is held to the same
   3:1 an interface component is. */
const GROOVE_CONTRAST = 3;

/* Same threshold, different subject: the filled part of the bar against the
   unfilled part. This is the VALUE, not the severity, and before this fix it
   measured 1:1 under forced-colors because the fill painted nothing at all. */
const VALUE_CONTRAST = 3;

/* In NORMAL rendering the light theme does not reach that, and never has: the
   track is `color-mix(var(--ink) 10%, transparent)` over a near-white card,
   and the fills measure 2.27:1 to 2.81:1 against it. That is a real SC 1.4.11
   shortfall, it predates this change, and it is not what #10825 is about --
   repainting the meter's base appearance would touch every pane for a defect
   this pull request did not introduce. So the normal-mode claim is a RATCHET,
   not an endorsement: it pins today's worst reading so the value cannot get
   quieter while the severity work lands. Filed as Stadiora/Aria#10848.

   The number is literal and sits just under the measured minimum rather than
   on it, because a floor set exactly at the observed value reds on rounding.
   It is NOT computed from the run -- a floor derived from the thing under test
   is the most common false green in this repository. */
const VALUE_RATCHET = 2.2;

/* Trimmed from each end of a sampled row. A bar has an antialiased boundary
   against whatever is behind it, and a ramp pixel is neither fill nor groove.
   The nearest groove sits 4px in, so nothing real is inside this trim. */
const EDGE_TRIM = 2;

/* Literal floors, stated here rather than counted from the run. A floor
   derived from the thing under test cannot fail: a board that rendered no
   meters at all would satisfy "every meter rendered is correct" in silence.
   Measured today: 96 meters, of which 56 carry a tone. */
const METER_FLOOR = 40;
const TONED_FLOOR = 24;
const VALUE_FLOOR = 8;

/* Which severities a REAL pane must be caught drawing, per theme, declared
   rather than counted. The totals above cannot do this job: `RANK.ok` is 0, so
   a board of nothing but `ok` meters clears them with no notch on screen, and a
   payload that deletes every `bad` reading leaves them green while the notch
   claims judge nothing. `vio` is absent on purpose -- no pane draws one today,
   which is why the synthetic arm exists and why it is the only thing that
   caught `vio` rendering identically to `bad`. */
const REQUIRED_REAL = ['warn', 'bad'];

const THEMES = ['dark', 'light'];
const PANES = ['alerts', 'analytics', 'evaluations', 'jobs-live', 'releases',
  'run-history', 'settings', 'spend', 'users'];
const STATES = ['live', 'loading', 'empty', 'degraded'];
const VIEWPORT = { width: 1440, height: 1000 };


/* ------------------------------------------------------------------ server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stub(url.pathname)));
    return;
  }
  const file = path.join(ROOT, url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* Outside the checkout on Actions, inside it on a laptop, same as the other
   browser suites here. A profile written into the checkout is one `git add -A`
   away from being committed by whoever works in the tree next. */
const profile = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || ROOT, '.ops-meter-'));
const browser = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--force-device-scale-factor=1', '--hide-scrollbars',
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, 'about:blank'], { stdio: 'ignore' });

const page = await devtools(await devtoolsPort(profile), '/json/new?about:blank', 'PUT');
const cdp = connect(page.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride',
  { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });

after(async () => {
  try { cdp.close(); } catch {}
  try { browser.kill('SIGKILL'); } catch {}
  try { server.close(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluate failed');
  }
  return r.result.value;
}

await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source:
    `localStorage.setItem('ops-api-base', ${JSON.stringify(origin)});` +
    "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
    'window.__opsReady = false;' +
    "addEventListener('ops:ready', function () { window.__opsReady = true; });"
});

/* A readiness signal, not a sleep. Stadiora/Aria#10775 was filed against this
   author's own earlier sweep for pacing with fixed timeouts, which red
   spuriously when the runner is busy -- and a guard that reds under contention
   fires on somebody else's pull request, about nothing. */
async function navigate(url) {
  await evaluate('window.__opsReady = false').catch(() => {});
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 900; i++) {
    if (await evaluate('window.__opsReady === true').catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`pane never signalled ops:ready: ${url}`);
}

/* The geometry this file measures is the geometry it waits on: poll the meter
   boxes until the same answer comes back three times running. A bar whose
   width is still animating cannot pass this, and no wall-clock guess is made
   about how long that takes. */
async function settleMeters() {
  let last = null, stable = 0;
  for (let i = 0; i < 900; i++) {
    const now = await evaluate(FINGERPRINT);
    if (now === last) { if (++stable >= 3) return now; } else { stable = 0; last = now; }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('meter geometry never settled');
}

const FINGERPRINT = `Array.prototype.map.call(document.querySelectorAll('.meter i'), function (i) {
  var r = i.getBoundingClientRect();
  return Math.round(r.x) + ':' + Math.round(r.width);
}).join('|') + '#' + document.fonts.status`;

/* Every box is the intersection of the fill's rect with the track's, because
   the track is overflow:hidden and a rect does not know that. */
const READ_METERS = `Array.prototype.map.call(document.querySelectorAll('.meter'), function (m) {
  var i = m.querySelector('i');
  if (!i) return null;
  var t = m.getBoundingClientRect(), f = i.getBoundingClientRect();
  var left = Math.max(t.left, f.left), right = Math.min(t.right, f.right);
  var tones = ['ok', 'warn', 'bad', 'vio'].filter(function (c) { return m.classList.contains(c); });
  return {
    tones: tones,
    synthetic: m.classList.contains('severity-probe'),
    trackWidth: t.width,
    fillWidth: f.width,
    visibleFill: Math.max(0, right - left),
    box: { x: t.left, y: t.top, width: t.width, height: t.height }
  };
}).filter(function (m) { return m && m.box.width > 0 && m.box.height > 0; })`;

/* Four tones built in the real document so they take the real cascade. They
   exist because the panes render `ok`, `warn`, `bad` and nothing else -- `vio`
   has a token and a rule and no site, which is precisely where a defect hides
   until a pane starts using it. */
const BUILD_SYNTHETIC = `(function () {
  var old = document.getElementById('severity-probe-host');
  if (old) old.remove();
  var host = document.createElement('div');
  host.id = 'severity-probe-host';
  host.style.position = 'absolute';
  host.style.left = '8px';
  host.style.top = '8px';
  host.style.width = '240px';
  host.style.zIndex = '99999';
  host.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  ['ok', 'warn', 'bad', 'vio'].forEach(function (tone) {
    var m = document.createElement('div');
    m.className = 'meter ' + tone + ' severity-probe';
    m.setAttribute('aria-hidden', 'true');
    m.style.marginBottom = '10px';
    var i = document.createElement('i');
    i.style.width = '160px';
    m.appendChild(i);
    host.appendChild(m);
  });
  document.body.appendChild(host);
  return ['ok', 'warn', 'bad', 'vio'].length;
})()`;

async function shoot(box) {
  const clip = {
    x: Math.round(box.x), y: Math.round(box.y),
    width: Math.round(box.width), height: Math.round(box.height), scale: 1
  };
  const shot = await cdp.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true, clip });
  return decodePNG(Buffer.from(shot.data, 'base64'));
}

const ratioL = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function rowOf(img, from, to) {
  const y = Math.floor(img.height / 2);
  const px = [];
  for (let x = Math.max(0, from); x < Math.min(img.width, to); x++) {
    const i = (y * img.width + x) * 3;
    px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  }
  return px;
}

/* Grooves are located, not looked up. The median of the row is the fill level
   because a groove can never be more than 6px of it; a groove is then a run
   standing clear of that level, and its contrast is judged between the run's
   most extreme pixel -- the groove proper, not the ramp into it -- and the
   fill immediately beside it, taking whichever side reads LOWER. */
function analyseFill(img, visibleFill) {
  return scanRuns(rowOf(img, EDGE_TRIM, visibleFill - EDGE_TRIM), 12);
}

/* The same detector pointed at the UNFILLED part of the track. NOTHING
   ASSERTS ON THIS -- it feeds one `METER_SUMMARY` line and nothing else. It
   was written to bind a claim that a groove never paints past the fill, and
   that claim was withdrawn when the payload proving it measured under this
   detector's own floor. See NOT COVERED in the header. What survives is the
   published sensitivity, which is what makes the withdrawal checkable. */
function analyseStray(img, visibleFill, trackWidth) {
  return scanRuns(rowOf(img, visibleFill + EDGE_TRIM, trackWidth - EDGE_TRIM), 10);
}

function scanRuns(px, floor) {
  if (px.length < floor) return { grooves: [], fillLevel: null, samples: px.length };
  const lums = px.map(relativeLuminance);
  const fillLevel = median(lums);
  const flagged = lums.map((L) => ratioL(L, fillLevel) >= GROOVE_DETECT);

  const grooves = [];
  for (let i = 0; i < flagged.length; i++) {
    if (!flagged[i]) continue;
    let j = i;
    while (j + 1 < flagged.length && flagged[j + 1]) j++;

    let peak = i;
    for (let k = i; k <= j; k++) {
      if (Math.abs(lums[k] - fillLevel) > Math.abs(lums[peak] - fillLevel)) peak = k;
    }
    const near = (from, to) => {
      const vals = [];
      for (let k = from; k <= to; k++) if (k >= 0 && k < lums.length && !flagged[k]) vals.push(lums[k]);
      return vals.length ? median(vals) : null;
    };
    const sides = [near(i - 3, i - 1), near(j + 1, j + 3)].filter((v) => v !== null);
    const ratio = sides.length
      ? Math.min(...sides.map((s) => ratioL(lums[peak], s)))
      : ratioL(lums[peak], fillLevel);

    grooves.push({ start: i + EDGE_TRIM, end: j + EDGE_TRIM, width: j - i + 1, contrast: ratio });
    i = j;
  }
  const peak = lums.length ? Math.max(...lums.map((L) => ratioL(L, fillLevel))) : 1;
  return { grooves, fillLevel, peak, samples: px.length };
}

/* The bar's VALUE: filled part against unfilled part. Separate subject from
   the severity channel, and the one that measured 1:1 under forced-colors
   before this fix, because a gradient and a box-shadow are both discarded
   there and the fill had no background COLOUR underneath them. */
function analyseValue(img, visibleFill, trackWidth) {
  const fill = rowOf(img, EDGE_TRIM, visibleFill - EDGE_TRIM);
  const empty = rowOf(img, visibleFill + EDGE_TRIM, trackWidth - EDGE_TRIM);
  if (fill.length < 6 || empty.length < 6) return null;
  return {
    contrast: ratioL(median(fill.map(relativeLuminance)), median(empty.map(relativeLuminance))),
    emptyWidth: empty.length
  };
}

async function setTheme(theme) {
  await navigate(`${origin}/ops/index.html`);
  await evaluate(`localStorage.setItem('ops-theme', ${JSON.stringify(theme)})`);
}

async function forcedColors(active) {
  await cdp.send('Emulation.setEmulatedMedia',
    { features: [{ name: 'forced-colors', value: active ? 'active' : 'none' }] });
}

async function measurePane(pane, state, theme, { synthetic = false } = {}) {
  const applied = await evaluate(
    `(function () { try { window.Aria.applyState(${JSON.stringify(state)}); return true; }` +
    ' catch (e) { return String(e); } })()');
  assert.equal(applied, true, `${pane}/${state} would not enter the state: ${applied}`);
  if (synthetic) assert.equal(await evaluate(BUILD_SYNTHETIC), 4, 'synthetic tones were not built');
  await settleMeters();

  const meters = await evaluate(READ_METERS);
  const out = [];
  for (const m of meters) {
    /* Only a fill with no width at all is dropped. An 8px bound was here
       first and it skipped exactly the meters the width floor exists to
       catch: a `.meter.bad` drawn at 4% is 6.7px, too narrow for its two
       notches, and being dropped before the floor judged it made a total
       under-count invisible while the same defect 3px wider was caught.
       Nothing on the board is dropped at 1px, so the floor now judges every
       meter that paints. */
    if (m.visibleFill < 1) continue;
    const img = await shoot(m.box);
    const tone = m.tones[0] || null;
    out.push({
      pane, state, theme, tone, tones: m.tones, synthetic: m.synthetic,
      trackWidth: m.trackWidth, fillWidth: m.fillWidth, visibleFill: m.visibleFill,
      ...analyseFill(img, Math.round(m.visibleFill)),
      strayScan: analyseStray(img, Math.round(m.visibleFill), Math.round(m.trackWidth)),
      value: analyseValue(img, Math.round(m.visibleFill), Math.round(m.trackWidth))
    });
  }
  return out;
}

/* ------------------------------------------------------------------- sweep */

const readings = [];
const synthetic = [];
const forced = [];

for (const theme of THEMES) {
  await setTheme(theme);
  for (const pane of PANES) {
    await navigate(`${origin}/ops/${pane}.html`);
    for (const state of STATES) readings.push(...await measurePane(pane, state, theme));
  }

  await navigate(`${origin}/ops/evaluations.html`);
  synthetic.push(...(await measurePane('evaluations', 'live', theme, { synthetic: true }))
    .filter((r) => r.synthetic));

  await forcedColors(true);
  await navigate(`${origin}/ops/evaluations.html`);
  forced.push(...await measurePane('evaluations', 'live', theme, { synthetic: true }));
  await forcedColors(false);
}

const toned = readings.filter((r) => r.tone);

/* ------------------------------------------------------------------- tests */

/* The vocabulary is read out of the sheets rather than trusted from this file.
   If somebody adds `.meter.crit` and gives it a hue, this reds rather than
   quietly declining to measure it -- the shape of defect where a guard stays
   green because it never looked. EVERY sheet under `ops/assets`, not just
   `aria.css`: a tone defined one file over is a tone with no rank just the
   same, and reading a single file would be that defect wearing a guard. */
test('the tone vocabulary this sweep declares is the tone vocabulary the sheets define', () => {
  const sheets = fs.readdirSync(path.join(ROOT, 'ops/assets')).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length >= 10, `only ${sheets.length} stylesheets were read`);
  const found = new Map();
  for (const f of sheets) {
    const css = fs.readFileSync(path.join(ROOT, 'ops/assets', f), 'utf8');
    for (const m of css.matchAll(/\.meter\.([a-z][a-z0-9-]*)/g)) {
      if (!found.has(m[1])) found.set(m[1], f);
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...TONES].sort(),
    `the sheets style meter tones ${[...found].map(([t, f]) => `${t} (${f})`).sort().join(', ')} ` +
    `but this sweep ranks ${[...TONES].sort().join(', ')}; a tone with no rank is a tone ` +
    'nothing here measures');
});

test('the sweep judged a real board of meters, not an empty one', () => {
  assert.ok(readings.length >= METER_FLOOR,
    `judged ${readings.length} meters, below the declared floor of ${METER_FLOOR}; ` +
    'a board that rendered nothing would satisfy every other claim in this file');
  assert.ok(toned.length >= TONED_FLOOR,
    `judged ${toned.length} severity-bearing meters, below the declared floor of ${TONED_FLOOR}`);
  /* See REQUIRED_REAL: a total cannot tell a board of `ok` meters from a
     board carrying severity, and a payload that deleted every `bad` reading
     left both totals above green while the notch claims judged nothing. */
  for (const theme of THEMES) {
    for (const tone of REQUIRED_REAL) {
      assert.ok(toned.some((r) => r.theme === theme && r.tone === tone),
        `no real .meter.${tone} was judged in the ${theme} theme, so every claim ` +
        `about ${RANK[tone]}-notch severity rests on the synthetic arm alone`);
    }
  }
});

test('every meter a pane renders carries exactly the notches its tone declares', () => {
  const wrong = readings
    .map((r) => ({ r, want: r.tone ? RANK[r.tone] : 0 }))
    .filter(({ r, want }) => r.grooves.length !== want);
  assert.deepEqual(wrong.map(({ r, want }) =>
    `${r.theme}/${r.pane}/${r.state} .meter${r.tone ? '.' + r.tone : ''} ` +
    `painted ${r.grooves.length} notches, expected ${want}`), [],
  'severity is carried by hue alone wherever the notch count is wrong');
});

/* The arm that caught the box-sizing collision. `vio` has a token, a rule and
   no site in any pane, so without a synthetic tone in a real document it
   shipped rendering identically to `bad`. */
test('all four tones are separable by notch count alone', () => {
  for (const theme of THEMES) {
    const here = synthetic.filter((r) => r.theme === theme);
    assert.equal(here.length, TONES.length,
      `built ${here.length} synthetic tones in the ${theme} theme, expected ${TONES.length}`);
    const counts = new Map();
    for (const r of here) {
      assert.equal(r.grooves.length, RANK[r.tone],
        `${theme} synthetic .meter.${r.tone} painted ${r.grooves.length} notches, ` +
        `expected ${RANK[r.tone]}`);
      counts.set(r.grooves.length, (counts.get(r.grooves.length) || 0) + 1);
    }
    assert.equal(counts.size, TONES.length,
      `${theme}: the four tones produced only ${counts.size} distinct notch counts, so at ` +
      'least two severities are indistinguishable with hue removed');
  }
});

test('every notch clears 3:1 against the fill it is cut into', () => {
  const all = [...readings, ...synthetic].flatMap((r) =>
    r.grooves.map((g) => ({ r, g })));
  assert.ok(all.length > 0, 'no notch was measured at all, so this claim judged nothing');
  const weak = all.filter(({ g }) => g.contrast < GROOVE_CONTRAST);
  assert.deepEqual(weak.map(({ r, g }) =>
    `${r.theme}/${r.pane} .meter.${r.tone} notch at +${g.start}px measured ` +
    `${g.contrast.toFixed(2)}:1 against its fill`), [],
  `a notch below ${GROOVE_CONTRAST}:1 is a severity channel a reader cannot see (SC 1.4.11)`);
});

/* `overflow: hidden` on the track clips a notch off a short fill rather than
   letting it paint on bare track. That is the conservative direction -- an
   under-count never claims a problem that is not there -- but an under-count
   still misreports, so a severity fill too narrow to hold its own notches is
   a failure here rather than a silent downgrade. */
test('every severity-bearing fill is wide enough for its own notches', () => {
  const needed = (rank) => (rank === 0 ? 0 : 4 * rank + 2 + EDGE_TRIM * 2);
  const cramped = toned.filter((r) => r.visibleFill < needed(RANK[r.tone]));
  assert.deepEqual(cramped.map((r) =>
    `${r.theme}/${r.pane}/${r.state} .meter.${r.tone} has ${r.visibleFill.toFixed(1)}px of ` +
    `visible fill but ${needed(RANK[r.tone])}px are needed for ${RANK[r.tone]} notches`), [],
  'a clipped notch reports a lower severity than the meter was given');
});

test('the bar reports its value, filled against unfilled, in both themes', () => {
  const judged = readings.filter((r) => r.value && r.value.emptyWidth >= 4);
  assert.ok(judged.length >= VALUE_FLOOR,
    `only ${judged.length} meters had enough unfilled track to judge the value against, ` +
    `below the declared floor of ${VALUE_FLOOR}`);
  const weak = judged.filter((r) => r.value.contrast < VALUE_RATCHET);
  assert.deepEqual(weak.map((r) =>
    `${r.theme}/${r.pane}/${r.state} .meter${r.tone ? '.' + r.tone : ''} fill vs track ` +
    `measured ${r.value.contrast.toFixed(2)}:1`), [],
  `a bar below the ${VALUE_RATCHET}:1 ratchet is quieter than the day #10825 landed`);

  const worst = Math.min(...judged.map((r) => r.value.contrast));
  if (process.env.METER_SUMMARY) {
    for (const theme of THEMES) {
      const here = judged.filter((r) => r.theme === theme).map((r) => r.value.contrast);
      console.log(`value contrast ${theme}: worst ${Math.min(...here).toFixed(2)}:1, ` +
        `best ${Math.max(...here).toFixed(2)}:1, n=${here.length}`);
    }
    const gs = [...readings, ...synthetic].flatMap((r) => r.grooves.map((g) => g.contrast));
    console.log(`notch contrast: worst ${Math.min(...gs).toFixed(2)}:1, ` +
      `best ${Math.max(...gs).toFixed(2)}:1, n=${gs.length}`);
    const sp = [...readings, ...synthetic].filter((r) => r.strayScan && r.strayScan.peak)
      .map((r) => r.strayScan.peak);
    console.log(`bare-track scan: widest deviation from track level ` +
      `${Math.max(...sp).toFixed(2)}:1 against a ${GROOVE_DETECT}:1 detect ` +
      `threshold, n=${sp.length}`);
    const fv = forced.filter((r) => r.value && r.value.emptyWidth >= 4).map((r) => r.value.contrast);
    console.log(`forced-colors value contrast: worst ${Math.min(...fv).toFixed(2)}:1, n=${fv.length}`);
  }
  /* Trips the moment the worst reading clears 3:1, which is where the
     shortfall is discharged. A `+ 1` slack was here first and left every
     repair landing in [3, 4) green -- which is precisely where a repair
     aimed at the SC 1.4.11 threshold lands, so the ratchet would have
     outlived the issue in silence. */
  assert.ok(worst < VALUE_CONTRAST,
    `the light-theme shortfall this ratchet records appears to be gone (worst now ` +
    `${worst.toFixed(2)}:1); raise the ratchet to ${VALUE_CONTRAST} and close #10848`);
});

/* Measured before the fix, on evaluations.html: under forced-colors the fill's
   `background-image` resolves to `none` and its `box-shadow` to `none`, and
   its background-color was already `rgba(0,0,0,0)`. Those were its entire
   appearance, so the bar painted NOTHING -- it lost the value, not just the
   band. This is the claim that binds that. */

test('under forced-colors the bar still paints its value', () => {
  const judged = forced.filter((r) => r.value && r.value.emptyWidth >= 4);
  assert.ok(judged.length > 0, 'no forced-colors meter had unfilled track to judge against');
  const blank = judged.filter((r) => r.value.contrast < VALUE_CONTRAST);
  assert.deepEqual(blank.map((r) =>
    `${r.theme} forced-colors .meter${r.tone ? '.' + r.tone : ''} fill vs track measured ` +
    `${r.value.contrast.toFixed(2)}:1`), [],
  'a fill that paints nothing under forced-colors has lost the value as well as the band');
});

test('under forced-colors the notch count survives', () => {
  const synth = forced.filter((r) => r.synthetic);
  assert.equal(synth.length, TONES.length * THEMES.length,
    `judged ${synth.length} synthetic tones under forced-colors, ` +
    `expected ${TONES.length * THEMES.length}`);
  const wrong = synth.filter((r) => r.grooves.length !== RANK[r.tone]);
  assert.deepEqual(wrong.map((r) =>
    `${r.theme} forced-colors .meter.${r.tone} painted ${r.grooves.length} notches, ` +
    `expected ${RANK[r.tone]}`), [],
  'a severity channel that a high-contrast palette discards is a severity channel ' +
  'exactly where it is needed most');
});
