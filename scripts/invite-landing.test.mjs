import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const landing = require('../invite-landing.js');
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('invite paths match what the app accepts: /invites/<code> or /i/<code>, nothing deeper', () => {
  const accepted = {
    '/invites/ABC123': 'ABC123',
    '/i/XYZ-987': 'XYZ-987',
    '/invites/rivera-b': 'RIVERA-B',
    '/invites/RIVERA-B/': 'RIVERA-B',
    '/invites/%20ab12cd%20': 'AB12CD',
    '/i/AB-12-CD': 'AB-12-CD',
  };
  for (const [path, code] of Object.entries(accepted)) assert.equal(landing.parseInvitePath(path), code, path);

  for (const path of ['/', '/invites', '/invites/', '/i', '/invites/ABC123/extra', '/invites/AB', '/invites/%E0%A4',
    '/invites/ABC!123', '/invites/' + 'A'.repeat(65), '/Invites/ABC123', '/es/invites/ABC123', '/privacy/ABC123']) {
    assert.equal(landing.parseInvitePath(path), null, path);
  }
});

test('language defaults to Spanish and follows ?lang=', () => {
  assert.equal(landing.pickLanguage(''), 'es');
  assert.equal(landing.pickLanguage('?lang=en'), 'en');
  assert.equal(landing.pickLanguage('?o=1&lang=en'), 'en');
  assert.equal(landing.pickLanguage('?lang=fr'), 'es');
});

test('Android opens the app through an intent that falls back to the Play listing', () => {
  const play = 'https://play.google.com/store/apps/details?id=com.runwitharia.mobile&pcampaignid=web_share';
  const url = landing.androidIntentUrl('runwitharia.com', 'RIVERA-B', play);
  assert.ok(url.startsWith('intent://runwitharia.com/invites/RIVERA-B#Intent;scheme=https;package=com.runwitharia.mobile;'));
  assert.ok(url.endsWith(`S.browser_fallback_url=${encodeURIComponent(play)};end`));
  assert.equal(landing.androidIntentUrl('runwitharia.com', 'ABC123', 'https://example.test/'), null);
});

test('iOS offers copy + App Store, not a same-site reload, and every language change keeps ?lang', () => {
  const script = read('invite-landing.js');
  assert.ok(!/[?&]o=1/.test(script), 'no ?o=1 reload param');
  const calls = [];
  const doc = {
    els: {}, documentElement: {}, head: { appendChild: (m) => calls.push(m) },
    getElementById(id) { return this.els[id] ||= { id, hidden: false, className: '', textContent: '', attrs: { href: 'https://play.google.com/store/apps/details?id=com.runwitharia.mobile' }, listeners: {},
      getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } }; },
    createElement: () => ({}),
    querySelectorAll: () => [],
  };
  const urls = [];
  const clipboard = [];
  landing.start({
    document: doc,
    location: { pathname: '/i/rivera-b', search: '?lang=en&o=1', origin: 'https://runwitharia.com', host: 'runwitharia.com', hash: '' },
    history: { replaceState: (_s, _t, url) => urls.push(url) },
    navigator: { userAgent: 'iPhone', maxTouchPoints: 5, clipboard: { writeText: async (text) => { clipboard.push(text); } } },
  });
  assert.equal(doc.els.open.hidden, true);
  assert.equal(doc.els['ios-hint'].hidden, false);
  assert.equal(doc.els['store-ios'].className, 'btn btn-p');
  assert.equal(doc.els['store-ios-label'].textContent, 'Copy code and open the App Store');
  assert.deepEqual(urls, ['/i/rivera-b?lang=en']);

  doc.els['store-ios'].listeners.click?.();
  assert.deepEqual(clipboard, ['RIVERA-B'], 'App Store click copies the normalized invite code');

  doc.els.lang.listeners.click({ target: { getAttribute: (name) => name === 'data-lang' ? 'es' : null } });
  assert.equal(doc.documentElement.lang, 'es');
  assert.deepEqual(urls, ['/i/rivera-b?lang=en', '/i/rivera-b?lang=es'], 'language toggle persists the choice in the URL');
});

test('404.html carries every element the landing script drives, and shows not-found by default', () => {
  const html = read('404.html');
  const script = read('invite-landing.js');
  const ids = new Set([...script.matchAll(/\bq\('([a-z-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 10);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  assert.match(html, /<section class="nf" id="not-found">/);
  assert.match(html, /<section id="invite" hidden>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('iOS universal-link paths for the invite landing stay in the AASA', () => {
  const paths = JSON.parse(read('.well-known/apple-app-site-association')).applinks.details[0].paths;
  assert.ok(paths.includes('/invites/*') && paths.includes('/i/*'));
});
