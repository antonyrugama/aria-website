/* =========================================================================
 * The settings pane's confirm dialog, measured with its text field focused.
 *
 * WHY THIS FILE EXISTS
 *
 * `pane-settings-v2.css` styles the one text field in the pane's destructive
 * confirm dialog, and gives it its own focus ring rather than inheriting the
 * shared one. Stadiora/Aria#10721 says that ring hard-codes `var(--cyan)` at a
 * POSITIVE `outline-offset` -- the shape that measured 1.x:1 in #10649/#10650
 * /#10651 and forced PR #85 to suppress `.btn-primary`'s halo outright.
 *
 * `scripts/ops-focus-indicator.test.mjs` sweeps `/ops/shell-v2.html` and
 * `/ops/evaluations.html` only. Neither page carries this rule, and that file
 * records it in its own NOT COVERED list as unmeasured. So the claim in #10721
 * was a reading of the source, not a measurement -- and PR #97 is the standing
 * lesson that a source reading is not a measurement: it found that #5501's
 * numbers no longer reproduced on what ships, and shipped the instrument
 * instead of a repaint. This file is that instrument for this ring.
 *
 * WHAT IT DOES
 *
 *   1. Serves the repository over HTTP and stubs the three endpoints the
 *      settings pane reads, so the REAL pane renders its REAL account table.
 *   2. Clicks the real Revoke button with a real CDP mouse event, so the
 *      dialog is opened by the pane's own handler. Nothing here builds the
 *      dialog, because a hand-built copy is measured outside the context that
 *      styles it -- the failure that published a 26.3px overflow that did not
 *      exist.
 *   3. Proves the ring ENGAGED before reading anything, on two independent
 *      channels: the field matches `:focus-visible`, and the rendered pixels
 *      differ from the same clip captured unfocused. One channel alone is how
 *      an unfocused reading gets a focused label.
 *   4. Finds the ring by DIFFING the focused and unfocused captures, so the
 *      ring band is whatever actually changed rather than a band computed from
 *      the offset the stylesheet claims.
 *   5. Reads the ring's own colour as the band nearest the COMPUTED
 *      `outline-color`, and refuses if no pixel rendered at it. The most
 *      common ring pixel is the wrong answer: the dialog is centred with
 *      translate(-50%, -50%) and the field resolves to a fractional height
 *      (37.5px measured), so a 2px ring renders as a full band and a larger
 *      half-covered band, and "most common" returns the blend.
 *   6. Reads the adjacent surface two pixels out on each face, because the
 *      first pixel is an anti-aliasing blend -- and reports WHERE each surface
 *      sat relative to the field, so a ratio names a surface instead of a
 *      hex code.
 *   7. Buckets the adjacent surface, because the dialog's fill is a gradient
 *      and a gradient is one surface spread over many shades, then takes the
 *      WORST bucket.
 *
 * NOT COVERED -- read this before trusting a green run:
 *
 *   - This file measures ONE rule, `.modal-input:focus-visible`, on ONE page.
 *     It is not a sweep. The other two rules named in Stadiora/Aria#10721 are
 *     in `pane-alerts-v2.css` (lines 183 and 256) and are NOT measured here:
 *     that file is held by another change in flight.
 *   - `scripts/ops-focus-indicator.test.mjs` names this rule in its own NOT
 *     COVERED list, at the line number the rule used to have. That list is not
 *     updated here, because the two focus oracles are themselves the subject
 *     of Stadiora/Aria#10700 and reconciling them from this side would be
 *     guessing at another change's answer.
 *   - Only the ring's contrast against the surface beside it (SC 1.4.11). Not
 *     its thickness, not its shape, not the field's own text contrast, and not
 *     whether the dialog traps focus.
 *   - The worst bucket is taken across BOTH faces sampled (the band the ring
 *     covers, and the band just outside it). A surface that appears at neither
 *     is invisible to this.
 *   - Fails closed without Chrome, like every other rendered oracle here.
 * ========================================================================= */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/ops/settings.html';
const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1280, height: 900 };

/* SC 1.4.11 Non-text Contrast. The ring is a user-interface component's
   visual indicator, so 3:1 against what is beside it, not 4.5:1. */
const RING_MIN = 3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'
};

/* ------------------------------------------------------------------ stubs */

/* Two accounts and one live session, because the pane draws a Revoke button
   only where an account that is not the viewer's has a session still running.
   Times are relative to the run, since "live" is decided against Date.now()
   and a frozen timestamp makes the button disappear as the clock passes it.

   Values are invented and obviously so: this is the pane that lists who can
   open the dashboard, and a fixture is not a place for anything that reads as
   a real person. */
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const HOUR = 3600000;

const ADMINS = [
  { id: 'adm_1', email: 'first.owner@example.invalid', displayName: 'First Owner',
    role: 'owner', status: 'active', lastLoginAt: iso(-HOUR),
    activeSessionExpiresAt: iso(4 * HOUR) },
  { id: 'adm_2', email: 'second.admin@example.invalid', displayName: 'Second Admin',
    role: 'operator', status: 'active', lastLoginAt: iso(-2 * HOUR),
    activeSessionExpiresAt: iso(3 * HOUR) }
];

const SESSIONS = [
  { id: 'ses_1', adminId: 'adm_2', createdAt: iso(-2 * HOUR), expiresAt: iso(3 * HOUR),
    lastSeenAt: iso(-5 * 60000), revokedAt: null },
  { id: 'ses_0', adminId: 'adm_1', createdAt: iso(-HOUR), expiresAt: iso(4 * HOUR),
    lastSeenAt: iso(-60000), revokedAt: null }
];

const AUDIT = [
  { id: 'aud_1', at: iso(-HOUR), actorEmail: 'first.owner@example.invalid',
    action: 'admin.login', targetEmail: 'first.owner@example.invalid', reason: null }
];

const INTEGRATIONS = {
  generatedAt: iso(-60000),
  integrations: [
    { pollerKey: 'azure_cost', label: 'Azure Cost Management',
      usedFor: 'Cloud spend and invoice-backed cost panes.', scopeKey: 'sub-example',
      status: 'ok', failureReason: null, consecutiveFailures: 0,
      lastAttemptAt: iso(-10 * 60000), lastSuccessAt: iso(-10 * 60000),
      connectionState: 'connected',
      freshnessThreshold: { seconds: 86400,
        source: 'server/notification-jobs.ts cron 20 */8 * * *; shared/operations-cost.ts OPS_BUDGET_STALE_AFTER_MS' } },
    { pollerKey: 'google_play', label: 'Google Play',
      usedFor: 'Play internal, closed, open and production track state.',
      scopeKey: 'com.example.android', status: 'failed', failureReason: 'transport',
      consecutiveFailures: 3, lastAttemptAt: iso(-3 * 60000), lastSuccessAt: null,
      connectionState: 'failed',
      freshnessThreshold: { seconds: 900,
        source: 'server/notification-jobs.ts cron */15 * * * *; shared/operations-cost.ts OPS_RELEASE_POLL_SECONDS' } }
  ]
};

/* The viewer. `owner`, because the settings pane refuses every other role and
   draws a "you do not have access" card instead of the account table -- and
   that card has no dialog, so there would be no ring to measure. */
const VIEWER = { id: 'adm_1', email: 'first.owner@example.invalid', name: 'First Owner',
  displayName: 'First Owner', role: 'owner', status: 'active' };
const SESSION = { id: 'ses_0', createdAt: iso(-HOUR), lastSeenAt: iso(-60000) };

function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(Date.now() / 1000),
      reauthWindowSeconds: 900, admin: VIEWER, session: SESSION
    } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: {
      admin: VIEWER, session: SESSION,
      authTime: Math.floor(Date.now() / 1000), reauthWindowSeconds: 900
    } };
  }
  if (pathname.startsWith('/api/ops/admins')) return { data: ADMINS };
  if (pathname.startsWith('/api/ops/sessions')) return { data: SESSIONS };
  if (pathname.startsWith('/api/ops/audit')) return { data: AUDIT };
  if (pathname.startsWith('/api/ops/integrations')) return { data: INTEGRATIONS };
  return { data: [] };
}

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

/* ---------------------------------------------------------------- browser */

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

/* ------------------------------------------------------------------- PNG */

/* Dependency-free on purpose: this repository has no package manager. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
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
    const s = i * bpp;
    if (channels >= 3) { data[i * 3] = out[s]; data[i * 3 + 1] = out[s + 1]; data[i * 3 + 2] = out[s + 2]; }
    else { data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = out[s]; }
  }
  return { width, height, data };
}

/* -------------------------------------------------------------- contrast */

function channel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/* 'rgb(34, 211, 238)' / 'rgba(...)' -> [34, 211, 238]. Chromium serialises
   computed colours in one of those two forms. */
function canonRgb(v) {
  const m = /^rgba?\(([^)]+)\)$/.exec((v || '').trim());
  if (!m) return null;
  const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return n.length >= 3 && n.slice(0, 3).every((x) => Number.isFinite(x)) ? n.slice(0, 3) : null;
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------- boot */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-set-focus-'));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'
], { stdio: 'ignore' });

const port = await devtoolsPort(profile);
const targets = await devtools(port, '/json/list');
const cdp = connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false
});

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

async function evalJson(expression) {
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
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)});` +
      ` localStorage.setItem('ops-api-base', location.origin);` +
      ` sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' })); } catch (e) {}`
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme, so a failed storage write
     cannot look like a success. The theme that painted is asserted below. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, settle = 800) {
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
}

async function shoot(clip) {
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  });
  return decodePNG(Buffer.from(res.data, 'base64'));
}

async function click(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0
    });
  }
  await new Promise((r) => setTimeout(r, 250));
}

/* ----------------------------------------------------------- page programs */

/* Where the pane's own Revoke button is. Located by its accessible name, so a
   change to the table's column order cannot quietly point this at something
   else. The pane draws one per account that is not the viewer's. */
const FIND_REVOKE = `(() => {
  const buttons = [...document.querySelectorAll('button')]
    .filter((b) => /^Revoke access for /.test(b.getAttribute('aria-label') || ''));
  if (!buttons.length) {
    return JSON.stringify({ ok: false, why: 'no Revoke button drawn',
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 20),
      text: (document.querySelector('main') || document.body).textContent.replace(/\s+/g, ' ').slice(0, 600) });
  }
  const r = buttons[0].getBoundingClientRect();
  return JSON.stringify({ ok: true, label: buttons[0].getAttribute('aria-label'),
    x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;

/* The dialog, its field, and everything needed to prove a focus ring was
   actually entered rather than assumed. */
const FIELD_STATE = `(() => {
  const el = document.getElementById('setConfirmReason');
  if (!el) return JSON.stringify({ ok: false, why: 'the confirm dialog has no reason field' });
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const dialog = el.closest('[role="dialog"]');
  return JSON.stringify({
    ok: true,
    focusVisible: el.matches(':focus-visible'),
    active: document.activeElement === el,
    className: el.className,
    dialog: dialog ? dialog.className : null,
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    outlineColor: cs.outlineColor,
    outlineWidth: cs.outlineWidth,
    outlineOffset: cs.outlineOffset,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    theme: document.documentElement.getAttribute('data-theme')
  });
})()`;

const BLUR = `(() => { const el = document.getElementById('setConfirmReason');
  if (el) el.blur(); document.body.focus(); return JSON.stringify({ ok: true }); })()`;

/* `:focus-visible` on a text field matches on any focus, including a
   programmatic one -- a text field always wants its ring. Asserted rather
   than assumed, below. */
const FOCUS = `(() => { const el = document.getElementById('setConfirmReason');
  if (!el) return JSON.stringify({ ok: false });
  el.focus();
  return JSON.stringify({ ok: true, focusVisible: el.matches(':focus-visible') }); })()`;

/* ----------------------------------------------------------- measurement */

function pixel(img, x, y) {
  const i = (y * img.width + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function differs(a, b, tol = 6) {
  return Math.abs(a[0] - b[0]) > tol || Math.abs(a[1] - b[1]) > tol || Math.abs(a[2] - b[2]) > tol;
}

/* A gradient is one surface spread over many shades. Bucketing at 8 levels
   per channel keeps the shades of one fill together while keeping two
   genuinely different fills apart, so "the worst surface beside the ring"
   means a surface and not a single stray pixel. */
function bucket(p) {
  return [p[0] >> 5, p[1] >> 5, p[2] >> 5].join(',');
}

function buckets(samples) {
  const by = new Map();
  for (const { rgb, at } of samples) {
    const k = bucket(rgb);
    const e = by.get(k) || { n: 0, r: 0, g: 0, b: 0, xs: [Infinity, -Infinity], ys: [Infinity, -Infinity] };
    e.n++; e.r += rgb[0]; e.g += rgb[1]; e.b += rgb[2];
    /* Extents are tracked as they arrive rather than from a retained sample
       of positions: a capped sample reports a narrower span than the bucket
       actually covers, which is a published figure that understates itself. */
    if (at) {
      e.xs = [Math.min(e.xs[0], at[0]), Math.max(e.xs[1], at[0])];
      e.ys = [Math.min(e.ys[0], at[1]), Math.max(e.ys[1], at[1])];
    }
    by.set(k, e);
  }
  return [...by.values()]
    .filter((e) => e.n >= 3)
    .map((e) => ({ n: e.n, rgb: [e.r / e.n, e.g / e.n, e.b / e.n], xs: e.xs, ys: e.ys }));
}

/* Drive the pane to the state, then read it. Returns everything a failure
   message needs, so a red run says what it saw rather than that it differed. */
async function measure(theme) {
  await setTheme(theme);
  await load(base + PAGE);

  const found = await evalJson(FIND_REVOKE);
  assert.ok(found.ok, `${theme}: ${found.why} -- saw buttons ${JSON.stringify(found.buttons)} :: ${found.text}`);
  await click(found.x, found.y);

  const before = await evalJson(FIELD_STATE);
  assert.ok(before.ok, `${theme}: ${before.why}`);
  assert.equal(before.theme, theme,
    `${theme}: the page painted data-theme="${before.theme}" -- the stored theme did not take`);

  /* The pane focuses the field itself when the dialog opens. Blur it to get a
     clean unfocused capture of exactly the pixels the ring will later cover:
     that band IS the adjacent surface, read rather than reasoned about. */
  await evalJson(BLUR);
  await new Promise((r) => setTimeout(r, 120));
  const unfocusedState = await evalJson(FIELD_STATE);
  assert.equal(unfocusedState.focusVisible, false,
    `${theme}: the field still matched :focus-visible after blur, so the "unfocused" capture is a focused one`);

  const rect = unfocusedState.rect;
  const pad = 10;
  const clip = {
    x: Math.floor(rect.x - pad), y: Math.floor(rect.y - pad),
    width: Math.ceil(rect.width + pad * 2), height: Math.ceil(rect.height + pad * 2)
  };
  const unfocused = await shoot(clip);

  const refocus = await evalJson(FOCUS);
  assert.ok(refocus.ok, `${theme}: the reason field vanished before it could be focused`);
  await new Promise((r) => setTimeout(r, 120));
  const focused = await evalJson(FIELD_STATE);

  /* Channel one: the engine says the ring is on. */
  assert.equal(focused.focusVisible, true,
    `${theme}: the field does not match :focus-visible when focused, so nothing below is a ring`);
  assert.notEqual(focused.outline.split(' ')[0], 'none',
    `${theme}: computed outline-style is none while focused -- outline was "${focused.outline}"`);

  const after = await shoot(clip);

  /* Evidence on request. A ring is a visual claim, and a reviewer should be
     able to look at the one being argued about rather than take a hex code
     on trust. Written only when asked, so a normal run writes nothing. */
  if (process.env.OPS_SETTINGS_FOCUS_SHOTS) {
    const dir = process.env.OPS_SETTINGS_FOCUS_SHOTS;
    fs.mkdirSync(dir, { recursive: true });
    const wide = { x: Math.max(0, Math.floor(rect.x - 60)), y: Math.max(0, Math.floor(rect.y - 170)),
      width: Math.ceil(rect.width + 120), height: Math.ceil(rect.height + 260) };
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, clip: { ...wide, scale: 2 }
    });
    fs.writeFileSync(path.join(dir, `settings-focus-${theme}.png`), Buffer.from(shot.data, 'base64'));
  }

  /* Channel two: the pixels moved. An engaged-looking computed style over an
     unchanged raster is the whole failure this pair exists to catch. */
  const ring = [];
  for (let y = 0; y < after.height; y++) {
    for (let x = 0; x < after.width; x++) {
      if (differs(pixel(unfocused, x, y), pixel(after, x, y))) ring.push({ x, y });
    }
  }
  assert.ok(ring.length > 0,
    `${theme}: focusing the field changed no pixel in a ${clip.width}x${clip.height} clip around it`);

  const ringSet = new Set(ring.map((p) => p.x + ',' + p.y));

  /* The ring's own colour is the colour the engine says it painted, FOUND
     among the pixels that changed -- not the most common one.

     The most common one is wrong here, and measurably so. `.modal` is centred
     with translate(-50%, -50%) and the field resolves to a fractional height
     (37.5px measured), so the 2px ring straddles a half device pixel and
     renders as TWO bands: one at full coverage and one at about half, blended
     into the panel behind it. The half-covered band is the LARGER of the two
     (1187px against 929px measured), so "the most common ring pixel" returns
     an anti-aliasing blend -- #187383 rather than #22d3ee in dark -- and then
     reports a ratio for a colour the stylesheet never asked for. That is the
     same shape as sampling a hatched fill at one pixel and publishing it as
     the fill.

     So: take the bucket nearest the computed outline-color, and REFUSE if
     nothing within the band actually rendered at it. A ring that only ever
     appears as a blend is a different measurement problem, and it should stop
     this file rather than be quietly averaged into an answer. */
  const ringBuckets = buckets(ring.map((p) => ({ rgb: pixel(after, p.x, p.y) })))
    .sort((a, b) => b.n - a.n);
  assert.ok(ringBuckets.length > 0, `${theme}: the ring band held no bucket with 3+ pixels`);
  const declared = canonRgb(focused.outlineColor);
  assert.ok(declared, `${theme}: could not resolve outline-color "${focused.outlineColor}"`);
  const nearest = ringBuckets
    .map((b) => ({ ...b, off: Math.max(...b.rgb.map((v, i) => Math.abs(v - declared[i]))) }))
    .sort((a, b) => a.off - b.off)[0];
  assert.ok(nearest.off <= 12,
    `${theme}: no pixel in the ring band rendered at the computed outline-color ` +
    `${focused.outlineColor}. Nearest bucket was ${hex(nearest.rgb)}, off by ${nearest.off} ` +
    `per channel. Buckets: ${JSON.stringify(ringBuckets.slice(0, 6).map((b) => ({ rgb: hex(b.rgb), n: b.n })))}`);
  const ringRgb = nearest.rgb;

  /* The adjacent surface, on both faces, read from the pixels around the ring
     band. The step is TWO pixels, not one, and which of those is right is a
     question this file answers by reading the raster rather than by reading
     `outline-offset`.

     Measured stack across the field's left edge, light theme, focused:

       dx -4  #fcfdfe   the dialog panel
       dx -3  #50b1c9   anti-aliased ring edge
       dx -2  #0891b2   the ring, at full coverage
       dx -1  #a9d8e5   anti-aliased ring edge
       dx  0  #e3e5e8   the FIELD'S OWN 1px inset edge (--line-2)
       dx  2  #f8fafd   the field's fill

     `outline-offset: 1px` claims a 1px gap of panel between the ring and the
     field. There isn't one in the raster: the anti-aliased ring edge occupies
     it. So the surface on the ring's inner face is the control's own edge,
     which is PR #85's finding -- at a positive offset the adjacent surface is
     often the control's own mid-luminance edge, and no recolouring of the page
     behind it can answer that. Stepping one pixel would sample the blend;
     stepping two reaches the first real surface on each face. */
  const neighbours = [];
  const covered = [];
  /* Positions are carried with every sample and reported with the worst
     bucket, because "2.591:1 against #d6d9dd" is only actionable once you can
     say WHICH surface #d6d9dd is. Offsets are relative to the field's own
     border box, so a reader can tell the panel behind the ring from the
     field's own 1px inset edge without opening a screenshot. */
  const rel = (p) => [Math.round(clip.x + p.x - rect.x), Math.round(clip.y + p.y - rect.y)];
  for (const p of ring) {
    covered.push({ rgb: pixel(unfocused, p.x, p.y), at: rel(p) });
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= after.width || ny >= after.height) continue;
      if (ringSet.has(nx + ',' + ny)) continue;
      neighbours.push({ rgb: pixel(after, nx, ny), at: rel({ x: nx, y: ny }) });
    }
  }

  const surfaces = [
    ...buckets(covered).map((b) => ({ ...b, face: 'band the ring covers' })),
    ...buckets(neighbours).map((b) => ({ ...b, face: 'beyond the band' }))
  ].map((s) => ({ ...s, ratio: contrast(ringRgb, s.rgb) }));

  assert.ok(surfaces.length > 0, `${theme}: no adjacent surface had 3+ pixels to measure`);
  surfaces.sort((a, b) => a.ratio - b.ratio);

  /* A vertical slice through the field's TOP edge, focused and unfocused, so
     the stack beside the ring is read off rather than deduced from the
     stylesheet's declared offset. */
  const sliceX = Math.round(rect.width / 2);
  const slice = [];
  for (let y = 0; y < Math.min(after.height, 22); y++) {
    slice.push({ dy: Math.round(clip.y + y - rect.y),
      on: hex(pixel(after, sliceX, y)), off: hex(pixel(unfocused, sliceX, y)) });
  }

  const sliceY = Math.round(rect.height / 2);
  const hslice = [];
  for (let x = 0; x < Math.min(after.width, 22); x++) {
    hslice.push({ dx: Math.round(clip.x + x - rect.x),
      on: hex(pixel(after, x, sliceY)), off: hex(pixel(unfocused, x, sliceY)) });
  }

  return {
    theme,
    hslice,
    slice,
    rect,
    outlineColor: focused.outline,
    ringBuckets: ringBuckets.slice(0, 8).map((b) => ({ rgb: hex(b.rgb), n: b.n })),
    outline: focused.outline,
    outlineOffset: focused.outlineOffset,
    dialog: focused.dialog,
    ringPixels: ring.length,
    ring: hex(ringRgb),
    worst: surfaces[0],
    surfaces: surfaces.slice(0, 6).map((s) => ({
      face: s.face, rgb: hex(s.rgb), n: s.n, ratio: Number(s.ratio.toFixed(3)),
      xs: s.xs, ys: s.ys
    }))
  };
}

let readings = null;
before(async () => {
  readings = {};
  for (const theme of THEMES) readings[theme] = await measure(theme);
}, { timeout: 180000 });

/* ------------------------------------------------------------------ tests */

test('the pane opened its own confirm dialog, with its own field', () => {
  for (const theme of THEMES) {
    const r = readings[theme];
    assert.equal(r.dialog, 'modal',
      `${theme}: the reason field is not inside the pane's .modal dialog (saw ${r.dialog}) -- ` +
      'a field measured outside the element that styles it is measured against the wrong surface');
  }
});

test('the focus ring engaged before anything was measured', () => {
  for (const theme of THEMES) {
    const r = readings[theme];
    assert.ok(r.ringPixels > 0, `${theme}: no pixel changed when the field took focus`);
    assert.notEqual(r.outline.split(' ')[0], 'none', `${theme}: outline-style computed none`);
  }
});

test('the confirm dialog focus ring clears 3:1 against the surface it touches', () => {
  for (const theme of THEMES) {
    const r = readings[theme];
    assert.ok(r.worst.ratio >= RING_MIN,
      `${theme}: .modal-input:focus-visible ring ${r.ring} measures ` +
      `${r.worst.ratio.toFixed(3)}:1 against ${hex(r.worst.rgb)} (${r.worst.face}, ` +
      `${r.worst.n}px) -- SC 1.4.11 wants ${RING_MIN}:1. Outline "${r.outline}" at ` +
      `offset ${r.outlineOffset}. All surfaces: ${JSON.stringify(r.surfaces)}`);
  }
});

test('the measured figures are published, not asserted in the dark', () => {
  const rows = THEMES.map((t) => {
    const r = readings[t];
    return `${t}: ring ${r.ring} vs ${hex(r.worst.rgb)} (${r.worst.face}) = ` +
      `${r.worst.ratio.toFixed(3)}:1 over ${r.ringPixels} ring px, ` +
      `outline "${r.outline}" offset ${r.outlineOffset}`;
  });
  if (process.env.OPS_SETTINGS_FOCUS_CENSUS === '1') {
    console.log('OPS_SETTINGS_FOCUS_BEGIN');
    console.log(JSON.stringify(readings, null, 2));
    console.log('OPS_SETTINGS_FOCUS_END');
  }
  assert.equal(rows.length, THEMES.length, rows.join('\n'));
});
