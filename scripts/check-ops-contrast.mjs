/* WCAG AA contrast guard for the v2 operations shell — text, and focus rings.
 *
 * The token checks in check-ops-shell-v2.mjs pin every custom property to the
 * value the design writes, per theme. They cannot see a USAGE-SITE SWAP: a rule
 * that asks for the wrong token, where both tokens exist and both still hold
 * the value the design writes. Changing `.pill.acc` from `var(--cyan-ink)` to
 * `var(--cyan)` leaves every token resolving, every token holding its designed
 * value, both suites green — and the pill's text at 3.03:1 in light, under the
 * 4.5:1 AA needs for body text (Stadiora/Aria#10287).
 *
 * So this measures rendered pixels instead of names. For every visible
 * text-bearing element on the shell, in both themes and all four preview
 * states, it computes the contrast between the element's resolved text colour
 * and the topmost paint at that text with the glyphs lifted, and fails under
 * 4.5:1. That is WCAG AA for body text, applied to every site regardless of
 * type size: the large-text allowance is deliberately not implemented, for the
 * reasons at AA_RATIO below. That paint is the colour behind the glyphs only
 * while nothing paints ABOVE them; see NOT COVERED in ops/README.md.
 *
 * A SECOND SWEEP measures FOCUS INDICATORS against SC 1.4.11's 3:1, which is a
 * different comparison and not a fifth preview state: a ring is judged against
 * the surfaces BESIDE it, not the one behind it, and `outline-offset` decides
 * which those are. Positive, and the ring lands outside the control on
 * whatever the control sits on; negative, and it lands on the control itself.
 * Nothing here models that geometry — each control is photographed twice,
 * unfocused and focused, and the ring is read off the pixels that moved. See
 * FOCUS_RATIO below and Stadiora/Aria#10634. (ops/README.md's NOT COVERED list
 * still says focus rings are outside this check. That file belongs to another
 * agent's PR in this wave and was not edited here; the statement is now too
 * cautious rather than too generous.)
 *
 * Ported from the monorepo's docs/mocks/ops-dashboard-v2/scripts/
 * contrast-check.mjs, which took its own review rounds to become trustworthy.
 * Four things it learned are carried here rather than rediscovered:
 *
 *   1. MEASURE IN PLACE. Cloning a node to document.body drops every
 *      descendant selector styling it and every ancestor background, so the
 *      numbers come out wrong in both directions at once (monorepo #9691).
 *      Nothing here is cloned or re-parented.
 *
 *   2. DO NOT GUESS THE BACKGROUND FROM COMPUTED STYLES. This page is built on
 *      layered gradients and color-mix alpha, and no single ancestor holds the
 *      colour under the text — the surface behind a given word is a stack, not
 *      a value. Instead this takes a PLATE — a second screenshot of the same page
 *      with every glyph made transparent — and samples the rects of the
 *      element's own TEXT RUNS on it, not its box: a row that contains a chip
 *      is 12% chip and its words sit on none of it. That is the painted stack
 *      at the run, gradients and all, with no text pixels left to pull the
 *      average. It is the BACKDROP only while nothing paints over the glyphs:
 *      lifting the text cannot distinguish paint under it from paint on top of
 *      it, and over-paint moves the reported ratio the FLATTERING way. Not
 *      modelled, not refused, named in NOT COVERED.
 *
 *   3. A PARSER THAT CANNOT READ A COLOUR MUST SAY SO, NEVER SKIP. Chromium
 *      serialises color-mix() as `color(srgb r g b / a)`. The monorepo's parser
 *      understood only rgb(), so 40 text sites were dropped in silence and 10
 *      real AA failures went with them (monorepo #10255). parseColor here reads
 *      both, and anything else is REFUSED BY NAME and fails the run.
 *
 *   4. THE SAFE DIRECTION IS PER ROLE, NOT GLOBAL. "Assume opaque when the
 *      alpha is unresolvable" over-reports on a fill and HIDES a defect on an
 *      ink, because a faded ink read as solid clears AA. So an ink whose alpha
 *      this cannot resolve is refused rather than assumed. The matching
 *      backdrop refusal below is written and UNEXERCISED: Chromium returns
 *      this page's screenshot as PNG colour type 2, which has no alpha
 *      channel at all, so no mutation drives it. Read it as a guard on a
 *      decode path that could change, not as a mechanism this page proves.
 *
 * Usage:
 *   node scripts/check-ops-contrast.mjs               # serve, check, report
 *   node scripts/check-ops-contrast.mjs --self-test   # prove the tool only
 *   node scripts/check-ops-contrast.mjs --verbose     # per-pass site counts
 *
 * Chrome: CHROME_PATH, or the usual install locations. No package manager, no
 * dependency: the PNG decoder and the CDP client are in this file.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';
const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];
const VIEWPORT = { width: 1440, height: 1000 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ---------------------------------------------------------------- server */

/* The shell reads no API and holds no session, so this serves files and
   nothing else. The one synthetic route is the self-test fixture, which is
   served rather than written to disk so that nothing about proving the tool
   can leak into what the tool measures. */
let fixtureHtml = '';

/* Self-test part G's page: six spellings of a nested browsing context, two
   author shadow roots, and five user-agent roots of which exactly one paints
   words no source reaches — so the three boundary censuses are proven by an
   executed assertion instead of by this comment. Served, not written to disk,
   for the same reason as the fixture above. The shell cannot reach five of the
   six frame spellings — its default-src 'none' blocks frame-src and
   object-src, and only about:srcdoc is exempt by spec — so this page is the
   only place they are exercised. */
const BOUNDARY_FRAG = '<!doctype html><html><body><p>framed text</p></body></html>';
const BOUNDARY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><text x="2" y="14">svg</text></svg>';
const BOUNDARY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>boundaries</title></head><body>
<iframe width="60" height="20" srcdoc="&lt;p&gt;srcdoc text&lt;/p&gt;"></iframe>
<iframe width="60" height="20" src="/__contrast-boundary-frag.html"></iframe>
<object type="text/html" data="/__contrast-boundary-frag.html" width="60" height="20"></object>
<embed type="text/html" src="/__contrast-boundary-frag.html" width="60" height="20">
<object type="image/svg+xml" data="/__contrast-boundary-frag.svg" width="60" height="20"></object>
<embed type="image/svg+xml" src="/__contrast-boundary-frag.svg" width="60" height="20">
<div id="shadowOpen"><template shadowrootmode="open">open root text</template></div>
<div id="shadowClosed"><template shadowrootmode="closed">closed root text</template></div>
<select><option>a user-agent root that must NOT be reported</option></select>
<input type="search" placeholder="a sourced placeholder that must NOT be reported">
<img alt="an empty user-agent root that must NOT be reported" width="20" height="20"
  src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<input type="reset" style="display:none">
<input type="submit" style="width:0;height:0;padding:0;border:0">
<input type="file" id="uaUnsourced">
</body></html>`;

/* Self-test part H's page. Every case is a <button> because the focus sweep's
   census is a real focusable census, and each one is isolated by 150px of
   plain white so that one case's ring can never land on another case's paint.

   The two H2 cases are the point of the page: ONE ring declaration, one
   colour, one width, and two answers — 1.61:1 and 13.08:1 — decided entirely
   by the sign of outline-offset. A tool that reads the focused element's own
   background, or the page's, gives the same number twice and is wrong once. */
const FOCUS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>focus</title>
<style>
  html, body { margin: 0; background: #FFFFFF; }
  .case { margin: 150px; background: #FFFFFF; }
  button { appearance: none; -webkit-appearance: none; border: 0; padding: 0; margin: 0;
    width: 60px; height: 40px; font: 0/0 monospace; color: transparent; border-radius: 0; }
  .wrap { background: #FFFFFF; padding: 40px; width: 140px; }
  .h1 { background: #FFFFFF; }
  .h1:focus-visible { outline: 4px solid #767676; outline-offset: 6px; }
  .h2out, .h2in { background: #000000; }
  .h2out:focus-visible { outline: 4px solid #CCCCCC; outline-offset: 8px; }
  .h2in:focus-visible { outline: 4px solid #CCCCCC; outline-offset: -8px; }
  .h3, .h3:focus, .h3:focus-visible { background: #FFFFFF; outline: none; }
  .h4 { background: #FFFFFF; }
  .h4:focus-visible { outline: none; box-shadow: 0 0 0 4px #767676; }
  .h5 { background: #FFFFFF; }
  .h5:focus-visible { outline: 4px solid rgba(118, 118, 118, 0.5); outline-offset: 6px; }
  .h6 { background: #FFFFFF; }
  .h6:focus-visible { outline: 4px solid #767676; outline-offset: 60px; }
  .h8 { background: #FFFFFF; }
  .h8:focus-visible { outline: 4px solid #767676; outline-offset: 26px; }
  .h7wrap { background: #B0B0B0; padding: 4px; width: 60px; }
  .h7 { background: #000000; }
  .h7:focus-visible { outline: 4px solid #999999; outline-offset: -8px; }
  .h7far { width: 60px; height: 12px; background: #B0B0B0; margin-top: 4px; }
  .h7:focus-visible ~ .h7far { background: #123456; }
</style></head><body>
<div class="case"><div class="wrap"><button class="h1"></button></div></div>
<div class="case"><div class="wrap"><button class="h2out"></button></div></div>
<div class="case"><div class="wrap"><button class="h2in"></button></div></div>
<div class="case"><div class="wrap"><button class="h3"></button></div></div>
<div class="case"><div class="wrap"><button class="h4"></button></div></div>
<div class="case"><div class="wrap"><button class="h5"></button></div></div>
<div class="case"><div class="wrap"><button class="h6"></button></div></div>
<div class="case"><div class="wrap"><button class="h8"></button></div></div>
<div class="case"><div class="wrap"><div class="h7wrap"><button class="h7"></button><div class="h7far"></div></div></div></div>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const synthetic = {
    '/__contrast-self-test.html': [MIME['.html'], () => fixtureHtml],
    '/__contrast-boundary-test.html': [MIME['.html'], () => BOUNDARY_HTML],
    '/__contrast-focus-test.html': [MIME['.html'], () => FOCUS_HTML],
    '/__contrast-boundary-frag.html': [MIME['.html'], () => BOUNDARY_FRAG],
    '/__contrast-boundary-frag.svg': ['image/svg+xml', () => BOUNDARY_SVG]
  }[url.pathname];
  if (synthetic) {
    res.writeHead(200, { 'Content-Type': synthetic[0], 'Cache-Control': 'no-store' });
    res.end(synthetic[1]());
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
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
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

/* ------------------------------------------------------------------- PNG */

/* Minimal decoder for the 8-bit images Chromium's screenshots produce.
   Dependency-free on purpose: this guard has to run wherever node does, and
   this repo has no package manager. Returns RGBA bytes. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;

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
    else if (type === 'tRNS') trns = Buffer.from(body);
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

  /* Undo the per-scanline filters (PNG spec 9.2). */
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

  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

/* ---------------------------------------------------------------- colour */

const srgbToLin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = ({ r, g, b }) =>
  0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);

/* WCAG 2.x contrast ratio. Both colours must already be opaque. */
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* Composite a possibly-translucent colour over an opaque one. */
function over(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a)
  };
}

/* Half a byte, in the 0..1 units `color(srgb …)` reports components in.

   The slack has to exist because Chromium's float round-trip through the
   mixing space overshoots for colours that are unambiguously IN gamut, and
   white itself does it: `color-mix(in srgb, oklch(1 0 0) 50%, white)` computes
   here to `color(srgb 0.999935 1.00003 1.00004)`. A gate at exactly 0..1
   refuses that, which means it refuses pure white and fails the run on a
   colour nothing is wrong with. `oklab` and `lab` overshoot the same way; the
   largest seen is 4e-5, a twenty-five-thousandth of the window. Both ends are
   pinned in part F2 rather than by this paragraph — the shape guards there
   bracket this constant from below, and a bound assertion caps it at one byte
   from above, because a window written in terms of itself is not a rounding
   allowance. The cap is a byte and not this half-byte on purpose: asserting
   the constant equals itself proves nothing.

   HOW FAR THIS CONSTANT MAY MOVE BEFORE SOMETHING GOES RED IS NOT WRITTEN
   DOWN, HERE OR IN F2. Part F2 works the band out from the browser's own
   serialisations, brackets each edge by calling the real gate either side of
   it, and prints the multiples. That is deliberate, and it is the whole of
   Stadiora/Aria#10365: the sentence this replaces said where a bound bit, the
   bound moved, and the sentence did not. A number a reader can rely on is a
   number this file computes at run time. */
const GAMUT_SLACK = 0.5 / 255;

/* The two serialisations getComputedStyle actually returns on this page.
   `color(srgb r g b / a)` is how Chromium writes a color-mix(), and its
   components are 0..1 floats rather than 0..255 bytes (CSS Color 4 §10) —
   reading them as bytes is not a dropped site but a wrong number, which is
   worse. Anything else returns null, and every caller turns null into a
   refusal by name rather than a skip.

   `color(srgb …)` is read only when its components are in gamut to within
   GAMUT_SLACK. Chromium does not clamp this serialisation, so a mix with a
   wide-gamut term hands back components outside 0..1 —
   `color-mix(in srgb, color(display-p3 1 0 0) 90%, white)` computes to
   `color(srgb 1.08372 -0.104021 -0.0350659)`, and scaling that by 255 invents
   the colour `#114-1B-9` and a confident ratio to go with it. It is refused
   instead. Chromium does clamp per channel when it PAINTS, so the pixel could
   be predicted, but that is a property of this rasteriser rather than of the
   stylesheet, and a predicted ink is the same confidently wrong number the
   paint-server refusal above exists to prevent. Carried across from the
   monorepo's oracle (Stadiora/Aria#10293).

   `slack` is a parameter so that part F2 can locate the window's edges by
   calling THIS gate either side of each candidate, rather than restating the
   comparison in the assertion and pinning a restatement. Every caller outside
   F2 takes the default. */
function parseColor(str, slack = GAMUT_SLACK) {
  const s = String(str).trim();
  const num = (t) => (/%$/.test(t) ? Number(t.slice(0, -1)) / 100 : Number(t));
  let m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const a = parts.length > 3 ? num(parts[3]) : 1;
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }
  m = s.match(/^color\(\s*srgb\s+([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.slice(0, 3).map(num);
    const a = parts.length > 3 ? num(parts[3]) : 1;
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    if ([r, g, b].some((v) => v < -slack || v > 1 + slack)) return null;
    /* Clamping is not the gate's job done twice. The gate lets a component
       through at 1.00003, and 1.00003 * 255 is 255.008 — a byte that cannot
       exist, fed to a luminance formula whose domain is 0..255. */
    const byte = (v) => Math.min(255, Math.max(0, v * 255));
    return { r: byte(r), g: byte(g), b: byte(b), a };
  }
  return null;
}

/* Why an ink cannot be resolved to the colour the glyphs are painted in, or
   null when it can.

   A paint server — `url("#g") rgb(238, 242, 247)` — is named before the parse
   is attempted. parseColor is anchored, so it would refuse this value anyway;
   what the url() test adds is the REASON, which is the difference between
   "teach the parser this syntax" and "this ink is a live reference that no
   parser can resolve". The anchoring is the load-bearing half: an unanchored
   rgb() regex matches the trailing FALLBACK, a colour that never paints, and
   hands back a confident wrong ratio — black glyphs reported against a
   near-white fallback is a 1:1 site read as 21:1. A wrong number is worse
   than an absent one, and part E of the self-test drives both halves. */
function unjudgeableReason(ink) {
  if (/^\s*url\(/.test(ink)) return 'paint-server fill';
  return parseColor(ink) ? null : 'unreadable ink syntax';
}

const hex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/* ----------------------------------------------------------- measurement */

/* Every text site needs 4.5:1. WCAG's large-text allowance -- 3.0:1 at 24px,
   or at 18.66px bold -- is deliberately NOT implemented.

   Both of its numbers would have to come from getComputedStyle().fontSize,
   which is the size the stylesheet ASKED for and not the size the glyphs land
   at. Round 7 of this PR's review bought the weaker threshold with
   `font-size: 24px; transform: scale(.48)`, which renders glyphs NARROWER
   than the untouched 11.5px pill; round 8 then reproduced the identical
   output with `scale: .48` (an independent transform property Chromium keeps
   out of computed `transform`) and again with `font-size-adjust: .2`, which
   is not a transform at all. Each spelling was reachable from a stylesheet
   with no change to this file. Refusing them by name cost one round per
   spelling and closed nothing.

   So the allowance is gone rather than defended, and nothing here reads the
   rendered size. The cost is real and runs the safe way for an ink: text that
   WCAG AA would genuinely let sit at 3.0:1 fails this check. It costs 0 sites
   today -- with the allowance deleted the sweep still passes at 1632, and the
   lowest ratio it measures on any unfrozen site is 5.20:1 -- and a site that
   ever earns it goes in KNOWN_BELOW_AA with an issue, where it is reconciled
   in both directions rather than granted silently. */
const AA_RATIO = 4.5;

/* The quantisation both sweeps sample surfaces at, in bytes per channel. One
   constant because there is one decision: how near two shades have to be
   before they are the same surface. */
const BUCKET = 8;

/* Every backdrop colour inside a rect on the plate, with the share of the box
   each one holds.

   Quantised into coarse buckets first, because the panel gradients spread a
   surface over dozens of near-identical shades and no single shade holds a
   majority — the modal shade of a gradient is noise, and a check that demands
   one dominant colour refuses every card on this page. Each bucket reports the
   MEAN of its real pixels, so bucketing decides which pixels to average and
   never rounds the answer itself.

   EVERY bucket is returned and every bucket counts, with no minimum share: a
   surface that covers a small part of a run is still painted under part of a
   letter. A floor here reads as housekeeping and behaves as a hole — at 5%, a
   1px stripe every 40px sank a site measuring 1.63:1 without a word. */
function sampleBackdrops(plate, rects, scale) {
  const counts = new Map();
  let translucent = 0;
  let total = 0;
  for (const rect of rects) {
    const x0 = Math.max(0, Math.round(rect.x * scale));
    const y0 = Math.max(0, Math.round(rect.y * scale));
    const x1 = Math.min(plate.width, Math.round((rect.x + rect.width) * scale));
    const y1 = Math.min(plate.height, Math.round((rect.y + rect.height) * scale));
    if (x1 <= x0 || y1 <= y0) continue;
    total += (x1 - x0) * (y1 - y0);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * plate.width + x) * 4;
        const r = plate.data[i], g = plate.data[i + 1], b = plate.data[i + 2];
        if (plate.data[i + 3] !== 255) translucent++;
        const key = ((r / BUCKET) | 0) * 65536 + ((g / BUCKET) | 0) * 256 + ((b / BUCKET) | 0);
        let e = counts.get(key);
        if (!e) counts.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
        e.n++; e.r += r; e.g += g; e.b += b;
      }
    }
  }
  if (!total) return null;
  const all = [...counts.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, share: e.n / total }))
    .sort((a, b) => b.share - a.share);
  return { all: all, translucent: translucent / total };
}

/* ------------------------------------------------- focus indicators, 1.4.11

   A DIFFERENT COMPARISON from everything above, and the reason this is a
   second sweep rather than a fifth preview state. Text is judged ink against
   the surface BEHIND it; a focus ring is judged against the surfaces BESIDE
   it — SC 1.4.11 asks for 3:1 between the indicator and its adjacent
   colours. Nothing in the text sweep can answer that: `:focus-visible` paints
   nothing until something is focused, the ring is not a text node so COLLECT
   never sees it, and the plate that makes the text sweep honest would hide
   the ring's own pixels.

   Getting the ADJACENT SURFACE wrong is the classic error in this
   measurement, and it was made once already in the numbers on aria-website
   PR #72 before a reviewer caught it. `outline-offset` is why: a ring with a
   positive offset is painted OUTSIDE the element's border box, so on a
   flush-fitting control it lands wholly on the parent's surface and never
   touches the element's own. A negative offset paints it inside, over the
   element. The same declaration therefore has to be judged against two
   different colours depending on one number in a stylesheet, and no amount
   of reading `background-color` off the focused element answers it.

   So nothing here models geometry. The ring is found by PHOTOGRAPHING the
   same clip twice, unfocused and focused, and looking at which pixels moved.
   Whatever the offset does, the pixels are where they are.

   The two roles run the conservative direction the OTHER way round, which is
   the lesson this file already carries for inks and fills:

     the ring is an INK. An indicator this tool cannot resolve exactly — a
       translucent outline colour, an indicator that is not an outline at all,
       a computed outline that paints no pixel — is REFUSED BY NAME. Assuming
       it opaque would invent a ratio in the flattering direction.

     the adjacent surface is a FILL. Every bucket beside the ring counts, the
       WORST one decides, and a surface holding a small share of the ring's
       perimeter is still a place the ring disappears against. */
const FOCUS_RATIO = 3;

/* How far around the element to photograph, in CSS px, smallest first. The
   clip has to contain the whole indicator AND a margin of the surfaces it
   sits on, so every candidate is checked for the changed region touching its
   own edge and the next size is tried when it does. The last entry is the
   whole document, where there is nothing beyond the clip to have missed. */
const FOCUS_PADS = [28, 120, Infinity];

/* Chebyshev radius, in device pixels, for "beside the ring".
   One, because one is what adjacent means. The pixels between the ring and
   its surface on a curved corner are blends of the two, and they are excluded
   from BOTH sides — a blend is neither the indicator nor the thing it has to
   contrast with, and averaging it into either moves the answer towards a pass.
   Sampling further than this reads a surface through the ring rather than
   beside it. */
const FOCUS_ADJACENT_RADIUS = 1;

/* Below this many unchanged pixels beside the ring there is nothing to take a
   worst-of over, so the site is refused instead of judged on a handful of
   corner pixels. Fail-closed for a shape this page does not currently
   produce: the thinnest ring it paints carries 119. */
const FOCUS_MIN_ADJACENT = 8;

/* Group a list of [r,g,b] pixels into surfaces the same way sampleBackdrops
   groups a rect, and for the same reason: a gradient is one surface spread
   over dozens of shades. Mean of the real pixels per bucket, every bucket
   returned, no minimum share. */
function bucketPixels(px) {
  const counts = new Map();
  for (const [r, g, b] of px) {
    const key = ((r / BUCKET) | 0) * 65536 + ((g / BUCKET) | 0) * 256 + ((b / BUCKET) | 0);
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  return [...counts.values()]
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }))
    .sort((a, b) => b.n - a.n);
}

/* Transitions and animations off, through CSSOM rather than a <style> tag:
   the page's CSP has no 'unsafe-inline', so an injected stylesheet element is
   blocked and would fail silently. `--force-prefers-reduced-motion` is NOT
   enough — it sets the media query, and a transition not written behind that
   query still runs. Two photographs of the same element mid-transition differ
   in pixels that have nothing to do with the indicator. */
const NO_MOTION = `(() => {
  const s = new CSSStyleSheet();
  s.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

/* Everything a keyboard could put a focus ring on, tagged so the measurement
   below can find each one again after a navigation-free re-query. Elements
   that paint nothing (display:none, zero box, disabled) are not focus sites;
   everything else is, including tabindex="-1", which a script can focus even
   though Tab does not reach it. */
const FOCUS_CANDIDATES = `(() => {
  const SEL = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.disabled) continue;
    if (r.width < 1 || r.height < 1) continue;
    el.setAttribute('data-focus-site', String(i));
    /* Something a human can find the control by, in the order the control
       itself prefers: its own words, then its accessible name, then the words
       a user-agent root paints for it, then its id. An empty string here
       would make a freeze entry unreadable and two different inputs
       indistinguishable. */
    const label = (el.textContent || '').replace(/\\s+/g, ' ').trim() ||
      (el.getAttribute('aria-label') || '').trim() ||
      (el.getAttribute('placeholder') || '').trim() ||
      (el.getAttribute('title') || '').trim() ||
      (el.id ? '#' + el.id : '');
    out.push({
      i,
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.trim() : '',
      tabindex: el.getAttribute('tabindex'),
      text: label.slice(0, 40)
    });
    i++;
  }
  return JSON.stringify(out);
})()`;

/* Elements that paint their own text, with everything needed to judge them.
   A string because CDP evaluates expressions, not functions. */
const COLLECT = `(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    /* Only elements with their own text, so a wrapper is not credited with its
       children's glyphs and then measured over the wrong box. */
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue;

    /* Form controls paint text that is in no child text node of theirs: a
       closed <select> reports its option through .selectedOptions, and a
       placeholder is a pseudo-element with no node at all. Both are primary UI
       text, measured over the control's own box, which is where the glyphs
       are. */
    let pseudo = null;
    if (el.tagName === 'SELECT') {
      text = (el.selectedOptions[0] || {}).textContent || '';
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.value) text = el.value;
      else if (el.placeholder) { text = el.placeholder; pseudo = '::placeholder'; }
    }

    text = text.replace(/\\s+/g, ' ').trim();
    if (!text) continue;

    const cs = getComputedStyle(el);
    /* ::placeholder carries its own colour, which is the whole reason it needs
       its own reading: the control's computed colour is a different value. */
    const inkStyle = pseudo ? getComputedStyle(el, pseudo) : cs;
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    /* A box smaller than a glyph is how this page spells "not shown" — .sr
       clips its text to 1x1 and paints nothing. display: contents produces
       the SAME zero rect and means the opposite: no box of its own while its
       text paints in full. Told apart by name, not merged — the run rects
       hand back .sr at its full text width, so gating on them instead would
       walk the clipped text straight into the sweep.

       Only display: contents is named here. Other ways to have no box while
       text paints (a zero-sized block with overflow: visible, for one) are
       still dropped in silence; see NOT COVERED. */
    const boxless = (rect.width < 2 || rect.height < 2) && cs.display === 'contents'
      ? 'display: contents — no box of its own, and its text paints in full'
      : null;
    if (!boxless && (rect.width < 2 || rect.height < 2)) continue;
    /* offsetParent is an HTMLElement member and is undefined — not null — on
       every SVGElement, so gating SVG on it drops every chart label. For SVG
       the display, visibility, opacity and rect gates above cover the same
       ground. */
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    if (!boxless && !isSvg && !el.offsetParent && cs.position !== 'fixed') continue;

    /* Parked off the canvas — a skip link at left:-9999px until it takes
       focus. It paints nowhere the screenshot covers, so there is no backdrop
       to sample and a refusal here would be noise about a box that is not on
       the page. Its focused state is NOT measured; see NOT COVERED. */
    const ax = rect.x + window.scrollX, ay = rect.y + window.scrollY;
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    if (!boxless && (ax + rect.width <= 0 || ay + rect.height <= 0 || ax >= docW || ay >= docH)) continue;

    const key = el.tagName + (pseudo || '') + ':' + rect.x + ':' + rect.y + ':' + text;
    if (seen.has(key)) continue;
    seen.add(key);

    /* WCAG 1.4.3 exempts text that is part of an inactive component. Counted
       rather than dropped, so nothing escapes the sweep by being marked
       disabled without anyone noticing.

       :disabled alone is NOT enough, and round 7 of this PR's review proved
       it: <fieldset disabled> is both an element HTML lets be disabled and a
       container, so closest(':disabled') reaches every descendant and one
       attribute took 56 status badges out of the sweep, the issue's own
       headline 3.03:1 defect among them. Those badges are neither inactive
       nor controls. So the nearest :disabled ancestor-or-self must ALSO be a
       control that paints its own text. fieldset and form are deliberately
       absent from that list; they are containers, and WCAG 1.4.3 exempts a
       component, not everything inside a box. aria-disabled is absent too: it
       describes a component that is still operable and still meant to be
       read. */
    const CONTROL = ['button', 'input', 'select', 'textarea', 'option', 'optgroup'];
    const disabledHost = el.closest(':disabled');
    const inactive = !!disabledHost &&
      CONTROL.includes(disabledHost.tagName.toLowerCase());

    /* String comparisons rather than a regex: this probe is a template literal,
       so a backslash here is read twice and a regex written the obvious way
       silently matches something else. */
    const paintsOwn = (st) => st.backgroundImage !== 'none' ||
      (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent');
    const nameOf = (n) => n.tagName.toLowerCase() +
      ((n.getAttribute('class') || '') ? '.' + n.getAttribute('class').trim().split(' ')[0] : '');

    /* Properties other than colour and opacity that decide the pixel a glyph
       paints. This tool models exactly two channels, so each of these is
       REFUSED by name rather than approximated: under any of them the ink
       still computes to the designed colour while the page paints something
       else, and reporting the designed colour is the flattering direction for
       an ink. Refusals fail the run, with no exception: WCAG 1.4.3's
       inactive-component exemption is now applied AFTER the refusal check, so
       a disabled control whose text is painted by something unmodelled is
       reported, not waved through.

       Not a list of everything CSS can do to a glyph — a list of what this
       tool will not stand behind, and it does not close. mask-image and
       clip-path are two more ways to spell a fade and are NOT here: they are
       neither modelled nor refused, and text under one is measured as though
       it were painted in full. Named in NOT COVERED rather than added, because
       enumerating CSS is the losing half of this trade. backdrop-filter is a
       deliberate omission of a different kind: it alters the backdrop, which
       the screenshot samples correctly. */
    const unmodelled = (st, n) => {
      if (st.filter && st.filter !== 'none') {
        return 'filter "' + st.filter + '" on ' + nameOf(n);
      }
      if (st.mixBlendMode && st.mixBlendMode !== 'normal') {
        return 'mix-blend-mode "' + st.mixBlendMode + '" on ' + nameOf(n);
      }
      const sw = parseFloat(st.webkitTextStrokeWidth);
      if (Number.isFinite(sw) && sw > 0) {
        return '-webkit-text-stroke ' + st.webkitTextStrokeWidth + ' on ' + nameOf(n);
      }
      /* SVG paint is fill THEN stroke, and stroke is the SVG spelling of the
         property above. This one completes the model the tool already
         declares for SVG — ink from fill, alpha from fill-opacity — rather
         than reaching outside it. Only on the text element: stroke inherits,
         so an ancestor that sets it is already visible here. */
      if (n.namespaceURI === 'http://www.w3.org/2000/svg' &&
          st.stroke && st.stroke !== 'none' &&
          st.stroke !== 'rgba(0, 0, 0, 0)' && st.stroke !== 'transparent' &&
          parseFloat(st.strokeWidth) > 0) {
        return 'SVG stroke ' + st.stroke + ' at ' + st.strokeWidth + ' on ' + nameOf(n);
      }
      /* ::first-line and ::first-letter repaint an element's OWN text — no
         new text node, no new box, no change to the site count, and the
         plate lifts them correctly because its transparent fill inherits in.
         So nothing else here can see them: the ink read asks the element,
         which still says the designed colour, while the page paints the
         pseudo-element's. Compared as VALUES rather than scanned for as
         rules, and checked on every ancestor too, because first-line styles
         propagate into inline descendants and getComputedStyle reports them
         only on the block that owns the rule.

         Measured, not assumed: -webkit-text-fill-color does NOT apply through
         either pseudo-element in Chromium (glyphs stay the element's colour),
         so color is the whole channel here — and reading
         webkitTextFillColor || color on BOTH sides keeps an element-level
         fill colour, which does win, from reading as a difference. */
      if (n.namespaceURI !== 'http://www.w3.org/2000/svg') {
        const own = st.webkitTextFillColor || st.color;
        for (const pe of ['::first-line', '::first-letter']) {
          const ps = getComputedStyle(n, pe);
          const pink = ps.webkitTextFillColor || ps.color;
          if (pink && own && pink !== own) {
            return pe + ' repaints this text ' + pink + ' where ' + nameOf(n) +
              ' asks for ' + own;
          }
        }
      }
      return null;
    };

    let alphaChain;
    /* The ink is read from the pseudo-element, and so are the things that can
       make that reading a lie. opacity, filter, mix-blend-mode and
       -webkit-text-stroke all apply to ::placeholder in Chromium and all leave
       the ELEMENT reporting the defaults, so neither unmodelled(cs, el) nor
       the alpha chain below — both of which walk the element and its
       ancestors — can see any of them. Refused rather than modelled, the
       disposition every other unmodelled painter gets. Round 11 of this PR's
       review demonstrated the first two: opacity: .28 on the shell's one
       ::placeholder rule takes the glyphs from 5.86:1 to 1.50:1 and the sweep
       exited 0 at its full 1632. */
    let pseudoPaint = null;
    if (pseudo) {
      const po = Number(inkStyle.opacity);
      const psw = parseFloat(inkStyle.webkitTextStrokeWidth);
      if (Number.isFinite(po) && po !== 1) pseudoPaint = 'opacity ' + inkStyle.opacity;
      else if (inkStyle.filter && inkStyle.filter !== 'none') pseudoPaint = 'filter "' + inkStyle.filter + '"';
      else if (inkStyle.mixBlendMode && inkStyle.mixBlendMode !== 'normal') pseudoPaint = 'mix-blend-mode "' + inkStyle.mixBlendMode + '"';
      else if (Number.isFinite(psw) && psw > 0) pseudoPaint = '-webkit-text-stroke ' + inkStyle.webkitTextStrokeWidth;
      if (pseudoPaint) pseudoPaint += ' on ' + nameOf(el) + pseudo;
    }
    let unmodelledPaint = pseudoPaint || unmodelled(cs, el);
    {
      let alpha = Number(cs.opacity);
      if (isSvg) {
        const fo = Number(inkStyle.fillOpacity);
        if (Number.isFinite(fo)) alpha *= fo;
      }
      let surface = null;
      /* The innermost thing at or below the current ancestor that paints a
         surface the glyphs sit on. Group opacity composites a subtree as a
         unit: the glyphs blend with that surface FIRST and the pair is faded
         together, so the product below is the true glyph alpha only while no
         painter sits inside a fade. The painter need not be the faded element
         and need not be faded itself. */
      let painterInside = paintsOwn(cs) ? nameOf(el) : null;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (!unmodelledPaint) unmodelledPaint = unmodelled(acs, a);
        const paints = paintsOwn(acs);
        const ao = Number(acs.opacity);
        if (ao < 1) {
          alpha *= ao;
          const inside = painterInside || (paints ? nameOf(a) : null);
          if (inside && !surface) surface = inside + ' inside the fade on ' + nameOf(a);
        }
        if (paints && !painterInside) painterInside = nameOf(a);
      }
      alphaChain = { alpha: alpha, surface: surface };
    }

    const runs = [];
    if (!pseudo) {
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rr of range.getClientRects()) {
          if (rr.width >= 1 && rr.height >= 1) {
            runs.push({
              x: rr.x + window.scrollX, y: rr.y + window.scrollY,
              width: rr.width, height: rr.height
            });
          }
        }
      }
    }

    out.push({
      tag: el.tagName.toLowerCase() + (pseudo || ''),
      /* SVG text is painted by fill, not by color. Reading color there reports
         the INHERITED ink while the glyphs paint something else — a wrong
         answer, not a missing one. And class on an SVGElement is an
         SVGAnimatedString, so it has to be read as an attribute or every SVG
         row prints a blank selector. */
      cls: (isSvg ? el.getAttribute('class')
        : (typeof el.className === 'string' ? el.className : '')) || '',
      text: text.length > 42 ? text.slice(0, 42) + '\\u2026' : text,
      /* -webkit-text-fill-color, not color: it beats color for the glyph
         interior and its initial value resolves to the same colour, so
         reading it is correct whether or not the page sets it. */
      color: isSvg ? inkStyle.fill : (inkStyle.webkitTextFillColor || inkStyle.color),
      /* The alpha the glyphs are actually composited at, not this element's
         own opacity. opacity does not inherit, so a fade on an ANCESTOR
         leaves cs.opacity at 1 here while the glyphs are painted through it —
         and reading an ink as solid is the flattering direction, which is the
         one that hides a defect. fill-opacity is the same channel for SVG
         text and is likewise not covered by opacity.

         Group opacity composites a subtree as a unit, so the product is exact
         only while nothing inside a fade paints a surface under the text.
         fadedSurface says whether something does; measureSites refuses those
         rather than reporting a number it cannot stand behind. */
      opacity: alphaChain.alpha,
      fadedSurface: alphaChain.surface,
      /* Set when this element or an ancestor uses a property that decides the
         painted glyph and that this tool does not model. Named, not guessed
         at: measureSites turns it into a refusal, and refusals fail the run. */
      unmodelledPaint: unmodelledPaint,
      /* Set when the element has no box to sample or gate on while its text
         is painted. measureSites refuses it; it is never dropped. */
      boxless: boxless,
      inactive: inactive,
      fontSize: parseFloat(inkStyle.fontSize) || parseFloat(cs.fontSize),
      rect: {
        x: rect.x + window.scrollX, y: rect.y + window.scrollY,
        width: rect.width, height: rect.height
      },
      /* One rect per line of this element's OWN text, from a Range over its
         direct text nodes — children's boxes excluded, wrapped lines kept
         apart. Empty for a ::placeholder, whose glyphs have no node to range
         over; the control's own box is the fallback there, and that is where
         a placeholder paints. ::before and ::after are not collected at all —
         GENERATED_TEXT fails the run on them instead. */
      rects: runs.length ? runs : [{
        x: rect.x + window.scrollX, y: rect.y + window.scrollY,
        width: rect.width, height: rect.height
      }]
    });
  }
  return JSON.stringify(out);
})()`;

/* Text this tool cannot reach: generated content.

   A ::before or ::after carrying words has no text node to range over and no
   box of its own that getBoundingClientRect will hand back, so the collector
   never sees it and the sweep would be silently short by one site. Rather
   than measure it badly, the run FAILS if the page paints any — an unreadable
   pseudo-element would otherwise ship with the sweep reporting the same
   "every site meets AA" it reports when there is none.

   ::marker is the third pseudo-element that paints text and it is censused
   too, by a different signal: its content computes to "normal" whatever the
   page says, and the words come from list-style-type. So the test is
   display: list-item with a list-style-type other than none.

   Three pseudo-elements CENSUSED — not a claim about how many can paint
   text. This tool meets three more elsewhere: ::placeholder is collected and
   READ from its own style (see inkStyle in COLLECT), and ::first-line and
   ::first-letter repaint the element's own text and are REFUSED by name in
   unmodelled(). Six handled, by three different mechanisms, and the list is
   not closed — ::selection, ::target-text and the highlight pseudos repaint
   text too and are neither censused, read nor refused. See NOT COVERED.

   `content: ''` — the decorative case this page actually uses for rings and
   glows — carries no text and is not flagged. */
const GENERATED_TEXT = `(() => {
  const found = [];
  const nameOf = (el) => el.tagName.toLowerCase() +
    ((el.getAttribute('class') || '') ? '.' + el.getAttribute('class').trim().split(' ').filter(Boolean).join('.') : '');
  for (const el of document.querySelectorAll('*')) {
    /* display is "list-item", or a two-value form like "inline list-item".
       Split on a literal space rather than a regex: this probe is a template
       literal, so a backslash class here would be read twice. */
    const own = getComputedStyle(el);
    if (own.display.split(' ').includes('list-item') &&
        own.listStyleType !== 'none' &&
        own.visibility !== 'hidden' && Number(own.opacity) !== 0) {
      found.push(nameOf(el) + '::marker paints ' + own.listStyleType);
    }
    for (const where of ['::before', '::after']) {
      const cs = getComputedStyle(el, where);
      const content = cs.content;
      if (!content || content === 'none' || content === 'normal') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const quoted = [...content.matchAll(/"((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => m[1]).join('');
      const computed = /counter\\(|counters\\(|attr\\(|open-quote|close-quote/.test(content);
      if (!quoted.trim() && !computed) continue;
      found.push(el.tagName.toLowerCase() +
        ((el.getAttribute('class') || '') ? '.' + el.getAttribute('class').trim().split(/\\s+/).join('.') : '') +
        where + ' paints ' + content);
    }
  }
  return JSON.stringify({ found: found.slice(0, 8), count: found.length });
})()`;

/* Hide every glyph so a screenshot shows the paint at each text run without
   the text itself -- what is behind the glyphs, plus anything painted over
   them, which this cannot tell apart. See NOT COVERED in ops/README.md.
   Colour and visibility do not affect layout, so the plate lines up with the
   real page pixel for pixel. */
const PLATE_CSS = `
  *, *::before, *::after {
    color: transparent !important;
    /* -webkit-text-fill-color beats color for the glyph INTERIOR, so a plate
       that clears only color leaves the glyphs painted wherever this is set —
       and PLATE_HOLDS, reading color, would report the plate held. */
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    -webkit-text-stroke-color: transparent !important;
    caret-color: transparent !important;
  }
  /* ::placeholder is matched by none of the selectors above, and its own
     colour declaration beats the originating element's inherited transparent.
     Where a page sets that colour, placeholder glyphs paint ON the plate
     without this line -- the contamination the plate exists to prevent.
     PROVEN ON THE FIXTURE ONLY: self-test part C sets the colour explicitly,
     and deleting this line leaves the real shell's plate band byte-identical.
     Not because the shell sets no ::placeholder colour -- it does, at
     aria.css .field input::placeholder -- but because the * rule's inherited
     transparent text-fill beats that colour and already lifts those glyphs.
     A page that spells its placeholder ink as -webkit-text-fill-color on the
     pseudo-element instead would NOT be lifted by this line; that case is not
     covered. Fail-closed only for the colour spelling. PLATE_HOLDS cannot speak for it either: it iterates
     elements with their own text nodes, and a placeholder has none. */
  ::placeholder { color: transparent !important; }
  /* An SVG that contains text is a SURFACE that text sits on — its bars and
     areas are the backdrop for those labels — so hiding it wholesale would
     sample the card behind the chart instead of the mark the label sits on.
     Neutralise SVG text, which is painted by fill and untouched by the color
     rule above, keep chart geometry, and hide only text-free SVGs, which are
     decorative icons and pure foreground. */
  /* SVG paints fill THEN stroke, so clearing fill alone leaves a stroked
     label painting on the plate — glyph pixels in the very sample the plate
     exists to keep clean. A 2px stroke on a 10px label measured 71% of the
     sampled backdrop. */
  svg text { fill: transparent !important; stroke: none !important; }
  svg:not(:has(text)), img, canvas { visibility: hidden !important; }
`;

/* The page sets `style-src 'self'`, which blocks an injected <style> element
   outright. A constructable stylesheet is CSSOM rather than markup, so it
   applies where a <style> would be dropped — and if it is ever dropped too,
   the check below is what says so, rather than a plate with glyphs on it
   passing for a backdrop. */
const APPLY_PLATE = `(() => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(${JSON.stringify(PLATE_CSS)});
  window.__contrastPlate = sheet;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

const REMOVE_PLATE = `(() => {
  document.adoptedStyleSheets = document.adoptedStyleSheets
    .filter((s) => s !== window.__contrastPlate);
  delete window.__contrastPlate;
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

/* Did the plate actually take? A plate that silently failed to apply leaves
   glyphs in the screenshot, and glyph pixels in a backdrop sample move the
   ratio in whichever direction the ink happens to lie — it can hide a failure
   as easily as invent one. So every element the sweep is about to judge is
   asked, on the plated page, what colour it is painting its text in. */
const PLATE_HOLDS = `(() => {
  const lit = [];
  for (const el of document.querySelectorAll('*')) {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue;
    if (!text.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    /* Read the same channel the glyph interior is painted from, or this
       assertion answers about a property the page is not using. */
    const ink = isSvg ? cs.fill : (cs.webkitTextFillColor || cs.color);
    const transparent = (v) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent' ||
      /^color\\(srgb [^)]*\\/ 0\\)$/.test(v);
    /* SVG text paints fill AND stroke. Asking only about fill answers about
       one of the two channels and reports the plate held while the other one
       is still painting glyphs into the backdrop sample. */
    const strokeLit = isSvg && cs.stroke && cs.stroke !== 'none' &&
      !transparent(cs.stroke) && parseFloat(cs.strokeWidth) > 0;
    const name = el.tagName.toLowerCase() +
      ((el.getAttribute('class') || '') ? '.' + el.getAttribute('class').trim().split(/\\s+/).join('.') : '');
    if (!transparent(ink)) lit.push(name + ' paints ' + ink);
    if (strokeLit) lit.push(name + ' strokes ' + cs.stroke + ' at ' + cs.strokeWidth);
  }
  return JSON.stringify({ lit: lit.slice(0, 8), count: lit.length });
})()`;

/* ------------------------------------------------------------------ run */

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const selfTestOnly = args.includes('--self-test');
const failures = [];
const note = (m) => console.log('ok  ' + m);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || '/tmp';
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-contrast-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

let cdp;
let initScript = null;

async function setTheme(theme) {
  if (initScript) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  }
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ops-theme', ${JSON.stringify(theme)}); } catch (e) {}`
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme: theme.js falls back to
     prefers-color-scheme when nothing is stored, so matching them would make a
     failed storage write look like a success. The theme that actually painted
     is asserted after every load. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, { settle = 900 } = {}) {
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
}

/* Every walk in this file — COLLECT, GENERATED_TEXT, PLATE_HOLDS — is a
   `document.querySelectorAll('*')`, and none of them enters a shadow root.
   Round 8 of this PR's review put a declarative shadow root on the pill row:
   eight sites left the sweep with no site row, no refusal and no census
   entry, the headline 3.03:1 defect among them, and the run still printed
   that every rendered text site met AA.

   Censused over CDP rather than in the page, because `el.shadowRoot` is null
   for a CLOSED root: measured here with a closed declarative root on this
   host, the in-page read reports nothing while DOM.getDocument with
   pierce: true reports `shadowRootType: "closed"`. An in-page census would
   cover half the class and read as though it covered all of it.

   This refuses; it does not measure. Piercing the sweep into shadow trees
   means ranges, plate rules and the `*` selector all crossing the boundary,
   which is analysis added mid-review. The shell carries no AUTHOR shadow root
   in any of the eight passes, so refusing them costs 0 sites.

   USER-AGENT roots are not refused here. Every one of the shipped page's four
   — one <select>, its two <option>s and one <input> — paints text COLLECT has
   a source for, so refusing them would be red on code that is measured. The
   ones that paint text COLLECT has NO source for are refused separately, by
   uaTextNoSource() below; read that function for what this one leaves alone
   and why. */
async function shadowHosts() {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const found = [];
  const walk = (n) => {
    for (const r of n.shadowRoots || []) {
      if (r.shadowRootType !== 'user-agent') {
        found.push(String(n.nodeName || '?').toLowerCase() + ' (' + r.shadowRootType + ')');
      }
      walk(r);
    }
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return found;
}

/* A USER-AGENT shadow root can paint text into the page that COLLECT has no
   way to read. COLLECT sources a control's words from its own text nodes, from
   .selectedOptions, from .value and from .placeholder; when the browser paints
   words that are in none of those, the element leaves the sweep with no site,
   no refusal and no census entry, and the judged count does not move — so
   nothing about the run looks different.

   Round 10 of this PR's review demonstrated four of them, each reachable from
   shell-v2.html with no change to this tool and each painting at 1.13:1 in
   light: <input type="file"> ("Choose File / No file chosen"), <input
   type="date"> with no value ("mm/dd/yyyy"), <input type="submit"> with no
   value ("Submit"), and <img alt> on a broken src. All four exited 0 at 1632
   while the run printed that every text site it reaches meets AA. The control
   is what makes it a defect rather than a limit: the same element at the same
   anchor with the same ink, <input type="date" value="2026-09-20">, routes its
   identical glyphs through .value and exits 1 at 1.08:1.

   Refused, not measured — the words are in a tree the ranges, the plate and
   the `*` walk do not enter, so there is no box this tool can honestly sample
   for them.

   The test is behavioural, not a tag list: DOM.getDocument with pierce: true
   returns the user-agent root's own text nodes, so "this root paints words" is
   answered by the browser rather than enumerated here. A host is refused only
   when all of these hold, which is why the shipped page refuses none:

     - its user-agent root's subtree carries non-whitespace text, so something
       is painted. A working <img>, <input type="range">, <input type="color">,
       <progress> and <meter> all report an empty root and are never censused;
     - COLLECT's own rule, run on the host, produces a DIFFERENT string
       from the one the root paints, or none at all. A match is the only
       thing that shows the glyphs in this root are the glyphs the sweep
       judged, and it is what exonerates the shipped <select> (.selectedOptions
       gives "Last 7 days", the root paints "Last 7 days"), its <input>
       (.placeholder) and both <option>s (own text node). Round 11 replaced an
       existence test here: .placeholder = " " is truthy while COLLECT's trim
       drops the site, and .placeholder = "never painted" on a submit button
       sources words its root never paints;
     - the host is visible and has a box of at least 2x2, the same gates
       COLLECT applies, so a control the page has hidden is not reported.

   A consequence worth stating because it is a cost, not a win: <video controls>
   and <audio controls> are refused whatever they contain. Their root paints a
   running time and a row of labels this tool cannot reach, and their fallback
   content — which Chromium never renders — does not match it. The shell
   carries neither.

   What this still does not reach is text a user-agent root paints OUTSIDE the
   page — the <option> list of an open <select>, which the browser draws in a
   platform popup that is not in the screenshot. Nothing in the page's own
   styling decides its contrast. */
async function uaTextNoSource() {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const textOf = (n) => {
    let t = n.nodeType === 3 ? String(n.nodeValue || '') : '';
    for (const c of n.children || []) t += textOf(c);
    for (const r of n.shadowRoots || []) t += textOf(r);
    return t;
  };
  const hosts = [];
  const walk = (n) => {
    for (const r of n.shadowRoots || []) {
      if (r.shadowRootType === 'user-agent') {
        const text = textOf(r).replace(/\s+/g, ' ').trim();
        if (text) hosts.push({ id: n.backendNodeId, name: String(n.nodeName || '?').toLowerCase(), text });
      }
      walk(r);
    }
    for (const c of n.children || []) walk(c);
  };
  walk(root);

  /* COLLECT's own rule, returning the STRING it would measure so it can be
     COMPARED with the words the root actually paints — which this function is
     already holding. Asking whether a source EXISTS is a different question,
     and round 11 of this PR's review showed what the difference costs:
     placeholder=" " makes .placeholder truthy while COLLECT's own trim drops
     the site, so a date input painting mm/dd/yyyy at 1.13:1 left the sweep at
     exactly 1632; placeholder="never painted" on a submit button sources words
     the root never paints, and the Submit it does paint went unmeasured.
     A match is the only thing that shows the glyphs in this root are the
     glyphs the sweep judged. */
  const SOURCED = `function () {
    let text = '';
    for (const node of this.childNodes) if (node.nodeType === 3) text += node.nodeValue;
    if (this.tagName === 'SELECT') text = (this.selectedOptions[0] || {}).textContent || '';
    else if (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA') {
      if (this.value) text = this.value;
      else if (this.placeholder) text = this.placeholder;
    }
    return text.replace(/\\s+/g, ' ').trim();
  }`;
  const PAINTS = `function () {
    const cs = getComputedStyle(this);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = this.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }`;

  const found = [];
  for (const host of hosts) {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: host.id });
    const ask = async (fn) => {
      const res = await cdp.send('Runtime.callFunctionOn',
        { objectId: object.objectId, functionDeclaration: fn, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result.value;
    };
    const sourced = await ask(SOURCED);
    const explained = sourced !== '' && sourced === host.text;
    const paints = explained ? false : await ask(PAINTS);
    await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
    if (paints) found.push(`${host.name} "${host.text.slice(0, 60)}"`);
  }
  return found;
}

/* A NESTED BROWSING CONTEXT is the other boundary these walks cannot cross,
   and it is worse than a shadow root: a frame is a separate document, so the
   shell's querySelectorAll('*') does not reach it, the plate stylesheet is
   not installed in it and no Range can be taken over its text — while it
   paints into the same screenshot, at full size, on top of the page.

   Round 9 of this PR's review replaced the pill span with an <iframe srcdoc>
   rendering the same pill from the same stylesheet and swapped .pill.acc to
   the wrong token: the sweep dropped from 1632 sites to 1624, exited 0, and
   still printed that every text site it reaches meets AA — while the pill in
   the frame painted at 2.89:1, worse than the 3.03:1 this guard exists for.
   CSP does not prevent this: shell-v2.html is default-src 'none' with no
   frame-src, and about:srcdoc is exempt from CSP by spec.

   Censused over CDP for the same reason as shadow roots, and a stronger one:
   <embed> reports contentDocument === null to script in the page even for
   HTML it is hosting, so an in-page census reads it as empty. Page.getFrameTree
   reports the CONTEXT rather than the element that spells it, so this is not a
   tag-name list and does not walk through a different spelling — which is
   asserted, not asserted-in-a-comment: self-test part G carries six spellings
   on one page and requires six.

   This refuses; it does not measure. The shell carries no nested browsing
   context in any of the eight passes, so refusing costs 0 sites — which is
   also why part G exists: on a page with no frame, a census that always
   returns nothing is indistinguishable from a working one. */
async function nestedFrames() {
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const found = [];
  const walk = (node) => {
    for (const child of node.childFrames || []) {
      found.push(child.frame.url || '(no url)');
      walk(child);
    }
  };
  walk(frameTree);
  return found;
}

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'probe threw');
  }
  return JSON.parse(res.result.value);
}

/* One screenshot of the page with the plate on, decoded, plus the scale it was
   captured at. Full page, not viewport: the shell is taller than 1000px and a
   viewport-clipped plate would sample nothing for everything below the fold. */
async function plateShot() {
  const page = await evaluate(`(() => JSON.stringify({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight
  }))()`);
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: page.width, height: page.height, scale: 1 }
  });
  const plate = decodePNG(Buffer.from(shot.data, 'base64'));
  return { plate, scale: plate.width / page.width, page };
}

/* Judge every collected site on the page as it currently stands: plate it,
   sample each box, route each ink. Split out from the navigation around it so
   the self-test drives the real pipeline rather than a re-implementation of
   it — a test that calls the classifier directly stays green when this stops
   consulting it. */
async function measureSites(targets, where) {
  await evaluate(APPLY_PLATE);
  const held = await evaluate(PLATE_HOLDS);
  if (held.count) {
    await evaluate(REMOVE_PLATE);
    throw new Error(`the plate did not take on ${where}: ${held.count} element(s) still ` +
      `paint their text — ${held.lit.join('; ')}. Every backdrop sampled through it would ` +
      'carry glyph pixels, which moves a ratio in either direction.');
  }
  const { plate, scale } = await plateShot();
  await evaluate(REMOVE_PLATE);

  const results = [];
  for (const t of targets) {
    /* No box means nothing to sample, and this tool's backdrop comes from a
       rect. Refused by name rather than dropped: a site that leaves the sweep
       without saying so is the shape lesson 3 above was ported to stop — the
       run would print the same "every site meets AA" with the site gone. */
    if (t.boxless) {
      results.push({
        ...t, unjudgeable: 'text with no box to sample',
        ink: String(t.color), detail: t.boxless
      });
      continue;
    }
    /* Sample where the GLYPHS are, not the element box. An element box holds
       its children's surfaces too — a row that contains a cyan chip is 12%
       cyan, and the row's own words sit on none of it — so a box sample asks
       about pixels no reader ever sees behind this text. The collector hands
       back one rect per text run for exactly this reason, and the box is the
       fallback only where there is no text node to range over.

       A horizontal band across the middle of each run: at mid-height a rounded
       rect spans its full width, so a pill is sampled on pill and never on the
       card showing through its corners, and the band keeps borders and inset
       rings out. */
    const bg = sampleBackdrops(plate, t.rects.map((r) => ({
      x: r.x, y: r.y + r.height * 0.25, width: r.width, height: r.height * 0.5
    })), scale);

    if (!bg || !bg.all.length) {
      results.push({ ...t, unjudgeable: 'no backdrop sampled', ink: String(t.color) });
      continue;
    }
    /* A backdrop role -- strictly, the topmost paint at the run with the
       glyphs lifted, which is the backdrop only while nothing paints above
       them. The conservative direction for a backdrop is NOT "assume opaque":
       a see-through surface means the real backdrop is whatever is behind the
       page, which this tool cannot see. */
    /* UNEXERCISED on this page: the screenshot decodes as PNG colour type 2,
       which carries no alpha, so translucent is structurally 0 and no
       mutation in this PR's battery drives this branch. Kept as a fail-closed
       guard if that decode path ever changes; claimed as nothing. */
    if (bg.translucent > 0) {
      results.push({
        ...t, unjudgeable: 'backdrop not opaque',
        ink: String(t.color), detail: `${(bg.translucent * 100).toFixed(0)}% of the band`
      });
      continue;
    }

    /* An ink role, refused in the conservative direction for an ink: assuming
       opaque here is what hides a defect, because a faded ink read as solid
       clears AA. */
    const ink = String(t.color);
    const reason = unjudgeableReason(ink);
    if (reason) {
      results.push({ ...t, unjudgeable: reason, ink });
      continue;
    }
    /* colour × opacity is the whole of this tool's ink model. filter, blending
       and a text stroke each decide the painted pixel outside that model, and
       under every one of them the ink still computes to the designed colour —
       so measuring would report the value the stylesheet asked for while the
       page paints something a reader cannot see, which is precisely the false
       green this guard exists to stop. Refused by name instead. The shell has
       one filter today, a :hover brightness the sweep never enters, so this
       costs no coverage. */
    if (t.unmodelledPaint) {
      results.push({
        ...t, unjudgeable: 'paint this tool does not model', ink: String(t.color),
        detail: t.unmodelledPaint
      });
      continue;
    }

    /* A fade with a painted surface inside it composites its subtree as a
       group: the glyphs blend with THAT surface first and the result blends
       with what is behind. Compositing the ink straight onto the sampled
       backdrop is then an approximation whose error runs in either direction,
       so it is refused by name instead. Nothing on the shell does this today,
       which is why this costs no coverage. */
    if (t.fadedSurface) {
      results.push({
        ...t, unjudgeable: 'a painted surface sits inside a fade', ink: String(t.color),
        detail: `${t.fadedSurface} composites these glyphs with a surface this tool ` +
          'samples separately'
      });
      continue;
    }
    const parsed = parseColor(ink);
    /* Ink alpha, element opacity, ancestor opacity and fill-opacity all
       multiply into the alpha the glyphs are composited at. */
    const alpha = (parsed.a === undefined ? 1 : parsed.a) *
      (Number.isFinite(t.opacity) ? t.opacity : 1);
    const need = AA_RATIO;

    /* Judge against the WORST sampled surface, not against the
       average of them and not against the widest.

       Averaging a two-tone backdrop invents a colour painted nowhere, and
       judging the widest lets a minority surface hide a failure: the hatch
       behind .fore is 22% amber every 6px, and a letter crossing a stripe is
       read at the stripe's ratio whatever the rest of the run does. This is
       the ink-role direction of the per-role rule — for an INK the unsafe
       assumption is the flattering one, so the worst surface decides.

       Every surface counts, however little of the run it covers. The cost is
       a false positive where a glyph run genuinely overlaps something its
       text does not sit on. That is why the collector ranges over text nodes:
       a row that contains a cyan chip no longer contributes the chip's
       pixels, because the chip is not inside the run. */
    let worstAt = null, bestAt = null;
    for (const c of bg.all) {
      const fg = over({ ...parsed, a: alpha }, c);
      const r = contrast(fg, c);
      if (!worstAt || r < worstAt.ratio) worstAt = { ratio: r, bg: c, fg };
      if (!bestAt || r > bestAt.ratio) bestAt = { ratio: r, bg: c, fg };
    }
    results.push({
      ...t,
      fg: hex(worstAt.fg), bg: hex(worstAt.bg), bgShare: worstAt.bg.share,
      surfaces: bg.all.length,
      best: bestAt.ratio, bestBg: hex(bestAt.bg),
      ratio: worstAt.ratio, need
    });
  }
  return results;
}

/* ------------------------------------------- the focus sweep's measurement */

/* One clipped photograph, decoded. Same capture path as plateShot, clipped
   rather than whole-page, because two photographs of the same rect subtract
   and two photographs of the whole shell do not fit in memory 416 times. */
async function focusShot(box) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
  });
  return decodePNG(Buffer.from(shot.data, 'base64'));
}

/* Where a keyboard actually goes, in order, by dispatching real Tab presses.

   Two jobs, and the second is the one that is easy to miss. The obvious job
   is the census: the set this returns is the set a keyboard user can reach,
   which is the set SC 1.4.11 is about. The other is MODALITY —
   `:focus-visible` is a heuristic about how focus arrived, and in a headless
   run that has never seen a key, `el.focus()` from script matches `:focus`
   and NOT `:focus-visible` on every element on this page (measured: 0 of 26).
   A sweep built on scripted focus alone would photograph 26 elements that
   paint no ring, find no changed pixels, and either report 26 missing
   indicators or — far worse — be "fixed" by relaxing the selector until it
   measured something. One real Tab flips the document into keyboard modality
   and scripted focus matches `:focus-visible` from then on (26 of 26).

   Presses are bounded at twice the candidate count plus a margin, and the
   walk stops when it returns to a stop it has already made. */
async function tabWalk(candidates) {
  const key = (type) => cdp.send('Input.dispatchKeyEvent', {
    type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
  });
  const order = [];
  const seen = new Set();
  const budget = candidates.length * 2 + 8;
  let offPage = 0;
  for (let n = 0; n < budget; n++) {
    await key('rawKeyDown');
    await key('keyUp');
    const at = await evaluate(`(() => {
      const el = document.activeElement;
      return JSON.stringify({
        site: el && el.getAttribute ? el.getAttribute('data-focus-site') : null,
        body: el === document.body || el === document.documentElement || !el
      });
    })()`);
    if (at.body) { offPage++; continue; }
    if (at.site === null) { order.push(null); continue; }
    const i = Number(at.site);
    if (seen.has(i)) break;
    seen.add(i);
    order.push(i);
  }
  return { order, offPage };
}

/* Judge every focus indicator on the page as it currently stands.

   Per element: photograph the clip unfocused, focus it, photograph the SAME
   clip, subtract. `changed` is where the indicator is. Then:

     - the clip must contain the change. A changed pixel on the clip's own
       edge means the indicator continues outside the photograph, so the pad
       escalates and the pair is retaken. Measuring a truncated ring would
       miss whichever surface it runs onto next, which is exactly the surface
       a positive outline-offset puts it on.

     - the RING CORE is the changed pixels painted EXACTLY the resolved
       outline colour. Exactly, byte for byte: a pixel that is nearly the
       outline colour is a blend of the ring and something else, and the
       something else is the surface this is trying to measure. The core is
       the large majority of the change (measured: 959 of 1104 on a nav item),
       so this is not a thin slice of a ring, it is the ring.

     - the ADJACENT SURFACES are the UNCHANGED pixels within one pixel of a
       core pixel, bucketed, worst bucket deciding. Anchoring this on the core
       rather than on the whole changed region is load-bearing and was got
       wrong first: the skip link's own box moves when it is focused, so
       anchoring on `changed` sampled the link against ITSELF and reported
       1.07:1 against a colour no ring touches.

   Everything this cannot resolve is refused BY NAME and the run fails on it,
   the same as the text sweep: a focus site that leaves the sweep quietly
   would keep the closing count looking identical. */
async function measureFocusIndicators(where) {
  await evaluate(NO_MOTION);
  const candidates = await evaluate(FOCUS_CANDIDATES);
  if (!candidates.length) {
    return { rows: [], census: { candidates: 0, reached: 0, order: [], offPage: 0 } };
  }

  await evaluate(`(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
    return JSON.stringify({ ok: 1 });
  })()`);
  const walk = await tabWalk(candidates);
  await evaluate(`(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
    return JSON.stringify({ ok: 1 });
  })()`);

  const rows = [];
  for (const c of candidates) {
    const row = { ...c, where };
    let measured = null;
    let refusal = null;

    for (const pad of FOCUS_PADS) {
      const geom = await evaluate(`(() => {
        const el = document.querySelector('[data-focus-site="${c.i}"]');
        if (!el) return JSON.stringify({ gone: true });
        const r = el.getBoundingClientRect();
        return JSON.stringify({
          x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height,
          docW: document.documentElement.scrollWidth,
          docH: document.documentElement.scrollHeight,
          sx: scrollX, sy: scrollY
        });
      })()`);
      if (geom.gone) { refusal = 'the element left the document between census and measurement'; break; }

      const box = pad === Infinity
        ? { x: 0, y: 0, width: geom.docW, height: geom.docH }
        : (() => {
            const x = Math.max(0, Math.floor(geom.x - pad));
            const y = Math.max(0, Math.floor(geom.y - pad));
            return {
              x, y,
              width: Math.min(geom.docW - x, Math.ceil(geom.x + geom.w + pad) - x),
              height: Math.min(geom.docH - y, Math.ceil(geom.y + geom.h + pad) - y)
            };
          })();
      if (box.width < 1 || box.height < 1) { refusal = 'the element has no photographable box'; break; }

      const before = await focusShot(box);
      const focused = await evaluate(`(() => {
        const el = document.querySelector('[data-focus-site="${c.i}"]');
        el.focus({ preventScroll: true });
        const chain = [];
        for (let n = el; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          chain.push({
            name: n.tagName.toLowerCase() +
              (n.getAttribute('class') ? '.' + n.getAttribute('class').trim().split(/\\s+/)[0] : ''),
            style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0,
            color: cs.outlineColor, offset: cs.outlineOffset
          });
          if (n === document.documentElement) break;
        }
        return JSON.stringify({
          took: document.activeElement === el,
          focusVisible: el.matches(':focus-visible'),
          sx: scrollX, sy: scrollY, chain
        });
      })()`);
      const after = await focusShot(box);
      await evaluate(`(() => {
        const el = document.querySelector('[data-focus-site="${c.i}"]');
        if (el) el.blur();
        window.scrollTo(0, 0);
        return JSON.stringify({ ok: 1 });
      })()`);

      /* The rail is position:sticky, so a scroll between the two shots moves
         it and every pixel under it reads as changed. preventScroll should
         stop that; this says so rather than assuming it. */
      if (focused.sx !== geom.sx || focused.sy !== geom.sy) {
        refusal = `focusing it scrolled the page from ${geom.sx},${geom.sy} to ` +
          `${focused.sx},${focused.sy}, so the two photographs are not of the same pixels`;
        break;
      }
      if (!focused.took) { refusal = 'the element refused focus, so nothing could be photographed'; break; }
      if (before.width !== after.width || before.height !== after.height) {
        refusal = 'the two photographs came back different sizes';
        break;
      }

      const W = before.width, H = before.height;
      const changed = new Uint8Array(W * H);
      let nChanged = 0;
      for (let p = 0; p < W * H; p++) {
        const q = p * 4;
        if (before.data[q] !== after.data[q] || before.data[q + 1] !== after.data[q + 1] ||
            before.data[q + 2] !== after.data[q + 2]) { changed[p] = 1; nChanged++; }
      }

      let onEdge = false;
      for (let x = 0; x < W && !onEdge; x++) if (changed[x] || changed[(H - 1) * W + x]) onEdge = true;
      for (let y = 0; y < H && !onEdge; y++) if (changed[y * W] || changed[y * W + W - 1]) onEdge = true;
      /* Widen for BOTH shapes of "this clip is too small", not just the
         obvious one. A ring that touches the edge is truncated; a clip that
         sees NO change at all may simply be smaller than the offset — at
         outline-offset: 60px the whole ring lands outside a 28px pad, and
         stopping here would report a control that has a perfectly good focus
         ring as having none. Both are the same question, so both escalate,
         and only the whole-document clip is allowed to answer it. */
      const last = FOCUS_PADS[FOCUS_PADS.length - 1];
      if ((onEdge || !nChanged) && pad !== last) continue;

      measured = { box, pad, nChanged, changed, after, W, H, focused, onEdge };
      break;
    }

    if (refusal) { rows.push({ ...row, refused: refusal }); continue; }
    if (!measured) { rows.push({ ...row, refused: 'no photograph could be taken' }); continue; }

    const { nChanged, changed, after, W, H, focused } = measured;
    row.focusVisible = focused.focusVisible;
    row.pad = measured.pad === Infinity ? 'whole document' : `${measured.pad}px`;
    row.changedPx = nChanged;

    /* No moving pixel is not a measurement problem. It is the finding: this
       control shows a keyboard user nothing when it is focused. */
    if (!nChanged) {
      rows.push({ ...row, refused: 'focusing it changes no pixel, so it has no visible focus indicator' });
      continue;
    }
    if (measured.onEdge) {
      rows.push({ ...row, refused: `its focus indicator reaches the edge of a whole-document photograph, ` +
        'so part of it could not be seen' });
      continue;
    }

    /* Innermost ancestor-or-self carrying an outline. Ancestor-or-self
       because `:focus-within` on a wrapper is a legitimate way to indicate
       focus and the ring is then not on the focused element at all. */
    const ring = focused.chain.find((n) => n.style !== 'none' && n.width > 0);
    if (!ring) {
      rows.push({ ...row, refused: 'its focus indicator is not an outline — this tool measures ' +
        'outlines, and an indicator drawn some other way (box-shadow, a border swap, a ' +
        'background change) is not something it can name the edges of' });
      continue;
    }
    row.ring = `${ring.name} outline ${ring.width}px ${ring.style} ${ring.color} offset ${ring.offset}`;
    row.ringOn = ring.name;
    row.offset = ring.offset;
    if (ring.style !== 'solid') {
      rows.push({ ...row, refused: `its outline-style is ${ring.style}; this tool reads the ring ` +
        'from pixels painted exactly the outline colour, which a gapped or doubled stroke ' +
        'does not produce evenly' });
      continue;
    }

    /* INK ROLE: refuse rather than assume. An outline at alpha 0.6 paints a
       blend of itself and whatever is behind it, and "assume opaque" here
       reports the ring as more contrasty than the pixels are. */
    const ringColor = parseColor(ring.color);
    if (!ringColor) {
      rows.push({ ...row, refused: `its outline-color reads "${ring.color}", which this tool cannot resolve` });
      continue;
    }
    if (ringColor.a !== 1) {
      rows.push({ ...row, refused: `its outline-color is translucent (alpha ${ringColor.a}), so the ring ` +
        'is a blend of itself and whatever it is over, and this tool would be assuming the ' +
        'flattering half of that blend' });
      continue;
    }
    const ringRGB = { r: Math.round(ringColor.r), g: Math.round(ringColor.g), b: Math.round(ringColor.b) };
    row.ringHex = hex(ringRGB);

    const core = new Uint8Array(W * H);
    let nCore = 0;
    for (let p = 0; p < W * H; p++) {
      if (!changed[p]) continue;
      const q = p * 4;
      if (after.data[q] === ringRGB.r && after.data[q + 1] === ringRGB.g &&
          after.data[q + 2] === ringRGB.b) { core[p] = 1; nCore++; }
    }
    row.corePx = nCore;
    if (!nCore) {
      rows.push({ ...row, refused: `its computed outline is ${row.ringHex} but no pixel that moved is ` +
        'that colour, so the ring this tool would measure is not the ring on the screen' });
      continue;
    }

    const D = FOCUS_ADJACENT_RADIUS;
    const adjacent = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (changed[p]) continue;
        let near = false;
        for (let dy = -D; dy <= D && !near; dy++) {
          for (let dx = -D; dx <= D && !near; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
            if (core[yy * W + xx]) near = true;
          }
        }
        if (near) adjacent.push([after.data[p * 4], after.data[p * 4 + 1], after.data[p * 4 + 2]]);
      }
    }
    row.adjacentPx = adjacent.length;
    if (adjacent.length < FOCUS_MIN_ADJACENT) {
      rows.push({ ...row, refused: `only ${adjacent.length} unchanged pixel(s) sit beside its ring, ` +
        `which is under the ${FOCUS_MIN_ADJACENT} this tool will take a worst-of over` });
      continue;
    }
    /* Fail-closed and currently unexercised: Page.captureScreenshot decodes
       as PNG colour type 2 here, which has no alpha channel at all, so this
       cannot fire today. It is here because a decoder change that started
       handing back type 6 would otherwise let a translucent surface through
       as though it were the colour it is composited over. */
    let translucent = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (!changed[p] && after.data[p * 4 + 3] !== 255) translucent++;
      }
    }
    if (translucent) {
      rows.push({ ...row, refused: `${translucent} pixel(s) beside its ring are translucent, so their ` +
        'colour depends on something this photograph does not contain' });
      continue;
    }

    /* FILL ROLE: every surface beside the ring counts and the worst decides. */
    const buckets = bucketPixels(adjacent);
    let worstAt = null, bestAt = null;
    for (const s of buckets) {
      const r = contrast(ringRGB, s);
      if (!worstAt || r < worstAt.ratio) worstAt = { ratio: r, surface: s };
      if (!bestAt || r > bestAt.ratio) bestAt = { ratio: r, surface: s };
    }
    rows.push({
      ...row,
      surfaces: buckets.length,
      ratio: worstAt.ratio, need: FOCUS_RATIO,
      bg: hex(worstAt.surface), bgPx: worstAt.surface.n,
      best: bestAt.ratio, bestBg: hex(bestAt.surface)
    });
  }

  return {
    rows,
    census: {
      candidates: candidates.length,
      reached: walk.order.filter((v) => v !== null).length,
      unknownStops: walk.order.filter((v) => v === null).length,
      order: walk.order,
      offPage: walk.offPage
    }
  };
}

/* ------------------------------------------------------------- self-test */

/* Proves the tool before it judges anything, in nine parts that do not share a
   mechanism. Asserting "this pair measures 3.95:1" against a number this same
   file computed would be circular — the expectation would move with the bug —
   so each part binds something a different way:
 *
 *   A. THE FORMULA against published constants only. WebAIM's checker is the
 *      reference; #767676 and #777777 on white are its canonical pair either
 *      side of 4.5, and black on white is 21:1 by definition. None of those
 *      numbers came from this file.
 *   B. THE PIXEL PIPELINE without the formula at all: render a known backdrop,
 *      sample it through the decoder, the plate, the scale and the bucketing,
 *      and require the bytes that come back to be the bytes that went in.
 *   C. THE PLATE pixel by pixel, because B survives a broken one: glyphs are a
 *      small fraction of a padded box, so the modal bucket still lands on the
 *      backdrop. C asserts exact uniformity, which a residual glyph of ANY
 *      colour breaks.
 *   D. THE INK SOURCE, because A, B and C never read a collected element's
 *      colour and so cannot tell a collector that reads `fill` from one that
 *      reads `color`. Its fixture <text> is filled magenta and given an inline
 *      cyan `color`, because with the two agreeing either read looks right.
 *   E. AN UNRESOLVABLE INK must be refused rather than guessed, driven through
 *      measureSites — the production per-site pipeline — rather than by calling
 *      the classifier, which would stay green if the pipeline stopped calling
 *      it. The fixture is a real paint server, whose trailing fallback parses
 *      cleanly and never paints.
 *   F. color(srgb ...) must be READ, not refused, and read as 0..1 floats.
 *      This is the #10255 shape: the monorepo's rgb()-only parser dropped 40
 *      sites and 10 real failures in silence. The expectation is stated from
 *      CSS Color 4 (a 50% mix of #FF0000 and #0000FF in sRGB is
 *      `color(srgb 0.5 0 0.5)`, which is rgb(127.5, 0, 127.5)), not computed
 *      here.
 *  F2. THE GAMUT WINDOW around F, both ends pinned by a browser serialisation
 *      this file did not compute. Chromium overshoots 1 for colours that are
 *      plainly in gamut, so a 0..1 gate refuses white; it also serialises a
 *      wide-gamut mix far outside 0..1, and scaling THAT by 255 invents a
 *      colour and a confident ratio to go with it. The fixture carries one of
 *      each and asserts the two shapes still exist before asserting how they
 *      are routed. It then WORKS OUT where each edge of the window is, from
 *      those same serialisations, and brackets every computed edge by calling
 *      the gate a hair either side of it — so the part reports how far the
 *      constant may move instead of a sentence saying so (Stadiora/Aria#10365).
 *   G. THE THREE BOUNDARY CENSUSES, which decide whether a site is SEEN at
 *      all and so sit upstream of everything A-F2 measures. A page carrying
 *      six spellings of a nested browsing context must report six, which is
 *      what distinguishes a census of CONTEXTS from a tag-name list; a page
 *      carrying an open author root, a closed author root and a user-agent
 *      root must report exactly the first two; and a page carrying five
 *      user-agent roots, four of them either sourced by COLLECT or painting
 *      nothing, must refuse exactly the fifth. All three are counted on a
 *      fixture because the shipped shell refuses nothing, so nothing on it
 *      can tell a working census from one that always returns nothing.
 *   H. THE FOCUS SWEEP, driven through measureFocusIndicators rather than
 *      re-implemented, on a fixture built so that one ring declaration has to
 *      produce two different answers. The same #CCCCCC outline on the same
 *      black button reads 1.61:1 against the white card at outline-offset:
 *      8px and 13.08:1 against the button itself at -8px, so a tool that
 *      reads a colour off the focused element or off the page fails one of
 *      them. Beside that: a published ratio to pin the pipeline, the three
 *      indicators this tool declines to model, a ring far enough out that the
 *      clip must widen to see it at all, and a case that repaints a distant
 *      strip on focus to prove the adjacency is anchored on the ring and not
 *      on everything that moved (Stadiora/Aria#10634).
 *
 * NOT COVERED, on purpose — this is the list of exclusions decided, not an
 * inventory of every blind spot, because one nobody has thought of is by
 * definition missing from it. Excluded: that a rendered swatch measures a
 * particular ratio (circular); that the collector finds every element worth
 * judging on the real shell (a fixture cannot prove a sweep is complete —
 * that is what the per-pass counts and the mutation battery in the PR are
 * for); the background-sampling METHOD, i.e. that the modal bucket is the
 * colour under the glyphs rather than merely the commonest colour in the box
 * (B and C prove only that the sampler returns what was painted); the
 * accounting in the run loop below, which no part reaches; and, for the focus
 * sweep specifically, that a ring is judged against a surface it only touches
 * round a CURVED corner — every fixture ring here is square, the adjacency
 * radius is one pixel, and a surface reachable only across a corner blend
 * could go unsampled. The page's thinnest measured ring carries 119 adjacent
 * pixels and the sweep refuses anything under 8, so a starved sample is named
 * rather than judged, but "named" is the whole of the claim.
 */
const FIXTURE_CASES = [
  { bg: '#ffffff', expect: [255, 255, 255] },
  { bg: '#000000', expect: [0, 0, 0] },
  { bg: '#0e1218', expect: [14, 18, 24] },
  { bg: '#f4f7fb', expect: [244, 247, 251] },
  { bg: '#7c8ca1', expect: [124, 140, 161] },
  { bg: 'linear-gradient(90deg,#0e1218,#0e1218)', expect: [14, 18, 24] },
  { bg: '#ffffff', expect: [255, 255, 255], placeholder: true },
  { bg: '#ffffff', expect: [255, 255, 255], svgText: true },
  { bg: '#ffffff', expect: [255, 255, 255], psText: true },
  { bg: '#ffffff', expect: [255, 255, 255], mixText: true }
];

function fixture() {
  return '<!doctype html><meta charset="utf-8"><title>contrast self-test</title><style>' +
    'body { margin: 0; font: 16px/1.4 sans-serif; }' +
    'div.sw { padding: 24px; font-size: 14px; color: #ff00ff; }' +
    'div.sw input { display: block; margin-top: 8px; width: 90%; background: transparent;' +
    ' border: 0; outline: 0; font-size: 14px; }' +
    'div.sw input::placeholder { color: #ff00ff; opacity: 1; }' +
    'span.mix { color: color-mix(in srgb, #ff0000 50%, #0000ff); }' +
    /* The two ends of the GAMUT_SLACK window, as literals. `.over` is white
       reached through oklch, which Chromium serialises a hair ABOVE 1 and
       which must still be READ; `.wide` carries a display-p3 term, which
       lands far outside and must be REFUSED. A gate with no slack fails the
       first; no gate at all invents a colour for the second. */
    'span.over { color: color-mix(in srgb, oklch(1 0 0) 50%, white); }' +
    'span.wide { color: color-mix(in srgb, color(display-p3 1 0 0) 90%, white); }' +
    '</style>' +
    FIXTURE_CASES.map((c, i) =>
      `<div class="sw" id="c${i}" style="background:${c.bg}">swatch ${i} measured here` +
      (c.placeholder ? '<input placeholder="placeholder glyphs must not survive the plate">' : '') +
      (c.svgText ? '<svg width="260" height="20" style="display:block"><text class="axis" x="0" y="14" fill="#ff00ff" style="color:#00ffff">svg text must not survive</text></svg>' : '') +
      (c.psText ? '<svg width="320" height="20" style="display:block"><defs><linearGradient id="psSelfTest"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#000000"/></linearGradient></defs><text class="axis" x="0" y="14" fill="url(#psSelfTest) #eef2f7">paint-server text must not be judged</text></svg>' : '') +
      (c.mixText ? '<div><span class="mix">a color-mix ink must be read, not refused</span></div>' +
        '<div><span class="over">an in-gamut overshoot must be read</span></div>' +
        '<div><span class="wide">a wide-gamut mix must be refused</span></div>' : '') +
      '</div>'
    ).join('');
}

async function selfTest() {
  let bad = 0;
  console.log('self-test');

  /* A — published reference values, not computed here.
     Source: WebAIM contrast checker (webaim.org/resources/contrastchecker). */
  const formulaCases = [
    { fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, want: 21.0, note: 'black on white, 21:1 by definition' },
    { fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 }, want: 21.0, note: 'symmetric, order must not matter' },
    { fg: { r: 255, g: 255, b: 255 }, bg: { r: 255, g: 255, b: 255 }, want: 1.0, note: 'identical colours, 1:1' },
    { fg: { r: 119, g: 119, b: 119 }, bg: { r: 255, g: 255, b: 255 }, want: 4.48, note: '#777 on white, just under AA' },
    { fg: { r: 118, g: 118, b: 118 }, bg: { r: 255, g: 255, b: 255 }, want: 4.54, note: '#767676 on white, just over AA' }
  ];
  console.log('\n  A. contrast formula vs published reference values');
  for (const c of formulaCases) {
    const got = contrast(c.fg, c.bg);
    const ok = Math.abs(got - c.want) <= 0.01;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${got.toFixed(2)} vs ${c.want.toFixed(2)}  — ${c.note}`);
  }

  fixtureHtml = fixture();
  await setTheme('dark');
  await load(origin + '/__contrast-self-test.html', { settle: 200 });
  const targets = await evaluate(COLLECT);
  await evaluate(APPLY_PLATE);
  const { plate, scale } = await plateShot();
  await evaluate(REMOVE_PLATE);

  console.log('\n  B. pixel pipeline — decoder, plate, scale, surface sampling');
  for (let i = 0; i < FIXTURE_CASES.length; i++) {
    const c = FIXTURE_CASES[i];
    const t = targets.find((t) => t.text.startsWith(`swatch ${i} `));
    if (!t) { console.log(`     FAIL case ${i}: element was not collected`); bad++; continue; }
    const bg = sampleBackdrops(plate, [t.rect], scale);
    if (!bg || !bg.all.length) {
      console.log(`     FAIL case ${i}: nothing sampled`); bad++; continue;
    }
    const got = [bg.all[0].r, bg.all[0].g, bg.all[0].b].map(Math.round);
    /* Exact, not approximate. The magenta text is the tell: a plate that
       failed to lift the glyphs pulls the mean off the declared value. And
       one surface, not several: a solid box that arrives as two surfaces
       means the significance filter is shredding what it samples, which would
       turn every judged site into a straddle. */
    const ok = got.every((v, k) => v === c.expect[k]) && bg.all.length === 1;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${c.bg.padEnd(34)} sampled rgb(${got.join(',')})` +
      ` expected rgb(${c.expect.join(',')}) in ${bg.all.length} surface(s)`);
  }

  console.log('\n  C. plate integrity — every pixel in a solid box must be the box\'s colour');
  for (let i = 0; i < FIXTURE_CASES.length; i++) {
    const c = FIXTURE_CASES[i];
    const t = targets.find((t) => t.text.startsWith(`swatch ${i} `));
    /* Not a silent skip: part B does the identical lookup and has already
       failed loudly for this case if the swatch was not collected. */
    if (!t) continue;
    const inset = 3;
    const x0 = Math.max(0, Math.round((t.rect.x + inset) * scale));
    const y0 = Math.max(0, Math.round((t.rect.y + inset) * scale));
    const x1 = Math.min(plate.width, Math.round((t.rect.x + t.rect.width - inset) * scale));
    const y1 = Math.min(plate.height, Math.round((t.rect.y + t.rect.height - inset) * scale));
    let off = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * plate.width + x) * 4;
        total++;
        if (plate.data[p] !== c.expect[0] || plate.data[p + 1] !== c.expect[1] ||
            plate.data[p + 2] !== c.expect[2]) off++;
      }
    }
    const ok = off === 0 && total > 0;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${c.bg.padEnd(34)} ${off} of ${total} pixels` +
      ` differ from rgb(${c.expect.join(',')})`);
  }

  console.log('\n  D. ink source — SVG text ink must come from fill, not from color');
  {
    const svgInk = targets.find((t) => t.tag === 'text' && t.text.startsWith('svg text must'));
    /* Chromium's own serialisation, not a value this file computed, and
       compared before parseColor so a broken parser cannot mask a broken
       read. */
    const got = svgInk ? String(svgInk.color) : '(the <text> was not collected at all)';
    const ok = got.replace(/\s+/g, '') === 'rgb(255,0,255)';
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} <text fill="#ff00ff" style="color:#00ffff"> ` +
      `collected ink ${got}\n          its computed color is rgb(0, 255, 255) and must not be what is read`);
  }

  const judged = await measureSites(targets, 'the self-test fixture');

  console.log('\n  E. unresolvable inks — a fill this tool cannot resolve must be refused');
  {
    const row = judged.find((r) => r.text.startsWith('paint-server text must'));
    const ink = row ? String(row.ink ?? row.color) : '(the <text> was not collected at all)';
    /* The second half of the assertion is that the trap is real. These glyphs
       paint BLACK; an UNANCHORED rgb() regex — what this parser was ported
       from — matches the trailing fallback instead and reads them as
       near-white, which turns a ~1:1 site into a ~21:1 one. So part E requires
       both that the pipeline refused the site AND that a loose parse of the
       same string would have produced a plausible wrong colour. */
    const loose = String(ink).match(/rgba?\([^)]+\)/);
    const wrong = loose ? parseColor(loose[0]) : null;
    const ok = !!row && row.unjudgeable === 'paint-server fill' && row.ratio === undefined && !!wrong;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} <text fill="url(#psSelfTest) #eef2f7"> collected ink ${ink}` +
      `\n          measureSites routed it as ${row ? (row.unjudgeable || `JUDGED at ${row.ratio?.toFixed(2)}:1`) : 'nothing'}` +
      `; an unanchored rgb() parse of it ${wrong ? `reads ${hex(wrong)}, which never paints` : 'finds nothing'}`);
  }

  console.log('\n  F. color(srgb ...) — a color-mix ink must be read, and read as floats');
  {
    const row = judged.find((r) => r.text.startsWith('a color-mix ink'));
    const ink = row ? String(row.ink ?? row.color) : '(the span was not collected at all)';
    const parsed = parseColor(ink);
    /* CSS Color 4: mixing #FF0000 and #0000FF half and half in sRGB gives
       color(srgb 0.5 0 0.5), and an srgb component is 0..1. Reading those as
       bytes would give rgb(0.5, 0, 0.5) — near-black, and a confident wrong
       ratio rather than a missing one. The expectation is the spec's, not
       this file's. */
    const wanted = { r: 127.5, g: 0, b: 127.5 };
    const near = parsed && ['r', 'g', 'b'].every((k) => Math.abs(parsed[k] - wanted[k]) <= 1.5);
    const ok = !!row && !row.unjudgeable && near && typeof row.ratio === 'number';
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} <span style="color: color-mix(in srgb, #ff0000 50%, #0000ff)">` +
      ` collected ink ${ink}\n          parsed ${parsed ? `rgb(${[parsed.r, parsed.g, parsed.b].map((v) => v.toFixed(1)).join(', ')})` : 'nothing'}` +
      `, expected rgb(127.5, 0.0, 127.5) from CSS Color 4; routed as ` +
      `${row ? (row.unjudgeable || `judged at ${row.ratio?.toFixed(2)}:1`) : 'nothing'}`);
  }

  console.log('\n  F2. the gamut window — an in-gamut overshoot is read, a wide-gamut mix is refused');
  {
    /* Both ends are asserted on the SERIALISED string first, so a parser that
       stopped refusing cannot be mistaken for a browser that stopped
       overshooting. The strings are Chromium's own output: white through
       oklch overshoots 1 by less than the slack, and a display-p3 red mixed
       90% with white lands outside it on two channels at once. How far
       outside is not stated here — it is computed at the end of this part
       from the serialisations themselves. */
    const over = judged.find((r) => r.text.startsWith('an in-gamut overshoot'));
    const wide = judged.find((r) => r.text.startsWith('a wide-gamut mix'));
    const overInk = over ? String(over.ink ?? over.color) : '(not collected)';
    const wideInk = wide ? String(wide.ink ?? wide.color) : '(not collected)';
    const comps = (s) => {
      const m = String(s).match(/^color\(\s*srgb\s+([^)]+)\)$/i);
      return m ? m[1].split(/[\s/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
    };
    const overC = comps(overInk);
    const wideC = comps(wideInk);
    /* The fixture only proves something if the browser still produces the two
       shapes it was built from: one outside 0..1 but inside the slack, one
       outside the slack. If Chromium ever stops overshooting, this says so
       rather than passing on a case that no longer exists. */
    const overIsOvershoot = !!overC && overC.some((v) => v > 1) &&
      overC.every((v) => v >= -GAMUT_SLACK && v <= 1 + GAMUT_SLACK);
    const wideIsOutside = !!wideC && wideC.some((v) => v < -GAMUT_SLACK || v > 1 + GAMUT_SLACK);
    /* Both guards above are written in terms of GAMUT_SLACK, so they move
       with it: they bracket the constant rather than pin it. WHERE each one
       bites is not stated here. It is computed below from the same
       serialisations these guards read, and each computed edge is then
       BRACKETED — parseColor is called at the edge and a hair either side of
       it, so a wrongly derived edge reds instead of printing.

       Stadiora/Aria#10365 is why. The sentence this replaces said the upper
       shape guard bit at 0.084 — the red channel's 1.08372 falling back
       inside the window. It does not: the green channel is -0.104021, and a
       component below -slack is outside the window too, so `wideIsOutside`
       survives to 0.104021. One channel was read, three exist, and the
       sentence outlived the value by four review rounds because nothing in
       the file could contradict it. Nothing here is typed, so nothing here
       can drift.

       The BOUND is a different thing from the brackets and is still written
       down: ONE byte, not the half-byte the constant is set at, because
       asserting `GAMUT_SLACK === 0.5 / 255` would be the constant checking
       itself. A byte is the independent contract — a slack this small can
       only be a rounding allowance on a value that should have landed in
       gamut, where one at 0.05 is a gamut policy wearing a rounding
       allowance's name. */
    const slackIsAtMostAByte = GAMUT_SLACK <= 1 / 255;
    const overRead = !!over && !over.unjudgeable && typeof over.ratio === 'number' &&
      !!parseColor(overInk);
    /* Clamped, so the byte a 1.00003 component becomes is 255 and not 255.008. */
    const overParsed = parseColor(overInk);
    const clamped = !!overParsed &&
      ['r', 'g', 'b'].every((k) => overParsed[k] >= 0 && overParsed[k] <= 255);
    /* The clamp has two halves and the `over` fixture exercises one: every
       component of it is near 1, so a vanished `Math.max(0, ...)` goes unseen
       there. (The `wide` fixture IS negative, but it is refused before the
       clamp ever runs, which is the point of it.) The lower half is pinned
       against arithmetic instead of against a rendered colour: -0.0019 is in
       gamut by GAMUT_SLACK, so it must parse, and -0.0019 x 255 is -0.4845,
       which must come back as the byte 0. That is a statement about Math.max,
       not about this file's model of colour, so a literal is not circular
       here the way it would be for the gate.

       It is coupled to GAMUT_SLACK — narrow the slack far enough and the
       literal is refused before the clamp runs, so this line reds for a
       reason that is not the clamp. How far is one of the edges computed
       below, and the message at the end of this part distinguishes a refused
       literal from an unclamped one so that a reader is not sent after the
       wrong bound. */
    const LOW_CLAMP_INK = 'color(srgb -0.0019 0.5 0.5)';
    const lowParsed = parseColor(LOW_CLAMP_INK);
    const lowClamped = !!lowParsed && lowParsed.r === 0 &&
      Math.abs(lowParsed.g - 127.5) < 1e-9;
    const wideRefused = !!wide && wide.unjudgeable === 'unreadable ink syntax' &&
      wide.ratio === undefined && parseColor(wideInk) === null;

    /* ---- where the window's edges actually are, worked out rather than typed

       One function, because there is only one question. A component above 1
       needs `v - 1` of slack to fit, one below 0 needs `-v`, one already
       inside needs nothing, and a colour fits when its WORST component does —
       so `admits(c)` is the smallest slack at which parseColor reads c. Read
       every channel. Reading one is the whole of #10365.

       The same number is a floor or a ceiling depending on what the colour is
       there to prove:

         a colour that must be READ  — floor. Refused strictly below it.
         a colour that must be REFUSED — ceiling. Read at it and above, so the
                                         slack has to stay strictly under.

       Floors: the browser's in-gamut overshoot (which the shape guard
       `overIsOvershoot` needs to fit) and the literal pinning the clamp's
       lower half. Ceilings: the wide-gamut mix, plus the one-byte contract
       above. The band runs from the highest floor to the lowest ceiling, and
       the shipped constant has to be inside it.

       Which bound is binding is asserted rather than narrated. If Chromium's
       serialisations ever moved far enough for a shape guard to become the
       binding edge, this constant would be held in place by a fact about a
       browser instead of by a contract, and that is worth a red run. It also
       keeps the ceiling's exclusivity from mattering: the byte contract is
       inclusive and binds, the wide mix is exclusive and does not. */
    const excess = (v) => (v > 1 ? v - 1 : v < 0 ? -v : 0);
    const admits = (c) => Math.max(...c.map(excess));
    const lowC = comps(LOW_CLAMP_INK);
    const edges = overC && wideC && lowC ? {
      overshootFloor: admits(overC),
      lowLiteralFloor: admits(lowC),
      wideCeiling: admits(wideC),
      byteCeiling: 1 / 255
    } : null;
    /* A hair, in the units of the edge itself, and far above the double
       precision of numbers this size — so "just below" and "just above" are
       real evaluations of the gate and not the same evaluation twice. */
    const hair = (x) => Math.max(Math.abs(x) * 1e-9, Number.MIN_VALUE);
    /* Each computed edge, checked by CALLING THE GATE either side of it: at
       the edge and a hair below. A wrongly derived edge reds here instead of
       printing a wrong number — which is not hypothetical, it is how the
       first draft of `admits` was caught taking a min over the channels that
       were outside rather than a max over all of them. */
    const bracketed = !!edges &&
      parseColor(overInk, edges.overshootFloor) !== null &&
      parseColor(overInk, edges.overshootFloor - hair(edges.overshootFloor)) === null &&
      parseColor(LOW_CLAMP_INK, edges.lowLiteralFloor) !== null &&
      parseColor(LOW_CLAMP_INK, edges.lowLiteralFloor - hair(edges.lowLiteralFloor)) === null &&
      parseColor(wideInk, edges.wideCeiling) !== null &&
      parseColor(wideInk, edges.wideCeiling - hair(edges.wideCeiling)) === null;
    const band = edges
      ? { lo: Math.max(edges.overshootFloor, edges.lowLiteralFloor),
          hi: Math.min(edges.wideCeiling, edges.byteCeiling) }
      : null;
    const inBand = !!band && GAMUT_SLACK >= band.lo && GAMUT_SLACK <= band.hi;
    /* The contracts bind, not the browser — and the binding ceiling being the
       inclusive one is what lets the band above be written closed. */
    const contractsBind = !!edges && band.lo === edges.lowLiteralFloor &&
      band.hi === edges.byteCeiling && edges.byteCeiling < edges.wideCeiling;
    const mult = (v) => (v / GAMUT_SLACK).toFixed(3) + 'x';

    const ok = overIsOvershoot && wideIsOutside && slackIsAtMostAByte && overRead &&
      clamped && lowClamped && wideRefused && bracketed && inBand && contractsBind;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} <span style="color: color-mix(in srgb, oklch(1 0 0) 50%, white)">` +
      ` ${overInk}\n          ${overIsOvershoot ? 'overshoots 1 and sits inside the slack' : 'is NOT the overshoot this case needs'}` +
      `; routed as ${over ? (over.unjudgeable || `judged at ${over.ratio?.toFixed(2)}:1`) : 'nothing'}` +
      `; parsed ${overParsed ? `rgb(${[overParsed.r, overParsed.g, overParsed.b].map((v) => v.toFixed(3)).join(', ')})` : 'nothing'}` +
      `${overParsed && !clamped ? ' — NOT CLAMPED' : ''}` +
      `\n          <span style="color: color-mix(in srgb, color(display-p3 1 0 0) 90%, white)"> ${wideInk}` +
      `\n          ${wideIsOutside ? 'sits outside the slack' : 'is NOT outside the slack'}` +
      `; routed as ${wide ? (wide.unjudgeable || `JUDGED at ${wide.ratio?.toFixed(2)}:1`) : 'nothing'}` +
      `\n          GAMUT_SLACK is ${GAMUT_SLACK} — ${slackIsAtMostAByte ? 'at most a byte, so it is a rounding allowance' : 'WIDER THAN A BYTE, so the window is a gamut policy and not a rounding allowance'}` +
      `; ${LOW_CLAMP_INK} parses to ` +
      `${lowParsed ? `rgb(${[lowParsed.r, lowParsed.g, lowParsed.b].map((v) => v.toFixed(3)).join(', ')})` : 'nothing'}` +
      `${lowParsed ? (lowClamped ? '' : ' — the LOWER clamp is not holding') : ' — refused, so the slack is under this part\'s low-literal floor and this says nothing about the clamp'}` +
      (edges
        ? `\n          edges, computed from those serialisations and bracketed by calling the gate either side:` +
          `\n            floor   ${edges.overshootFloor} (${mult(edges.overshootFloor)})  the overshoot stops fitting the window below this` +
          `\n            floor   ${edges.lowLiteralFloor} (${mult(edges.lowLiteralFloor)})  the clamp literal is refused below this` +
          `\n            ceiling ${edges.wideCeiling} (${mult(edges.wideCeiling)})  the wide-gamut mix starts being read at this, so the slack must stay under it` +
          `\n            ceiling ${edges.byteCeiling} (${mult(edges.byteCeiling)})  one byte, the contract` +
          `\n          so this part is green for GAMUT_SLACK in [${band.lo}, ${band.hi}] = [${mult(band.lo)}, ${mult(band.hi)}]` +
          `${bracketed ? '' : ' — AN EDGE IS NOT WHERE IT WAS COMPUTED TO BE'}` +
          `${inBand ? '' : ' — AND THE SHIPPED CONSTANT IS OUTSIDE IT'}` +
          `${contractsBind ? '' : ' — BOUND BY A BROWSER SERIALISATION RATHER THAN BY A CONTRACT'}`
        : '\n          the edges could not be computed: a fixture ink did not serialise as color(srgb ...)'));
  }

  console.log('\n  G. boundary censuses — a frame, an author shadow root and unsourced user-agent text');
  {
    await load(origin + '/__contrast-boundary-test.html', { settle: 300 });
    const frames = await nestedFrames();
    const shadow = await shadowHosts();
    const uaText = await uaTextNoSource();
    /* Six spellings on one page. Page.getFrameTree reports the CONTEXT and
       not the element that spells it, which is what stops this from being a
       tag-name list; six is the count that says so. A tag-name census would
       also miss two of these outright: embed.contentDocument reads null to
       script in the page even for HTML it is hosting. */
    const okFrames = frames.length === 6;
    if (!okFrames) bad++;
    console.log(`     ${okFrames ? 'ok  ' : 'FAIL'} 6 spellings of a nested browsing context ` +
      `→ ${frames.length} censused\n          ` +
      'iframe srcdoc, iframe src, object text/html, embed text/html, object svg, embed svg');
    /* Both author roots, and NOT the <select>'s user-agent root, which is on
       the same page precisely so that the exclusion is exercised rather than
       asserted in prose. el.shadowRoot is null for the closed one, so an
       in-page census would report 1 here and read as though it reported all. */
    const kinds = shadow.map((s) => s.replace(/^.*\(|\)$/g, '')).sort();
    const okShadow = shadow.length === 2 && kinds.join(',') === 'closed,open';
    if (!okShadow) bad++;
    console.log(`     ${okShadow ? 'ok  ' : 'FAIL'} 1 open + 1 closed author root, 1 user-agent ` +
      `root → ${shadow.length} censused: ${shadow.join('; ') || 'nothing'}\n          ` +
      'the user-agent root must not be among them');
    /* Seven user-agent roots carry text on this page and exactly one of them
       is refused, named in full rather than by prefix: two hosts that produce
       the SAME census string cannot tell the assertion which one was caught,
       which is how round 11 inverted both PAINTS gates with part G still
       green. The exonerations are one per reason: the <select> matches
       through .selectedOptions, its <option> through its own text node, the
       <input type="search"> through .placeholder, the file input's own inner
       UA button through .value, the working <img>'s root carries no text at
       all, the display: none reset paints nothing and the zero-box submit has
       no box. Four exonerations of a source, two of a gate, one catch. */
    const okUa = uaText.length === 1 && uaText[0] === 'input "Choose FileNo file chosen"';
    if (!okUa) bad++;
    console.log(`     ${okUa ? 'ok  ' : 'FAIL'} 7 user-agent roots with text, 1 painting words ` +
      `with no source → ${uaText.length} refused: ${uaText.join('; ') || 'nothing'}\n          ` +
      'the sourced select, option, placeholder and file button, the hidden reset ' +
      'and the zero-box submit must not be among them');
  }

  console.log('\n  H. focus indicators — the same ring, judged against two different surfaces');
  {
    await load(origin + '/__contrast-focus-test.html', { settle: 200 });
    const { rows, census } = await measureFocusIndicators('the focus fixture');
    const at = (cls) => rows.find((r) => r.cls === cls);

    /* Every expectation on this page is stated from the WCAG formula and the
       fixture's own declared hexes, not from anything this file measured:
         #767676 on #FFFFFF  4.54:1   (WebAIM's published figure)
         #CCCCCC on #FFFFFF  1.61:1   (L 0.60383, 1.00000)
         #CCCCCC on #000000 13.08:1   (L 0.60383, 0.00000)
         #999999 on #000000  7.37:1   (L 0.31855, 0.00000)
         #999999 on #B0B0B0  1.31:1   (L 0.31855, 0.43415) — the WRONG answer
                                       for h7, and what it measures if the
                                       adjacency is anchored on the changed
                                       region instead of on the ring core. */
    const near = (r, want) => !!r && !r.refused && Math.abs(r.ratio - want) < 0.02;
    const shows = (cls, want, note) => {
      const r = at(cls);
      const ok = near(r, want);
      if (!ok) bad++;
      console.log(`     ${ok ? 'ok  ' : 'FAIL'} .${cls} ${note}\n          measured ` +
        `${r ? (r.refused ? `REFUSED: ${r.refused}` : `${r.ratio.toFixed(2)}:1 against ` +
          `${r.bg} (${r.bgPx}px, ${r.surfaces} surface(s) beside the ring, pad ${r.pad})`) : 'nothing at all'}` +
        `, expected ${want.toFixed(2)}:1`);
      return r;
    };
    const refuses = (cls, fragment, note) => {
      const r = at(cls);
      const ok = !!r && typeof r.refused === 'string' && r.refused.includes(fragment);
      if (!ok) bad++;
      console.log(`     ${ok ? 'ok  ' : 'FAIL'} .${cls} ${note}\n          ` +
        `${r ? (r.refused ? `refused: ${r.refused}` : `JUDGED at ${r.ratio.toFixed(2)}:1 — it should not have been`) : 'was not censused at all'}`);
    };

    /* H1 — a published number, so the pipeline is pinned to something outside
       this file before any of the harder cases are believed. */
    shows('h1', 4.5426, 'a #767676 ring 6px outside a white button on a white card → WebAIM\'s 4.54:1');

    /* H2 — THE case. One declaration, one ring colour, opposite offsets. The
       black button is identical in both; only the sign changes, and the
       answer moves by a factor of eight. Nothing that reads a colour off the
       focused element, or off the page, can produce both of these. */
    const out = shows('h2out', 1.6060,
      'the SAME #CCCCCC ring 8px OUTSIDE a black button → it lands on the white card');
    const inn = shows('h2in', 13.0766,
      'the SAME #CCCCCC ring 8px INSIDE that black button → it lands on the button itself');
    const opposite = !!out && !!inn && !out.refused && !inn.refused &&
      out.bg === '#FFFFFF' && inn.bg === '#000000';
    if (!opposite) bad++;
    console.log(`     ${opposite ? 'ok  ' : 'FAIL'} and it NAMED the two surfaces differently: ` +
      `${out && !out.refused ? out.bg : '?'} outside, ${inn && !inn.refused ? inn.bg : '?'} inside` +
      '\n          (a tool that reports the same surface for both has not measured offset at all)');

    /* H3-H5 — the three ways this tool declines, each by name. An indicator
       it cannot model must never be silently absent from the count. */
    refuses('h3', 'no visible focus indicator', 'has outline:none and changes nothing on focus');
    refuses('h4', 'is not an outline', 'indicates focus with a box-shadow');
    refuses('h5', 'translucent', 'has a 50% alpha outline-color');

    /* H6 — the clip escalates rather than measuring a truncated ring. At the
       first pad this ring is entirely outside the photograph's edge. */
    const six = shows('h6', 4.5426, 'puts the same ring 60px out, past the first clip');
    const escalated = !!six && !six.refused && six.pad === '120px';
    if (!escalated) bad++;
    console.log(`     ${escalated ? 'ok  ' : 'FAIL'} and it escalated the clip to see it: pad ` +
      `${six ? six.pad : '?'}, expected 120px (the ring lands 64px out, past the 28px first try)`);

    /* H7 — the adjacency is anchored on the RING, not on everything that
       moved. Focusing .h7 also repaints a strip below it, whose own
       neighbours are #B0B0B0; anchor on the changed region and that strip
       drags the answer down to 1.31:1 against a colour no ring touches. */
    const seven = shows('h7', 7.3713,
      'draws its ring inside a black button while ALSO repainting a strip below it');
    const notDragged = !!seven && !seven.refused && seven.bg === '#000000';
    if (!notDragged) bad++;
    console.log(`     ${notDragged ? 'ok  ' : 'FAIL'} and the surface it named is ` +
      `${seven && !seven.refused ? seven.bg : '?'}, expected #000000 — not the #B0B0B0 beside ` +
      'the strip, which is what anchoring on the changed region reports (1.31:1)');

    /* H8 — the OTHER reason a clip is too small, and it needs its own case.
       H6's ring misses the first photograph entirely, so it escalates on
       "nothing changed"; H8's ring at 26px is PARTLY inside a 28px pad and
       runs off the edge, so it escalates on "the change touches the border".
       Delete either half of that condition and exactly one of these two goes
       red, which is the only way to tell them apart. */
    const eight = shows('h8', 4.5426,
      'puts the same ring 26px out, straddling the first clip\'s edge');
    const straddle = !!eight && !eight.refused && eight.pad === '120px';
    if (!straddle) bad++;
    console.log(`     ${straddle ? 'ok  ' : 'FAIL'} and it widened rather than measuring a ` +
      `truncated ring: pad ${eight ? eight.pad : '?'}, expected 120px`);

    /* The census itself: nine buttons on the page, nine reached by Tab, and
       every one of them carrying a row. A focus sweep that quietly measured
       six of nine would print six ok lines and nothing else. */
    const okCensus = census.candidates === 9 && census.reached === 9 && rows.length === 9;
    if (!okCensus) bad++;
    console.log(`     ${okCensus ? 'ok  ' : 'FAIL'} 9 focusable buttons → ${census.candidates} ` +
      `censused, ${census.reached} reached by real Tab presses, ${rows.length} judged or refused`);
    /* And that the Tab presses did their other job. Without keyboard modality
       every :focus-visible rule on this page is dead and the lot look like
       h3 — nine missing indicators and no ring measured anywhere. */
    const modality = rows.filter((r) => r.focusVisible).length;
    const okModality = modality === 9;
    if (!okModality) bad++;
    console.log(`     ${okModality ? 'ok  ' : 'FAIL'} :focus-visible matched on ${modality} of 9 ` +
      'after the Tab walk (scripted focus alone matches 0, and every ring here is behind it)');
  }

  console.log(bad === 0
    ? '\n  self-test passed — the formula matches published values, pixels survive\n' +
      '  the pipeline, the plate lifts every glyph, inks are read from what paints,\n' +
      '  an ink that cannot be resolved is refused, color(srgb) is read to the\n' +
      '  edge of gamut and refused past it, the three boundaries this tool\n' +
      '  refuses are all censused, and one focus ring is judged against two\n' +
      '  different surfaces according to which side of the box it lands on.\n'
    : `\n  self-test FAILED on ${bad} case(s); do not trust this tool's numbers.\n`);
  return bad === 0;
}

/* ---------------------------------------------------------- frozen sites */

/* The one key a below-AA site is recognised by. Per SITE — theme, state,
   selector and the words themselves — because a ratchet keyed any coarser
   absorbs new instances of a frozen defect: one entry for `div.fore` would
   silently cover a second `div.fore` that appears next week, or a third, and
   the list would read the same either way. */
function siteKey(r) {
  return `${r.theme}/${r.state} ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''}` +
    ` "${r.text}"`;
}

/* How far a frozen ratio may drift before the entry is treated as stale.
   Not zero: the sampled colour of a hatched surface is a mean over real
   pixels, and a renderer that anti-aliases the 135° edge differently moves it
   by a fraction of a level. Measured identical across repeated local runs;
   this is headroom for a different Chrome build, not for a different value. */
const FREEZE_TOLERANCE = 0.15;

/* Sites that are below AA on the page as it stands, frozen one at a time so
   this guard can land on a page that is not yet clean.

   A frozen entry is an exemption, so it is written to expire: the reconciler
   below fails if one stops reproducing, if it matches more than one site, or
   if the number moves. Each entry carries the issue that tracks the fix.

   This list is not a place to put a site you have not looked at. */
const KNOWN_BELOW_AA = [
  {
    theme: 'light',
    states: ['live', 'loading', 'empty', 'degraded'],
    selector: 'div.fore',
    text: '+26%',
    ratio: 4.49,
    need: 4.5,
    issue: 'https://github.com/Stadiora/Aria/issues/10366',
    why: 'The forecast half of the budget bar paints --amber-ink over a 22% amber hatch. ' +
      'On the stripe that is #92400E on #DFCABB — 4.49:1 against a 4.5:1 requirement. ' +
      'The gap between stripes clears AA at 6.01:1, so the text is legible for part of ' +
      'every letter and not the rest. ops/assets/aria.css is shared by four pane agents ' +
      'and is not this PR to edit.'
  }
];

/* ------------------------------------------------------------------ main */

/* The one key a focus site is recognised by. Same per-site shape as siteKey
   and for the same reason, with the tab index deliberately left OUT: a
   control that moves earlier in the tab order is the same control, and
   keying on its position would retire the entry every time a button is added
   above it. */
function focusKey(r) {
  return `${r.theme}/${r.state} ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''}` +
    ` "${r.text}"`;
}

/* Two frozen surface hexes are the same surface if no channel differs by more
   than a byte. Not an equality test, because a bucket's mean is taken over
   real pixels and a renderer that antialiases a rounded corner differently
   moves it a fraction of a level — and not a loose one either: the greys this
   page's rings actually land between are three bytes apart, so a genuine move
   from one to another is still caught. */
function sameSurface(a, b) {
  const rgb = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= 1);
}

/* Focus rings that are below 3:1 on the page as it stands, and focus
   indicators this tool cannot measure at all, frozen one at a time so this
   sweep can land on a page that is not yet clean.

   Every entry here is in ops/assets/aria.css, which is shared by four pane
   agents and is not this PR's to edit — so each is filed as its own issue and
   enumerated here, never skipped silently. The reconciler below fails in both
   directions exactly as KNOWN_BELOW_AA's does: an entry that stops
   reproducing, an entry matching anything other than one site, or a ratio
   that drifts past FREEZE_TOLERANCE. */
const KNOWN_BELOW_FOCUS = [
  {
    theme: 'light',
    states: ['loading', 'empty'],
    selector: 'button.btn.btn-primary',
    text: "Primary",
    ratio: 2.64,
    ring: '#0891B2',
    against: '#BCE0EA',
    issue: 'https://github.com/Stadiora/Aria/issues/10650',
    why: 'The primary button paints its own cyan glow, and the focus ring is the same cyan 2px out — so the ring sits on pixels the button tinted itself.'
  },
  {
    theme: 'light',
    states: ['live', 'degraded'],
    selector: 'button.btn.btn-primary',
    text: "Primary",
    ratio: 2.65,
    ring: '#0891B2',
    against: '#BDE1EA',
    issue: 'https://github.com/Stadiora/Aria/issues/10650',
    why: 'The primary button paints its own cyan glow, and the focus ring is the same cyan 2px out — so the ring sits on pixels the button tinted itself.'
  },
  {
    theme: 'light',
    states: ['degraded'],
    selector: 'button.on',
    text: "Degraded",
    ratio: 2.73,
    ring: '#0891B2',
    against: '#DBDEE4',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live'],
    selector: 'button.on',
    text: "Live data",
    ratio: 2.73,
    ring: '#0891B2',
    against: '#DBDEE4',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['loading'],
    selector: 'button.on',
    text: "Loading",
    ratio: 2.73,
    ring: '#0891B2',
    against: '#DBDEE4',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['empty'],
    selector: 'button.on',
    text: "No data",
    ratio: 2.73,
    ring: '#0891B2',
    against: '#DBDEE4',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['empty'],
    selector: 'button',
    text: "Mobile",
    ratio: 2.75,
    ring: '#0891B2',
    against: '#D7E0E5',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['empty'],
    selector: 'button.on',
    text: "All",
    ratio: 2.75,
    ring: '#0891B2',
    against: '#D7E0E5',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'empty'],
    selector: 'button',
    text: "Degraded",
    ratio: 2.81,
    ring: '#0891B2',
    against: '#DEE1E7',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['loading', 'empty', 'degraded'],
    selector: 'button',
    text: "Live data",
    ratio: 2.81,
    ring: '#0891B2',
    against: '#DEE1E7',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'empty', 'degraded'],
    selector: 'button',
    text: "Loading",
    ratio: 2.81,
    ring: '#0891B2',
    against: '#DEE1E7',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'degraded'],
    selector: 'button',
    text: "No data",
    ratio: 2.81,
    ring: '#0891B2',
    against: '#DEE1E7',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'degraded'],
    selector: 'button.on',
    text: "All",
    ratio: 2.81,
    ring: '#0891B2',
    against: '#DEE1E6',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['empty'],
    selector: 'button',
    text: "Coaches Web",
    ratio: 2.89,
    ring: '#0891B2',
    against: '#E1E4E9',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'degraded'],
    selector: 'button',
    text: "Mobile",
    ratio: 2.89,
    ring: '#0891B2',
    against: '#E1E4E9',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'degraded'],
    selector: 'button',
    text: "Coaches Web",
    ratio: 2.91,
    ring: '#0891B2',
    against: '#E1E5E9',
    issue: 'https://github.com/Stadiora/Aria/issues/10649',
    why: 'outline-offset: 2px puts the ring outside the button, on the segmented control\'s own surface rather than on the page behind it.'
  }
];

/* Focus indicators this tool refuses to measure, enumerated for the same
   reason: a refusal that is not named is a site that left the sweep. Each
   entry carries the REASON as well as the control, so an exemption written
   for one thing this tool declines cannot go on covering the same control
   once its indicator changes to something else it declines. */
const KNOWN_UNMEASURABLE_FOCUS = [
  {
    theme: 'dark',
    states: ['live', 'loading', 'empty', 'degraded'],
    selector: 'input',
    text: 'Search a coded reference',
    because: 'is not an outline',
    issue: 'https://github.com/Stadiora/Aria/issues/10651',
    why: 'The search field indicates focus with .field:focus-within box-shadow, and both of ' +
      'its layers are translucent color-mix()es of --cyan. There is no outline in the ' +
      'ancestor chain to find edges from, and an ink this tool cannot resolve exactly is ' +
      'refused rather than assumed opaque. Nothing here says the indicator fails — only ' +
      'that this tool will not claim it passes.'
  },
  {
    theme: 'light',
    states: ['live', 'loading', 'empty', 'degraded'],
    selector: 'input',
    text: 'Search a coded reference',
    because: 'is not an outline',
    issue: 'https://github.com/Stadiora/Aria/issues/10651',
    why: 'The light-theme half of the same field. Same indicator, same refusal.'
  }
];
/* How many measured sites were below AA and exempted by KNOWN_BELOW_AA. Held
   out of the passing count and named in the closing line, so a page carrying
   known failures never reports itself clean. */
let frozenCount = 0;
/* Same, for focus rings below 3:1. */
let frozenFocusCount = 0;

/* The focus sweep's floor, and it is a floor on how many controls were LOOKED
   at rather than on how many were judged: a change that turned every ring on
   the page into a refusal would leave "judged" at zero while the run still
   failed for the right reason, and a floor on judged sites alone would fire
   twice for the same event. Set just under the real census — 26 a pass, 208
   across the eight — because a floor set far below what the page carries is a
   floor that never fires. */
const FOCUS_SITE_FLOOR = 180;

try {
  const cdpPort = await devtoolsPort(profile);
  const target = await devtools(cdpPort, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false
  });

  /* The tool proves itself before it judges anything. */
  const proved = await selfTest();
  if (!proved) {
    failures.push('the self-test failed, so nothing below was measured');
  }

  if (proved && !selfTestOnly) {
    let checked = 0;
    let exempt = 0;
    const unjudged = new Map();
    const worst = new Map();
    const belowAA = [];
    let focusChecked = 0;
    const focusWorst = new Map();
    const focusBelow = [];
    const focusRefused = [];

    for (const theme of THEMES) {
      await setTheme(theme);
      for (const state of STATES) {
        await load(origin + SHELL);
        const applied = await evaluate(`(() => {
          window.Aria.applyState(${JSON.stringify(state)});
          return JSON.stringify({
            theme: document.documentElement.getAttribute('data-theme'),
            state: [...document.querySelectorAll('#stateSeg button[aria-pressed="true"]')]
              .map((b) => b.getAttribute('data-value'))[0] || null,
            stateBlocks: document.querySelectorAll('[data-state]').length
          });
        })()`);

        /* A pass that measured the wrong page is a failure, not a skip: the
           sweep's own count would otherwise look the same either way. */
        if (applied.theme !== theme) {
          failures.push(`${SHELL}: asked for the ${theme} theme, the page rendered ${applied.theme}`);
          continue;
        }
        if (applied.state !== state) {
          failures.push(`${SHELL} (${theme}): asked for state ${state}, the page reports ` +
            `${applied.state}. The state walk would measure one state four times.`);
          continue;
        }
        if (!applied.stateBlocks) {
          failures.push(`${SHELL} (${theme}): no [data-state] blocks on the page, so the ` +
            'state walk is measuring the same pixels four times.');
          continue;
        }

        const shadow = await shadowHosts();
        if (shadow.length) {
          failures.push(`${SHELL} (${theme}/${state}): ${shadow.length} author shadow root(s) ` +
            'on the page. Nothing in this tool enters one, so their text leaves the sweep with ' +
            'no site, no refusal and no census entry, and the count below would be short by ' +
            `exactly that much in silence: ${shadow.join('; ')}`);
          continue;
        }

        const frames = await nestedFrames();
        if (frames.length) {
          failures.push(`${SHELL} (${theme}/${state}): ${frames.length} nested browsing ` +
            'context(s) on the page. Nothing in this tool enters one — a frame is a separate ' +
            'document, so the * walks miss its text, the plate stylesheet is not installed in ' +
            'it and no range can be taken over it — while it paints into the same screenshot, ' +
            `so the count below would be short by whatever it renders: ${frames.join('; ')}`);
          continue;
        }

        const uaText = await uaTextNoSource();
        if (uaText.length) {
          failures.push(`${SHELL} (${theme}/${state}): ${uaText.length} element(s) whose ` +
            'user-agent shadow root paints words this tool has no source for — not an own text ' +
            'node, not .selectedOptions, not .value, not .placeholder — so they leave the sweep ' +
            'with no site, no refusal and no census entry, and the count below does not move: ' +
            `${uaText.join('; ')}`);
          continue;
        }

        const generated = await evaluate(GENERATED_TEXT);
        if (generated.count) {
          failures.push(`${SHELL} (${theme}/${state}): ${generated.count} element(s) paint ` +
            'generated text, which this tool cannot measure — it has no text node to range ' +
            'over and no box of its own. Put the words in the document, or this sweep is ' +
            `short by ${generated.count} site(s) and says nothing about them: ` +
            generated.found.join('; '));
        }

        const targets = await evaluate(COLLECT);
        const results = await measureSites(targets, `${SHELL} (${theme}/${state})`);
        for (const r of results) {
          /* The refusal is checked FIRST. Until round 7 the exemption ran
             ahead of it, so marking a subtree inactive turned 56 refusals
             into 56 exemptions and the run went green on paint the tool had
             already declined to model. A site this tool cannot speak for is
             reported whatever its control state. */
          if (r.unjudgeable) {
            const key = `${r.unjudgeable}|${r.cls || r.tag}|${r.ink}`;
            const prev = unjudged.get(key);
            if (prev) prev.n++;
            else unjudged.set(key, { ...r, theme, state, n: 1 });
            continue;
          }
          if (r.inactive) { exempt++; continue; }
          checked++;
          const key = `${r.cls || r.tag}|${theme}`;
          const prev = worst.get(key);
          if (!prev || r.ratio < prev.ratio) worst.set(key, { ...r, theme, state });
          /* Half a hundredth of slack, which is the rounding of the printed
             number: a site that reports "4.50:1 needs 4.5:1" must not fail on
             a difference no reader of this output can see. The page's own
             worst site sits 0.0085 under its requirement and is caught. */
          if (r.ratio + 0.005 < r.need) belowAA.push({ ...r, theme, state });
        }
        if (verbose) {
          console.log(`  walked ${SHELL} [${theme}/${state}] — ${results.length} text sites`);
        }

        /* The focus sweep runs after the text sweep on the same loaded page,
           and never before it: the Tab walk leaves focus somewhere, and a
           focused control paints differently. */
        const focus = await measureFocusIndicators(`${SHELL} (${theme}/${state})`);
        /* Everything Tab can reach must be something this sweep judged.
           tabindex="-1" is the one legitimate way to be focusable and not
           tab-reachable, so it is subtracted rather than ignored — and a
           stop Tab makes on something the census never tagged is a site with
           no row at all, which is the shape this whole file exists to stop. */
        const reachable = focus.census.candidates -
          (await evaluate(`(() => JSON.stringify({
            n: [...document.querySelectorAll('[data-focus-site][tabindex="-1"]')].length
          }))()`)).n;
        if (focus.census.reached !== reachable) {
          failures.push(`${SHELL} (${theme}/${state}): Tab reaches ${focus.census.reached} ` +
            `control(s) but ${reachable} of the ${focus.census.candidates} censused are ` +
            'tab-reachable. A control the census misses is measured by nothing here, and a ' +
            'control Tab cannot reach has no focus ring to measure.');
        }
        if (focus.census.unknownStops) {
          failures.push(`${SHELL} (${theme}/${state}): Tab stopped ${focus.census.unknownStops} ` +
            'time(s) on something the focus census never tagged, so that control is reachable ' +
            'by keyboard and judged by nothing.');
        }
        for (const r of focus.rows) {
          if (r.refused) { focusRefused.push({ ...r, theme, state }); continue; }
          focusChecked++;
          const key = `${r.cls || r.tag}|${theme}`;
          const prev = focusWorst.get(key);
          if (!prev || r.ratio < prev.ratio) focusWorst.set(key, { ...r, theme, state });
          if (r.ratio + 0.005 < r.need) focusBelow.push({ ...r, theme, state });
        }
        if (verbose) {
          console.log(`  focused ${SHELL} [${theme}/${state}] — ${focus.rows.length} controls, ` +
            `${focus.census.reached} reached by Tab`);
        }
      }
    }

    /* A sweep that measured almost nothing reports the same "all good" as one
       that measured everything, so the floor is an assertion rather than a
       note. Set just under the real count — 1636 across the eight passes, 203
       to 206 in each — because a floor set far below what the page carries is
       a floor that never fires. */
    if (checked < 1400) {
      failures.push(`${SHELL}: only ${checked} text sites were judged across ` +
        `${THEMES.length} themes × ${STATES.length} states, so the sweep measured almost ` +
        'nothing. The shell carries 203 to 206 a pass, 1636 in total.');
    }

    /* Refused sites are failures, not footnotes. A guard that prints a skip
       and exits 0 reports a coverage it does not have — the #10255 shape,
       where 40 dropped sites hid 10 real failures. */
    const unjudgedRows = [...unjudged.values()].sort((a, b) => b.n - a.n);
    const unjudgedTotal = unjudgedRows.reduce((n, u) => n + u.n, 0);
    if (unjudgedTotal) {
      failures.push(`${SHELL}: ${unjudgedTotal} text site(s) could not be judged at all — ` +
        unjudgedRows.map((u) => `${u.unjudgeable}: ${u.tag}` +
          `${u.cls ? '.' + u.cls.split(/\s+/).join('.') : ''} ink "${u.ink}"` +
          `${u.detail ? ` (${u.detail})` : ''} ×${u.n}`).join('; ') +
        '. Nothing here speaks for them: teach the tool the case or fix the site.');
    }

    /* Reconcile what failed against what is frozen. Both directions: a site
       below AA that is not frozen is a new defect, and a frozen entry that no
       longer reproduces is a hole in the sweep — an exemption still standing
       over a site that was fixed, moved or deleted. A freeze list only
       asserted in one direction rots in the other. */
    const frozen = new Map();
    for (const e of KNOWN_BELOW_AA) {
      for (const st of e.states) frozen.set(`${e.theme}/${st} ${e.selector} "${e.text}"`, e);
    }
    const matched = new Map();
    for (const r of belowAA.sort((a, b) => a.ratio - b.ratio)) {
      const key = siteKey(r);
      if (frozen.has(key)) {
        if (!matched.has(key)) matched.set(key, []);
        matched.get(key).push(r);
        continue;
      }
      failures.push(`${SHELL} (${r.theme}/${r.state}): ${r.ratio.toFixed(2)}:1 needs ` +
        `${r.need.toFixed(1)}:1 — ${r.fg} on ${r.bg}` +
        `${r.surfaces > 1 ? ` (worst of ${r.surfaces} surfaces at the glyphs; ` +
          `best ${r.best.toFixed(2)}:1 on ${r.bestBg})` : ''}` +
        `, ${r.fontSize}px ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''} "${r.text}"`);
    }
    for (const [key, e] of frozen) {
      const rows = matched.get(key) || [];
      if (rows.length !== 1) {
        failures.push(`${SHELL}: the frozen below-AA site ${key} matched ${rows.length} ` +
          'measured site(s), not 1. That entry exempts a site from this sweep, so it may ' +
          'not outlive what it exempts: delete it if the site was fixed or removed, or ' +
          'correct it if the site moved. (' + e.issue + ')');
        continue;
      }
      const got = rows[0];
      if (Math.abs(got.ratio - e.ratio) > FREEZE_TOLERANCE) {
        failures.push(`${SHELL}: the frozen below-AA site ${key} measures ` +
          `${got.ratio.toFixed(2)}:1, not the ${e.ratio.toFixed(2)}:1 it was frozen at. ` +
          `${got.ratio < e.ratio ? 'It got worse' : 'It improved'} — re-measure it, and ` +
          'either move the number or drop the entry. (' + e.issue + ')');
      } else if (got.need !== e.need) {
        failures.push(`${SHELL}: the frozen below-AA site ${key} now needs ` +
          `${got.need.toFixed(1)}:1, not the ${e.need.toFixed(1)}:1 it was frozen at. Every ` +
          'site needs AA_RATIO, so this fires only if that constant moved under the entry. ' +
          'Re-measure it. (' + e.issue + ')');
      }
    }
    frozenCount = [...matched.values()].reduce((n, r) => n + r.length, 0);
    if (frozenCount) {
      note(`${frozenCount} site(s) are below AA and frozen — this sweep does not fail on ` +
        'them, they are NOT part of the passing count below, and each is listed in ' +
        'KNOWN_BELOW_AA with the issue that tracks it');
    }

    /* ------------------------------------------- the focus sweep's accounts

       Same shape as the text sweep's, because the failure modes are the same
       ones: a sweep that measured almost nothing prints the same closing line
       as one that measured everything, a refusal that is not named is a site
       that left, and a freeze list asserted in one direction rots in the
       other. */
    if (focusChecked + focusRefused.length < FOCUS_SITE_FLOOR) {
      failures.push(`${SHELL}: only ${focusChecked + focusRefused.length} focus indicator(s) ` +
        `were looked at across ${THEMES.length} themes × ${STATES.length} states, so the ` +
        'focus sweep measured almost nothing. The shell carries 26 focusable controls a ' +
        'pass, 208 in total.');
    }

    const frozenRefusals = new Map();
    for (const e of KNOWN_UNMEASURABLE_FOCUS) {
      for (const st of e.states) {
        frozenRefusals.set(`${e.theme}/${st} ${e.selector} "${e.text}"`, e);
      }
    }
    const matchedRefusals = new Map();
    for (const r of focusRefused) {
      const key = focusKey(r);
      const e = frozenRefusals.get(key);
      /* The REASON is part of the entry. An exemption written for a
         box-shadow indicator must not go on covering the same control when
         its indicator changes to something else this tool declines for a
         different reason — that is a new fact about the page, not the one
         that was signed off. */
      if (e && r.refused.includes(e.because)) {
        if (!matchedRefusals.has(key)) matchedRefusals.set(key, []);
        matchedRefusals.get(key).push(r);
        continue;
      }
      failures.push(`${SHELL} (${r.theme}/${r.state}): the focus indicator on ` +
        `${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''} "${r.text}" could not be ` +
        `judged — ${r.refused}` +
        `${e ? `. There IS a frozen entry for this control, but it was frozen for "${e.because}"` +
          ` and this is a different reason (${e.issue})` : ''}` +
        '. Nothing here speaks for it: teach the tool the case or fix the indicator.');
    }
    for (const [key, e] of frozenRefusals) {
      const rows = matchedRefusals.get(key) || [];
      if (rows.length !== 1) {
        failures.push(`${SHELL}: the frozen unmeasurable focus indicator ${key} matched ` +
          `${rows.length} refused site(s), not 1. That entry exempts a control from this ` +
          'sweep, so it may not outlive what it exempts: delete it if the indicator was ' +
          'fixed or the control removed, or correct it if it moved. (' + e.issue + ')');
      }
    }

    const frozenFocus = new Map();
    for (const e of KNOWN_BELOW_FOCUS) {
      for (const st of e.states) frozenFocus.set(`${e.theme}/${st} ${e.selector} "${e.text}"`, e);
    }
    const matchedFocus = new Map();
    for (const r of focusBelow.sort((a, b) => a.ratio - b.ratio)) {
      const key = focusKey(r);
      if (frozenFocus.has(key)) {
        if (!matchedFocus.has(key)) matchedFocus.set(key, []);
        matchedFocus.get(key).push(r);
        continue;
      }
      failures.push(`${SHELL} (${r.theme}/${r.state}): focus ring ${r.ratio.toFixed(2)}:1 needs ` +
        `${r.need.toFixed(1)}:1 — ${r.ringHex} against ${r.bg}` +
        `${r.surfaces > 1 ? ` (worst of ${r.surfaces} surfaces beside the ring; ` +
          `best ${r.best.toFixed(2)}:1 on ${r.bestBg})` : ''}` +
        `, ${r.ring} on ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''} "${r.text}"`);
    }
    for (const [key, e] of frozenFocus) {
      const rows = matchedFocus.get(key) || [];
      if (rows.length !== 1) {
        failures.push(`${SHELL}: the frozen below-3:1 focus ring ${key} matched ${rows.length} ` +
          'measured ring(s), not 1. That entry exempts a ring from this sweep, so it may not ' +
          'outlive what it exempts: delete it if the ring was fixed or removed, or correct ' +
          'it if it moved. (' + e.issue + ')');
        continue;
      }
      const got = rows[0];
      if (Math.abs(got.ratio - e.ratio) > FREEZE_TOLERANCE) {
        failures.push(`${SHELL}: the frozen below-3:1 focus ring ${key} measures ` +
          `${got.ratio.toFixed(2)}:1, not the ${e.ratio.toFixed(2)}:1 it was frozen at. ` +
          `${got.ratio < e.ratio ? 'It got worse' : 'It improved'} — re-measure it, and ` +
          'either move the number or drop the entry. (' + e.issue + ')');
      } else if (!sameSurface(got.bg, e.against)) {
        /* The adjacent surface is half the measurement, so a ring that is
           still 2.73:1 against a DIFFERENT colour is a different fact and the
           entry no longer describes it. One byte per channel of slack, which
           is renderer noise in the mean over a bucket, and far under the
           three-byte gap between the two greys this page actually produces. */
        failures.push(`${SHELL}: the frozen below-3:1 focus ring ${key} now lands on ` +
          `${got.bg}, not the ${e.against} it was frozen against. The ratio is unchanged, so ` +
          'this is the ring moving to another surface rather than the surface changing ' +
          'colour. Re-measure it. (' + e.issue + ')');
      } else if (got.ringHex !== e.ring) {
        failures.push(`${SHELL}: the frozen below-3:1 focus ring ${key} is now painted ` +
          `${got.ringHex}, not the ${e.ring} it was frozen at. (` + e.issue + ')');
      }
    }
    frozenFocusCount = [...matchedFocus.values()].reduce((n, r) => n + r.length, 0);
    const frozenRefusalCount = [...matchedRefusals.values()].reduce((n, r) => n + r.length, 0);
    if (frozenFocusCount || frozenRefusalCount) {
      note(`${frozenFocusCount} focus ring(s) are below ${FOCUS_RATIO.toFixed(1)}:1 and ` +
        `${frozenRefusalCount} focus indicator(s) cannot be measured at all — frozen, NOT part ` +
        'of the passing count below, each listed in KNOWN_BELOW_FOCUS or ' +
        'KNOWN_UNMEASURABLE_FOCUS with the issue that tracks it');
    }

    if (!failures.length && !unjudgedTotal) {
      note(`${checked - frozenCount} rendered text sites across ${THEMES.length} themes × ` +
        `${STATES.length} states meet WCAG AA, ${exempt} exempt as inactive controls`);
      const floor = [...worst.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 5);
      console.log('    closest five to their threshold:');
      for (const r of floor) {
        console.log(`      ${r.ratio.toFixed(2)}:1 (needs ${r.need.toFixed(1)})  ${r.theme.padEnd(5)}` +
          ` ${r.fg} on ${r.bg}  ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''}  "${r.text}"` +
          `${frozen.has(siteKey(r)) ? '   [frozen, below AA]' : ''}`);
      }
      note(`${focusChecked - frozenFocusCount} rendered focus indicators across ` +
        `${THEMES.length} themes × ${STATES.length} states meet WCAG ` +
        `${FOCUS_RATIO.toFixed(1)}:1 against the surfaces they land on`);
      const focusFloor = [...focusWorst.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 5);
      console.log('    closest five focus rings to their threshold:');
      for (const r of focusFloor) {
        console.log(`      ${r.ratio.toFixed(2)}:1 (needs ${r.need.toFixed(1)})  ${r.theme.padEnd(5)}` +
          ` ${r.ringHex} beside ${r.bg}  ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/).join('.') : ''}` +
          `  "${r.text}"  offset ${r.offset}` +
          `${frozenFocus.has(focusKey(r)) ? '   [frozen, below 3:1]' : ''}`);
      }
    }
  }
} finally {
  cdp?.close();
  browser.kill();
  server.close();
  /* Best effort: Chrome can still be flushing its profile as this runs, and a
     failed cleanup must not turn a passing sweep into a crash. */
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch { /* the run is over; a leftover profile directory is not a finding */ }
}

if (failures.length) {
  console.error('\nFAIL\n' + failures.map((f) => '  - ' + f).join('\n') + '\n');
  process.exit(1);
}
console.log(selfTestOnly
  ? '\nSelf-test only: the tool proved itself and measured no page.\n'
  : '\nEvery text site this tool reaches on the v2 shell meets WCAG AA, and every focus ring ' +
    'it can measure meets SC 1.4.11, in both themes and ' +
    `all four states${frozenCount ? `, except the ${frozenCount} frozen in KNOWN_BELOW_AA` : ''}` +
    `${frozenFocusCount ? ` and the ${frozenFocusCount} in KNOWN_BELOW_FOCUS` : ''}. ` +
    'What it does not reach is in NOT COVERED in ops/README.md, and the sweep fails rather ' +
    'than shrinks when it meets something new.\n');
