/* Guards the operations dashboard against shipping in a typeface nobody chose.
 *
 * `assets/aria.css` has named `Geist` first in `--sans` and `Geist Mono` first
 * in `--mono` since the v2 shell was built. Until Stadiora/Aria#10806 nothing
 * served either file, so every pane fell straight through to the next entry in
 * the stack and the dashboard had never once rendered in the typeface its
 * design was approved in. Fifty pull requests of people looking closely at
 * these panes did not notice, and that is the whole difficulty: a missing
 * webfont is invisible by construction. The fallback renders fine. Nothing
 * reds, nothing looks broken, no guard in this repository had an opinion. It
 * simply is not the thing that was signed off.
 *
 * A webfont that fails to parse, 404s, or is rejected for its `format()`
 * string degrades to exactly that same silence. So the fix needs a guard that
 * fails when the font is not painting, and the only evidence that cannot be
 * faked is what Chrome says it actually drew the glyphs with:
 * `CSS.getPlatformFontsForNode`, read off rendered elements on a real pane
 * over HTTP.
 *
 * WHAT THIS FILE ASSERTS, and how each claim is proved:
 *
 * 1. Both faces reach `loaded` on every pane. Proof: `document.fonts`, read
 *    after `document.fonts.ready`. A face that 404s or fails to parse reports
 *    `error` or never appears, and this is the cheapest place to see that.
 *
 * 2. Every visible text-bearing element paints in a vendored face. Proof: one
 *    `CSS.getPlatformFontsForNode` per element, and the set of family names
 *    across the whole sweep must be exactly the two vendored families. This is
 *    the claim that was false on every element of every pane before #10806,
 *    which makes it an unusually precise red target: remove the `@font-face`
 *    rules and every reading becomes `.SF NS` and `Menlo`.
 *
 *    It is also the subset's coverage check. These files are subsetted to 58KB
 *    and drop Cyrillic, Greek, Vietnamese and box drawing; fallback is per
 *    CHARACTER, so a dropped codepoint appears here as a third family name
 *    rather than as tofu. Sweeping all four preview states is what puts
 *    different text through it.
 *
 *    NOT COVERED, and worth being exact about, because this claim is easy to
 *    read as stronger than it is. It detects a face that stops loading with
 *    total reliability, because that falls every site on every pane at once.
 *    It detects a missing CODEPOINT only for codepoints the stub data puts on
 *    screen, and rendering all ten panes in both themes and all four states
 *    shows that set is exactly one character wide: U+00B7 MIDDLE DOT, in 40 of
 *    the 80 pane-states. The subset is deliberately much wider than that --
 *    all of Latin-1 Supplement and Latin Extended-A -- because production
 *    renders people's names and the stub renders `Ada Lovelace`. So the width
 *    of the subset is a judgement this sweep cannot check, and the mutation
 *    that proves the claim binds the shipped bytes at all (T7 in the battery)
 *    has exactly one character available to it.
 *
 *    `document.fonts.check()` looks like it would answer this more cheaply and
 *    does not answer it at all: measured against these subsets it returns
 *    `true` for Cyrillic, CJK and emoji alike, because it reports family
 *    availability rather than glyph coverage. A coverage claim built on it
 *    passes unconditionally. It is named here so that nobody simplifies this
 *    sweep into it later.
 *
 * 3. The two stacks stay distinct. An element whose computed family leads with
 *    `Geist Mono` must paint Geist Mono, and one leading with `Geist` must
 *    paint Geist. Claim 2 alone would stay green if the mono `@font-face` were
 *    pointed at the sans file, because both readings would still name a
 *    vendored family.
 *
 * 4. The weight axis interpolates rather than snapping. The sheets ask for
 *    fourteen distinct weights and Geist ships static cuts only in hundreds,
 *    so ten of the fourteen fall between instances. Swap the variable file for
 *    a static one and claims 1 to 3 all stay green while the design's weight
 *    ramp silently flattens. Proof: the fourteen weights are rendered and
 *    their advance widths measured, and all fourteen must differ.
 *
 *    The measuring span is itself checked to be painting Geist, because the
 *    FALLBACK's widths vary with weight too -- measured, 489.25px at 400
 *    against 510px at 700 -- so "the widths differ" on its own would be
 *    satisfied by the very fallback this file exists to detect.
 *
 * 5. The fourteen weights under test are the weights the sheets actually use,
 *    re-derived from the stylesheets on every run. A hard-coded list rots in
 *    the direction that hides a defect: add a fifteenth weight to a sheet and
 *    claim 4 would go on proving the old fourteen and say nothing about it.
 *    `@font-face` blocks are stripped before parsing, because the `100 900`
 *    range in a face declaration is not a weight any design asked for -- it is
 *    this file's own fix, and counting it once already produced a wrong number
 *    in this PR's own documentation.
 *
 * 6. The fonts are fetched same-origin and the Content-Security-Policy permits
 *    them. Proof: the served bytes are counted at the server, and
 *    `securitypolicyviolation` events are collected in the page. Every
 *    `ops/*.html` sets `font-src 'self'`, but reading that out of the HTML
 *    would pin the string rather than the behaviour.
 *
 * 7. Floors, on panes, on probed elements, on elements that reported a face at
 *    all, and on each stack separately. Every claim above is a statement about
 *    a population, and a population of zero satisfies all of them. A pane that
 *    rendered nothing, a walk that selected nothing, or a `getPlatformFonts`
 *    call answering `[]` for everything would otherwise be indistinguishable
 *    from a clean board -- which is the single most common defect shape in
 *    this repository's history.
 *
 * 8. Every reading is in the theme and the state it is labelled with. Fonts do
 *    not vary by either, but the TEXT does, and claim 2's coverage is only
 *    worth what the text it saw is worth. A state that failed to apply makes
 *    four labelled passes over one state's text.
 *
 * Scope: the eleven pages that load `assets/aria.css`. `login.html` and
 * `setup.html` load `assets/ops.css` instead, which declares `'Fira Sans'` and
 * `'JetBrains Mono'` -- a different design that never named Geist, not an
 * unfixed instance of #10806.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const REGISTRY = 'ops/assets/pane-registry.js';
const SHEETS = 'ops/assets';
const { stub } = await import(path.join(ROOT, 'scripts/ops-api-stub.mjs'));

/* The two families the repository vendors. Anything else painting a glyph is
   the defect, whether it is a system fallback or a third family somebody
   added without a face to serve it. */
const VENDORED = ['Geist', 'Geist Mono'];

const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];

/* Floors. Each sits below a figure observed on the tree this file was written
   against, far enough to leave room for a pane legitimately losing a row and
   close enough that a pane losing its CONTENT fails. They deliberately count
   different things: elements probed, elements that answered with a face, and
   each stack on its own, because a walk can select plenty of elements and
   still learn nothing from any of them. */
const FLOOR_PANES = 10;            /* 10 declared in the registry */
const FLOOR_PROBED = 4800;         /* 5,636 observed */
const FLOOR_WITH_FACE = 4800;      /* 5,636 observed */
const FLOOR_SANS_SITES = 4100;     /* 4,860 observed */
const FLOOR_MONO_SITES = 650;      /* 776 observed */
const FLOOR_GLYPHS = 93000;        /* 110,478 observed */

function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: REGISTRY });
  const registry = sandbox.window.OpsPaneRegistry;
  if (!registry || !registry.PANES) throw new Error(`${REGISTRY} defined no window.OpsPaneRegistry.PANES`);
  return registry.PANES;
}

/* Claim 5. Read off the sheets rather than written down here, with face
   declarations removed first: `font-weight: 100 900` inside `@font-face` is
   the axis range this PR added, not a weight the design asked for, and
   counting it inflates the list by one and mis-states which weights fall
   between static cuts. */
function declaredWeights() {
  const weights = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, SHEETS))) {
    if (!file.endsWith('.css')) continue;
    const css = fs.readFileSync(path.join(ROOT, SHEETS, file), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
    for (const m of css.matchAll(/font-weight:\s*(\d+)\s*;/g)) weights.add(Number(m[1]));
  }
  return [...weights].sort((a, b) => a - b);
}

const DECLARED = readRegistry();
const PAGES = Object.keys(DECLARED).map((key) => ({ key, url: '/ops/' + DECLARED[key].file }));
const WEIGHTS = declaredWeights();

/* ----------------------------------------------------------------- server */

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain'
};

const fontRequests = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stub(url.pathname)));
    return;
  }
  const file = path.join(ROOT, url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found');
    if (url.pathname.endsWith('.woff2')) fontRequests.push({ path: url.pathname, status: 404, bytes: 0 });
    return;
  }
  const body = fs.readFileSync(file);
  if (url.pathname.endsWith('.woff2')) fontRequests.push({ path: url.pathname, status: 200, bytes: body.length });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/plain' });
  res.end(body);
});

/* -------------------------------------------------------------------- CDP */

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'
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
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never reported a DevTools port');
}

async function devtools(port, pathname, method) {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
      if (res.ok) return await res.json();
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome never opened its DevTools endpoint');
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === undefined) { for (const l of listeners) l(m); return; }
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(JSON.stringify(m.error)));
    else p.resolve(m.result);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    on: (fn) => listeners.add(fn),
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}

/* -------------------------------------------------------------- readiness */

/* Stadiora/Aria#10775: a fixed sleep is a guess about somebody else's machine
   at a moment you cannot see, and a sweep paced by one measures an unfinished
   pane under a finished pane's label. Four conditions, asked of the page
   rather than of the clock, and an upper bound that FAILS rather than a sleep
   that proceeds. `document.fonts.status` is here for the obvious reason: this
   file measures the consequences of font loading, so a reading taken before
   the swap is an unfallback reading wearing a webfont label. */
const SETTLE_BUDGET_MS = 30000;
const SETTLE_POLL_MS = 50;
const SETTLE_STABLE = 3;

const FINGERPRINT = `(() => {
  if (window.__fontStale) return '?the document being left is still installed';
  if (document.readyState !== 'complete') return '?document.readyState=' + document.readyState;
  if (!window.__fontReady) return '?ops:ready has not fired on ' + location.pathname;
  if (document.fonts.status !== 'loaded') return '?web fonts are still ' + document.fonts.status;
  let texts = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walk.nextNode())) if (node.nodeValue.trim()) texts += 1;
  const content = document.getElementById('content');
  return [document.querySelectorAll('*').length, texts, document.fonts.size,
    content ? content.childElementCount : -1].join('/');
})()`;

async function evaluate(cdp, expression, awaitPromise = false) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails));
  }
  return res.result.value;
}

function trackNetwork(cdp) {
  const inFlight = new Map();
  cdp.on((m) => {
    if (m.method === 'Network.requestWillBeSent') inFlight.set(m.params.requestId, m.params.request.url);
    else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inFlight.delete(m.params.requestId);
    else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) inFlight.clear();
  });
  return inFlight;
}

let networkInFlight = new Map();

async function settle(cdp, where) {
  const started = Date.now();
  let last = null;
  let stable = 0;
  let idle = true;
  while (Date.now() - started < SETTLE_BUDGET_MS) {
    const print = await evaluate(cdp, FINGERPRINT);
    idle = networkInFlight.size === 0;
    if (typeof print === 'string' && print.startsWith('?')) { stable = 0; last = print; }
    else if (!idle) { stable = 0; last = `?${networkInFlight.size} read(s) still in flight`; }
    else if (print === last) { stable += 1; if (stable >= SETTLE_STABLE) return { where, waitedMs: Date.now() - started, print }; }
    else { stable = 1; last = print; }
    await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
  }
  throw new Error(`${where} never settled within ${SETTLE_BUDGET_MS}ms. Still waiting on: ${last}`);
}

/* Page.navigate resolves when the navigation has STARTED, so a poll issued
   straight after can be answered by the document being left -- which is
   complete, has fired ops:ready and has its fonts loaded, so every condition
   above passes and the sweep measures the previous pane under the next pane's
   name. The flag is set before navigating and cleared only by the new
   document's own initialisation script. */
async function navigate(cdp, url) {
  await evaluate(cdp, 'window.__fontStale = true');
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 600; i++) {
    if (await evaluate(cdp, 'window.__fontStale !== true')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`navigating to ${url} never installed a new document`);
}

const RENDERED_THEME = `JSON.stringify({
  attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor
})`;

async function seedTheme(cdp, theme) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    last = await evaluate(cdp, `(() => {
      localStorage.setItem('ops-theme', ${JSON.stringify(theme)});
      return localStorage.getItem('ops-theme');
    })()`);
    if (last === theme) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`could not seed theme ${theme} into localStorage. Last reading: ${last}`);
}

const APPLY = (state) => `(() => {
  if (!window.Aria || typeof window.Aria.applyState !== 'function') {
    return { ok: false, why: 'window.Aria.applyState is not a function' };
  }
  window.Aria.applyState(${JSON.stringify(state)});
  const shown = [...document.querySelectorAll('[data-state][data-shown]')];
  const wrong = shown
    .filter((el) => !el.getAttribute('data-state').split(/\\s+/).includes(${JSON.stringify(state)}))
    .map((el) => el.getAttribute('data-state'));
  return { ok: wrong.length === 0, shown: shown.length, wrong: wrong.slice(0, 4) };
})()`;

/* Marks every visible element that directly renders text, and reports what
   each one's computed stack leads with so claim 3 can judge the pairing.
   Elements with no box, or whose text is whitespace, are skipped: they have no
   glyphs, so `getPlatformFontsForNode` answers `[]` for them and they would
   dilute the floors with readings that cannot fail. */
const MARK = `(() => {
  for (const el of document.querySelectorAll('[data-fontprobe]')) el.removeAttribute('data-fontprobe');
  const out = [];
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walk.nextNode())) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const first = (cs.fontFamily.split(',')[0] || '').replace(/^["']|["']$/g, '').trim();
    el.setAttribute('data-fontprobe', String(out.length));
    out.push({
      el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
      stack: first,
      weight: cs.fontWeight,
      text: node.nodeValue.trim().slice(0, 32)
    });
  }
  return JSON.stringify(out);
})()`;

/* Claim 4. Rendered in the page rather than on a canvas, so the result is the
   same shaping engine, the same face and the same CSS cascade the panes use.
   Set through the CSSOM: this repository's CSP has no `'unsafe-inline'`, which
   blocks `style` content attributes and injected `<style>` elements -- an
   injected sheet is how an earlier probe in this effort silently measured
   unstyled elements -- but does not touch `element.style` property writes.
   Verified here rather than assumed: the span is measured, and separately
   asked what it painted with. */
const AXIS = (weights) => `(() => {
  const host = document.body;
  const made = [];
  for (const w of ${JSON.stringify(weights)}) {
    const span = document.createElement('span');
    span.setAttribute('data-axis', String(w));
    span.textContent = 'Hamburgefonstiv 0123456789';
    span.style.fontFamily = 'Geist';
    span.style.fontWeight = String(w);
    span.style.fontSize = '64px';
    span.style.position = 'absolute';
    span.style.left = '-9999px';
    span.style.top = '0';
    span.style.whiteSpace = 'pre';
    host.appendChild(span);
    made.push({ weight: w, width: span.getBoundingClientRect().width,
      applied: getComputedStyle(span).fontWeight });
  }
  return JSON.stringify(made);
})()`;

/* --------------------------------------------------------------- the sweep */

let browser = null;
let cdp = null;
let profile = null;

const readings = [];
const applications = [];
const themings = [];
const fontSets = [];
const panesSeen = new Set();
let axis = null;
let cspViolations = null;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /* Dot-prefixed and inside the repository when RUNNER_TEMP is unset, matching
     the two sibling sweeps: an interrupted run must leave behind something git
     will not offer to commit. */
  profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP || ROOT), '.ops-webfont-'));
  browser = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });

  const port = await devtoolsPort(profile);
  const tab = await devtools(port, '/json/new?about:blank', 'PUT');
  cdp = connect(tab.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  networkInFlight = trackNetwork(cdp);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `localStorage.setItem('ops-api-base', ${JSON.stringify(base)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      'window.__fontStale = false;' +
      "addEventListener('ops:ready', function () { window.__fontReady = true; });" +
      'window.__csp = [];' +
      "addEventListener('securitypolicyviolation', function (e) {" +
      "  window.__csp.push(e.effectiveDirective + ' blocked ' + e.blockedURI); });"
  });

  for (const page of PAGES) {
    for (const theme of THEMES) {
      await navigate(cdp, `${base}/ops/index.html`);
      await seedTheme(cdp, theme);
      await navigate(cdp, base + page.url);
      const where = `${page.key} in ${theme}`;
      await settle(cdp, where);
      themings.push({ pane: page.key, asked: theme, ...JSON.parse(await evaluate(cdp, RENDERED_THEME)) });
      fontSets.push({
        pane: page.key,
        theme,
        faces: await evaluate(cdp, `(() => { const a = []; document.fonts.forEach((f) => a.push({
          family: f.family, weight: f.weight, status: f.status })); return a; })()`)
      });

      for (const state of STATES) {
        const applied = await evaluate(cdp, APPLY(state));
        applications.push({ pane: page.key, theme, state, ...applied });
        await settle(cdp, `${where}, state ${state}`);

        const marked = JSON.parse(await evaluate(cdp, MARK));
        const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
        const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-fontprobe]' });
        if (nodeIds.length !== marked.length) {
          throw new Error(`${where}/${state}: marked ${marked.length} elements but the document returned ${nodeIds.length}`);
        }
        for (let i = 0; i < nodeIds.length; i++) {
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[i] });
          readings.push({ pane: page.key, theme, state, ...marked[i], faces: fonts.map((f) => ({ family: f.familyName, glyphs: f.glyphCount })) });
        }
        panesSeen.add(page.key);
      }
    }
  }

  /* Claim 4, once, on a settled pane in the theme it was last left in: the
     axis is a property of the font file, not of the page. */
  axis = JSON.parse(await evaluate(cdp, AXIS(WEIGHTS)));
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  for (const sample of axis) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-axis="${sample.weight}"]` });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    sample.paintedBy = fonts.map((f) => f.familyName);
  }
  cspViolations = await evaluate(cdp, 'JSON.stringify(window.__csp)');

  const families = new Map();
  for (const r of readings) for (const f of r.faces) families.set(f.family, (families.get(f.family) || 0) + f.glyphs);
  const monoSites = readings.filter((r) => r.stack === 'Geist Mono' && r.faces.length).length;
  const sansSites = readings.filter((r) => r.stack === 'Geist' && r.faces.length).length;
  console.log(`# swept ${panesSeen.size} panes x ${THEMES.length} themes x ${STATES.length} states, ` +
    `${readings.length} text elements (${sansSites} sans, ${monoSites} mono), ` +
    `${[...families.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  const loadedCount = new Map();
  for (const e of fontSets) for (const f of e.faces) {
    const k = `${f.family.replace(/^["']|["']$/g, '')}/${f.status}`;
    loadedCount.set(k, (loadedCount.get(k) || 0) + 1);
  }
  console.log(`# face status across ${fontSets.length} pane loads: ` +
    [...loadedCount.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
});

after(async () => {
  try { cdp?.close(); } catch { /* already gone */ }
  try { browser?.kill('SIGKILL'); } catch { /* already gone */ }
  try { server.close(); } catch { /* already closed */ }
  /* Chrome's exit races this; the run has already succeeded by here. */
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ }
});

/* -------------------------------------------------------------- the claims */

/* `loaded` on EVERY pane load is not the right assertion and this file said it
   for one run: a face is fetched lazily, when something on the page is about
   to be painted with it, so a pane whose live state happens to draw no
   monospaced text legitimately reports Geist Mono as `unloaded`. Analytics in
   dark is exactly that pane. Asserting the stronger thing would have made this
   file red for a correct tree, and weakening it to "status is anything" would
   have made it judge nothing -- so what is asserted is the part the platform
   does promise: the faces are REGISTERED with an open axis wherever the sheet
   is loaded, none is ever in `error`, and each one really does resolve
   somewhere. What they actually PAINT is claims 2 and 3, measured off glyphs
   rather than off a status word. */
test('claim 1: both vendored faces are registered, resolvable, and never in error', () => {
  assert.ok(fontSets.length >= FLOOR_PANES * THEMES.length,
    `only ${fontSets.length} pane loads reported a font set`);
  const everLoaded = new Set();
  for (const entry of fontSets) {
    for (const family of VENDORED) {
      const face = entry.faces.find((f) => f.family.replace(/^["']|["']$/g, '') === family);
      assert.ok(face, `${entry.pane} in ${entry.theme} never registered a @font-face for ${family}. ` +
        `Registered: ${entry.faces.map((f) => f.family).join(', ') || '(none)'}`);
      assert.notEqual(face.status, 'error',
        `${entry.pane} in ${entry.theme}: ${family} failed to load. A face that 404s or fails to ` +
        'parse degrades silently to the next family in the stack, which is the defect ' +
        'Stadiora/Aria#10806 recorded.');
      assert.equal(face.weight, '100 900',
        `${entry.pane} in ${entry.theme}: ${family} declares weight "${face.weight}". ` +
        'Ten of the design\'s fourteen weights fall between Geist\'s static cuts, so the axis must be open.');
      if (face.status === 'loaded') everLoaded.add(family);
    }
  }
  assert.deepEqual([...everLoaded].sort(), [...VENDORED].sort(),
    'a vendored face was registered on every pane and never actually resolved on any of them.');
});

test('claim 2: every rendered glyph is painted by a vendored face', () => {
  const offenders = new Map();
  for (const r of readings) {
    for (const f of r.faces) {
      if (VENDORED.includes(f.family)) continue;
      const key = `${f.family} <- ${r.pane}/${r.theme}/${r.state} ${r.el} "${r.text}"`;
      offenders.set(key, (offenders.get(key) || 0) + f.glyphs);
    }
  }
  assert.equal(offenders.size, 0,
    `${offenders.size} text site(s) painted with a face this repository does not vendor. ` +
    'Either the webfont is not loading -- in which case every site on the pane falls back at once -- ' +
    'or the subset in ops/assets/fonts/ is missing a codepoint the dashboard renders, which falls ' +
    'back per CHARACTER and shows up as a handful of sites. First few:\n  ' +
    [...offenders.entries()].slice(0, 8).map(([k, v]) => `${k} (${v} glyph(s))`).join('\n  '));
});

test('claim 3: the sans and mono stacks paint different faces', () => {
  const wrong = [];
  let sans = 0;
  let mono = 0;
  for (const r of readings) {
    if (!r.faces.length) continue;
    const painted = r.faces.map((f) => f.family);
    if (r.stack === 'Geist Mono') {
      mono += 1;
      if (!painted.includes('Geist Mono')) wrong.push(`${r.pane}/${r.theme}/${r.state} ${r.el} asks for Geist Mono, painted ${painted.join('+')}`);
    } else if (r.stack === 'Geist') {
      sans += 1;
      if (!painted.includes('Geist')) wrong.push(`${r.pane}/${r.theme}/${r.state} ${r.el} asks for Geist, painted ${painted.join('+')}`);
    }
  }
  assert.ok(sans >= FLOOR_SANS_SITES, `only ${sans} sans site(s) swept, floor ${FLOOR_SANS_SITES}`);
  assert.ok(mono >= FLOOR_MONO_SITES, `only ${mono} mono site(s) swept, floor ${FLOOR_MONO_SITES}`);
  assert.deepEqual(wrong, [],
    'a stack painted the other stack\'s face. Claim 2 cannot see this: pointing the Geist Mono ' +
    '@font-face at the sans file leaves every reading naming a vendored family.');
});

test('claim 4: the weight axis interpolates across every weight the sheets ask for', () => {
  assert.equal(axis.length, WEIGHTS.length, 'the axis probe did not render every declared weight');
  assert.ok(WEIGHTS.length >= 10, `only ${WEIGHTS.length} weight(s) found in the sheets; the design uses fourteen`);

  for (const sample of axis) {
    assert.deepEqual(sample.paintedBy, ['Geist'],
      `the weight-${sample.weight} probe was painted by ${sample.paintedBy.join('+') || '(nothing)'}, not Geist. ` +
      'The fallback\'s widths vary with weight too -- 489.25px at 400 against 510px at 700 when measured -- ' +
      'so the widths below would still differ while proving nothing about Geist.');
    assert.equal(sample.applied, String(sample.weight),
      `the weight-${sample.weight} probe computed to ${sample.applied}; the CSSOM write did not take`);
    assert.ok(sample.width > 0, `the weight-${sample.weight} probe measured ${sample.width}px`);
  }

  const byWidth = new Map();
  for (const sample of axis) {
    const rounded = Math.round(sample.width * 100) / 100;
    if (byWidth.has(rounded)) {
      assert.fail(`weights ${byWidth.get(rounded)} and ${sample.weight} both render at ${rounded}px. ` +
        'Geist ships static cuts only in hundreds, so identical widths mean the browser is snapping ' +
        'to instances rather than interpolating an axis -- the design\'s weight ramp is flattened ' +
        'and claims 1 to 3 cannot see it.');
    }
    byWidth.set(rounded, sample.weight);
  }

  const sorted = [...axis].sort((a, b) => a.weight - b.weight);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].width > sorted[i - 1].width,
      `weight ${sorted[i].weight} renders narrower than ${sorted[i - 1].weight} ` +
      `(${sorted[i].width}px vs ${sorted[i - 1].width}px)`);
  }
});

test('claim 5: the weights under test are the weights the sheets declare', () => {
  assert.deepEqual(WEIGHTS, [400, 440, 450, 460, 480, 500, 520, 540, 560, 580, 600, 620, 640, 700],
    'the set of font-weight values in ops/assets/*.css has changed. Claim 4 proves the axis over ' +
    'whatever this returns, so this is not a failure to fix by editing the list -- check that the ' +
    'new weight renders distinctly, then update it here. @font-face ranges are stripped before ' +
    'parsing, so the 100 900 axis declaration is deliberately absent.');
  const static_ = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  const between = WEIGHTS.filter((w) => !static_.has(w));
  assert.equal(between.length, 10,
    `${between.length} of the declared weights fall between Geist's static cuts, not 10: ${between.join(', ')}`);
});

test('claim 6: the fonts are served same-origin and the CSP permits them', () => {
  assert.deepEqual(JSON.parse(cspViolations), [],
    'the page reported a Content-Security-Policy violation. Every ops/*.html sets font-src \'self\'; ' +
    'a violation here means a face is being fetched from somewhere that policy does not allow.');
  const served = fontRequests.filter((r) => r.status === 200 && r.bytes > 0);
  assert.ok(served.length > 0, 'no .woff2 was ever requested from the test server. ' +
    'The faces are declared relative to ops/assets/aria.css; a wrong path 404s and falls back silently.');
  const failed = fontRequests.filter((r) => r.status !== 200);
  assert.deepEqual(failed, [], `font request(s) did not return 200: ${JSON.stringify(failed)}`);
  for (const family of ['Geist-Variable.woff2', 'GeistMono-Variable.woff2']) {
    assert.ok(served.some((r) => r.path.endsWith(family)), `${family} was never fetched`);
  }
});

test('claim 7: the sweep judged a real population', () => {
  assert.ok(panesSeen.size >= FLOOR_PANES,
    `only ${panesSeen.size} pane(s) were swept, floor ${FLOOR_PANES}. Every claim above is a ` +
    'statement about a population, and a population of zero satisfies all of them.');
  assert.ok(readings.length >= FLOOR_PROBED,
    `only ${readings.length} text element(s) were probed, floor ${FLOOR_PROBED}`);
  const withFace = readings.filter((r) => r.faces.length);
  assert.ok(withFace.length >= FLOOR_WITH_FACE,
    `only ${withFace.length} probed element(s) reported a painted face, floor ${FLOOR_WITH_FACE}. ` +
    'A getPlatformFontsForNode call answering [] for everything passes claim 2 by having nothing to judge.');
  const glyphs = readings.reduce((n, r) => n + r.faces.reduce((m, f) => m + f.glyphs, 0), 0);
  assert.ok(glyphs >= FLOOR_GLYPHS, `only ${glyphs} glyph(s) were painted across the sweep, floor ${FLOOR_GLYPHS}`);
  for (const pane of panesSeen) {
    const n = readings.filter((r) => r.pane === pane && r.faces.length).length;
    assert.ok(n > 0, `${pane} contributed no painted text at all`);
  }
});

test('claim 8: every reading is in the theme and state it is labelled with', () => {
  const backgrounds = new Map();
  for (const t of themings) {
    assert.equal(t.attr, t.asked,
      `${t.pane} was asked for the ${t.asked} theme and rendered with data-theme="${t.attr}"`);
    backgrounds.set(t.asked, (backgrounds.get(t.asked) || new Set()).add(t.bg));
  }
  const dark = [...(backgrounds.get('dark') || [])];
  const light = [...(backgrounds.get('light') || [])];
  assert.ok(dark.length && light.length, 'one of the themes was never rendered');
  assert.ok(!dark.some((d) => light.includes(d)),
    `the two themes painted the same body background (${dark.join(',')} vs ${light.join(',')}). ` +
    'An attribute that flips while the paint does not is a theme axis that exists only in the labels.');
  const bad = applications.filter((a) => !a.ok);
  assert.deepEqual(bad, [],
    'a preview state did not apply, so several labelled states are readings of one state\'s text. ' +
    'Claim 2\'s coverage is only worth what the text it saw is worth.');
});
