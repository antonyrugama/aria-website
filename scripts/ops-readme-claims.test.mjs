/* ops/README.md's load-bearing claims, re-derived from the code and compared.

   WHY THIS EXISTS. Seven issues were filed against ops/README.md in one day,
   all of them the same defect: a sentence describing the code more broadly,
   or more narrowly, than the code behaves. Stadiora/Aria#10457, #10474,
   #10510, #10639, #10641, #10655 and #10663. A prose rule costs one issue per
   drift forever; a derived claim costs nothing, so the numbers and lists this
   README is read FOR are written in fenced `claims` blocks and compared here
   against the tree, the pages, the registry, the stylesheets, the guards and
   the workflows.

   HOW A BLOCK IS BOUND. Each block is a fenced code block whose info string is
   `claims id=<id>`, holding `key = value` lines (or bare `key` lines where the
   claim is a list). Every id this file derives must appear exactly once in the
   README and every block in the README must be one this file derives, so a
   block cannot be added, renamed or dropped without a red run — the failure
   mode a guard that silently judges nothing would otherwise have.

   THE EXPECTATION IS NEVER READ OUT OF THE README. Each derivation below
   builds its expected block from the repository: `ops/*.html` for what a page
   loads, `ops/assets/pane-registry.js` executed in a vm for what a pane is,
   the stylesheets parsed into rules for what a focus ring declares, the guard
   scripts and `.github/workflows/*.yml` for what runs where, and
   `scripts/ops-spend-v2.test.mjs`'s own regexes RUN against probe values for
   what its colour guard can and cannot see. The README is only ever the thing
   compared. Break the code and the run goes red with the README untouched;
   that is the property a claims guard has to have and the reason none of these
   assertions greps the README for a sentence.

   NOT COVERED, stated so nobody reads a green run as more than it is:

   - Prose. This file judges the fenced blocks and the file paths the README
     names. A sentence that restates a block's content in English, or makes a
     claim no block carries, is not judged. The remedy used in the rewrite is
     to make the prose point AT a block rather than repeat it, but nothing
     enforces that.
   - `<link>` and `<script>` tags only, spelled statically with a literal
     `assets/…` URL. An asset injected at runtime is invisible to the loader
     map, as is one loaded by a page outside `ops/`.
   - The test-fixture map sees this repo's `read('assets/NAME')` idiom. A test
     that opens an asset another way reads as "nothing loads it".
   - Which pages can DRAW a class is read from the class tokens written in the
     page and in the scripts that page loads. A class assembled at runtime
     (`'badge-' + tone`) is invisible to it, and a name that appears in a
     comment counts as a draw site. It errs towards claiming MORE coverage for
     a class than the page really has, so a `(no page)` value is the strong
     direction and a named page is the weak one.
   - The `painted where drawn` verdict asks only whether SOME rule in a
     stylesheet that page loads carries that class in its selector. It does not
     ask whether the rule applies to the element the page drew, whether another
     rule overrides it, or what it paints. A class painted only through an
     attribute selector — `[class*="badge"]` — reads as unpainted.
   - Whether a guard script sweeps the registry is read from its source naming
     `OpsPaneRegistry`; the pages it renders are the `/ops/*.html` literals in
     it. A page fetched from a variable is not seen.
   - `OpsUsagePayload`'s member list lives in the Aria monorepo
     (`app-backend/server/services/opsUsage/opsUsageView.ts`), so no guard in
     this repository can decide whether a sweep of it is complete. Departure 8
     on People and usage states what it can support instead of claiming a
     sweep; see the NOT COVERED line there.
   - Contrast ratios are measured pixels, not arithmetic over the tree.
     `scripts/check-ops-contrast.mjs` is the oracle for those; the historical
     table in the contrast section is bound here only by WHERE its classes are
     defined and whether any page can draw them.
   - The deleted-asset list is checked for absence only. The pull request each
     line names is not verifiable from a shallow checkout. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (rel) => fs.readdirSync(path.join(ROOT, rel)).sort();

const README_PATH = 'ops/README.md';
const README = read(README_PATH);

const PAGES = list('ops').filter((f) => f.endsWith('.html'));
const ASSETS = list('ops/assets').filter((f) => f.endsWith('.js') || f.endsWith('.css'));
const SCRIPTS = list('scripts').filter((f) => f.endsWith('.mjs'));
const WORKFLOWS = list('.github/workflows').filter((f) => f.endsWith('.yml'));

/* ------------------------------------------------------------ the blocks */

/* Every ```claims id=<id> block in the README, as its raw lines. A block with
   no id, a duplicate id, or a `claims` fence that never closes is a failure
   here rather than a block quietly not judged. */
function claimBlocks(md) {
  const lines = md.split('\n');
  const blocks = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^```claims(?:\s+id=([a-z0-9-]+))?\s*$/.exec(lines[i]);
    if (!open) continue;
    assert.ok(open[1], `${README_PATH}:${i + 1}: a claims block with no id=`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== '```'; j += 1) body.push(lines[j]);
    assert.ok(j < lines.length, `${README_PATH}:${i + 1}: claims block never closes`);
    assert.ok(!blocks.has(open[1]), `${README_PATH}:${i + 1}: id=${open[1]} appears twice`);
    blocks.set(open[1], { line: i + 1, lines: body.filter((l) => l.trim() !== '') });
    i = j;
  }
  return blocks;
}

const BLOCKS = claimBlocks(README);

/* ------------------------------------------------------- what a page loads */

const ASSET_REF = /(?:<link\b[^>]*\bhref=|<script\b[^>]*\bsrc=)["']assets\/([A-Za-z0-9._-]+)["']/g;

function loadedAssets(page) {
  const html = read(path.join('ops', page));
  return [...html.matchAll(ASSET_REF)].map((m) => m[1]);
}

const LOADERS = new Map(ASSETS.map((a) => [a, []]));
for (const page of PAGES) {
  for (const asset of loadedAssets(page)) {
    if (!LOADERS.has(asset)) LOADERS.set(asset, []);
    if (!LOADERS.get(asset).includes(page)) LOADERS.get(asset).push(page);
  }
}

/* --------------------------------------------------------------- the panes */

/* Out of the registry by running it, not by reading it: the registry is a
   browser file that hands its table to whatever `window` it is passed, and a
   regex over its source would be the second copy of the table it exists to
   prevent. Same move as scripts/check-ops-narrow-overflow.mjs. */
function registryPanes() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('ops/assets/pane-registry.js'), sandbox, { filename: 'pane-registry.js' });
  const registry = sandbox.window.OpsPaneRegistry;
  assert.ok(registry && registry.PANES, 'pane-registry.js defined no window.OpsPaneRegistry.PANES');
  return registry.PANES;
}

/* ---------------------------------------------------------------- the CSS */

/* Rules by what their selector list targets rather than by how a selector is
   spelled, so `.a, .b { … }` is two rules' worth of reach and not invisible.
   Ported from the same shape in scripts/ops-analytics-v2.test.mjs. */
function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 0;
    let end = open;
    for (; end < src.length; end += 1) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, end);
    if (prelude.startsWith('@')) {
      if (/^@(media|supports)\b/.test(prelude)) out.push(...cssRules(body));
    } else if (prelude) {
      out.push({ selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean), body });
    }
    i = end + 1;
  }
  return out;
}

const declarations = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).sort();

/* ------------------------------------------------------------ comparison */

/* One comparison shape for every block, so a failure names the id, the README
   line the block starts on, and the two lists. */
/* A derivation that produces nothing has judged nothing, which is the failure
   mode this whole file exists to prevent — except for deleted-assets, whose
   empty state (the README names no file the tree has lost) is legitimate. */
const EMPTY_OK = new Set(['deleted-assets']);

function judge(id, derived) {
  const block = BLOCKS.get(id);
  assert.ok(block, `${README_PATH} carries no claims block with id=${id}`);
  assert.ok(derived.length > 0 || EMPTY_OK.has(id), `the derivation for id=${id} produced nothing to judge`);
  assert.deepStrictEqual(
    block.lines.map((l) => l.trim()),
    derived,
    `${README_PATH}:${block.line} claims id=${id} disagrees with the code it describes`
  );
  return derived.length;
}

const DERIVED = {};

/* Every asset under ops/assets, and the pages that load it. */
DERIVED['assets-by-page'] = () => [...LOADERS.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([asset, pages]) => `${asset} = ${pages.length ? pages.slice().sort().join(', ') : '(no page)'}`);

/* The assets no page loads, and the test files that load them from disk. */
DERIVED['assets-only-in-tests'] = () => [...LOADERS.entries()]
  .filter(([, pages]) => pages.length === 0)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([asset]) => {
    const spelling = new RegExp(`read\\(\\s*['"](?:\\.\\./ops/)?assets/${asset.replace(/\./g, '\\.')}['"]`);
    const readers = SCRIPTS.filter((s) => spelling.test(read(path.join('scripts', s))));
    return `${asset} = ${readers.length ? readers.join(', ') : '(nothing)'}`;
  });

/* Every pane the registry declares: its page, the shell that boots it, its
   own stylesheet. */
DERIVED['panes'] = () => {
  const panes = registryPanes();
  return Object.keys(panes).map((key) => {
    const file = panes[key].file;
    assert.ok(fs.existsSync(path.join(ROOT, 'ops', file)),
      `pane-registry.js declares pane "${key}" as ops/${file}, which is not a file here`);
    const loaded = loadedAssets(file);
    const shell = loaded.includes('shell-pane-v2.js') ? 'shell-pane-v2.js'
      : loaded.includes('shell.js') ? 'shell.js' : '(no shell)';
    const own = loaded.filter((a) => /^pane-.*\.css$/.test(a));
    return `${key} = ${file}, ${shell}, ${own.length ? own.join(' + ') : '(no sheet of its own)'}`;
  });
};

/* Every browser guard: the workflow that runs it, and what it renders. */
DERIVED['browser-guards'] = () => SCRIPTS
  .filter((s) => /^check-ops-.*\.mjs$/.test(s))
  .map((script) => {
    const src = read(path.join('scripts', script));
    const command = `node scripts/${script}`;
    const workflows = WORKFLOWS.filter((w) => read(path.join('.github/workflows', w)).includes(command));
    const urls = [...new Set([...src.matchAll(/['"`](\/ops\/[A-Za-z0-9._-]+\.html)['"`]/g)].map((m) => m[1]))].sort();
    const everyPage = PAGES.length > 0 && PAGES.every((p) => urls.includes(`/ops/${p}`));
    const where = [];
    if (/OpsPaneRegistry/.test(src)) where.push('every pane the registry declares');
    if (everyPage) where.push('every page in ops/');
    else where.push(...urls);
    return `${script} = ${workflows.join(', ') || '(no workflow)'}; ${where.join(' + ') || '(no page named in its source)'}`;
  });

/* The focus ring on every sideways-scrolling box a v2 pane sheet declares.
   The box is found by its own `overflow-x: auto`, never by its class name, so
   a renamed box is still judged. */
DERIVED['table-focus-rings'] = () => {
  const out = [];
  for (const sheet of ASSETS.filter((a) => /^pane-.*-v2\.css$/.test(a))) {
    const rules = cssRules(read(path.join('ops/assets', sheet)));
    const boxes = new Set();
    for (const rule of rules) {
      if (!/overflow-x\s*:\s*auto/.test(rule.body)) continue;
      rule.selectors.forEach((s) => boxes.add(s));
    }
    for (const box of [...boxes].sort()) {
      const own = rules
        .filter((r) => r.selectors.includes(`${box}:focus-visible`))
        .flatMap((r) => declarations(r.body))
        .sort();
      out.push(`${sheet} ${box} = ${own.length ? own.join('; ') : "(no rule of its own; aria.css's ring, 2px outside)"}`);
    }
  }
  return out;
};

/* What the Cloud costs colour guard can see, by RUNNING its own two matchers
   against probe values rather than by restating them. The regexes are lifted
   from scripts/ops-spend-v2.test.mjs; a failure to lift them is a failure
   here, never a skipped probe. */
const COLOUR_PROBES = {
  properties: [
    '--sp-ink', 'color', 'background-image', 'border-color', 'outline-color',
    'fill', 'stroke', 'box-shadow', 'filter',
    'text-decoration', 'text-emphasis', 'mask-image', 'accent-color'
  ],
  values: [
    '#2b7fff', '#333', 'rgb(255, 0, 0)', 'hsl(0 100% 50%)',
    'crimson', 'oklch(0.7 0.2 250)', 'lab(50% 40 59)',
    'color-mix(in srgb, crimson 50%, transparent)'
  ]
};

DERIVED['spend-colour-gate'] = () => {
  const src = read('scripts/ops-spend-v2.test.mjs');
  const slot = /const COLOUR_SLOT = (\/[^\n]+\/[a-z]*);/.exec(src);
  assert.ok(slot, 'scripts/ops-spend-v2.test.mjs: could not lift COLOUR_SLOT');
  const gate = new RegExp(slot[1].slice(1, slot[1].lastIndexOf('/')), slot[1].slice(slot[1].lastIndexOf('/') + 1));

  const fn = /function rawColourSpellings\([\s\S]*?\n}/.exec(src);
  assert.ok(fn, 'scripts/ops-spend-v2.test.mjs: could not lift rawColourSpellings');
  const spellings = [...fn[0].matchAll(/body\.match\((\/[^\n]+?\/[a-z]*)\)/g)].map((m) => {
    const lit = m[1];
    return new RegExp(lit.slice(1, lit.lastIndexOf('/')), lit.slice(lit.lastIndexOf('/') + 1).replace('g', ''));
  });
  assert.equal(spellings.length, 2, 'rawColourSpellings no longer has exactly two matchers');

  return [
    ...COLOUR_PROBES.properties.map((prop) =>
      `property ${prop} = ${gate.test(prop) ? 'value scan looks here' : 'value scan does not look here'}`),
    ...COLOUR_PROBES.values.map((value) =>
      `value ${value} = ${spellings.some((re) => re.test(value)) ? 'spelling clause reads it' : 'spelling clause cannot read it'}`)
  ];
};

/* The v1 status classes the contrast record below is written about: where
   each one is still declared, and which pages can still draw it. */
const V1_STATUS_CLASSES = [
  'badge', 'badge-ok', 'badge-warn', 'badge-crit', 'badge-info', 'badge-brand',
  'flagchip', 'tag-mobile', 'tag-coaches', 'tag-backend', 'build', 'masked',
  'verdict-better', 'verdict-worse', 'verdict-slightly-worse', 'reveal-note',
  'nav-count', 'btn-danger', 'field-error', 'callout-warn'
];

/* Every class token a file can put on an element: the `class` attributes in a
   page, and in a script the strings a `className` or a `classList` call is
   built from. A token assembled at run time (`'badge-' + tone`) is not seen —
   which is why a `(no page)` here is the strong direction and a named page the
   weak one. */
function classTokens(src) {
  const tokens = new Set();
  const add = (text) => text.split(/\s+/).filter(Boolean).forEach((t) => tokens.add(t));
  for (const m of src.matchAll(/\bclass="([^"]*)"/g)) add(m[1]);
  for (const m of src.matchAll(/\bclassName\s*[:=]\s*(['"`])([^'"`]*)\1/g)) add(m[2]);
  for (const m of src.matchAll(/\bclassList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
    for (const lit of m[1].matchAll(/(['"`])([^'"`]*)\1/g)) add(lit[2]);
  }
  /* The ternary and concatenation idiom the panes use for a variant:
     `className: 'pill' + (warn ? ' warn' : '')` — each literal is a token. */
  for (const m of src.matchAll(/\bclassName\s*[:=]\s*([^,\n]*)/g)) {
    for (const lit of m[1].matchAll(/(['"`])([^'"`]*)\1/g)) add(lit[2]);
  }
  return tokens;
}

const PAGE_TOKENS = new Map(PAGES.map((page) => {
  const tokens = classTokens(read(path.join('ops', page)));
  for (const asset of loadedAssets(page)) {
    if (!asset.endsWith('.js')) continue;
    for (const token of classTokens(read(path.join('ops/assets', asset)))) tokens.add(token);
  }
  return [page, tokens];
}));

DERIVED['v1-status-classes'] = () => V1_STATUS_CLASSES.map((cls) => {
  const selector = new RegExp(`\\.${cls}(?![\\w-])`);
  const declaring = (sheet) => cssRules(read(path.join('ops/assets', sheet)))
    .some((r) => r.selectors.some((s) => selector.test(s)));
  const sheets = ASSETS.filter((a) => a.endsWith('.css')).filter(declaring);
  const drawnBy = PAGES.filter((page) => PAGE_TOKENS.get(page).has(cls));
  /* The half that matters on a live page: a page can write the token and load
     no stylesheet that declares it, which paints nothing and fails silently.
     Decided per page from that page's OWN sheets, never from the global list
     on the left of this line. */
  const unpainted = drawnBy.filter((page) =>
    !loadedAssets(page).filter((a) => a.endsWith('.css')).some(declaring));
  const verdict = drawnBy.length === 0 ? ''
    : unpainted.length === 0 ? '; painted where drawn'
    : `; no sheet declares it on ${unpainted.join(', ')}`;
  return `.${cls} = declared in ${sheets.join(', ') || '(no sheet)'}; drawn by ${drawnBy.join(', ') || '(no page)'}${verdict}`;
});

/* What the v2 showcase guard pins, counted out of its own tables rather than
   out of the sentence that describes them. The parse is asserted, so a
   refactor that moves these constants is a red run with a named cause, never
   a silently uncounted one. */
DERIVED['shell-v2-pins'] = () => {
  const src = read('scripts/check-ops-shell-v2.mjs');
  const grab = (name, re) => {
    const m = re.exec(src);
    assert.ok(m, `scripts/check-ops-shell-v2.mjs: could not lift ${name}`);
    return m[1];
  };
  const keys = (body) => new Set([...body.matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((m) => m[1]));
  const invariant = keys(grab('INVARIANT', /const INVARIANT = \{([\s\S]*?)\n\};/));
  const palette = grab('PALETTE', /const PALETTE = \{([\s\S]*?)\n\};/);
  const themes = [...palette.matchAll(/\n {2}([a-z]+): \{([\s\S]*?)\n {2}\},?/g)]
    .map(([, theme, body]) => [theme, keys(body)]);
  assert.ok(themes.length > 0, 'scripts/check-ops-shell-v2.mjs: PALETTE declared no themes');
  const scheme = grab('COLOR_SCHEME', /const COLOR_SCHEME = \{([\s\S]*?)\};/);
  return [
    ...themes.map(([theme, set]) => `palette tokens pinned for ${theme} = ${set.size}`),
    `tokens pinned the same in every theme = ${invariant.size}`,
    ...themes.map(([theme, set]) => `tokens pinned in total for ${theme} = ${new Set([...set, ...invariant]).size}`),
    `color-scheme pinned per theme = ${[...scheme.matchAll(/([a-z]+):\s*'/g)].length}`
  ];
};

/* Assets this README still talks about and the tree no longer holds. Checked
   for absence, which is the half that rots: a file that comes back leaves the
   prose around it describing something that is live again. */
DERIVED['deleted-assets'] = () => {
  const block = BLOCKS.get('deleted-assets');
  assert.ok(block, `${README_PATH} carries no claims block with id=deleted-assets`);
  return block.lines
    .map((l) => l.trim())
    .map((line) => {
      const file = line.split('=')[0].trim();
      assert.ok(/^[A-Za-z0-9._/-]+\/[A-Za-z0-9._-]+$/.test(file),
        `deleted-assets: "${line}" does not start with a repository path`);
      assert.ok(!fs.existsSync(path.join(ROOT, file)),
        `${README_PATH} says ${file} is deleted, and it is in the tree`);
      const base = path.basename(file);
      const pages = PAGES.filter((page) => loadedAssets(page).includes(base));
      const spelling = new RegExp(`assets/${base.replace(/\./g, '\\.')}`);
      const readers = SCRIPTS.filter((s) => spelling.test(read(path.join('scripts', s))));
      return `${file} = gone; ${pages.length ? `still loaded by ${pages.join(', ')}` : 'loaded by no page'}`
        + `; ${readers.length ? `named in ${readers.join(', ')}` : 'named by no script'}`;
    });
};

/* ------------------------------------------------------------------ tests */

test('every claims block is derived here, and every derivation has a block', () => {
  assert.deepStrictEqual([...BLOCKS.keys()].sort(), Object.keys(DERIVED).sort(),
    'a claims block was added, renamed or dropped without a derivation to hold it');
});

const JUDGED = {};

for (const id of Object.keys(DERIVED)) {
  test(`ops/README.md claims id=${id} still describe the code`, () => {
    JUDGED[id] = judge(id, DERIVED[id]());
  });
}

/* The README names files. Every one of them is either in the tree or declared
   dead in the deleted-assets block — which is what makes a deletion elsewhere
   in the repository red here rather than silently stale. */
test('every repository file ops/README.md names is in the tree or declared deleted', () => {
  const inTree = new Set([
    ...PAGES.map((p) => `ops/${p}`),
    ...list('ops/assets').map((a) => `ops/assets/${a}`),
    ...list('scripts').map((s) => `scripts/${s}`),
    ...WORKFLOWS.map((w) => `.github/workflows/${w}`)
  ]);
  const byBasename = new Map();
  for (const file of inTree) byBasename.set(path.basename(file), file);

  const deleted = new Set((BLOCKS.get('deleted-assets')?.lines || [])
    .map((l) => l.trim().split('=')[0].trim())
    .flatMap((p) => [p, path.basename(p)]));

  /* Paths in the Aria monorepo rather than here. They are named with their
     monorepo directory, which is what this recognises them by. */
  const FOREIGN = /^(docs|app-backend|aria-api|mobile-app|coaches-web|packages)\//;

  const lines = README.split('\n');
  const missing = [];
  let judged = 0;
  lines.forEach((line, i) => {
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const candidate = /^([A-Za-z0-9._/-]+\.(?:css|js|mjs|html|yml))(?::\d+(?:[-,]\d+)*)?$/.exec(span[1]);
      if (!candidate) continue;
      const file = candidate[1];
      if (FOREIGN.test(file)) continue;
      judged += 1;
      if (deleted.has(file) || deleted.has(path.basename(file))) continue;
      if (inTree.has(file)) continue;
      if (byBasename.has(path.basename(file))) continue;
      missing.push(`${README_PATH}:${i + 1}: names ${file}, which is neither in the tree nor in the deleted-assets block`);
    }
  });
  assert.ok(judged > 0, 'no file path was judged, so this test proved nothing');
  assert.deepStrictEqual(missing, [], `\n${missing.join('\n')}\n`);
  JUDGED['file-paths'] = judged;
});

/* A claims guard that judged nothing is the worst outcome this file has, and
   a green run says nothing about how much was compared. So the count goes in
   the log, per block, and the run is red if any of it is empty. */
test('the run reports what it judged', () => {
  const rows = Object.keys(JUDGED).sort().map((id) => `  ${id}: ${JUDGED[id]}`);
  const total = Object.values(JUDGED).reduce((a, b) => a + b, 0);
  console.log(`ops/README.md claims judged against the code:\n${rows.join('\n')}\n  TOTAL: ${total}`);
  assert.equal(Object.keys(JUDGED).length, Object.keys(DERIVED).length + 1,
    'a block was not judged in this run');
  assert.ok(total > 0, 'nothing was judged');
});
