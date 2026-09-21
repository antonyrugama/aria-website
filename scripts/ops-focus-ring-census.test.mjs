/* A census of every rule in this repository that redefines a focus
   indicator's COLOUR, resolved to concrete sRGB by real Chrome, in both
   themes, on a page that actually loads it.
 *
 * WHY THIS EXISTS. Stadiora/Aria#10649 and #10651 were measured failures of
 * one shape: a focus ring painted in `var(--cyan)`, the FILL hue, rather than
 * `var(--cyan-ink)`, the hue `aria.css` carries down in light until it clears
 * SC 1.4.11's 3:1. The fix changed the shared rule in `aria.css`. A pane
 * stylesheet that declares its own ring colour opts out of that fix silently:
 * every token stays defined, every token holds its designed value, every
 * existing check stays green, and the control keeps the pre-fix value. #10721
 * filed three of those. This file exists because nothing could tell you
 * whether there was a fourth, and there was.
 *
 * WHAT IT IS NOT. It is not a scan for the string `var(--cyan)`. A literal
 * `#0891B2`, a `color-mix()` that lands on it, or a new token aliased to it
 * are the same defect and no string match sees them. Every colour below is
 * resolved by assigning the declared value to a real element inside the real
 * page, under the real theme, and reading back what Chrome computed — so the
 * comparison is between VALUES, in the cascade's own terms, not between
 * spellings. That also means an expression this file cannot resolve to a
 * concrete colour is a FAILURE by name, never a skip: the ring is an ink, and
 * the conservative direction for an ink is to refuse.
 *
 * THE CLAIM, exactly. For every CSS rule under `ops/assets/` whose selector
 * carries a focus pseudo-class and whose declarations name an outline colour:
 * the colour it asks for resolves, in every theme, to the same value as the
 * DOCUMENT-LEVEL focus ring of a page that loads it — or the rule is listed
 * in KNOWN_DIVERGENT below with the issue that owns it. The document ring is
 * read from the cascade itself, by forcing `:focus-visible` on a plain probe
 * element and asking for its computed style, so this file does not model the
 * cascade and cannot be wrong about it in the way a hand-written baseline can.
 *
 * NOT COVERED — read this before trusting a green run.
 *
 *   - CONTRAST RATIOS. This file measures no ratio and judges none. Equality
 *     with the document ring is a COVERAGE claim: it says a ring has not
 *     quietly opted out of the shared definition, not that the shared
 *     definition passes. What the ring actually measures against the pixels
 *     beside it is scripts/ops-focus-indicator.test.mjs's question on
 *     /ops/shell-v2.html and /ops/evaluations.html,
 *     scripts/ops-settings-focus.test.mjs's on the settings dialog, and
 *     scripts/check-ops-contrast.mjs's across the shell's four preview
 *     states. A rule this census calls `inherits` has inherited a ring those
 *     oracles judged somewhere else, on some other control, against some
 *     other surface.
 *   - The INDICATOR'S PLACEMENT. `outline-offset` decides which surface a
 *     ring is judged against, and a positive offset on a control sitting
 *     flush inside a card puts the ring outside the card (PR #72 measured
 *     21,234 pixels of it there; PR #85 measured a 1px offset consumed
 *     entirely by antialiasing, leaving the control's own edge as the
 *     neighbour). The declared offset of every rule is recorded and printed
 *     below, because a divergent rule's holder needs it, but this file does
 *     not fail on it. Whether a given offset is wrong is a question about
 *     rendered pixels, and this file has none.
 *   - Indicators that are not an outline. A ring drawn as a box-shadow, a
 *     background swap or a border change is invisible here. The census is of
 *     `outline`/`outline-color` declarations under a focus pseudo-class.
 *   - Rules that exist only in a stylesheet no page loads, or in a page this
 *     repository does not serve from ops/. Both are impossible today — the
 *     page/stylesheet map is derived from the HTML and cross-checked against
 *     what Chrome reports it loaded — and both would show up as a floor
 *     failure rather than as silence.
 *   - Whether a rule ever MATCHES anything. `.modal-card .field-input` is
 *     judged here from its declaration; whether an operator can reach that
 *     field is a different question, asked in ops/keyboard-audit.md.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stub } from './ops-api-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ------------------------------------------------------------ the contract

   Written from reading the stylesheets, not generated from a run: an
   expectation derived from the thing it checks moves with the defect. Each
   entry names the file, the selector as written, the declared outline-offset,
   and the colour the rule resolves to in each theme. The run below produces
   the same shape independently and the two are compared.

   `ring` is what the page's own document-level focus ring resolves to in that
   theme, so `diverges` is `colour !== ring` and is derived, never typed.

   A new focus rule that declares a colour, a changed palette value, or a
   changed offset turns this red. That is the point: all three are the defect
   this file exists for, and all three are one line of review. */
const EXPECTED = [
  { file: 'ops/assets/aria.css', selector: ':focus-visible',
    offset: '2px', dark: '#22d3ee', light: '#155e75' },
  { file: 'ops/assets/aria.css', selector: '.field:focus-within',
    offset: '-2px', dark: '#22d3ee', light: '#155e75' },
  { file: 'ops/assets/ops.css', selector: ':focus-visible',
    offset: '2px', dark: '#00e5ff', light: '#026a80' },
  { file: 'ops/assets/ops.css', selector: '.search:focus-within',
    offset: '2px', dark: '#00e5ff', light: '#026a80' },
  { file: 'ops/assets/pane-alerts-v2.css', selector: '.p-close textarea:focus-visible',
    offset: '1px', dark: '#22d3ee', light: '#0891b2' },
  { file: 'ops/assets/pane-alerts-v2.css', selector: '.sw:focus-visible',
    offset: '2px', dark: '#22d3ee', light: '#0891b2' },
  { file: 'ops/assets/pane-evaluations-v2.css', selector: '.field-input:focus-visible',
    offset: '-2px', dark: '#22d3ee', light: '#155e75' },
  { file: 'ops/assets/shell-pane-v2.css', selector: '.modal-card .field-input:focus-visible',
    offset: '2px', dark: '#22d3ee', light: '#0891b2' }
];

/* Rules whose colour is NOT the document ring's, each with the issue that
   owns it. Keyed by file and selector rather than by line, because #10721
   cites three line numbers and one of them had already moved by the time it
   was read.
 *
 * An entry here is a declared, enumerated exception, never a skip: the run
 * still resolves the rule, still prints its values, and still fails if the
 * entry stops reproducing. An exception that no longer diverges is a fix that
 * landed, and the correct response to it is to DELETE the entry — so this
 * list cannot rot in the direction of claiming a defect that is gone, any
 * more than in the direction of hiding one that is not. */
const KNOWN_DIVERGENT = [
  {
    file: 'ops/assets/pane-alerts-v2.css',
    selector: '.p-close textarea:focus-visible',
    issue: 'Stadiora/Aria#10721',
    note: 'The close-note textarea on the Problems sheet. Held by ' +
      'antonyrugama/aria-website PR #75 at the time of writing.'
  },
  {
    file: 'ops/assets/pane-alerts-v2.css',
    selector: '.sw:focus-visible',
    issue: 'Stadiora/Aria#10721',
    note: 'The per-rule enable switch on the Alert rules pane. Held by ' +
      'antonyrugama/aria-website PR #75 at the time of writing.'
  },
  {
    file: 'ops/assets/shell-pane-v2.css',
    selector: '.modal-card .field-input:focus-visible',
    issue: 'Stadiora/Aria#10842',
    note: 'The re-authentication dialog\'s password field, on all ten pane ' +
      'pages. Not one of the three sites #10721 names — this census found ' +
      'it, which is what the census is for.'
  }
];

/* ------------------------------------------------------------------ source

   A CSS reader, not a regular expression over CSS. The difference matters
   here: `shell-pane-v2.css` carries an eleven-line comment immediately above
   the rule this file exists to find, and a pattern that matches a selector
   followed by a brace happily swallows the comment into the selector. */

/* Replace every comment with the same number of newlines it spanned, so line
   numbers survive and no comment text can be read as a selector. */
function stripComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (const ch of css.slice(i, stop)) if (ch === '\n') out += '\n';
      i = stop;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

/* Every style rule in a sheet, with the line its selector starts on. At-rule
   blocks (`@media`, `@supports`) are descended into rather than treated as
   rules; at-rules that end in a semicolon (`@import`, `@charset`) are passed
   over. Declaration blocks cannot contain a brace, so the first `}` after a
   selector closes it. */
function rulesOf(css) {
  const src = stripComments(css);
  const rules = [];
  let buf = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '}') { buf = ''; i++; continue; }
    if (ch === ';' && buf.trim().startsWith('@')) { buf = ''; i++; continue; }
    if (ch !== '{') { buf += ch; i++; continue; }
    const selector = buf.trim();
    buf = '';
    if (selector.startsWith('@')) { i++; continue; }
    const close = src.indexOf('}', i + 1);
    const end = close === -1 ? src.length : close;
    rules.push({
      line: src.slice(0, i - selector.length).split('\n').length,
      selector: selector.split(/\s*\n\s*/).join(' ').replace(/\s+/g, ' '),
      body: src.slice(i + 1, end)
    });
    i = end + 1;
  }
  return rules;
}

/* A selector carries a focus pseudo-class if `:focus` appears not followed by
   another identifier character. `:focus-visible` and `:focus-within` are
   matched by the same test; a hypothetical `:focusable` is not. Written as a
   lookahead rather than as `\b`, because `-` is not a word boundary and
   `:focus-visible` would otherwise be missed by exactly the kind of near-miss
   this repository keeps catching. */
function isFocusRule(selector) {
  return /:focus(?![a-zA-Z0-9-])|:focus-(visible|within)(?![a-zA-Z0-9-])/.test(selector);
}

/* The last `outline` or `outline-color` declaration in a block, which is the
   one that wins. Returned as written; Chrome decides what it means. */
function outlineDeclaration(body) {
  let found = null;
  for (const raw of body.split(';')) {
    const at = raw.indexOf(':');
    if (at === -1) continue;
    const prop = raw.slice(0, at).trim().toLowerCase();
    const value = raw.slice(at + 1).trim();
    if (prop === 'outline' || prop === 'outline-color') found = { prop, value };
  }
  return found;
}

function outlineOffsetOf(body) {
  let found = null;
  for (const raw of body.split(';')) {
    const at = raw.indexOf(':');
    if (at === -1) continue;
    if (raw.slice(0, at).trim().toLowerCase() === 'outline-offset') {
      found = raw.slice(at + 1).trim();
    }
  }
  return found;
}

const SHEETS = fs.readdirSync(path.join(ROOT, 'ops/assets'))
  .filter((f) => f.endsWith('.css')).sort()
  .map((f) => 'ops/assets/' + f);

/* Every focus rule in the repository, colour-declaring or not. The ones that
   declare no colour inherit the document ring's and are counted, not judged:
   `.tbl-wrap:focus-visible { outline-offset: -2px }` is the house way to move
   the shared ring without redefining it. */
const FOCUS_RULES = [];
for (const file of SHEETS) {
  for (const rule of rulesOf(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
    if (!isFocusRule(rule.selector)) continue;
    FOCUS_RULES.push({
      file,
      line: rule.line,
      selector: rule.selector,
      declaration: outlineDeclaration(rule.body),
      offset: outlineOffsetOf(rule.body)
    });
  }
}
const COLOUR_RULES = FOCUS_RULES.filter((r) => r.declaration);

/* Which page loads which stylesheet, read out of the HTML. Used to choose a
   page on which each rule's value is resolved, and cross-checked below
   against the sheets Chrome reports it actually loaded — a rule resolved on a
   page that does not load its own stylesheet would be resolved in the wrong
   token set, which is the whole defect wearing a different hat. */
const PAGES = fs.readdirSync(path.join(ROOT, 'ops'))
  .filter((f) => f.endsWith('.html')).sort()
  .map((f) => {
    const html = fs.readFileSync(path.join(ROOT, 'ops', f), 'utf8');
    const sheets = [];
    for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/g)) {
      sheets.push('ops/' + m[1].replace(/^\.\//, ''));
    }
    return { url: '/ops/' + f, sheets };
  });

function pageFor(file) {
  const hit = PAGES.find((p) => p.sheets.includes(file));
  if (!hit) throw new Error(`no page in ops/ loads ${file}`);
  return hit.url;
}

const THEMES = ['dark', 'light'];

/* ------------------------------------------------------------------ server */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
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

/* ----------------------------------------------------------------- browser */

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

/* 'rgb(8, 145, 178)' -> '#0891b2'. Chromium serialises a computed colour as
   `rgb()` or `rgba()`; anything else here is an expression that did not
   resolve, and is reported as itself so the failure names what it saw. */
function hexOf(v) {
  const m = /^rgba?\(([^)]+)\)$/.exec((v || '').trim());
  if (!m) return null;
  const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (n.length < 3 || !n.slice(0, 3).every(Number.isFinite)) return null;
  if (n.length > 3 && n[3] !== 1) return null;
  return '#' + n.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------------- boot */

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || os.tmpdir();
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-ring-census-'));

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
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
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
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error('page threw: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return JSON.parse(res.result.value);
}

let initScript = null;
async function load(url, theme) {
  if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try {' +
      `localStorage.setItem('ops-api-base', ${JSON.stringify(base)});` +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      `localStorage.setItem('ops-theme', ${JSON.stringify(theme)});` +
      '} catch (e) {}'
  });
  initScript = res.identifier;
  /* Emulated to the opposite of the stored theme, so a storage write that
     silently failed cannot be mistaken for a theme that took. Which theme
     painted is asserted, not assumed. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
  cdp.reset();
  await cdp.send('Page.navigate', { url: base + url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, 350));
}

/* The document-level ring, read out of the cascade rather than modelled from
   it: a plain element with no class of its own, its `:focus-visible` forced,
   and whatever Chrome then computes for it. A probe that comes back with no
   ring means the force did not apply, and is a failure — resolving every
   rule against a baseline of "none" would call every ring on the page
   divergent, or, with the comparison the other way up, none of them. */
async function documentRing() {
  await evalJson(`(() => {
    document.getElementById('__ring_probe')?.remove();
    const el = document.createElement('div');
    el.id = '__ring_probe';
    el.tabIndex = 0;
    document.body.appendChild(el);
    return 'null';
  })()`);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: '#__ring_probe'
  });
  if (!nodeId) throw new Error('the ring probe was not in the document');
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
  return await evalJson(`(() => {
    const s = getComputedStyle(document.getElementById('__ring_probe'));
    return JSON.stringify({ colour: s.outlineColor, width: s.outlineWidth, style: s.outlineStyle });
  })()`);
}

/* Resolve a declared value the way the cascade would, by giving it to a real
   element inside the real document and reading back what Chrome computed.
 *
 * `specified` separates two cases a computed value cannot: a rule that names
 * no colour at all (`outline-offset: -2px`, or an `outline` shorthand with
 * only a width and a style) computes to `currentColor`, and so does a rule
 * that names a colour Chrome could not resolve. The first inherits the shared
 * ring and is fine; the second is a ring with no knowable colour and is a
 * failure. Chrome's own shorthand parser answers it: reading `style.
 * outlineColor` back off the element returns the empty string when the
 * shorthand did not set it. */
async function resolveDeclared(prop, value) {
  return await evalJson(`(() => {
    const el = document.createElement('div');
    el.style.color = 'rgb(1, 2, 3)';
    document.body.appendChild(el);
    try {
      el.style[${JSON.stringify(prop === 'outline' ? 'outline' : 'outlineColor')}] = ${JSON.stringify(value)};
      const specified = el.style.outlineColor;
      const computed = getComputedStyle(el).outlineColor;
      return JSON.stringify({ specified, computed });
    } finally { el.remove(); }
  })()`);
}

/* ------------------------------------------------------------------ the run

   One navigation per page per theme. Everything resolved on a page is
   resolved while that page is the one loaded; nothing is carried across a
   navigation. */

const findings = [];
const pageFacts = [];

for (const theme of THEMES) {
  for (const page of PAGES) {
    const mine = COLOUR_RULES.filter((r) => page.sheets.includes(r.file) && pageFor(r.file) === page.url);
    const needed = mine.length > 0;
    await load(page.url, theme);

    /* `themeSeen`, never `theme`: the requested theme and the painted one are
       two different facts, and a field name serving both is a comparison that
       cannot fail. */
    const state = await evalJson(`JSON.stringify({
      urlSeen: location.pathname,
      themeSeen: document.documentElement.getAttribute('data-theme'),
      sheets: Array.from(document.styleSheets).map((s) => s.href ? new URL(s.href).pathname : null).filter(Boolean)
    })`);
    const ring = await documentRing();

    pageFacts.push({ page: page.url, theme, ...state, ring, resolvedHere: mine.length });

    if (!needed) continue;
    for (const rule of mine) {
      const got = await resolveDeclared(rule.declaration.prop, rule.declaration.value);
      findings.push({
        file: rule.file, line: rule.line, selector: rule.selector,
        offset: rule.offset, theme,
        specified: got.specified, computed: got.computed,
        ring: ring.colour, ringWidth: ring.width, ringStyle: ring.style,
        pageUsed: page.url
      });
    }
  }
}

/* ------------------------------------------------------------------- report

   Printed before anything is asserted, so a failing run says what it saw
   rather than only that it disagreed. */

const byRule = new Map();
for (const f of findings) {
  const key = f.file + '|' + f.selector;
  if (!byRule.has(key)) {
    byRule.set(key, {
      file: f.file, line: f.line, selector: f.selector, offset: f.offset,
      pageUsed: f.pageUsed, themes: {}
    });
  }
  byRule.get(key).themes[f.theme] = {
    colour: hexOf(f.computed), ring: hexOf(f.ring), raw: f.computed, specified: f.specified
  };
}

const census = [...byRule.values()].map((r) => {
  const themes = {};
  let diverges = false;
  let unresolvable = false;
  for (const theme of THEMES) {
    const t = r.themes[theme];
    if (!t || t.colour === null) unresolvable = true;
    themes[theme] = t ? { colour: t.colour, ring: t.ring } : null;
    if (t && t.colour !== t.ring) diverges = true;
  }
  return { ...r, themes, diverges, unresolvable };
}).sort((a, b) => (a.file + a.selector).localeCompare(b.file + b.selector));

console.log('\n--- focus-ring colour census ------------------------------------');
for (const r of census) {
  const cells = THEMES.map((t) => {
    const v = r.themes[t];
    return `${t} ${v ? v.colour : '?'} (ring ${v ? v.ring : '?'})`;
  }).join('  ');
  const verdict = r.unresolvable ? 'UNRESOLVABLE' : r.diverges ? 'DIVERGES' : 'inherits';
  console.log(`${verdict.padEnd(12)} ${r.file}:${r.line}  ${r.selector}`);
  console.log(`             offset ${r.offset ?? '(shared)'}  resolved on ${r.pageUsed}  ${cells}`);
}

const offsetOnly = FOCUS_RULES.filter((r) => !r.declaration);
console.log(`\n${offsetOnly.length} focus rules move the shared ring without redefining it:`);
for (const r of offsetOnly) {
  console.log(`  ${r.file}:${r.line}  ${r.selector}  outline-offset ${r.offset ?? '(unchanged)'}`);
}

const rings = new Map();
for (const p of pageFacts) rings.set(`${p.theme} ${hexOf(p.ring.colour)}`, (rings.get(`${p.theme} ${hexOf(p.ring.colour)}`) ?? 0) + 1);
console.log('\ndocument-level rings actually in force, per page load:');
for (const [k, n] of [...rings].sort()) console.log(`  ${k}  on ${n} page loads`);

const counts = {
  sheets: SHEETS.length,
  pages: PAGES.length,
  pageLoads: pageFacts.length,
  focusRules: FOCUS_RULES.length,
  colourRules: COLOUR_RULES.length,
  offsetOnlyRules: offsetOnly.length,
  censusRows: census.length,
  inherits: census.filter((r) => !r.diverges && !r.unresolvable).length,
  diverges: census.filter((r) => r.diverges && !r.unresolvable).length,
  unresolvable: census.filter((r) => r.unresolvable).length,
  enumerated: KNOWN_DIVERGENT.length
};
console.log('\ncounts ' + JSON.stringify(counts));
console.log('-----------------------------------------------------------------\n');

/* -------------------------------------------------------------- assertions */

test('the census reached the pages and rules it claims to judge', () => {
  /* Floors, not equalities: a new stylesheet or a new page is ordinary, and
     reddening every pane PR for one is how a guard gets deleted. What a floor
     does catch is the failure this whole file would otherwise share with
     every other sweep here — judging nothing and printing like a clean run. */
  assert.ok(counts.sheets >= 12, `only ${counts.sheets} stylesheets under ops/assets`);
  assert.ok(counts.pages >= 12, `only ${counts.pages} pages under ops/`);
  assert.equal(counts.pageLoads, PAGES.length * THEMES.length);
  assert.ok(counts.focusRules >= 14, `only ${counts.focusRules} focus rules found — the reader is broken`);
  assert.equal(counts.censusRows, counts.colourRules,
    'every colour-declaring rule must have been resolved on a page that loads it');
});

test('every page loaded the stylesheets it declares, under the theme asked for', () => {
  for (const p of pageFacts) {
    const declared = PAGES.find((q) => q.url === p.page).sheets.map((s) => '/' + s);
    assert.equal(p.urlSeen, p.page,
      `${p.page} navigated to ${p.urlSeen} — a redirect resolves tokens in the wrong stylesheet`);
    for (const sheet of declared) {
      assert.ok(p.sheets.includes(sheet), `${p.page} did not load ${sheet}; it loaded ${p.sheets.join(', ')}`);
    }
    /* The media query was emulated to the OPPOSITE of the stored theme, so a
       page that reports the emulated one is a page whose stored theme never
       took -- and every colour resolved on it came out of the wrong half of
       the palette. */
    assert.equal(p.themeSeen, p.theme,
      `${p.page} was asked for ${p.theme} and painted ${p.themeSeen}. ` +
      'Compared against the attribute as written, not folded to a default: ' +
      'a missing attribute must not be readable as the dark theme, or a page ' +
      'where theme.js never ran passes half the sweep.');
  }
});

test('a document-level focus ring is in force on every page, in both themes', () => {
  for (const p of pageFacts) {
    assert.equal(p.ring.style, 'solid',
      `${p.page} (${p.theme}): the forced :focus-visible probe computed outline-style ${p.ring.style}`);
    assert.notEqual(p.ring.width, '0px',
      `${p.page} (${p.theme}): the forced :focus-visible probe took no ring`);
    assert.ok(hexOf(p.ring.colour),
      `${p.page} (${p.theme}): the document ring resolved to ${p.ring.colour}, which is not an opaque colour`);
  }
});

test('every declared ring colour resolves to an opaque colour', () => {
  const bad = census.filter((r) => r.unresolvable);
  assert.deepEqual(bad.map((r) => `${r.file} ${r.selector}`), [],
    'a focus ring whose colour cannot be resolved is a ring no oracle can ever check');
});

test('the census matches the contract written from the stylesheets', () => {
  const got = census.map((r) => ({
    file: r.file, selector: r.selector, offset: r.offset ?? null,
    dark: r.themes.dark.colour, light: r.themes.light.colour
  }));
  const want = EXPECTED.map((r) => ({
    file: r.file, selector: r.selector, offset: r.offset, dark: r.dark, light: r.light
  })).sort((a, b) => (a.file + a.selector).localeCompare(b.file + b.selector));
  assert.deepEqual(got, want,
    'a focus rule appeared, vanished, changed colour or changed offset. All three ' +
    'are the defect this file exists for; update EXPECTED once a human has read ' +
    'the change.');
});

test('every ring that diverges from its page\'s own is enumerated with an issue', () => {
  const enumerated = new Set(KNOWN_DIVERGENT.map((k) => k.file + '|' + k.selector));
  const unenumerated = census
    .filter((r) => r.diverges && !enumerated.has(r.file + '|' + r.selector))
    .map((r) => `${r.file}:${r.line} ${r.selector} — resolves to ` +
      THEMES.map((t) => `${t} ${r.themes[t].colour} against a ${r.themes[t].ring} ring`).join(', '));
  assert.deepEqual(unenumerated, [],
    'this rule redefines the focus ring colour and nothing owns that. Either ' +
    'inherit the shared ring, or file an issue and add it to KNOWN_DIVERGENT.');
});

test('every enumerated exception still reproduces', () => {
  const diverging = new Set(census.filter((r) => r.diverges).map((r) => r.file + '|' + r.selector));
  const present = new Set(census.map((r) => r.file + '|' + r.selector));
  const stale = [];
  for (const k of KNOWN_DIVERGENT) {
    const key = k.file + '|' + k.selector;
    if (!present.has(key)) { stale.push(`${k.file} ${k.selector} — no such rule any more (${k.issue})`); continue; }
    if (!diverging.has(key)) { stale.push(`${k.file} ${k.selector} — no longer diverges; the fix landed, delete this entry (${k.issue})`); }
  }
  assert.deepEqual(stale, [],
    'an exception that no longer reproduces is a claim about a defect that is gone');
});

test('every enumerated exception names one rule and one issue', () => {
  /* An exception with no owner is a silent skip with extra words, and two
     entries for one rule mean one of them can stop reproducing without the
     staleness check noticing. */
  const keys = KNOWN_DIVERGENT.map((k) => k.file + '|' + k.selector);
  assert.deepEqual([...new Set(keys)], keys, 'KNOWN_DIVERGENT names a rule twice');
  for (const k of KNOWN_DIVERGENT) {
    assert.match(k.issue, /^Stadiora\/Aria#\d+$/,
      `the exception for ${k.selector} names ${JSON.stringify(k.issue)}, which is not an issue`);
  }
});

test('the counts are the ones this file claims to produce', () => {
  assert.deepEqual({
    colourRules: counts.colourRules,
    censusRows: counts.censusRows,
    inherits: counts.inherits,
    diverges: counts.diverges,
    unresolvable: counts.unresolvable,
    enumerated: counts.enumerated
  }, {
    colourRules: 8,
    censusRows: 8,
    inherits: 5,
    diverges: 3,
    unresolvable: 0,
    enumerated: 3
  });
});
