/* Text contrast on HOVERED table rows, measured from rendered pixels.
 *
 * Stadiora/Aria#5501 says badge inks dip below 4.5:1 on a hovered row. The
 * reason nobody could confirm or refute it: `scripts/check-ops-contrast.mjs`
 * sweeps ~1,632 sites across two themes and four states, and its STATES are
 * ['live','loading','empty','degraded'] -- the pane's DATA states. Not one
 * reading is hovered. That file says so itself at line 1276: "a :hover
 * brightness the sweep never enters". Green there has never meant hover is
 * safe; it means hover was never entered.
 *
 * This is a separate sweep on purpose. Hover is a per-element state that has
 * to be driven one row at a time with real input, so it cannot be folded into
 * a 1,632-site pass without multiplying a run that is already slow.
 *
 * WHAT MAKES A HOVERED READING REAL
 *
 * CSS :hover does not respond to a synthetic mouseover event. It needs real
 * input, so every row here is hovered with CDP Input.dispatchMouseEvent at the
 * row's own coordinates, and the engagement is then PROVEN twice before a
 * single ratio is computed:
 *
 *   1. the row's computed background must differ from its unhovered value, and
 *   2. the rendered pixels of the row must differ from the unhovered capture.
 *
 * Either one alone can lie. A computed style can change while nothing repaints
 * under the text, and pixels can change for a reason that is not hover. If
 * hover never engaged, every reading is an unhovered reading wearing a hover
 * label, which is the exact false-green shape this repository keeps producing.
 *
 * WHAT IS MEASURED
 *
 * The ink is the element's computed colour. The background is not modelled
 * from tokens -- it is read out of the screenshot, because every surface in
 * this stack is translucent: the hover tint is `color-mix(var(--ink) 4%)`, a
 * pill fill is `color-mix(<tone> 15%)`, and the card underneath is a gradient.
 * The composite is what the eye receives, so the composite is what is judged,
 * at the WORST frequent pixel in the element's own box rather than an average.
 *
 * NOT COVERED
 *
 * - Panes whose sheets add their own row wash. `pane-users-v2.css:287` washes
 *   a SELECTED hovered row's cells with `color-mix(var(--cyan) 15%)`, a
 *   different backdrop from the shared tint this sweeps, and it needs a
 *   selection to exist. Unmeasured here, and named in the PR.
 * - Tones no subject page composes inside a row. The census reports the tone
 *   vocabulary it judged; TONES_EXPECTED below is the independently stated
 *   list it must cover, and a tone missing from a real hovered row is a
 *   failure, never a silent skip.
 * - Non-table hover surfaces (.nav-item, .btn, .seg button, .card.lift). This
 *   issue is about table rows; those are unswept here.
 * - Contrast only. No hover-specific focus, motion or pointer-target check.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The subject: the releases pane ends each health row with a pill, which is
   the "badge inside a hoverable table row" pairing #5501 is about. It is
   reachable on an auth stub plus one fixture, and it loads the shared sheet
   the hover tint lives in. */
const SUBJECT = '/ops/releases.html';

/* WCAG 2.2 SC 1.4.3, normal text. `.pill` is 11.5px at weight 540, which is
   neither 18pt nor 14pt-bold, so the large-text allowance of 3:1 does not
   apply. Stated here as a contract rather than read from anything under test. */
const AA = 4.5;

/* Every tone the shared sheet defines that the subject must actually compose
   inside a hovered row. Stated independently: if aria.css grows a tone, this
   list does not move with it, and if the subject stops rendering one, the
   sweep fails rather than quietly judging fewer. */
const TONES_EXPECTED = ['up', 'down', 'warn', 'none'];

/* Every tone aria.css gives a .pill. The subject page composes four of them,
   so four is all a sweep of its own rows can ever judge -- and the tightest
   tone by computation is .pill.vio, which this page never draws. The rest are
   therefore COMPOSED into the real table by MATRIX below: real sheets, real
   card, real hover rule, real nesting depth, one pill per row exactly as the
   pane builds them. Written as a literal; the sheet is then checked against
   it, never the other way round. */
const TONES_ALL = ['up', 'down', 'warn', 'info', 'acc', 'vio', 'ghost', 'none'];

/* Rows the subject must draw OF ITS OWN across both themes -- one per health
   signal the fixture declares. A floor written as a literal, never derived
   from the census it polices, and never counting the rows this file composes:
   a floor the matrix can satisfy by itself would pass on a degraded pane that
   rendered no table at all. */
const ROW_FLOOR = 5;

const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1440, height: 1000 };

/* Pixel bucketing: 8 quantises antialiased edge pixels away from the flat fill
   without merging two real surfaces. */
const BUCKET = 8;

/* A bucket must hold this share of an element's box to count as a surface the
   text sits on, which keeps a stray antialiased ring out of the judgement. */
const MIN_SHARE = 0.04;

/* The backdrop is read from a SECOND capture of the same box taken with the
   ink made transparent, so no glyph pixel and no antialiased glyph edge can
   ever be mistaken for the surface under the text. An earlier revision tried
   to filter blends by contrast distance instead and a 4.2%-share edge pixel
   between an emerald glyph and its own fill was reported as a 3.982:1
   failure that does not exist. */


const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

/* ----------------------------------------------------------------- fixture */

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const ADMIN = { id: 'adm_1', email: 'ops@example.invalid', name: 'Ops', role: 'owner', status: 'active' };
const SESSION = { id: 'ses_1', createdAt: ago(HOUR), lastSeenAt: ago(MINUTE) };

/* Shaped after the payload scripts/check-ops-narrow-overflow.mjs already
   drives this pane with, so the pane reaches its live state rather than its
   "one store could not be read" state -- a degraded pane renders no table and
   the sweep would then judge nothing while passing.

   The health signals carry one of every verdict the pane maps to a pill tone,
   so the tone vocabulary TONES_EXPECTED declares is present by construction
   instead of by luck: better -> .pill.up, worse -> .pill.down,
   slightly_worse -> .pill.warn, no_change -> a plain .pill. Every address is
   .invalid, on the same terms as the pane's own fixtures. */
const TRACKS = (state) => [
  { track: 'internal', versionName: '1.1.3', versionCode: '4412', state: 'processing',
    testerCount: 12, fetchedAt: ago(90_000) },
  { track: 'external', versionName: '1.1.3', versionCode: '4412', state: 'in_review',
    testerCount: 240, fetchedAt: ago(90_000) },
  { track: 'production', versionName: '1.1.2', versionCode: '4398', state,
    rolloutBasisPoints: state === 'live' ? 10_000 : 2000,
    rolloutObservedSince: ago(6 * DAY), releasedAt: ago(9 * DAY), fetchedAt: ago(90_000) }
];

const RELEASES = {
  generatedAt: ago(90_000),
  platforms: [
    { platform: 'ios', label: 'iOS', appIdentifier: 'com.example.invalid',
      sourceKey: 'app_store_connect', tracks: TRACKS('live'), unknownTracks: [] },
    { platform: 'android', label: 'Android', appIdentifier: 'com.example.invalid',
      sourceKey: 'google_play', tracks: TRACKS('rolling_out'), unknownTracks: [] }
  ],
  sources: [
    { key: 'app_store_connect', label: 'App Store Connect', status: 'ok',
      lastSuccessAt: ago(90_000), lastAttemptAt: ago(90_000), pollSeconds: 900, mode: 'poll' },
    { key: 'google_play', label: 'Google Play', status: 'ok',
      lastSuccessAt: ago(150_000), lastAttemptAt: ago(150_000), pollSeconds: 900, mode: 'poll' }
  ],
  production: { versionName: '1.1.2', builds: [
    { platform: 'ios', versionCode: '4398' }, { platform: 'android', versionCode: '4398' }] },
  adoption: {
    latestVersion: '1.1.2', sampleSessions: 18_422,
    buckets: [
      { key: 'latest', label: '1.1.2', basisPoints: 6120 },
      { key: 'previous', label: '1.1.1', basisPoints: 2740 },
      { key: 'older', label: 'Older', basisPoints: 1140 }
    ]
  },
  crashFree: { basisPoints: 9962, floorBasisPoints: 9950, windowHours: 24 },
  health: {
    platform: 'android', current: '1.1.2', previous: '1.1.1',
    signals: [
      { key: 'crash_rate', label: 'Crash rate', unit: 'rate_bp', previous: 52, current: 38,
        verdict: 'better' },
      { key: 'anr_rate', label: 'App not responding', unit: 'per_1k', previous: 1.2, current: 3.1,
        verdict: 'worse' },
      { key: 'cold_start', label: 'Cold start', unit: 'millis', previous: 1840, current: 2130,
        verdict: 'slightly_worse' },
      { key: 'sessions', label: 'Sessions', unit: 'count', previous: 18_000, current: 18_422,
        verdict: 'no_change' },
      { key: 'install_size', label: 'Install size', unit: 'bytes', previous: null, current: null,
        verdict: 'unknown' }
    ]
  }
};

function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: { admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900 } };
  }
  if (pathname.startsWith('/api/ops/releases')) return { data: RELEASES };
  return { data: {} };
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

/* -------------------------------------------------------------------- PNG */


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

/* ------------------------------------------------------------------ colour */


/* Reads the three serialisations Chromium actually emits for a resolved
   colour. `color(srgb …)` is how it serialises a color-mix(), and a parser
   that only understood rgb() is how 40 sites once vanished in silence. A
   syntax this cannot read is REFUSED by name, never skipped. */
function parseColor(str) {
  const s = String(str).trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i);
  if (m) {
    return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : pct(m[4]) };
  }
  m = s.match(/^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s*(?:\/\s*([\d.%]+)\s*)?\)$/i);
  if (m) {
    return {
      rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255],
      alpha: m[4] === undefined ? 1 : pct(m[4])
    };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  return null;
}

function pct(v) {
  return String(v).endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
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

/* Group pixels into surfaces. Mean of the real pixels per bucket, so a
   gradient reports the shades it actually holds rather than one average. */
function bucketPixels(px) {
  const counts = new Map();
  for (const [r, g, b] of px) {
    const key = ((r / BUCKET) | 0) * 65536 + ((g / BUCKET) | 0) * 256 + ((b / BUCKET) | 0);
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  return [...counts.values()]
    .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n], n: e.n }))
    .sort((a, b) => b.n - a.n);
}

/* ------------------------------------------------------------- page probes */

/* Transitions and animations off, through CSSOM rather than a <style> element:
   the shell's CSP has no 'unsafe-inline', so an injected stylesheet element is
   blocked and would fail silently. `.skip` transitions its own `top` on focus
   and `.btn` transitions its background, so a photograph taken mid-transition
   is of neither state. */

/* ------------------------------------------------------------- page probes */

/* `.tbl tbody tr` transitions its background over .12s, so a capture taken
   straight after the pointer arrives is of neither state. Motion off through
   CSSOM, because the shell's CSP has no 'unsafe-inline' and an injected
   <style> element would be blocked silently. */
const NO_MOTION = `(() => {
  const s = new CSSStyleSheet();
  s.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

/* Rows, and inside each row the elements that actually paint text on a
   surface. An element holding a pill is not a text site -- its visible text
   belongs to the pill, which paints its own fill over the row -- so anything
   with a background-painting descendant is a container and is skipped as
   such. */
const ROW_CENSUS = `(() => {
  const paints = (el) => {
    const cs = getComputedStyle(el);
    return (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (cs.backgroundColor && !/^rgba\\(0, 0, 0, 0\\)$|^transparent$/.test(cs.backgroundColor));
  };
  const directText = (el) => [...el.childNodes]
    .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const rows = [...document.querySelectorAll('.tbl tbody tr')];
  return JSON.stringify(rows.map((row, r) => {
    row.dataset.hoverRow = String(r);
    const inks = [];
    for (const el of row.querySelectorAll('*')) {
      const text = directText(el);
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      if ([...el.querySelectorAll('*')].some(paints)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      el.dataset.hoverInk = r + '-' + inks.length;
      const nameOf = (n) => (n && n.className && n.className.baseVal === undefined ? String(n.className) : '');
      /* pill() builds span.pill.TONE > span(text), so the element holding the
         text is the INNER span and carries no tone class of its own. Read the
         tone off the nearest .pill ancestor inside this row, or every badge
         reads as untoned and the tone floor below passes on nothing. */
      const badge = el.closest('.pill');
      const cls = nameOf(el);
      const badgeCls = badge && row.contains(badge) ? nameOf(badge) : '';
      inks.push({
        key: r + '-' + (inks.length),
        tag: el.tagName.toLowerCase(), cls, badgeCls,
        tone: badgeCls
          ? (['up','down','warn','info','acc','vio','ghost'].find((t) => badgeCls.split(/\\s+/).includes(t)) || 'none')
          : null,
        text: text.slice(0, 40), color: cs.color
      });
    }
    return { r, inks, matrix: row.dataset.hoverMatrix || null };
  }));
})()`;

/* Ink off, then ink back on, through a constructed stylesheet -- the same
   route NO_MOTION takes, because the shell's CSP has no 'unsafe-inline' and a
   <style> element would be dropped in silence. Only `color` moves, so the box
   does not reflow and the capture is the same geometry with the glyphs gone. */
const HIDE_INK = `(() => {
  if (!window.__hoverHide) {
    window.__hoverHide = new CSSStyleSheet();
    window.__hoverHide.replaceSync('[data-hover-ink] { color: transparent !important; }');
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, window.__hoverHide];
  return JSON.stringify({ hidden: true });
})()`;

const SHOW_INK = `(() => {
  document.adoptedStyleSheets =
    document.adoptedStyleSheets.filter((s) => s !== window.__hoverHide);
  return JSON.stringify({ hidden: false });
})()`;

/* One extra row per tone, appended to the page's own tbody with DOM calls --
   no innerHTML, no style attribute, nothing the shell's CSP forbids. The
   shape is the pane's own: th.t-main for the row header, then a cell holding
   span.pill.TONE > span(text), which is exactly what pane-releases.js's
   pill() builds. These rows are marked so the organic-tone floor below can
   still insist the PAGE drew its own four. */
const MATRIX = `(() => {
  const tbody = document.querySelector('.tbl tbody');
  if (!tbody) return JSON.stringify({ added: 0 });
  for (const el of tbody.querySelectorAll('[data-hover-matrix]')) el.remove();
  const tones = ${JSON.stringify(TONES_ALL)};
  const cols = tbody.querySelector('tr') ? tbody.querySelector('tr').children.length : 2;
  for (const tone of tones) {
    const tr = document.createElement('tr');
    tr.dataset.hoverMatrix = tone;
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    th.className = 't-main';
    th.appendChild(document.createTextNode('Tone ' + tone));
    /* The palest ink aria.css pairs with a table row: .tbl .t-sub is
       var(--ink-3) at 11.5px and exists only inside .tbl, so a hover tint that
       is safe behind a pill can still be unsafe behind this. Composed here
       because the subject page's own rows carry no sub-line. */
    const sub = document.createElement('div');
    sub.className = 't-sub';
    sub.appendChild(document.createTextNode('sub line ' + tone));
    th.appendChild(sub);
    tr.appendChild(th);
    for (let c = 1; c < cols - 1; c++) {
      const pad = document.createElement('td');
      pad.className = 'r num';
      pad.appendChild(document.createTextNode('0'));
      tr.appendChild(pad);
    }
    const td = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = tone === 'none' ? 'pill' : 'pill ' + tone;
    const label = document.createElement('span');
    label.appendChild(document.createTextNode('Sample ' + tone));
    pill.appendChild(label);
    td.appendChild(pill);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  return JSON.stringify({ added: tbody.querySelectorAll('[data-hover-matrix]').length });
})()`;

/* Put the row in view and report where to aim, in viewport coordinates for the
   input dispatch and page coordinates for the clip. A few pixels in from the
   row's left edge lands inside the row and outside every pill. */
const ROW_GEOM = (r) => `(() => {
  const row = document.querySelector('[data-hover-row="${r}"]');
  row.scrollIntoView({ block: 'center', inline: 'nearest' });
  const b = row.getBoundingClientRect();
  return JSON.stringify({
    aim: { x: Math.round(b.left + 4), y: Math.round(b.top + b.height / 2) },
    clip: { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height },
    bg: getComputedStyle(row).backgroundColor
  });
})()`;

const ROW_STATE = (r) => `(() => {
  const row = document.querySelector('[data-hover-row="${r}"]');
  const b = row.getBoundingClientRect();
  return JSON.stringify({
    bg: getComputedStyle(row).backgroundColor,
    hovered: row.matches(':hover'),
    clip: { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height },
    inks: [...row.querySelectorAll('[data-hover-ink]')].map((el) => {
      const r2 = el.getBoundingClientRect();
      return { key: el.dataset.hoverInk, color: getComputedStyle(el).color,
        box: { x: r2.left + scrollX, y: r2.top + scrollY, width: r2.width, height: r2.height } };
    })
  });
})()`;

/* ------------------------------------------------------------ measurement */

async function shoot(clip) {
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  });
  return decodePNG(Buffer.from(res.data, 'base64'));
}

function cropPixels(img, clip, box) {
  const x0 = Math.max(0, Math.round(box.x - clip.x));
  const y0 = Math.max(0, Math.round(box.y - clip.y));
  const x1 = Math.min(img.width, Math.round(box.x - clip.x + box.width));
  const y1 = Math.min(img.height, Math.round(box.y - clip.y + box.height));
  const out = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 3;
      out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  return out;
}

function differs(a, b) {
  if (a.width !== b.width || a.height !== b.height) return true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return true;
  return false;
}

/* The backdrop is the worst-contrast colour that occupies a real share of the
   ink's own box in the glyph-free capture. A share floor keeps a stray
   sub-pixel from deciding a ratio; the gradient bands under a row comfortably
   clear it. */
function backdropFor(pixels, ink) {
  const buckets = bucketPixels(pixels).filter((b) => b.n / pixels.length >= MIN_SHARE);
  if (!buckets.length) return null;
  return buckets.reduce((w, b) => (contrast(b.rgb, ink) < contrast(w.rgb, ink) ? b : w));
}

/* An ink with alpha < 1 is composited toward its own backdrop, which LOWERS
   the ratio. Assuming opacity here would hide exactly the defect this file
   exists to find, so the ink is composited and the fill is not: the
   conservative direction is chosen per role, not once. */
function composite(fg, bg) {
  if (fg.alpha >= 1) return fg.rgb;
  return fg.rgb.map((c, i) => c * fg.alpha + bg[i] * (1 - fg.alpha));
}

async function hoverAt(x, y) {
  for (const type of ['mouseMoved']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0 });
  }
  await new Promise((r) => setTimeout(r, 60));
}

/* Sweep one theme: for every row, capture it unhovered, drive real pointer
   input onto it, PROVE the hover rule engaged twice over -- the row's own
   computed background changed AND the painted pixels changed -- and only then
   measure each ink inside it against what is now under it. */
async function sweepTheme(theme) {
  await setTheme(theme, true);
  await load(`${base}${SUBJECT}`);
  await evalJson(NO_MOTION);
  const painted = await evalJson(`JSON.stringify({ theme: document.documentElement.dataset.theme })`);
  assert.equal(painted.theme, theme, `page painted ${painted.theme} when asked for ${theme}`);

  const built = await evalJson(MATRIX);
  assert.equal(built.added, TONES_ALL.length,
    `the tone matrix added ${built.added} rows, not the ${TONES_ALL.length} tones declared`);
  const rows = await evalJson(ROW_CENSUS);
  const readings = [];
  const engagement = [];
  for (const row of rows) {
    if (!row.inks.length) continue;
    await hoverAt(2, 2);
    const geom = await evalJson(ROW_GEOM(row.r));
    const off = await evalJson(ROW_STATE(row.r));
    const imgOff = await shoot(off.clip);

    await hoverAt(geom.aim.x, geom.aim.y);
    const on = await evalJson(ROW_STATE(row.r));
    const imgOn = await shoot(on.clip);

    engagement.push({
      r: row.r, matches: on.hovered, bgOff: off.bg, bgOn: on.bg,
      bgChanged: off.bg !== on.bg, pixelsChanged: differs(imgOff, imgOn)
    });

    await evalJson(HIDE_INK);
    const imgBare = await shoot(on.clip);
    await evalJson(SHOW_INK);
    assert.ok(differs(imgOn, imgBare),
      `${theme} row ${row.r}: hiding the ink changed no pixels, so the glyph-free ` +
      'capture is not glyph-free and every backdrop read from it is unproven');

    for (const site of row.inks) {
      const live = on.inks.find((i) => i.key === site.key);
      const ink = parseColor(live.color);
      assert.ok(ink, `unreadable ink colour ${live.color} at row ${row.r}`);
      const px = cropPixels(imgBare, on.clip, live.box);
      assert.ok(px.length, `empty crop for ${site.key}`);
      const bd = backdropFor(px, ink.rgb);
      if (!bd) continue;
      const fg = composite(ink, bd.rgb);
      readings.push({
        theme, row: row.r, matrix: row.matrix, key: site.key, tag: site.tag, cls: site.cls,
        badgeCls: site.badgeCls, tone: site.tone,
        text: site.text, ink: live.color, backdrop: bd.rgb.map((c) => Math.round(c)),
        share: +(bd.n / px.length).toFixed(3), ratio: +contrast(fg, bd.rgb).toFixed(3)
      });
    }
  }
  await hoverAt(2, 2);
  /* Counted WITHOUT the composed rows. The matrix appends eight rows of its
     own, so a floor over every row in the tbody would be satisfied by the
     matrix alone and would pass on a pane that rendered nothing -- which is
     the degraded state this subject falls into if its payload is wrong. */
  return { readings, engagement, rowCount: rows.filter((r) => !r.matrix).length };
}

/* ------------------------------------------------------------------- boot */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-hover-'));

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
const pageTarget = targets.find((t) => t.type === 'page');
const cdp = connect(pageTarget.webSocketDebuggerUrl);
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
async function setTheme(theme, session = false) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)}); } catch (e) {}` +
      (session
        ? `try { localStorage.setItem('ops-api-base', location.origin); ` +
          `sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' })); } catch (e) {}`
        : '')
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme, so a failed storage write
     cannot look like a success. The theme that painted is asserted after load. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, settle = 600) {
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
}

/* The sweep is driven once and shared, because it takes a real browser and a
   real pointer per row. Memoised rather than run at import time so that a
   failure inside it is reported as a failing assertion in a named test, not
   as a module that never loaded -- a crash is not a kill. */
let sweepPromise = null;
function sweep() {
  if (!sweepPromise) {
    sweepPromise = (async () => {
      const out = {};
      for (const theme of THEMES) out[theme] = await sweepTheme(theme);
      return out;
    })();
  }
  return sweepPromise;
}

/* ------------------------------------------------------------------ tests */

test('the subject page is the one that pairs a badge with a table row', async () => {
  const html = fs.readFileSync(path.join(ROOT, SUBJECT.replace(/^\//, '')), 'utf8');
  assert.match(html, /assets\/aria\.css/, `${SUBJECT} does not load aria.css, so it cannot exercise its hover rule`);
  const js = fs.readFileSync(path.join(ROOT, 'ops/assets/pane-releases.js'), 'utf8');
  assert.match(js, /pill\(/, 'pane-releases.js no longer builds pills; the subject page must be re-chosen');
});

test('the tone list this sweep declares is the tone list aria.css defines', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'ops/assets/aria.css'), 'utf8');
  const found = new Set();
  for (const m of css.matchAll(/^\.pill\.([a-z-]+)\s*\{/gm)) found.add(m[1]);
  const declared = new Set(TONES_ALL.filter((t) => t !== 'none'));
  assert.deepEqual([...found].sort(), [...declared].sort(),
    'aria.css defines a .pill tone this sweep does not compose (or vice versa); ' +
    'TONES_ALL is the contract and must be updated deliberately');
});

test('real pointer input engages :hover on every judged row, in both themes', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    const eng = all[theme].engagement;
    assert.ok(eng.length, `${theme}: no row was driven at all`);
    for (const e of eng) {
      assert.equal(e.matches, true, `${theme} row ${e.r}: :hover did not match after pointer input`);
      assert.equal(e.bgChanged, true,
        `${theme} row ${e.r}: computed background stayed ${e.bgOff} under the pointer, ` +
        'so every reading on it would be an unhovered reading wearing a hover label');
      assert.equal(e.pixelsChanged, true,
        `${theme} row ${e.r}: the row repainted no pixels under the pointer`);
    }
  }
});

test('the sweep judged a real board, not an empty one', async () => {
  const all = await sweep();
  for (const theme of THEMES) {
    const { readings, rowCount } = all[theme];
    assert.ok(rowCount >= ROW_FLOOR,
      `${theme}: the page drew ${rowCount} table row(s) of its own, below the declared ` +
      `floor of ${ROW_FLOOR} -- the composed tone rows do not count toward it`);
    assert.ok(readings.length > 0, `${theme}: zero ink sites measured`);
    const organic = new Set(readings.filter((r) => r.tone && !r.matrix).map((r) => r.tone));
    for (const t of TONES_EXPECTED) {
      assert.ok(organic.has(t),
        `${theme}: tone .pill.${t} never appeared inside a hovered row the PAGE drew; ` +
        `saw ${[...organic].sort().join(', ') || 'none'}`);
    }
    const composed = new Set(readings.filter((r) => r.matrix).map((r) => r.tone));
    for (const t of TONES_ALL) {
      assert.ok(composed.has(t),
        `${theme}: the tone matrix judged no ink for .pill.${t}; ` +
        `saw ${[...composed].sort().join(', ') || 'none'}`);
    }
  }
});

test('every ink inside a hovered table row clears AA against what is under it', async () => {
  const all = await sweep();
  const failures = [];
  let judged = 0;
  for (const theme of THEMES) {
    for (const r of all[theme].readings) {
      judged++;
      if (r.ratio < AA) failures.push(r);
    }
  }
  /* Printed per theme so a CI log shows the sweep entered both and judged a
     non-zero number of sites in each. A hover sweep that silently judged
     nothing is the worst false green available here, and a count of zero is
     an assertion failure below, not a quiet pass. */
  for (const theme of THEMES) {
    const rs = [...all[theme].readings].sort((a, b) => a.ratio - b.ratio);
    console.log(`\n${theme}: ${rs.length} hovered ink site(s) judged, ` +
      `${all[theme].engagement.length} row(s) hovered; worst five:`);
    for (const r of rs.slice(0, 5)) {
      console.log(`  ${r.ratio.toFixed(3)}  ` +
        `${(r.tone ? '.pill.' + r.tone : r.tag + (r.cls ? '.' + r.cls.split(/\s+/).join('.') : '')).padEnd(22)} ` +
        `ink ${r.ink} on ${hex(r.backdrop)}  "${r.text}"`);
    }
  }
  assert.ok(judged > 0, 'the sweep judged nothing, which is not a pass');
  assert.deepEqual(failures.map((f) =>
    `${f.theme} ${f.tone ? '.pill.' + f.tone : f.tag + '.' + f.cls} "${f.text}" ` +
    `${f.ratio} on ${hex(f.backdrop)}`), [],
  `ink below the ${AA}:1 floor inside a hovered row`);
});
