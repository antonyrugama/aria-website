/* Guards the Problems pane against scrolling the page sideways on a phone.

   The pane is a grid of rows whose first column holds a rule's name and,
   when the rule cannot reach a verdict, a badge saying why. A badge never
   wraps, so the whole sentence in one became the minimum width of a column
   declared `1fr`, and a `1fr` column will not go under its content's
   minimum. On a 375px viewport that pushed the threshold and the on/off
   switch past the right edge of the document, and the whole page scrolled
   sideways rather than the row wrapping in place.

   Nothing in this repository could have caught that. There is no build step
   and no test runner, and a stylesheet compiles to nothing that can be
   asserted about: the defect only exists once a browser has laid the page
   out at a particular width against particular data. So this check does what
   the bug needed doing to it — it serves the real pages, answers the
   operations API with a stub, lays them out in headless Chrome at 375px, and
   reads `documentElement.scrollWidth` back.

   The stub is deliberately hostile rather than tidy. It sends a rule that
   cannot judge and whose reason is the longest sentence the vocabulary in
   assets/alerts-model.js can produce, because a fixture of short strings
   would fit in any layout and the check would pass over the defect it is
   named for. If the pane stops rendering that row at all, the assertions
   below fail rather than quietly measuring an empty page.

   Usage:  node scripts/check-ops-narrow-overflow.mjs
   Chrome: CHROME_PATH, or the usual install locations on Linux and Windows.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = '/ops/alerts.html';
const WIDTH = 375;
const HEIGHT = 812;
const THEMES = ['dark', 'light'];

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

/* The longest badge the pane can draw: EVALUATION_LABEL.insufficient_data
   followed by INSUFFICIENT_REASON.below_minimum_samples. This row is the one
   the check exists for, and NARROW_BADGE below asserts it reached the DOM. */
const NARROW_BADGE = 'Not enough data to judge, too few measurements so far';

const RULES = [
  { ruleKey: 'ai_success_rate', title: 'AI success rate', scopeDescription: 'Per request type',
    thresholdLabel: 'below 95% for 10m', channels: ['teams', 'email'], enabled: true,
    lastEvaluationStatus: 'ok' },
  { ruleKey: 'cost_anomaly', title: 'Unusual cost for a service',
    scopeDescription: 'Against the last 7 days', thresholdLabel: 'over 25%',
    channels: ['email'], enabled: true,
    lastEvaluationStatus: 'insufficient_data', lastInsufficientReason: 'below_minimum_samples' },
  { ruleKey: 'no_telemetry', title: 'No data coming in',
    scopeDescription: 'An app stops sending anything', thresholdLabel: 'over 15m',
    channels: ['teams', 'email'], enabled: true, lastEvaluationStatus: 'error' }
];

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
  if (pathname.startsWith('/api/ops/alerts/rules')) {
    return { data: {
      rules: RULES.map((r) => Object.assign({
        severity: 'warning', category: 'ai_reliability',
        lastInsufficientReason: null, lastEvaluatedAt: ago(120000), lastFiredAt: null
      }, r)),
      channels: [
        { channel: 'teams', status: 'ok', target: 'Aria operations',
          lastDeliveredAt: ago(300000), failureReason: null },
        { channel: 'email', status: 'failed', target: 'ops@example.invalid',
          lastDeliveredAt: ago(9000000), failureReason: 'auth' }
      ]
    } };
  }
  if (pathname.startsWith('/api/ops/alerts/problems')) {
    return { data: { problems: [{
      id: 'prb_1', reference: 'AO-118', severity: 'critical', status: 'open',
      category: 'ai_reliability', title: 'Nutrition plans are failing to generate',
      description: 'Worker memory pressure is killing the generation process.',
      ruleKey: 'ai_success_rate', ruleTitle: 'AI success rate',
      pane: 'jobs-live', paneLabel: 'Happening now',
      detectedAt: ago(900000), firedAt: ago(800000),
      acknowledgedAt: null, acknowledgedBy: null,
      closedAt: null, closeReason: null, closedBy: null,
      notificationsFailed: 0, events: []
    }] } };
  }
  return { data: {} };
}

/* --------------------------------------------------------------- serving */

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
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Chromium found. Set CHROME_PATH.');
}

/* Chrome writes the port it actually took to DevToolsActivePort. Asking it
   rather than dictating a port is what keeps two runs on one machine - a
   local re-run over a still-closing browser, two CI jobs on one runner - from
   silently driving each other's browser. */
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

/* What the browser is asked, once the pane has rendered. Reported whole, so a
   failure names the elements that are past the edge rather than only the
   number that proves some element is. */
const PROBE = `(() => {
  const de = document.documentElement;
  const viewport = de.clientWidth;
  const past = [];
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (box.right > viewport + 0.5) {
      past.push({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute('class') || '',
        text: (el.textContent || '').trim().slice(0, 40),
        right: Math.round(box.right)
      });
    }
  }
  past.sort((a, b) => b.right - a.right);
  return JSON.stringify({
    scrollWidth: de.scrollWidth,
    viewport: viewport,
    ruleRows: document.querySelectorAll('.rule-row').length,
    badges: [...document.querySelectorAll('.rule-row .badge')].map(function (b) {
      return b.textContent.trim();
    }),
    past: past.slice(0, 10)
  });
})()`;

/* ------------------------------------------------------------------- run */

const failures = [];

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const tempRoot = process.env.RUNNER_TEMP || process.env.TEMP || '/tmp';
const profile = fs.mkdtempSync(path.join(tempRoot, 'ops-overflow-'));

const browser = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--disable-gpu', '--disable-extensions', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--force-prefers-reduced-motion', 'about:blank'
], { stdio: 'ignore' });

let cdp;
try {
  const cdpPort = await devtoolsPort(profile);
  const target = await devtools(cdpPort, '/json/new?about:blank', 'PUT');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true
  });

  const origin = `http://127.0.0.1:${PORT}`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      "try {" +
      "localStorage.setItem('ops-api-base', " + JSON.stringify(origin) + ");" +
      "sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));" +
      "} catch (e) {}"
  });

  for (const theme of THEMES) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: theme }]
    });
    await cdp.send('Runtime.evaluate', {
      expression: "try { localStorage.setItem('ops-theme', " + JSON.stringify(theme) + "); } catch (e) {}"
    });

    cdp.reset();
    await cdp.send('Page.navigate', { url: origin + PAGE });
    await cdp.once('Page.loadEventFired');
    await new Promise((r) => setTimeout(r, 2500));

    const evaluated = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const seen = JSON.parse(evaluated.result.value);

    /* An empty page cannot overflow, so the measurement is worthless unless
       the pane actually drew the rows and the badge that reproduce the
       defect. These two run first for that reason. */
    if (seen.ruleRows < RULES.length) {
      failures.push(`${theme}: expected at least ${RULES.length} rule rows, saw ${seen.ruleRows}`);
      continue;
    }
    if (!seen.badges.includes(NARROW_BADGE)) {
      failures.push(
        `${theme}: the long "cannot judge" badge is not on the page, so the widest ` +
        `row was never laid out. Saw badges: ${JSON.stringify(seen.badges)}`);
      continue;
    }

    if (seen.scrollWidth > seen.viewport) {
      const worst = seen.past
        .map((e) => `      ${e.tag}.${e.cls.split(' ').join('.')} ends at ${e.right}px${e.text ? ` ("${e.text}")` : ''}`)
        .join('\n');
      failures.push(
        `${theme}: the page scrolls sideways at ${WIDTH}px — ` +
        `documentElement.scrollWidth is ${seen.scrollWidth}, viewport is ${seen.viewport}.\n` +
        `    Past the right edge:\n${worst}`);
    } else {
      console.log(`ok  ${PAGE} at ${WIDTH}px, ${theme} theme: ` +
        `scrollWidth ${seen.scrollWidth} <= ${seen.viewport}, ` +
        `${seen.ruleRows} rule rows drawn`);
    }
  }
} finally {
  if (cdp) cdp.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures.length) {
  console.error('\nThe Problems pane overflows a phone-width viewport:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error(
    '\nA row must wrap or scroll inside its own container. The page itself must ' +
    'never scroll sideways.\n');
  process.exit(1);
}

console.log('\nThe Problems pane fits a 375px viewport in both themes.');
process.exit(0);
