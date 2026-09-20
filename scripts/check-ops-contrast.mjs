/* WCAG AA contrast guard for the v2 operations shell.
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
 * and the colour actually painted behind it, and fails under the WCAG AA
 * threshold for that text's size.
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
 *      layered gradients and color-mix alpha: 60 of its 61 icons sit under a
 *      `background-image`, and no single ancestor holds the colour under the
 *      text. Instead this takes a PLATE — a second screenshot of the same page
 *      with every glyph made transparent — and samples the element's own box on
 *      it. That is the real painted backdrop, gradients and all, with no text
 *      pixels left to pull the average.
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
 *      this cannot resolve is refused rather than assumed, and a backdrop this
 *      cannot read as one opaque colour is refused rather than averaged.
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__contrast-self-test.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(fixtureHtml);
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

/* The two serialisations getComputedStyle actually returns on this page.
   `color(srgb r g b / a)` is how Chromium writes a color-mix(), and its
   components are 0..1 floats rather than 0..255 bytes (CSS Color 4 §10) —
   reading them as bytes is not a dropped site but a wrong number, which is
   worse. Anything else returns null, and every caller turns null into a
   refusal by name rather than a skip. */
function parseColor(str) {
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
    return { r: r * 255, g: g * 255, b: b * 255, a };
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

/* WCAG's large-text exemption: 18.66px bold, or 24px at any weight. */
function threshold(fontSize, fontWeight) {
  const big = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  return big ? 3.0 : 4.5;
}

/* How much of a box a backdrop colour has to hold before it counts as part of
   what the glyphs sit on. Below this it is an edge, an anti-aliased corner or
   a sliver of the element behind — not a surface anyone reads text against. */
const SIGNIFICANT = 0.05;

/* Every backdrop colour inside a rect on the plate, with the share of the box
   each one holds.

   Quantised into coarse buckets first, because the panel gradients spread a
   surface over dozens of near-identical shades and no single shade holds a
   majority — the modal shade of a gradient is noise, and a check that demands
   one dominant colour refuses every card on this page. Each bucket reports the
   MEAN of its real pixels, so bucketing decides which pixels to average and
   never rounds the answer itself.

   Returning the set rather than the winner is what lets the caller be
   conservative per role: a box whose backdrop is two surfaces is judged on the
   worse of them, and only when the two disagree about AA is it refused. */
function sampleBackdrops(plate, rects, scale) {
  const BUCKET = 8;
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
  const significant = all.filter((c) => c.share >= SIGNIFICANT);
  return {
    all: all,
    significant: significant,
    covered: significant.reduce((n, c) => n + c.share, 0),
    translucent: translucent / total
  };
}

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
    if (rect.width < 2 || rect.height < 2) continue;
    /* offsetParent is an HTMLElement member and is undefined — not null — on
       every SVGElement, so gating SVG on it drops every chart label. For SVG
       the display, visibility, opacity and rect gates above cover the same
       ground. */
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    if (!isSvg && !el.offsetParent && cs.position !== 'fixed') continue;

    /* Parked off the canvas — a skip link at left:-9999px until it takes
       focus. It paints nowhere the screenshot covers, so there is no backdrop
       to sample and a refusal here would be noise about a box that is not on
       the page. Its focused state is NOT measured; see NOT COVERED. */
    const ax = rect.x + window.scrollX, ay = rect.y + window.scrollY;
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    if (ax + rect.width <= 0 || ay + rect.height <= 0 || ax >= docW || ay >= docH) continue;

    const key = el.tagName + (pseudo || '') + ':' + rect.x + ':' + rect.y + ':' + text;
    if (seen.has(key)) continue;
    seen.add(key);

    /* WCAG 1.4.3 exempts text that is part of an inactive component. Counted
       rather than dropped, so nothing escapes the sweep by being marked
       disabled without anyone noticing. */
    const inactive = !!el.closest('[disabled], :disabled, [aria-disabled="true"]');

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
      color: isSvg ? inkStyle.fill : inkStyle.color,
      opacity: Number(cs.opacity),
      inactive: inactive,
      fontSize: parseFloat(inkStyle.fontSize) || parseFloat(cs.fontSize),
      fontWeight: Number(inkStyle.fontWeight) || Number(cs.fontWeight) || 400,
      rect: {
        x: rect.x + window.scrollX, y: rect.y + window.scrollY,
        width: rect.width, height: rect.height
      },
      /* One rect per line of this element's OWN text, from a Range over its
         direct text nodes — children's boxes excluded, wrapped lines kept
         apart. Empty for a ::before/::after, whose content has no text node to
         range over; the box is the fallback there, and a pseudo-element paints
         inside its originating element's box. */
      rects: runs.length ? runs : [{
        x: rect.x + window.scrollX, y: rect.y + window.scrollY,
        width: rect.width, height: rect.height
      }]
    });
  }
  return JSON.stringify(out);
})()`;

/* Hide every glyph so a screenshot shows only what is painted behind them.
   Colour and visibility do not affect layout, so the plate lines up with the
   real page pixel for pixel. */
const PLATE_CSS = `
  *, *::before, *::after {
    color: transparent !important;
    text-shadow: none !important;
    -webkit-text-stroke-color: transparent !important;
    caret-color: transparent !important;
  }
  /* ::placeholder is matched by none of the selectors above, and its own
     colour declaration beats the originating element's inherited transparent.
     Without this line placeholder glyphs paint ON the plate, which is exactly
     the contamination the plate exists to prevent. */
  ::placeholder { color: transparent !important; }
  /* An SVG that contains text is a SURFACE that text sits on — its bars and
     areas are the backdrop for those labels — so hiding it wholesale would
     sample the card behind the chart instead of the mark the label sits on.
     Neutralise SVG text, which is painted by fill and untouched by the color
     rule above, keep chart geometry, and hide only text-free SVGs, which are
     decorative icons and pure foreground. */
  svg text { fill: transparent !important; }
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
    const ink = isSvg ? cs.fill : cs.color;
    const clear = ink === 'rgba(0, 0, 0, 0)' || ink === 'transparent' ||
      /^color\\(srgb [^)]*\\/ 0\\)$/.test(ink);
    if (!clear) {
      lit.push(el.tagName.toLowerCase() +
        ((el.getAttribute('class') || '') ? '.' + el.getAttribute('class').trim().split(/\\s+/).join('.') : '') +
        ' paints ' + ink);
    }
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
    /* A backdrop role. The conservative direction for a backdrop is NOT
       "assume opaque": a see-through surface means the real backdrop is
       whatever is behind the page, which this tool cannot see. */
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
    const parsed = parseColor(ink);
    /* Element opacity multiplies the text alpha against the same backdrop. */
    const alpha = (parsed.a === undefined ? 1 : parsed.a) *
      (Number.isFinite(t.opacity) ? t.opacity : 1);
    const need = threshold(t.fontSize, t.fontWeight);

    /* Judge against the WORST surface behind the glyphs, not against the
       average of them and not against the widest.

       Averaging a two-tone backdrop invents a colour painted nowhere, and
       judging the widest lets a minority surface hide a failure: the hatch
       behind .fore is 22% amber every 6px, and a letter crossing a stripe is
       read at the stripe's ratio whatever the rest of the run does. This is
       the ink-role direction of the per-role rule — for an INK the unsafe
       assumption is the flattering one, so the worst surface decides.

       The cost is a false positive where a glyph run genuinely overlaps
       something its text does not sit on. That is why the collector ranges
       over text nodes: a row that contains a cyan chip no longer contributes
       the chip's pixels, because the chip is not inside the run. */
    let worstAt = null, bestAt = null;
    for (const c of bg.significant) {
      const fg = over({ ...parsed, a: alpha }, c);
      const r = contrast(fg, c);
      if (!worstAt || r < worstAt.ratio) worstAt = { ratio: r, bg: c, fg };
      if (!bestAt || r > bestAt.ratio) bestAt = { ratio: r, bg: c, fg };
    }
    if (!worstAt) {
      results.push({
        ...t, unjudgeable: 'backdrop has no surface', ink,
        detail: `no colour holds ${(SIGNIFICANT * 100).toFixed(0)}% of the band ` +
          `(${bg.all.length} shades, widest ${(bg.all[0].share * 100).toFixed(0)}%)`
      });
      continue;
    }
    results.push({
      ...t,
      fg: hex(worstAt.fg), bg: hex(worstAt.bg), bgShare: worstAt.bg.share,
      surfaces: bg.significant.length,
      best: bestAt.ratio, bestBg: hex(bestAt.bg),
      ratio: worstAt.ratio, need
    });
  }
  return results;
}

/* ------------------------------------------------------------- self-test */

/* Proves the tool before it judges anything, in six parts that do not share a
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
 *
 * NOT COVERED, on purpose — this is the list of exclusions decided, not an
 * inventory of every blind spot, because one nobody has thought of is by
 * definition missing from it. Excluded: that a rendered swatch measures a
 * particular ratio (circular); that the collector finds every element worth
 * judging on the real shell (a fixture cannot prove a sweep is complete —
 * that is what the per-pass counts and the mutation battery in the PR are
 * for); the background-sampling METHOD, i.e. that the modal bucket is the
 * colour under the glyphs rather than merely the commonest colour in the box
 * (B and C prove only that the sampler returns what was painted); and the
 * accounting in the run loop below, which no part reaches.
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
    '</style>' +
    FIXTURE_CASES.map((c, i) =>
      `<div class="sw" id="c${i}" style="background:${c.bg}">swatch ${i} measured here` +
      (c.placeholder ? '<input placeholder="placeholder glyphs must not survive the plate">' : '') +
      (c.svgText ? '<svg width="260" height="20" style="display:block"><text class="axis" x="0" y="14" fill="#ff00ff" style="color:#00ffff">svg text must not survive</text></svg>' : '') +
      (c.psText ? '<svg width="320" height="20" style="display:block"><defs><linearGradient id="psSelfTest"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#000000"/></linearGradient></defs><text class="axis" x="0" y="14" fill="url(#psSelfTest) #eef2f7">paint-server text must not be judged</text></svg>' : '') +
      (c.mixText ? '<div><span class="mix">a color-mix ink must be read, not refused</span></div>' : '') +
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
    if (!bg || !bg.significant.length) {
      console.log(`     FAIL case ${i}: nothing sampled`); bad++; continue;
    }
    const got = [bg.significant[0].r, bg.significant[0].g, bg.significant[0].b].map(Math.round);
    /* Exact, not approximate. The magenta text is the tell: a plate that
       failed to lift the glyphs pulls the mean off the declared value. And
       one surface, not several: a solid box that arrives as two surfaces
       means the significance filter is shredding what it samples, which would
       turn every judged site into a straddle. */
    const ok = got.every((v, k) => v === c.expect[k]) && bg.significant.length === 1;
    if (!ok) bad++;
    console.log(`     ${ok ? 'ok  ' : 'FAIL'} ${c.bg.padEnd(34)} sampled rgb(${got.join(',')})` +
      ` expected rgb(${c.expect.join(',')}) in ${bg.significant.length} surface(s)`);
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

  console.log(bad === 0
    ? '\n  self-test passed — the formula matches published values, pixels survive\n' +
      '  the pipeline, the plate lifts every glyph, inks are read from what paints,\n' +
      '  an ink that cannot be resolved is refused, and color(srgb) is read.\n'
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
const KNOWN_BELOW_AA = [];

/* ------------------------------------------------------------------ main */

/* How many measured sites were below AA and exempted by KNOWN_BELOW_AA. Held
   out of the passing count and named in the closing line, so a page carrying
   known failures never reports itself clean. */
let frozenCount = 0;

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

        const targets = await evaluate(COLLECT);
        const results = await measureSites(targets, `${SHELL} (${theme}/${state})`);
        for (const r of results) {
          if (r.inactive) { exempt++; continue; }
          if (r.unjudgeable) {
            const key = `${r.unjudgeable}|${r.cls || r.tag}|${r.ink}`;
            const prev = unjudged.get(key);
            if (prev) prev.n++;
            else unjudged.set(key, { ...r, theme, state, n: 1 });
            continue;
          }
          checked++;
          const key = `${r.cls || r.tag}|${theme}`;
          const prev = worst.get(key);
          if (!prev || r.ratio < prev.ratio) worst.set(key, { ...r, theme, state });
          if (r.ratio + 0.005 < r.need) belowAA.push({ ...r, theme, state });
        }
        if (verbose) {
          console.log(`  walked ${SHELL} [${theme}/${state}] — ${results.length} text sites`);
        }
      }
    }

    /* A sweep that measured almost nothing reports the same "all good" as one
       that measured everything, so the floor is an assertion rather than a
       note. The shell carries roughly 150 judged sites per pass. */
    if (checked < 600) {
      failures.push(`${SHELL}: only ${checked} text sites were judged across ` +
        `${THEMES.length} themes × ${STATES.length} states, so the sweep measured almost ` +
        'nothing. The shell carries about 150 a pass.');
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
        `${r.surfaces > 1 ? ` (worst of ${r.surfaces} surfaces behind the glyphs; ` +
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
          `${got.need.toFixed(1)}:1, not the ${e.need.toFixed(1)}:1 it was frozen at, so its ` +
          'type size or weight changed under the entry. Re-measure it. (' + e.issue + ')');
      }
    }
    frozenCount = [...matched.values()].reduce((n, r) => n + r.length, 0);
    if (frozenCount) {
      note(`${frozenCount} site(s) are below AA and frozen — this sweep does not fail on ` +
        'them, they are NOT part of the passing count below, and each is listed in ' +
        'KNOWN_BELOW_AA with the issue that tracks it');
    }

    if (!failures.length && !unjudgedTotal) {
      note(`${checked - frozenCount} rendered text sites across ${THEMES.length} themes × ` +
        `${STATES.length} states meet WCAG AA, ${exempt} exempt as inactive controls`);
      const floor = [...worst.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 5);
      console.log('    closest five to their threshold:');
      for (const r of floor) {
        console.log(`      ${r.ratio.toFixed(2)}:1 (needs ${r.need.toFixed(1)})  ${r.theme.padEnd(5)}` +
          ` ${r.fg} on ${r.bg}  ${r.tag}${r.cls ? '.' + r.cls.split(/\s+/)[0] : ''}  "${r.text}"` +
          `${frozen.has(siteKey(r)) ? '   [frozen, below AA]' : ''}`);
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
  : '\nEvery rendered text site on the v2 shell meets WCAG AA, in both themes and all four ' +
    `states${frozenCount ? `, except the ${frozenCount} frozen in KNOWN_BELOW_AA` : ''}.\n`);
