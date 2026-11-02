/* Scratch: serve ops/ + the repo's API stub, screenshot Health states.
   usage: node shoot.mjs <outDir> [state ...] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const WT = '/data/ianrowe/worktrees/r54-ops-health';
const require = createRequire('/data/ianrowe/git/harvey-realestate-mocks/package.json');
const { chromium } = require('playwright-core');
const stubMod = await import(WT + '/scripts/ops-api-stub.mjs');
const { stub } = stubMod;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

let scene = 'health';
let override = null;
let role = null; // (pathname, search) => payload | {fail:true} | undefined

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    const o = override && override(url.pathname, url.search);
    if (o && o.fail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'upstream_failed', message: 'The service did not answer.' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const body = o || stub(url.pathname, url.search, { scene });
    if (role && body && body.data && body.data.admin) body.data.admin = Object.assign({}, body.data.admin, { role });
    res.end(JSON.stringify(body));
    return;
  }
  const abs = path.join(WT, decodeURIComponent(url.pathname));
  if (!abs.startsWith(WT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(3);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/data/ianrowe/tmp/r54h/chrome-nosandbox'
});

const STATES = {
  full: {},
  empty: { override: (p) => {
    if (p.startsWith('/api/ops/alerts/problems')) return { data: { problems: [] } };
    if (p === '/api/ops/jobs') return { data: { generatedAt: new Date().toISOString(), recording: { state: 'recording', lastRecordedAt: new Date().toISOString() }, queue: { open: 0, byState: [{ state: 'queued', jobs: 0 }, { state: 'running', jobs: 0 }, { state: 'canceling', jobs: 0 }], lanes: [] }, workingSet: { limit: 50, returned: 0, truncated: false, jobs: [] }, attention: { completeness: 'whole_queue', stuck: [], abandoned: [] } } };
    if (p === '/api/ops/runs') return { data: { window: { range: '24h', endExclusiveAt: new Date().toISOString() }, coverage: { state: 'ready', coversWindow: true }, summary: { runs: 0, completed: 0, failed: 0, canceled: 0, unfinished: 0 }, runs: [] } };
  } },
  partial: { override: (p) => {
    if (p === '/api/ops/runs') return { fail: true };
    if (p.startsWith('/api/ops/costs')) return { fail: true };
  } },
  error: { override: (p) => (p.startsWith('/api/ops/alerts') || p === '/api/ops/jobs' || p === '/api/ops/runs' ? { fail: true } : undefined) },
  queue: { role: 'owner' },
  critical: { scene: 'default' }
};

async function shoot(name, { width, height, theme, state }) {
  const spec = STATES[state];
  scene = spec.scene || 'health';
  override = spec.override || null;
  role = spec.role === undefined ? 'viewer' : spec.role;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(([o, t]) => {
    try {
      localStorage.setItem('ops-api-base', o);
      sessionStorage.setItem('ops-refresh', JSON.stringify({ t: 'stub', s: 'adm_1' }));
      localStorage.setItem('ops-theme', t);
    } catch (e) {}
  }, [origin, theme]);
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(origin + '/ops/alerts.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, 'overflow', overflow);
  await ctx.close();
}

const jobs = [
  ['health-queue-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'queue' }],
  ['health-queue-phone', { width: 390, height: 2300, theme: 'dark', state: 'queue' }],
  ['health-critical-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'critical' }],
  ['health-critical-phone', { width: 390, height: 1500, theme: 'dark', state: 'critical' }],
  ['health-phone-375', { width: 375, height: 1500, theme: 'dark', state: 'full' }],
  ['health-desktop-dark', { width: 1536, height: 1024, theme: 'dark', state: 'full' }],
  ['health-phone-dark', { width: 390, height: 1500, theme: 'dark', state: 'full' }],
  ['health-desktop-light', { width: 1536, height: 1024, theme: 'light', state: 'full' }],
  ['health-phone-light', { width: 390, height: 1500, theme: 'light', state: 'full' }],
  ['health-empty-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'empty' }],
  ['health-empty-phone', { width: 390, height: 1500, theme: 'dark', state: 'empty' }],
  ['health-partial-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'partial' }],
  ['health-partial-phone', { width: 390, height: 1500, theme: 'dark', state: 'partial' }],
  ['health-error-desktop', { width: 1536, height: 1024, theme: 'dark', state: 'error' }],
  ['health-error-phone', { width: 390, height: 1500, theme: 'dark', state: 'error' }],
  ['health-phone-320', { width: 320, height: 1500, theme: 'dark', state: 'full' }],
  ['health-phone-360', { width: 360, height: 1500, theme: 'dark', state: 'full' }]
];
for (const [name, spec] of jobs) {
  if (only.length && !only.includes(name)) continue;
  await shoot(name, spec);
}
await browser.close();
server.close();
