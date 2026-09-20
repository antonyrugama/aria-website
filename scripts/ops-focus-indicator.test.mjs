/* WCAG 2.2 SC 1.4.11 for the FOCUS INDICATORS on the v2 operations shell.
 *
 * SC 1.4.11 asks a focus indicator to reach 3:1 against ITS OWN adjacent
 * colours. Not against the page background, not against the token palette:
 * against whatever is actually painted immediately beside the ring, which on
 * this page is a stack of gradients, translucent surfaces and, on the primary
 * button, the component's own cyan glow. So this measures rendered pixels in
 * real Chrome rather than reading the stylesheet.
 *
 * WHY THIS FILE IS NOT A STYLESHEET SCAN. `aria.css` contains the string
 * `outline: 2px solid var(--cyan-ink)` both before and after the ring is
 * correct, because the same string was there when the ring measured 2.73:1 —
 * only the token it named changed. An assertion that greps for a declaration
 * pins the string, not the contrast, and stays green through the whole defect
 * (Stadiora/Aria#10649, #10650). Every number below comes off a screenshot.
 *
 * WHAT IT DOES, per focus site, per theme, per preview state:
 *
 *   1. Focuses the control for real — a Tab keystroke first, so Chrome's
 *      keyboard modality flag is set and `:focus-visible` actually matches,
 *      then a scripted focus to reach sites Tab order would take a hundred
 *      presses to walk. Every site asserts `:focus-visible` matched; a site
 *      that did not is a failure, never a skip.
 *   2. Finds the indicator on the nearest ancestor-or-self that paints an
 *      outline. The search field's indicator lives on its `.field` WRAPPER,
 *      not on the input — an indicator that only exists on an ancestor is
 *      still the control's indicator.
 *   3. REFUSES, by name and as a failure, anything it cannot measure exactly:
 *      no outline anywhere in the chain, a zero-width outline, an outline
 *      colour that is not fully opaque, or an outline whose declared colour is
 *      not the colour that actually painted. The ring is an INK, and the
 *      conservative direction for an ink is to refuse rather than to assume:
 *      reading a faded ring as solid reports it MORE contrasty than the pixels
 *      are. This refusal is what Stadiora/Aria#10651 was: a translucent
 *      box-shadow is an indicator no oracle can verify, and an indicator no
 *      tool can verify is an indicator that will silently rot.
 *   4. Computes where the ring lands from `outline-offset` and
 *      `outline-width`, because those two together decide WHICH surface is
 *      adjacent. A positive offset paints outside the element (on the
 *      container, or on the button's own glow); a negative offset paints
 *      inside it (on the element's own fill). Changing one changes the other's
 *      answer, so neither is assumed.
 *   5. Samples the real pixels immediately beside the ring on both sides,
 *      buckets them the way a gradient demands — a gradient is one surface
 *      spread over dozens of shades — and takes the WORST bucket. The adjacent
 *      surface is a FILL, and the conservative direction for a fill is that
 *      every surface beside the ring counts, including one holding a small
 *      share of the perimeter: that is precisely where a ring disappears.
 *
 * NOT COVERED — read this before trusting a green run:
 *
 *   - Only `/ops/shell-v2.html`. The ten v2 panes load `aria.css` too, and
 *     four of them override `:focus-visible` in their own stylesheet with
 *     their own hard-coded colour. Those rules are not measured here and are
 *     not this file's to change.
 *   - Only the outline-shaped indicator. A control whose indicator is a
 *     box-shadow, a background swap or a border change is REFUSED, not
 *     measured. Refusal is a failure, so nothing is silently skipped, but
 *     "passes" never means "this non-outline indicator is fine".
 *   - The immediately adjacent pixel on each side is DISCARDED where it
 *     straddles an edge, as an anti-aliasing blend, and so are the corner
 *     arcs. A surface only one pixel wide, sitting only at a corner, is
 *     therefore invisible to this.
 *   - Only the pixel row the ring TOUCHES is judged, on each face of each
 *     side. A surface that starts further away than that is not measured.
 *   - Adjacent buckets holding fewer than MIN_BUCKET pixels, or less than
 *     MIN_SHARE of the pixels beside the ring, are dropped as incidental
 *     content crossing the band rather than a surface the ring sits on. A
 *     ring that grazes a few pixels of text — the skip link does, over the
 *     rail — is therefore judged against the rail, not against the glyph.
 *   - Contrast only. Indicator AREA and the 2px-minimum-thickness half of SC
 *     2.4.13 are not implemented.
 *   - A ring painted OVER by something else is not detected except where the
 *     over-paint changes the ring's own colour enough to trip the paint check.
 *
 * Chrome: CHROME_PATH, or the usual install locations. No package manager and
 * no dependency, because this repository has neither: the PNG decoder and the
 * DevTools client are in this file.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';
const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];
const VIEWPORT = { width: 1440, height: 1000 };

/* WCAG 2.2 SC 1.4.11 Non-text Contrast: 3:1. Written here as an independent
   contract, never derived from the stylesheet under test — an expectation
   computed from the thing it is checking moves with the defect. */
const FOCUS_RATIO = 3.0;

/* Float slack on a ratio recomputed from 8-bit pixels. Small enough that the
   2.64:1 and 2.73:1 the issues measured are still failures by a wide margin. */
const EPS = 0.005;

/* How many clean pixel rows to read on each side of the ring, on each of its
   two faces. One: the row the ring TOUCHES. A surface that starts further
   away is seen through something else and is not what the ring is judged
   against — and reading deeper is how the inner sample fell through a 2px
   offset gap onto .btn-primary's own 1px glow, which does not touch the ring
   at all. */
const ADJACENT_ROWS = 1;

/* Bucket width for grouping sampled pixels into surfaces. A gradient is one
   surface over many shades; without this every shade is its own "surface" and
   the worst-of picks a single pixel. */
const BUCKET = 8;

/* A bucket smaller than this is noise — an icon edge, a glyph, a stray blend —
   not a surface a ring can disappear against. */
const MIN_BUCKET = 8;

/* ...and neither is a colour that crosses only a sliver of the ring's
   surroundings. Measured on the unfixed stylesheet: the skip link's ring in
   light grazes 10 pixels of #4E5B71 body text — 2% of the 500 pixels beside
   it — while 365 of them are pale topbar surface. A ring cannot be recoloured
   to survive a graze like that (no solid colour clears 3:1 against both
   #E5E7EA and #4E5B71; the two luminance constraints contradict each other),
   so judging one would report a defect no colour change can answer. The
   defects these issues name are all far above this line: the smallest of them
   holds 3.6% of its ring's surroundings, and most hold 12-24%. */
const MIN_SHARE = 0.03;

/* Below this many usable adjacent pixels there is nothing to take a worst-of
   over, so the site is refused rather than judged on a handful. */
const MIN_ADJACENT = 24;

/* Every pass must judge at least this many rings. A focus oracle that silently
   judges zero is the worst false green available here: it prints "everything
   passes" having measured nothing. The shell carries far more than this; the
   floor is a tripwire, not a census. */
const SITE_FLOOR = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg'
};

/* ------------------------------------------------------- self-test fixture */

/* Known-answer page for the measurement itself. Every expected ratio below is
   a PUBLISHED WCAG value for a grey on white or on black, written into the
   assertions by hand, so nothing here is derived from the code being proven.
   The fixture is served by this file's own server and carries no CSP, which is
   why it may use a <style> element the shipped pages may not. */
const SELF_TEST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>focus self-test</title><style>
  html, body { margin: 0; padding: 0; background: #FFFFFF; }
  button { display: block; margin: 60px; width: 160px; height: 44px;
           border: 0; border-radius: 0; background: #FFFFFF; color: #FFFFFF;
           font-size: 12px; }
  /* #949494 on white is 3.03:1, #767676 on white is 4.54:1 — the two greys
     WCAG's own examples use. */
  #justOver:focus  { outline: 4px solid #949494; outline-offset: 6px; }
  #clearlyOver:focus { outline: 4px solid #767676; outline-offset: 6px; }
  /* Same ring, a black page, and the offset moved from outside the element to
     inside it. Outside, the ring is beside black (#B0B0B0 on #000 is 9.68:1);
     inside, it is beside the element's own white fill (2.17:1). One value
     cannot answer both, which is the point. */
  /* Padding, not margin: a child's margin COLLAPSES out of a parent that has
     neither, so the black would stop at the button's own edge and the ring
     would be photographed against the white body instead. */
  #onBlack { background: #000000; padding: 1px; }
  #onBlack button { background: #FFFFFF; }
  #outside:focus { outline: 4px solid #B0B0B0; outline-offset: 8px; }
  #inside:focus  { outline: 4px solid #B0B0B0; outline-offset: -12px; }
  /* The Stadiora/Aria#10651 shape: focus indicated by a translucent shadow,
     with no outline anywhere in the chain. */
  #shadowOnly:focus { outline: 0; box-shadow: 0 0 0 3px rgba(8, 145, 178, .4); }
  /* An outline that is declared but not opaque. */
  #translucent:focus { outline: 4px solid rgba(8, 145, 178, .5); outline-offset: 6px; }
</style></head><body>
<button id="justOver" type="button">a</button>
<button id="clearlyOver" type="button">b</button>
<button id="shadowOnly" type="button">c</button>
<button id="translucent" type="button">d</button>
<div id="onBlack">
  <button id="outside" type="button">e</button>
  <button id="inside" type="button">f</button>
</div>
</body></html>`;

/* ----------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__focus-self-test.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(SELF_TEST_HTML);
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
const NO_MOTION = `(() => {
  const s = new CSSStyleSheet();
  s.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  return JSON.stringify({ sheets: document.adoptedStyleSheets.length });
})()`;

/* Everything a keyboard could put a ring on, tagged so each one can be found
   again. Elements that paint nothing are not focus sites; everything else is,
   including tabindex="-1", which script can focus even though Tab skips it. */
const FOCUS_SITES = `(() => {
  const SEL = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.disabled) continue;
    if (r.width < 1 || r.height < 1) continue;
    el.setAttribute('data-focus-site', String(i));
    const label = (el.textContent || '').replace(/\\s+/g, ' ').trim() ||
      (el.getAttribute('aria-label') || '').trim() ||
      (el.getAttribute('placeholder') || '').trim() ||
      (el.id ? '#' + el.id : '');
    out.push({
      i,
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.trim() : '',
      text: label.slice(0, 40)
    });
    i++;
  }
  return JSON.stringify(out);
})()`;

/* Focus one site and report the indicator the browser resolved for it.
   Everything is read AFTER the focus, because focus can move an element —
   `.skip` slides into view on focus and its rect before the focus is not the
   rect the ring is drawn around. */
const FOCUS_ONE = (i) => `(() => {
  const el = document.querySelector('[data-focus-site="${i}"]');
  if (!el) return JSON.stringify({ error: 'site ${i} disappeared between the census and the measurement' });
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus({ preventScroll: true });
  if (document.activeElement !== el) {
    return JSON.stringify({ error: 'the element refused focus' });
  }
  const focusVisible = el.matches(':focus-visible');
  /* The indicator is on the nearest ancestor-or-self that paints an outline.
     The search field's ring lives on its .field WRAPPER, and an indicator that
     only exists on an ancestor is still this control's indicator. */
  let node = el, holder = null;
  const chain = [];
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    chain.push(node.tagName.toLowerCase() + (node.className && typeof node.className === 'string'
      ? '.' + node.className.trim().split(/\\s+/).join('.') : ''));
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) { holder = { node, cs }; break; }
    node = node.parentElement;
  }
  const r = el.getBoundingClientRect();
  if (!holder) {
    return JSON.stringify({
      focusVisible, chain: chain.slice(0, 6),
      indicator: null,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }
    });
  }
  const hr = holder.node.getBoundingClientRect();
  const cs = holder.cs;
  const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
    .map((k) => parseFloat(cs[k]) || 0);
  return JSON.stringify({
    focusVisible,
    chain: chain.slice(0, 6),
    indicator: {
      on: chain[chain.length - 1],
      color: cs.outlineColor,
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      offset: parseFloat(cs.outlineOffset) || 0,
      radius: Math.max(...radii),
      rect: { x: hr.x, y: hr.y, w: hr.width, h: hr.height }
    },
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }
  });
})()`;

/* -------------------------------------------------------------- the sweep */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-focus-'));

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

const port = await devtoolsPort(profile);
const targets = await devtools(port, '/json/list');
const page = targets.find((t) => t.type === 'page');
const cdp = connect(page.webSocketDebuggerUrl);
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
     cannot look like a success. The theme that painted is asserted after load. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, settle = 500) {
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, settle));
  await evaluate(NO_MOTION);
}

/* A real Tab keystroke, so Chrome's keyboard-modality flag is set and the
   scripted focus below actually matches :focus-visible. Without it Chrome
   treats a scripted focus as non-keyboard and paints no ring on a <button> —
   and a sweep that photographed no rings would report that every ring passes.
   Every site asserts :focus-visible separately, so this working is proven at
   each site rather than assumed here. */
async function keyboardModality() {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: 'Tab', code: 'Tab'
    });
  }
}

async function shot(clip) {
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 }
  });
  return decodePNG(Buffer.from(res.data, 'base64'));
}

/* Sample one straight run of pixels from a decoded clip, along the row or
   column `row` — an INTEGER pixel index in page coordinates. */
function sampleRun(img, clip, from, to, horizontal, row) {
  const out = [];
  for (let t = Math.ceil(from); t < to; t++) {
    const px = Math.floor((horizontal ? t : row) - clip.x);
    const py = Math.floor((horizontal ? row : t) - clip.y);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
    const i = (py * img.width + px) * 3;
    out.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  }
  return out;
}

function sampleRows(img, clip, side, rows) {
  const out = [];
  for (const row of rows) out.push(...sampleRun(img, clip, side.from, side.to, side.horizontal, row));
  return out;
}

/* Integer pixel rows walking away from `edge` in direction `step`, stopping at
   `limit` (or after `count`), and returning ONLY rows whose whole extent lies
   between the two. That exclusion is the point: a box laid out at fractional
   coordinates puts a half-pixel of the ring and a half-pixel of the surface in
   the same row, and a blend of the two is neither of them. Measured on
   .btn-primary, whose top edge lands on a half pixel: a straddling row read as
   a surface came back #5FB8CD, an even mix of the cyan fill and the glow,
   which is a colour nothing on the page paints. */
function pixelRows(edge, step, limit, count) {
  const rows = [];
  let k = step > 0 ? Math.ceil(edge) : Math.floor(edge) - 1;
  while (rows.length < count) {
    if (limit !== undefined && (step > 0 ? k + 1 > limit : k < limit)) break;
    rows.push(k);
    k += step;
  }
  return rows;
}

/* Where the ring lands, from the two properties that decide it. The outline's
   INNER edge is the border box inflated by outline-offset; the outline then
   grows OUTWARD by outline-width. So a positive offset puts the ring outside
   the element and a negative one puts it over the element's own edge, and the
   surfaces beside it differ completely between the two. */
function ringGeometry(rect, offset, width) {
  const inner = { x: rect.x - offset, y: rect.y - offset, w: rect.w + 2 * offset, h: rect.h + 2 * offset };
  const outer = {
    x: inner.x - width, y: inner.y - width,
    w: inner.w + 2 * width, h: inner.h + 2 * width
  };
  return { inner, outer };
}

/* Measure one focused site from a screenshot. Returns either a measurement or
   a refusal — never a silent skip. */
function measureSite(img, clip, ind) {
  const { inner, outer } = ringGeometry(ind.rect, ind.offset, ind.width);
  if (inner.w <= 0 || inner.h <= 0) {
    return { refused: `outline-offset ${ind.offset}px collapses the ring on a ${ind.rect.w}x${ind.rect.h} box` };
  }
  /* Corner arcs are blends of the ring and both surfaces meeting there, so
     every side is sampled only along its STRAIGHT section. Chrome draws the
     outline's corners at the element's border-radius grown by the offset, and
     the outer edge adds the width on top of that — which is exactly how far in
     from each corner the straight run begins. One pixel of slack for
     anti-aliasing. A ring on a square box excludes nothing but that pixel. */
  const cornerRadius = Math.max(0, ind.radius + ind.offset) + ind.width;
  const skip = cornerRadius + 1;

  /* One entry per side of the ring. `edgeOut` is that side's outer edge and
     `edgeIn` its inner edge; `dir` is +1 where moving away from the element
     means increasing the coordinate (the bottom and right sides) and -1 where
     it means decreasing it. Everything below is expressed through those two,
     so no side needs its own arithmetic. */
  const sides = [
    { horizontal: true, from: outer.x + skip, to: outer.x + outer.w - skip, edgeOut: outer.y, edgeIn: inner.y, dir: -1, face: ind.rect.y },
    { horizontal: true, from: outer.x + skip, to: outer.x + outer.w - skip, edgeOut: outer.y + outer.h, edgeIn: inner.y + inner.h, dir: 1, face: ind.rect.y + ind.rect.h },
    { horizontal: false, from: outer.y + skip, to: outer.y + outer.h - skip, edgeOut: outer.x, edgeIn: inner.x, dir: -1, face: ind.rect.x },
    { horizontal: false, from: outer.y + skip, to: outer.y + outer.h - skip, edgeOut: outer.x + outer.w, edgeIn: inner.x + inner.w, dir: 1, face: ind.rect.x + ind.rect.w }
  ];
  const usable = sides.filter((s) => s.to - s.from >= 4);
  if (usable.length < 2) {
    return { refused: `only ${usable.length} side(s) of the ring are long enough to sample` };
  }

  /* A positive outline-offset leaves a GAP between the ring's inner edge and
     the element's own face, and that gap is what the ring is adjacent to on
     the inside — the element's fill is behind the gap, not beside the ring.
     Reading past the gap reports a ratio the ring is not accountable for: on
     .btn-primary, whose fill is the same cyan as the ring, it produced a
     1.02:1 "failure" against a surface two pixels away with the button's own
     glow in between. A zero or negative offset has no gap, so the element's
     own paint genuinely IS the inner-adjacent colour and nothing bounds it. */
  const innerLimit = (s) => (ind.offset > 0 ? s.face : undefined);

  const ringPx = [], adjacentPx = [];
  for (const s of usable) {
    const inward = -s.dir;
    ringPx.push(...sampleRows(img, clip, s, pixelRows(s.edgeOut, inward, s.edgeIn, 4)));
    adjacentPx.push(...sampleRows(img, clip, s, pixelRows(s.edgeOut, s.dir, undefined, ADJACENT_ROWS)));
    adjacentPx.push(...sampleRows(img, clip, s, pixelRows(s.edgeIn, inward, innerLimit(s), ADJACENT_ROWS)));
  }
  if (adjacentPx.length < MIN_ADJACENT) {
    return { refused: `only ${adjacentPx.length} pixels beside the ring, under the ${MIN_ADJACENT} needed` };
  }

  const ringBuckets = bucketPixels(ringPx);
  if (!ringBuckets.length) {
    return { refused: 'the ring band fell outside the photograph, so nothing was sampled on it' };
  }
  const painted = ringBuckets[0];

  const declared = parseColor(ind.color);
  if (!declared) return { refused: `outline-color "${ind.color}" is a syntax this cannot read` };
  if (declared.alpha < 1) {
    return { refused: `outline-color "${ind.color}" is not opaque (alpha ${declared.alpha}), so the ` +
      'painted ring is a blend this cannot resolve exactly' };
  }
  const drift = Math.max(...declared.rgb.map((c, k) => Math.abs(c - painted.rgb[k])));
  if (drift > 8) {
    return { refused: `the outline declares ${hex(declared.rgb)} and the pixels where the ring ` +
      `should be are ${hex(painted.rgb)}` };
  }

  const floor = Math.max(MIN_BUCKET, Math.ceil(adjacentPx.length * MIN_SHARE));
  const buckets = bucketPixels(adjacentPx).filter((b) => b.n >= floor);
  if (!buckets.length) {
    return { refused: `no adjacent surface holds ${floor} pixels, so there is nothing to judge against` };
  }
  let worst = null;
  for (const b of buckets) {
    const ratio = contrast(declared.rgb, b.rgb);
    if (!worst || ratio < worst.ratio) worst = { ratio, surface: hex(b.rgb), n: b.n };
  }
  const best = buckets.reduce((acc, b) => Math.max(acc, contrast(declared.rgb, b.rgb)), 0);
  return {
    ring: hex(declared.rgb),
    ratio: worst.ratio,
    surface: worst.surface,
    surfacePixels: worst.n,
    best,
    surfaces: buckets.length,
    sampled: adjacentPx.length,
    /* Every surface beside the ring, largest first, so a failure names what
       the ring is actually sitting on rather than one hex code out of context.
       A reviewer re-deriving a number needs the share as well as the colour. */
    breakdown: buckets.slice(0, 6).map((b) => `${hex(b.rgb)}x${b.n}@${contrast(declared.rgb, b.rgb).toFixed(2)}`)
  };
}

/* One focused control, photographed and judged. */
async function judge(i) {
  const probe = await evaluate(FOCUS_ONE(i));
  if (probe.error) return { refused: probe.error };
  if (!probe.focusVisible) {
    return { refused: 'the control does not match :focus-visible, so no ring was photographed' };
  }
  if (!probe.indicator) {
    return { refused: 'no outline anywhere in its chain (' + probe.chain.join(' < ') + '), so the ' +
      'indicator, if there is one, has no edges this can find' };
  }
  const ind = probe.indicator;
  if (ind.style === 'none' || !(ind.width > 0)) {
    return { refused: `outline-style ${ind.style} at ${ind.width}px paints no ring` };
  }
  const pad = ADJACENT_ROWS + 3;
  /* Everything below is in PAGE coordinates, because Page.captureScreenshot's
     clip is: a rect taken from getBoundingClientRect is viewport-relative, and
     handing that to the clip photographs a region scrollY pixels away from the
     control. Measured: every site the sweep had to scroll to came back holding
     the page background instead of its own ring. The viewport check that
     follows is the one thing still asked in viewport coordinates, because
     fitting in the viewport is what it is about. */
  const vp = {
    x: ind.rect.x - pad, y: ind.rect.y - pad,
    r: ind.rect.x + ind.rect.w + pad, b: ind.rect.y + ind.rect.h + pad
  };
  const grow = Math.max(0, ind.offset) + ind.width;
  if (vp.x - grow < 0 || vp.y - grow < 0 ||
      vp.r + grow > probe.viewport.w || vp.b + grow > probe.viewport.h) {
    return { refused: `the ring and its surroundings do not fit in the ${probe.viewport.w}x` +
      `${probe.viewport.h} viewport, so part of it could not be photographed` };
  }
  const pageRect = {
    x: ind.rect.x + probe.scrollX, y: ind.rect.y + probe.scrollY,
    w: ind.rect.w, h: ind.rect.h
  };
  const { outer } = ringGeometry(pageRect, ind.offset, ind.width);
  const clip = {
    x: Math.floor(outer.x - pad), y: Math.floor(outer.y - pad),
    w: Math.ceil(outer.w + 2 * pad) + 2, h: Math.ceil(outer.h + 2 * pad) + 2
  };
  const img = await shot(clip);
  const out = measureSite(img, clip, { ...ind, rect: pageRect });
  out.on = ind.on;
  out.offset = ind.offset;
  out.width = ind.width;
  return out;
}

/* ----------------------------------------------------------------- suites */

test('the measurement itself reports published contrast values', async () => {
  await setTheme('dark');
  await load(`${origin}/__focus-self-test.html`);
  await keyboardModality();
  const sites = await evaluate(FOCUS_SITES);
  const by = new Map(sites.map((s) => [s.text, s.i]));

  /* #949494 and #767676 on white are 3.03:1 and 4.54:1 — WCAG's own worked
     examples, written here by hand. Nothing in this expectation comes from the
     code being proven. */
  const justOver = await judge(by.get('a'));
  assert.equal(justOver.refused, undefined, `justOver: ${justOver.refused}`);
  assert.ok(Math.abs(justOver.ratio - 3.03) < 0.02,
    `a #949494 ring on white should measure 3.03:1, measured ${justOver.ratio.toFixed(2)}:1 ` +
    `against ${justOver.surface}`);

  const clearlyOver = await judge(by.get('b'));
  assert.equal(clearlyOver.refused, undefined, `clearlyOver: ${clearlyOver.refused}`);
  assert.ok(Math.abs(clearlyOver.ratio - 4.54) < 0.02,
    `a #767676 ring on white should measure 4.54:1, measured ${clearlyOver.ratio.toFixed(2)}:1`);

  /* The same ring and the same two surfaces, with only the offset moved:
     outside the element it is beside black at 9.68:1, inside it is beside the
     element's own white fill at 2.17:1. A tool that ignored outline-offset
     would report one number twice. */
  const outside = await judge(by.get('e'));
  assert.equal(outside.refused, undefined, `outside: ${outside.refused}`);
  assert.ok(Math.abs(outside.ratio - 9.68) < 0.03,
    `a #B0B0B0 ring offset OUTSIDE a white box on black should measure 9.68:1 against the black, ` +
    `measured ${outside.ratio.toFixed(2)}:1 against ${outside.surface}`);

  const inside = await judge(by.get('f'));
  assert.equal(inside.refused, undefined, `inside: ${inside.refused}`);
  assert.ok(Math.abs(inside.ratio - 2.17) < 0.02,
    `the same ring offset INSIDE the same box should measure 2.17:1 against the white fill, ` +
    `measured ${inside.ratio.toFixed(2)}:1 against ${inside.surface}`);
});

test('an indicator this cannot resolve is refused, not assumed', async () => {
  await load(`${origin}/__focus-self-test.html`);
  await keyboardModality();
  const sites = await evaluate(FOCUS_SITES);
  const by = new Map(sites.map((s) => [s.text, s.i]));

  const shadowOnly = await judge(by.get('c'));
  assert.match(shadowOnly.refused || '', /no outline anywhere in its chain/,
    'a control whose only focus indicator is a box-shadow must be refused by name, not measured');

  const translucent = await judge(by.get('d'));
  assert.match(translucent.refused || '', /is not opaque/,
    'an outline whose colour is not fully opaque must be refused: reading it as solid reports the ' +
    'ring as more contrasty than the pixels are');
});

test('every focus indicator on the v2 shell is a measurable outline, and clears 3:1', async () => {
  const failures = [];
  const judged = [];
  const perPass = [];

  for (const theme of THEMES) {
    await setTheme(theme);
    for (const state of STATES) {
      await load(`${origin}${SHELL}`);
      const applied = await evaluate(`(() => {
        window.Aria.applyState(${JSON.stringify(state)});
        return JSON.stringify({ theme: document.documentElement.getAttribute('data-theme') });
      })()`);
      assert.equal(applied.theme, theme,
        `asked for the ${theme} theme, the page rendered ${applied.theme}`);
      await keyboardModality();
      const sites = await evaluate(FOCUS_SITES);
      let n = 0;
      for (const site of sites) {
        const where = `${theme}/${state} ${site.tag}${site.cls ? '.' + site.cls.split(/\s+/).join('.') : ''}` +
          `${site.text ? ` "${site.text}"` : ''}`;
        const r = await judge(site.i);
        if (r.refused) {
          failures.push(`${where}: REFUSED — ${r.refused}`);
          continue;
        }
        n++;
        judged.push({ ...r, where, theme, state });
        if (r.ratio + EPS < FOCUS_RATIO) {
          failures.push(`${where}: the ${r.ring} ring measures ${r.ratio.toFixed(2)}:1 against ` +
            `${r.surface}, ${r.surfacePixels} of the ${r.sampled} pixels beside it — WCAG 2.2 ` +
            `SC 1.4.11 needs ${FOCUS_RATIO.toFixed(1)}:1. Surfaces beside this ring: ` +
            r.breakdown.join(' '));
        }
      }
      perPass.push({ theme, state, n, sites: sites.length });
      if (n < SITE_FLOOR) {
        failures.push(`${theme}/${state}: only ${n} of ${sites.length} focus sites were judged, ` +
          `under the floor of ${SITE_FLOOR} — a sweep that judges nothing reports nothing`);
      }
    }
  }

  const worst = judged.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 6);
  console.log(`\n  focus sweep: judged ${judged.length} ring(s) across ${THEMES.length} themes x ` +
    `${STATES.length} preview states (${perPass.map((p) => `${p.theme}/${p.state}:${p.n}`).join(' ')})`);
  console.log('  tightest rings measured:');
  for (const r of worst) {
    console.log(`    ${r.ratio.toFixed(2)}:1  ring ${r.ring} on ${r.surface}  ${r.where}`);
  }

  assert.deepEqual(failures, [],
    `\n${failures.length} focus indicator problem(s):\n  ` + failures.join('\n  ') + '\n');
});

test('the three controls the issues name are still in the swept set', async () => {
  /* A sweep that quietly stopped reaching these would go green having measured
     nothing that matters. Named per Stadiora/Aria#10649, #10650 and #10651. */
  await setTheme('light');
  await load(`${origin}${SHELL}`);
  await keyboardModality();
  const sites = await evaluate(FOCUS_SITES);
  const want = [
    { label: 'the primary button (#10650)', match: (s) => s.cls.split(/\s+/).includes('btn-primary') },
    { label: 'the segmented control (#10649)', match: (s) => s.tag === 'button' && s.text === 'Coaches Web' },
    { label: 'the search field (#10651)', match: (s) => s.tag === 'input' && s.text === 'Search a coded reference',
      /* Where the ring lands is part of the fix, not a detail of it: this
         field sits flush inside its card, so a positive offset paints the
         ring outside the card, against the card's surroundings rather than
         against the field it marks. Stated here as a contract because the
         contrast sweep cannot see it — at +2px the ring still clears 3:1,
         on the wrong surface. */
      place: (r) => (r.on === 'div.field' && r.offset <= 0 ? null
        : `its ring is carried by ${r.on} at offset ${r.offset}px, so it is painted outside the ` +
          'field it marks and judged against whatever the card sits on') }
  ];
  const results = [];
  for (const w of want) {
    const site = sites.find(w.match);
    assert.ok(site, `${w.label}: no such control on ${SHELL} any more`);
    const r = await judge(site.i);
    assert.equal(r.refused, undefined, `${w.label}: REFUSED — ${r.refused}`);
    assert.ok(r.ratio + EPS >= FOCUS_RATIO,
      `${w.label}: ${r.ratio.toFixed(2)}:1 against ${r.surface}, needs ${FOCUS_RATIO.toFixed(1)}:1`);
    if (w.place) assert.equal(w.place(r), null, `${w.label}: ${w.place(r)}`);
    results.push(`    ${w.label}: ring ${r.ring} at offset ${r.offset}px on ${r.on} — ` +
      `${r.ratio.toFixed(2)}:1 against ${r.surface}`);
  }
  console.log('\n  light theme, the three controls the issues name:');
  for (const line of results) console.log(line);
});
