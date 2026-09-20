/* Guards one runtime edge on every page of the operations dashboard:
   switching the theme has to leave the page in the state it would have been
   in had it been loaded in that theme.

   The defect this was written for is in ops/assets/aria.js. It resolves every
   chart colour at draw time, out of the CSS custom properties, and the tokens
   move with the theme. A chart is therefore correct only for the theme it was
   drawn in, and syncTheme() closes the gap by calling redrawCharts() after the
   toggle. Delete that one call and every chart keeps the previous theme's
   palette: the strokes stay at the dark #22D3EE on a white surface, nothing
   throws, no token is missing, no shape is unpainted.

   That is not cosmetic. The light palette drops to darker, less saturated
   values precisely because the bright dark ramp fails contrast on white
   (monorepo Stadiora/Aria#10042), so a dark-palette chart on a light surface
   is the AA failure that fix exists to prevent.

   Nothing else in the repository measures it on a real page:

     - scripts/check-ops-shell-v2.mjs stores a theme, RELOADS, and measures the
       fresh page. A freshly loaded page is correct in either theme, because
       the charts were drawn after theme.js had already decided. It never
       toggles. scripts/check-ops-narrow-overflow.mjs does the same: it stores
       a theme and navigates, so it never toggles either.
     - The token and palette checks read :root, which the stylesheet updates on
       the attribute change whether or not a single chart is redrawn.
     - The unpainted-shape check asks whether a shape has any paint at all, not
       whether it has the RIGHT one.
     - Reading ops/assets/aria.js cannot answer it either: the call is one line
       and a grep for it pins the string, not the behaviour.

   One thing does see the deletion: scripts/ops-aria-shell.test.mjs goes red on
   it. What that suite reads back is the presentation attribute the renderer
   wrote, out of a hand-written DOM whose token map the test supplies — not a
   resolved colour on a laid-out page, and not the palette aria.css really
   declares. That half is this file.

   WHAT IS SWEPT. Every pane ops/assets/pane-registry.js declares, plus
   ops/shell-v2.html, which is not a pane: it is the design surface the pane
   remodels are built against and the only page in the repository that draws
   aria.js's charts. Until Stadiora/Aria#10462 this check rendered that one
   page, so nine panes were never theme-checked at all and the pane list is
   read out of the registry here for the same reason the narrow-viewport sweep
   reads it — a pane cannot join the app without joining this sweep, and the
   count that was judged is asserted against the count the registry declares.

   WHAT IS ASSERTED, per page, in both directions, because a redraw wired one
   way round is the same defect wearing a hat:

     1. The two themes paint the page differently at all. Both fresh loads are
        censused and the number of nodes whose paint differs between them has
        to clear a floor. Without this every comparison below is vacuous on a
        page the theme does not reach — the "the input is already in the state
        the code should produce" trap — and a page that stopped resolving its
        tokens would pass silently.
     2. After the real theme button is pressed, every node's resolved paint
        equals the paint the same node carries on a FRESH load of that page in
        the theme the button switched to. A fresh load is correct by
        construction: theme.js has already decided before anything draws. This
        is the whole contract and it is mechanism-blind — it does not care
        whether a colour arrived from a stylesheet rule, a presentation
        attribute or a gradient stop, which is what lets it cover panes that
        paint from CSS classes and aria.js's charts in the same pass.
     3. On the pages that draw aria.js's charts, every chart shape aria.js
        paints from a token holds the pinned value for the theme the button
        switched to. That is assertion 2's job too, by a different route, and
        it is kept because it is the only one that would notice aria.css
        drifting away from the palette this file pins: a page compared against
        itself agrees with itself whatever the palette says.

   Deliberately NOT asserted: that redrawCharts() was called. A spy passes
   while the redraw paints nothing. The only thing that matters is the colour
   that ends up on the shape, so every measurement is getComputedStyle in
   place, in the page that styles it — nothing is cloned or re-parented, which
   would drop every descendant selector that styles these nodes.

   WHAT THIS DOES NOT COVER:

   - **Pseudo-elements.** The census reads getComputedStyle(el) with no second
     argument, so a colour that only ::before or ::after carries is invisible
     here on every page.
   - **Anything below the paint properties listed in PAINT_PROPS.** A theme
     that changed a layout value, an opacity or a filter rather than a colour
     would move nothing this census reads.
   - **A gradient referenced by url(#id).** The reference itself is useless to
     compare — the ids are minted per draw, so a redrawn gradient gets a new
     one — so it is resolved to the stops of the gradient it points at and
     those are compared instead. A gradient that changed in some way its stops
     do not record would not show up.
   - **A page whose DOM differs between the toggled and the fresh load.** Those
     are reported as not comparable rather than passed, so the gap is a red
     check rather than a silent one, but nothing here judges such a page.
   - **The panes' populated states, for People and usage and Cloud costs.**
     They are censused in the state the shared stub's reads produce, the same
     state scripts/check-ops-narrow-overflow.mjs measures them in; see
     scripts/ops-api-stub.mjs.
   - **Any theme beyond the two.** dark and light are what ops/assets/theme.js
     resolves to.

   Usage:  node scripts/check-ops-theme-redraw.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROOF, stub } from './ops-api-stub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'ops/assets/pane-registry.js';

/* Not a pane, and not in the registry: ops/shell-v2.html is the design surface
   the pane remodels are built against, it reads no API, and it is the only
   page that draws aria.js's charts — the shapes assertion 3 is about. Declared
   here as a list rather than a constant so a second showcase page is one line,
   which is the shape Stadiora/Aria#10462 asked for. */
const SHOWCASES = [{
  key: 'design-system',
  url: '/ops/shell-v2.html',
  kind: 'showcase',
  /* The page's own <title>, which is how a showcase page says which page it
     is: it has no data-pane and no shell to set one. A 404 or a renamed file
     fails here rather than being censused. */
  docTitle: 'Design system v2 | Aria Operations',
  /* Bands this page draws and nothing else does. Same job as PROOF does for a
     pane: a page that reached the DOM but drew none of its content would
     otherwise be compared against itself, agree, and pass. */
  proof: ['Preview states', 'Charts', 'Tokens'],
  charts: true,
}];

/* Every token the charts are painted from, with the value each theme writes.
   Pinned as literals rather than read out of aria.css, because an expectation
   derived from the file under test agrees with that file by construction. The
   pins are cross-checked against what the stylesheet actually resolved on the
   loaded page (PINNED TOKENS below), so this file cannot silently drift from
   the palette either.

   The full 33-token palette contract lives in scripts/check-ops-shell-v2.mjs.
   This is the subset ops/assets/aria.js paints with — four series tones and
   the gauge track — and it is a subset on purpose: a token the charts never
   paint from cannot demonstrate a chart failing to repaint.

   Every entry differs between the themes. Asserted at startup: a token that
   held the same value in both would make its shapes' assertions vacuous. */
const CHART_TOKENS = {
  '--cyan': { dark: '#22D3EE', light: '#0891B2' },
  '--violet': { dark: '#A78BFA', light: '#7C3AED' },
  '--emerald': { dark: '#34D399', light: '#059669' },
  '--amber': { dark: '#FBBF24', light: '#B45309' },
  '--line-2': { dark: 'rgba(255, 255, 255, .11)', light: 'rgba(11, 18, 32, .15)' },
};

/* Both directions. Each entry is one whole experiment: the page is loaded in
   `start`, the theme button is clicked once, and `end` is what everything
   afterwards is required to hold. The fresh load in `end` that the toggled
   page is compared against is the OTHER direction's start load, so a page
   costs two loads rather than four. */
const DIRECTIONS = [
  { start: 'dark', end: 'light' },
  { start: 'light', end: 'dark' },
];

/* The paint a node carries, as this check defines paint. Read off
   getComputedStyle, so a value is what the browser resolved rather than what
   any one rule or attribute asked for. */
const PAINT_PROPS = [
  'color', 'backgroundColor', 'backgroundImage',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'outlineColor', 'textDecorationColor', 'caretColor', 'columnRuleColor',
  'accentColor', 'fill', 'stroke', 'stopColor', 'boxShadow',
];

/* The floors below say what "measured something" means. Without them every
   assertion in this file passes on a page that drew nothing at all. */

/* Assertion 1's floor: how much of the page the theme has to reach before the
   rest of the run means anything. Both an absolute number and a share of the
   nodes compared, because a share alone passes on a three-node page and a
   number alone passes on a large page the theme barely touches. The thinnest
   page in this sweep today clears both by an order of magnitude. */
const MIN_THEME_SENSITIVE_NODES = 20;
const MIN_THEME_SENSITIVE_SHARE = 0.25;

/* Assertion 3's floors, and they apply only to the pages that declare charts.
   A pane paints from CSS classes and carries no aria.js chart host at all, so
   requiring hosts of every page would fail nine panes for doing nothing
   wrong. The pages that DO declare charts are asserted to still have them. */
const MIN_HOSTS = 5;
const MIN_PAINTS = 20;

/* A pane drew something rather than nothing. A floor and only a floor — PROOF
   is what says the pane drew ITSELF. */
const MIN_CONTENT_ELEMENTS = 8;

/* The things a shell puts on screen INSTEAD of a pane. Each is a single card
   of a few short lines that repaints from the stylesheet for free, so it would
   sail through every assertion here while proving nothing about the pane it
   stands in for. Any of them ends the page's measurement rather than passing
   it. The strings are the shells' own — the first is in both
   ops/assets/shell-pane-v2.js and ops/assets/shell.js, the second is the v2
   shell's refusal and the third the v1 shell's. */
const REFUSALS = ['Not built yet', 'You do not have access to this pane', 'Owner access only'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* -------------------------------------------------------------- the pages */

/* The pane list, out of the registry rather than out of a second copy of it
   here. ops/assets/pane-registry.js is a browser file: it hands its table to a
   `window` it is passed, so running it in a context holding nothing else is
   the whole of reading it. Anything more — a regex over the source, a literal
   array kept in step by hand — is a second source of truth, which is the thing
   the registry exists to stop. */
function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: REGISTRY });
  const registry = sandbox.window.OpsPaneRegistry;
  if (!registry || !registry.PANES) {
    throw new Error(`${REGISTRY} defined no window.OpsPaneRegistry.PANES`);
  }
  return registry.PANES;
}

const DECLARED = readRegistry();
const PANE_PAGES = Object.keys(DECLARED).map((key) => ({
  key,
  url: '/ops/' + DECLARED[key].file,
  file: DECLARED[key].file,
  kind: 'pane',
  label: DECLARED[key].label,
  question: DECLARED[key].question,
  proof: PROOF[key],
  /* No pane carries an aria.js chart host today; they draw their own SVG and
     colour it with CSS classes, which repaints on the attribute change without
     anyone calling anything. This is a declaration and not a belief: the
     counts block at the end compares it against the hosts the census actually
     found, so a pane that grows charts turns the sweep red rather than
     quietly opting out of assertion 3. */
  charts: false,
}));
const PAGES = [...PANE_PAGES, ...SHOWCASES];

/* Everything below stops the run before a browser is started, because each one
   means the sweep about to happen would not be the sweep this file claims. */
const startupFailures = [];
if (PANE_PAGES.length === 0) {
  startupFailures.push(`${REGISTRY} declares no panes, so there is nothing to sweep.`);
}
for (const page of PAGES) {
  const rel = page.url.replace(/^[/]/, '');
  if (!fs.existsSync(path.join(ROOT, rel))) {
    startupFailures.push(`${page.key} is declared as ${page.url}, which is not a file in ` +
      'this repository.');
  }
  if (!Array.isArray(page.proof) || page.proof.length === 0 || page.proof.some((s) => !s)) {
    startupFailures.push(`${page.key} has no marker that only its drawn state puts on the ` +
      'page, so a failure card or an empty shell would be compared against itself, agree, ' +
      'and pass. Panes take theirs from PROOF in scripts/ops-api-stub.mjs.');
  }
}
for (const [name, values] of Object.entries(CHART_TOKENS)) {
  if (rgba(values.dark) === null || rgba(values.light) === null) {
    startupFailures.push(`${name} is pinned to a value this check cannot parse ` +
      `(${values.dark} / ${values.light})`);
  } else if (rgba(values.dark) === rgba(values.light)) {
    startupFailures.push(`${name} is pinned to the same colour in both themes, so every ` +
      'shape painted from it would assert nothing');
  }
}
if (startupFailures.length) {
  console.error('\nThis check cannot run:\n');
  for (const f of startupFailures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

/* ------------------------------------------------------------------ colour */

/* Canonical "r,g,b,a" for a colour written as a hex literal (how the palette
   writes it), as rgb()/rgba() (how the palette writes the translucent ones),
   or as whatever Chrome hands back from getComputedStyle — which is rgb() or
   rgba() today and the space-separated rgb(r g b / a) form in newer builds.
   Returns null for anything it cannot read, and a null is a failure rather
   than a skip: silently dropping a colour it cannot parse is how this check
   would end up measuring nothing. */
function rgba(value) {
  const v = String(value == null ? '' : value).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1`;
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return `${r},${g},${b},1`;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const raw = m[4];
    const a = raw === undefined ? 1
      : raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    return `${Math.round(Number(m[1]))},${Math.round(Number(m[2]))},` +
      `${Math.round(Number(m[3]))},${Number(a.toFixed(3))}`;
  }
  return null;
}

/* Which token, if any, holds this colour in this theme. */
function tokenHolding(theme, canonical) {
  return Object.keys(CHART_TOKENS)
    .find((name) => rgba(CHART_TOKENS[name][theme]) === canonical) || null;
}

/* ------------------------------------------------------------------ server */

/* The real pages, and the operations API answered from the shared fixture.
   A pane whose read comes back empty draws a failure card, and a failure card
   repaints from the stylesheet perfectly — it would pass every assertion in
   this file while standing in for a pane that was never drawn. */
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

/* --------------------------------------------------------------------- CDP */

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
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
      return;
    }
    for (const l of listeners) l(m);
    seen.add(m.method);
    for (const w of waiters.splice(0)) w(m.method);
  };
  return {
    ready: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    close: () => ws.close(),
    on(fn) { listeners.push(fn); },
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
    reset() { seen.delete('Page.loadEventFired'); },
  };
}

/* ------------------------------------------------------------------ probes */

/* Separator between one node's paint values. U+0001 rather than a comma
   because several of these properties contain commas, spaces and slashes of
   their own — rgba(), box-shadow lists, gradient stops — and a separator that
   can appear inside a value silently re-aligns the columns and compares
   background-image against border-colour. */
const PAINT_SEP = '\u0001';

/* One round trip per census. Everything the run needs off a loaded page:
   which page it says it is, whether it drew itself, the paint on every node,
   and the chart paints assertion 3 is about.

   Measured in place. Nothing is cloned or re-parented, so every descendant
   selector that styles these nodes still applies — a clone appended to
   document.body drops them all and is measured at the 16px body default.

   Note on backslashes: this is a template literal, so every escape meant for
   the browser's regex has to survive Node first. A lone \s here reaches Chrome
   as a plain "s". The doubled ones below are deliberate. */
const censusProbe = (page) => `(() => {
  const PROPS = ${JSON.stringify(PAINT_PROPS)};
  const SEP = String.fromCharCode(1);

  /* A gradient reference is useless to compare: ops/assets/aria.js mints a new
     id every time it draws, so a gradient that repainted perfectly still reads
     as url(#ariag23) against url(#ariag13). Resolve it to the stops it points
     at and compare those, which is stricter than dropping it — a gradient left
     holding the previous theme's stops is exactly the defect this file is for.
     Character classes rather than backslash escapes so the pattern survives
     the template literal above unchanged. */
  const deref = (v) => String(v == null ? '' : v)
    .replace(/url[(]["']?#([A-Za-z0-9_.:-]+)["']?[)]/g, (whole, id) => {
      const g = document.getElementById(id);
      if (!g) return 'gradient(gone:' + id + ')';
      return 'gradient[' + Array.prototype.map.call(g.children, (stop) =>
        stop.getAttribute('offset') + '=' + stop.getAttribute('stop-color') +
        '@' + (stop.getAttribute('stop-opacity') || '1')).join(',') + ']';
    });

  const nodes = [];
  const walk = (el, key) => {
    const cs = getComputedStyle(el);
    const paint = [];
    for (let i = 0; i < PROPS.length; i++) paint.push(deref(cs[PROPS[i]]));
    nodes.push({
      k: key,
      t: el.tagName,
      c: el.getAttribute('class') || '',
      p: paint.join(SEP)
    });
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i], key + '/' + i + kids[i].tagName);
  };
  walk(document.documentElement, 'html');

  /* ---------------------------------------------- aria.js's chart paints */

  /* Every literal colour ops/assets/aria.js painted onto a chart, read back
     the way the browser resolved it. Scoped two ways, and both matter:

       - to the chart hosts, so the rail icons are out. Those are
         stroke="currentColor", which follows the theme through inherited
         \`color\` with no script involved, and counting them would let a page
         with no working redraw at all look like it repainted. [data-ribbon] is
         outside this list as well, for a different reason: drawRibbon writes
         only a column height and the colour comes from a stylesheet rule, so
         there is no token-resolved paint there to read.
       - to elements that CARRY the attribute, so the CSS-painted parts of a
         chart are out too. A .gridline takes its stroke from aria.css and a
         .axis label its fill, and both re-colour on the attribute change for
         free. Only the presentation attributes aria.js writes from a token can
         demonstrate the redraw.

     Everything this scoping leaves out is inside the node census above, which
     is mechanism-blind: the ribbon columns, the gridlines and the axis labels
     are all compared against a fresh load like every other node on the page.
     What they cannot do is tell a PINNED palette value from a drifted one,
     which is the whole of why this narrower probe is still here.

     Within the scope the value read is the COMPUTED one, not the attribute, so
     a stylesheet rule that overrode the attribute would be measured rather
     than missed. */
  const HOSTS = '[data-spark], [data-area], [data-bars], [data-gauge]';
  const CHART_PROPS = { stroke: 'stroke', fill: 'fill', 'stop-color': 'stopColor' };
  const dead = (v) => !v || v === 'none' || v === 'transparent' ||
    v === 'rgba(0, 0, 0, 0)' || v.startsWith('url(');

  const hosts = [...document.querySelectorAll(HOSTS)];
  const paints = [];
  hosts.forEach((host, hi) => {
    [...host.querySelectorAll('*')].forEach((el, ni) => {
      for (const attr of Object.keys(CHART_PROPS)) {
        if (!el.hasAttribute(attr)) continue;
        const computed = String(getComputedStyle(el)[CHART_PROPS[attr]] || '').trim();
        if (dead(computed)) continue;
        paints.push({
          key: 'chart' + hi + '|' + ni + '|' + el.tagName + '|' + attr,
          attr: el.getAttribute(attr),
          value: computed
        });
      }
    });
  });

  const root = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const name of ${JSON.stringify(Object.keys(CHART_TOKENS))}) {
    tokens[name] = root.getPropertyValue(name).trim();
  }

  /* ------------------------------------------------- did this page draw? */

  const clean = (node) => ((node && node.textContent) || '').replace(/[\\s]+/g, ' ').trim();
  const content = document.getElementById('content');
  const contentText = content ? clean(content) : '';

  return JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    /* Two spellings because there are two shells: ops/assets/shell-pane-v2.js
       boots from data-pane and the v1 ops/assets/shell.js from data-page, and
       Cloud costs is the one pane still on the v1 one. Reading only the v2
       spelling drops that pane out of the judged count silently. */
    pane: document.body.getAttribute('data-pane') || document.body.getAttribute('data-page'),
    docTitle: document.title,
    gate: document.body.className,
    /* Same two-shell split again: the v2 top bar calls the pane's question
       .page-sub and the v1 one calls it .page-question. Both render the
       registry's own sentence, which is what is compared. */
    title: clean(document.querySelector('.page-title')),
    sub: clean(document.querySelector('.page-sub, .page-question')),
    contentElements: content ? content.querySelectorAll('*').length : -1,
    /* Computed in the browser against the UNTRUNCATED text, and reported as
       what is MISSING rather than as a boolean, so a failure can name the
       marker it did not find. The excerpt below is for the report only. */
    missing: ${JSON.stringify(page.proof)}.filter((m) => contentText.indexOf(m) === -1),
    refusal: ${JSON.stringify(REFUSALS)}.find((r) => contentText.indexOf(r) !== -1) || null,
    excerpt: contentText.slice(0, 160),
    hosts: hosts.length,
    tokens,
    paints,
    nodes
  });
})()`;

/* The real control, clicked the way an operator clicks it. Nothing here calls
   OpsTheme or Aria directly: the edge under test is the one that runs when the
   button in the top bar is pressed.

   Two ids because there are two shells, the same split this file already reads
   twice over for data-pane / data-page and .page-sub / .page-question.
   ops/assets/aria.js builds the v2 top bar and its button is #themeBtn; the v1
   ops/assets/shell.js builds its own and calls it #themeToggle, and Cloud
   costs is the one pane still on that shell. Knowing only the v2 spelling, the
   sweep found no button there at all, which is what the previous commit went
   red on. */
const CLICK_PROBE = `(() => {
  const btn = document.querySelector('#themeBtn, #themeToggle');
  if (!btn) return JSON.stringify({ clicked: false });
  btn.click();
  return JSON.stringify({
    clicked: true,
    id: btn.id,
    label: btn.getAttribute('aria-label'),
    theme: document.documentElement.getAttribute('data-theme')
  });
})()`;

/* ------------------------------------------------------------- comparison */

/* Two censuses of the same page, compared node for node.

   Keys are structural paths, so a DOM that differs between the two loads
   produces keys on one side and not the other. Those are reported rather than
   dropped: a comparison silently restricted to the nodes both sides happen to
   have is how a check ends up agreeing about nothing. */
function compare(a, b) {
  const left = new Map(a.nodes.map((n) => [n.k, n]));
  const right = new Map(b.nodes.map((n) => [n.k, n]));
  const onlyLeft = [...left.keys()].filter((k) => !right.has(k));
  const onlyRight = [...right.keys()].filter((k) => !left.has(k));
  const differing = [];
  let common = 0;
  for (const [key, l] of left) {
    const r = right.get(key);
    if (!r) continue;
    common += 1;
    if (l.p === r.p) continue;
    const lv = l.p.split(PAINT_SEP);
    const rv = r.p.split(PAINT_SEP);
    differing.push({
      key,
      tag: l.t.toLowerCase(),
      cls: l.c,
      props: PAINT_PROPS
        .map((prop, i) => ({ prop, left: lv[i], right: rv[i] }))
        .filter((d) => d.left !== d.right),
    });
  }
  return { onlyLeft, onlyRight, common, differing };
}

const describe = (diffs, limit = 4) => {
  const shown = diffs.slice(0, limit).map((d) =>
    `${d.tag}${d.cls ? '.' + d.cls.split(' ').join('.') : ''} at ${d.key} — ` +
    d.props.map((p) => `${p.prop} is ${p.left}, fresh is ${p.right}`).join('; '));
  const rest = diffs.length - shown.length;
  return shown.join('\n      ') + (rest > 0 ? `\n      and ${rest} more` : '');
};

/* --------------------------------------------------------------------- run */

const failures = [];
const note = (m) => console.log('ok  ' + m);
/* Pages the browser confirmed it had drawn and this run compared, by the
   page's own data-pane or <title> rather than by the list navigated with. A
   page that 404s, names another pane or never reaches its ready gate is not in
   here, which is what makes the count at the bottom worth asserting. */
const judged = new Set();
const withHosts = new Set();
let censuses = 0;

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const origin = `http://127.0.0.1:${PORT}`;

/* Kept inside the repository rather than in a temp directory so the path is
   the same on a developer machine and on the runner, and removed in the
   finally below once Chrome has actually exited — see stopBrowser(), which is
   what makes "removed" true rather than aspirational. */
const profile = fs.mkdtempSync(path.join(ROOT, '.ops-theme-redraw-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank',
], { stdio: 'ignore' });

/* Chrome has to be GONE before its profile is deleted. browser.kill() only
   sends SIGTERM and returns, and Chrome re-creates Default, Local State and
   VariationsSeedV2 while it shuts down — after an rmSync that ran immediately
   has already succeeded. That is why the catch in the finally never fired: the
   removal worked and the directory came back, one ~100 KB .ops-theme-redraw-*
   per run on a developer machine, forever. A CI runner is ephemeral, so
   nothing there ever showed it.

   The wait is bounded, because a wedged Chrome that never acknowledges SIGTERM
   must not hang the guard: SIGTERM, then SIGKILL after KILL_GRACE_MS, then
   give up after a further KILL_GRACE_MS. On expiry stopBrowser() returns
   false, the finally attempts the removal anyway and warns that the profile
   may survive the run — which is what the .gitignore entry for these
   directories covers. Either way the exit status and every assertion above it
   are untouched. */
const KILL_GRACE_MS = 5000;

function exitsWithin(ms) {
  return new Promise((resolve) => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { browser.off('exit', onExit); resolve(false); }, ms);
    browser.once('exit', onExit);
  });
}

async function stopBrowser() {
  const gone = () => browser.exitCode !== null || browser.signalCode !== null;
  if (gone()) return true;
  const terminated = exitsWithin(KILL_GRACE_MS);
  browser.kill();
  if (await terminated) return true;
  if (gone()) return true;
  const killed = exitsWithin(KILL_GRACE_MS);
  browser.kill('SIGKILL');
  return (await killed) || gone();
}

let cdp;
let problems = [];
let initScript = null;

/* The theme and the API base have to be in storage before the document's first
   script runs, so they are registered as an on-new-document script;
   Runtime.evaluate would write into the document already loaded, which at the
   start is about:blank. Emulated media is set to the OPPOSITE theme, because
   theme.js falls back to prefers-color-scheme and matching them would make a
   failed storage write look like a success. */
async function setTheme(theme) {
  if (initScript) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  }
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try {' +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      "localStorage.setItem('ops-theme', " + JSON.stringify(theme) + ');' +
      '} catch (e) {}',
  });
  initScript = res.identifier;
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }],
  });
}

/* How long a pane is given to finish its reads and draw. Every pane here is a
   read or two against a stub on loopback. */
const SETTLE_MS = 2500;

async function load(url) {
  problems = [];
  cdp.reset();
  await cdp.send('Page.navigate', { url });
  await cdp.once('Page.loadEventFired');
  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'probe threw');
  }
  return JSON.parse(res.result.value);
}

/* Everything that has to be true before a census is worth comparing. An empty
   page, a refusal card and a pane's own failure card all repaint from the
   stylesheet perfectly, so each of them would agree with a fresh load of
   itself and pass. Returns the reason it is not measurable, or null. */
function unmeasurable(page, theme, seen) {
  if (seen.theme !== theme) {
    return `the page loaded with data-theme="${seen.theme}", so the experiment never ` +
      `started in the theme it says it did`;
  }
  if (page.kind === 'pane') {
    if (seen.pane !== page.key) {
      return seen.pane
        ? `the page says it is pane "${seen.pane}", not "${page.key}", so ${REGISTRY} points ` +
          'this pane at a file that belongs to another one'
        : `the page names no pane at all, so neither shell booted it and ${REGISTRY} points ` +
          'this pane at a page that is not one';
    }
    if (seen.gate !== 'is-ready') {
      return `the shell never reached its ready gate — body is "${seen.gate}". Nothing was ` +
        'drawn to compare.';
    }
    if (seen.title !== page.label || seen.sub !== page.question) {
      return `the top bar reads ${JSON.stringify(seen.title)} / ${JSON.stringify(seen.sub)}, ` +
        `and ${REGISTRY} declares ${JSON.stringify(page.label)} / ` +
        JSON.stringify(page.question);
    }
  } else if (seen.docTitle !== page.docTitle) {
    return `the page title is ${JSON.stringify(seen.docTitle)}, not ` +
      `${JSON.stringify(page.docTitle)}, so this is not the page that was asked for`;
  }
  if (seen.refusal) {
    return `the shell drew "${seen.refusal}" instead of the page, which repaints from the ` +
      'stylesheet for free and proves nothing about the page it stands in for';
  }
  if (seen.contentElements < MIN_CONTENT_ELEMENTS) {
    return `#content holds ${seen.contentElements} elements, under the floor of ` +
      `${MIN_CONTENT_ELEMENTS}. The page did not draw.`;
  }
  if (seen.missing.length) {
    return `#content holds ${seen.contentElements} elements but not ` +
      `${seen.missing.map((m) => JSON.stringify(m)).join(' or ')}, which only this page's ` +
      `drawn state puts on it — it starts ${JSON.stringify(seen.excerpt)}`;
  }
  if (page.charts) {
    const absent = paletteMissing(seen.tokens);
    if (absent.length) {
      return `this page declares charts but resolves no value for ${absent.join(', ')}, so ` +
        'the palette the charts are painted from is not on it';
    }
    if (seen.hosts < MIN_HOSTS) {
      return `${seen.hosts} chart host(s) on the page, expected at least ${MIN_HOSTS}, so ` +
        'the chart assertions below measured almost nothing';
    }
    if (seen.paints.length < MIN_PAINTS) {
      return `the charts reached the page with ${seen.paints.length} resolved paint(s), ` +
        `expected at least ${MIN_PAINTS}, so the chart assertions below measured almost ` +
        'nothing';
    }
  }
  return null;
}

/* What this file pins against what the stylesheet resolved. The chart
   assertion compares against the pins, so a pin that had drifted from aria.css
   would quietly move the target; this is the line that stops it. Checked for
   whichever theme is loaded, and again for the other one after the switch,
   because a check that only ever validated the start theme reports a drifted
   end pin as "the chart did not follow the theme" — the wrong diagnosis for
   the wrong file.

   Which pages carry the chart palette is read off the page rather than listed
   here. ops/assets/aria.css declares these five and ops/assets/ops.css does
   not, so the one pane still on the v1 design system resolves none of them and
   pinning it to a palette its stylesheet never declares would fail it for
   being what it is. The state that is NOT tolerated is the one in between: a
   page that resolves some of them and not others has lost part of the palette,
   which is a stylesheet defect and reported as one. A page that declares
   charts has to resolve all five, so aria.css dropping the lot cannot hide
   here either. */
const drift = (theme, tokens) => {
  const names = Object.keys(CHART_TOKENS);
  const resolved = names.filter((name) => tokens[name]);
  if (resolved.length === 0) return [];
  if (resolved.length !== names.length) {
    return [`this page resolves ${resolved.join(', ')} but not ` +
      `${names.filter((n) => !tokens[n]).join(', ')}, so it carries part of the chart ` +
      'palette and not the rest'];
  }
  return names
    .filter((name) => rgba(tokens[name]) !== rgba(CHART_TOKENS[name][theme]))
    .map((name) => `${name} resolves to ${tokens[name]} in ${theme}, but this check pins it ` +
      `to ${CHART_TOKENS[name][theme]}`);
};

/* A page that declares charts has to carry the whole palette they are painted
   from; without this the clause above would let a chart page that resolved
   none of the five through on the "no chart palette here" branch. */
const paletteMissing = (tokens) =>
  Object.keys(CHART_TOKENS).filter((name) => !tokens[name]);

/* Assertion 3, for one direction of one page. Only the pages that declare
   charts reach the floors above; a page with no aria.js chart host has nothing
   here to assert and is covered by the census comparison instead. */
function checkChartPaints(page, where, start, end, before, after) {
  const problemsFound = [];
  const expected = new Map();
  const tokensSeen = new Set();
  for (const p of before.paints) {
    const canonical = rgba(p.value);
    if (canonical === null) {
      problemsFound.push(`${where}: ${p.key} resolved to ${p.value}, which this check cannot ` +
        'read as a colour');
      continue;
    }
    const token = tokenHolding(start, canonical);
    if (!token) {
      problemsFound.push(`${where}: ${p.key} was painted ${p.attr} and resolved to ` +
        `${p.value}, which is not a value the ${start} palette writes for any token the ` +
        'charts use');
      continue;
    }
    tokensSeen.add(token);
    expected.set(p.key, { token, want: CHART_TOKENS[token][end], was: p.value });
  }
  if (problemsFound.length) return { problems: problemsFound, compared: 0 };

  /* On a page that declares charts, the paints have to be PINNED ones and not
     merely present: a chart that still draws but has stopped resolving its
     colours from the palette would otherwise shrink this set to nothing and
     leave the comparison below asserting over an empty map. A pane declares no
     charts and legitimately pins none. */
  if (page.charts && expected.size < MIN_PAINTS) {
    problemsFound.push(`${where}: only ${expected.size} chart paint(s) were pinned to a ` +
      `${start} token, expected at least ${MIN_PAINTS}`);
    return { problems: problemsFound, compared: 0 };
  }

  const missingTokens = Object.keys(CHART_TOKENS).filter((t) => !tokensSeen.has(t));
  if (page.charts && missingTokens.length) {
    problemsFound.push(`${where}: nothing on the page is painted from ` +
      `${missingTokens.join(', ')}, so those tokens assert nothing. Either a chart stopped ` +
      'drawing or it stopped using that tone.');
    return { problems: problemsFound, compared: 0 };
  }

  const seenAfter = new Map(after.paints.map((p) => [p.key, p]));
  const stale = [];
  for (const [key, want] of expected) {
    const got = seenAfter.get(key);
    if (!got) {
      problemsFound.push(`${where}: ${key} was painted before the switch and is gone after ` +
        'it, so the two measurements are not comparable');
      continue;
    }
    if (rgba(got.value) !== rgba(want.want)) {
      stale.push(`${key} holds ${got.value} (attribute ${got.attr}); ${want.token} is ` +
        `${want.want} in ${end} and ${want.was} in ${start}`);
    }
  }
  if (stale.length) {
    const shown = stale.slice(0, 6);
    const rest = stale.length - shown.length;
    problemsFound.push(`${where}: ${stale.length} of ${expected.size} chart paint(s) did not ` +
      `follow the theme — ${shown.join('; ')}${rest ? `; and ${rest} more` : ''}. Chart ` +
      'colours are resolved at draw time, so a chart is only correct for the theme it was ' +
      'drawn in; syncTheme() in ops/assets/aria.js has to redraw after the toggle. A ' +
      'dark-palette chart left on a light surface is the WCAG AA failure monorepo ' +
      'Stadiora/Aria#10042 fixed the palette to prevent.');
  }
  return { problems: problemsFound, compared: expected.size };
}

try {
  const cdpPort = await devtoolsPort(profile);
  const target = await devtools(cdpPort, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push('console.error: ' + m.params.args.map((a) => a.description || a.value).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description
        || m.params.exceptionDetails.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.push('browser: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });

  for (const page of PAGES) {
    /* Two loads per page, four censuses. The fresh load one direction is
       compared against is the other direction's start load, which is what
       keeps this at two navigations rather than four. */
    const fresh = {};
    const toggled = {};
    const probe = censusProbe(page);
    let broke = false;

    for (const { start, end } of DIRECTIONS) {
      const where = `${page.key} (${page.url}) ${start} -> ${end}`;
      await setTheme(start);
      await load(origin + page.url);
      if (problems.length) {
        failures.push(`${where} raised on load:\n      ` + problems.join('\n      '));
        broke = true;
        break;
      }
      /* Reported once, at the moment it happened. `problems` is cleared per
         load, so without this line every load-time error is still in the array
         when the post-switch check reads it and gets reported a second time as
         if the theme change had raised it — the same failure printed twice,
         the second copy naming the wrong moment and sending whoever reads the
         log to the wrong file. From here on the array holds only what arrived
         after the page had settled: the click and the redraw it triggers. */
      problems = [];

      const before = await evaluate(probe);
      censuses += 1;
      const why = unmeasurable(page, start, before);
      if (why) {
        failures.push(`${where}: ${why}`);
        broke = true;
        break;
      }
      if (before.hosts >= MIN_HOSTS) withHosts.add(page.key);

      const drifted = drift(start, before.tokens);
      if (drifted.length) {
        failures.push(`${where}: aria.css and this check disagree — ${drifted.join('; ')}. ` +
          'Reconcile with the palette contract in scripts/check-ops-shell-v2.mjs before ' +
          'trusting anything below.');
        broke = true;
        break;
      }
      fresh[start] = before;

      const clicked = await evaluate(CLICK_PROBE);
      if (!clicked.clicked) {
        failures.push(`${where}: there is no theme button in the top bar to click`);
        broke = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));

      const after = await evaluate(probe);
      censuses += 1;
      if (after.theme !== end) {
        failures.push(`${where}: clicking the theme button left data-theme="${after.theme}", ` +
          `expected ${end}, so the page was never asked to change`);
        broke = true;
        break;
      }
      if (problems.length) {
        failures.push(`${where} raised on the theme change:\n      ` + problems.join('\n      '));
      }
      const driftedAfter = drift(end, after.tokens);
      if (driftedAfter.length) {
        failures.push(`${where}: aria.css and this check disagree — ` +
          `${driftedAfter.join('; ')}. Reconcile with the palette contract in ` +
          'scripts/check-ops-shell-v2.mjs; until then the comparison below is against the ' +
          'wrong target, not against a page that failed to repaint.');
        broke = true;
        break;
      }
      toggled[end] = after;
    }
    if (broke) continue;

    /* ------------------------------- 1. the theme reaches this page at all */
    const between = compare(fresh.dark, fresh.light);
    if (between.onlyLeft.length || between.onlyRight.length) {
      failures.push(`${page.key} (${page.url}): the dark and light loads drew different DOMs ` +
        `— ${between.onlyLeft.length} node(s) only in dark, ${between.onlyRight.length} only ` +
        'in light — so nothing on this page can be compared against a fresh load of it.');
      continue;
    }
    const floor = Math.max(MIN_THEME_SENSITIVE_NODES,
      Math.ceil(between.common * MIN_THEME_SENSITIVE_SHARE));
    if (between.differing.length < floor) {
      failures.push(`${page.key} (${page.url}): only ${between.differing.length} of ` +
        `${between.common} nodes are painted differently in the two themes, under the floor ` +
        `of ${floor}. Everything else this check asserts about this page compares it against ` +
        'a load of itself, so a page the theme does not reach agrees with itself and passes.');
      continue;
    }

    /* ----------------- 2. the toggled page equals the freshly loaded one */
    let sound = true;
    for (const { start, end } of DIRECTIONS) {
      const where = `${page.key} (${page.url}) ${start} -> ${end}`;
      const diff = compare(toggled[end], fresh[end]);
      if (diff.onlyLeft.length || diff.onlyRight.length) {
        failures.push(`${where}: the toggled page and a fresh ${end} load of it hold ` +
          `different DOMs — ${diff.onlyLeft.length} node(s) only after the toggle, ` +
          `${diff.onlyRight.length} only on the fresh load — so the two are not comparable.`);
        sound = false;
        continue;
      }
      if (diff.differing.length) {
        failures.push(`${where}: ${diff.differing.length} of ${diff.common} nodes hold a ` +
          `different paint after the theme button than they do on a page loaded in ${end}:\n` +
          `      ${describe(diff.differing)}\n` +
          '    Colours resolved at draw time are only correct for the theme they were ' +
          'resolved in; a page has to repaint everything it painted itself. A dark-palette ' +
          'chart left on a light surface is the WCAG AA failure monorepo Stadiora/Aria#10042 ' +
          'fixed the palette to prevent.');
        sound = false;
        continue;
      }
      note(`${where}: all ${diff.common} nodes hold the paint a fresh ${end} load holds ` +
        `(${between.differing.length} of them differ between the themes)`);

      /* ------------------------- 3. the pinned palette, on the chart pages */
      const chart = checkChartPaints(page, where, start, end, fresh[start], toggled[end]);
      if (chart.problems.length) {
        failures.push(...chart.problems);
        sound = false;
        continue;
      }
      if (chart.compared) {
        note(`${where}: ${chart.compared} chart paint(s) aria.js resolved from a token moved ` +
          `to the pinned ${end} palette`);
      }
    }
    if (sound) judged.add(page.kind === 'pane' ? fresh.dark.pane : fresh.dark.docTitle);
  }
} finally {
  if (cdp) cdp.close();
  const stopped = await stopBrowser();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  if (!stopped) {
    console.error(`\n  ! Chrome did not exit within ${KILL_GRACE_MS * 2}ms of being asked to. ` +
      `${path.basename(profile)} may survive this run; it is git-ignored, delete it by hand.`);
  }
}

/* The sweep's own size, derived from the run rather than typed into a sentence
   that then goes stale. A sweep that quietly stopped visiting pages — a
   registry that failed to load, a loop that threw halfway, a page list that
   shrank back to the one page this check started life with — would otherwise
   report every page it did reach as repainting and exit 0 on a page count
   nobody looked at.

   deepStrictEqual rather than a sequence of >= comparisons so that a number
   drifting in EITHER direction is a failure: a page silently added to the
   sweep without being declared is as wrong as one silently dropped. */
const counts = {
  pages: PAGES.length,
  panes: PANE_PAGES.length,
  showcases: SHOWCASES.length,
  judged: judged.size,
  censuses,
  chartPages: withHosts.size,
};
const expectedCounts = {
  pages: Object.keys(DECLARED).length + SHOWCASES.length,
  panes: Object.keys(DECLARED).length,
  showcases: SHOWCASES.length,
  judged: PAGES.length,
  censuses: PAGES.length * DIRECTIONS.length * 2,
  chartPages: PAGES.filter((p) => p.charts).length,
};
console.log('\ncounts ' + JSON.stringify(counts));
try {
  assert.deepStrictEqual(counts, expectedCounts);
} catch {
  const missed = PAGES.map((p) => p.key)
    .filter((k) => !judged.has(k) && !judged.has(PAGES.find((p) => p.key === k).docTitle));
  failures.push('this run is not the sweep this check claims to be: ' +
    `${JSON.stringify(counts)} against ${JSON.stringify(expectedCounts)}` +
    (missed.length ? `. Never judged: ${missed.join(', ')}.` : '.'));
}

if (failures.length) {
  console.error('\nThe theme-change to repaint edge failed:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log(`\nEvery one of the ${counts.judged} pages this sweep declares — every pane ` +
  `${REGISTRY} declares, plus ${SHOWCASES.map((s) => s.url).join(', ')} — holds the paint a ` +
  'fresh load holds after the theme button is pressed, in both directions.');
process.exit(0);
