/* Guards the v2 operations shell against the four ways it can break silently.

   None of these can be caught by reading the source. A design system is a set
   of names that only mean anything once a browser has resolved them, and every
   failure below is one where the page still renders, the console stays quiet,
   and the thing is simply wrong:

     1. A token reference that does not exist. `var(--bg-2)` where the
        stylesheet declares no --bg-2 paints nothing at all — no error, no
        warning, no fallback. Every custom property aria.css and aria.js name
        is resolved here through getComputedStyle, which is what the browser
        itself does, rather than matched against the source text.

     2. The preview-state mechanism forcing a display type. Visibility is keyed
        on an attribute so a shown element keeps its own display, and the
        failure mode is invisible in the one case people test: a .stack reads
        as block either way, while a <tr>, a .pill and a .card are destroyed.
        So the assertion is on the computed display of five different element
        types, in every one of the four states.

     3. The pre-paint theme. theme.js applies the theme before first paint and
        aria.js only corrects things after boot, so a check that runs after
        boot cannot see a disagreement between them: the page paints one theme,
        switches, and the test measures the second one. The pre-paint path is
        therefore measured with aria.js BLOCKED, which is the only state in
        which the two can be told apart.

     4. A console error on a pane. This shell is additive — no pane file was
        touched — and the cheapest proof of that is to load every one of them
        and listen.

   Usage:  node scripts/check-ops-shell-v2.mjs
   Chrome: CHROME_PATH, or the usual install locations.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = '/ops/shell-v2.html';
const THEMES = ['dark', 'light'];
const STATES = ['live', 'loading', 'empty', 'degraded'];

/* Every pane page, so a change to the shared assets that broke one of them
   shows up here rather than in production. */
const PANES = [
  '/ops/index.html', '/ops/jobs-live.html', '/ops/run-history.html',
  '/ops/alerts.html', '/ops/analytics.html', '/ops/spend.html',
  '/ops/evaluations.html', '/ops/releases.html', '/ops/users.html',
  '/ops/settings.html', '/ops/login.html', '/ops/setup.html'
];

/* The light theme is not a mechanical inversion of the dark one. Cyan at full
   brightness is unreadable on white, so anything carrying meaning as text
   drops to the deeper end of the ramp. These are the two values the design
   decides; a port that inverted the palette instead would pass every other
   assertion in this file. */
const CYAN = { dark: '#22D3EE', light: '#0891B2' };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

/* ------------------------------------------------------------------ stub */

const NOW = Date.parse('2026-08-01T09:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const ADMIN = { id: 'adm_1', email: 'owner@example.invalid', name: 'Owner', role: 'owner' };
const SESSION = { id: 'ses_1', createdAt: ago(600000), lastSeenAt: ago(1000), userAgent: 'check' };

/* Deliberately thin. This check is not testing what a pane draws, it is
   testing that loading it against the shared assets raises nothing, so every
   unknown route answers an empty envelope and a pane that cannot find its
   figures renders its own empty state — which is a state it has to handle. */
function stub(pathname) {
  if (pathname.startsWith('/api/ops/auth/refresh') || pathname.startsWith('/api/ops/auth/login')) {
    return { data: {
      accessToken: 'stub-access', expiresIn: 900, refreshToken: 'stub-refresh-2',
      refreshTokenRotated: true, authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900,
      admin: ADMIN, session: SESSION
    } };
  }
  if (pathname.startsWith('/api/ops/auth/session')) {
    return { data: {
      admin: ADMIN, session: SESSION,
      authTime: Math.floor(NOW / 1000), reauthWindowSeconds: 900
    } };
  }
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

/* Chrome writes the port it actually took to DevToolsActivePort. Asking it
   rather than dictating a port keeps two runs on one machine from silently
   driving each other's browser. */
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
    reset() { seen.delete('Page.loadEventFired'); }
  };
}

/* ----------------------------------------------------------------- probes */

/* Every custom property the stylesheet declares on :root, resolved the way the
   browser resolves it, plus every property name aria.css and aria.js reference
   through var(). A name in the second list and not the first paints nothing. */
const TOKENS = `(() => {
  const declared = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules || []) {
      if (!rule.selectorText || rule.selectorText.indexOf(':root') !== 0) continue;
      for (const name of rule.style) if (name.startsWith('--') && !declared.includes(name)) declared.push(name);
    }
  }
  const computed = getComputedStyle(document.documentElement);
  const unresolved = declared.filter((n) => computed.getPropertyValue(n).trim() === '');
  return JSON.stringify({
    declared,
    unresolved,
    cyan: computed.getPropertyValue('--cyan').trim(),
    theme: document.documentElement.getAttribute('data-theme')
  });
})()`;

/* Every element carrying data-state, with what the browser computed for it.
   Reported whole rather than sampled: the failure this guards against is a
   visibility rule that forces one display type, and sampling one element per
   state is how that gets missed. */
const STATE_PROBE = (state) => `(() => {
  window.Aria.applyState(${JSON.stringify(state)});
  const els = [...document.querySelectorAll('[data-state]')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.getAttribute('class') || '',
    states: el.getAttribute('data-state').split(/\\s+/),
    shown: el.hasAttribute('data-shown'),
    display: getComputedStyle(el).display
  }));
  return JSON.stringify({
    els,
    segPressed: [...document.querySelectorAll('#stateSeg button[aria-pressed="true"]')]
      .map((b) => b.getAttribute('data-value'))
  });
})()`;

/* What survived boot. Every figure here is a fact the shell is responsible for
   and none of it can be read off the source: the rail is generated, the icons
   are swapped in place, and the chart names are derived from the data. */
const SHELL_PROBE = `(() => {
  const named = [...document.querySelectorAll('svg.chart[role="img"]')]
    .map((s) => s.getAttribute('aria-label'));
  return JSON.stringify({
    groups: [...document.querySelectorAll('.nav-group')].map((n) => n.textContent.trim()),
    navItems: document.querySelectorAll('.nav-item').length,
    account: !!document.querySelector('.rail-foot .who-name'),
    unexpandedIcons: document.querySelectorAll('[data-i]').length,
    expandedIcons: document.querySelectorAll('#iconGallery svg.ico').length,
    charts: document.querySelectorAll('svg.chart').length,
    namedCharts: named,
    anonymousCharts: [...document.querySelectorAll('svg.chart')]
      .filter((s) => !s.hasAttribute('aria-hidden') && !s.getAttribute('aria-label')).length,
    ribbonName: (document.querySelector('.ribbon[role="img"]') || {}).ariaLabel
      || (document.querySelector('.ribbon') || {}).getAttribute
      && (document.querySelector('.ribbon')).getAttribute('aria-label'),
    api: Object.keys(window.Aria).sort()
  });
})()`;

/* Before boot, no state element may be visible: they start hidden so the page
   cannot flash a state it is not in. Measured with aria.js blocked, which is
   the only moment this is observable. */
const PREPAINT_PROBE = `(() => {
  const computed = getComputedStyle(document.documentElement);
  const visible = [...document.querySelectorAll('[data-state]')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.getAttribute('data-state'));
  return JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    cyan: computed.getPropertyValue('--cyan').trim(),
    ink: computed.getPropertyValue('--ink').trim(),
    booted: typeof window.Aria !== 'undefined',
    visibleStateElements: visible
  });
})()`;

/* ------------------------------------------------------------------- run */

const failures = [];
const note = (m) => console.log('ok  ' + m);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const origin = `http://127.0.0.1:${PORT}`;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || '/tmp';
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-shell-v2-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

let cdp;
let problems = [];
let initScript = null;

/* The theme has to be in storage before the document's first script runs, and
   Runtime.evaluate writes into whatever document is currently loaded — which
   at the start is about:blank, where the write goes nowhere. Registering it as
   an on-new-document script is the only ordering that actually holds, and
   getting it wrong is invisible: theme.js falls back to prefers-color-scheme
   and the page looks fine, just not in the theme the check asked for. */
async function setTheme(theme) {
  if (initScript) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
  }
  const stored = theme === null ? "localStorage.removeItem('ops-theme');"
    : 'localStorage.setItem(\'ops-theme\', ' + JSON.stringify(theme) + ');';
  const res = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'try {' +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ');' +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      stored +
      '} catch (e) {}'
  });
  initScript = res.identifier;
  /* Emulated to the OPPOSITE of the stored theme on purpose. theme.js falls
     back to prefers-color-scheme when nothing is stored, so matching them
     would make a failed storage write look like a success. */
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'light' : 'dark' }]
  });
}

async function load(url, { settle = 1200 } = {}) {
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
  await cdp.send('Network.enable');

  /* Both channels, because they carry different failures: Runtime sees
     console.error and an uncaught throw, Log sees the ones the browser itself
     raises — a blocked subresource, a CSP violation, a 404 on an asset. */
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
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
  });

  /* ---------------------------------------------- the shell, both themes */
  for (const theme of THEMES) {
    await setTheme(theme);
    await load(origin + SHELL);
    if (problems.length) {
      failures.push(`${SHELL} (${theme}) raised:\n      ` + problems.join('\n      '));
    }

    const tokens = await evaluate(TOKENS);
    if (tokens.theme !== theme) {
      failures.push(`${SHELL} (${theme}): documentElement carries data-theme="${tokens.theme}"`);
    }
    if (!tokens.declared.length) {
      failures.push(`${SHELL} (${theme}): aria.css declared no custom properties on :root, so ` +
        'nothing below was actually measured');
    }
    if (tokens.unresolved.length) {
      failures.push(`${SHELL} (${theme}): ${tokens.unresolved.length} token(s) declared but ` +
        `resolving to nothing: ${tokens.unresolved.join(', ')}`);
    }
    if (tokens.cyan.toUpperCase() !== CYAN[theme]) {
      failures.push(`${SHELL} (${theme}): --cyan is ${tokens.cyan}, expected ${CYAN[theme]}. ` +
        'The light palette is written, not derived.');
    }
    note(`${SHELL} ${theme}: ${tokens.declared.length} tokens all resolve, --cyan ${tokens.cyan}`);

    const shell = await evaluate(SHELL_PROBE);
    const expectGroups = ['Right now', 'How we are doing', 'Apps and people'];
    if (JSON.stringify(shell.groups) !== JSON.stringify(expectGroups)) {
      failures.push(`${SHELL} (${theme}): rail groups are ${JSON.stringify(shell.groups)}`);
    }
    if (shell.navItems !== 10) {
      failures.push(`${SHELL} (${theme}): rail drew ${shell.navItems} panes, expected 10`);
    }
    if (!shell.account) {
      failures.push(`${SHELL} (${theme}): the rail has no account footer`);
    }
    if (shell.unexpandedIcons !== 0) {
      failures.push(`${SHELL} (${theme}): ${shell.unexpandedIcons} <i data-i> placeholder(s) ` +
        'were never expanded');
    }
    if (shell.expandedIcons < 30) {
      failures.push(`${SHELL} (${theme}): the icon gallery drew ${shell.expandedIcons} icons, ` +
        'expected the whole set');
    }
    if (shell.charts < 4) {
      failures.push(`${SHELL} (${theme}): ${shell.charts} charts drawn, expected at least 4`);
    }
    /* The a11y guarantee carried over from the mocks: role="img" makes an
       SVG's whole subtree presentational, so a chart that draws its labels as
       <text> and carries no name announces nothing at all. */
    if (shell.anonymousCharts !== 0) {
      failures.push(`${SHELL} (${theme}): ${shell.anonymousCharts} chart(s) are neither ` +
        'aria-hidden nor named, so they announce as an unlabelled graphic');
    }
    const bars = shell.namedCharts.find((n) => n.startsWith('Sample runs per day'));
    if (!bars || !['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].every((d) => bars.includes(d))) {
      failures.push(`${SHELL} (${theme}): the bar chart's name does not carry its category ` +
        `labels, which live as <text> inside role="img" and are announced to nobody. Got ${bars}`);
    }
    if (!shell.ribbonName || !shell.ribbonName.includes('peak at')) {
      failures.push(`${SHELL} (${theme}): the ribbon has no derived name. Got ${shell.ribbonName}`);
    }
    const api = ['applyState', 'boot', 'icon', 'redraw'];
    if (JSON.stringify(shell.api) !== JSON.stringify(api)) {
      failures.push(`${SHELL} (${theme}): window.Aria exposes ${JSON.stringify(shell.api)}, ` +
        `expected ${JSON.stringify(api)}`);
    }
    note(`${SHELL} ${theme}: rail, icons and ${shell.namedCharts.length} named charts drawn`);

    /* ------------------------------------------------------ four states */
    for (const state of STATES) {
      const seen = await evaluate(STATE_PROBE(state));
      const where = (e) => `${e.tag}.${e.cls.split(' ').filter(Boolean).join('.')}`;

      if (seen.els.length < 8) {
        failures.push(`${SHELL} (${theme}): only ${seen.els.length} [data-state] elements on ` +
          'the page, so the state assertions below measured almost nothing');
      }

      const shown = seen.els.filter((e) => e.states.includes(state));
      const hidden = seen.els.filter((e) => !e.states.includes(state));
      if (!shown.length) {
        failures.push(`${SHELL} (${theme}, ${state}): no element belongs to this state`);
      }

      for (const e of shown) {
        if (!e.shown) {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to this state but ` +
            'never got data-shown');
        }
        if (e.display === 'none') {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to this state and ` +
            'is still display:none');
        }
      }
      for (const e of hidden) {
        if (e.shown || e.display !== 'none') {
          failures.push(`${SHELL} (${theme}, ${state}): ${where(e)} belongs to ` +
            `${e.states.join('/')} but computed display:${e.display}`);
        }
      }

      /* The whole reason visibility is keyed on an attribute rather than set
         to display:block. If it were block, every one of these would read
         "block" and the four types below would be gone. */
      const types = new Set(shown.map((e) => e.display));
      for (const needed of ['table-row', 'inline-flex']) {
        if (!types.has(needed)) {
          failures.push(`${SHELL} (${theme}, ${state}): nothing shown for this state computed ` +
            `display:${needed}. Shown types were ${[...types].join(', ')}, which is what a ` +
            'visibility rule that forces a display type looks like.');
        }
      }

      if (JSON.stringify(seen.segPressed) !== JSON.stringify([state])) {
        failures.push(`${SHELL} (${theme}, ${state}): the switcher reports ` +
          `${JSON.stringify(seen.segPressed)} pressed`);
      }
    }
    note(`${SHELL} ${theme}: all four states keep every element's own display type`);
  }

  /* -------------------------------------------------- the pre-paint path */
  /* aria.js blocked. theme.js and aria.css are on their own, which is exactly
     the situation a check that runs after boot can never observe: if the two
     paths disagreed, aria.js would already have corrected the page. */
  await cdp.send('Network.setBlockedURLs', { urls: ['*/assets/aria.js', '*/assets/shell-v2.js'] });
  for (const theme of THEMES) {
    await setTheme(theme);
    await load(origin + SHELL, { settle: 400 });
    const seen = await evaluate(PREPAINT_PROBE);

    if (seen.booted) {
      failures.push(`${SHELL} (${theme}, pre-paint): aria.js still ran, so this measured the ` +
        'post-boot page and proves nothing');
    }
    if (seen.theme !== theme) {
      failures.push(`${SHELL} (${theme}, pre-paint): theme.js painted data-theme="${seen.theme}"`);
    }
    if (seen.cyan.toUpperCase() !== CYAN[theme]) {
      failures.push(`${SHELL} (${theme}, pre-paint): --cyan painted ${seen.cyan}, expected ` +
        `${CYAN[theme]}. The pre-paint path and the runtime path disagree, so the page paints ` +
        'one theme and switches to the other after boot.');
    }
    if (seen.visibleStateElements.length) {
      failures.push(`${SHELL} (${theme}, pre-paint): ` +
        `${seen.visibleStateElements.length} state element(s) are visible before boot ` +
        `(${seen.visibleStateElements.join(' | ')}), so the page flashes a state it is not in`);
    }
    note(`${SHELL} ${theme}: pre-paint theme correct with aria.js blocked, no state flash`);
  }

  /* All scripting blocked, including theme.js. What paints then is the
     stylesheet's own default, and it has to be the same dark set theme.js
     falls back to — this is the third place the default is written. */
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
  await cdp.send('Runtime.evaluate', {
    expression: "try { localStorage.removeItem('ops-theme'); } catch (e) {}"
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }]
  });
  await load(origin + SHELL, { settle: 400 });
  const bare = await evaluate(`(() => {
    const c = getComputedStyle(document.documentElement);
    return JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme'),
      cyan: c.getPropertyValue('--cyan').trim()
    });
  })()`).catch(() => null);
  /* Runtime.evaluate is how the probe is asked, so script execution has to come
     back on to read the answer; the page was laid out with it off. */
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
  if (bare) {
    if (bare.theme !== null) {
      failures.push(`${SHELL} (no script): documentElement carries data-theme="${bare.theme}", ` +
        'so theme.js ran and this measured nothing');
    }
    if (bare.cyan.toUpperCase() !== CYAN.dark) {
      failures.push(`${SHELL} (no script): with no theme attribute at all the stylesheet paints ` +
        `--cyan ${bare.cyan}, but theme.js falls back to dark (${CYAN.dark}). The CSS default ` +
        'and the script default disagree.');
    }
    note(`${SHELL}: with all scripting blocked the stylesheet default is still dark`);
  } else {
    failures.push(`${SHELL} (no script): the probe could not be read back`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await cdp.send('Network.setBlockedURLs', { urls: [] });

  /* ------------------------------------------------------- existing panes */
  /* Nothing in this change touches a pane file. This is the proof. */
  for (const theme of THEMES) {
    await setTheme(theme);
    for (const pane of PANES) {
      await load(origin + pane, { settle: 1500 });
      const rendered = await evaluate(
        '(() => JSON.stringify({ body: document.body.children.length, ' +
        'text: document.body.innerText.trim().length }))()');
      if (problems.length) {
        failures.push(`${pane} (${theme}) raised:\n      ` + problems.join('\n      '));
      } else if (rendered.text < 10) {
        failures.push(`${pane} (${theme}) rendered nothing, so listening for errors proved nothing`);
      } else {
        note(`${pane} ${theme}: rendered, no console errors`);
      }
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures.length) {
  console.error('\nThe v2 operations shell failed:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log('\nThe v2 shell holds in both themes, in all four states, and before first paint.');
process.exit(0);
