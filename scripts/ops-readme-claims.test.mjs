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
   different row silently. Which blocks are pinned, and how many rows each
   pins, is the `pinned-blocks` block - derived from REQUIRED_ROWS, because
   this sentence used to say "five" and PR #111 then added two more.

   NOT COVERED, stated so nobody reads a green run as more than it is:

   - The WORDS in a checks-table row. That table is held to the browser
     guards only by its row SET: every `check-ops-*.mjs` in `scripts/` has to
     be the subject of exactly one row, which is that row's first cell. What
     the row then says that guard sees is prose, and a row describing a guard
     it no longer describes is invisible here. The table is also found by its
     exact header line, so reformatting that header is a failure rather than
     a silent skip.
   - Whether a workflow that INVOKES a guard ever runs it. `browser-guards`
     reads the `run:` steps and asks for the command at the start of the
     script or of a shell segment, so a guard named in a comment, a step name
     or an `echo` is not read as run. It cannot see a step turned off by an
     `if:`, a job with no trigger that reaches it, `continue-on-error`, or a
     path filter that excludes the change in front of it.
   - Where the ink actually lands. `dark-text-3` is arithmetic over the
     tokens in one `:root`: it measures the surfaces it names and accounts
     for every other opaque token beside them, so a token added under any
     name is red until it is placed in one list or the other. A colour is
     resolved from its VALUE - hex in three or six digits, `rgb()` in either
     notation - rather than matched by one spelling, and a value it cannot
     read as a flat colour is NAMED on a third line rather than skipped, so
     every token in that block is accounted for, under whatever name CSS
     allows it: `--panel_bg` and `--PanelBg` are legal custom properties and
     a `[a-z0-9-]` name class dropped both of them. It cannot judge a
     translucent token - `--topbar-bg` and `--scrim` are `rgba()` and
     composite over whatever is behind them - and it does not know which
     surface a given run of text sits on. `check-ops-contrast.mjs` measures
     the rendered pair in a browser and is the oracle for both.
   - How CSS is parsed at all. A rule's declarations are read in SOURCE order
     and resolved the way a browser resolves them WITHIN ONE RULE - the last
     declaration wins, and an important one beats a later normal one, which
     is the one piece of cascade this models. Normalisation covers
     whitespace around the colon, `!important`, an EMPTY value (`--x: ;` is
     legal and is kept as a declaration with no value rather than dropped),
     and ASCII case: a browser reads `POSITION:`, `Auto` and `@MEDIA` as
     `position:`, `auto` and `@media`, so all three are folded, while a
     CUSTOM property name is case-SENSITIVE and keeps its case, which is why
     `--PanelBg` and `--panelbg` stay two tokens. A property NAME is taken
     as the text before the colon rather than matched against a name class,
     so an ESCAPED name (`--review\ token`, legal) is read; a name carrying
     an escaped `;` or `:` is not, because the split is text. Nothing else
     of the cascade is modelled: specificity, order between rules, and
     inheritance are all outside this. A
     value behind `var()`, a `calc()` or an `hsl()` is not resolved; it is
     named as unresolvable where a block accounts for its tokens. `@media`
     and `@supports` bodies are flattened into the same rule list, so a
     `:root` inside one counts as a later `:root` whether or not its
     condition holds - an over-report, which is the safe direction for the
     `later :root rules redeclaring any of them` line.
   - Which routes a pane CALLS. `pane-read-endpoints` is a literal scan: it
     lists every `/api/…` string literal in every `pane-*.js`, and every
     such file gets a line, `(no route literal)` included, so a pane cannot
     leave the list by having nothing matched in it. The first spelling of
     this block keyed on one `endpoint:` per file with a NON-GLOBAL match
     and dropped three panes and two second routes on the floor; the second
     closed each literal on ANY quote rather than the one that opened it,
     which lost `"/api/x?g='s'"`. A literal is now closed by its own quote
     and may hold the other two, but it may not hold a newline, so a route
     spelled across the lines of a template literal is invisible; the scan
     does not know a comment or a regular-expression literal from code. It
     over-reports a concatenation prefix (`/api/ops/users/`) and a route
     named in a comment, and it cannot see a URL assembled from pieces or
     imported from another file. Whether a listed route is ever called, by
     what, and with which method, is not decided here.
   - Which asset can WRITE. `write-capable-assets` reads the HTTP method a
     call site NAMES - `method: 'POST'` and its three siblings, in any case.
     A method assembled at run time, taken from a variable, or defaulted by
     a helper is invisible, and a method named in dead code counts. The line
     is per FILE, not per call site: a file with three write sites stays on
     the list when one of them goes, and only leaves it when the last one
     does. It says nothing about whether a call is reachable, authorised,
     or ever made.
   - Whether an element is drawn INSIDE another. `sr-span-classes` derives
     the clipped, absolutely positioned screen-reader classes a sheet
     declares and the ops assets that draw one, which is text. The DOM
     relationship item 15 turns on - that such a span sits inside a static
     scroll wrapper - and the layout consequence of it are NOT derived here;
     `scripts/check-ops-narrow-overflow.mjs` measures the page and is the
     oracle. The class scan wants all three of `position: absolute`, a
     `clip`/`clip-path` and a `1px` side, each read as the value the RULE
     resolves rather than as "some declaration in it said so" - appending
     `position: static` below the `absolute` takes a class off the list, as
     a browser would. A screen-reader idiom spelled any other way, or put
     back to `absolute` by a DIFFERENT rule, is invisible to it: this reads
     one rule at a time and models no cascade between rules.
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
   - A guard CONSTANT this file does not name. `guard-constants` resolves the
     declarations listed in GUARD_CONSTANTS and no others, and only where the
     value is a top-level `const NAME = ...;` whose right-hand side evaluates
     in a realm with NO free variables: one built from another binding throws
     here rather than being guessed at. A pure call on an intrinsic does NOT
     throw - `Math.round(1280.4)` resolves, and the resolved number is bound.
     The rule is "no free variables", not "no calls"; round 5 of PR #111 found
     both spellings of this sentence claiming the stronger thing.
     A guard added next week carries no numbers until somebody names one of
     its constants, so this list growing is a manual step. The worked example
     of what stays out: check-ops-dialog-hit.mjs hit-tests five spots per
     control, but that array lives inside a template literal evaluated in the
     browser, so the five stays prose and stays unproven.
   - A blind spot a guard does not put in a bullet HEADING of its LEADING
     docblock, under one of THREE recognised heading phrases.
     `guard-blind-spots` reads the leading bold run of each bullet under a
     NOT COVERED heading that OPENS its line - matching the phrase anywhere in
     a line anchors on check-ops-contrast.mjs pointing at the README's list
     and on check-ops-result-view.mjs referring to its own section thirty
     lines above where that section starts. Three restrictions are load-bearing
     and each is a hole:
       (1) LEADING DOCBLOCK ONLY. docblock() slices the first block comment, so
           a section anywhere else is not carried. Two exist today -
           check-ops-shell-v2.mjs:583 and check-ops-contrast.mjs:2239 - and
           both are counted but not read.
       (2) THE MATCHER HAS TO SEE THE HEADING, and that turns on TWO things:
           the wording and the comment marker in front of it. A heading it
           cannot see is invisible to BOTH the bullet read and the whole-file
           count, so it arrives in silence. This docblock deliberately does not
           say which headings those are. Round 3 of PR #111 killed two spellings
           of that sentence: a list typed here drifts, and a list PARSED out of
           BLIND_SPOT_HEADING read one of its two dimensions and was wrong in
           both directions while staying green. The edge is MEASURED instead -
           see HEADING_PROBES below, whose verdicts are the first lines of the
           block. If you want to know what the matcher sees, read the census,
           not a sentence.
       (3) HEADINGS, NOT BULLETS. A blind spot written into a bullet's body is
           not a line. Spans beyond the first are counted, summed over the
           bullets, but never named.
     Bullets are reassembled across wrapped lines, because the first spelling
     of this derivation read one line at a time and silently lost the ONE blind
     spot whose bold opener wraps in check-ops-narrow-overflow.mjs. A bullet
     with no bold opener is reported as one rather than skipped, and a section
     written as prose says so on its guard's line instead of contributing
     nothing. Whether the guard's own account of its blind spots is TRUE is not
     decided here - only that the README carries the same list, in the same
     order.
   - `<link>` and `<script>` tags only, spelled statically with a literal
     `assets/…` URL. An asset injected at runtime is invisible to the loader
     map, as is one loaded by a page outside `ops/`. A tag inside an HTML
     comment or inside a `<template>` is cut before anything is counted,
     because neither is loaded or drawn. Every attribute read out of a page —
     `href`, `src`, `http-equiv`, `content`, `style` — goes through one pair
     of matchers: the name must not be the tail of a longer one, so
     `data-src` is not `src` and `x:http-equiv` is not `http-equiv`; the `=`
     may be spaced; a quoted value may hold anything including spaces, and an
     unquoted one may not. An attribute whose NAME is assembled at runtime is
     still invisible, and so is markup a script writes into the page.
   - What a policy MEANS. `csp-policy` reads the directives out of the meta
     tag and requires every page to carry the same ones, so the README cannot
     show a strict policy the pages no longer have. Whether those directives
     are the right ones, and whether a browser would accept the tag at all,
     is not decided here.
   - The test-fixture map sees this repo's `read('assets/NAME')` idiom. A test
     that opens an asset another way reads as "nothing loads it".
   - Which pages can DRAW a class is read from the class tokens written in the
     page and in the scripts that page loads: `class=` and `class:`,
     `className`, `classList.add|remove|toggle` and `setAttribute('class', …)`,
     each with a literal, each guarded against being the tail of a longer
     name the same way the page attributes are, so `data-class` is not
     `class` and `x-className` is not `className`. The error runs BOTH ways
     and NEITHER value is the strong one. A name in a comment counts as a draw site, so a named page can
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
/* Where a fence may legally start. Column 0 always; otherwise the nearest
   preceding non-blank line that is less indented has to be a list-item
   marker whose content column is exactly this indent, which is the one
   place CommonMark measures indentation from something other than the
   margin. Deliberately strict: it refuses rather than guesses. */
function legalFenceIndent(lines, i, indent) {
  if (indent === 0) return true;
  for (let k = i - 1; k >= 0; k -= 1) {
    const line = lines[k];
    if (!line.trim()) continue;
    const lead = line.length - line.trimStart().length;
    if (lead >= indent) continue;
    const item = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line);
    return Boolean(item) && item[1].length + item[2].length + item[3].length === indent;
  }
  return false;
}

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
    /* Four spaces of indentation is an INDENTED CODE BLOCK to CommonMark, not
       a fence, and GitHub renders it as literal backticks. The exception is a
       fence inside a list item, where indentation is measured from the item's
       content column - which is why the legal indents are column 0 and
       exactly the content column of an enclosing list item. Anything else is
       refused by name: a block this reader judges and the renderer does not
       show as a claims fence is the same lie in the other direction. */
    assert.ok(legalFenceIndent(lines, i, fence[1].length),
      `${README_PATH}:${i + 1}: a claims fence indented ${fence[1].length} spaces. CommonMark ` +
      'reads four or more spaces as an indented code block, so this would be judged here and ' +
      'rendered as literal backticks. Put it at column 0, or at the content column of the list ' +
      'item it belongs to.');
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
const NAME = String.raw`(?<![-\w:.])`;

/* This attribute holds THIS value. The quoted branches take the value as
   given; the unquoted branch is the same value followed by whitespace or the
   end of the tag. */
const attr = (name, value) =>
  String.raw`${NAME}${name}\s*=\s*(?:"${value}"|'${value}'|(?:${value})(?=[\s/>]))`;

/* This attribute is PRESENT, whatever it holds. A quoted value may contain
   spaces - `style="color: red"` is the ordinary spelling and reusing the
   unquoted value pattern read it as absent - and only an unquoted one may
   not. */
const attrPresent = (name) =>
  String.raw`${NAME}${name}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\`]+)`;

const ASSET_REF = new RegExp(`(?:<link\\b[^>]*${attr('href', String.raw`assets\/([A-Za-z0-9._-]+)`)}|<script\\b[^>]*${attr('src', String.raw`assets\/([A-Za-z0-9._-]+)`)})`, 'g');

/* Comments are cut before any tag in a page is counted: a page that keeps an
   old <link> commented out does not load it, and counting it made `ops.css`
   read as loaded by a page that only remembers it. Every reading of page
   markup in this file goes through here, so a commented-out tag is invisible
   to all of them and not just to the loader map. */
function markup(page) {
  return read(path.join('ops', page))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '');
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
      if (/^@(media|supports)\b/i.test(prelude)) out.push(...cssRules(body));
    } else if (prelude) {
      out.push({ selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean), body });
    }
    i = end + 1;
  }
  return out;
}

/* The declarations of one rule, IN SOURCE ORDER, spelled the way a browser
   reads them rather than the way the author typed them.  Two separate defects
   lived in the one-line version this replaces.  It SORTED, which is a lie
   about a cascade: a property declared twice in one rule resolves to the LAST
   one, and sorting decided it by value instead - `--surface-hover: #000000`
   added under `--surface-hover: #1E2833` was resolved to the wrong colour.
   And it left the text as typed, so `position : relative` (a legal space
   before the colon) and `overflow-x: scroll !important` were invisible to
   every matcher keyed on `prop:`.  Call sites that want a stable printed
   order sort for themselves. */
const declarations = (body) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const m = /^([^:]+?)\s*:\s*([\s\S]*)$/.exec(d);
      if (!m) return d;
      /* CSS property names are ASCII case-insensitive - `POSITION:` is
         `position:` to a browser - but a CUSTOM property name is NOT, so
         `--PanelBg` keeps its case and `--panelbg` stays a different token. */
      const prop = m[1].startsWith('--') ? m[1] : m[1].toLowerCase();
      const bang = /^([\s\S]*?)\s*!\s*important$/i.exec(m[2]);
      const value = bang ? `${bang[1].trim()} !important` : m[2].trim();
      /* An EMPTY value is legal - `--x: ;` is the space-toggle idiom - and
         requiring one character after the colon made the whole declaration
         invisible rather than unresolvable. */
      return value ? `${prop}: ${value}` : `${prop}:`;
    });

/* A declared value with `!important` taken off, for the matchers that ask
   what a declaration SAYS rather than how loudly it says it. */
const declared = (decl) => decl.replace(/\s*!important$/i, '');

/* What a browser RESOLVES each property in one rule to.  `declarations()`
   gives source order; this gives the winner, which is not the same thing
   twice over.  The last declaration wins - EXCEPT that an important one
   beats a later normal one in the same rule, which is why stripping
   `!important` before a last-wins loop resolved
   `--text-3: #000000 !important; --text-3: #8593A2` to the wrong ink.  And
   because the property NAME is taken from the text before the colon rather
   than matched against a name class, an escaped name survives it:
   `--review\ token` is a legal custom property and no `--\S+` can read it.
   A name carrying an escaped `;` or `:` is still invisible - the split is
   text, and that is in NOT COVERED. */
function effectiveDecls(body) {
  const out = new Map();
  for (const raw of declarations(body)) {
    const m = /^([^:]+?):\s*([\s\S]*)$/.exec(raw);
    if (!m) continue;
    const bang = /^([\s\S]*?)\s*!important$/i.exec(m[2]);
    const important = Boolean(bang);
    const prev = out.get(m[1]);
    if (prev && prev.important && !important) continue;
    out.set(m[1], { value: (bang ? bang[1] : m[2]).trim(), important });
  }
  return out;
}

/* One rule's resolved value for one property, '' when it declares none. */
const resolved = (body, prop) => (effectiveDecls(body).get(prop) || {}).value || '';

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

/* The shell each workflow actually runs: every `run:` value, including the
   block-scalar form, which is where all of these live. A guard named
   anywhere else in the YAML - in a comment, in an `echo`, in a step name -
   is not run by it. */
function runSteps(workflow) {
  const lines = read(path.join('.github/workflows', workflow)).split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = /^(\s*)-?\s*run:\s*(.*)$/.exec(lines[i]);
    if (!start) continue;
    const [, indent, first] = start;
    if (!/^[|>]/.test(first.trim())) { bodies.push(first); continue; }
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() && lines[j].length - lines[j].trimStart().length <= indent.length) break;
      body.push(lines[j].trim());
    }
    bodies.push(body.join('\n'));
  }
  return bodies;
}

/* Invocation, not mention. `run: echo "node scripts/check-ops-shell-v2.mjs"`
   disables a guard while leaving its name in the file, and substring
   presence called that running it. The command has to stand at the start of
   the script or of a shell segment. */
function invokes(workflow, command) {
  const at = new RegExp(String.raw`(?:^|[;&|(]\s*|\n\s*)${command.replace(/[/.]/g, '\\$&')}(?=$|[\s;&|)])`, 'm');
  return runSteps(workflow).some((body) => at.test(body));
}

/* The browser guards, named once. Every block that describes "the browser
   guards" is built from this list rather than from its own filter, so a guard
   added next week reaches all of them at the same moment. */
const BROWSER_GUARDS = SCRIPTS.filter((s) => /^check-ops-.*\.mjs$/.test(s));

/* Every browser guard: the workflow that runs it, and what it renders. */
DERIVED['browser-guards'] = () => BROWSER_GUARDS
  .map((script) => {
    const src = read(path.join('scripts', script));
    const command = `node scripts/${script}`;
    const workflows = WORKFLOWS.filter((w) => invokes(w, command));
    const urls = [...new Set([...src.matchAll(/['"`](\/ops\/[A-Za-z0-9._-]+\.html)['"`]/g)].map((m) => m[1]))].sort();
    const everyPage = PAGES.length > 0 && PAGES.every((p) => urls.includes(`/ops/${p}`));
    const where = [];
    if (/OpsPaneRegistry/.test(src)) where.push('every pane the registry declares');
    if (everyPage) where.push('every page in ops/');
    else where.push(...urls);
    return `${script} = ${workflows.join(', ') || '(no workflow)'}; ${where.join(' + ') || '(no page named in its source)'}`;
  });

/* The text of a top-level declaration's value, from `=` to the `;` that closes
   it outside every string, bracket and comment. A guard's array of viewports
   spans lines and carries comments between its entries, so "everything up to
   the first semicolon" reads half of one. */
function literalAfter(src, from, what) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const eol = src.indexOf('\n', i);
      if (eol === -1) break;
      i = eol;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) return src.slice(from, i);
  }
  return assert.fail(`${what}: the declaration never closes`);
}

/* The VALUE a guard's own constant holds, resolved by evaluating the
   declaration rather than by matching its text. `const WIDTHS = [375, 360, 320]`
   is three numbers here, not the string "375, 360, 320", so a fourth viewport
   is a fourth entry rather than a longer line that a substring test still
   passes. The right-hand side is evaluated in a realm holding no free
   variables, so a declaration built from another binding throws rather than
   being guessed at. A pure call on an intrinsic resolves instead —
   `Math.round(1280.4)` binds 1280 — because the realm still has its
   intrinsics. No free variables, not no calls. */
function constant(script, name) {
  const src = read(path.join('scripts', script));
  const at = new RegExp(String.raw`^const ${name}\s*=\s*`, 'm').exec(src);
  assert.ok(at, `scripts/${script} declares no top-level const ${name}`);
  const expr = literalAfter(src, at.index + at[0].length, `scripts/${script} const ${name}`);
  try {
    return vm.runInNewContext(`(${expr})`, Object.create(null), { timeout: 1000 });
  } catch (err) {
    return assert.fail(
      `scripts/${script}: const ${name} is not a literal this check can resolve — ${err.message}`
    );
  }
}

/* The numbers the checks table leans on, taken out of the guards that hold
   them. Every one of these was a typed word in a sentence until a guard moved
   underneath it: `WIDTHS` gained 320px in aria-website#103 and the sentence
   describing the sweep went on saying "375px and 360px" through a rebase onto
   that very commit (Stadiora/Aria#10655's class, found again).

   NOT derived here: a constant this list does not name, and a value that is not
   a top-level `const` — the five hit-test spots per control live in an array
   inside a template literal evaluated in the browser, so they stay prose. */
const GUARD_CONSTANTS = [
  ['check-ops-contrast.mjs', 'STATES'],
  ['check-ops-dialog-hit.mjs', 'PAINT_PIXEL_DELTA'],
  ['check-ops-dialog-hit.mjs', 'PAINT_COVERAGE_LIMIT'],
  ['check-ops-narrow-overflow.mjs', 'WIDTHS'],
  ['check-ops-result-view.mjs', 'WIDTH'],
  ['check-ops-theme-redraw.mjs', 'PAINT_PROPS'],
];

DERIVED['guard-constants'] = () => GUARD_CONSTANTS.flatMap(([script, name]) => {
  assert.ok(
    BROWSER_GUARDS.includes(script),
    `scripts/${script} is named in GUARD_CONSTANTS but is not a browser guard in this tree`
  );
  const value = constant(script, name);
  if (!Array.isArray(value)) return [`${script} ${name} = ${String(value)}`];
  return [
    `${script} ${name} = ${value.join(', ')}`,
    `${script} ${name} length = ${value.length}`,
  ];
});

/* A guard's leading block comment, and nothing after it: three of these files
   go on discussing their own blind spots hundreds of lines further down, next
   to the code that has them. */
function docblock(script) {
  const src = read(path.join('scripts', script));
  if (!src.startsWith('/*')) return null;
  const close = src.indexOf('*/');
  return close === -1 ? null : src.slice(0, close);
}

/* A heading, not a mention. check-ops-contrast.mjs's docblock points at THIS
   file's NOT COVERED list without having a section of its own, and
   check-ops-result-view.mjs refers to its own section thirty lines above where
   that section starts. Matching the phrase anywhere in a line anchors on both
   of those; it has to open the line. */
const BLIND_SPOT_HEADING =
  /^\s*(?:\/\*+\s*|\*\s*)?(?:WHAT THIS DOES NOT COVER|WHAT IT DOES NOT|NOT COVERED)\b/i;

/* What each guard says it cannot see, in its own words. Every browser guard
   gets a line whatever shape its docblock is in — a guard that reformats its
   bullets into prose flips from a list to `(section present, written as prose)`
   and fails here, instead of dropping out of a list nobody counts.

   Bullets are reassembled across lines before the heading is read. A bullet
   whose bold opener wraps — check-ops-narrow-overflow.mjs has one — is a
   heading this file silently dropped while the line-at-a-time version of this
   derivation was being written, which is the failure it exists to catch, one
   level up.

   What this reads is the leading BOLD RUN of each bullet, so a bullet that
   names two blind spots in two bold spans contributes only its first, and a
   bullet with no bold opener is reported as one rather than skipped. That is a
   real gap and not a theoretical one: check-ops-narrow-overflow.mjs's "Look up
   a user" bullet also covers Aria quality, and only the first of the two is a
   line here. Rather than parse the English that distinguishes a second heading
   from ordinary body emphasis, every guard ends with a COUNT of the bold spans
   beyond the first, SUMMED over its bullets. Summed rather than per-bullet:
   counting bullets-with-more-than-one is a boolean, and a third span added to a
   bullet that already had two would not move it. The count is exact and the
   headings it belongs to are not named: it is a tripwire that refuses to hide a
   second span, not an index of blind spots. A body that bolds a word moves it
   too, on purpose.

   Bullets are read out of the LEADING docblock only. A guard that states its
   blind spots somewhere else in the file states them where this cannot see, so
   every guard also ends with a count of the lines anywhere in it that OPEN like
   a blind-spot heading. That count is syntactic and deliberately dumb: a line
   referring back to a section counts the same as the section. It exists so that
   a section arriving outside the leading docblock flips a line instead of
   arriving in silence, which is how two of them were sitting unread when this
   was written.

   A blind spot written as prose inside a bullet is still not a line. The
   README's own summary of a section is prose and is not judged; what is judged
   is that the headings are all present, in order, and that neither count has
   moved. */
/* Exactly which heading lines the matcher above SEES, measured by asking it.

   The first spelling of this parsed BLIND_SPOT_HEADING.source for its phrase
   alternation and published that as "the net's real width". It was not. The
   matcher has two dimensions, phrase AND comment marker, and the parse read one
   substring of one of them: reverting the `/*` half of the marker group left
   the published list identical, and a phrase added as a second top-level branch
   rather than inside the group was matched by the regex and missing from the
   list. Both are false greens and both were found by mutation, not by reading.

   So nothing is parsed. Each spelling below is a concrete line handed to the
   real predicate, and the census reports SEEN or INVISIBLE. Every spelling gets
   a line either way: the INVISIBLE ones are the net's actual edge, published
   rather than described, and a matcher that starts or stops seeing any of them
   flips its line.

   The table is NOT the two dimensions crossed. It is a sample of them, and it
   is worth being exact about which cells it holds, because the temptation is to
   describe it as more. Markers appear against ONE recognised phrase and one
   unrecognised one; the other phrases appear bare or indented only. A mid-line
   mention is in there because if the `^` anchor came loose that row would flip
   and nothing else would.

   What this does NOT bind, all three published in the README's NOT COVERED:
     (a) A (phrase, marker) cell no row occupies. Teaching the matcher a phrase
         ONLY behind `/*` moved no row until `/* KNOWN GAPS` was added, and that
         is a demonstration, not a proof that the remaining cells are safe.
     (b) A phrase NARROWED so that it still matches every probed spelling of
         itself. Every probe of a phrase has to differ in its continuation or
         the narrowing walks through: `WHAT IT DOES NOT` was exercised only by
         spellings continuing "measure" until `WHAT IT DOES NOT check` was
         added, so narrowing it to `WHAT IT DOES NOT MEASURE` was green.
     (c) A spelling nobody thought to add at all.
   (a) and (b) are review round 4 of PR #111, both demonstrated green. The fix
   for each was one ROW, not more analysis: the census's reach is its table, so
   the table is where it grows. */
const HEADING_PROBES = [
  'WHAT THIS DOES NOT COVER, in the words of what was measured:',
  '   WHAT IT DOES NOT measure:',
  '   WHAT IT DOES NOT check, in so many words:',
  '   NOT COVERED, on purpose',
  '   NOT COVERED at all:',
  '   not covered, in lower case',
  ' * NOT COVERED, after a continuation marker',
  '/* NOT COVERED, sharing the comment opener',
  '/** NOT COVERED, sharing a doc-comment opener',
  '// NOT COVERED, after a line comment',
  '   WHAT THIS SWEEP CANNOT SEE:',
  '   KNOWN GAPS:',
  '/* KNOWN GAPS, behind a comment opener',
  '   see NOT COVERED above for the two panes',
];

DERIVED['guard-blind-spots'] = () => [
  /* The size of the census, so the README never has to spell it. Round 5 of
     PR #111 found "eleven" still typed in one paragraph after the table had
     grown to fourteen, the other paragraph having been updated: a number in
     prose has to be found by hand at every site, and one site was missed. */
  `(heading probes = ${HEADING_PROBES.length})`,
  ...HEADING_PROBES.map((probe) =>
    `(heading probe: ${JSON.stringify(probe)} = ${BLIND_SPOT_HEADING.test(probe) ? 'SEEN' : 'INVISIBLE'})`),
  ...BROWSER_GUARDS.flatMap((script) => {
  const headings = read(path.join('scripts', script))
    .split('\n').filter((l) => BLIND_SPOT_HEADING.test(l)).length;
  const tail = (n) => [
    `${script} = (bold spans beyond the first, summed: ${n})`,
    `${script} = (lines that open like a blind-spot heading: ${headings})`,
  ];
  const doc = docblock(script);
  if (doc === null) return [`${script} = (no leading docblock)`, ...tail(0)];
  const lines = doc.split('\n');
  const at = lines.findIndex((l) => BLIND_SPOT_HEADING.test(l));
  if (at === -1) return [`${script} = (no blind-spot section in the leading docblock)`, ...tail(0)];
  const opens = /^\s*(?:\*\s*)?-\s+/;
  const bullets = [];
  for (const line of lines.slice(at + 1)) {
    if (opens.test(line)) bullets.push([line.replace(opens, '')]);
    else if (bullets.length) bullets[bullets.length - 1].push(line.trim());
  }
  if (bullets.length === 0) return [`${script} = (section present, written as prose)`, ...tail(0)];
  const texts = bullets.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
  const heads = texts.map((text) => {
    const bold = /^\*\*(.+?)\*\*/.exec(text);
    return `${script} = ${bold ? bold[1].trim() : '(bullet with no bold opener)'}`;
  });
  const extra = texts.reduce((n, t) => n + Math.max(0, (t.match(/\*\*(.+?)\*\*/g) || []).length - 1), 0);
  return [...heads, ...tail(extra)];
  }),
];

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
      if (!scrollsSideways(rule.body)) continue;
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
  for (const m of src.matchAll(/(?<![-\w])class\s*=\s*(["'])([^"']*)\1/g)) add(m[2]);
  for (const m of src.matchAll(/(?<![-\w])className\s*[:=]\s*(['"`])([^'"`]*)\1/g)) add(m[2]);
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
  for (const m of src.matchAll(/(?<![-\w])className\s*[:=]\s*([^,\n]*)/g)) {
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
/* A box scrolls sideways under any computed `overflow-x` of `auto`,
   `scroll` or `overlay`, however the sheet spells it: the longhand, or the
   shorthand, whose FIRST value is the x axis. Reading only the literal
   `overflow-x: auto` missed `overflow-x: scroll`, which is the same box to a
   browser. */
function scrollsSideways(body) {
  const scrolls = /^(auto|scroll|overlay)$/i;
  for (const decl of declarations(body).map(declared)) {
    const long = /^overflow-x:\s*([a-z]+)$/i.exec(decl);
    if (long && scrolls.test(long[1])) return true;
    const short = /^overflow:\s*([a-z]+)(?:\s+[a-z]+)?$/i.exec(decl);
    if (short && scrolls.test(short[1])) return true;
  }
  return false;
}

DERIVED['scroll-wrapper-position'] = () => {
  const out = [];
  for (const sheet of ASSETS.filter((a) => a.endsWith('.css'))) {
    const rules = cssRules(read(path.join('ops/assets', sheet)));
    const boxes = new Map();
    for (const rule of rules) {
      if (!scrollsSideways(rule.body)) continue;
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

/* A flat opaque colour, whatever the sheet spells it as: `#abc`, `#AABBCC`,
   `rgb(1, 2, 3)` and `rgb(1 2 3)` are one colour and used to be four
   different answers here, because the token was matched by its SPELLING.
   Anything carrying an alpha, a `color-mix()`, an `hsl()` or a length is not
   resolved and is named as unresolved rather than skipped. */
function flatColour(value) {
  const hex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.exec(value.trim());
  if (hex) {
    const h = hex[1];
    return `#${(h.length === 3 ? [...h].map((c) => c + c).join('') : h).toUpperCase()}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/.exec(value.trim());
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((n) => n > 255)) return null;
  return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/* Two claims that were prose until round 10 found both of them false at the
   same head: a deleted `[data-theme="light"]` block described as still filed
   in `ops.css`, and "no browser guard renders ops/spend.html" beside a block
   in this same README deriving that one of them renders every page in ops/.
   The second needed no new derivation - browser-guards already answered it -
   and this is the first. */
DERIVED['data-page-scoping'] = () => {
  const scoped = cssRules(read('ops/assets/ops.css'))
    .filter((rule) => rule.selectors.some((sel) => /data-page/.test(sel)))
    .flatMap((rule) => rule.selectors)
    .sort();
  const carriers = PAGES.filter((page) => new RegExp(attrPresent('data-page'), 'i').test(markup(page)));
  return [
    `ops.css rules scoped to a data-page attribute = ${scoped.length ? scoped.join('; ') : '(none)'}`,
    `pages carrying a data-page attribute = ${carriers.length ? carriers.sort().join(', ') : '(none)'}`,
  ];
};

/* Every API route a pane source NAMES, read as string literals out of the
   file rather than off one `endpoint:` key. Round 11 found three panes that
   named routes and dropped out of this list entirely and two more that named
   a second route the single non-global `.exec` never reached, while the
   README claimed every pane that names a route is on the list. Every
   `pane-*.js` gets a line now, `(no route literal)` included, so a pane
   cannot leave the list by having nothing matched in it. */
DERIVED['pane-read-endpoints'] = () =>
  ASSETS.filter((a) => /^pane-.*\.js$/.test(a)).map((file) => {
    const src = read(path.join('ops/assets', file));
    /* A literal is closed by the quote that OPENED it, so the other two
       quote characters are ordinary content: `"/api/x?g='s'"` is one route
       and a `[^'"`]` class dropped it on the floor. */
    const literals = [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
    const routes = [...new Set(literals.filter((v) => v.startsWith('/api/')))].sort();
    return `${file} = ${routes.length ? routes.join(', ') : '(no route literal)'}`;
  });

/* Item 15 used to say no pane ships an absolutely positioned screen-reader
   span inside one of those static wrappers. Three do. This derives the
   screen-reader classes a loaded sheet declares `position: absolute` on, and
   every ops asset that draws one, so the item can never again rest on a
   "no pane does this" that no one re-checked. Containment - whether a given
   span is drawn INSIDE a scroll wrapper - is a DOM question and is NOT
   decided here; see NOT COVERED. */
DERIVED['sr-span-classes'] = () => {
  const sheets = ASSETS.filter((a) => a.endsWith('.css')).sort();
  const found = [];
  for (const sheet of sheets) {
    for (const rule of cssRules(read(path.join('ops/assets', sheet)))) {
      const decls = effectiveDecls(rule.body);
      const val = (prop) => (decls.get(prop) || {}).value || '';
      const absolute = /^absolute$/i.test(val('position'));
      const clipped = Boolean(val('clip') || val('clip-path'));
      const tiny = /^1px$/i.test(val('width')) || /^1px$/i.test(val('height'));
      if (!absolute || !clipped || !tiny) continue;
      for (const sel of rule.selectors) {
        const m = /^\.([-\w]+)$/.exec(sel);
        if (m) found.push(`${sheet} .${m[1]}`);
      }
    }
  }
  const classNames = new Set(found.map((f) => f.split(' .')[1]));
  const drawn = ASSETS.filter((a) => a.endsWith('.js'))
    .filter((a) => [...classTokens(read(path.join('ops/assets', a)))].some((t) => classNames.has(t)))
    .sort();
  return [
    `absolutely positioned screen-reader classes = ${found.sort().join(', ') || '(none)'}`,
    `ops assets drawing one = ${drawn.join(', ') || '(none)'}`
  ];
};

/* Which ops assets can CHANGE something. The README said in two places that
   Settings is "the one pane that can change something"; Problems has been
   acknowledging and closing problems the whole time, and two more panes post
   as well. Derived from the HTTP method each file spells, so the sentence
   cannot go stale again the next time a pane grows a button. What this reads
   is the method a call site NAMES - a method assembled at run time, or a
   write issued through a helper that names the method elsewhere, is not seen,
   and a method named in dead code counts. */
DERIVED['write-capable-assets'] = () => {
  const writers = ASSETS.filter((a) => a.endsWith('.js')).filter((a) => {
    const src = read(path.join('ops/assets', a));
    return /\bmethod\s*:\s*(['"`])(POST|PUT|PATCH|DELETE)\1/i.test(src);
  }).sort();
  const panes = writers.filter((a) => a.startsWith('pane-'));
  return [
    `ops assets naming a write method = ${writers.join(', ') || '(none)'}`,
    `of those, pane scripts = ${panes.join(', ') || '(none)'}`
  ];
};

DERIVED['dark-text-3'] = () => {
  const sheet = cssRules(read('ops/assets/ops.css'));
  const dark = sheet.find((rule) => rule.selectors.includes(':root'));
  assert.ok(dark, 'ops.css declares no :root');
  /* Every custom property the block declares, under whatever name CSS lets it
     have - `--panel_bg` and `--PanelBg` are legal and used to fall through a
     `[a-z0-9-]` name class into nothing at all - resolved LAST-DECLARATION-
     WINS, the way the cascade resolves a property declared twice in one rule. */
  const values = new Map();
  for (const [name, decl] of effectiveDecls(dark.body)) {
    if (name.startsWith('--')) values.set(name, decl.value);
  }
  const tokens = new Map();
  const unresolved = [];
  for (const [name, value] of values) {
    const colour = flatColour(value);
    if (colour) tokens.set(name, colour);
    else unresolved.push(name);
  }
  const ink = tokens.get('--text-3');
  assert.ok(ink, 'ops.css\'s dark :root declares no --text-3');
  const surfaces = [...tokens.entries()].filter(([name]) => /^--(bg|surface-.+)$/.test(name));
  assert.ok(surfaces.length > 0, 'ops.css\'s dark :root declares no background tokens');
  const worst = surfaces
    .map(([name, hex]) => ({ name, hex, r: ratio(ink, hex) }))
    .sort((a, b) => a.r - b.r)[0];
  /* Naming the surfaces is half a claim on its own: a surface added under
     some other name would be measured against nothing and nobody would see a
     shorter list. So every OTHER opaque token in the same block is named too,
     and a token that appears in neither line is a red run until somebody
     decides which of the two it is. */
  const others = [...tokens.keys()].filter((name) => !surfaces.some(([s]) => s === name)).sort();
  /* ops.css declares `:root` more than once. A later one wins, so a token
     redeclared below this block is not the colour measured above - name any
     that appear rather than measuring the first block and calling it the
     theme. */
  const overridden = sheet
    .filter((rule) => rule !== dark && rule.selectors.includes(':root'))
    .flatMap((rule) => [...effectiveDecls(rule.body).keys()])
    .filter((name) => values.has(name))
    .sort();
  return [
    `--text-3 in ops.css's dark :root = ${ink}`,
    `surfaces it is measured against = ${surfaces.map(([name]) => name).sort().join(', ')}`,
    `worst pairing = ${worst.name} ${worst.hex} at ${worst.r.toFixed(2)}:1`,
    `clears 4.5:1 on every one of them = ${surfaces.every((s) => ratio(ink, s[1]) >= 4.5)}`,
    `every other opaque token in that block = ${others.join(', ')}`,
    `tokens in that block this cannot read as a flat colour = ${unresolved.sort().join(', ')}`,
    `later :root rules redeclaring any of them = ${overridden.length ? overridden.join(', ') : '(none)'}`,
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

/* WHICH blocks are pinned, and how many rows each pins, read out of
   REQUIRED_ROWS rather than counted in a sentence. The paragraph in the README
   said "five blocks" and was true when written; PR #111 then added two more
   and left it saying five for four review rounds. A block that stops being
   pinned, or loses a pin, moves its line here. REQUIRED_ROWS is declared at the
   foot of this file and read when the test runs, not now. */
DERIVED['pinned-blocks'] = () => [
  ...Object.keys(REQUIRED_ROWS).sort()
    .map((id) => `claims id=${id} pins ${REQUIRED_ROWS[id].length} rows by name`),
  `claims id=v1-status-classes pins the families ${REQUIRED_FAMILIES.join(', ')}`,
];

/* The policy a page actually declares, read out of the meta tag rather than
   assumed from its presence. A tag whose http-equiv this matcher does not
   read is not a policy: `x:http-equiv` is a different attribute to a browser
   and was accepted here until round 8 proved it. */
function policyOf(page) {
  const equiv = new RegExp(attr('http-equiv', 'Content-Security-Policy'), 'i');
  const content = new RegExp(`${NAME}content\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  for (const tag of markup(page).match(/<meta\b[^>]*>/gi) || []) {
    if (!equiv.test(tag)) continue;
    const held = content.exec(tag);
    return held ? (held[1] ?? held[2]).replace(/\s+/g, ' ').trim() : '';
  }
  return null;
}

/* The directives themselves, not merely that a tag is there. The README used
   to print the policy in an unchecked fence, so `style-src 'self'` could grow
   `'unsafe-inline'` on every page and the file would still show the strict
   one. Every page has to carry the SAME policy, which is the claim the
   sentence above the block makes. */
DERIVED['csp-policy'] = () => {
  const policies = new Map();
  for (const page of PAGES) {
    const policy = policyOf(page);
    if (policy === null) continue;
    if (!policies.has(policy)) policies.set(policy, []);
    policies.get(policy).push(page);
  }
  assert.strictEqual(policies.size, 1,
    `ops/ declares ${policies.size} different policies, not one: ` +
    [...policies.entries()].map(([policy, pages]) => `${pages.join(', ')} -> ${policy}`).join(' | '));
  const [policy, pages] = [...policies.entries()][0];
  return [
    ...policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...rest] = d.split(/\s+/);
      return `${name} = ${rest.join(' ')}`;
    }),
    `pages carrying this exact policy = ${pages.length}`,
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
  const styleAttr = new RegExp(attrPresent('style'), 'i');
  const noSrc = new RegExp(`<script(?![^>]*${attrPresent('src')})[^>]*>`, 'i');
  const csp = PAGES.filter((page) => policyOf(page) !== null);
  const themed = PAGES.filter((page) => loadedAssets(page).includes('theme.js'));
  const inlineScript = PAGES.filter((page) => noSrc.test(markup(page)));
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
  /* The guard has to be the SUBJECT of a row, which is its first cell, and of
     exactly one. Asking whether the name appears anywhere in any row let a
     row be deleted and its filename appended to the prose of another, which
     leaves the table with no row for that guard and this test green. */
  const subjects = rows.slice(2).map((row) => row.split('|')[1] || '');
  const wrong = guards
    .map((g) => [g, subjects.filter((cell) => cell.includes(g)).length])
    .filter(([, n]) => n !== 1)
    .map(([g, n]) => `${g} is the subject of ${n} rows`);
  assert.deepStrictEqual(wrong, [],
    'ops/README.md: every browser guard in this repository needs exactly one row of its own in ' +
    'the checks table, named in that row\'s first cell');
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

   A block derives its row set from the tree, the pages, the registry or the
   sheets UNLESS its subjects are hand-written in this file, and then it needs
   a pin. PR #111 added two such blocks and did not pin them for four review
   rounds: deleting a GUARD_CONSTANTS entry, or a HEADING_PROBES row, together
   with its README line was GREEN, which silently reinstated two defects
   earlier rounds of that PR had fixed. Both are pinned below now. If you add
   a block whose subjects come from an array up there, pin it here. */
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
  /* Spelled out rather than mapped from GUARD_CONSTANTS: a pin computed from
     the array it pins moves with the deletion and pins nothing. Deleting a
     constant means deleting it twice, both in the diff. */
  'guard-constants': [
    'check-ops-contrast.mjs STATES',
    'check-ops-contrast.mjs STATES length',
    'check-ops-dialog-hit.mjs PAINT_PIXEL_DELTA',
    'check-ops-dialog-hit.mjs PAINT_COVERAGE_LIMIT',
    'check-ops-narrow-overflow.mjs WIDTHS',
    'check-ops-narrow-overflow.mjs WIDTHS length',
    'check-ops-result-view.mjs WIDTH',
    'check-ops-theme-redraw.mjs PAINT_PROPS',
    'check-ops-theme-redraw.mjs PAINT_PROPS length',
  ],
  /* The census rows, likewise spelled out rather than mapped from
     HEADING_PROBES. The subject is everything left of the last ` = `, so each
     of these pins a probe's PRESENCE and leaves its SEEN/INVISIBLE verdict
     free to move - which is what you want: the verdict is the measurement. */
  'guard-blind-spots': [
    '(heading probe: "WHAT THIS DOES NOT COVER, in the words of what was measured:"',
    '(heading probe: "   WHAT IT DOES NOT measure:"',
    '(heading probe: "   WHAT IT DOES NOT check, in so many words:"',
    '(heading probe: "   NOT COVERED, on purpose"',
    '(heading probe: "   NOT COVERED at all:"',
    '(heading probe: "   not covered, in lower case"',
    '(heading probe: " * NOT COVERED, after a continuation marker"',
    '(heading probe: "/* NOT COVERED, sharing the comment opener"',
    '(heading probe: "/** NOT COVERED, sharing a doc-comment opener"',
    '(heading probe: "// NOT COVERED, after a line comment"',
    '(heading probe: "   WHAT THIS SWEEP CANNOT SEE:"',
    '(heading probe: "   KNOWN GAPS:"',
    '(heading probe: "/* KNOWN GAPS, behind a comment opener"',
    '(heading probe: "   see NOT COVERED above for the two panes"',
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
