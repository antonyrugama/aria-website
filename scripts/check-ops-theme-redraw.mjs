/* Guards one runtime edge: switching the theme has to repaint the charts.

   ops/assets/aria.js resolves every chart colour at draw time, out of the CSS
   custom properties, and the tokens move with the theme. A chart is therefore
   correct only for the theme it was drawn in, and syncTheme() closes the gap by
   calling redrawCharts() after the toggle. Delete that one call and every chart
   keeps the previous theme's palette: the strokes stay at the dark #22D3EE on a
   white surface, nothing throws, no token is missing, no shape is unpainted.

   That is not cosmetic. The light palette drops to darker, less saturated
   values precisely because the bright dark ramp fails contrast on white
   (monorepo Stadiora/Aria#10042), so a dark-palette chart on a light surface is
   the AA failure that fix exists to prevent.

   Nothing else in the repository can see it:

     - scripts/check-ops-shell-v2.mjs stores a theme, RELOADS, and measures the
       fresh page. A freshly loaded page is correct in either theme, because the
       charts were drawn after theme.js had already decided. It never toggles.
     - The token and palette checks read :root, which the stylesheet updates on
       the attribute change whether or not a single chart is redrawn.
     - The unpainted-shape check asks whether a shape has any paint at all, not
       whether it has the RIGHT one.
     - Reading ops/assets/aria.js cannot answer it either: the call is one line
       and a grep for it pins the string, not the behaviour.

   So this drives a real browser, draws the page in one theme, clicks the real
   theme button in the top bar, and asserts the resolved paint on every chart
   shape now holds the OTHER theme's pinned value. Both directions, because a
   redraw wired one way round is the same defect wearing a hat, and an assertion
   that only runs dark -> light cannot see it.

   Deliberately NOT asserted here: that redrawCharts() was called. A spy passes
   while the redraw paints nothing. The only thing that matters is the colour
   that ends up on the shape, so the measurement is getComputedStyle on the
   shape, in place, in the page that styles it.

   Usage:  node scripts/check-ops-theme-redraw.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';

/* Every token the charts on shell-v2.html are painted from, with the value each
   theme writes. Pinned as literals rather than read out of aria.css, because an
   expectation derived from the file under test agrees with that file by
   construction. The pins are cross-checked against what the stylesheet actually
   resolved on the loaded page (PINNED TOKENS below), so this file cannot
   silently drift from the palette either.

   The full 33-token palette contract lives in scripts/check-ops-shell-v2.mjs.
   This is the subset ops/assets/aria.js paints with on this page — four series
   tones and the gauge track — and it is a subset on purpose: a token the charts
   never paint from cannot demonstrate a chart failing to repaint.

   Every entry differs between the themes. Asserted at startup: a token that
   held the same value in both would make its shapes' assertions vacuous, which
   is the "the input is already in the state the code should produce" trap. */
const CHART_TOKENS = {
  '--cyan': { dark: '#22D3EE', light: '#0891B2' },
  '--violet': { dark: '#A78BFA', light: '#7C3AED' },
  '--emerald': { dark: '#34D399', light: '#059669' },
  '--amber': { dark: '#FBBF24', light: '#B45309' },
  '--line-2': { dark: 'rgba(255, 255, 255, .11)', light: 'rgba(11, 18, 32, .15)' },
};

/* Both directions. Each entry is one whole experiment: load in `start`, click
   the theme button once, and require `end` on every chart shape. */
const DIRECTIONS = [
  { start: 'dark', end: 'light' },
  { start: 'light', end: 'dark' },
];

/* The floors below say what "measured something" means. Without them every
   assertion in this file passes on a page that drew no charts at all. */
const MIN_HOSTS = 5;
const MIN_PAINTS = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
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

/* Every literal colour ops/assets/aria.js painted onto a chart, read back the
   way the browser resolved it.
 
   Scoped two ways, and both matter:

     - to the chart hosts, so the rail icons are out. Those are
       stroke="currentColor", which follows the theme through inherited `color`
       with no script involved, and counting them would let a page with no
       working redraw at all look like it repainted.
     - to elements that CARRY the attribute, so the CSS-painted parts of a chart
       are out too. A .gridline takes its stroke from aria.css and a .axis label
       its fill, and both re-colour on the attribute change for free. Only the
       presentation attributes aria.js writes from a token can demonstrate the
       redraw.

   Within that scope the value read is the COMPUTED one, not the attribute, so
   a stylesheet rule that overrode the attribute would be measured rather than
   missed. Measured in place: nothing is cloned or re-parented, so every
   descendant selector that styles these nodes still applies. */
const PAINT_PROBE = `(() => {
  const HOSTS = '[data-spark], [data-area], [data-bars], [data-gauge]';
  const PROPS = { stroke: 'stroke', fill: 'fill', 'stop-color': 'stopColor' };
  const dead = (v) => !v || v === 'none' || v === 'transparent' ||
    v === 'rgba(0, 0, 0, 0)' || v.startsWith('url(');

  const hosts = [...document.querySelectorAll(HOSTS)];
  const paints = [];
  hosts.forEach((host, hi) => {
    const nodes = [...host.querySelectorAll('*')];
    nodes.forEach((el, ni) => {
      for (const attr of Object.keys(PROPS)) {
        if (!el.hasAttribute(attr)) continue;
        const computed = String(getComputedStyle(el)[PROPS[attr]] || '').trim();
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

  return JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    hosts: hosts.length,
    tokens,
    paints
  });
})()`;

/* The real control, clicked the way an operator clicks it. Nothing here calls
   OpsTheme or Aria directly: the edge under test is the one that runs when the
   button in the top bar is pressed. */
const CLICK_PROBE = `(() => {
  const btn = document.getElementById('themeBtn');
  if (!btn) return JSON.stringify({ clicked: false });
  btn.click();
  return JSON.stringify({
    clicked: true,
    label: btn.getAttribute('aria-label'),
    theme: document.documentElement.getAttribute('data-theme')
  });
})()`;

/* --------------------------------------------------------------------- run */

const failures = [];
const note = (m) => console.log('ok  ' + m);

for (const [name, values] of Object.entries(CHART_TOKENS)) {
  if (rgba(values.dark) === null || rgba(values.light) === null) {
    failures.push(`${name} is pinned to a value this check cannot parse ` +
      `(${values.dark} / ${values.light})`);
  } else if (rgba(values.dark) === rgba(values.light)) {
    failures.push(`${name} is pinned to the same colour in both themes, so every shape ` +
      'painted from it would assert nothing');
  }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const origin = `http://127.0.0.1:${PORT}`;

/* Kept inside the repository rather than in a temp directory so the path is the
   same on a developer machine and on the runner, and removed in the finally
   below either way. */
const profile = fs.mkdtempSync(path.join(ROOT, '.ops-theme-redraw-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank',
], { stdio: 'ignore' });

let cdp;
let problems = [];
let initScript = null;

/* The theme has to be in storage before the document's first script runs, so it
   is registered as an on-new-document script; Runtime.evaluate would write into
   the document already loaded, which at the start is about:blank. Emulated
   media is set to the OPPOSITE, because theme.js falls back to
   prefers-color-scheme and matching them would make a failed storage write look
   like a success. */
async function setTheme(theme) {
  if (initScript) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  }
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try { localStorage.setItem('ops-theme', " + JSON.stringify(theme) + '); } catch (e) {}',
  });
  initScript = res.identifier;
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }],
  });
}

async function load(url, { settle = 900 } = {}) {
  problems = [];
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

  for (const { start, end } of DIRECTIONS) {
    const where = `${SHELL} (${start} -> ${end})`;
    await setTheme(start);
    await load(origin + SHELL);
    if (problems.length) {
      failures.push(`${where} raised on load:\n      ` + problems.join('\n      '));
    }

    const before = await evaluate(PAINT_PROBE);

    /* ------------------------------------------------ the page is measurable */
    if (before.theme !== start) {
      failures.push(`${where}: the page loaded with data-theme="${before.theme}", so the ` +
        'experiment never started in the theme it says it did');
      continue;
    }
    if (before.hosts < MIN_HOSTS) {
      failures.push(`${where}: ${before.hosts} chart host(s) on the page, expected at least ` +
        `${MIN_HOSTS}, so everything below measured almost nothing`);
      continue;
    }
    if (before.paints.length < MIN_PAINTS) {
      failures.push(`${where}: the charts reached the page with ${before.paints.length} ` +
        `resolved paint(s), expected at least ${MIN_PAINTS}, so everything below measured ` +
        'almost nothing');
      continue;
    }

    /* --------------------------------------------------------- PINNED TOKENS */
    /* What this file pins against what the stylesheet resolved. The paint
       assertions below compare against the pins, so a pin that had drifted from
       aria.css would quietly move the target; this is the line that stops it.
       Checked for whichever theme is loaded, and again for the other one after
       the switch, because a check that only ever validated the start theme
       reports a drifted end pin as "the chart did not follow the theme" — the
       wrong diagnosis for the wrong file. */
    const drift = (theme, tokens) => Object.keys(CHART_TOKENS)
      .filter((name) => rgba(tokens[name]) !== rgba(CHART_TOKENS[name][theme]))
      .map((name) => `${name} resolves to ${tokens[name] || '(nothing)'} in ${theme}, but this ` +
        `check pins it to ${CHART_TOKENS[name][theme]}`);

    const drifted = drift(start, before.tokens);
    if (drifted.length) {
      failures.push(`${where}: aria.css and this check disagree — ${drifted.join('; ')}. ` +
        'Reconcile with the palette contract in scripts/check-ops-shell-v2.mjs before ' +
        'trusting anything below.');
      continue;
    }

    /* -------------------------------------- every paint is a palette value */
    const expected = new Map();
    const tokensSeen = new Set();
    let unreadable = 0;
    for (const p of before.paints) {
      const canonical = rgba(p.value);
      if (canonical === null) {
        unreadable += 1;
        failures.push(`${where}: ${p.key} resolved to ${p.value}, which this check cannot ` +
          'read as a colour');
        continue;
      }
      const token = tokenHolding(start, canonical);
      if (!token) {
        failures.push(`${where}: ${p.key} was painted ${p.attr} and resolved to ${p.value}, ` +
          `which is not a value the ${start} palette writes for any token the charts use`);
        continue;
      }
      tokensSeen.add(token);
      expected.set(p.key, { token, want: CHART_TOKENS[token][end], was: p.value });
    }
    if (unreadable || expected.size < MIN_PAINTS) {
      failures.push(`${where}: only ${expected.size} chart paint(s) were pinned to a ${start} ` +
        `token, expected at least ${MIN_PAINTS}`);
      continue;
    }
    const missingTokens = Object.keys(CHART_TOKENS).filter((t) => !tokensSeen.has(t));
    if (missingTokens.length) {
      failures.push(`${where}: nothing on the page is painted from ` +
        `${missingTokens.join(', ')}, so those tokens assert nothing. Either a chart stopped ` +
        'drawing or it stopped using that tone.');
      continue;
    }
    note(`${where}: ${expected.size} chart paints all hold the ${start} palette before the ` +
      `switch, across ${tokensSeen.size} tokens`);

    /* ------------------------------------------------------------ the switch */
    const clicked = await evaluate(CLICK_PROBE);
    if (!clicked.clicked) {
      failures.push(`${where}: there is no #themeBtn in the top bar to click`);
      continue;
    }
    await new Promise((r) => setTimeout(r, 250));

    const after = await evaluate(PAINT_PROBE);
    if (after.theme !== end) {
      failures.push(`${where}: clicking the theme button left data-theme="${after.theme}", ` +
        `expected ${end}, so the charts were never asked to change`);
      continue;
    }
    if (problems.length) {
      failures.push(`${where} raised on the theme change:\n      ` + problems.join('\n      '));
    }

    const driftedAfter = drift(end, after.tokens);
    if (driftedAfter.length) {
      failures.push(`${where}: aria.css and this check disagree — ${driftedAfter.join('; ')}. ` +
        'Reconcile with the palette contract in scripts/check-ops-shell-v2.mjs; until then ' +
        'the comparison below is against the wrong target, not against a chart that failed ' +
        'to repaint.');
      continue;
    }

    /* ------------------------------------- the charts hold the OTHER palette */
    const seenAfter = new Map(after.paints.map((p) => [p.key, p]));
    const stale = [];
    let missing = 0;
    for (const [key, want] of expected) {
      const got = seenAfter.get(key);
      if (!got) {
        missing += 1;
        failures.push(`${where}: ${key} was painted before the switch and is gone after it, ` +
          'so the two measurements are not comparable');
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
      failures.push(`${where}: ${stale.length} of ${expected.size} chart paint(s) did not ` +
        `follow the theme — ${shown.join('; ')}${rest ? `; and ${rest} more` : ''}. Chart ` +
        'colours are resolved at draw time, so a chart is only correct for the theme it was ' +
        'drawn in; syncTheme() in ops/assets/aria.js has to redraw after the toggle. A ' +
        'dark-palette chart left on a light surface is the WCAG AA failure monorepo ' +
        'Stadiora/Aria#10042 fixed the palette to prevent.');
    }
    if (!stale.length && !missing) {
      note(`${where}: all ${expected.size} chart paints moved to the ${end} palette when the ` +
        'theme button was pressed');
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures.length) {
  console.error('\nThe theme-change to chart-redraw edge failed:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log('\nEvery chart follows the theme button, in both directions.');
process.exit(0);
