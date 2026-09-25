/* The hand-written DOM the v2 pane tests run against.

   scripts/ops-aria-shell.test.mjs carries its own copy for assets/aria.js, and
   this is the same idea grown to what a pane page needs: text nodes, events
   that bubble to window, a URL and a history, storage, and a matchMedia the
   rail drawer can listen to. It is a stub rather than a browser, so it is
   deliberately small and every accessor reads back out of the same attribute
   map a browser would use — a stub with a private field per accessor will
   happily agree with code that never set the attribute at all.

   What only a real layout can answer is answered by the two headless-Chrome
   checks, scripts/check-ops-shell-v2.mjs and
   scripts/check-ops-narrow-overflow.mjs. Nothing here measures anything. */
import assert from 'node:assert/strict';

export function makeDom(options) {
  const opts = options || {};
  const tokens = opts.tokens || {};
  let doc;

  function parseSelector(sel) {
    const groups = sel.split(',').map((one) => one.trim()).filter(Boolean);
    const matchers = groups.map((group) => {
      /* A descendant combinator would split into parts carrying a trailing
         space, and a class test for "card " can never match — so the stub
         would return nothing and an assertion of zero would pass vacuously.
         Refuse it loudly instead; the stub supports compound and comma
         selectors only. */
      if (/\s/.test(group.replace(/\[[^\]]*\]/g, ''))) {
        throw new Error('descendant selectors are not supported by the stub: ' + sel);
      }
      const parts = group.split(/(?=[.[#])/);
      const tests = [];
      for (const part of parts) {
        if (!part) continue;
        if (part[0] === '.') {
          const cls = part.slice(1);
          tests.push((el) => (el.getAttribute('class') || '').split(/\s+/).includes(cls));
        } else if (part[0] === '#') {
          const id = part.slice(1);
          tests.push((el) => el.getAttribute('id') === id);
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
    });
    if (!matchers.length) throw new Error('empty selector');
    return (el) => matchers.some((m) => m(el));
  }

  function text(node) {
    const attrs = new Map();
    const el = {
      nodeType: 3,
      tagName: null,
      parentNode: null,
      childNodes: [],
      textContent: String(node),
      getAttribute() { return null; },
      hasAttribute() { return false; },
      setAttribute() {},
      get attributeNames() { return [...attrs.keys()]; },
    };
    return el;
  }

  function element(tag, ns) {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: ns ? tag : tag.toUpperCase(),
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: null,
      style: {
        setProperty(name, value) { el.style[name] = String(value); },
        removeProperty(name) { delete el.style[name]; },
      },
      clientWidth: 0,
      clientHeight: 0,
      textContent: '',
      value: '',
      disabled: false,
      focus() { doc.activeElement = el; },
      blur() { if (doc.activeElement === el) doc.activeElement = null; },
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
      insertBefore(child, before) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const i = before ? el.childNodes.indexOf(before) : -1;
        child.parentNode = el;
        if (i < 0) el.childNodes.push(child);
        else el.childNodes.splice(i, 0, child);
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
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      removeEventListener(name, fn) {
        const all = listeners.get(name) || [];
        const i = all.indexOf(fn);
        if (i >= 0) all.splice(i, 1);
      },
      dispatchEvent(ev) {
        const all = listeners.get(ev.type) || [];
        all.slice().forEach((fn) => fn(ev));
        return true;
      },
      dispatch(name, ev) {
        const all = listeners.get(name) || [];
        assert.ok(all.length, `${tag} has no ${name} listener`);
        const event = { type: name, target: el, preventDefault() {}, stopPropagation() {}, ...ev };
        all.slice().forEach((fn) => fn(event));
        return event;
      },
      listenerCount(name) { return (listeners.get(name) || []).length; },
      contains(other) {
        let node = other;
        while (node) {
          if (node === el) return true;
          node = node.parentNode;
        }
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
      matches(sel) { return parseSelector(sel)(el); },
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
      getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
    };
    Object.defineProperty(el, 'firstChild', { get: () => el.childNodes[0] || null });
    Object.defineProperty(el, 'children', { get: () => el.childNodes.filter((c) => c.tagName) });
    Object.defineProperty(el, 'className', {
      get: () => el.getAttribute('class') || '',
      set: (v) => el.setAttribute('class', v),
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
  const listeners = new Map();
  doc = {
    documentElement: root,
    readyState: opts.readyState || 'complete',
    activeElement: null,
    createElement: (tag) => element(tag),
    createElementNS: (ns, tag) => element(tag, ns),
    createTextNode: (value) => text(value),
    getElementById: (id) => doc.querySelectorAll(`[id="${id}"]`)[0] || null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const all = listeners.get(name) || [];
      const i = all.indexOf(fn);
      if (i >= 0) all.splice(i, 1);
    },
    dispatch(name, ev) {
      const all = listeners.get(name) || [];
      const event = { type: name, preventDefault() {}, ...ev };
      all.slice().forEach((fn) => fn(event));
      return event;
    },
    listenerCount(name) { return (listeners.get(name) || []).length; },
  };

  function storage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      clear: () => map.clear(),
    };
  }

  const href = opts.href || 'https://ops.example.invalid/ops/index.html';
  const url = new URL(href);
  const windowListeners = new Map();
  const media = [];
  const window = {
    document: doc,
    location: {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
      protocol: url.protocol,
      pathname: url.pathname,
      search: url.search,
      assign(next) { window.location.href = next; },
      replace(next) { window.location.href = next; },
    },
    history: {
      entries: [],
      replaceState(state, title, next) { window.history.entries.push(next); },
      pushState(state, title, next) { window.history.entries.push(next); },
    },
    localStorage: storage(),
    sessionStorage: storage(),
    URL,
    URLSearchParams,
    Promise,
    Error,
    Date,
    Math,
    JSON,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    console,
    getComputedStyle: () => ({ getPropertyValue: (n) => tokens[n] || '' }),
    matchMedia(query) {
      const mq = {
        media: query,
        matches: !!(opts.matchMedia && opts.matchMedia[query]),
        handlers: [],
        addEventListener(name, fn) { if (name === 'change') mq.handlers.push(fn); },
        removeEventListener(name, fn) {
          const i = mq.handlers.indexOf(fn);
          if (i >= 0) mq.handlers.splice(i, 1);
        },
        addListener(fn) { mq.handlers.push(fn); },
        set(matches) {
          mq.matches = matches;
          mq.handlers.slice().forEach((fn) => fn({ matches }));
        },
      };
      media.push(mq);
      return mq;
    },
    media,
    addEventListener(name, fn) {
      if (!windowListeners.has(name)) windowListeners.set(name, []);
      windowListeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const all = windowListeners.get(name) || [];
      const i = all.indexOf(fn);
      if (i >= 0) all.splice(i, 1);
    },
    dispatchEvent(ev) {
      const all = windowListeners.get(ev.type) || [];
      all.slice().forEach((fn) => fn(ev));
      return true;
    },
    listenerCount(name) { return (windowListeners.get(name) || []).length; },
    setTimeout: (fn) => { if (opts.runTimers !== false) fn(); return 0; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(); return 0; },
  };
  window.CustomEvent = function CustomEvent(type, init) {
    return { type, detail: (init && init.detail) || null, bubbles: !!(init && init.bubbles) };
  };
  window.window = window;
  window.globalThis = window;
  return { window, doc, root, element, text };
}

/* Every text node under a subtree, joined. textContent on the stub is the
   node's own text and not its descendants', so a test that wants the sentence
   a card actually reads has to walk it. */
export function allText(node) {
  if (!node) return '';
  const own = node.textContent || '';
  const kids = (node.childNodes || []).map(allText).join(' ');
  return (own + ' ' + kids).replace(/\s+/g, ' ').trim();
}

export function allDomTextAndAttrs(node) {
  if (!node) return '';
  const attrs = (node.attributeNames || [])
    .map((name) => node.getAttribute(name))
    .filter((value) => value !== null && value !== undefined)
    .join(' ');
  const kids = (node.childNodes || []).map(allDomTextAndAttrs).join(' ');
  return ((node.textContent || '') + ' ' + attrs + ' ' + kids).replace(/\s+/g, ' ').trim();
}

export function find(node, predicate) {
  if (!node) return null;
  for (const child of node.childNodes || []) {
    if (child.tagName && predicate(child)) return child;
    const deep = find(child, predicate);
    if (deep) return deep;
  }
  return null;
}

export function findAll(node, predicate) {
  const out = [];
  (function walk(n) {
    for (const child of n.childNodes || []) {
      if (child.tagName && predicate(child)) out.push(child);
      walk(child);
    }
  })(node || { childNodes: [] });
  return out;
}
