/* Look up a user, measured in a browser rather than read out of a file.
 *
 * WHY THIS FILE EXISTS
 *
 * scripts/ops-users-v2.test.mjs is a node:vm harness with no layout engine. It
 * says so itself, under NOT COVERED: nothing in it reads a computed style, so
 * nothing in it can tell a rule that applies from one that is overridden, or a
 * class that is painted from one that is merely written. That is the exact
 * hole three issues have now come through:
 *
 *   Stadiora/Aria#10456  the picked row gained `is-selected` and no sheet
 *                        ops/users.html loads had a rule for it
 *   Stadiora/Aria#10643  `masked` is styled in ops.css, which this page
 *                        deliberately does not load, and `match-name` was
 *                        defined nowhere at all
 *   Stadiora/Aria#10648  the pick control announced aria-pressed="true" and
 *                        was drawn pixel-for-pixel like the control beside it
 *
 * Every one of those passed every check in the repository. A source-grep for
 * `.masked {` would have passed too, in ops.css, for a sheet the page does not
 * load. So this file asserts nothing about source text: it serves the real
 * page over HTTP, answers the operations API from a fixture, drives the pane
 * to a populated match list with a match picked, and reads resolved computed
 * styles and rendered PIXELS back out of Chrome.
 *
 * FAILS CLOSED. There is no skip path. No Chrome, no fixture, a pane that
 * never reaches the picked state — each of those throws while this module is
 * being loaded, and node --test reports the file as failed. A rendered guard
 * that exits green having measured nothing is the defect it was written to
 * remove. CI runs it through `node --test scripts/*.test.mjs` in
 * .github/workflows/ops-pane-tests.yml, on ubuntu-latest, which ships
 * google-chrome-stable — the same browser .github/workflows/ops-contrast.yml
 * and ops-shell-v2.yml already drive on that image.
 *
 * MEASURED IN PLACE. Nothing here is cloned and nothing is re-parented. A node
 * copied to document.body loses every descendant selector styling it and every
 * ancestor background, and comes out wrong in both directions at once — the
 * monorepo published a "overruns by 26.3px" proof that way for an overflow
 * that did not exist. Every element is measured where it is drawn.
 *
 * BOTH ARMS, ALWAYS. Each claim is asserted on the element that should carry
 * it AND on the nearest element that should not. `.locked.masked` is mono and
 * dashed; the plain `.locked` chip in the match table, same class minus one,
 * is neither. `th.match-name` carries the floor; the `tbody th` in the devices
 * table does not. Otherwise a rule widened to `*` — every chip mono, every row
 * header 200px — would satisfy a one-armed assertion while destroying the
 * distinction the class exists to draw.
 *
 * COLOUR IS NEVER THE CLAIM. The contrast figures below are WCAG relative
 * luminance, which discards hue by construction, so "the ring reads at 5.8:1
 * against the fill it encloses" is a statement about a greyscale screen as
 * much as a colour one. The pressed control is additionally asserted to differ
 * from the unpressed one in font-weight, which carries no colour at all.
 *
 * EVERY GRAPHIC RATIO IS A WORST PIXEL, NOT A PIXEL. The first version of this
 * file sampled each surface at ONE point, and that is not a measurement of a
 * surface — it is a measurement of a point that may or may not be on it.
 * `.locked`'s background is a 135° repeating-linear-gradient, so the mask
 * chip's interior is two alternating colours; the single sample landed in a
 * gap, came back holding the CARD showing through, and this file published
 * 3.55:1 for an edge whose true worst-case neighbour was 2.97:1 — under the
 * 3:1 it was asserting. It stayed green through a mutation that made the hatch
 * loud enough to drop the real figure to 1.44:1.
 *
 * So `stripProbe` walks the whole edge instead. For a given side it collects
 * three bands — the border line itself, four pixels of interior inboard of it,
 * three pixels of the surface outboard — skipping ceil(border-radius)+3 at
 * each end so the corner arc is never sampled, and every ratio reported is the
 * MINIMUM over each band. The sample counts are asserted, because a band that
 * silently collapses to one pixel is the original defect returning, and the
 * interior and outside worst pixels are asserted to be more than rounding
 * apart, because their coming back near enough to identical is the tell that
 * one band is not where it is named. On the real page they sit 16 of 255
 * apart in dark and 18 in light; flatten the chip and they close to 1 and 0.
 *
 * Stadiora/Aria#10713 then found the walk was run on ONE side of each
 * four-sided shape — the ring on its left, the mask on its top — while the
 * test names certified the shape. Reducing `inset 0 0 0 1px` to
 * `inset 1px 0 0 0` left a ring that is no longer a ring fully certified, and
 * a `border-bottom-color` at 20% alpha left a mask edge reading ~1.2:1
 * against the card fully certified. Every shape is now walked on all four
 * sides and reports its WORST side, with the losing side named in the
 * failure, and each side's edge sample count carries its own floor so that a
 * short side walked over nothing cannot hide inside a healthy total.
 *
 * NOT COVERED, stated rather than implied:
 *
 *   - forced-colours / prefers-contrast. The mask's dashed border is chosen
 *     partly because border-style survives a forced-colours mode and
 *     box-shadow does not. Nothing here emulates that mode, so that sentence
 *     is a reason for the choice and not a measured fact.
 *   - the reveal flow. This file drives a lookup and a pick, never a reveal.
 *     The masking floors, the reason form and the re-mask are covered in
 *     scripts/ops-pane-users.test.mjs and scripts/ops-users-v2.test.mjs.
 *   - every text site on the pane. Four are measured, named in TEXT_SITES,
 *     and they are the four this change moves. scripts/check-ops-contrast.mjs
 *     sweeps /ops/shell-v2.html only and does not reach this pane at all.
 *   - hover. The pressed control's hover step is not measured here; the
 *     selected row's hovered cells are, in scripts/ops-hover-contrast.test.mjs
 *     (Stadiora/Aria#10754). The :focus-visible outline the pressed ring must
 *     not be mistaken for is unmeasured in both.
 *   - the hatch on the mask chip, as a texture. Nothing asserts the chip is
 *     hatched RATHER than flat; what is asserted is that its interior is not
 *     the card surface. Removing the hatch raises every figure here, so it is
 *     the loud direction the band scan exists to catch, not the quiet one.
 *   - any width but 1280 and 375. The name cell's floor is bound at 375 from
 *     both sides: enough that the "Selected" mark is still on the reference's
 *     line, and little enough that the name still fits the visible width of
 *     .tbl-wrap. 1280 is where the colours are measured; the floor is not
 *     bound there, because the cell takes 345px of its own accord and the
 *     sibling columns absorb any floor raised under that without clipping.
 *     Page-level sideways scroll is not asserted here — .tbl-wrap absorbs it,
 *     so a document-width assertion in this file cannot fail from anything
 *     this change owns. scripts/check-ops-narrow-overflow.mjs sweeps all ten
 *     panes at 375px and 360px in both themes and does check it, though it
 *     never runs a lookup and so never sees a match table.
 *   - the account record beyond its masked chips, and every card below it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/ops/users.html';
const THEMES = ['dark', 'light'];

/* WCAG AA for body text. The large-text allowance is deliberately not
   implemented: every site measured here is 11.5px or smaller. */
const AA_TEXT = 4.5;
/* WCAG 1.4.11 for the visual information that identifies a control's state. */
const AA_GRAPHIC = 3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* ------------------------------------------------------------- the fixture

   Every address is .invalid and every masked value is already a mask. This
   file never writes a personal value into the page, because the pane's first
   promise is that it does not show one: a fixture carrying a real-looking
   address would put the thing under guard into a world-readable directory to
   test that it is kept back. */
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ADMIN = { id: 'adm_1', email: 'owner@example.invalid', name: 'Owner', role: 'owner' };
const SESSION = { id: 'ses_1', createdAt: ago(600_000), lastSeenAt: ago(1000), userAgent: 'test' };

/* Two matches of the same shape, differing only in the reference and the
   masked address, so that a comparison between the picked row's control and
   the other one cannot pick up a difference that has nothing to do with being
   picked. */
const PICKED_REF = 'ath_2277';
const OTHER_REF = 'ath_2419';
const LOOKUP = {
  recorded: { at: ago(1000), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  matchCount: 2,
  matches: [
    { reference: PICKED_REF, maskedEmail: 'a•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(3 * HOUR), flags: [] },
    { reference: OTHER_REF, maskedEmail: 'b•••@example.invalid',
      state: { key: 'active', label: 'Active', tone: 'ok' },
      tier: { key: 'pro', label: 'Athlete Pro', brand: true },
      platforms: [{ key: 'mobile', label: 'Mobile' }],
      lastActiveAt: ago(30 * HOUR), flags: [] },
  ],
};

const MASKED_EMAIL = 'a•••@example.invalid';
const DETAIL = {
  reference: PICKED_REF, kind: 'athlete',
  state: { key: 'active', label: 'Active', tone: 'ok' },
  tier: { key: 'pro', label: 'Athlete Pro', brand: true },
  memberSince: ago(400 * DAY),
  recorded: { at: ago(500), actor: 'ops_owner_1', fields: 'summary', reason: 'SUP-4471' },
  summary: { fields: [
    { key: 'email', label: 'Email', masked: true, maskedValue: MASKED_EMAIL, reveal: 'allowed' },
    { key: 'displayName', label: 'Name', masked: true, maskedValue: 'A••• R•••', reveal: 'allowed' },
    { key: 'weight', label: 'Weight', masked: true, reveal: 'never' },
    { key: 'locale', label: 'Locale', masked: false, value: 'es-ES' },
  ] },
  activity: { windowDays: 7, events: [
    { occurredAt: ago(3 * HOUR), label: 'Chat reply', tone: 'ok', reference: 'run_88214' },
  ] },
  devices: [{ label: 'iPhone', appVersion: '1.1.2', os: 'iOS 18.2', lastSeenAt: ago(2 * HOUR) }],
  billing: { fields: [{ key: 'tier', label: 'Tier', masked: false, value: 'Athlete Pro' }] },
  access: { windowDays: 90, entries: [
    { occurredAt: ago(2 * DAY), actor: 'ops_owner_1', fields: 'email', reason: 'SUP-4471', revealed: true },
  ] },
  supportActions: { available: [{ key: 'resend', label: 'Resend verification email' }] },
};

function api(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: { accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: { admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900 } };
  }
  if (pathname.startsWith('/api/ops/users/lookup')) return { data: LOOKUP };
  if (/^\/api\/ops\/users\/[^/]+$/.test(pathname)) return { data: DETAIL };
  return { data: {} };
}

/* --------------------------------------------------------------- colour */

function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/* Chromium serialises a color-mix() as color(srgb r g b / a). A parser that
   understands only rgb() drops those sites in silence, which is how ten real
   AA failures went missing in the monorepo. Anything unreadable is refused by
   name rather than skipped. */
function parseColor(value) {
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  throw new Error('cannot resolve colour: ' + value);
}
/* Ink with alpha in it is composited against whatever is behind it before a
   reader sees it, so measuring the uncomposited value reports a contrast the
   screen never shows — and it errs in the direction that HIDES a defect,
   because a faded ink read as solid clears AA. Nothing on this pane resolves a
   translucent ink today; if something starts to, this refuses to measure it
   rather than quietly flattering it. */
function opaqueInk(value) {
  const alpha = /^rgba?\([^)]*[\s,/]+([\d.]+)\s*\)$/i.exec(value)
    || /^color\(srgb[^)]*\/\s*([\d.]+)\s*\)$/i.exec(value);
  if (alpha && Number(alpha[1]) < 1) {
    throw new Error('the ink ' + value + ' is translucent, so its contrast depends on what ' +
      'is behind it. Composite it before measuring rather than reading it as solid.');
  }
  return parseColor(value);
}
const round = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ chrome */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH. This check ' +
    'measures rendered pixels and has no meaning without a browser, so it ' +
    'fails rather than skipping.');
}

async function devtoolsPort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    try { const p = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); if (p > 0) return p; }
    catch { /* the browser has not written it yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtoolsJson(port, pathname) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}${pathname}`); if (r.ok) return await r.json(); }
    catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const waiters = [];
  let seen = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      return;
    }
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
    close: () => { try { ws.close(); } catch { /* already gone */ } },
    reset() { seen = new Set(); },
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
    },
    once(method, timeoutMs = 30000) {
      if (seen.has(method)) return Promise.resolve();
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('timed out waiting for ' + method)), timeoutMs);
        const check = (m) => { if (m === method) { clearTimeout(timer); res(); } else waiters.push(check); };
        waiters.push(check);
      });
    },
  };
}

/* ------------------------------------------------------ in-page programmes */

/* From the pane's landing state to a populated match list with the first match
   picked. The form is filled through the native value setter and a real submit
   event, and the control is clicked, so everything the pane does on a pick —
   applySelection, the account read, the repaint — actually happens. */
const DRIVE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = document.getElementById('lookupIdentifier');
  const reason = document.getElementById('lookupReason');
  if (!id || !reason) return 'the lookup form is not on the page';
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set(id, ${JSON.stringify(PICKED_REF)});
  set(reason, 'SUP-4471');
  id.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 120; i++) { await sleep(50); if (document.querySelector('.match-row-btn')) break; }
  const btn = document.querySelector('.match-row-btn');
  if (!btn) return 'the lookup drew no matches';
  btn.click();
  for (let i = 0; i < 120; i++) { await sleep(50); if (document.querySelector('.match-row.is-selected')) break; }
  await sleep(700);
  if (!document.querySelector('.match-row.is-selected')) return 'the pick never selected a row';
  if (!document.querySelector('.locked.masked')) return 'the account record drew no masked field';
  return 'ok';
})()`;

/* Lift every glyph, so a screenshot of the page is the paint UNDER the text.
   A constructed stylesheet rather than a <style> element: users.html sends
   style-src 'self' with no 'unsafe-inline', and an injected <style> would be
   refused — silently, from the check's point of view. */
const LIFT_GLYPHS = `(() => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('*, *::before, *::after { color: transparent !important;' +
    ' -webkit-text-fill-color: transparent !important; text-shadow: none !important; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return document.adoptedStyleSheets.length;
})()`;

/* Read a PNG Chrome has just produced, inside Chrome: users.html allows
   img-src data:, and a canvas reads the decoded pixels back. No PNG decoder
   lives in this file, so there is no PNG decoder here to get wrong. */
const loadPlate = (b64) => `(async () => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  globalThis.__plate = ctx;
  return img.width + 'x' + img.height;
})()`;

/* A 1px edge and the two surfaces it sits between, read as BANDS rather than
   as points.
 *
 * A point is not enough, and the reason is specific rather than theoretical.
 * .locked's background is a 135deg repeating-linear-gradient — a hatch — so
 * "the mask chip interior" is two colours alternating every 5px, not one.
 * Sampling it at one coordinate lands in whichever stripe that coordinate
 * happens to fall in; landing in the quiet one reported the mask's edge at
 * 3.55:1 against an interior whose loud stripe put it at 2.98:1, under the
 * floor the check was asserting. It also, tellingly, returned a value
 * byte-identical to the surface OUTSIDE the chip, because the gap it sampled
 * was the card showing through. An oracle that reports the same number for
 * two different surfaces has measured one of them twice.
 *
 * So: walk the edge, take every pixel of both neighbouring bands, and claim
 * the WORST of them. The corner arc is skipped — border-radius curves the
 * edge away from the straight line being walked, and a naive full-width band
 * picks up the arc's antialiasing as if it were the surface.
 */
const stripProbe = (selector, side) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const side = ${JSON.stringify(side)};
  /* The two corners that actually bound THIS side, so a shape with uneven
     corners does not get the top-left one's skip applied to its bottom edge. */
  const corner = {
    top: ['borderTopLeftRadius', 'borderTopRightRadius'],
    right: ['borderTopRightRadius', 'borderBottomRightRadius'],
    bottom: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
    left: ['borderTopLeftRadius', 'borderBottomLeftRadius']
  }[side];
  const radius = Math.max(...corner.map((p) => parseFloat(cs[p]) || 0));
  const ctx = globalThis.__plate;
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  /* One walk, four sides. \`inward\` flips the offset so that a positive d is
     always INTO the box and a negative d always out of it, whichever edge is
     being read; the fixed coordinate is the last pixel row or column that is
     still inside. Getting this backwards on the far sides would report the
     surface outside as the interior and vice versa — and both bands would
     still be full, so nothing about the sample counts would show it. */
  const vertical = side === 'left' || side === 'right';
  const inward = (side === 'top' || side === 'left') ? 1 : -1;
  const fixed = side === 'top' ? Math.round(r.y)
    : side === 'bottom' ? Math.round(r.bottom) - 1
    : side === 'left' ? Math.round(r.x)
    : Math.round(r.right) - 1;
  const from = vertical ? Math.round(r.y) : Math.round(r.x);
  const to = vertical ? Math.round(r.bottom) : Math.round(r.right);
  const span = to - from;
  const skip = Math.min(Math.ceil(radius) + 3, Math.floor(span / 3));
  const out = { side, edgeLine: [], interior: [], outside: [], radius, skip,
    box: { w: r.width, h: r.height } };
  for (let t = from + skip; t < to - skip; t++) {
    const at = (d) => {
      const o = fixed + d * inward;
      return vertical ? px(o, t) : px(t, o);
    };
    out.edgeLine.push(at(0));
    for (let d = 2; d <= 5; d++) out.interior.push(at(d));
    for (let d = -4; d <= -2; d++) out.outside.push(at(d));
  }
  if (!out.edgeLine.length) throw new Error('the edge band was empty for ${selector}');
  return JSON.stringify(out);
})()`;

/* The edge's own colour, read as the pixel of the walked line that is furthest
   in luminance from what the interior typically is. A 1px hairline sampled at
   a fixed coordinate lands beside itself as often as on itself — read that way
   the pressed ring once reported 1.00:1 against the fill it encloses, which is
   a measurement saying "there is no ring" about a ring that is there. */
function readStrip(raw, where) {
  if (!raw) throw new Error('nothing matched ' + where + ' on the drawn page');
  const strip = JSON.parse(raw);
  const interiorLum = strip.interior.map(luminance).sort((a, b) => a - b);
  const median = interiorLum[Math.floor(interiorLum.length / 2)];
  const edge = strip.edgeLine.slice()
    .sort((a, b) => Math.abs(luminance(b) - median) - Math.abs(luminance(a) - median))[0];
  const worst = (band) => band.reduce((lo, p) => Math.min(lo, contrast(edge, p)), Infinity);
  const distinct = (band) => new Set(band.map((p) => p.join(','))).size;
  return { edge,
    vsInterior: round(worst(strip.interior)), vsOutside: round(worst(strip.outside)),
    worstInterior: strip.interior.reduce((w, p) =>
      contrast(edge, p) < contrast(edge, w) ? p : w, strip.interior[0]),
    worstOutside: strip.outside.reduce((w, p) =>
      contrast(edge, p) < contrast(edge, w) ? p : w, strip.outside[0]),
    samples: { edge: strip.edgeLine.length,
      interior: strip.interior.length, outside: strip.outside.length },
    colours: { interior: distinct(strip.interior), outside: distinct(strip.outside) },
    radius: strip.radius, skip: strip.skip, box: strip.box,
    edgeLine: strip.edgeLine };
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/* Stadiora/Aria#10713. A ring and a dashed border are four-sided shapes, and
   until this they were each measured on ONE side — the ring on its left, the
   mask on its top. Both claims ("clears 3:1 against both surfaces it sits
   between") were therefore true of a quarter of the shape and asserted of all
   of it. The proofs on the issue: reduce `inset 0 0 0 1px` to `inset 1px 0 0
   0` and the ring certification survived for something that is no longer a
   ring; give the mask a `border-bottom-color` at 20% alpha and the mask
   certification survived for an edge reading ~1.2:1 against the card.

   Every side is walked, and the SHAPE's figure is the worst side's. Which
   side lost is carried through to the assertion message, because "3.1:1 on
   the bottom" and "3.1:1 on the left" send a reader to different rules. */
function readShape(perSide, where) {
  const sides = {};
  for (const side of SIDES) sides[side] = readStrip(perSide[side], `${where} (${side})`);
  const worstSideBy = (key) =>
    SIDES.reduce((w, s) => (sides[s][key] < sides[w][key] ? s : w), SIDES[0]);
  const inSide = worstSideBy('vsInterior');
  const outSide = worstSideBy('vsOutside');
  const total = (key) => SIDES.reduce((n, s) => n + sides[s].samples[key], 0);
  return {
    sides,
    interiorSide: inSide, outsideSide: outSide,
    vsInterior: sides[inSide].vsInterior, vsOutside: sides[outSide].vsOutside,
    /* The edge colour reported is the one the losing side actually read, so
       the pair printed in a failure is the pair that produced the figure. */
    edge: sides[inSide].edge, edgeOutside: sides[outSide].edge,
    worstInterior: sides[inSide].worstInterior,
    worstOutside: sides[outSide].worstOutside,
    samples: { edge: total('edge'), interior: total('interior'), outside: total('outside') },
    perSideSamples: SIDES.reduce((o, s) => (o[s] = sides[s].samples, o), {}),
    colours: {
      interior: Math.max(...SIDES.map((s) => sides[s].colours.interior)),
      outside: Math.max(...SIDES.map((s) => sides[s].colours.outside))
    },
    box: sides.top.box
  };
}

/* The worst reading of one shape's edge against ANOTHER shape's edge, side by
   corresponding side. Left against left, top against top: a ring's left edge
   compared with a plain button's bottom edge would be comparing two different
   rules and reporting the difference as a state difference. */
function shapeVsShape(a, b) {
  return round(SIDES.reduce((lo, s) => Math.min(lo,
    b.sides[s].edgeLine.reduce((m, p) => Math.min(m, contrast(a.sides[s].edge, p)), Infinity)), Infinity));
}

/* The rects an element's own TEXT occupies, not its box: a chip that is part
   lock glyph has its words on none of the glyph. */
const textRuns = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const rects = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walk.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    if (node.parentElement.closest('.sr')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width > 0 && r.height > 0) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
  }
  const cs = getComputedStyle(el);
  return JSON.stringify({ color: cs.color, fontSize: cs.fontSize, rects,
    text: el.textContent.trim().slice(0, 40) });
})()`;

const sampleRects = (rects) => `(() => {
  let r = 0, g = 0, b = 0, n = 0;
  for (const q of ${JSON.stringify(rects)}) {
    const d = globalThis.__plate.getImageData(Math.round(q.x), Math.round(q.y),
      Math.max(1, Math.round(q.w)), Math.max(1, Math.round(q.h))).data;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  if (!n) throw new Error('no text pixels sampled');
  return JSON.stringify([r / n, g / n, b / n, n]);
})()`;

/* Every computed style this file compares, in one place, so the two sides of a
   comparison can never be read with different property lists. */
/* Every sideways scroller the pane has drawn, and the three facts that decide
   whether a keyboard can use it. Read on .tbl-wrap itself, the element that
   clips: on an ancestor of a clipping box the two widths agree and the
   overflow is invisible, which is the second of the two blind spots
   CLAUDE.md records for this comparison. The first -- both values being
   integers -- is not dodgeable here and is declared under NOT COVERED.

   accessibleName is read the way a reader resolves it, aria-label first, so a
   role that names nothing cannot pass as a named region. */
const SCROLLERS = `(() => {
  const out = [];
  for (const wrap of document.querySelectorAll('#lookupResult .tbl-wrap')) {
    const caption = wrap.querySelector('caption');
    out.push({
      caption: caption ? caption.textContent.trim() : null,
      clientWidth: wrap.clientWidth,
      scrollWidth: wrap.scrollWidth,
      overflows: wrap.scrollWidth > wrap.clientWidth,
      hasTabindex: wrap.hasAttribute('tabindex'),
      tabIndex: wrap.tabIndex,
      role: wrap.getAttribute('role'),
      accessibleName: (wrap.getAttribute('aria-label') || '').trim(),
    });
  }
  return JSON.stringify(out);
})()`;

const STYLE = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const out = { text: el.textContent.trim().slice(0, 40),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  for (const p of ['color', 'background-color', 'box-shadow', 'border-top-style',
    'border-top-width', 'border-left-style', 'font-family', 'font-weight', 'font-size',
    'letter-spacing', 'text-transform', 'min-width', 'margin-top', 'padding-top',
    'padding-left', 'vertical-align']) out[p] = cs.getPropertyValue(p);
  return JSON.stringify(out);
})()`;

/* The four text sites this change moves. Named here so the count below is read
   off the list rather than typed beside it. */
const TEXT_SITES = [
  ['.locked.masked', 'the mask chip in the account record'],
  ['tr.is-selected .match-row-btn .code', 'the coded reference inside the pressed pick control'],
  ['tr:not(.is-selected) .match-row-btn .code', 'the coded reference inside an unpressed pick control'],
  ['tr.is-selected .t-sub .locked', 'the masked address under the picked reference'],
];

/* Elements read per theme, each with the element it is compared against. */
const PAIRS = {
  pressedBtn: 'tr.is-selected .match-row-btn',
  unpressedBtn: 'tr:not(.is-selected) .match-row-btn',
  pressedCode: 'tr.is-selected .match-row-btn .code',
  unpressedCode: 'tr:not(.is-selected) .match-row-btn .code',
  maskedChip: '.locked.masked',
  plainLockedChip: 'tr.is-selected .t-sub .locked',
  nameCell: 'tr.is-selected th.match-name',
  otherRowHeader: '#accountColumn .tbl tbody th.t-main',
  nameSub: 'th.match-name .t-sub',
  otherSub: '#accountColumn .tbl .t-sub',
};

/* --------------------------------------------------------------- the run */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(api(url.pathname)));
    return;
  }
  const abs = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

const census = {};
let browser = null;
let cdp = null;
let profile = null;

try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = fs.mkdtempSync(path.join(ROOT, '.ops-users-rendered-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--force-prefers-reduced-motion', 'about:blank',
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const page = (await devtoolsJson(port, '/json/list')).find((t) => t.type === 'page');
  cdp = connect(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (expression) => {
    const res = await cdp.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'the in-page probe threw');
    }
    return res.result.value;
  };
  const styleOf = async (selector) => {
    const raw = await evaluate(STYLE(selector));
    if (!raw) throw new Error('nothing matched ' + selector + ' on the drawn page');
    return JSON.parse(raw);
  };

  /* The consequence, driven rather than inferred.
     `tabindex="0"` is a statement about the tab sequence; this is the thing a
     keyboard user actually wants, which is for the columns past the edge to
     come into view. Focus is taken with .focus(), which a div without a
     tabindex ignores outright -- so activeElement landing on the wrap is
     itself evidence -- and the scroll is driven with real key events through
     CDP. A synthetic KeyboardEvent would not scroll anything: the browser
     scrolls on the default action of a trusted key press, and dispatchEvent
     produces an untrusted one. Same reason CSS :hover needs
     Input.dispatchMouseEvent. */
  const driveScroller = async () => {
    const found = await evaluate(`(() => {
      for (const wrap of document.querySelectorAll('#lookupResult .tbl-wrap')) {
        if (wrap.scrollWidth > wrap.clientWidth) {
          wrap.id = 'kbdScroller';
          wrap.scrollLeft = 0;
          wrap.focus();
          return JSON.stringify({
            caption: (wrap.querySelector('caption') || {}).textContent || null,
            focused: document.activeElement === wrap,
            before: wrap.scrollLeft,
            room: wrap.scrollWidth - wrap.clientWidth,
          });
        }
      }
      return null;
    })()`);
    if (!found) return { present: false };

    for (let i = 0; i < 8; i += 1) {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent',
          { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
            nativeVirtualKeyCode: 39 });
      }
    }
    await new Promise((r) => setTimeout(r, 400));

    const after = await evaluate(`(() => {
      const wrap = document.getElementById('kbdScroller');
      return JSON.stringify({ after: wrap.scrollLeft,
        stillFocused: document.activeElement === wrap });
    })()`);
    return { present: true, ...JSON.parse(found), ...JSON.parse(after) };
  };

  let initScript = null;
  for (const theme of THEMES) {
    if (initScript) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
    }
    /* The theme and the API base have to be in storage before the document's
       first script runs. Emulated media is set to the OPPOSITE theme, because
       theme.js falls back to prefers-color-scheme and matching the two would
       make a failed storage write look like a success. */
    initScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try {' +
        "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
        "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
        "localStorage.setItem('ops-theme', " + JSON.stringify(theme) + ');' +
        '} catch (e) {}',
    })).identifier;
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }],
    });
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });

    cdp.reset();

    /* The second pass renders nothing without this, and says so quietly.
       After the first navigation the target stops being frontmost, so its
       document is visibilityState "hidden" -- and a hidden document produces
       no animation frames. Layout and getComputedStyle still answer, which is
       why everything measured here kept working, but anything delivered on a
       frame stops: requestAnimationFrame, ResizeObserver, IntersectionObserver
       and the window `resize` event. Measured: 24 rAF ticks in the first pass
       against 0 in the second, over the same 400ms, both at innerWidth 375. */
    await cdp.send('Page.bringToFront');
    await cdp.send('Page.navigate', { url: origin + PAGE });
    await cdp.once('Page.loadEventFired');
    await new Promise((r) => setTimeout(r, 800));

    const drove = await evaluate(DRIVE);
    if (drove !== 'ok') throw new Error(`[${theme}] ${PAGE}: ${drove}`);
    const drawnTheme = await evaluate('document.documentElement.getAttribute("data-theme")');
    if (drawnTheme !== theme) {
      throw new Error(`[${theme}] the page drew with data-theme="${drawnTheme}"`);
    }

    const styles = {};
    for (const [key, selector] of Object.entries(PAIRS)) styles[key] = await styleOf(selector);

    /* The wide arm of the scroller question. At 1280 these four tables fit
       their cards, so this is where a tab stop that should not exist shows up. */
    const scrollersWide = JSON.parse(await evaluate(SCROLLERS));

    /* Text-run geometry is read from the DOM before the glyphs go, because
       afterwards there is nothing left to measure the extent of. */
    const texts = [];
    for (const [selector, where] of TEXT_SITES) {
      const raw = await evaluate(textRuns(selector));
      if (!raw) throw new Error(`[${theme}] no element for text site ${selector}`);
      texts.push({ ...JSON.parse(raw), selector, where });
    }

    /* One plate, with the glyphs lifted, and both kinds of measurement taken
       off it. Text wants the paint UNDER it. The graphics want the same
       thing: a mask chip's interior is the surface its dashed edge sits on,
       and the letters of the masked value standing on that surface are not
       the surface — sampling them would make the edge's contrast against its
       own background depend on how tall the address happens to be. */
    await evaluate(LIFT_GLYPHS);
    await new Promise((r) => setTimeout(r, 250));
    const plate = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await evaluate(loadPlate(plate.data));

    /* Every side of every shape. A four-sided ring and a four-sided dashed
       border are only as strong as the side that reads worst, and reading one
       side certified the other three by assumption — Stadiora/Aria#10713. */
    const probeShape = async (selector, where) => {
      const perSide = {};
      for (const side of SIDES) perSide[side] = await evaluate(stripProbe(selector, side));
      return readShape(perSide, where);
    };
    const ring = await probeShape(PAIRS.pressedBtn, 'the pressed control');
    const mask = await probeShape(PAIRS.maskedChip, 'the mask chip');
    const unpressed = await probeShape(PAIRS.unpressedBtn, 'the unpressed control');
    /* Worst case, not corresponding case: every pixel of the unpressed
       control's edge line on the same side, and the one that reads closest to
       the pressed ring wins. */
    const ringVsUnpressed = shapeVsShape(ring, unpressed);

    const textContrast = [];
    for (const t of texts) {
      const [r, g, b, n] = JSON.parse(await evaluate(sampleRects(t.rects)));
      textContrast.push({ where: t.where, selector: t.selector, text: t.text,
        ink: t.color, backdrop: [r, g, b], pixels: n,
        ratio: round(contrast(opaqueInk(t.color), [r, g, b])) });
    }

    /* Stadiora/Aria#10713. The floor on .match-name was bound only from
       below, by the 375px pass: it proves 200px is ENOUGH to keep the mark on
       the reference's line. Nothing proved it is not too MUCH — raising it to
       360px survived the whole suite.

       The first attempt at the other arm was itself a false green and is
       recorded here because the shape is worth keeping: it read
       `scrollWidth > clientWidth` on .tbl-wrap at 1280px, on the theory that
       an oversized floor drags the table past the card. Measured, it does
       not. At 1280 the table stays at 984px either way and the four sibling
       columns absorb the floor — 164/184/179/112 at a 200px floor,
       128/144/139/88 at 360 — with scrollWidth equal to clientWidth in every
       one of them. Nothing clips, the text wraps, and the assertion could not
       fail from the thing it named. scripts/check-ops-narrow-overflow.mjs does
       not see it either: it never runs a lookup, so there is no match table on
       the page it sweeps.

       Where the floor IS load-bearing is 375px, where the cell takes the
       floor exactly and the wrap is already scrolling sideways (570px of
       content in a 343px window at the 200px floor). So the arm binds the one
       thing that is both measurable and user-visible: the match's own name —
       the row header that says which person this row is — must fit inside the
       visible width of the wrap without the operator scrolling sideways to
       reach the end of it. 200px leaves 143px of headroom; 360px does not fit
       at all. The floor's measured window is [200, 343].

       Read on .tbl-wrap, the element that actually clips (`overflow-x: auto`,
       pane-users-v2.css:240). Reading it on <html> cannot fail, because the
       wrap absorbs the overflow by scrolling — the narrow arm below already
       reports documentScrollWidth for exactly that reason and does not assert
       on it. */

    /* The narrow pass. Two questions: is the "Selected" mark still on the line
       the reference is on, and does the cell the floor sets still fit in the
       window the operator is looking through? */
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 375, height: 1600, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 400));

    /* Collected AFTER the viewport change and after the pane's 140ms settle,
       with nothing repainted in between: at this point the only thing that can
       have moved these attributes is the pane's ResizeObserver, since no
       paint, click or navigation happened between the width change and this
       read. That is what binds the observer rather than merely the writes. */
    const scrollersNarrow = JSON.parse(await evaluate(SCROLLERS));
    const keyboard = await driveScroller();
    const narrow = JSON.parse(await evaluate(`(() => {
      const th = document.querySelector('tr.is-selected th.match-name');
      const wrap = th.closest('.tbl-wrap');
      const btn = th.querySelector('.match-row-btn').getBoundingClientRect();
      const mark = th.querySelector('.sel-mark').getBoundingClientRect();
      const overlap = Math.min(btn.bottom, mark.bottom) - Math.max(btn.top, mark.top);
      return JSON.stringify({
        cellWidth: th.getBoundingClientRect().width,
        floor: Number.parseFloat(getComputedStyle(th).minWidth),
        wrapClientWidth: wrap.clientWidth, wrapScrollWidth: wrap.scrollWidth,
        sameLine: overlap > Math.min(btn.height, mark.height) / 2,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      });
    })()`));

    census[theme] = { styles, textContrast, narrow,
      scrollers: { wide: scrollersWide, narrow: scrollersNarrow, keyboard },
      graphics: { ring, mask, unpressed, ringVsUnpressed } };
  }
} catch (err) {
  await shutdown();
  throw err;
}

await shutdown();

/* The figures published on the pull request come out of here rather than off a
   notepad: OPS_RENDERED_CENSUS=1 node --test scripts/ops-users-rendered.test.mjs
   prints every colour, ratio and rect this run actually measured. A contrast
   table typed by hand beside a check that measures something else is the same
   defect as a green test for a broken behaviour, one step further out. */
if (process.env.OPS_RENDERED_CENSUS) {
  process.stdout.write(JSON.stringify(census, null, 2) + '\n');
}

async function shutdown() {
  if (cdp) cdp.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const gone = new Promise((r) => {
      const timer = setTimeout(() => r(false), 5000);
      browser.once('exit', () => { clearTimeout(timer); r(true); });
    });
    browser.kill();
    if (!(await gone)) browser.kill('SIGKILL');
  }
  if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }
  await new Promise((r) => server.close(r));
}

/* ---------------------------------------------------------------- the census

   Asserted before anything is read off it: a run that drew one theme and
   measured the other's leftovers would otherwise agree with itself. */
test('both themes reached a populated match list with a match picked', () => {
  assert.deepEqual(Object.keys(census).sort(), [...THEMES].sort());
  for (const theme of THEMES) {
    assert.equal(census[theme].textContrast.length, TEXT_SITES.length,
      `[${theme}] measured ${census[theme].textContrast.length} text sites, ` +
      `TEXT_SITES names ${TEXT_SITES.length}`);
    assert.equal(Object.keys(census[theme].styles).length, Object.keys(PAIRS).length);
  }
});

/* --------------------------------------------- Stadiora/Aria#10648, the pick */

for (const theme of THEMES) {
  test(`[${theme}] the pressed pick control is drawn differently from the unpressed one`, () => {
    const { pressedBtn, unpressedBtn } = census[theme].styles;

    /* The shape. A ring where a ghost button has none, asserted in both
       directions: a rule that put the ring on every .match-row-btn would
       satisfy the first half and fail the second. */
    assert.notEqual(pressedBtn['box-shadow'], 'none',
      'the pressed control carries no box-shadow, so nothing rings it');
    assert.equal(unpressedBtn['box-shadow'], 'none',
      'the unpressed control has grown a ring, so the ring no longer marks the pressed one');
    assert.match(pressedBtn['box-shadow'], /inset/,
      'the pressed ring is not inset, so it is not the shape inside the box ' +
      'that :focus-visible sits outside');

    /* The fill. */
    assert.notEqual(parseColor(pressedBtn['background-color']).join(),
      parseColor(unpressedBtn['background-color']).join(),
      'the pressed and unpressed controls resolve the same background colour');
    assert.equal(unpressedBtn['background-color'], 'rgba(0, 0, 0, 0)',
      'the unpressed control is no longer a ghost button');
  });

  test(`[${theme}] the pressed pick control differs from the unpressed one WITHOUT colour`, () => {
    const c = census[theme];
    const { pressedCode, unpressedCode } = c.styles;

    /* Weight carries no colour at all. Magnitude, not just direction:
       Stadiora/Aria#10713 proved `620` -> `521` survived a bare `>`, which is
       a 21-unit step no reader can see and, under forced-colours where the
       ring and the fill both resolve away, the only channel left. The floor is
       one full CSS weight rank. */
    const pressedWeight = Number(pressedCode['font-weight']);
    const unpressedWeight = Number(unpressedCode['font-weight']);
    assert.ok(pressedWeight - unpressedWeight >= 100,
      `the pressed reference is set at ${pressedWeight} and the unpressed one at ` +
      `${unpressedWeight}, a step of ${pressedWeight - unpressedWeight}: under a full ` +
      'weight rank, weight is not carrying the state');

    /* Luminance discards hue, so a ratio here is what a greyscale screen sees.
       The ring against the unpressed control's own edge line is the "these two
       controls do not look alike" claim with colour taken out of it, and it is
       the WORST pixel of that line, on every side, rather than a corresponding
       one on one side. */
    const { ring, unpressed, ringVsUnpressed } = c.graphics;
    assert.ok(ringVsUnpressed >= AA_GRAPHIC,
      `the pressed control's edge reads at ${ringVsUnpressed}:1 in luminance against the ` +
      `closest pixel of the unpressed control's edge (${ring.edge} vs ${unpressed.edge}), ` +
      `under ${AA_GRAPHIC}:1`);
  });

  test(`[${theme}] the pressed ring clears 3:1 on every side, against both surfaces it sits between`, () => {
    const { ring } = census[theme].graphics;
    for (const side of SIDES) {
      assert.ok(ring.sides[side].samples.edge >= 4,
        `the ring's ${side} edge was walked over ${ring.sides[side].samples.edge} pixel(s), ` +
        'too few for its figure below to be an assertion about the edge rather than a corner');
    }
    assert.ok(ring.vsInterior >= AA_GRAPHIC,
      `the ring reads ${ring.vsInterior}:1 on its ${ring.interiorSide} side against the worst ` +
      `pixel of the 4px band of pressed fill inboard of it (${ring.edge} vs ` +
      `${ring.worstInterior}), over ${ring.samples.interior} samples across four sides`);
    assert.ok(ring.vsOutside >= AA_GRAPHIC,
      `the ring reads ${ring.vsOutside}:1 on its ${ring.outsideSide} side against the worst ` +
      `pixel of the 3px band of picked row cell outboard of it (${ring.edgeOutside} vs ` +
      `${ring.worstOutside}), over ${ring.samples.outside} samples across four sides`);
  });
}

/* -------------------------------------------- Stadiora/Aria#10643, the mask */

for (const theme of THEMES) {
  test(`[${theme}] a masked value is drawn as a redaction and not as a plain locked chip`, () => {
    const { maskedChip, plainLockedChip } = census[theme].styles;

    /* The type: the mask stands in the value's own family, so a reveal reads
       as one value changing form. Both arms — the plain locked chip, which is
       the API's standing mask of an address in the match table, stays in the
       page's sans. */
    assert.match(maskedChip['font-family'], /mono/i,
      'the mask is not set in the monospace the value it stands for uses');
    assert.doesNotMatch(plainLockedChip['font-family'], /mono/i,
      'every locked chip is now mono, so the mask is no longer distinguishable from one');
    /* Magnitude, not just presence: `letter-spacing: .0005em` is not 'normal'
       and separates nothing, so the old shape of this check passed on tracking
       a reader cannot see. The floor is a third of a pixel at this type size,
       which is the smallest step Chrome will actually lay out differently. */
    const tracking = parseFloat(maskedChip['letter-spacing']);
    assert.ok(tracking >= 0.3,
      `the mask is tracked out by only ${maskedChip['letter-spacing']}, which does not ` +
      'separate its dots enough to stop them running together as a word');
    assert.equal(plainLockedChip['letter-spacing'], 'normal',
      'every locked chip is now tracked, so tracking no longer marks the mask');

    /* The edge: dashed where the plain chip's is a solid box-shadow ring. */
    assert.equal(maskedChip['border-top-style'], 'dashed',
      'the mask has no dashed edge, so nothing about its outline says withheld');
    assert.equal(maskedChip['border-left-style'], 'dashed');
    assert.equal(plainLockedChip['border-top-style'], 'none',
      'the plain locked chip has grown a border, so dashed no longer marks the mask');
    assert.equal(maskedChip['box-shadow'], 'none',
      'the mask carries the dashed border AND the solid ring, so it is drawn twice over');
    assert.notEqual(plainLockedChip['box-shadow'], 'none',
      'the plain locked chip has lost its ring');

    /* The border replaces the ring rather than joining it, and the padding
       gives back the pixel the border takes, so the row does not move. */
    assert.equal(round(maskedChip.rect.h), round(plainLockedChip.rect.h),
      `the mask is ${maskedChip.rect.h}px tall against the plain chip's ` +
      `${plainLockedChip.rect.h}px: the border changed the chip's size`);
  });

  test(`[${theme}] painting the mask did not change what the API masked`, () => {
    const { maskedChip, nameCell } = census[theme].styles;
    /* A masked value re-cased on screen is an administrator being shown a
       record that is not the record. The sheet says so beside .tbl tbody th;
       this is that sentence measured. */
    assert.equal(maskedChip['text-transform'], 'none');
    assert.equal(nameCell['text-transform'], 'none');
    assert.ok(maskedChip.text.includes('•'),
      `the mask chip reads "${maskedChip.text}", which carries no mask characters`);
    assert.ok(census[theme].textContrast.some((t) => t.text === MASKED_EMAIL),
      'the masked address the fixture sent is not on screen verbatim');
  });

  test(`[${theme}] the mask's dashed edge clears 3:1 on every side, against both surfaces`, () => {
    const { mask } = census[theme].graphics;
    /* .locked's background is a hatch, so the interior is two alternating
       colours and the claim is about the LOUD one. The sample counts are
       asserted because a band that collapses to one pixel is how this check
       reported 3.55:1 for a surface that measured 2.98:1. Now counted across
       four sides, with a per-side floor as well, so a short side walked over
       nothing cannot hide inside a healthy total — a dashed border sampled
       over nine pixels can land entirely in its own gaps. */
    for (const side of SIDES) {
      assert.ok(mask.sides[side].samples.edge >= 4,
        `the mask's ${side} edge was walked over ${mask.sides[side].samples.edge} pixel(s), ` +
        'too few to have found a dash rather than the gaps between them');
    }
    assert.ok(mask.samples.interior >= 40 && mask.samples.outside >= 30,
      `the mask's neighbouring bands were read at ${mask.samples.interior} interior and ` +
      `${mask.samples.outside} outside samples, which is too few to have walked the edge`);
    const separation = Math.max(...mask.worstInterior.map((v, i) => Math.abs(v - mask.worstOutside[i])));
    assert.ok(separation >= 3,
      `the worst pixel inside the mask chip (${mask.worstInterior}) and the worst pixel ` +
      `outside it (${mask.worstOutside}) are ${separation} of 255 apart, which is rounding ` +
      'rather than a difference. Either the chip has lost the surface that distinguishes ' +
      'it from the card it sits on, or one of the two bands is not where it is named — and ' +
      'that near-identity is precisely how a single-pixel sample of a hatched interior came ' +
      'back holding the card surface and published it as the interior');
    assert.ok(mask.vsInterior >= AA_GRAPHIC,
      `the dashed edge reads ${mask.vsInterior}:1 on its ${mask.interiorSide} side against ` +
      `the worst pixel of the mask chip interior (${mask.edge} vs ${mask.worstInterior}), ` +
      `over ${mask.samples.interior} samples across four sides`);
    assert.ok(mask.vsOutside >= AA_GRAPHIC,
      `the dashed edge reads ${mask.vsOutside}:1 on its ${mask.outsideSide} side against the ` +
      `worst pixel of the card surface outside it (${mask.edgeOutside} vs ` +
      `${mask.worstOutside}), over ${mask.samples.outside} samples across four sides`);
  });
}

/* --------------------------------------- Stadiora/Aria#10643, the name cell */

for (const theme of THEMES) {
  test(`[${theme}] the match's name cell carries a floor the pane's other row headers do not`, () => {
    const { nameCell, otherRowHeader, nameSub, otherSub } = census[theme].styles;

    const floor = Number.parseFloat(nameCell['min-width']);
    assert.ok(Number.isFinite(floor) && floor > 0,
      `th.match-name resolves min-width: ${nameCell['min-width']}, so the column has no floor`);
    assert.equal(otherRowHeader['min-width'], '0px',
      'the devices table\'s row header has the floor too, so the rule is not on .match-name');

    const gap = Number.parseFloat(nameSub['margin-top']);
    const otherGap = Number.parseFloat(otherSub['margin-top']);
    assert.ok(gap > otherGap,
      `the address under the reference sits ${gap}px below it and a caption elsewhere on ` +
      `the pane sits ${otherGap}px below its own line: the rhythm is not the cell's`);
  });

  /* Stadiora/Aria#10713: the floor's other arm. The 375px test below proves
     the floor is enough to keep the mark on the reference's line; this proves
     it is not so much that the name itself stops fitting in the window the
     operator is looking through. Both are measured at 375px, because that is
     the width at which the floor is load-bearing — at 1280 the cell takes
     345px of its own accord and the sibling columns absorb any floor raised
     under that. The long comment above the narrow probe records what was
     measured at 1280 and why no assertion is made there. */
  test(`[${theme}] the match's own name fits the window at 375px, floor and all`, () => {
    const { narrow } = census[theme];
    assert.ok(narrow.floor >= 200,
      `the floor resolves to ${narrow.floor}px, under the 200px the line test needs`);
    assert.equal(narrow.cellWidth, narrow.floor,
      `at 375px the cell should be squeezed onto its floor, so that this arm binds the ` +
      `floor and not the content: the floor is ${narrow.floor}px and the cell ` +
      `${narrow.cellWidth}px`);
    assert.ok(narrow.cellWidth <= narrow.wrapClientWidth,
      `at 375px th.match-name is ${narrow.cellWidth}px wide — its ${narrow.floor}px floor — ` +
      `inside a .tbl-wrap only ${narrow.wrapClientWidth}px of which is on screen, so the ` +
      'operator has to scroll sideways to reach the end of the name of the row they are ' +
      `looking at (the wrap already holds ${narrow.wrapScrollWidth}px of table)`);
  });

  test(`[${theme}] at 375px the "Selected" mark is still on the reference's line`, () => {
    const { narrow } = census[theme];
    assert.ok(narrow.sameLine,
      `at a ${narrow.cellWidth}px name cell the "Selected" mark has been pushed onto a ` +
      'line of its own, away from the reference it marks');
    /* The floor is a floor, not a shove. .tbl-wrap scrolls, so a floor set too
       high does not widen the document at all — it widens the CELL, and an
       operator scrolls sideways inside the card to find the mark that is
       supposed to sit beside the reference. Asserting the document width here
       instead reads like the same claim and binds nothing: raising the floor
       to 2000px leaves it green (battery row M21). Page-level sideways scroll
       is checked for all ten panes at 375px and 360px in both themes by
       scripts/check-ops-narrow-overflow.mjs, which runs in CI. */
    assert.ok(narrow.cellWidth <= narrow.documentClientWidth,
      `the name cell is laid out at ${narrow.cellWidth}px inside a ` +
      `${narrow.documentClientWidth}px viewport, so the reference and its mark cannot ` +
      'be on screen together');
  });
}

/* ------------------------------------------------------------ WCAG AA text */

for (const theme of THEMES) {
  test(`[${theme}] every text site this change moves clears WCAG AA`, () => {
    const sites = census[theme].textContrast;
    for (const s of sites) {
      assert.ok(s.ratio >= AA_TEXT,
        `${s.where} reads ${s.ratio}:1 — ink ${s.ink} on the painted stack ` +
        `rgb(${s.backdrop.map(Math.round).join(', ')}) sampled over ${s.pixels} text pixels`);
    }
  });
}

/* ------------------------------------------- a scroll box a keyboard can use

   Stadiora/Aria#10822. `overflow-x: auto` makes the columns past the card's
   edge reachable with a pointer and with nothing else: a div is not focusable
   by default, and a box that cannot be focused cannot be scrolled from a
   keyboard. WCAG 2.1 SC 2.1.1.

   The pane sets the three attributes only while the box actually scrolls, so
   both arms are asserted: present where it clips, ABSENT where it does not.
   The second arm is the one that keeps the fix from becoming a row of dead tab
   stops at desktop width, and it is assertable here only because the same run
   measures the same four boxes at two widths.

   NOT COVERED, deliberately:
     - the wrap's POSITION in the tab sequence. That it is reachable is bound
       below; that it is reached in a sensible order is not.
     - overflow under half a pixel. clientWidth and scrollWidth are integers,
       so a hairline clip is invisible to the pane's own condition and to this
       check alike. The pane errs towards the tab stop for that reason.
     - the pane painted while hidden. A display:none box measures 0/0 and reads
       as not scrolling. The pane's ResizeObserver does fire when such a box is
       shown and gains a size, so the mechanism covers it; nothing here binds
       that, because the shell draws this pane only when it is the active one.
     - every other pane. ops/assets/pane-run-history-v2.js has the same defect
       and is held by another agent; #10822 stays open against it. */

for (const theme of THEMES) {
  test(`[${theme}] at 375px every clipping table is a named region a keyboard can reach`, () => {
    const wraps = census[theme].scrollers.narrow;
    assert.ok(wraps.length >= 3,
      `only ${wraps.length} scroll wrappers were drawn, so the pane did not reach ` +
      'the populated state this arm reads');

    const clipping = wraps.filter((w) => w.overflows);
    assert.ok(clipping.length >= 1,
      'no table clipped at 375px, so this assertion could not have failed from ' +
      'what it names — the widths measured were ' +
      wraps.map((w) => `${w.clientWidth}/${w.scrollWidth}`).join(', '));

    for (const w of clipping) {
      assert.equal(w.tabIndex, 0,
        `the wrap holding "${w.caption}" clips ${w.scrollWidth - w.clientWidth}px and ` +
        `reports tabIndex ${w.tabIndex}, so a keyboard cannot reach what it hides`);
      assert.equal(w.role, 'region',
        `the wrap holding "${w.caption}" is a tab stop with role ${JSON.stringify(w.role)}`);
      assert.ok(w.accessibleName.length > 0,
        `the wrap holding "${w.caption}" is a region with no accessible name, so a ` +
        'reader landing on it is told "region" and nothing else');
      assert.equal(w.accessibleName, w.caption,
        `the region is named ${JSON.stringify(w.accessibleName)} while the table it ` +
        `holds is captioned ${JSON.stringify(w.caption)}`);
    }
  });

  test(`[${theme}] a table that fits is not a tab stop`, () => {
    const seen = [];
    for (const where of ['wide', 'narrow']) {
      for (const w of census[theme].scrollers[where]) {
        if (w.overflows) continue;
        seen.push(`${where}:${w.caption}`);
        assert.equal(w.hasTabindex, false,
          `at ${where} width the wrap holding "${w.caption}" fits ` +
          `(${w.clientWidth}/${w.scrollWidth}) and is still a tab stop, so a keyboard ` +
          'user stops on a region that cannot move');
        assert.equal(w.role, null,
          `at ${where} width the wrap holding "${w.caption}" fits and still announces ` +
          `role ${JSON.stringify(w.role)}`);
      }
    }
    assert.ok(seen.length >= 1,
      'every wrap clipped at both widths, so this arm asserted nothing; the ' +
      'conditional half of the fix is unbound in this run');
  });

  test(`[${theme}] arrow keys actually scroll the box they focus`, () => {
    const k = census[theme].scrollers.keyboard;
    assert.equal(k.present, true, 'no clipping wrap was found to drive at 375px');
    assert.equal(k.focused, true,
      `.focus() on the wrap holding "${k.caption}" did not move activeElement to it, ` +
      'which is what a div without a tabindex does');
    assert.equal(k.before, 0, `the box started at scrollLeft ${k.before}`);
    assert.ok(k.after > 0,
      `eight ArrowRight presses on the focused wrap holding "${k.caption}" left ` +
      `scrollLeft at ${k.after} with ${k.room}px of room, so the columns past the ` +
      'edge stayed out of reach');
    assert.equal(k.stillFocused, true,
      'focus left the wrap during the presses, so what scrolled may not be it');
  });
}
