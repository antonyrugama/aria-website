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

   NO VALUE IS READ OUT OF THE README. Each derivation below builds its
   expected block from the repository: `ops/*.html` for what a page loads,
   `ops/assets/pane-registry.js` executed in a vm for what a pane is, the
   stylesheets parsed into rules for what a focus ring declares, the guard
   scripts and `.github/workflows/*.yml` for what runs where, and
   `scripts/ops-spend-v2.test.mjs`'s own regexes RUN against probe values for
   what its colour guard can and cannot see. Break the code and the run goes
   red with the README untouched; that is the property a claims guard has to
   have and the reason none of these assertions greps the README for a
   sentence.

   FIVE BLOCKS CANNOT DERIVE WHICH ROWS THEY CARRY, and it is worth being
   exact about what that does and does not mean. `source-anchors` reads which
   file and which quoted comment to go looking for and `deleted-assets` reads
   which absent path to look for, both out of the README; `v1-status-classes`,
   `spend-colour-gate` and `spend-write-gate` read their subjects from
   V1_STATUS_FAMILIES and V1_STATUS_SINGLETONS, COLOUR_PROBES and
   WRITE_PROBES in this file. All five
   then derive every value — the line
   number, the uniqueness of an anchor, the absence of a file, who loads and
   reads it, what the spend guard's own matchers answer. Editing a value in
   any of them is red. What that shape cannot catch on its own is a subject
   DELETED, which shrinks the expectation with it, so all five are pinned row
   by row in `REQUIRED_ROWS` at the foot of this file. A count would not do:
   pin the size and a block that grows by one absorbs the deletion of a
   different row silently. Every other block derives its row set as well as
   its values, so shrinking one is already red without a pin.

   NOT COVERED, stated so nobody reads a green run as more than it is:

   - The WORDS in a checks-table row. That table is held to the browser
     guards only by its row SET: every `check-ops-*.mjs` in `scripts/` has to
     be named by some row. What the row then says that guard sees is prose,
     and a row describing a guard it no longer describes is invisible here.
     The table is also found by its exact header line, so reformatting that
     header is a failure rather than a silent skip.
   - A file path spelled without a directory AND with an extension no file in
     `ops/`, `ops/assets/`, `scripts/` or `.github/workflows/` uses. The sweep
     reads a bare `name.ext` as a path only when the tree already has that
     extension, because `payload.data` and `availability.state` are spelled
     the same way. A span carrying a directory is swept whatever its
     extension.
   - Prose. This file judges the fenced blocks and the file paths the README
     names. A sentence that restates a block's content in English, or makes a
     claim no block carries, is not judged. The remedy used in the rewrite is
     to make the prose point AT a block rather than repeat it, but nothing
     enforces that.
   - `<link>` and `<script>` tags only, spelled statically with a literal
     `assets/…` URL. An asset injected at runtime is invisible to the loader
     map, as is one loaded by a page outside `ops/`. Every attribute read out
     of a page — `href`, `src`, `http-equiv`, `style` — goes through one
     matcher that allows whitespace around the `=` and reads the value quoted
     either way or unquoted, so a legal respelling is not a hole in one check
     and not in another. An attribute whose NAME is assembled at runtime is
     still invisible, and so is markup a script writes into the page.
   - The test-fixture map sees this repo's `read('assets/NAME')` idiom. A test
     that opens an asset another way reads as "nothing loads it".
   - Which pages can DRAW a class is read from the class tokens written in the
     page and in the scripts that page loads: `class=` and `class:`,
     `className`, `classList.add|remove|toggle` and `setAttribute('class', …)`,
     each with a literal. The error runs BOTH ways and NEITHER value is the
     strong one. A name in a comment counts as a draw site, so a named page can
     be an over-report; a class assembled at run time (`'badge-' + tone`) or
     written through a helper this list does not name is invisible, so a
     `(no page)` can be an under-report — `ops/assets/icons.js` already spells
     one of these with `setAttribute`, which is why that spelling is read
     here.
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
     line names is not verifiable from a shallow checkout, and this file is
     excluded from the scripts that "name" a dead asset, because it names all
     of them by construction.
   - A claims fence shown as an example inside another fenced block is read as
     a real block. The reader is line-based and does not track an enclosing
     fence, so the format is described in prose in the README and never
     demonstrated there. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (rel) => fs.readdirSync(path.join(ROOT, rel)).sort();

const SELF = path.basename(fileURLToPath(import.meta.url));
const README_PATH = 'ops/README.md';
const README = read(README_PATH);

const PAGES = list('ops').filter((f) => f.endsWith('.html'));
const ASSETS = list('ops/assets').filter((f) => f.endsWith('.js') || f.endsWith('.css'));
const SCRIPTS = list('scripts').filter((f) => f.endsWith('.mjs'));
const WORKFLOWS = list('.github/workflows').filter((f) => f.endsWith('.yml'));

/* ------------------------------------------------------------ the blocks */

/* Every claims block in the README, as its raw lines. Any fence whose info
   string starts with the word `claims` is taken as one — three backticks or
   more, a tilde fence, and a space before the word are all the same block to
   CommonMark and all the same block here — so a fence this reader cannot
   parse (a capital in the id, a stray word after it, no id at all) is a
   failure rather than a block quietly not judged. A duplicate id and a block
   that never closes are failures too. A claims fence shown as an EXAMPLE
   inside another fenced block is read as a real one: this reader is
   line-based and does not track an enclosing fence, which is why the format
   is described in prose here and never demonstrated. A fence inside a
   blockquote or a list item is a real block to CommonMark and cannot be
   judged here either, so it is refused by name rather than skipped. */
function claimBlocks(md) {
  const lines = md.split('\n');
  const blocks = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    /* A fence inside a Markdown container — a blockquote, a list item — is
       a real claims block to CommonMark and is NOT parsed here. It is a
       failure rather than a silent skip, which is the whole point of
       taking any line that says `claims` after a fence. */
    const contained = /^[>\s]*>[>\s]*(`{3,}|~{3,})\s*claims\b/.exec(lines[i])
      || /^\s*(?:[-*+]|\d+[.)])\s+(`{3,}|~{3,})\s*claims\b/.exec(lines[i]);
    assert.ok(!contained,
      `${README_PATH}:${i + 1}: a claims fence inside a Markdown container (blockquote or list ` +
      'item). This reader is line-based and cannot judge one; move it to the top level.');
    const fence = /^(\s*)(`{3,}|~{3,})\s*claims\b(.*)$/.exec(lines[i]);
    if (!fence) continue;
    const open = /^\s+id=([a-z0-9-]+)\s*$/.exec(fence[3]);
    assert.ok(
      open,
      `${README_PATH}:${i + 1}: a claims fence this file cannot read: ${fence[2]}claims${fence[3]}` +
        ' — the info string must be exactly ```claims id=<lower-case-kebab-id>',
    );
    const id = open[1];
    const indent = fence[1];
    const delimiter = fence[2];
    const closes = new RegExp(`^${delimiter[0] === '`' ? '`' : '~'}{${delimiter.length},}$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !closes.test(lines[j].trim()); j += 1) {
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
    }
    assert.ok(j < lines.length, `${README_PATH}:${i + 1}: claims block never closes`);
    assert.ok(!blocks.has(id), `${README_PATH}:${i + 1}: id=${id} appears twice`);
    blocks.set(id, { line: i + 1, lines: body.filter((l) => l.trim() !== '') });
    i = j;
  }
  return blocks;
}

const BLOCKS = claimBlocks(README);

/* ------------------------------------------------------- what a page loads */

/* One spelling of "this attribute holds this value", used everywhere an
   attribute is read out of a page, rather than four regexes that drift apart.
   Whitespace around the `=` is legal HTML, and so is an unquoted value with
   no spaces in it: `href = assets/ops.css` loads the sheet exactly as
   `href="assets/ops.css"` does. Round 6 taught the loader map both shapes and
   left the three matchers beside it tight, which round 7 then found as a
   green run; there is now one place to teach. */
const attr = (name, value) =>
  String.raw`(?<![-\w])${name}\s*=\s*(?:"${value}"|'${value}'|(?:${value})(?=[\s/>]))`;

const ASSET_REF = new RegExp(`(?:<link\\b[^>]*${attr('href', String.raw`assets\/([A-Za-z0-9._-]+)`)}|<script\\b[^>]*${attr('src', String.raw`assets\/([A-Za-z0-9._-]+)`)})`, 'g');

/* Comments are cut before any tag in a page is counted: a page that keeps an
   old <link> commented out does not load it, and counting it made `ops.css`
   read as loaded by a page that only remembers it. Every reading of page
   markup in this file goes through here, so a commented-out tag is invisible
   to all of them and not just to the loader map. */
function markup(page) {
  return read(path.join('ops', page)).replace(/<!--[\s\S]*?-->/g, '');
}

/* Whitespace around the `=` is legal HTML and is read wherever an attribute
   is matched here -- `href = "assets/ops.css"` loads the sheet, and a
   tighter regex answered that it does not. */
function loadedAssets(page) {
  return [...markup(page).matchAll(ASSET_REF)].map((m) => m.slice(1).find(Boolean));
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
/* The ring a box with no rule of its own is left with: aria.css's global
   :focus-visible, read from the sheet rather than named in a sentence here. */
function globalRing() {
  const rule = cssRules(read('ops/assets/aria.css')).find((r) => r.selectors.includes(':focus-visible'));
  assert.ok(rule, 'ops/assets/aria.css declares no bare :focus-visible rule');
  const own = declarations(rule.body).filter((d) => /^outline/.test(d)).sort();
  assert.ok(own.length > 0, 'ops/assets/aria.css: the global :focus-visible rule sets no outline');
  return `aria.css's ring, ${own.join('; ')}`;
}

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
      out.push(`${sheet} ${box} = ${own.length ? own.join('; ') : `(no rule of its own; ${globalRing()})`}`);
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

/* The three spellings the spend module's write guard is documented as NOT
   matching, run against the guard's own two patterns rather than restated.
   Each probe is also looked for in the module itself, because "walks through
   the guard" only matters while the module does not write it. A sentence here
   once counted these three as four. */
const WRITE_PROBES = [
  ["setAttributeNS(null, 'style', …)", "el.setAttributeNS(null, 'style', 'color: red');", /setAttributeNS/],
  ['a capitalised Style: key on h()', "h('div', { Style: 'color: red' })", /[{,]\s*['"`]?Style['"`]?\s*:/],
  ['createContextualFragment()', 'document.createRange().createContextualFragment(markup);', /createContextualFragment/],
];

DERIVED['spend-write-gate'] = () => {
  const src = read('scripts/ops-spend-v2.test.mjs');
  const lift = (name) => {
    const m = new RegExp(`const ${name} = (/[^\\n]+/[a-z]*);`).exec(src);
    assert.ok(m, `scripts/ops-spend-v2.test.mjs: could not lift ${name}`);
    return new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), m[1].slice(m[1].lastIndexOf('/') + 1));
  };
  const patterns = [lift('MARKUP_WRITE'), lift('STYLE_ATTR_WRITE')];
  /* Comments stripped the way ops-spend-v2.test.mjs strips them for PANE_CODE,
     so a spelling named in a comment is not read as a write. */
  const module = read('ops/assets/pane-spend.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return WRITE_PROBES.map(([label, probe, inModule]) => {
    const seen = patterns.some((re) => re.test(probe));
    return `${label} = ${seen ? 'the guard matches it' : 'walks through the guard'}`
      + `; ${inModule.test(module) ? 'and the module writes it' : 'and the module does not write it'}`;
  });
};

/* The v1 status classes the contrast record below is written about: where
   each one is still declared, and which pages can still draw it.
   A sheet does not say which of its classes carry status, so the SUBJECTS
   start here rather than in the code. What does not have to be typed is a
   FAMILY: four of them are status from end to end, so every class `ops.css`
   declares under those prefixes is read out of the sheet. A sibling added to
   any of them — `.badge-ai` and `.tag-watch` were both missing from the
   hand-typed list this replaced — joins the block on its own. The seven
   singletons are still hand-chosen, and an omission among THOSE is nobody's
   red; all four families and all seven singletons are pinned by name in
   REQUIRED_ROWS, so a family or a singleton can only go by being deleted
   there too. */
const V1_STATUS_FAMILIES = ['badge', 'tag', 'callout', 'verdict'];
const V1_STATUS_SINGLETONS = [
  'flagchip', 'build', 'masked', 'reveal-note', 'nav-count', 'btn-danger', 'field-error'
];
function v1StatusClasses() {
  const declared = new Set();
  const sheet = read('ops/assets/ops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of sheet.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
    declared.add(m[1]);
  }
  const families = V1_STATUS_FAMILIES.flatMap((family) => {
    const members = [...declared].filter((n) => n === family || n.startsWith(`${family}-`)).sort();
    assert.ok(members.length > 0,
      `ops/assets/ops.css declares no .${family} class at all, so that family is judging nothing`);
    return members;
  });
  return [...new Set([...families, ...V1_STATUS_SINGLETONS])];
}

/* Every class token a file can put on an element: the `class` attributes in a
   page, the `class:` and `className` keys and assignments in a script, the
   literals a `classList` call carries, and `setAttribute('class', …)`, which
   `ops/assets/icons.js` uses. The error runs BOTH ways, so neither value here
   is the strong one: a name in a comment counts as a draw site, which
   over-reports, and a token assembled at run time (`'badge-' + tone`) or
   spelled any way not listed above is invisible, which under-reports. */
function classTokens(src) {
  const tokens = new Set();
  const add = (text) => text.split(/\s+/).filter(Boolean).forEach((t) => tokens.add(t));
  for (const m of src.matchAll(/\bclass\s*=\s*(["'])([^"']*)\1/g)) add(m[2]);
  for (const m of src.matchAll(/\bclassName\s*[:=]\s*(['"`])([^'"`]*)\1/g)) add(m[2]);
  for (const m of src.matchAll(/\bsetAttribute\(\s*(['"`])class(?:Name)?\1\s*,([^)]*)\)/g)) {
    for (const lit of m[2].matchAll(/(['"`])([^'"`]*)\1/g)) add(lit[2]);
  }
  for (const m of src.matchAll(/(?:^|[{,\s])class\s*:\s*([^,\n}]*)/g)) {
    for (const lit of m[1].matchAll(/(['"`])([^'"`]*)\1/g)) add(lit[2]);
  }
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

DERIVED['v1-status-classes'] = () => v1StatusClasses().map((cls) => {
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

/* Every sideways-scrolling box any stylesheet here declares, and whether the
   same sheet positions it. `overflow-x` clips only a descendant whose
   containing block is the box, so a static box does not clip an absolutely
   positioned child - which is the premise departure 15 is written about. The
   box is found by its own `overflow-x`, never by class name. */
DERIVED['scroll-wrapper-position'] = () => {
  const out = [];
  for (const sheet of ASSETS.filter((a) => a.endsWith('.css'))) {
    const rules = cssRules(read(path.join('ops/assets', sheet)));
    const boxes = new Map();
    for (const rule of rules) {
      if (!/overflow-x\s*:\s*auto/.test(rule.body)) continue;
      rule.selectors.forEach((sel) => boxes.set(sel, true));
    }
    for (const box of [...boxes.keys()].sort()) {
      const positions = rules
        .filter((r) => r.selectors.includes(box))
        .flatMap((r) => declarations(r.body))
        .filter((d) => /^position:/.test(d));
      out.push(`${sheet} ${box} = ${positions.length ? positions.join('; ') : 'position: static (the sheet sets none)'}`);
    }
  }
  return out;
};

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

/* Every place this README points at a line of code. The anchor it quotes is
   the subject and comes from the block; the LINE is derived. An anchor that
   no longer appears in the file it names, or appears twice, is a failure
   here rather than a number that silently drifts - which is what happened to
   three of the seven line citations this file used to carry. */
DERIVED['source-anchors'] = () => {
  const block = BLOCKS.get('source-anchors');
  assert.ok(block, `${README_PATH} carries no claims block with id=source-anchors`);
  return block.lines.map((l) => l.trim()).map((line) => {
    const m = /^(\S+) "(.+)" = line \d+$/.exec(line);
    assert.ok(m, `source-anchors: "${line}" is not <path> "<anchor>" = line <n>`);
    const [, file, needle] = m;
    assert.ok(fs.existsSync(path.join(ROOT, file)), `source-anchors: ${file} is not a file here`);
    const hits = read(file).split('\n')
      .map((text, i) => (text.includes(needle) ? i + 1 : 0))
      .filter(Boolean);
    assert.equal(hits.length, 1,
      `${file} contains "${needle}" ${hits.length} times, so it does not point at one line`);
    return `${file} "${needle}" = line ${hits[0]}`;
  });
};

/* The v1 and v2 layers collide, which is why a page loads one sheet or the
   other and never both. Which names collide is counted out of the two sheets
   rather than remembered: a class is "declared" by a sheet when some selector
   in it carries that class, and the widest eight are the eight with the most
   selectors in ops.css, ties broken alphabetically. A hand-typed list of these
   is how `.pill` and `.tbl` came to be claimed for a sheet that never had
   either. */
function declaredClasses(file) {
  const counts = new Map();
  for (const rule of cssRules(read(file))) {
    for (const selector of rule.selectors) {
      for (const hit of selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
        counts.set(hit[1], (counts.get(hit[1]) || 0) + 1);
      }
    }
  }
  return counts;
}

DERIVED['v1-v2-collision'] = () => {
  const v1 = declaredClasses('ops/assets/ops.css');
  const v2 = declaredClasses('ops/assets/aria.css');
  const shared = [...v1.keys()].filter((c) => v2.has(c));
  const widest = shared.slice()
    .sort((a, b) => v1.get(b) - v1.get(a) || a.localeCompare(b))
    .slice(0, 8)
    .sort();
  return [
    `class names declared in both ops.css and aria.css = ${shared.length}`,
    ...widest.map((c) => `.${c} = ${v1.get(c)} selectors in ops.css, ${v2.get(c)} in aria.css`),
  ];
};

/* The dark --text-3 figure that item is read for. sRGB relative luminance and
   the WCAG 2 contrast ratio, computed over every background token the sheet
   declares in the same :root the ink is declared in, so the floor is the worst
   pairing rather than a remembered one. */
function luminance(hex) {
  const channel = (n) => (n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

DERIVED['dark-text-3'] = () => {
  const dark = cssRules(read('ops/assets/ops.css'))
    .find((rule) => rule.selectors.includes(':root'));
  assert.ok(dark, 'ops.css declares no :root');
  const tokens = new Map();
  for (const decl of declarations(dark.body)) {
    const m = /^(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})$/.exec(decl);
    if (m) tokens.set(m[1], m[2].toUpperCase());
  }
  const ink = tokens.get('--text-3');
  assert.ok(ink, 'ops.css\'s dark :root declares no --text-3');
  const surfaces = [...tokens.entries()].filter(([name]) => /^--(bg|surface-)/.test(name));
  assert.ok(surfaces.length > 0, 'ops.css\'s dark :root declares no background tokens');
  const worst = surfaces
    .map(([name, hex]) => ({ name, hex, r: ratio(ink, hex) }))
    .sort((a, b) => a.r - b.r)[0];
  return [
    `--text-3 in ops.css's dark :root = ${ink}`,
    `background tokens it is measured against = ${surfaces.length}`,
    `worst pairing = ${worst.name} ${worst.hex} at ${worst.r.toFixed(2)}:1`,
    `clears 4.5:1 on every one of them = ${surfaces.every((s) => ratio(ink, s[1]) >= 4.5)}`,
  ];
};

/* The blocks this file derives, listed out of this file rather than typed into
   the README, because the README's enumeration of them fell three behind. */
const SWEEP_TEST = 'every repository file ops/README.md names is in the tree or declared deleted';

DERIVED['claims-blocks'] = () => {
  /* Two row sets are judged by a test rather than by a block — the file
     sweep and the checks table — so their rows are read out of this file's
     own source: delete either test and its row goes with it, which a typed
     sentence would not do. */
  const self = read(path.join('scripts', SELF));
  const tests = [
    ...(self.includes('test(SWEEP_TEST,') ? [SWEEP_TEST] : []),
    ...(self.includes('test(TABLE_TEST,') ? [TABLE_TEST] : []),
  ];
  return [
    ...Object.keys(DERIVED).sort().map((id) => `claims id=${id}`),
    ...tests.map((name) => `and a test, ${name}`),
  ];
};

/* What the content security policy costs, counted rather than remembered:
   how many pages would need a hash if the theme were inlined, and whether the
   two things the policy forbids are actually absent from the markup. A page
   that grows an inline script or a style attribute is red here -- including
   when it spells the attribute `style = "..."`, which is legal HTML that a
   tighter regex read as absent, and excluding one it only keeps in a
   comment, which the browser does not run either. */
DERIVED['csp-pages'] = () => {
  const declares = new RegExp(attr('http-equiv', 'Content-Security-Policy'), 'i');
  const styleAttr = new RegExp(attr('style', String.raw`[^\s"'=<>\`]+`), 'i');
  const csp = PAGES.filter((page) => declares.test(markup(page)));
  const themed = PAGES.filter((page) => loadedAssets(page).includes('theme.js'));
  const inlineScript = PAGES.filter((page) => /<script(?![^>]*\bsrc\s*=)[^>]*>/i.test(markup(page)));
  const inlineStyle = PAGES.filter((page) => styleAttr.test(markup(page)));
  return [
    `pages in ops/ = ${PAGES.length}`,
    `pages declaring the policy in a <meta> = ${csp.length}`,
    `pages loading assets/theme.js = ${themed.length}`,
    `pages with an inline <script> = ${inlineScript.length ? inlineScript.join(', ') : 0}`,
    `pages with a style attribute in markup = ${inlineStyle.length ? inlineStyle.join(', ') : 0}`
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
      /* This file is not a reader of a dead asset: it names every one of them
         by construction, in the block above and in REQUIRED_ROWS, so counting
         itself would move this row on every edit to its own pin list. */
      const readers = SCRIPTS.filter((s) => s !== SELF && spelling.test(read(path.join('scripts', s))));
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

/* The checks table carries a row per check, in prose nothing can derive. What
   IS derivable is the ROW SET: every browser guard in the tree has to have a
   row there. A guard that lands next week is red here, the way the sixth one
   (check-ops-dialog-hit.mjs, aria-website#95) was red in browser-guards while
   the table beside it silently described five of six. The row's TEXT is not
   judged — see NOT COVERED at the top of this file. */
const TABLE_TEST = 'every browser guard in the tree has a row in the checks table';
test(TABLE_TEST, () => {
  const head = README.indexOf('| Check | What it can see that nothing else can |');
  assert.ok(head > -1, 'ops/README.md: the checks table header is gone or reworded, so no row set can be read');
  const body = README.slice(head).split(/\n(?!\|)/)[0];
  const rows = body.split('\n').filter((l) => l.startsWith('|'));
  assert.ok(rows.length > 2, 'ops/README.md: the checks table has no rows');
  const guards = SCRIPTS.filter((f) => /^check-ops-.*\.mjs$/.test(f));
  assert.ok(guards.length > 0, 'scripts/ holds no check-ops-*.mjs at all, so this test is judging nothing');
  const missing = guards.filter((g) => !rows.some((r) => r.includes(g)));
  assert.deepStrictEqual(missing, [],
    'ops/README.md: these browser guards run in this repository and the checks table does not name them');
  JUDGED['checks table'] = rows.length - 2;
});

/* The README names files. Every one of them is either in the tree or declared
   dead in the deleted-assets block — which is what makes a deletion elsewhere
   in the repository red here rather than silently stale. */
test(SWEEP_TEST, () => {
  const inTree = new Set([
    ...PAGES.map((p) => `ops/${p}`),
    ...list('ops/assets').map((a) => `ops/assets/${a}`),
    ...list('scripts').map((s) => `scripts/${s}`),
    ...WORKFLOWS.map((w) => `.github/workflows/${w}`)
  ]);
  const byBasename = new Map();
  for (const file of inTree) byBasename.set(path.basename(file), file);

  const deleted = new Set((BLOCKS.get('deleted-assets')?.lines || [])
    .map((l) => l.trim().split('=')[0].trim()));
  const deletedByBasename = new Map();
  for (const file of deleted) deletedByBasename.set(path.basename(file), file);

  const EXTENSIONS = new Set([...inTree, ...deleted]
    .map((f) => path.extname(f).toLowerCase()).filter(Boolean));

  /* Paths in the Aria monorepo rather than here. They are named with their
     monorepo directory, which is what this recognises them by. */
  const FOREIGN = /^(docs|app-backend|aria-api|mobile-app|coaches-web|packages)\//;

  const lines = README.split('\n');
  const missing = [];
  let judged = 0;
  lines.forEach((line, i) => {
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const candidate = /^([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)(?::\d+(?:[-,]\d+)*)?$/.exec(span[1]);
      if (!candidate) continue;
      const file = candidate[1];
      if (FOREIGN.test(file)) continue;
      /* A span carrying a DIRECTORY is a path whatever its extension, which
         is how an invented `ops/assets/x.json` is caught rather than read as
         prose. A bare basename is a path only if the tree or the
         deleted-assets block uses that extension, because `payload.data` and
         `availability.state` are spelled exactly like one otherwise. The
         extension list is read off the files, never typed. */
      if (!file.includes('/') && !EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      judged += 1;
      /* The spellings this README uses are resolved to repository paths before
         they are looked up, rather than matched on their last segment: a span
         carrying a directory is held to that directory, or `ops/assets/x.css`
         and `made/up/x.css` both read as right because the leaf matches. A
         bare `x.css` with no directory is the one spelling resolved by leaf,
         which is how most of this file names an asset. A path declared DEAD is
         resolved the same way, so `scripts/operate.css` is wrong even though
         `operate.css` is a file this repository deleted. */
      const resolve = (byLeaf) => (file.includes('/')
        ? [file, `ops/${file.replace(/^\/?ops\//, '')}`]
        : [file, byLeaf.get(file)].filter(Boolean));
      if (resolve(deletedByBasename).some((c) => deleted.has(c))) continue;
      if (resolve(byBasename).some((c) => inTree.has(c))) continue;
      missing.push(`${README_PATH}:${i + 1}: names ${file}, which is neither in the tree nor in the deleted-assets block`);
    }
  });
  assert.ok(judged > 0, 'no file path was judged, so this test proved nothing');
  assert.deepStrictEqual(missing, [], `\n${missing.join('\n')}\n`);
  JUDGED['file-paths'] = judged;
});

/* Five blocks cannot derive WHICH rows they carry, only what each row says.
   Two read their subjects from the README — `source-anchors` (which comment
   to go and find) and `deleted-assets` (which absent path to look for) — and
   three read them from a hand-written array up in this file:
   `v1-status-classes` from V1_STATUS_FAMILIES and V1_STATUS_SINGLETONS,
   `spend-colour-gate` from COLOUR_PROBES and `spend-write-gate` from
   WRITE_PROBES. In all five, deleting a subject deletes the expectation with
   it and runs green.

   So the pin is the SET, keyed per row, not the count. A count absorbs every
   deletion some addition has already paid for: grow a block by one, drop a
   different row, and a floor of six still sees six. Each row named here must
   still be judged, by name, so removing one is a deliberate two-line deletion
   in this file and visible in the diff. Growing a block is free.

   Every other block derives its row set from the tree, the pages, the
   registry or the sheets, so shrinking one is already red without a pin. */
/* The status families, pinned as prefixes rather than as rows. For each one
   the members are recomputed from ops.css HERE, independently of
   V1_STATUS_FAMILIES, so narrowing a family prefix in that array shrinks the
   block while this still demands all seven `.badge*` rows. A family leaves
   only by being deleted in both places. */
const REQUIRED_FAMILIES = ['badge', 'tag', 'callout', 'verdict'];

const REQUIRED_ROWS = {
  'source-anchors': [
    'ops/assets/pane-analytics.js "`features.coverageNote` carries two facts"',
    'ops/assets/pane-registry.js "Custom is deliberately not offered, for the same reason as Cloud costs"',
    'ops/assets/pane-releases.js "The chip carries the share and nothing else"',
    'ops/assets/pane-releases-v2.css "The chip holds the share and nothing else"',
    'ops/assets/pane-users.js "Hidden for every role, including this one, until a reveal is recorded."',
    'ops/assets/shell-pane-v2.js "Ported from the v1 panes rather than reached for"',
  ],
  'deleted-assets': ['ops/assets/operate.css', 'ops/assets/settings.css'],
  /* Spelled out rather than mapped from V1_STATUS_FAMILIES, COLOUR_PROBES and
     WRITE_PROBES: a pin computed from the array it is pinning moves with the
     deletion and pins nothing. Deleting a subject means deleting it twice, in
     two places in this file, both in the diff. */
  /* The seven hand-chosen singletons. The four families are pinned by
     REQUIRED_FAMILIES below instead, because one representative row per
     family is not a pin on the family: narrow `badge` to `badge-ok` in
     V1_STATUS_FAMILIES, drop the six other rows, and a pin on `.badge-ok`
     is still satisfied. */
  'v1-status-classes': [
    '.flagchip', '.build', '.masked', '.reveal-note',
    '.nav-count', '.btn-danger', '.field-error',
  ],
  'spend-colour-gate': [
    'property --sp-ink', 'property color', 'property background-image',
    'property border-color', 'property outline-color', 'property fill',
    'property stroke', 'property box-shadow', 'property filter',
    'property text-decoration', 'property text-emphasis', 'property mask-image',
    'property accent-color',
    'value #2b7fff', 'value #333', 'value rgb(255, 0, 0)', 'value hsl(0 100% 50%)',
    'value crimson', 'value oklch(0.7 0.2 250)', 'value lab(50% 40 59)',
    'value color-mix(in srgb, crimson 50%, transparent)',
  ],
  'spend-write-gate': [
    "setAttributeNS(null, 'style', …)",
    'a capitalised Style: key on h()',
    'createContextualFragment()',
  ],
};

/* A claims guard that judged nothing is the worst outcome this file has, and
   a green run says nothing about how much was compared. So the count goes in
   the log, per block, and the run is red if any of it is empty or if a
   README-subject block lost a row. */
test('the run reports what it judged', () => {
  const rows = Object.keys(JUDGED).sort().map((id) => `  ${id}: ${JUDGED[id]}`);
  const total = Object.values(JUDGED).reduce((a, b) => a + b, 0);
  console.log(`ops/README.md claims judged against the code:\n${rows.join('\n')}\n  TOTAL: ${total}`);
  /* Every block, plus the two tests that judge a row set without a block of
     their own: the file sweep and the checks table. */
  assert.deepStrictEqual([...Object.keys(JUDGED)].sort(),
    [...Object.keys(DERIVED), 'file-paths', 'checks table'].sort(),
    'a block was not judged in this run');
  assert.ok(total > 0, 'nothing was judged');
  for (const [id, required] of Object.entries(REQUIRED_ROWS)) {
    /* The subject is everything left of the row's last ` = `, matched
       WHOLE. A prefix match would let `.badge-ok` satisfy the pin on
       `.badge`, which is a pin on nothing for every subject that is a
       prefix of a sibling. */
    const subjects = new Set((BLOCKS.get(id)?.lines || []).map((l) => {
      const row = l.trim();
      const cut = row.lastIndexOf(' = ');
      return (cut === -1 ? row : row.slice(0, cut)).trim();
    }));
    const gone = required.filter((subject) => !subjects.has(subject));
    assert.deepStrictEqual(gone, [],
      `claims id=${id} no longer judges rows this file pins by name: ${gone.join(', ')} — ` +
      'a subject was deleted, or REQUIRED_ROWS has to lose it on purpose');
  }
  const statusRows = new Set((BLOCKS.get('v1-status-classes')?.lines || [])
    .map((l) => l.trim().split(' = ')[0].trim()));
  const sheet = read('ops/assets/ops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Set([...sheet.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  for (const family of REQUIRED_FAMILIES) {
    const members = [...declared].filter((n) => n === family || n.startsWith(`${family}-`)).sort();
    assert.ok(members.length > 0,
      `ops/assets/ops.css declares no .${family} class, so that family is judging nothing`);
    const absent = members.filter((n) => !statusRows.has(`.${n}`));
    assert.deepStrictEqual(absent, [],
      `claims id=v1-status-classes no longer carries every .${family} class ops.css declares: ` +
      `${absent.map((n) => `.${n}`).join(', ')} — the family was narrowed, or REQUIRED_FAMILIES ` +
      'has to lose it on purpose');
  }
});
