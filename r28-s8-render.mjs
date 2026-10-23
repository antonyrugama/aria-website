import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

const root = '/data/ianrowe/worktrees/aria-website-r28';
const out = '/data/ianrowe/tmp/r28-s8-evidence';
await mkdir(out, { recursive: true });
const profile = await mkdtemp('/data/ianrowe/tmp/r28-s8-chrome-');
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    assert.ok(file.startsWith(root + '/'));
    const data = await readFile(file);
    res.setHeader('Content-Type', extname(file) === '.html' ? 'text/html; charset=utf-8' : 'image/png');
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn('/home/ianrowe/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    let text = '';
    chrome.stderr.on('data', data => {
      text += data;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    chrome.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chrome exited: ${code}`)); });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable');
  const navigate = async path => {
    const result = await call('Page.navigate', { url: base + path });
    assert.ok(!result.errorText, result.errorText);
    for (let i = 0; i < 50; i++) {
      if (await evaluate(`location.href === ${JSON.stringify(base + path)} && document.readyState === 'complete'`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Navigation did not settle: ${path}`);
  };
  const screenshot = async name => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(out, name + '.png'), Buffer.from(data, 'base64'));
  };
  const results = [];
  for (const width of [390, 360]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await navigate('/privacy.html');
    await screenshot(`reference-aria-${width}`);
    for (const theme of ['dark', 'light']) {
      await call('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' },
      ] });
      await navigate('/fitmg/privacy.html');
      const checks = await evaluate(`(() => {
        const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
        return {
          language: document.documentElement.lang,
          duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
          brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).map(a => a.hash),
          overflow: document.documentElement.scrollWidth > innerWidth,
          navTargets: [...document.querySelectorAll('nav a')].map(a => ({ text: a.textContent, height: a.getBoundingClientRect().height })),
          foreground: getComputedStyle(document.body).color,
          background: getComputedStyle(document.body).backgroundColor,
          accent: getComputedStyle(document.querySelector('a')).color,
          muted: getComputedStyle(document.querySelector('.updated')).color,
          scripts: document.scripts.length,
        };
      })()`);
      assert.equal(checks.language, 'es');
      assert.deepEqual(checks.duplicateIds, []);
      assert.deepEqual(checks.brokenAnchors, []);
      assert.equal(checks.overflow, false, `${theme} ${width}: no horizontal overflow`);
      assert.equal(checks.scripts, 0, 'Policy works without scripts');
      assert.ok(checks.navTargets.every(a => a.height >= 44));
      const linear = n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; };
      const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(linear).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const bg = luminance(checks.background);
      const contrast = {};
      for (const role of ['foreground', 'accent', 'muted']) {
        const fg = luminance(checks[role]);
        contrast[role] = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
        assert.ok(contrast[role] >= 4.5, `${role} contrast ${contrast[role]}`);
      }
      for (const lang of ['es', 'en']) {
        await evaluate(`document.querySelector('header a[href="#${lang}"]').click()`);
        assert.equal(await evaluate('location.hash'), '#' + lang);
        assert.equal(await evaluate(`document.getElementById('${lang}').lang`), lang);
        if (lang === 'es') await evaluate('scrollTo(0, 0)');
        await screenshot(`fitmg-${lang}-${theme}-${width}-intro`);
        await evaluate(`document.querySelector('#${lang} a[href="#ai-${lang}"]').click()`);
        await screenshot(`fitmg-${lang}-${theme}-${width}-ai`);
        await evaluate(`document.querySelector('#ai-${lang} + p + ul li:last-child').scrollIntoView({block: 'start'})`);
        await screenshot(`fitmg-${lang}-${theme}-${width}-choice`);
      }
      results.push({ theme, width, contrast, ...checks });
    }
  }
  await navigate('/fitmg/privacy/index.html#en');
  for (let i = 0; i < 30 && !(await evaluate(`location.pathname === '/fitmg/privacy.html' && location.hash === '#en'`)); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('location.pathname + location.hash'), '/fitmg/privacy.html#en');
  await writeFile(join(out, 'checks.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`Rendered 26 PNGs; language navigation, anchors, clean-URL redirect, 44px controls, no horizontal overflow, and AA text contrast passed.`);
} finally {
  ws?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve));
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true });
}
