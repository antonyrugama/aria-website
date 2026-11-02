/* Unit tests for ops/assets/aria.js — the v2 shell runtime.
   Same shape as the pane tests: node:test, node:vm and a hand-written DOM, so
   the repository still needs nothing but Node itself to check itself.

   What is worth testing here is the part of the file a screenshot cannot show:
   the accessible name each chart derives, and the fact that state visibility
   is applied in both directions. The browser check
   (scripts/check-ops-shell-v2.mjs) covers what only a real layout can answer. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = new URL('../ops/assets/aria.js', import.meta.url);

/* ------------------------------------------------------------------- DOM */
/* Attributes are the storage for everything an element knows: class, dataset
   and the aria-* names all read back out of the same map, because that is how
   a browser behaves and because a stub with a private field per accessor will
   happily agree with code that never set the attribute at all.

   `tokens` is a map of custom property to value, or a function returning one.
   The function form exists because the tokens move with the theme in a real
   browser, and a fixed map cannot express that. */
function makeDom(tokens) {
  let doc;
  const readTokens = typeof tokens === 'function' ? tokens : () => tokens;

  function parseCompound(sel) {
    const parts = sel.trim().split(/(?=[.[])/);
    const tests = [];
    for (const part of parts) {
      if (!part) continue;
      if (part[0] === '.') {
        const cls = part.slice(1);
        tests.push((el) => (el.getAttribute('class') || '').split(/\s+/).includes(cls));
      } else if (part[0] === '[') {
        const m = /^\[([^\]=~]+)(?:([~]?)=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(part);
        if (!m) throw new Error('selector not supported by the stub: ' + sel);
        const [, name, fuzzy, dq, sq, bare] = m;
        const want = dq !== undefined ? dq : sq !== undefined ? sq : bare;
        tests.push((el) => {
          if (!el.hasAttribute(name)) return false;
          if (want === undefined) return true;
          const got = el.getAttribute(name);
          return fuzzy === '~' ? got.split(/\s+/).includes(want) : got === want;
        });
      } else {
        const tag = part.toLowerCase();
        tests.push((el) => el.tagName.toLowerCase() === tag);
      }
    }
    if (!tests.length) throw new Error('empty selector');
    return (el) => tests.every((t) => t(el));
  }

  /* One level of descendant combinator is enough for what aria.js asks, and
     it has to be here: the menu decides whether an entry the tour mounted was
     pressed with closest('.menu-extra [role="menuitem"]'), and a stub that
     cannot read that selector would never take the branch. A space inside an
     attribute value is not a combinator. */
  function parseSelector(sel) {
    const tests = sel.trim().split(/\s+(?![^[]*\])/).map(parseCompound);
    return (el) => {
      if (!tests[tests.length - 1](el)) return false;
      let want = tests.length - 2;
      for (let node = el.parentNode; node && want >= 0; node = node.parentNode) {
        if (node.tagName && tests[want](node)) want -= 1;
      }
      return want < 0;
    };
  }

  function element(tag, ns) {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: ns ? tag : tag.toUpperCase(),
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: null,
      style: {},
      clientWidth: 0,
      clientHeight: 0,
      textContent: '',
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
      hasAttribute(name) { return attrs.has(name); },
      removeAttribute(name) { attrs.delete(name); },
      get attributeNames() { return [...attrs.keys()]; },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = el;
        el.childNodes.push(child);
        return child;
      },
      removeChild(child) {
        const i = el.childNodes.indexOf(child);
        if (i >= 0) el.childNodes.splice(i, 1);
        child.parentNode = null;
        return child;
      },
      replaceChild(next, prev) {
        const i = el.childNodes.indexOf(prev);
        if (i < 0) throw new Error('replaceChild: node is not a child');
        if (next.parentNode) next.parentNode.removeChild(next);
        el.childNodes[i] = next;
        next.parentNode = el;
        prev.parentNode = null;
        return prev;
      },
      addEventListener(name, fn) { listeners.set(name, fn); },
      dispatch(name, ev) {
        const fn = listeners.get(name);
        assert.equal(typeof fn, 'function', `${tag} has no ${name} listener`);
        return fn({ preventDefault() {}, ...ev });
      },
      focus() { doc.activeElement = el; },
      contains(node) {
        for (let n = node; n; n = n.parentNode) if (n === el) return true;
        return false;
      },
      closest(sel) {
        const match = parseSelector(sel);
        let node = el;
        while (node) {
          if (node.tagName && match(node)) return node;
          node = node.parentNode;
        }
        return null;
      },
      querySelectorAll(sel) {
        const match = parseSelector(sel);
        const out = [];
        (function walk(node) {
          for (const c of node.childNodes) {
            if (c.tagName && match(c)) out.push(c);
            if (c.childNodes) walk(c);
          }
        })(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    };
    Object.defineProperty(el, 'firstChild', { get: () => el.childNodes[0] || null });
    Object.defineProperty(el, 'children', { get: () => el.childNodes.filter((c) => c.tagName) });
    Object.defineProperty(el, 'className', {
      get: () => el.getAttribute('class') || '',
      set: (v) => el.setAttribute('class', v),
    });
    /* A reflected boolean attribute, as a browser has it: assigning false takes
       the attribute off rather than writing the word "false". */
    Object.defineProperty(el, 'hidden', {
      get: () => el.hasAttribute('hidden'),
      set: (v) => { if (v) el.setAttribute('hidden', ''); else el.removeAttribute('hidden'); },
    });
    el.classList = {
      contains: (c) => el.className.split(/\s+/).includes(c),
      add: (c) => { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: (c) => {
        el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
      },
      toggle: (c, on) => (on ? el.classList.add(c) : el.classList.remove(c)),
    };
    el.dataset = new Proxy({}, {
      get: (_, k) => {
        if (typeof k !== 'string') return undefined;
        const a = 'data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        return el.hasAttribute(a) ? el.getAttribute(a) : undefined;
      },
      set: (_, k, v) => {
        el.setAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v);
        return true;
      },
      has: (_, k) => el.hasAttribute('data-' + String(k)),
    });
    return el;
  }

  const root = element('html');
  const docListeners = new Map();
  doc = {
    documentElement: root,
    activeElement: null,
    createElement: (tag) => element(tag),
    createElementNS: (ns, tag) => element(tag, ns),
    getElementById: (id) => doc.querySelectorAll(`[id="${id}"]`)[0] || null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener(name, fn) {
      docListeners.set(name, (docListeners.get(name) || []).concat(fn));
    },
    dispatch(name, ev) {
      const fns = docListeners.get(name) || [];
      assert.ok(fns.length, `the document has no ${name} listener`);
      fns.forEach((fn) => fn({ preventDefault() {}, ...ev }));
    },
  };

  const sessionData = new Map();
  const window = {
    document: doc,
    getComputedStyle: () => ({ getPropertyValue: (n) => readTokens()[n] || '' }),
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    sessionStorage: {
      getItem: (k) => (sessionData.has(k) ? sessionData.get(k) : null),
      setItem: (k, v) => { sessionData.set(k, String(v)); },
      removeItem: (k) => { sessionData.delete(k); },
    },
    location: { pathname: '/ops/index.html', assigned: [], assign(href) { this.assigned.push(href); } },
    sent: [],
    dispatchEvent(ev) { window.sent.push(ev.type); return true; },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  window.window = window;
  return { window, doc, root, element, sessionData };
}

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

const SRC = readFileSync(SOURCE, 'utf8');

/* Loads aria.js into a fresh DOM. `body` receives the page markup the test
   needs; nothing is shared between tests. */
function load(build) {
  const dom = makeDom(TOKENS);
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  if (build) build(dom, body);
  vm.createContext(dom.window);
  vm.runInContext(SRC, dom.window, { filename: 'aria.js' });
  return { ...dom, body, Aria: dom.window.Aria };
}

function el(dom, parent, tag, attrs = {}) {
  const node = dom.element(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

/* ============================ the exposed surface ======================= */

test('window.Aria exposes the seven functions the shell and its panes call, and no others', () => {
  const { Aria } = load();
  const keys = ['appendBadge', 'applyState', 'boot', 'icon', 'lookup', 'redraw', 'takeLookup'];
  assert.deepEqual(Object.keys(Aria).sort(), keys);
  assert.equal(Aria.icons, undefined, 'there is no Aria.icons() accessor');
  for (const k of keys) {
    assert.equal(typeof Aria[k], 'function', `Aria.${k} is not callable`);
  }
});

/* ================================= icons =============================== */

test('icon() returns a decorative svg and falls back to info for an unknown name', () => {
  const { Aria } = load();
  const known = Aria.icon('bell', 'ico-lg');
  assert.equal(known.tagName, 'svg');
  assert.equal(known.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(known.getAttribute('aria-hidden'), 'true');
  assert.equal(known.getAttribute('class'), 'ico ico-lg');
  assert.ok(known.children.length > 0, 'the icon drew nothing');

  const unknown = Aria.icon('no-such-icon');
  const info = Aria.icon('info');
  const shape = (svg) => svg.children.map((c) => c.tagName + ':' + (c.getAttribute('d') || ''));
  assert.deepEqual(shape(unknown), shape(info), 'an unknown name did not fall back to info');
  assert.ok(shape(info).length > 0, 'the info fallback itself is empty');
});

test('boot() replaces every <i data-i> with an svg and carries its class across', () => {
  const { doc, body, Aria } = load((dom, b) => {
    const host = el(dom, b, 'span', { class: 'wrap' });
    el(dom, host, 'i', { 'data-i': 'gear', class: 'ico-lg tone-cyan' });
    el(dom, b, 'i', { 'data-i': 'bell' });
  });
  Aria.boot({});
  assert.equal(doc.querySelectorAll('[data-i]').length, 0, 'a placeholder survived boot');
  const svgs = body.querySelectorAll('svg');
  assert.equal(svgs.length, 2);
  assert.ok(
    svgs.some((s) => s.getAttribute('class') === 'ico ico-lg tone-cyan'),
    'the placeholder class was dropped, so a sized icon loses its size'
  );
});

/* ============================= the navigation ========================== */

const DESTINATIONS = [
  ['today', 'Today', 'index.html'],
  ['growth', 'Growth', 'analytics.html'],
  ['health', 'Health', 'alerts.html'],
  ['money', 'Money', 'spend.html'],
  ['ai', 'Aria AI', 'evaluations.html'],
];

function railDom() {
  return load((dom, b) => {
    el(dom, b, 'nav', { id: 'rail' });
    el(dom, b, 'header', { id: 'topbar' });
    el(dom, b, 'nav', { id: 'bottomNav' });
  });
}

test('the rail and the phone bar each offer the five destinations, in order, as links', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'alerts', title: 'Problems' });

  const rail = doc.getElementById('rail');
  const bottom = doc.getElementById('bottomNav');
  for (const [surface, cls] of [[rail, '.nav-item'], [bottom, '.tab-item']]) {
    const links = surface.querySelectorAll(cls);
    assert.deepEqual(links.map((l) => l.querySelector('.nav-label').textContent),
      DESTINATIONS.map((d) => d[1]));
    assert.deepEqual(links.map((l) => l.getAttribute('href')), DESTINATIONS.map((d) => d[2]));
    assert.deepEqual(links.map((l) => l.getAttribute('data-destination')), DESTINATIONS.map((d) => d[0]));
    assert.deepEqual(links.map((l) => l.tagName), ['A', 'A', 'A', 'A', 'A']);
  }

  /* One group of five, with no headings: the old rail grouped eleven panes
     under three, and a heading left behind would say the panes are still
     there. role="listitem" on an <a> replaces the link role, which is why this
     is a group and not a list. */
  assert.equal(rail.querySelectorAll('.nav-group').length, 0, 'a group heading survived');
  const lists = rail.querySelectorAll('.nav-list');
  assert.equal(lists.length, 1);
  assert.equal(lists[0].getAttribute('role'), 'group');
  assert.equal(lists[0].getAttribute('aria-label'), 'Destinations');
  assert.equal(rail.querySelectorAll('[role="listitem"]').length, 0);
  assert.equal(rail.querySelectorAll('[role="list"]').length, 0);
});

test('exactly the current destination is marked aria-current, in both surfaces', () => {
  for (const [id, , href] of DESTINATIONS) {
    const { doc, Aria } = railDom();
    Aria.boot({ id, title: id });
    for (const surface of ['rail', 'bottomNav']) {
      const root = doc.getElementById(surface);
      const current = root.querySelectorAll('[aria-current]');
      assert.equal(current.length, 1, `${id}: ${surface} marked ${current.length} links current`);
      assert.equal(current[0].getAttribute('aria-current'), 'page');
      assert.equal(current[0].getAttribute('href'), href, `${id}: ${surface} marked the wrong link`);
      assert.ok(current[0].classList.contains('on'));
      assert.equal(root.querySelectorAll('.on').length, 1);
    }
  }
});

test('an unknown destination, or none, marks nothing current rather than guessing', () => {
  for (const cfg of [{ id: 'not-a-destination' }, {}, { id: null }]) {
    const { doc, Aria } = railDom();
    Aria.boot(cfg);
    for (const surface of ['rail', 'bottomNav']) {
      assert.equal(doc.getElementById(surface).querySelectorAll('[aria-current]').length, 0,
        `${JSON.stringify(cfg)} marked something current in ${surface}`);
    }
  }
});

test('the navigation invents no badge, no account and no number when boot() passes none', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'today' });
  const rail = doc.getElementById('rail');
  const bottom = doc.getElementById('bottomNav');
  assert.equal(rail.querySelectorAll('.nav-badge').length + bottom.querySelectorAll('.nav-badge').length, 0);
  assert.equal(rail.querySelectorAll('.rail-foot').length, 0);

  for (const surface of [rail, bottom]) {
    const text = (function read(node) {
      return node.childNodes.map((c) => (c.tagName ? read(c) : '')).join(' ') + ' ' + node.textContent;
    })(surface);
    assert.doesNotMatch(text, /\d/, 'a surface rendered a number nobody supplied: ' + text.trim());
    assert.doesNotMatch(text, /@/, 'a surface rendered an address nobody supplied: ' + text.trim());
  }
  /* The avatar still draws, as a person glyph, so the menu is reachable. */
  const btn = doc.getElementById('acctBtn');
  assert.ok(btn.querySelector('svg'), 'with no account the avatar button drew no glyph');
  assert.equal(btn.querySelectorAll('.who-av').length, 0, 'with no account the avatar button invented initials');
});

test('a badge is filed under the pane a destination opens on, and spoken, on both surfaces', () => {
  const { doc, Aria } = railDom();
  Aria.boot({
    id: 'today',
    badges: { alerts: { label: '3', tone: 'warn', description: '3 open problems' } },
  });
  for (const [surface, cls] of [['rail', '.nav-item'], ['bottomNav', '.tab-item']]) {
    const root = doc.getElementById(surface);
    const badge = root.querySelectorAll('.nav-badge');
    assert.equal(badge.length, 1, `${surface} drew ${badge.length} badges`);
    assert.equal(badge[0].textContent, '3');
    assert.ok(badge[0].classList.contains('warn'));
    /* Health, not the first or the last: the key is the pane id aria.js files
       a destination under, and a destination that took the wrong key would
       wear another's count. */
    assert.equal(badge[0].parentNode.getAttribute('data-destination'), 'health');
    assert.ok(root.querySelectorAll(cls).filter((l) => l.querySelector('.nav-badge')).length === 1);

    const spoken = root.querySelectorAll('.sr').map((s) => s.textContent);
    assert.deepEqual(spoken, [', 3 open problems'],
      'a bare number beside a destination name is announced as part of the name');
  }
});

test('the rail footer shows an avatar and a first name, and never an address', () => {
  const cases = [
    [{ name: 'Sam Patel', email: 'sam.patel@example.invalid' }, 'Sam', 'SP'],
    [{ email: 'sam.patel@example.invalid' }, 'Sam', 'SP'],
    [{ email: 'owner@example.invalid' }, 'Owner', 'OW'],
    [{ name: 'madonna' }, 'Madonna', 'MA'],
    [{ email: '' }, 'Signed in', '?'],
  ];
  for (const [account, name, av] of cases) {
    const { doc, Aria } = railDom();
    Aria.boot({ id: 'today', account: { ...account, meta: 'Owner' } });
    const foot = doc.getElementById('rail').querySelectorAll('.rail-foot');
    assert.equal(foot.length, 1, JSON.stringify(account) + ': no footer');
    assert.equal(foot[0].querySelector('.who-name').textContent, name);
    assert.equal(foot[0].querySelector('.who-av').textContent, av);
    assert.equal(foot[0].querySelector('.who-av').getAttribute('aria-hidden'), 'true');
    assert.equal(foot[0].querySelectorAll('.who-meta').length, 0, 'the footer still carries a second line');
    assert.doesNotMatch(foot[0].textContent + ' ' + foot[0].querySelector('.who-name').textContent, /@/,
      JSON.stringify(account) + ': the footer showed an address');
  }
});

test('a page that names no title gets no heading, not the word "undefined"', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ pane: 'index' });
  const heads = doc.querySelectorAll('h1');
  assert.deepEqual(heads.map((e) => e.textContent), [],
    'boot() with no title rendered a heading; an absent title must render nothing');
});

test('a title and a subtitle are both rendered when the page names them', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ pane: 'index', title: 'Right now', sub: 'What is happening' });
  assert.deepEqual(doc.querySelectorAll('h1').map((e) => e.textContent), ['Right now']);
  assert.deepEqual(doc.querySelectorAll('.page-sub').map((e) => e.textContent),
    ['What is happening']);
});

test('a page that writes its own line under the title gets an empty one to write into', () => {
  const { doc, Aria } = railDom();
  Aria.boot({ id: 'today', title: 'Today', subSlot: true });
  const slot = doc.getElementById('pageSub');
  assert.ok(slot, 'subSlot drew no line for the pane to fill');
  assert.equal(slot.textContent, '');
  const none = railDom();
  none.Aria.boot({ id: 'today', title: 'Today' });
  assert.equal(none.doc.getElementById('pageSub'), null, 'a page with no subtitle got an empty line anyway');
});

/* ============================== account menu ============================ */

function menuDom(cfg) {
  const dom = railDom();
  dom.Aria.boot({
    id: 'today',
    account: { name: 'Sam Patel', email: 'sam.patel@example.invalid', meta: 'Owner' },
    lookup: { href: 'users.html' },
    ...cfg,
  });
  const btn = dom.doc.getElementById('acctBtn');
  const menu = dom.doc.getElementById('acctMenu');
  const items = menu.querySelectorAll('[role="menuitem"]');
  return { ...dom, btn, menu, items };
}

test('the avatar menu is closed on arrival, named by its button, and offers settings and the theme', () => {
  const { doc, btn, menu, items } = menuDom();
  assert.equal(menu.hidden, true, 'the menu arrived open');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(doc.getElementById(btn.getAttribute('aria-controls')), menu, 'the button controls something else');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(doc.getElementById(menu.getAttribute('aria-labelledby')), btn, 'the menu is named by something else');

  assert.deepEqual(items.map((i) => i.querySelector('span') ? i.querySelector('span').textContent : i.textContent),
    ['Settings', 'Administrators', 'Sessions', 'Audit', 'Light theme']);
  assert.deepEqual(items.slice(0, 4).map((i) => i.getAttribute('href')),
    ['settings.html', 'settings.html#administrators', 'settings.html#sessions', 'settings.html#audit']);
  /* The one place the whole address is shown. */
  assert.equal(menu.querySelector('.menu-name').textContent, 'Sam Patel');
  assert.deepEqual(menu.querySelectorAll('.menu-meta').map((m) => m.textContent),
    ['sam.patel@example.invalid', 'Owner']);
  assert.equal(btn.querySelector('.who-av').textContent, 'SP');
});

test('the button opens the menu onto its first entry, and closes it again handing focus back', () => {
  const { doc, btn, menu, items } = menuDom();
  btn.dispatch('click');
  assert.equal(menu.hidden, false, 'pressing the button did not open the menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok(doc.activeElement === items[0], 'the menu opened without moving focus into itself');

  btn.dispatch('click');
  assert.equal(menu.hidden, true, 'pressing the button again did not close it');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(doc.activeElement === btn, 'closing from the button dropped focus');
});

test('Escape closes the menu and returns focus; Tab closes it and leaves focus where it goes', () => {
  const { doc, btn, menu, items } = menuDom();

  btn.dispatch('click');
  menu.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true, 'Escape left the menu open');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(doc.activeElement === btn, 'Escape did not return focus to the avatar button');

  btn.dispatch('click');
  items[2].focus();
  menu.dispatch('keydown', { key: 'Tab' });
  assert.equal(menu.hidden, true, 'Tab left the menu open behind the focus that had left it');
  assert.ok(doc.activeElement === items[2], 'Tab was stolen back to the button, so focus could not move on');
});

test('the arrow keys walk the entries and wrap, Home and End jump, and disabled entries are skipped', () => {
  const { doc, btn, menu, items } = menuDom();
  btn.dispatch('click');
  const press = (key) => menu.dispatch('keydown', { key });

  press('ArrowDown');
  assert.ok(doc.activeElement === items[1], 'ArrowDown did not move to the next entry');
  press('End');
  assert.ok(doc.activeElement === items[items.length - 1], 'End did not reach the last entry');
  press('ArrowDown');
  assert.ok(doc.activeElement === items[0], 'ArrowDown off the last entry did not wrap to the first');
  press('ArrowUp');
  assert.ok(doc.activeElement === items[items.length - 1], 'ArrowUp off the first entry did not wrap to the last');
  press('Home');
  assert.ok(doc.activeElement === items[0], 'Home did not reach the first entry');

  items[1].disabled = true;
  press('ArrowDown');
  assert.ok(doc.activeElement === items[2], 'a disabled entry took focus');
});

test('ArrowDown on the closed button opens the menu, and on the open one does nothing more', () => {
  const { doc, btn, menu, items } = menuDom();
  btn.focus();
  btn.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(menu.hidden, false, 'ArrowDown on the button did not open the menu');
  assert.ok(doc.activeElement === items[0]);

  items[3].focus();
  btn.dispatch('keydown', { key: 'ArrowDown' });
  assert.ok(doc.activeElement === items[3], 'ArrowDown on the open button yanked focus back to the first entry');
});

test('a press outside the menu closes it; a press inside does not', () => {
  const { doc, btn, menu, items } = menuDom();
  btn.dispatch('click');
  doc.dispatch('click', { target: items[0] });
  doc.dispatch('click', { target: btn });
  assert.equal(menu.hidden, false, 'a press inside the menu closed it');

  doc.dispatch('click', { target: doc.getElementById('rail') });
  assert.equal(menu.hidden, true, 'a press elsewhere left the menu open');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
});

test('an entry the tour mounts closes the menu without taking focus off the dialog it opens', () => {
  const { doc, btn, menu, items, element } = menuDom();
  const extra = menu.querySelector('.menu-extra');
  assert.ok(extra, 'the menu has no slot for the tour to mount into');
  const entry = element('button');
  entry.setAttribute('role', 'menuitem');
  extra.appendChild(entry);

  btn.dispatch('click');
  entry.focus();
  menu.dispatch('click', { target: entry });
  assert.equal(menu.hidden, true, 'the menu stayed open behind the dialog');
  assert.ok(doc.activeElement === entry, 'closing moved focus off the entry, so the dialog could not hold it');

  /* The other direction: the theme entry is not one the tour mounts, and
     leaves the menu open so the change can be seen. */
  btn.dispatch('click');
  menu.dispatch('click', { target: items[items.length - 1] });
  assert.equal(menu.hidden, false, 'every press closed the menu, not only the tour entries');
});

/* ============================ the header lookup ========================= */

test('the lookup hands the identifier over in sessionStorage and never in the address', () => {
  const dom = menuDom();
  const { doc, window, sessionData } = dom;
  const input = doc.getElementById('lookupInput');
  input.value = '  ath_4821  ';
  doc.getElementById('lookupForm').dispatch('submit', {});

  assert.equal(sessionData.get('ops-user-lookup'), 'ath_4821', 'the identifier was not held for the pane');
  assert.deepEqual(window.location.assigned, ['users.html']);
  assert.doesNotMatch(window.location.assigned[0], /ath_4821|[?#]/, 'the identifier reached the address');
});

test('a blank lookup goes nowhere and holds nothing', () => {
  const { doc, window, sessionData, Aria } = menuDom();
  const input = doc.getElementById('lookupInput');
  input.value = '   ';
  doc.getElementById('lookupForm').dispatch('submit', {});
  assert.deepEqual(window.location.assigned, []);
  assert.equal(sessionData.size, 0);
  assert.equal(Aria.lookup(''), false);
  assert.equal(Aria.lookup(undefined), false);
  assert.equal(Aria.lookup('ath_1'), true);
});

test('on the users page a lookup tells the page instead of reloading it', () => {
  const here = menuDom();
  here.window.location.pathname = '/ops/users.html';
  here.Aria.lookup('ath_9', 'users.html');
  assert.deepEqual(here.window.sent, ['ops:lookup'], 'the page already on screen was not told');
  assert.deepEqual(here.window.location.assigned, [], 'the page reloaded itself');

  const elsewhere = menuDom();
  elsewhere.Aria.lookup('ath_9', 'users.html');
  assert.deepEqual(elsewhere.window.sent, [], 'another page announced a lookup nobody was listening for');
  assert.deepEqual(elsewhere.window.location.assigned, ['users.html']);
});

test('takeLookup returns what was handed over once, then nothing', () => {
  const { Aria, sessionData } = menuDom();
  Aria.lookup('ath_77', 'users.html');
  assert.equal(sessionData.get('ops-user-lookup'), 'ath_77');
  assert.equal(Aria.takeLookup(), 'ath_77');
  assert.equal(sessionData.size, 0, 'the identifier stayed in storage after it was read');
  assert.equal(Aria.takeLookup(), '', 'a second read returned the same identifier again');
});

test('a browser that refuses storage still navigates, and takes nothing back', () => {
  const dom = menuDom();
  const refuse = () => { throw new Error('storage is disabled'); };
  dom.window.sessionStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
  assert.equal(dom.Aria.lookup('ath_5', 'users.html'), true);
  assert.deepEqual(dom.window.location.assigned, ['users.html'], 'a refusing browser left the operator on the page');
  assert.equal(dom.Aria.takeLookup(), '');
});

test('on a phone the search icon opens the field, says so, and moves focus into it', () => {
  const { doc, Aria, window } = menuDom();
  const open = doc.getElementById('lookupOpen');
  const top = doc.getElementById('topbar');
  assert.equal(doc.getElementById(open.getAttribute('aria-controls')), doc.getElementById('lookupForm'));
  assert.equal(open.getAttribute('aria-expanded'), 'false');

  open.dispatch('click');
  assert.ok(top.classList.contains('is-searching'), 'the search row did not open');
  assert.equal(open.getAttribute('aria-expanded'), 'true');
  assert.ok(doc.activeElement === doc.getElementById('lookupInput'), 'the field did not take focus');

  open.dispatch('click');
  assert.equal(top.classList.contains('is-searching'), false, 'pressing again left the row open');
  assert.equal(open.getAttribute('aria-expanded'), 'false');
  assert.ok(Aria && window, 'the harness lost its handles');
});

test('a page that passes no lookup draws no search', () => {
  const { doc } = menuDom({ lookup: undefined });
  assert.equal(doc.getElementById('lookupForm'), null);
  assert.equal(doc.getElementById('lookupOpen'), null);
});

/* ================================= states ============================== */
function stateDom() {
  return load((dom, b) => {
    el(dom, b, 'header', { id: 'topbar' });
    el(dom, b, 'section', { 'data-state': 'live', id: 'liveOnly' });
    el(dom, b, 'section', { 'data-state': 'loading', id: 'loadingOnly' });
    el(dom, b, 'tr', { 'data-state': 'live degraded', id: 'row' });
    el(dom, b, 'span', { 'data-state': 'empty degraded', id: 'pill' });
  });
}

test('applyState shows the matching elements and hides the rest, every time', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });

  const shown = () => doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')).sort();

  assert.deepEqual(shown(), ['liveOnly', 'row']);

  /* The direction that gets missed. Going live -> loading must take data-shown
     OFF the two live elements; a test that only ever checks the new state
     passes just as happily when nothing is ever removed. */
  Aria.applyState('loading');
  assert.deepEqual(shown(), ['loadingOnly']);

  Aria.applyState('degraded');
  assert.deepEqual(shown(), ['pill', 'row']);

  Aria.applyState('empty');
  assert.deepEqual(shown(), ['pill']);

  Aria.applyState('live');
  assert.deepEqual(shown(), ['liveOnly', 'row']);
});

test('applyState changes visibility by attribute only — it never writes a display', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });
  Aria.applyState('degraded');

  for (const e of doc.querySelectorAll('[data-state]')) {
    assert.equal(e.style.display, undefined,
      `${e.getAttribute('id')} got an inline display, which overwrites its own layout type ` +
      '(a shown <tr> must stay table-row, a .pill inline-flex)');
    assert.equal(e.getAttribute('style'), null,
      `${e.getAttribute('id')} got a style attribute, which style-src 'self' blocks anyway`);
  }
});

test('the preview switcher tracks the state in both the class and aria-pressed', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });

  const pressed = () => doc.getElementById('stateSeg').querySelectorAll('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('data-value'));

  assert.deepEqual(pressed(), ['live']);
  Aria.applyState('empty');
  assert.deepEqual(pressed(), ['empty']);
  assert.deepEqual(
    doc.getElementById('stateSeg').querySelectorAll('.on').map((b) => b.getAttribute('data-value')),
    ['empty']
  );
});

test('clicking the switcher applies that state', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ preview: true, state: 'live' });
  const seg = doc.getElementById('stateSeg');
  const target = seg.querySelectorAll('[data-value="empty"]')[0];
  seg.dispatch('click', { target });
  assert.deepEqual(doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')), ['pill']);
});

test('the switcher is absent unless the page asks for it', () => {
  const { doc, Aria } = stateDom();
  Aria.boot({ state: 'live' });
  assert.equal(doc.getElementById('stateSeg'), null);
  assert.deepEqual(doc.querySelectorAll('[data-shown]').map((e) => e.getAttribute('id')),
    ['liveOnly', 'row']);
});

/* ================================= charts ==============================
   role="img" makes an svg's whole subtree presentational, so every <text>
   inside a chart is announced to nobody. These assert the names the renderers
   derive instead — the fix from monorepo #9958, which would be silently lost
   by porting the drawing and not the naming. */

/* No topbar here on purpose: renderTop draws a theme-button icon, and an svg
   the test did not ask for is exactly how "the first svg on the page" stops
   meaning "the chart". Queries below are scoped to the chart host anyway. */
function chartDom(build) {
  const dom = load(build);
  dom.chart = (sel) => {
    const host = dom.body.querySelector(sel);
    assert.ok(host, 'no ' + sel + ' on the page');
    return host;
  };
  return dom;
}

test('a standalone sparkline is named with its range and its last value', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '4,9,2,7', 'data-label': 'Sign-ins' });
  });
  Aria.boot({});
  const svg = chart('[data-spark]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Sign-ins, 4 values, low 2, high 9, ending 7');
  assert.equal(svg.getAttribute('aria-hidden'), null);
});

test('a flat sparkline says so rather than reporting a range of zero', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '5,5,5', 'data-label': 'Errors' });
  });
  Aria.boot({});
  assert.equal(chart('[data-spark]').querySelector('svg').getAttribute('aria-label'),
    'Errors, 3 values, flat at 5');
});

test('a KPI sparkline is hidden, because the KPI number beside it says the same thing', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    const card = el(dom, b, 'div', { class: 'kpi' });
    el(dom, card, 'div', { class: 'kpi-val' }).textContent = '1,284';
    el(dom, card, 'div', { class: 'kpi-spark', 'data-spark': '4,9,2,7' });
  });
  Aria.boot({});
  const svg = chart('.kpi-spark').querySelector('svg');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('role'), null);
  assert.equal(svg.getAttribute('aria-label'), null);
});

test('an area chart names every series, its range and the span of the x axis', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', {
      'data-area': 'Athletes:cyan:10,40,25;Coaches:violet:5,5,5',
      'data-xaxis': 'Mon,Tue,Wed',
    });
  });
  Aria.boot({});
  const svg = chart('[data-area]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'),
    'Athletes 10 to 40, Coaches flat at 5 over time, Mon to Wed');
});

test('a bar chart carries its category labels in the name — they exist nowhere else', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', {
      'data-bars': 'Mon:cyan:42;Tue:cyan:51;Wed:rose:8',
      'data-label': 'Runs per day',
    });
  });
  Aria.boot({});
  const svg = chart('[data-bars]').querySelector('svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'Runs per day: Mon 42, Tue 51, Wed 8');

  /* The <text> nodes are drawn and are the reason the name has to exist: they
     are inside role="img", so nothing announces them. */
  const drawn = svg.querySelectorAll('.axis').map((t) => t.textContent);
  assert.deepEqual(drawn, ['Mon', 'Tue', 'Wed']);
});

test('a ribbon reports a single peak by position', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-ribbon': '1,9,3', 'data-label': 'By hour' });
  });
  Aria.boot({});
  const host = chart('[data-ribbon]');
  assert.equal(host.getAttribute('role'), 'img');
  assert.equal(host.getAttribute('aria-label'),
    'By hour, 3 values, low 1, high 9, peak at 2 of 3');
  assert.equal(host.children.length, 3, 'one column per value');
});

test('a tied ribbon maximum is reported as a count, not as a peak at the first one', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-ribbon': '9,1,9,4', 'data-label': 'By hour' });
  });
  Aria.boot({});
  const label = chart('[data-ribbon]').getAttribute('aria-label');
  assert.equal(label, 'By hour, 4 values, low 1, high 9, high reached 2 times');
  assert.doesNotMatch(label, /peak at/,
    'naming one of two equal maxima as the peak describes a spike that is not in the data');
});

test('a gauge is hidden and its number is real text beside it, not only in the ring', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-gauge': '88', 'data-val': '88%', 'data-cap': 'of $650' });
  });
  Aria.boot({});
  const host = chart('[data-gauge]');
  const svg = host.querySelector('svg');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('role'), null);
  assert.equal(host.querySelector('.gauge-val').textContent, '88%');
  assert.equal(host.querySelector('.gauge-cap').textContent, 'of $650');
});

test('every graphic the renderer produces is either named or explicitly hidden', () => {
  const { body, chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-spark': '1,2,3', 'data-label': 'A' });
    el(dom, b, 'div', { class: 'kpi-spark', 'data-spark': '1,2,3' });
    el(dom, b, 'div', { 'data-area': 'S:cyan:1,2,3', 'data-xaxis': 'a,b,c' });
    el(dom, b, 'div', { 'data-bars': 'a:cyan:1;b:cyan:2', 'data-label': 'B' });
    el(dom, b, 'div', { 'data-gauge': '40' });
    el(dom, b, 'div', { 'data-ribbon': '1,2,3', 'data-label': 'C' });
  });
  Aria.boot({});

  const graphics = [
    ...body.querySelectorAll('svg'),
    ...body.querySelectorAll('[data-ribbon]'),
  ];
  assert.equal(graphics.length, 6, 'not every chart drew');
  assert.ok(chart('[data-bars]'), 'the bar chart host is gone');
  for (const g of graphics) {
    const hidden = g.getAttribute('aria-hidden') === 'true';
    const named = g.getAttribute('role') === 'img' && (g.getAttribute('aria-label') || '').length > 3;
    assert.ok(hidden || named,
      'a graphic is neither named nor hidden, so it is announced as an unlabelled image: ' +
      g.tagName + ' ' + (g.getAttribute('class') || ''));
    assert.ok(!(hidden && named), 'a graphic is both hidden and named');
  }
});

test('redraw() re-derives the names, so a theme change cannot drop them', () => {
  const { chart, Aria } = chartDom((dom, b) => {
    el(dom, b, 'div', { 'data-bars': 'Mon:cyan:42', 'data-label': 'Runs per day' });
  });
  Aria.boot({});
  Aria.redraw();
  const svgs = chart('[data-bars]').querySelectorAll('svg');
  assert.equal(svgs.length, 1, 'redraw stacked a second chart instead of replacing the first');
  assert.equal(svgs[0].getAttribute('aria-label'), 'Runs per day: Mon 42');
});

/* ================================= theme =============================== */

test('the theme button reflects what theme.js decided and never decides itself', () => {
  const dom = makeDom(TOKENS);
  const body = dom.element('body');
  dom.root.appendChild(body);
  el(dom, body, 'header', { id: 'topbar' });
  let current = 'light';
  let toggled = 0;
  dom.window.OpsTheme = { current: () => current, toggle() { toggled += 1; current = 'dark'; } };
  vm.createContext(dom.window);
  vm.runInContext(SRC, dom.window, { filename: 'aria.js' });

  dom.window.Aria.boot({});
  const btn = dom.doc.getElementById('themeBtn');
  assert.equal(btn.getAttribute('aria-label'), 'Switch to dark theme');

  btn.dispatch('click');
  assert.equal(toggled, 1, 'the button did not go through OpsTheme');
  assert.equal(btn.getAttribute('aria-label'), 'Switch to light theme');
  assert.equal(dom.root.getAttribute('data-theme'), null,
    'aria.js wrote the theme attribute itself; theme.js owns that, and two writers disagree');
});

/* Every chart colour is resolved at DRAW time, out of the tokens, and the
   tokens move with the theme — so a chart is only correct for the theme it was
   drawn in. syncTheme() closes that gap by redrawing after the toggle, and
   until Stadiora/Aria#10309 nothing bound the edge: deleting the call left
   every chart in the previous theme's palette with the whole suite green.

   What the test below proves: pressing the theme button re-resolves the colour
   aria.js writes onto each chart shape, in both directions. What it does NOT
   prove, and does not claim, is anything about the painted page — these are the
   presentation attributes the renderer wrote, read back out of a hand-written
   DOM whose token map is supplied by the test. The resolved paint on a
   laid-out page, against the palette aria.css really declares, is
   scripts/check-ops-theme-redraw.mjs. */
const THEME_TOKENS = {
  dark: {
    '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
    '--amber': '#FBBF24', '--line-2': 'rgba(255, 255, 255, .11)',
  },
  light: {
    '--cyan': '#0891B2', '--violet': '#7C3AED', '--emerald': '#059669',
    '--amber': '#B45309', '--line-2': 'rgba(11, 18, 32, .15)',
  },
};

/* aria.js against a DOM whose tokens move with the theme, the way a
   :root[data-theme] block does. theme.js still owns the decision: OpsTheme is
   the stub, exactly as on a real page. */
function themedDom(start, build) {
  let theme = start;
  const dom = makeDom(() => THEME_TOKENS[theme]);
  const body = dom.element('body');
  dom.root.appendChild(body);
  el(dom, body, 'header', { id: 'topbar' });
  dom.window.OpsTheme = {
    current: () => theme,
    toggle() { theme = theme === 'dark' ? 'light' : 'dark'; return theme; },
  };
  if (build) build(dom, body);
  vm.createContext(dom.window);
  vm.runInContext(SRC, dom.window, { filename: 'aria.js' });
  return { ...dom, body, Aria: dom.window.Aria, theme: () => theme };
}

/* Every literal colour the renderer painted inside a chart, in document order.
   Scoped to the chart hosts so the top bar's icons stay out: those are
   stroke="currentColor" and follow the theme through inherited colour with no
   redraw at all, so counting them would let a broken redraw look repainted.
   url(#...) and none carry no colour of their own — the gradients they point
   at are read through their own stop-color, which is the only colour a bar or
   an area fill has. */
const CHART_HOSTS = ['[data-area]', '[data-bars]', '[data-spark]', '[data-gauge]'];

function chartPaints(body) {
  const out = [];
  for (const sel of CHART_HOSTS) {
    body.querySelectorAll(sel).forEach((host, hi) => {
      let ni = 0;
      (function walk(node) {
        for (const c of node.childNodes) {
          if (!c.tagName) continue;
          ni += 1;
          for (const attr of ['stroke', 'fill', 'stop-color']) {
            const v = c.getAttribute(attr);
            if (!v || v === 'none' || v.indexOf('url(') === 0) continue;
            out.push({ where: `${sel}#${hi}|${ni}|${c.tagName}.${attr}`, value: v });
          }
          walk(c);
        }
      })(host);
    });
  }
  return out;
}

test('the theme button repaints every chart in the new palette, in both directions', () => {
  /* Without this the rest is vacuous in the quietest way there is: a token
     holding the same value in both themes passes whether or not anything was
     ever redrawn. */
  for (const name of Object.keys(THEME_TOKENS.dark)) {
    assert.notEqual(THEME_TOKENS.dark[name], THEME_TOKENS.light[name],
      `${name} is the same in both themes, so every shape painted from it asserts nothing`);
  }

  /* Both ways round. A redraw wired one way is a real defect, and an assertion
     that only runs dark -> light cannot see it. */
  for (const [start, end] of [['dark', 'light'], ['light', 'dark']]) {
    const dom = themedDom(start, (d, b) => {
      el(d, b, 'div', {
        'data-area': 'Mobile:cyan:58,44,32;Coaches Web:violet:14,9,6',
        'data-xaxis': '00,06,12',
      });
      el(d, b, 'div', { 'data-bars': 'Mon:cyan:42;Tue:cyan:51', 'data-label': 'Runs per day' });
      el(d, b, 'div', { class: 'kpi-spark', 'data-tone': 'cyan', 'data-spark': '742,760,735' });
      el(d, b, 'div', { 'data-tone': 'emerald', 'data-label': 'Spend', 'data-spark': '12,19,14' });
      el(d, b, 'div', { 'data-gauge': '88', 'data-tone': 'amber', 'data-val': '88%' });
    });
    dom.Aria.boot({});

    const before = chartPaints(dom.body);
    assert.ok(before.length >= 20,
      `only ${before.length} chart paints were found in ${start}, so this measured almost ` +
      'nothing');

    /* Each paint is pinned to the token it came from, and the expectation is
       that token's OTHER value — stated up front, from the palette, rather
       than read back off the page after the switch. */
    const tokenOf = new Map(Object.entries(THEME_TOKENS[start]).map(([n, v]) => [v, n]));
    const tokensSeen = new Set();
    const want = before.map((p) => {
      const token = tokenOf.get(p.value);
      assert.ok(token,
        `${p.where} was painted ${p.value}, which is not a value the ${start} palette writes`);
      tokensSeen.add(token);
      return THEME_TOKENS[end][token];
    });
    assert.equal(tokensSeen.size, Object.keys(THEME_TOKENS[start]).length,
      `only ${[...tokensSeen].join(', ')} reached the page, so the rest assert nothing`);

    dom.doc.getElementById('themeBtn').dispatch('click');
    assert.equal(dom.theme(), end, 'the button did not change the theme, so nothing was asked');

    const after = chartPaints(dom.body);
    assert.deepEqual(after.map((p) => p.where), before.map((p) => p.where),
      'the charts have a different shape after the redraw, so the two are not comparable');
    assert.deepEqual(after.map((p) => p.value), want,
      `switching from ${start} to ${end} left a chart holding the ${start} palette. Chart ` +
      'colours are resolved at draw time, so syncTheme() has to redraw after the toggle.');
  }
});
