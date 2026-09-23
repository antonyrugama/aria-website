/* Unit tests for ops/assets/pane-alerts.js — the Problems pane on the v2
   design system.

   What is worth testing here is what that file's docblock claims, and almost
   all of it is a claim about NOT drawing something, which no screenshot and no
   headless-Chrome overflow check can see:

     - acknowledging and closing stay two different actions, and an
       unacknowledged problem says nobody has it rather than leaving the
       absence to be inferred;
     - a count from a full read reads as a floor, and the disclosure names
       WHICH problems went missing;
     - severity is filtered by the API and category here, and a figure read
       over a scoped answer says so;
     - what the approved design asks for and the API does not carry is named
       where it would have been drawn, never invented: no "right now" column,
       no meter, no observed figure without the unit that gives it meaning;
     - a close note is content, so it is printed from the record rather than
       dropped;
     - an empty page proves which kind of empty it is, and a read that never
       landed is never allowed to claim there is nothing there;
     - the box the rules table scrolls inside carries its own tab stop and its
       own name, so the columns past its edge are not a pointer's alone;
     - and what the STYLESHEET's docblock claims about its own paint, which is
       prose about code and so is derived from the code instead.

   The standard this file is written to is that every test has a published
   mutation in the pull request -- the exact file and the exact original line
   whose removal, inversion or insertion makes that test fail -- because a test
   with no such line pins nothing. NOTHING IN THIS FILE CHECKS THAT IT HOLDS:
   no assertion here reads the pull request, so whether the correspondence is
   complete across all of these tests is unverified. The sentence that stood
   here asserted it was, in the present tense, over every test in the file, and
   a claim that size with no reader is the thing this file exists to catch.

   NOT COVERED, deliberately and named rather than implied:

     - Layout. Nothing here measures anything, in any browser, at any width.
     - A sheet no <link> tag in the page spells. Measured in real Chrome
       under this page's own CSP (RV20-4, re-run in round 21): a sheet a
       permitted script APPENDS as a <link> paints, and a constructed sheet
       pushed onto adoptedStyleSheets paints, and neither is read anywhere
       in this file. A script writing inline style through the CSSOM paints
       too -- CSSOM is not governed by style-src at all, and aria.js
       (`col.style.height = ...`) and shell-pane-v2.js
       (`bar.style.setProperty(...)`) already do it (RV22-A1, spelling
       corrected in round 27) -- and is likewise unread.
       The fourth route, an injected <style> ELEMENT, is NOT claimed to be
       closed either, and this is the sixth round of narrowing that claim
       rather than the first. What is asserted below is the policy the page
       carries -- and, since round 29, carries as a <meta> PRAGMA the parser
       would build, in <head>, rather than as a string the page's text holds
       somewhere. The page is parsed with nodesOf(); a policy in a comment,
       in a <noscript>, inside another tag's quoted value, or anywhere
       stillInHead() cannot place in the head is no policy here either, and
       each of those reds. Those were the disclosure, in exactly these words,
       through twenty-eight reviews: measured in real Chrome (RV25-1,
       re-measured in rounds 26 and 29), comment the meta out, move it into
       <body>, or wrap it in <noscript>, and the page ships NO policy Chrome
       enforces -- while every assertion below passed, because each is still
       a Content-Security-Policy the file spells once.
       The spellings review has FOUND are fixed, or -- where deciding one
       would mean writing a tokeniser state machine to guess with --
       REFUSED, which reds. That is a list of what was found, not a rule
       about what exists; the paragraph below says why the difference
       matters. The ones fixed are: <meta-x> (M26-A2),
       data-http-equiv= (M27-A2), <meta&#160; (M27-A5), a tag that spells
       http-equiv twice, where the parser keeps the FIRST and a regex took
       the last (M28-A1), the attribute name sitting inside another
       attribute's quoted VALUE (M28-A2), a whole <meta> tag written inside
       another tag's quoted value (M29-A2), `&#104;ttp-equiv` and `&#99;ontent`,
       which are not those attributes to a parser that decodes references
       inside values only (M29-A3, M29-A4), and the three above (M29-A5,
       M29-A6, M29-A7). One more was found while measuring those: a single
       non-space character before the pragma -- a stray NBSP, a letter, a
       <div> -- ends the head and puts the pragma in <body>, where Chrome
       enforces nothing, and that reds too (M29-A9). Four more came out of
       the twenty-ninth review, each one a place where the walk's idea of
       which bytes are MARKUP disagreed with the parser's: a comment closed
       by `--!>`, `<!-->` or `<!--->` rather than `-->` (M30-A1, M30-A2,
       M30-A3), and a pragma inside <noframes>, which is raw text (M30-A6).
       The fifth, a double-escaped <script>, is REFUSED rather than fixed
       (M30-A5): `<script><!--<script>` moves the end of the element
       somewhere this walk cannot compute, so it declines to read the page
       at all instead of reading a pragma out of script text. A sixth came
       out of the thirtieth: a raw-text element ends where the TOKENISER
       ends it, not at the first `</name`, so `</scriptx a="` ends a
       <script> in no browser and ended one here (M31-A1).
       What is left, and all that is: whether the browser ENFORCES the policy
       this reads. A header can deliver another one, and nothing here can see
       a header. That is the line no reader of a FILE gets past.
       AND SO IS THIS, which is the sentence that replaces a rule five
       consecutive reviews falsified: the walk below is a PARTIAL
       tokeniser, not the tokeniser. Wherever it disagrees with a browser
       about which bytes are markup it can read a pragma -- or a sheet
       list -- this page does not carry, silently, in the GREEN direction.
       The spellings listed above are the ones review has found; each was
       fixed, or refused, and each has a mutation beside it in the pull
       request. Nothing here claims the next one does not exist. Rounds 26,
       27, 28, 29 and 30 each found one AFTER the round before it had
       written that the class was closed, and the rule that used to stand
       here -- every divergence decidable from the page's bytes is made to
       red -- was what they falsified, one spelling at a time. It is
       DELETED rather than qualified: it is a claim about every HTML
       spelling, and a reader hand-written in a test file cannot make one.
       No count of the fixed spellings is written here either, for the
       reason the sheet-reader bullet below gives: a count that is not
       written cannot go stale. What each fixed spelling buys is itself,
       and nothing wider.
       What IS bound, and all that is: IF this reader finds a pragma the
       parser would build in this page's head, THEN the source list that
       governs a <style> element
       in it -- style-src-elem if the policy declares one, else style-src,
       else default-src -- is exactly 'self'. A hash or a nonce in whichever
       of those the chain RESOLVES to reds (RV22-2, RV23-1); a hash in a
       directive the chain does not resolve to is shadowed, opens nothing,
       and correctly does not red (RV24-A1). Whether the browser ENFORCES
       what was read is the part no assertion in this file can reach, and
       the three payloads above are named so nobody has to rediscover them.
       ops/alerts.html appends no sheet today; nothing in this
       file would notice if it did.
     - Every reader of the sheet. The line below enumerates the PREFIXED
       docblock lines, and PROSE_FRAMES_OVER_THE_SHEET the regex frames
       over its prose; what is not enumerated anywhere is the rest. Most of
       those read the sheet's RULES through declarations(), as CSS rather
       than as prose about CSS, so nothing they say can overclaim. The rest
       read its raw TEXT, and NEITHER A COUNT NOR A LIST OF THEM IS
       WRITTEN HERE ANY MORE. It said "three" while four were read, then
       "four" while five were, and then named five while seven were; every
       time, the missing reader had arrived in the same commit as the
       words, twice in the commit that was fixing this very sentence
       (found in the third, eighteenth and twenty-first reviews of #75).
       Three strikes is enough: an enumeration nothing reads cannot be
       trusted to stay complete, so there is nothing left here to go
       stale. What the bullet is for stands without it -- reading the
       sheet as TEXT is not covered, wherever it happens -- and it is the
       whole reason the two lists below are read rather than written.
     - The sheet's own reading rule, the HOW TO READ THIS COMMENT paragraph
       at the top of it. The devices below IMPLEMENT that rule; nothing
       reads it EXCEPT the test title quoted inside it, which the citation
       multiset reads like any other quoted title -- deleting that quotation
       is red. Rewording the rest moves nothing -- measured, mutation M7-A4
       on #75, where dropping the clause that makes a paragraph citation
       count left the suite green. It is the one claim in the sheet that
       cannot have a proof pointer, because it is the sentence that says
       what a proof pointer IS.
     - What the stylesheet LOOKS like. Nothing here renders it. The lines it
       reads as data are NON-TOKEN PAINT, AVATAR INK TOKEN, SAME FOCUS RING
       AS and DIFFERENT FOCUS RING; everything else the prose-framed readers
       take out of ops/assets/pane-alerts-v2.css is its TEXT, and each of
       those readers is named in PROSE_FRAMES_OVER_THE_SHEET, which is held
       to the number of frames this file actually opens. There used to be a
       second enumeration here, of the KINDS of text they read; it was bound
       by nothing, it went stale the round it was last edited, and deleting
       two of its items was green (found in the eleventh review of #75,
       MX-13). The named list is the inventory; a prose paraphrase of it was
       a second place to be wrong. No rule below is rendered, and
       nothing here can see a colour as a pixel --
       scripts/check-ops-contrast.mjs is the tool that judges contrast, and
       it is not run from here.
     - What the sheet's count sentences MEAN beyond their number word.
       sheetCount() resolves the word the sentence states and refuses a
       NUMBER_ISH word either side of it; a modifier that is not a number
       word is invisible to it, so "Two times six columns in 760px", "Half
       of six columns", "Twice one card per problem" and "Double three
       columns of label-and-value rows" each resolve to the component and
       stay green (measured, the fifteenth review of #75). Wider word lists
       were declined: the list would be the claim, and nothing would bind it.
     - The WORDING of focusable()'s refusals. What is bound is that a shape
       reaches the throw rather than an answer, through the probe rows that
       say `refused`, and the `focusable() cannot tell: ` prefix every
       message starts with. The causes a message names after that prefix are
       prose -- reverting the <area> message to the two-cause wording it had
       before the fifteenth review is green (measured, the same review).
     - WHICH sentence a citation belongs to. The multiset below holds the
       number of SITES a title is quoted at, so deleting a citation is red
       and so is inventing one -- but MOVING a quotation from the sentence
       it proves to a sentence it does not is both at once and is invisible:
       the abandoned claim goes unbound with no NOT BOUND line, and the
       receiving claim reads as proven (measured, RV16-3a in the sixteenth
       review of #75, which cited this very test for an invented padding
       rule and stayed green). The sheet's own HOW TO READ says a citation
       cannot go stale IN PLACE, which is the narrower thing that is true.
     - The CASCADE, for the accent and ink a severity draws. The pairing
       test reads the classes off the drawn card and then reads what each
       class DECLARES, across every sheet the page loads. The two sides are
       held differently and the difference is the point. For --acc, the
       rules that paint it are LISTED, so a rule spelled any other way is
       red for being on no list -- `.p-item { --acc }`, green through three
       reviews as RV17-1e, reds now. The list is keyed on the SELECTOR and
       collected by the property name, so an escape in the PROPERTY --
       `--ac\63`, which repainted every rail with 75 green in the twentieth
       review -- walks past the list itself; it reds in the refusal test
       instead, which fails any sheet holding a backslash at all. For the
       ink, `color` is painted by dozens of rules across the three sheets
       and no list is possible, so it is the reader that refuses: a selector
       mentioning the class it cannot take apart, or holding a backslash or
       `[class`, is a failure. What stays invisible is an ink rule that
       mentions the class nowhere in its text -- by element, by another
       class, or by an attribute that is not `class`. Specificity is not
       modelled anywhere in this file, and scripts/check-ops-contrast.mjs
       is the tool that reads pixels.
     - Anything the operations API decides.
     - What the scripts this file and the sheet POINT AT do. Both name
       scripts/check-ops-*.mjs tools in prose; the test "every script this
       file and the sheet point at is a script that exists" resolves those
       filenames on disk, so a renamed or deleted tool is red rather than a
       dangling pointer (the seventeenth review of #75 renamed both and
       stayed green). What they MEASURE is theirs to prove, not this
       file's. The role checks below prove the
       pane draws a fact rather than a control that would be refused; the
       server enforces the same rules independently and is tested in the Aria
       monorepo.
     - That no value becomes markup. The test "the pane never spells
       innerHTML, outerHTML or insertAdjacentHTML" pins the spellings it
       names and nothing more; it is a prohibition, not a proof. It is not the last
       test in the file, which is what this line said until the third review
       of #75 read it -- and the title it then cited belonged to three OTHER
       suites, which the fourth review read. Citations in THIS file now carry
       the words `The test` before the quote and are resolved, the way the
       stylesheet's are.
     - That a browser moves focus to <body> when the focused element is
       REMOVED, or when it is DISABLED. Both are true in Chrome and neither is
       true in this harness, which has no focus model to lose. Both halves
       were measured on the real page, in rounds 4 and 5 (removal) and round 6
       (disabling) of this pull request's independent review.

       What the tests below CAN decide, and do: that the severity control is
       still the same node after it is pressed, and that a re-read or a
       refused write which STARTS with focus parked on <body> ends with focus
       on the right node. That is the same start state a browser produces when
       a control is disabled or removed, which is why focusAfter() parks there
       rather than resting at null -- resting at null exercised the half of
       the pane's guard that a browser can never reach, and left the half it
       always reaches free to be deleted over a green suite. Round 7 of this
       pull request's review demonstrated exactly that.

       The class is every control that is DISABLED OR DESTROYED by being used,
       which is not the same as every re-read, and not the same as every
       control handler either: rounds 4 through 8 each found members the round
       before had missed -- three re-reads, three more re-reads, three refused
       writes, the two writes that SUCCEED (whose re-read arrives through
       afterChange() rather than from a control's own handler), and then the
       two the server answers ops_problem_moved to, which are afterChange()'s
       other two call sites and are not failures. Sharing a function is not
       the same as being one site: each is named below on its own.

       The guards are pinned in BOTH directions. Narrowing them is round 7's
       finding; widening them to ignore `live` entirely would satisfy every
       assertion that starts from <body> while carrying the operator off a
       control that survived, which is round 4's fix undone -- so the severity
       button (this pane's own, marked in place rather than rebuilt) and the
       range select (#fRange, which the SHELL draws and this pane never
       redraws) are each used with focus ON them, and asserted to still hold
       it. Two different mechanisms of survival, one assertion each; the
       second probe used to land on this pane's own #fCategory while the
       sentence around it claimed the shell's control (Stadiora/Aria#10460).

       The enumeration below is the part of this file a reader should distrust
       first. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import nodeTest from 'node:test';
import vm from 'node:vm';

import { makeDom, allText, findAll } from './ops-dom-harness.mjs';

/* Every title this file registers, collected as it registers them rather
   than scraped out of the source. The stylesheet cites tests BY TITLE and
   says a claim naming one is thereby bound; a citation that stops resolving
   would leave the sentence around it reading as proven while nothing held it
   up, which is Stadiora/Aria#10632 in the device built to close it. The set
   is complete by the time any test BODY runs, because node:test registers
   every top-level test while the module evaluates. */
const TEST_TITLES = new Set();
const test = (name, ...rest) => {
  TEST_TITLES.add(name);
  return nodeTest(name, ...rest);
};

const OPS = new URL('../ops/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, OPS), 'utf8');

const REGISTRY_SRC = read('assets/pane-registry.js');
const ARIA_SRC = read('assets/aria.js');
const SHELL_SRC = read('assets/shell-pane-v2.js');
const V1_SHELL_SRC = read('assets/shell.js');
const OPERATE_SRC = read('assets/operate.js');
const MODEL_SRC = read('assets/alerts-model.js');
const PANE_SRC = read('assets/pane-alerts.js');
const PANE_CSS = read('assets/pane-alerts-v2.css');
const ARIA_CSS = read('assets/aria.css');
const THIS_FILE = readFileSync(new URL(import.meta.url), 'utf8');

/* Every stylesheet the PAGE loads, in the order it loads them, taken from the
   page rather than typed here: a reader that knows about two of the three
   sheets is blind to whatever the third declares, and the sixteenth review
   put an accent override in shell-pane-v2.css and watched 482 tests pass.

   Attribute ORDER and quoting are not assumed: the first spelling of this
   read `rel` before `href` and dropped `<link href=... rel=stylesheet>`
   entirely, which is valid HTML, so a fourth sheet written that way repainted
   every card with 75 tests green (found in the eighteenth review of #75).

   The tag scan that used to stand below stopped at the first `>`, which no
   HTML parser does: a `>` inside a quoted attribute value cut a tag in half
   and the half with the `rel` on it disappeared, which was a fourth sheet
   neither side of an equality drawn from THIS ARRAY could notice (found in
   the nineteenth review of #75). Two further readings of the raw text held
   it then -- a count of `rel=stylesheet` spellings and the quote PARITY of
   each tag. Both are GONE, with the scan they were propping up: the walk
   below reads a quoted attribute value the way the parser does, so a `>`
   inside one no longer cuts a tag in half, and a quote left open runs to
   the next `"` anywhere in the document -- or, if there is none, to EOF,
   where the tag is dropped exactly as the parser drops it. What holds the
   invariant now is a single equality against the list above, `PAGE_SHEETS`
   against `V2_STYLESHEETS` in the accent-ink test at the bottom of this
   file, and every read of the walk the census at the bottom can SEE is gated
   on it having refused nothing.

   The walk reads BYTES where the parser reads a DECODED attribute value,
   and `rel="&#115;tylesheet"` is `rel="stylesheet"` to the browser and not
   to it: a fourth sheet loaded that way repainted every card with 75 tests
   green (found in the twentieth review of #75). So the references it can
   resolve it RESOLVES -- numeric, decimal and hex, applied to each
   extracted attribute value on its own, which is the position the parser
   resolves them in -- and the ones it cannot it REFUSES: `no character
   reference in the page survives the decoder` fails on any `&` the decode
   leaves behind, which is every named reference and every numeric one
   missing its `;`. That refusal is blunt in the loud direction: an `&amp;`
   in this page's PROSE would red it too, and the page has none today.

   What it still cannot see, in the browser's sense of "loads": anything a
   script injects. That USED to say the CSP closed it, and the CSP does not.
   Measured in real Chrome under this page's byte-exact policy, with the
   injecting script served from 'self' (the twentieth review of #75, RV20-4):
   an appended <style> is blocked and reports a violation, but an appended
   <link rel=stylesheet> PAINTS, and a constructed sheet pushed onto
   adoptedStyleSheets PAINTS. The `no unsafe-inline` assertion at the CSP
   test is real and closes the <style> route only; the other two routes are
   open, unread here, and named on the NOT COVERED list at the top of this
   file, in the bullet `A sheet no <link> tag in the page spells`.
   A sheet pulled in by @import is invisible to this and its rules really do
   paint (measured, RV19-2a); it is not read here, it is REFUSED below --
   the ASCII spelling by the `@import` scan, and `@\69 mport`, which is the
   same at-keyword to a browser and holds none of its letters in a row (also
   RV20-2), by the backslash refusal that covers every escape in every sheet
   at once. */
const RAW_HTML = read('alerts.html');
/* The space characters HTML separates a tag name from an attribute with, and
   an attribute name from its value with: exactly TAB, LF, FF, CR and SPACE.
   JS's `\s` also matches U+00A0 and the rest of the Unicode space class, and
   none of those separate anything -- they are ordinary characters INSIDE the
   name. Reading with `\s` took `data<NBSP>content="..."` for the content
   attribute of a tag whose real attribute is named `data<NBSP>content`
   (RV26-1, the same shape one level down from the finding that named it). */
const HTML_SP = ' \\t\\n\\f\\r';
const SP = '[' + HTML_SP + ']';
const HTML_SP_SET = new Set([' ', '\t', '\n', '\f', '\r']);
/* A character reference is resolved by the parser in exactly two positions:
   inside an attribute VALUE, and in text. Never in a tag name, never in an
   attribute name, and never as a delimiter -- `&#34;` is four characters of
   value, not a quote, and `&#62;` does not end a tag. This file decoded the
   WHOLE page and then looked for tags in the result, which is the wrong
   ORDER, and four payloads walked through it with every assertion green and
   the page changed underneath (the twenty-eighth review of #75, all four
   re-measured in real Chrome in round 29):
     - `<meta &#104;ttp-equiv="Content-Security-Policy" content="...">`:
       Chrome enforces NO policy, the attribute being named `&#104;ttp-equiv`.
       The decoded text said the page carried one, and this read it.
     - `&#99;ontent="..."` on the real pragma: same, a pragma with no content
       attribute is no policy at all.
     - `content="style-src 'self'&#34; &#39;unsafe-inlin&#101;&#39;;"`:
       Chrome ships `'unsafe-inline'` in the source list that governs a
       <style> ELEMENT and an injected <style> PAINTS. The decoded text held
       a `"` that closed the value four characters in, so the reader saw
       `style-src 'self'` and agreed with the bullet at the top of this file.
     - `&#114;el="stylesheet"` on aria.css: the page loads with no design
       system. The decoded text counted three sheets and read the missing
       one's rules out of the file on disk.
   So the walk below runs over RAW bytes, and this decoder is applied to
   extracted attribute VALUES, one at a time, which is the position the
   parser applies it in. Named references (`&amp;`) and numeric ones missing
   their `;` are not resolved here at all: a page that spells one is REFUSED,
   in the <link> test at the bottom of this file. */
const decodeRefs = (s) => s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, n) => String.fromCodePoint(
  n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10)));
/* Raw text and RCDATA: everything between one of these start tags and its
   matching end tag is TEXT to the parser, not markup, so a `<meta>` written
   inside one is not a tag and not a pragma. <noscript> is on the list
   because this page is only ever visited with scripting ENABLED, which is
   what makes its content raw text; a browser with scripting off parses that
   content as markup, and nothing in this file would notice.

   `noframes`, `iframe`, `noembed` and `xmp` are on it because they are
   RAWTEXT too, and the first of those was the whole of a false green: the
   CSP pragma wrapped in <noframes> shipped NO policy in Chrome -- the tag is
   text, the parser builds no meta -- while this file, which had `noframes`
   on its head-keeping list three lines below but not here, read the text as
   a pragma and stayed green (the twenty-ninth review of #75, M29R-5). It is
   the same payload as the <noscript> one this PR published as newly bound,
   one name apart. `plaintext` is handled separately below: it has no end
   tag at all and runs to EOF. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript', 'textarea', 'title',
  'noframes', 'iframe', 'noembed', 'xmp']);
/* Where a comment ENDS, which is four spellings and not one. `-->` is the
   common one; `--!>` closes it too (comment-end-bang state: the tokeniser
   emits the comment and returns to data); and `<!-->` and `<!--->` are
   already-closed empty comments. Searching only for `-->` swallowed
   everything up to the NEXT one as comment content, which is how a <link>
   and a head-ending letter hid inside what this walk called a comment while
   Chrome loaded a fourth stylesheet that painted every rail, and put the
   page's pragma in <body> (the twenty-ninth review of #75, M29R-1, M29R-2
   and M29R-3 -- all three green here before this function existed). */
const commentEndOf = (html, lt) => {
  let k = lt + 4;
  if (html[k] === '>') return k + 1;
  if (html[k] === '-' && html[k + 1] === '>') return k + 2;
  while (k < html.length) {
    const dash = html.indexOf('--', k);
    if (dash < 0) return html.length;
    let m = dash + 2;
    while (html[m] === '-') m += 1;
    if (html[m] === '>') return m + 1;
    if (html[m] === '!' && html[m + 1] === '>') return m + 2;
    k = dash + 1;
  }
  return html.length;
};
/* Where a raw-text element ENDS, which is not the first `</name` in it. The
   tokeniser's end-tag-name states only close the element when the name is
   followed by HTML space, `/` or `>`; on anything else -- another letter,
   or EOF -- they emit `</` and the buffered name as CHARACTERS and stay in
   raw text. So `</scriptx` does not end a <script>, and reading it as one
   built a tag named `scriptx` whose quoted attribute value then ran past
   the real `</script>` and swallowed a whole <link rel=stylesheet>: Chrome
   loaded four sheets and painted every card rgb(255, 0, 0) while 76 tests
   passed and the refusal list stayed EMPTY (the thirtieth review of #75,
   M30R-1). It is one instance per raw-text name, so the round that widened
   the list above widened this with it.

   The condition is a single character class rather than a state machine,
   which is why this is DECIDED here and the double-escaped <script> below
   is refused: the cost of being right about it is this loop. */
const appropriateEndOf = (html, name, from) => {
  const lower = html.toLowerCase();
  let close = lower.indexOf('</' + name, from);
  while (close >= 0) {
    const after = html[close + 2 + name.length];
    if (after !== undefined && (HTML_SP_SET.has(after) || after === '/' || after === '>')) break;
    close = lower.indexOf('</' + name, close + 2);
  }
  return close;
};
/* The nodes of a document, in document order: start tags carrying the
   attribute MAP the tokeniser would build for them, end tags, comments and
   doctypes. The walk is the HTML tokeniser's, cut down to what this page
   needs.

   It replaces two regex scans -- `<link\b[^>]*>` and a `<meta` lookahead --
   that had no DOCUMENT state and so read as tags things the browser never
   had. A whole `<meta http-equiv="Content-Security-Policy" content="...">`
   written inside ANOTHER tag's quoted attribute value was read here as the
   page's policy while Chrome saw one inert attribute on a <div> and shipped
   no policy at all (the twenty-eighth review of #75, finding 2). A comment,
   a doctype, and the text inside a <script> or a <noscript> are the same
   shape one level down. Each is decided here for the spellings named
   below. It is NOT true that a page wearing a shape this walk does not
   model reds rather than being guessed at -- that sentence stood here and
   was falsified in three consecutive reviews (M29R-1, M29R-3, M29R-5,
   M30R-1), each time by a shape the round before had not thought of, so it
   is deleted rather than re-qualified. What is true is narrower and is all
   that is claimed: ONE shape is refused by name (a double-escaped
   <script>, below), and the refusal list this returns is asserted empty by
   every test the census at the bottom SEES reading the walk. That is
   narrower than "every test that reads the walk", and deliberately so: the
   census reaches exactly as far as its own text scan does, its docblock
   says how far, and this sentence claims no more than it. WHICH tests
   those are is derived there rather than counted here -- this sentence
   said "both" when there were three (the thirtieth review of #75, finding
   2). Everything else this walk gets wrong, it gets wrong silently.

   What the walk does, in the tokeniser's order: `<` followed by an ASCII
   letter starts a tag and nothing else does; `<!--` runs to wherever
   commentEndOf() above says the comment ends, which is four spellings;
   `<!` and `<?` run to the first `>`; a tag name ends at HTML space,
   `/` or `>`; then, repeatedly, skip space and `/`, read an attribute name
   up to space, `/`, `>` or `=`, then an optional `=` and a double-quoted,
   single-quoted or unquoted value. The FIRST spelling of an attribute name
   wins, which is what the parser does with a duplicate (measured in Chrome,
   round 28), and a `>` inside a quoted value does NOT end the tag, which is
   what `[^>]*>` got wrong. Names are lowercased; values are decoded once,
   with decodeRefs, and nothing else is.

   Two shapes are DROPPED rather than read. A tag that never closes -- EOF
   inside it, which an unterminated quote produces when no later `"` closes
   the value -- is dropped,
   because the parser throws it away too, and reading one would be this file
   finding a policy in a tag the browser never built. An attribute whose name
   starts with `=` (`<meta =http-equiv=...>`, which the parser keeps as an
   attribute NAMED `=http-equiv`) is dropped as well. Neither drop can
   INVENT a pragma or a sheet; both can only lose one, and losing one reds.

   ONE shape is REFUSED rather than modelled: a DOUBLE-ESCAPED <script>.
   `<script><!--<script>` puts the tokeniser in a state where the next
   `</script>` does NOT end the element, so a walk that ends at the first
   one reads the bytes after it as markup and can INVENT a tag the parser
   never built -- a pragma, in the payload that found this (the twenty-ninth
   review of #75, M29R-4: Chrome built no meta at all and shipped no policy,
   and this file read a policy out of script text and stayed green). The
   state machine that decides it is four tokeniser states wide; a refusal is
   two lines, cannot be wrong in the green direction, and is what the page
   actually needs, since nothing in this repo double-escapes a script.

   What it does not model, and what stillInHead() below refuses rather than
   guesses at: where in the tree the parser would have PUT the node. `at`
   and `end` are byte offsets so a caller can say "before that one", and
   `end` for a raw-text start tag is where the walk resumed, past the text,
   so the gaps between nodes hold the page's text and not its script. */
function nodesOf(html, refusals = []) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = commentEndOf(html, lt);
      out.push({ kind: 'comment', name: '#comment', attrs: new Map(), at: lt, end, text: '' });
      i = end;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const close = html.indexOf('>', lt);
      const end = close < 0 ? html.length : close + 1;
      out.push({ kind: 'doctype', name: '#doctype', attrs: new Map(), at: lt, end, text: '' });
      i = end;
      continue;
    }
    const isEnd = html[lt + 1] === '/';
    let j = lt + (isEnd ? 2 : 1);
    if (!/[a-zA-Z]/.test(html[j] || '')) { i = lt + 1; continue; }
    let name = '';
    while (j < html.length && !HTML_SP_SET.has(html[j]) && html[j] !== '/' && html[j] !== '>') {
      name += html[j];
      j += 1;
    }
    name = name.toLowerCase();
    const attrs = new Map();
    let closed = false;
    while (j < html.length) {
      while (j < html.length && (HTML_SP_SET.has(html[j]) || html[j] === '/')) j += 1;
      if (j >= html.length) break;
      if (html[j] === '>') { closed = true; j += 1; break; }
      let attr = '';
      while (j < html.length && !HTML_SP_SET.has(html[j])
        && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') {
        attr += html[j];
        j += 1;
      }
      while (j < html.length && HTML_SP_SET.has(html[j])) j += 1;
      let value = '';
      if (html[j] === '=') {
        j += 1;
        while (j < html.length && HTML_SP_SET.has(html[j])) j += 1;
        if (html[j] === '"' || html[j] === "'") {
          const quote = html[j];
          j += 1;
          while (j < html.length && html[j] !== quote) {
            value += html[j];
            j += 1;
          }
          j += 1;
        } else {
          while (j < html.length && !HTML_SP_SET.has(html[j]) && html[j] !== '>') {
            value += html[j];
            j += 1;
          }
        }
      }
      if (attr && !attrs.has(attr.toLowerCase())) attrs.set(attr.toLowerCase(), decodeRefs(value));
    }
    if (!closed) break;
    let end = j;
    if (!isEnd && name === 'plaintext') end = html.length;
    else if (!isEnd && RAW_TEXT_ELEMENTS.has(name)) {
      const close = appropriateEndOf(html, name, j);
      end = close < 0 ? html.length : close;
      if (name === 'script') {
        const text = html.slice(j, end).toLowerCase();
        const esc = text.indexOf('<!--');
        if (esc >= 0 && /<script[\s/>]/.test(text.slice(esc))) {
          refusals.push('a double-escaped <script> at byte ' + lt + ': `<!--` and then `<script` '
            + 'inside script text put the tokeniser in a state where the next `</script>` does '
            + 'not end the element, and this walk cannot tell where it does end');
        }
      }
    }
    out.push({ kind: isEnd ? 'end' : 'start', name, attrs, at: lt, end, text: html.slice(lt, j) });
    i = end;
  }
  return out;
}
/* Shapes the walk refused to model on THIS page. Every test the census
   SEES reading the walk asserts this is empty, so the refusal is a red
   rather than a comment nobody runs. The set is derived from this file's
   source by `every test that reads the document walk asserts the walk
   refused nothing`, because the sentence that used to stand here counted
   them by hand and counted wrong; what that census can and cannot see is
   in its own docblock, and this sentence claims no more than it. */
const WALK_REFUSALS = [];
const PAGE_NODES = nodesOf(RAW_HTML, WALK_REFUSALS);
const PAGE_TAGS = PAGE_NODES.filter((n) => n.kind === 'start');
const LINK_TAGS = PAGE_TAGS.filter((n) => n.name === 'link');
const META_TAGS = PAGE_TAGS.filter((n) => n.name === 'meta');
/* The text between one node and the next. A raw-text start tag ends past its
   text, so what is left in these gaps is the document's TEXT -- which is the
   thing that ends <head> -- and not the body of a <script>, FOR THE NAMES on
   RAW_TEXT_ELEMENTS and for comments whose end commentEndOf() computes. That
   qualifier is the finding: `noframes` was off the list and a `--!>` ended a
   comment the walk read past, so a gap held bytes the parser did not treat
   as text and a head-ending letter hid inside them (the twenty-ninth review
   of #75, M29R-3 and M29R-5). A raw-text element also ends where the
   tokeniser ends it rather than at the first `</name`, which is the whole
   of appropriateEndOf() above: `</scriptx a="` ended a <script> here and
   nowhere else, and the tag the walk built out of it swallowed a <link>
   that loaded a fourth stylesheet and painted every card rgb(255, 0, 0)
   (the thirtieth review of #75, M30R-1). Whether any gap can still hold
   script is NOT claimed settled: a sentence here said the double-escaped
   <script> was the one shape left, and the round after it found another
   (M30R-1 is that other one). The double-escaped <script> is refused by
   the walk rather than measured here; what else a gap could hold is the
   partial-tokeniser disclosure at the top of this file, not a closed set. */
const NODE_GAPS = PAGE_NODES.map((n, k) => RAW_HTML.slice(k ? PAGE_NODES[k - 1].end : 0, n.at));
/* The names that keep the parser in <head>. <template> is deliberately NOT
   among them: a <meta> inside a template is inert, this walk cannot tell
   inside from after, and refusing is the direction that reds. */
const HEAD_START_TAGS = new Set(['html', 'head', 'base', 'basefont', 'bgsound', 'link', 'meta',
  'noframes', 'noscript', 'script', 'style', 'title']);
const HEAD_END_TAGS = new Set(['noframes', 'noscript', 'script', 'style', 'title']);
/* Whether the parser is still in <head> when it reaches this node, answered
   CONSERVATIVELY: true only when every node before it is one of the handful
   that keeps the parser there, and every byte of text before it is HTML
   space. A <body> tag, an unknown element, a <template>, a `</head>`, one
   non-space character -- any of those makes it false, and the caller reds
   rather than reading on.

   This is a REFUSAL, not a model of the insertion modes, and the difference
   is which way it is wrong. It answers false for pages that really are still
   in head: a pragma written after an explicit `</head>` is RE-PARENTED into
   the head by the parser and enforced (measured in Chrome, round 29 -- the
   meta's parent is HEAD and an injected <style> is blocked), and this says
   false for it. That is a loud red about a policy that is really there. It
   does not answer true for a node the parser moved OUT of head, for as far
   as the walk above agrees with the parser about which bytes are MARKUP:
   every way head ends -- a start tag not on the list, an end tag not on the
   list, or non-space text -- is on the false side of it, and each of those
   is read out of the walk's nodes and gaps. Where the walk cannot agree it
   refuses in exactly ONE case -- the double-escaped <script> below -- and
   GUESSES in every other, so this sentence is worth no more than the
   partial-tokeniser disclosure at the top of this file. That qualifier is
   not decoration: a letter hidden inside what the walk wrongly
   called a comment made this answer TRUE for a pragma Chrome had put in
   <body>, and the page shipped no policy (the twenty-ninth review of #75,
   M29R-3, fixed by commentEndOf()). The claim is only ever as good as the
   tokenising underneath it.

   Three shapes this and the walk above turn from green into red, each
   measured in real Chrome as shipping NO policy the browser enforces
   (RV25-1, re-measured in round 26 and again in round 29 against the
   injected <style>'s own `.sheet`, which is null exactly when the policy
   blocked it), and each green here through twenty-eight reviews: the pragma
   commented out, the pragma wrapped in <noscript>, and the pragma moved into
   <body>. The first two are dropped by the walk before they reach this; the
   third is what this answers false for. They were the whole of the
   disclosure in the bullet at the top of this file, and they are now bound
   instead. A fourth, found while measuring them: ONE non-space character
   before the pragma -- a stray NBSP, a letter, a <div>, a <meta-x> -- ends
   the head, puts the pragma in <body>, and ships no policy either. That is
   what the text check is for, and why it uses HTML's spaces: `trim()` would
   read the NBSP as space and let it through. */
const stillInHead = (node) => {
  const idx = PAGE_NODES.indexOf(node);
  return idx >= 0
    && PAGE_NODES.slice(0, idx).every((n) => n.kind === 'comment' || n.kind === 'doctype'
      || (n.kind === 'start' && HEAD_START_TAGS.has(n.name))
      || (n.kind === 'end' && HEAD_END_TAGS.has(n.name)))
    && NODE_GAPS.slice(0, idx + 1).every((g) => [...g].every((c) => HTML_SP_SET.has(c)));
};
/* `rel` is a space-separated TOKEN LIST, not a value: `rel="next stylesheet"`
   is a stylesheet to the browser, and an equality against the whole string
   says no. That loaded a fourth sheet painting every rail with 76 tests
   green, and carried an escape and an @import inside it past both refusals,
   which only ever look at sheets this list found (twenty-second review of
   #75). Over-reading is the safe direction here and is left alone: an
   `alternate` stylesheet, or one with `media="print"` or `disabled`, is read
   although the browser does not apply it, which can only produce a false
   RED about a rule that is really there. */
const relTokens = (tag) => (tag.attrs.get('rel') || '').toLowerCase()
  .split(new RegExp(SP + '+')).filter(Boolean);
/* The sheets ops/alerts.html loads, TYPED BY HAND, so this statement owes
   nothing to the walk above. Two
   readers are held against it: `html.includes(...)`, a raw substring scan,
   in the test that says the page loads one design system, and a deepEqual
   against PAGE_SHEETS, the parsed list, in the <link> test at the bottom.

   It replaces a counter that matched `rel\s*=\s*...` over the decoded page
   and compared its length with PAGE_SHEETS.length. That was called an
   independent reading here and was not one: both sides came off the same
   text through the same decoder, so `&#114;el="stylesheet"` on aria.css was
   invisible to BOTH -- the page loads with no design system, and the two
   readings agreed with each other that it loaded three sheets (the
   twenty-eighth review of #75). A list a person typed cannot agree with a
   reader's mistake.

   An attribute-name boundary is what the old reader needed and this no
   longer has to have: `data-href` ends in `href` with a `-` in front of it,
   `\b` is a WORD boundary, and the first spelling of the <link> half
   returned the DECOY from `<link rel="stylesheet" data-href="assets/empty.css"
   href="real.css">` -- 75 tests green with a fourth sheet painting every
   rail, and the escapes and @imports inside that sheet carried past the
   refusals with it (twenty-first review of #75). The walk answers that by
   construction: `data-href` is an attribute named `data-href`. */
const V2_STYLESHEETS = ['assets/aria.css', 'assets/shell-pane-v2.css',
  'assets/pane-alerts-v2.css'];
const PAGE_SHEETS = LINK_TAGS
  .filter((t) => relTokens(t).includes('stylesheet'))
  .map((t) => t.attrs.get('href') ?? null);

/* The PREFIXED docblock lines this file reads as DATA rather than as prose.
   Every reader OF A PREFIXED LINE goes through machineLine(), which refuses a
   prefix that is not listed, and the NOT COVERED bullet at the top of this
   file is checked against the list rather than counting them by hand -- it
   said "three" while four were read, and the fourth arrived in the same
   commit as the word three (found in the third review of
   antonyrugama/aria-website#75).

   It said "every reader" until the fourth review, which found that the next
   reader added after it was written -- the regex frame over the paint-stem
   sentence -- does not read a prefixed line and so cannot go through this.
   The other kind is enumerated separately, below. */
const MACHINE_READ_PREFIXES = [
  'NON-TOKEN PAINT', 'AVATAR INK TOKEN', 'SAME FOCUS RING AS', 'DIFFERENT FOCUS RING',
];
/* The OTHER way this file reads the sheet's docblock as data: a regex frame
   over a PROSE sentence, which has no prefix and so cannot go through
   machineLine(). Enumerated, because a test named for a class has to say
   which class. NO COUNT IS TYPED HERE, and that is deliberate: this comment
   said "two" while the list below held three, and the fifth review of #75
   showed the count was bound by nothing -- rewriting it to "seventeen" left
   the suite green, because only the list's LENGTH is ever read, never the
   word. A count in prose beside the list it counts is the overclaim this
   file exists to catch; the list is the count.

   The shape this catches is the whitespace-collapsing spelling below, which
   every frame needs, because the sheet's docblock is hard-wrapped and no
   sentence in it survives on one line. The shapes it MISSES: a frame written
   over the raw text with `[\s\S]` or `\s+` in the pattern instead, a frame
   over a copy taken before the collapse, and any reading of the sheet outside
   this file. */
/* Typed once, and checked against BOTH sides: the declaration below must
   really be called this, and the NOT COVERED bullet must really point at it.
   Found by my own round-6 battery -- dropping the name from the bullet left
   the suite green, so the pointer was prose like any other. */
const FRAMES_LIST_NAME = 'PROSE_FRAMES_OVER_THE_SHEET';
/* The lists the SHEET points at by name. Same device as
   FRAMES_LIST_NAME one line up, pointed the other way: renaming either
   constant while the sheet went on naming the old one was green, and
   READER_PROBES is the sly one -- it is spelled in a test title too, so the
   citation multiset kept the title alive while the list it named walked away
   underneath it (found in the seventh review of #75, RV7-1 and RV7-1b).
   Membership is derived FROM the sheet below, not asserted against itself:
   checking only the names on the list let the list be emptied, which turned
   the whole device off in silence and let the sheet grow a dangling third
   pointer (found in the eighth review of #75). The shape it reads is an
   UPPER_SNAKE identifier -- a pointer spelled without an underscore, or in
   lower case, is not seen by it. */
const SHEET_POINTER_SHAPE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const LISTS_THE_SHEET_NAMES = ['UNREADABLE_TOKENS', 'READER_PROBES'];
const PROSE_FRAMES_OVER_THE_SHEET = [
  'the paint stems the reader has',
  'the stemless properties a keyword walks past on',
  'the double-quoted test titles the sheet cites',
  'the pill words the sheet quotes beside white-space: nowrap',
  'the number of cards the sheet says the list holds per problem',
  'the number of fact columns the sheet says a card draws',
  'the number of columns the sheet says the rules table draws in 760px',
  'the number of words the sheet says the condition pill wraps to',
  'the width the sheet states in the sentence about six columns',
  'the sheet saying a colour keyword is looked for on every custom property',
  'the sheet naming both filter syntaxes as cases that get run',
];
const FRAME_SPELLING = /PANE_CSS\.replace\(\/\\s\+\/g, ' '\)/g;
/* sheetCount() collapses the whitespace ITSELF, so a frame routed through it
   adds no occurrence of the spelling above and moved the count by nothing --
   a fourth missed shape, opened by the round that added the helper, and the
   one the next frame will be written in (found in the eleventh review of
   #75, MX-20/21). Its call sites are counted instead, and the helper's own
   body is cut out of the scan so its collapse is not a frame of its own.
   Both scans read the file as TEXT and cannot tell code from comment, so
   writing either spelling inside a comment counts as a frame -- over-counting,
   which fails loudly, rather than the under-counting this exists to catch. */
const HELPER_FRAME_SPELLING = /sheetCount\(\//g;
/* The anchor carries a leading NEWLINE, and the reason is the bug this line
   had when it was written: indexOf('function sheetCount(') matched THIS
   HELPER'S OWN string literal, 3200 lines above the declaration, so the
   slice cut 49 unrelated lines and left the real body -- and its frame --
   in the scan. The count came out right anyway, because the list had been
   given a spare entry in the same round, so two errors cancelled and the
   suite was green. The literal below cannot match itself: the characters
   here are a backslash and an `n`, and only the declaration is preceded by
   an actual line break. Uniqueness and identity are both asserted rather
   than assumed (found by my own round-12 reading of the eleventh review's
   B3 fix). */
const outsideSheetCount = (text) => {
  const start = text.indexOf('\nfunction sheetCount(');
  assert.ok(start >= 0, 'sheetCount() is gone, so the frame count is scanning for a helper '
    + 'this file no longer has');
  assert.equal(text.indexOf('\nfunction sheetCount(', start + 1), -1,
    'this file declares sheetCount() twice, so the cut below removes one body and counts '
    + 'the other one\'s frame');
  const end = text.indexOf('\n}\n', start);
  assert.ok(end > start, 'sheetCount() is unterminated');
  const body = text.slice(start, end);
  assert.ok(body.includes('COUNT_WORDS[word]'),
    'the text cut out as sheetCount()\'s body does not end by resolving a count word, so '
    + 'the anchor has drifted onto something else and an unrelated region is being cut');
  return text.slice(0, start) + text.slice(end);
};

const machineLine = (prefix, tail = '(.*)') => {
  assert.ok(MACHINE_READ_PREFIXES.includes(prefix),
    prefix + ' is read as data but is not on MACHINE_READ_PREFIXES');
  return new RegExp('^\\s*' + prefix + ':' + tail + '$', 'm');
};

const TOKENS = {
  '--cyan': '#22D3EE', '--violet': '#A78BFA', '--emerald': '#34D399',
  '--amber': '#FBBF24', '--rose': '#FB7185', '--blue': '#60A5FA',
  '--line-2': '#1F2A36', '--ink': '#E6EDF3',
};

/* ------------------------------------------------------------- fixtures */

const MINUTE = 60000;
const DAY = 86400000;
const at = (ms) => new Date(Date.now() - ms).toISOString();

/* One whole problem. Every test starts here and takes something away or
   changes one field, because most of what is under test is about absence.

   The title and the summary deliberately contain none of the words
   "critical", "warning" or "info", so a test that the severity is stated in
   words cannot pass on a sentence that happens to contain the word. */
function problem(over) {
  return Object.assign({
    id: 'prb_1', reference: 'AO-118',
    ruleKey: 'ai_success_rate', ruleTitle: 'AI success rate',
    ruleThreshold: 'below 95% for 10m',
    severity: 'critical', category: 'ai_reliability', categoryLabel: 'AI reliability',
    status: 'open',
    title: 'Plan generation keeps giving up',
    summary: 'About one request in ten ends without a plan.',
    scopeKey: 'aria', scopeLabel: 'Aria (athletes)',
    observedValue: 8900, thresholdValue: 9500, durationSeconds: 600,
    detail: null,
    workPane: 'jobs-live', workPaneLabel: 'Happening now',
    firstBreachedAt: at(50 * MINUTE), firedAt: at(45 * MINUTE),
    lastObservedAt: at(MINUTE), conditionClearedAt: null,
    acknowledgedAt: null, acknowledgedByEmail: null,
    closedAt: null, closedByEmail: null, closeReason: null,
  }, over || {});
}

function closedProblem(over) {
  return problem(Object.assign({
    id: 'prb_9', reference: 'AO-101', status: 'closed',
    title: 'Chat replies were slow for twenty minutes',
    severity: 'warning',
    firedAt: at(3 * DAY), closedAt: at(2 * DAY),
    closedByEmail: 'owner@example.invalid', closeReason: 'self_resolved',
    acknowledgedAt: at(3 * DAY - 10 * MINUTE),
    acknowledgedByEmail: 'owner@example.invalid',
  }, over || {}));
}

function rule(over) {
  return Object.assign({
    ruleKey: 'ai_success_rate', title: 'AI success rate',
    scopeDescription: 'Per request type', category: 'ai_reliability',
    enabled: true, severity: 'critical',
    thresholdValue: 9500, thresholdUnit: 'basis_points', durationSeconds: 600,
    thresholdLabel: 'below 95% for 10m', channels: ['email'],
    rationale: null,
    lastEvaluatedAt: at(2 * MINUTE), lastEvaluationStatus: 'firing',
    lastInsufficientReason: null, lastFiredAt: at(45 * MINUTE),
  }, over || {});
}

function rulesFixture(rules) {
  return {
    rules: rules === undefined ? [
      rule(),
      rule({
        ruleKey: 'queue_wait', title: 'GPU queue backing up',
        scopeDescription: 'Sprint video analysis',
        thresholdUnit: 'count', thresholdLabel: 'over 10 for 5m',
        lastEvaluationStatus: 'ok', lastFiredAt: null,
      }),
      rule({
        ruleKey: 'cost_anomaly', title: 'Unusual cost for a service',
        scopeDescription: 'Against the last 7 days',
        thresholdUnit: 'basis_points', thresholdLabel: 'over 25%',
        lastEvaluationStatus: 'insufficient_data',
        lastInsufficientReason: 'below_minimum_samples',
        lastFiredAt: null,
      }),
    ] : rules,
    summary: {},
    channels: [
      { channel: 'teams', label: 'Microsoft Teams', configured: true,
        lastDeliveryStatus: 'ok', lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: at(5 * MINUTE), lastSuccessAt: at(5 * MINUTE) },
      { channel: 'email', label: 'Email', configured: false,
        lastDeliveryStatus: null, lastFailureReason: null, consecutiveFailures: 0,
        lastAttemptAt: null, lastSuccessAt: null },
    ],
  };
}

/* A rules answer where nothing is in a position to notice anything: enabled,
   but no rule reached a verdict the last time it ran. */
function blindRules() {
  return rulesFixture([
    rule({ lastEvaluationStatus: 'error', lastFiredAt: null }),
    rule({ ruleKey: 'queue_wait', title: 'GPU queue backing up',
      lastEvaluationStatus: 'insufficient_data',
      lastInsufficientReason: 'no_samples', lastFiredAt: null }),
  ]);
}

function manyProblems(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(problem({
      id: 'prb_' + i, reference: 'AO-' + (200 + i),
      firedAt: at((i + 1) * MINUTE),
      severity: i === 0 ? 'critical' : 'warning',
    }));
  }
  return out;
}

/* -------------------------------------------------------------- the page */

function buildPage(dom, body) {
  const el = (parent, tag, attrs = {}) => {
    const node = dom.element(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  body.setAttribute('data-pane', 'alerts');
  body.className = 'is-booting';
  const boot = el(body, 'main', { class: 'gate gate-boot gate-center' });
  el(boot, 'h1', { class: 'sr' }).textContent = 'Aria Operations';
  el(body, 'main', { class: 'gate gate-failed gate-center', id: 'gateFailed', tabindex: '-1' });
  const appGate = el(body, 'div', { class: 'gate gate-app' });
  el(appGate, 'div', { id: 'app' });
}

/* Loads the page the way ops/alerts.html loads it: registry, aria.js, the
   bootstrap, the alerts model, then the pane module.

   `answers` is handed back mutable, so a test can change what the API says and
   then use a real control on the page to make the pane read again — which is
   the only way to test what survives a re-render. */
async function boot(options) {
  const opts = options || {};
  const calls = [];
  const role = opts.role || 'owner';
  const answers = {
    open: opts.open === undefined ? { problems: [problem()] } : opts.open,
    closed: opts.closed === undefined ? { problems: [] } : opts.closed,
    rules: opts.rules === undefined ? rulesFixture() : opts.rules,
    detail: opts.detail === undefined ? { runbook: [], timeline: [], ruleHistory: [] } : opts.detail,
    acknowledge: opts.acknowledge === undefined ? {} : opts.acknowledge,
    close: opts.close === undefined ? {} : opts.close,
    patch: opts.patch === undefined ? {} : opts.patch,
  };

  const dom = makeDom({
    tokens: TOKENS,
    href: 'https://ops.example.invalid/ops/alerts.html' + (opts.search || ''),
  });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  buildPage(dom, body);

  function answerFor(endpoint, o) {
    const method = (o && o.method) || 'GET';
    if (endpoint === '/api/ops/alerts/rules') return answers.rules;
    if (endpoint.indexOf('/api/ops/alerts/rules/') === 0 && method === 'PATCH') return answers.patch;
    if (endpoint === '/api/ops/alerts/problems') {
      return (o && o.query && o.query.status === 'closed') ? answers.closed : answers.open;
    }
    if (/\/acknowledge$/.test(endpoint)) return answers.acknowledge;
    if (/\/close$/.test(endpoint)) return answers.close;
    if (endpoint.indexOf('/api/ops/alerts/problems/') === 0) return answers.detail;
    return undefined;
  }

  dom.window.OpsTheme = { current: () => 'dark', toggle() {} };
  dom.window.OpsSession = {
    state: { admin: { displayName: 'Owner', email: 'owner@example.invalid', role } },
    boot: () => Promise.resolve({ admin: dom.window.OpsSession.state.admin }),
    call: (endpoint, o) => {
      calls.push({
        endpoint,
        method: (o && o.method) || 'GET',
        query: o && o.query,
        body: o && o.body,
      });
      const answer = answerFor(endpoint, o);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error('no stub for ' + endpoint));
      return Promise.resolve({ data: answer });
    },
    signOut: () => Promise.resolve(),
    role: () => role,
    hasRole: (roles) => !roles || roles.indexOf(role) !== -1,
    daysLeft: () => 12,
  };

  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(ARIA_SRC, dom.window, { filename: 'aria.js' });
  vm.runInContext(SHELL_SRC, dom.window, { filename: 'shell-pane-v2.js' });
  vm.runInContext(MODEL_SRC, dom.window, { filename: 'alerts-model.js' });
  vm.runInContext(PANE_SRC, dom.window, { filename: 'pane-alerts.js' });

  await settle();

  return { ...dom, body, calls, answers, shell: dom.window.OpsPaneShell };
}

async function settle(times) {
  for (let i = 0; i < (times || 10); i += 1) await new Promise((r) => setImmediate(r));
}

/* ------------------------------------------------------------- reading it */

/* The panel the operator can actually see. The loading, empty and degraded
   panels are siblings of it and are hidden by aria.css, so reading the whole
   region would read text nobody is looking at. */
function panel(dom, state) {
  const shown = dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => (n.getAttribute('data-state') || '').split(' ').indexOf(state) !== -1);
  return shown[0];
}

const liveText = (dom) => allText(panel(dom, 'live'));
const emptyText = (dom) => allText(panel(dom, 'empty'));

/* Which of the four states aria.js has actually shown. */
function shownState(dom) {
  return dom.doc.getElementById('content')
    .querySelectorAll('[data-state]')
    .filter((n) => n.hasAttribute('data-shown'))
    .map((n) => n.getAttribute('data-state'));
}

function withClass(root, cls) {
  return findAll(root, (n) => (n.getAttribute && (n.getAttribute('class') || ''))
    .split(/\s+/).indexOf(cls) !== -1);
}

const problemCards = (dom) => withClass(panel(dom, 'live'), 'p-item');
const ruleRows = (dom) => withClass(dom.doc.body, 'rule-row');

function buttonNamed(root, re) {
  return findAll(root, (n) => n.tagName === 'BUTTON' && re.test(allText(n)))[0] || null;
}

const numerals = (text) => (text.match(/\d/g) || []).length;

/* What can take a tab stop, as far as the document ITSELF can say.

   This helper answered seven cases wrong (Stadiora/Aria#10633) because the
   tabindex branch ran ahead of both the disabled check and the tag check and
   because Number('') is 0. Order is most of it: `disabled` beats tabindex,
   `tabindex="-1"` asks to be OUT of the tab order, and a tabindex whose value
   has no leading digits is IGNORED by the parser.

   Independent review has found more since; all of them are rows of
   FOCUSABLE_PROBES marked FOUND IN REVIEW, and how many is printed beside
   the table rather than typed here. No count of the rounds either: this
   sentence said "two, and a third more again" through five of them, which
   is the same drift one line down, in the paragraph warning about it.
   What the two rounds between them corrected: tabindex is fed through HTML's
   rules for parsing INTEGERS rather than validated, and a parsed value
   outside the range of a long is an error just as a missing digit is; of two
   nested editing HOSTS only the outermost takes a stop, and that is decided
   before href -- but an <a href> that is merely CONTENT of a host takes no
   stop either, where a <button> in the same place keeps one, so href is not
   simply deferred to the host; an
   <input type="hidden"> takes none; a <details> takes its first <summary>
   CHILD rather than its first child, and one with no <summary> at all is the
   agent's business rather than this helper's.

   Every answer below is a row of FOCUSABLE_PROBES, which runs this helper
   against the case and compares it with a typed expectation. FOCUSABLE_PROBES
   is this helper's TEST surface, and saying it is the helper's whole surface
   would be the claim this file exists to stop making: review rounds have
   repeatedly found answers no row covered, and each time the row came after
   the finding rather than before it.
   What it cannot decide it REFUSES by throwing, rather than guessing: a wrong
   answer from a guard is worse than no guard.

   NOT MODELLED, and answered anyway rather than refused, because none of it
   is legible from ONE node's markup: focusability that CSS decides
   (display: none, visibility: hidden), shadow DOM, and Chrome's extra tab
   stop for a scrollable box that contains nothing focusable, which Safari
   does not grant. The rules table depends on none of them: it carries its
   own tabindex.

   That sentence used to read "none of it is legible from the markup", which
   was false of a fourth case it was covering: a radio group's one stop IS
   decided by type, name and checked. The fourth review of #75 measured four
   members this helper called tab stops that Chrome gives none to. A NAMED
   radio is now refused rather than answered at any NON-NEGATIVE tabindex,
   which is the narrowest true statement of it: the fifth review of #75 found
   an explicit tabindex="0" or "2" still being answered, and the refusal moved
   above that branch. It sits BELOW the disabled and negative-tabindex
   branches, which stay answers -- both are decided by the node alone
   whatever its group does, and refusing them would be wrong (mutation M6-R4
   on #75). An unnamed radio is answered. */
const FOCUSABLE_TAGS = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
const DISABLEABLE_TAGS = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET', 'OPTGROUP', 'OPTION'];
const HREF_TAGS = ['A', 'AREA'];
const MEDIA_TAGS = ['AUDIO', 'VIDEO'];
/* Whether these take a tab stop depends on the resource they load, their
   fallback content and the browser, so the helper says it cannot tell
   instead of answering -- but only where that is still what decides it.
   hidden, inert and a negative tabindex take the element out whatever it
   loads and are answered above the refusal; a NON-negative tabindex does not
   put it back and is answered below it. */
const UNDECIDABLE_TAGS = ['OBJECT', 'EMBED'];

const attr = (node, name) =>
  (node.hasAttribute && node.hasAttribute(name) ? String(node.getAttribute(name) ?? '') : null);

const isDisabled = (node) =>
  DISABLEABLE_TAGS.includes(node.tagName) && (node.disabled === true || attr(node, 'disabled') !== null);

/* The parser's own reading of tabindex, which is HTML's RULES FOR PARSING
   INTEGERS and not the attribute's conformance requirement: skip ASCII
   whitespace, take an optional sign, collect the LEADING digits and ignore
   whatever follows. Two things make it an error -- no leading digits at all,
   and a result outside the range of a long, which is exactly the 32-bit
   signed range -- and on either the element sits where it would have without
   the attribute at all.

   So '' and '  ' and 'yes' are ignored, but '1.5' is 1 and '12abc' is 12 --
   both real tab stops, which /^[+-]?\d+$/ called invalid. And '2147483648'
   is ignored while '2147483647' is a stop, so a <button
   tabindex="-3000000000"> keeps the stop its tag gives it rather than
   losing one it never had. That spelling is bound to the probe row that
   runs it, below, because the first spelling this sentence used was
   '-3e9' -- which the same rule two lines up parses as -3, so the button
   LOSES its stop and the sentence had it backwards, with nothing reading
   the example (RV26-2). */
const TAB_INDEX_MIN = -2147483648;
const TAB_INDEX_MAX = 2147483647;
const tabIndexOf = (node) => {
  const raw = attr(node, 'tabindex');
  if (raw === null) return null;
  const body = raw.replace(/^[ \t\n\f\r]+/, '');
  if (!/^[+-]?\d/.test(body)) return null;
  const value = Number.parseInt(body, 10);
  if (!Number.isFinite(value) || value < TAB_INDEX_MIN || value > TAB_INDEX_MAX) return null;
  return value;
};

/* hidden and inert take a whole subtree out of the tab order, so an ancestor
   carrying either answers for everything under it. A disabled <fieldset>
   does the same to its controls EXCEPT those inside its first <legend>, and
   that exception is the kind of thing this helper would get wrong, so a
   descendant of one is refused rather than answered -- but only after the
   branches that answer from the node alone, which see it first. */
const suppressedBy = (node) => {
  for (let at = node; at && at.nodeType === 1; at = at.parentNode) {
    if (attr(at, 'hidden') !== null || attr(at, 'inert') !== null) return 'hidden';
    if (at !== node && at.tagName === 'FIELDSET' && isDisabled(at)) return 'fieldset';
  }
  return null;
};

/* An EDITING HOST is an element whose OWN contenteditable is in the true or
   plaintext-only state AND whose nearest such ancestor is none: a host nested
   inside a host is editable CONTENT of the outer one, and Chrome's tab ring
   gives the stop to the outer only. A contenteditable="false" between them
   breaks the chain, and the inner one is a host again. 'inherit' and any
   unrecognised value state nothing either way. */
/* No .trim(), for the reason hiddenInput() has none: contenteditable is an
   enumerated attribute, matched ASCII case-insensitively against the value
   AS WRITTEN, and anything that is not one of its keywords -- whitespace
   included -- falls to the inherit state rather than to true or false.
   Measured: <div contenteditable=" TRUE "> takes no tab stop and reports
   isContentEditable false, and a " FALSE " island does not break an editing
   host the way a `false` one does. Trimming answered both the opposite way,
   in the over-reporting direction (found in the fourteenth review of #75). */
const ownEditable = (node) => {
  const value = attr(node, 'contenteditable');
  if (value === null) return null;
  const word = value.toLowerCase();
  if (word === 'false') return false;
  if (word === '' || word === 'true' || word === 'plaintext-only') return true;
  return null;
};

const editable = (node) => {
  if (ownEditable(node) !== true) return false;
  for (let at = node.parentNode; at && at.nodeType === 1; at = at.parentNode) {
    const own = ownEditable(at);
    if (own === true) return false;
    if (own === false) return true;
  }
  return true;
};

/* Whether an ancestor makes this node the CONTENT of an editing host.
   Chrome's rule is narrower than "the outermost host takes the stop": a
   <button>, <input>, <select>, <textarea>, <iframe> or <audio controls>
   inside a host keeps its own stop, and a link-shaped element loses one --
   measured over HTTP with full ring walks in the eighth review of #75.
   The walk starts at the NODE, not at its parent. A contenteditable="false"
   island ends it as NOT content wherever it sits, and the node can BE the
   island: <a href contenteditable="false"> directly inside a host takes its
   stop (measured, ring walk DIV,p,end,start), and starting at the parent
   answered it false -- under-reporting reachability, which is the direction
   the live caller's emptiness check cannot survive (found in the ninth
   review of #75). A node whose OWN value is true is a nested host, which
   takes no stop either, and editable() has already answered the outermost
   one above. */
const inEditingHost = (node) => {
  for (let at = node; at && at.nodeType === 1; at = at.parentNode) {
    const own = ownEditable(at);
    if (own === true) return true;
    if (own === false) return false;
  }
  return false;
};

/* An <input type="hidden"> is not rendered at all, so it takes no tab stop
   even carrying tabindex="0". Markup decides this one, not the sheet. */
/* No .trim(): `type` is an enumerated attribute, matched ASCII
   case-insensitively against the value AS WRITTEN. <input type=" hidden">
   matches no keyword, falls to the Text state, and Chrome gives it a tab stop
   -- measured, full ring walk: p,end,start. Trimming answered it the
   opposite way, ahead of tabIndexOf, and no probe told the two apart (found
   in the eleventh review of #75, MX-19). */
const hiddenInput = (node) =>
  node.tagName === 'INPUT' && (attr(node, 'type') || '').toLowerCase() === 'hidden';

function focusable(node) {
  if (node.nodeType !== 1) return false;
  const suppressed = suppressedBy(node);
  if (suppressed === 'hidden') return false;
  if (isDisabled(node)) return false;
  if (hiddenInput(node)) return false;

  const index = tabIndexOf(node);
  /* A NEGATIVE tabindex is an answer for any tag, so it is taken before the
     <object>/<embed> refusal below: hidden, inert, disabled and tabindex="-1"
     all take the element out whatever it loads, and refusing them was this
     helper saying "cannot tell" about cases the document settles (found in
     the third review of antonyrugama/aria-website#75). A NON-negative one is
     NOT an answer for those two tags, so it stays below. Measured: bare
     <object tabindex="0"> takes no stop, the SAME element with a loaded
     data= takes one, and empty <div tabindex="0"> takes one -- so answering
     the non-negative case from the attribute would be wrong half the time,
     which is worse than refusing it. */
  if (index !== null && index < 0) return false;
  /* Below those two for the same reason the negative-tabindex branch is
     above the <object> refusal: the fieldset's first-<legend> exception is
     the part this helper would get wrong, but a node that is itself disabled
     or carries tabindex="-1" takes no stop whatever the fieldset does, and
     refusing it was this helper saying "cannot tell" about a case the node
     settles alone (found in the ninth review of #75; both measured). */
  if (suppressed === 'fieldset') {
    throw new Error('focusable() cannot tell: a descendant of a disabled <fieldset> is '
      + 'disabled unless it is inside that fieldset\'s first <legend>');
  }
  if (UNDECIDABLE_TAGS.includes(node.tagName)) {
    throw new Error('focusable() cannot tell: <' + node.tagName.toLowerCase()
      + '> takes a tab stop in some browsers and not others');
  }
  /* A radio GROUP takes one sequential tab stop between all its members --
     the checked member, or the first member in tree order when none is
     checked -- and every other member takes none. Which members are in the
     group is decided by the owner FORM (two forms are two groups, and a
     form= attribute can put a radio in a form it does not sit inside), so a
     single node cannot answer it. This helper said `true` for every member
     until the fourth review of #75 measured Chrome. An UNNAMED radio, or one
     with name="", is in no group at all and always takes its own stop --
     measured, not assumed -- so it is answered rather than refused.
     ABOVE the non-negative tabindex branch, which is where the fifth review
     of #75 found it still answering: a tabindex does not take a radio out of
     its group, it only moves where the group's one stop sits in the order.
     Measured, same ring walk: name=g unchecked WITH a checked sibling takes
     no stop at tabindex=1 or 2, while the same markup with NO checked member
     takes the stop at tabindex=1 or 2. One node's markup is identical across
     that pair, so no attribute on it can decide the answer. A NEGATIVE
     tabindex still answers false above this: that one is out of the ring
     whatever the group does. */
  if (node.tagName === 'INPUT' && (attr(node, 'type') || '').toLowerCase() === 'radio'
    && attr(node, 'name')) {
    throw new Error('focusable() cannot tell: a radio group takes one tab stop between all '
      + 'its members, and which members are in the group is decided by the owner form');
  }
  /* ABOVE the non-negative tabindex branch, for the reason the radio group is:
     a tabindex does not make the rest of the document legible from this node.
     An <area> is a stop only where a RENDERED <img usemap> uses the <map> it
     sits in, and that is as true of a tabindex as it is of an href -- measured,
     same ring walk, and the pair is the proof: <area tabindex="0"> with no href
     takes a stop when the map is used and none when it is not, with identical
     markup on the node. It was answered `true` by the branch five lines below,
     which over-reported reachability (found in the twelfth review of #75).
     An own contenteditable in the true or plaintext-only state does the same
     thing a tabindex does -- measured both ways round, a stop only with the
     map used -- and moving this branch above `editable()` took that answer
     away from it and left `false` behind, in the under-reporting direction
     (found in the thirteenth review of #75). What is left for `false` is the
     node that settles it itself: no href, no tabindex, no own editability. A
     NEGATIVE tabindex was answered false above and never reaches here. */
  if (node.tagName === 'AREA') {
    if (attr(node, 'href') === null && index === null && ownEditable(node) !== true) return false;
    throw new Error('focusable() cannot tell: an <area> that an href, a non-negative '
      + 'tabindex or its own contenteditable could make reachable takes a tab stop only '
      + 'where a rendered <img usemap> uses its <map>');
  }
  if (index !== null) return index >= 0;

  /* Before the href branch: an <a contenteditable> with no href is an editing
     host and a real tab stop, which asking about href first answers wrong. */
  if (editable(node)) return true;
  /* An <a href> that is CONTENT of an editing host takes no tab stop, while
     a <button> or an <iframe> in the same place keeps its own. The docblock
     used to say the outermost host is decided BEFORE href, which was true
     only of elements not focusable by their tag: this one fell through
     editable() into the branch below and was answered true, over-reporting
     reachability (found in the eighth review of #75). */
  if (node.tagName === 'A' && attr(node, 'href') !== null && inEditingHost(node)) return false;
  if (HREF_TAGS.includes(node.tagName)) return attr(node, 'href') !== null;
  if (node.tagName === 'IFRAME') return true;
  if (MEDIA_TAGS.includes(node.tagName)) return attr(node, 'controls') !== null;
  /* A <details> with NO <summary> child is given one by the user agent, and
     whether that supplied control takes a stop is the agent's business, so
     this one is refused too. With a <summary>, the <summary> is the stop and
     the <details> is not. */
  if (node.tagName === 'DETAILS') {
    if (Array.from(node.children).some((child) => child.tagName === 'SUMMARY')) return false;
    throw new Error('focusable() cannot tell: a <details> with no <summary> child is given '
      + 'one by the user agent');
  }
  /* A <details> takes its FIRST <summary> CHILD as its disclosure control --
     not its first child, and not a <summary> nested deeper. Any other
     <summary> is ordinary text. */
  if (node.tagName === 'SUMMARY') {
    const parent = node.parentNode;
    if (!parent || parent.tagName !== 'DETAILS') return false;
    return Array.from(parent.children).find((child) => child.tagName === 'SUMMARY') === node;
  }
  return FOCUSABLE_TAGS.includes(node.tagName);
}

/* ====================== focusable(), against cases ===================== */

/* Guard code is code. Every row is a case a browser has a definite answer
   for, or -- for the rows marked `cannot tell` -- one this helper will not
   guess at. `answer` is typed here from the HTML standard's own rules and
   never read back out of the helper, and every row was then enumerated
   against Chrome's real sequential focus ring, walked to completion rather
   than by one Tab press, because a positive tabindex forms its own group
   ahead of document order. That enumeration is published on
   antonyrugama/aria-website#75 and is NOT re-run by this suite: what runs
   here is the typed column.

   The rows marked WAS WRONG are the ones Stadiora/Aria#10633 enumerated. The
   rows marked FOUND IN REVIEW are the ones independent review of the fix for
   those found still wrong. Both are counted below the table
   rather than here, so a count and its rows cannot come apart. */
const FOCUSABLE_PROBES = [
  { name: '<button>', tag: 'button', answer: true },
  { name: '<button disabled>', tag: 'button', props: { disabled: true }, answer: false },
  { name: '<button tabindex="-1">', tag: 'button', attrs: { tabindex: '-1' }, answer: false,
    note: 'WAS WRONG: true. -1 asks to be out of the tab order' },
  { name: '<input>', tag: 'input', answer: true },
  { name: '<input disabled>', tag: 'input', props: { disabled: true }, answer: false },
  { name: '<input disabled tabindex="0">', tag: 'input', props: { disabled: true },
    attrs: { tabindex: '0' }, answer: false,
    note: 'WAS WRONG: true. disabled beats tabindex' },
  { name: '<input type="hidden">', tag: 'input', attrs: { type: 'hidden' }, answer: false,
    note: 'FOUND IN REVIEW: true. it is not rendered, so it is not in the ring' },
  { name: '<input type="hidden" tabindex="0">', tag: 'input',
    attrs: { type: 'hidden', tabindex: '0' }, answer: false,
    note: 'FOUND IN REVIEW: true. not rendered beats an explicit tabindex' },
  /* `type` is enumerated: matched case-insensitively on the value AS
     WRITTEN, with no whitespace stripped. All three measured in Chrome. */
  { name: '<input type="HIDDEN" tabindex="0">', tag: 'input',
    attrs: { type: 'HIDDEN', tabindex: '0' }, answer: false,
    note: 'FOUND IN REVIEW: true. the keyword match is case-insensitive' },
  { name: '<input type=" hidden" tabindex="0">', tag: 'input',
    attrs: { type: ' hidden', tabindex: '0' }, answer: true,
    note: 'FOUND IN REVIEW: true. a leading space matches no keyword, so it is a text '
      + 'input and takes its stop -- trimming answered it false' },
  { name: '<select>', tag: 'select', answer: true },
  { name: '<textarea>', tag: 'textarea', answer: true },
  { name: '<div>', tag: 'div', answer: false },
  { name: '<div tabindex="0">', tag: 'div', attrs: { tabindex: '0' }, answer: true },
  { name: '<div tabindex="2">', tag: 'div', attrs: { tabindex: '2' }, answer: true },
  { name: '<div tabindex="-1">', tag: 'div', attrs: { tabindex: '-1' }, answer: false },
  { name: '<div tabindex="">', tag: 'div', attrs: { tabindex: '' }, answer: false,
    note: 'WAS WRONG: true. Number(\'\') is 0; the parser reads an invalid value as absent' },
  { name: '<div tabindex="  ">', tag: 'div', attrs: { tabindex: '  ' }, answer: false,
    note: 'WAS WRONG: true. same' },
  { name: '<div tabindex=" 0 ">', tag: 'div', attrs: { tabindex: ' 0 ' }, answer: true },
  { name: '<div tabindex="+0">', tag: 'div', attrs: { tabindex: '+0' }, answer: true },
  { name: '<div tabindex="1.5">', tag: 'div', attrs: { tabindex: '1.5' }, answer: true,
    note: 'FOUND IN REVIEW: false. parsing integers takes the leading digits: this is 1' },
  { name: '<div tabindex="12abc">', tag: 'div', attrs: { tabindex: '12abc' }, answer: true,
    note: 'the shape that shows the parse is not a validity test: this is 12' },
  { name: '<div tabindex="yes">', tag: 'div', attrs: { tabindex: 'yes' }, answer: false },
  { name: '<a>', tag: 'a', answer: false },
  { name: '<a href>', tag: 'a', attrs: { href: '/ops/alerts.html' }, answer: true },
  { name: '<a contenteditable>', tag: 'a', attrs: { contenteditable: '' }, answer: true,
    note: 'FOUND IN REVIEW: false. asking about href first answered before editing host' },
  { name: '<div contenteditable>', tag: 'div', attrs: { contenteditable: '' }, answer: true,
    note: 'WAS WRONG: false. the unsafe direction: an editable box reported unreachable' },
  { name: '<div contenteditable="true">', tag: 'div', attrs: { contenteditable: 'true' },
    answer: true },
  { name: '<div contenteditable="plaintext-only">', tag: 'div',
    attrs: { contenteditable: 'plaintext-only' }, answer: true },
  { name: '<div contenteditable="TRUE">', tag: 'div', attrs: { contenteditable: 'TRUE' },
    answer: true,
    note: 'FOUND IN REVIEW: true. the keyword match is ASCII case-insensitive, and stays so' },
  { name: '<div contenteditable=" TRUE ">', tag: 'div', attrs: { contenteditable: ' TRUE ' },
    answer: false,
    note: 'FOUND IN REVIEW: true. an enumerated attribute is matched on the value as '
      + 'written, so the padded keyword falls to the inherit state -- measured, no stop' },
  { name: '<div contenteditable="true ">', tag: 'div', attrs: { contenteditable: 'true ' },
    answer: false,
    note: 'FOUND IN REVIEW: true. one trailing space is enough -- measured, no stop' },
  { name: '<div contenteditable=" plaintext-only ">', tag: 'div',
    attrs: { contenteditable: ' plaintext-only ' }, answer: false,
    note: 'FOUND IN REVIEW: true. measured, no stop' },
  { name: '<div contenteditable="false">', tag: 'div', attrs: { contenteditable: 'false' },
    answer: false },
  { name: '<div contenteditable="inherit">', tag: 'div', attrs: { contenteditable: 'inherit' },
    answer: false },
  { name: '<div contenteditable="wat">', tag: 'div', attrs: { contenteditable: 'wat' },
    answer: false, note: 'an unrecognised value is the inherit state, not the true state' },
  { name: '<div contenteditable tabindex="-1">', tag: 'div',
    attrs: { contenteditable: '', tabindex: '-1' }, answer: false,
    note: 'an editing host can still ask to be out of the tab order' },
  { name: '<iframe>', tag: 'iframe', answer: true, note: 'WAS WRONG: false' },
  { name: '<audio controls>', tag: 'audio', attrs: { controls: '' }, answer: true,
    note: 'WAS WRONG: false' },
  { name: '<audio>', tag: 'audio', answer: false },
  { name: '<video controls>', tag: 'video', attrs: { controls: '' }, answer: true },
  { name: '<button hidden>', tag: 'button', attrs: { hidden: '' }, answer: false },
  { name: '<button inert>', tag: 'button', attrs: { inert: '' }, answer: false },
  { name: '<summary> outside <details>', tag: 'summary', answer: false },
  { name: '<summary> first in <details>', tag: 'summary', wrap: 'details', answer: true },
  { name: '<summary> after a <div> in <details>', tag: 'summary', wrap: 'details',
    wrapBefore: ['div'], answer: true,
    note: 'FOUND IN REVIEW: false. the rule is first <summary> child, not first child' },
  { name: '<summary> after a <summary> in <details>', tag: 'summary', wrap: 'details',
    wrapBefore: ['summary'], answer: false },
  { name: '<summary> nested in <details>', tag: 'summary', wrap: 'div', outerWrap: 'details',
    answer: false, note: 'a <summary> deeper than a child is ordinary text' },
  { name: '<button> inside <div inert>', tag: 'button', wrap: 'div', wrapAttrs: { inert: '' },
    answer: false },
  { name: '<div> inside <div contenteditable>', tag: 'div', wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. the stop is the editing HOST; this is its content' },
  { name: '<div contenteditable="false"> inside <div contenteditable>', tag: 'div',
    attrs: { contenteditable: 'false' }, wrap: 'div', wrapAttrs: { contenteditable: '' },
    answer: false },
  { name: '<object>', tag: 'object', answer: 'cannot tell',
    why: 'measured in Chrome it takes no stop at tabIndex 0, but that is the empty case: '
      + 'what a loaded resource or fallback content does is not in the markup' },
  { name: '<embed>', tag: 'embed', answer: 'cannot tell',
    why: 'same, and its tabIndex reads -1 where <object> reads 0, so even the IDL the two '
      + 'expose disagrees on elements this helper cannot distinguish' },
  { name: '<object hidden>', tag: 'object', attrs: { hidden: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. hidden takes it out whatever it loads, so the refusal '
      + 'below does not get to answer this one' },
  { name: '<object> inside <div inert>', tag: 'object', wrap: 'div', wrapAttrs: { inert: '' },
    answer: false, note: 'FOUND IN REVIEW: true. same, from an ancestor' },
  { name: '<object tabindex="-1">', tag: 'object', attrs: { tabindex: '-1' }, answer: false,
    note: 'FOUND IN REVIEW: true. asking to be out of the order is an answer for any tag' },
  { name: '<embed tabindex="-1">', tag: 'embed', attrs: { tabindex: '-1' }, answer: false,
    note: 'FOUND IN REVIEW: true. same' },
  { name: '<object tabindex="0">', tag: 'object', attrs: { tabindex: '0' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. and this is why the refusal stays BELOW the non-negative '
      + 'case: measured, bare it takes no stop and with a loaded data= it does, so the '
      + 'attribute alone does not decide it' },
  /* Chrome, full ring walks over HTTP, fourth review of #75: of two radios
     named the same, only ONE takes a stop -- the checked one, else the first
     -- and two forms are two groups. All four were answered `true`. */
  { name: '<input type="radio" name="g">', tag: 'input',
    attrs: { type: 'radio', name: 'g' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. first of an unchecked group takes the stop and every '
      + 'other member takes none, and which members are in the group is the owner form\'s' },
  { name: '<input type="radio" name="g" checked>', tag: 'input',
    attrs: { type: 'radio', name: 'g', checked: '' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured it DOES take the stop, but only because it is '
      + 'the checked member of its group, which one node cannot see' },
  { name: '<input type="radio">', tag: 'input', attrs: { type: 'radio' }, answer: true,
    why: 'no name, so no group: measured, two nameless radios both take a stop' },
  { name: '<input type="radio" name="">', tag: 'input', attrs: { type: 'radio', name: '' },
    answer: true, why: 'name="" is no group either -- measured, both members take a stop' },
  { name: '<input type="radio" name="g" disabled>', tag: 'input',
    attrs: { type: 'radio', name: 'g' }, props: { disabled: true }, answer: false,
    why: 'disabled is decided above the refusal, so the group never comes into it' },
  { name: '<input type="radio" name="g" tabindex="-1">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '-1' }, answer: false,
    why: 'a negative tabindex is out of the ring whatever the group does' },
  /* Chrome, same ring walk, fifth review of #75: a tabindex does not take a
     radio out of its group, it only moves where the group's one stop sits.
     Both rows below were answered `true` by the non-negative branch, which
     ran above the refusal. The measurement that settles it is a PAIR whose
     probe markup is character-identical: name=g unchecked at tabindex=2
     takes the stop when no member is checked, and takes NONE when a sibling
     is checked. Nothing on the node itself differs between those two. */
  { name: '<input type="radio" name="g" tabindex="0">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '0' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured no stop as the unchecked non-first member of '
      + 'its group, so a tabindex of 0 does not buy it one' },
  { name: '<input type="radio" name="g" tabindex="2">', tag: 'input',
    attrs: { type: 'radio', name: 'g', tabindex: '2' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured BOTH ways on identical node markup -- a stop '
      + 'with no checked member in the group, none with one -- so it is the group again' },
  { name: '<input type="radio" tabindex="0">', tag: 'input',
    attrs: { type: 'radio', tabindex: '0' }, answer: true,
    why: 'unnamed, so no group to refuse for: measured, it takes its own stop' },
  { name: '<area href>', tag: 'area', attrs: { href: '/ops/alerts.html' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. a stop only inside a <map> a rendered <img usemap> uses' },
  { name: '<area> with no href', tag: 'area', answer: false,
    note: 'FOUND IN REVIEW: true. no href, no tabindex and nothing else that reaches '
      + 'outside the node, so no stop in any arrangement -- measured with the map used '
      + 'and unused' },
  { name: '<area tabindex="0"> with no href', tag: 'area', attrs: { tabindex: '0' },
    answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. measured: a stop when a rendered <img usemap> uses the '
      + 'map, none when it does not, with identical markup on the node' },
  { name: '<area href tabindex="0">', tag: 'area',
    attrs: { href: '/ops/alerts.html', tabindex: '0' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. the tabindex does not make the used-map fact legible' },
  { name: '<area tabindex="-1"> with no href', tag: 'area', attrs: { tabindex: '-1' },
    answer: false,
    why: 'out of the ring whatever the map does, and answered above the refusal' },
  { name: '<area contenteditable="true"> with no href', tag: 'area',
    attrs: { contenteditable: 'true' }, answer: 'cannot tell',
    note: 'FOUND IN REVIEW: true. an own contenteditable makes it a stop in a used map '
      + 'and not in an unused one, exactly as a tabindex does' },
  { name: '<area contenteditable=" TRUE "> with no href', tag: 'area',
    attrs: { contenteditable: ' TRUE ' }, answer: false,
    note: 'FOUND IN REVIEW: true. the padded keyword is not editability, so the node does '
      + 'settle it -- measured in a used map, no stop' },
  { name: '<area contenteditable="false"> with no href', tag: 'area',
    attrs: { contenteditable: 'false' }, answer: false,
    note: 'FOUND IN REVIEW: true. the false state is not editability, and it is a stop in '
      + 'no arrangement -- measured in a used map' },
  { name: '<area contenteditable="true" tabindex="-1">', tag: 'area',
    attrs: { contenteditable: 'true', tabindex: '-1' }, answer: false,
    note: 'FOUND IN REVIEW: true. measured: no stop in a used map, and the negative '
      + 'tabindex answers it above this branch' },
  { name: '<details> with a <summary> child', tag: 'details', childBefore: ['summary'],
    answer: false, why: 'the <summary> is the stop; its <details> is not' },
  { name: '<details> with no <summary>', tag: 'details', answer: 'cannot tell',
    note: 'FOUND IN REVIEW: false. the agent supplies a summary, and Chrome gives it a stop' },
  { name: '<div tabindex="2147483647">', tag: 'div', attrs: { tabindex: '2147483647' },
    answer: true, why: 'the largest value a long holds, so still a real index' },
  { name: '<div tabindex="2147483648">', tag: 'div', attrs: { tabindex: '2147483648' },
    answer: false,
    note: 'FOUND IN REVIEW: true. one past a long is an ERROR, so the div is a plain div' },
  { name: '<div tabindex="999999999999999999999">', tag: 'div',
    attrs: { tabindex: '999999999999999999999' }, answer: false,
    note: 'FOUND IN REVIEW: true. the same error, far enough out to lose precision as well' },
  { name: '<button tabindex="-3000000000">', tag: 'button', attrs: { tabindex: '-3000000000' },
    answer: true,
    note: 'FOUND IN REVIEW: false. the UNSAFE direction: an out-of-range value is ignored, '
      + 'so the button keeps the stop its tag gives it' },
  { name: '<select tabindex="-2147483649">', tag: 'select', attrs: { tabindex: '-2147483649' },
    answer: true, note: 'FOUND IN REVIEW: false. one below a long, same as above' },
  { name: '<div tabindex="-2147483648">', tag: 'div', attrs: { tabindex: '-2147483648' },
    answer: false, why: 'in range, so it is read as a negative index and asks to be out' },
  { name: '<a href> inside <div contenteditable>', tag: 'a', attrs: { href: '/x' },
    wrap: 'div', wrapAttrs: { contenteditable: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. content of an editing host, not the host: no stop' },
  { name: '<button> inside <div contenteditable>', tag: 'button', wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: true,
    note: 'FOUND IN REVIEW: true. a form control in a host KEEPS its own stop, which is '
      + 'why the rule above is about links and not about hosts' },
  { name: '<a href contenteditable="false"> inside <div contenteditable>', tag: 'a',
    attrs: { href: '/x', contenteditable: 'false' }, wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: true,
    note: 'FOUND IN REVIEW: true. the node is its OWN island, so it is not content of the '
      + 'host and keeps its stop -- measured' },
  { name: '<a href contenteditable=" FALSE "> inside <div contenteditable>', tag: 'a',
    attrs: { href: '/x', contenteditable: ' FALSE ' }, wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. a padded keyword is not the false state, so it is no '
      + 'island: the host reaches through it and the link loses its stop -- measured' },
  { name: '<a href contenteditable="true"> inside <div contenteditable>', tag: 'a',
    attrs: { href: '/x', contenteditable: 'true' }, wrap: 'div',
    wrapAttrs: { contenteditable: '' }, answer: false,
    note: 'FOUND IN REVIEW: true. a NESTED host takes no stop, and the other side of the '
      + "same branch: own true and own false must not answer alike" },
  { name: '<a href> under contenteditable="false" inside <div contenteditable>', tag: 'a',
    attrs: { href: '/x' }, wrap: 'div', wrapAttrs: { contenteditable: 'false' },
    outerWrap: 'div', outerWrapAttrs: { contenteditable: '' }, answer: true,
    note: 'FOUND IN REVIEW: true. the island is not editable, so the link takes its stop '
      + 'back -- measured, and a refusal here would throw away an answer the markup gives' },
  { name: '<div contenteditable> inside <div contenteditable>', tag: 'div',
    attrs: { contenteditable: '' }, wrap: 'div', wrapAttrs: { contenteditable: '' },
    answer: false,
    note: 'FOUND IN REVIEW: true. a host inside a host is the outer one\'s content' },
  { name: '<div contenteditable> under a false under a host', tag: 'div',
    attrs: { contenteditable: '' }, wrap: 'div', wrapAttrs: { contenteditable: 'false' },
    outerWrap: 'div', outerWrapAttrs: { contenteditable: '' }, answer: true,
    why: 'contenteditable="false" breaks the chain, so the inner one is a host again' },
  { name: '<button> inside <fieldset disabled>', tag: 'button', wrap: 'fieldset',
    wrapProps: { disabled: true }, answer: 'cannot tell' },
  { name: '<button> inside a <legend> of <fieldset disabled>', tag: 'button', wrap: 'legend',
    outerWrap: 'fieldset', outerWrapProps: { disabled: true }, answer: 'cannot tell',
    note: 'refused for a reason: Chrome gives THIS one a stop and the row above none' },
  { name: '<button disabled> inside <fieldset disabled>', tag: 'button',
    props: { disabled: true }, wrap: 'fieldset', wrapProps: { disabled: true }, answer: false,
    note: 'FOUND IN REVIEW: true. its own disabled settles it whatever the fieldset does, '
      + 'and the legend exception cannot give a disabled control a stop -- measured' },
  { name: '<button tabindex="-1"> inside <fieldset disabled>', tag: 'button',
    attrs: { tabindex: '-1' }, wrap: 'fieldset', wrapProps: { disabled: true }, answer: false,
    note: 'FOUND IN REVIEW: true. the same, from the other branch the refusal used to '
      + 'outrank -- measured, no stop' },
];

test('focusable() answers the tab order the document can decide, and refuses the rest', () => {
  const { element: make } = makeDom({});
  const build = (probe) => {
    const node = make(probe.tag);
    for (const [name, value] of Object.entries(probe.attrs || {})) node.setAttribute(name, value);
    Object.assign(node, probe.props || {});
    for (const tag of probe.childBefore || []) node.appendChild(make(tag));
    if (!probe.wrap) return node;
    const parent = make(probe.wrap);
    for (const [name, value] of Object.entries(probe.wrapAttrs || {})) parent.setAttribute(name, value);
    Object.assign(parent, probe.wrapProps || {});
    for (const tag of probe.wrapBefore || []) parent.appendChild(make(tag));
    parent.appendChild(node);
    if (!probe.outerWrap) return node;
    const outer = make(probe.outerWrap);
    for (const [name, value] of Object.entries(probe.outerWrapAttrs || {})) outer.setAttribute(name, value);
    Object.assign(outer, probe.outerWrapProps || {});
    outer.appendChild(parent);
    return node;
  };

  const got = FOCUSABLE_PROBES.map((probe) => {
    let answer;
    /* A refusal, not any crash: a bare catch let a TypeError anywhere in the
       helper stand in for "cannot tell", so the eleven refused rows were
       satisfied by `throw (undefined).boom` at their own sites (found in the
       eighth review of #75). */
    try {
      answer = focusable(build(probe));
    } catch (err) {
      assert.match(err.message, /^focusable\(\) cannot tell: /,
        'focusable() threw something that is not a refusal on ' + probe.name
        + ': ' + err.message);
      answer = 'cannot tell';
    }
    return { name: probe.name, answer };
  });
  assert.deepEqual(got, FOCUSABLE_PROBES.map((p) => ({ name: p.name, answer: p.answer })),
    'focusable() disagrees with the tab order a browser gives one of these');

  /* Derived from the answers rather than typed, so a probe that quietly
     changes side fails here as well as above, and so does one that is
     deleted. */
  const counts = {
    cases: got.length,
    takesATabStop: got.filter((g) => g.answer === true).length,
    doesNot: got.filter((g) => g.answer === false).length,
    refused: got.filter((g) => g.answer === 'cannot tell').length,
    wereWrongBefore: FOCUSABLE_PROBES.filter((p) => /^WAS WRONG/.test(p.note || '')).length,
    foundInReview: FOCUSABLE_PROBES.filter((p) => /^FOUND IN REVIEW/.test(p.note || '')).length,
  };
  assert.deepEqual(counts,
    { cases: 96, takesATabStop: 32, doesNot: 50, refused: 14, wereWrongBefore: 7,
      foundInReview: 43 });
  console.log('focusable() probes judged: ' + JSON.stringify(counts));

  /* The tabindex docblock's own worked example, bound rather than typed: the
     spelling it names has to be a probe row, and that row has to answer what
     the sentence says happens. It said <button tabindex="-3e9"> keeps its
     stop; HTML's rules for parsing integers -- which the same paragraph
     states correctly two lines earlier -- collect the LEADING digits, so
     -3e9 is -3, the button LOSES its stop, and the sentence was backwards
     with nothing reading it (RV26-2). */
  const example = THIS_FILE.replace(/\s+/g, ' ')
    .match(/so a <button tabindex="([^"]+)"> keeps the stop its tag gives it/);
  assert.ok(example, 'the tabindex docblock stopped spelling its worked example in the frame '
    + 'this test reads, so the example is unread again');
  const exampleRow = FOCUSABLE_PROBES
    .find((p) => p.tag === 'button' && p.attrs && p.attrs.tabindex === example[1]);
  assert.equal(exampleRow ? exampleRow.answer : null, true,
    'the tabindex docblock names a <button tabindex> spelling that either no probe row runs '
    + 'or a probe row answers differently: the sentence claims the button KEEPS its stop');
});

/* ================================ focus ================================ */

const severityButton = (dom, label) => findAll(dom.doc.querySelector('.filters-pane'),
  (n) => n.tagName === 'BUTTON' && allText(n) === label)[0];

/* Is this node still the one on the page, or a replacement standing where it
   stood? Identity, not shape: two buttons reading "Critical" are the same to
   every assertion in this file except this one, and the difference between
   them is whether the operator still has focus. */
const stillOnPage = (dom, node) => {
  for (let at = node; at; at = at.parentNode) if (at === dom.doc.body) return true;
  return false;
};

test('picking a severity does not replace the control being picked', async () => {
  const dom = await boot({});
  /* The bar as it is first drawn, before anything is pressed: the pane starts
     on "All" and the bar has to say so, or the operator is looking at an
     unfiltered list with no control claiming it. */
  assert.equal(severityButton(dom, 'All').getAttribute('aria-pressed'), 'true',
    'the severity the pane starts on was not marked on first render');
  assert.equal(severityButton(dom, 'Critical').getAttribute('aria-pressed'), 'false',
    'a severity the pane is not filtering on was marked on first render');

  const pressed = severityButton(dom, 'Critical');
  pressed.focus();
  pressed.dispatch('click');
  await settle();

  /* Node identity is the whole argument: a browser cannot move focus off an
     element that is still there. What this cannot see is the other half --
     that removing it WOULD move focus -- because the harness has no focus
     model to lose. That half is browser behaviour, measured on the real page
     in round 4 of the review (BUTTON "Critical" before, BODY after), and it
     is named in NOT COVERED at the top of this file rather than implied. */
  assert.ok(stillOnPage(dom, pressed),
    'the severity button was replaced by the pick, so the browser drops focus on <body> ' +
    'and the operator is returned to the top of the document on every press');
  assert.equal(pressed.getAttribute('aria-pressed'), 'true',
    'the surviving button did not take the pressed state, so the bar shows a selection ' +
    'the pane is not filtering on');
  assert.equal(severityButton(dom, 'All').getAttribute('aria-pressed'), 'false',
    'the button that was pressed before stayed pressed');
});

/* Park focus on <body>, do the thing, report where focus ended up.

   Parking first is load-bearing: if something already holds focus then the
   assertion afterwards is satisfied by the state the test started in rather
   than by anything the pane did.

   Parking on <body> RATHER THAN null is equally load-bearing, and was a false
   green for three rounds. The pane's guard reads `!live || live ===
   document.body`, and only the second half can ever be true in a browser: a
   disabled or removed control blurs to <body>, never to null. Resting at null
   exercised the branch that cannot happen and left the branch that does free
   to be deleted -- narrowing the guard to `!live` kept the whole suite green
   while dropping focus at every site in Chrome. */
async function focusAfter(dom, act) {
  if (dom.doc.activeElement) dom.doc.activeElement.blur();
  dom.doc.body.focus();
  assert.equal(dom.doc.activeElement, dom.doc.body,
    'the test could not park focus on <body>, so it is not measuring the browser case');
  act();
  await settle();
  return dom.doc.activeElement;
}

/* The read controls are INSIDE the region the re-read replaces, so unlike the
   severity control they cannot survive; what they can do is put focus back.

   Every site that re-reads is asserted here rather than one per shape. The
   sites differ only in which control was pressed, and the defect is per-site:
   the round that fixed two of these left the other three dropping focus over
   a green suite, because nothing named them. */
test('every control that reloads the pane hands focus back rather than dropping it', async () => {
  /* Both halves unreadable: the whole pane is the failed state and the shell
     draws the retry, inside the region the retry replaces. */
  const dead = await boot({
    open: new Error('upstream timed out'),
    rules: new Error('upstream timed out'),
  });
  const wholePane = buttonNamed(dead.doc.body, /Try again/);
  assert.ok(wholePane, 'the whole-pane failure drew no Try again button');
  assert.equal(await focusAfter(dead, () => wholePane.dispatch('click')),
    dead.doc.getElementById('content'),
    'the whole-pane Try again left nothing holding focus, so the operator is on <body>');

  /* One half unreadable: a band above the queue carries its own retry. */
  const partial = await boot({ open: new Error('upstream timed out') });
  const bandAgain = buttonNamed(partial.doc.body, /Try again/);
  assert.ok(bandAgain, 'the partly failed read drew no Try again button');
  assert.equal(await focusAfter(partial, () => bandAgain.dispatch('click')),
    partial.doc.getElementById('content'),
    'the band Try again left nothing holding focus');

  /* Clear the filters on the pane's own window: the shell has no range to put
     back, so the pane re-reads for itself. */
  const empty = await boot({ open: { problems: [problem({ severity: 'warning' })] } });
  empty.answers.open = { problems: [] };
  severityButton(empty, 'Critical').dispatch('click');
  await settle();
  const clear = buttonNamed(empty.doc.body, /Clear the filters/);
  assert.ok(clear, 'the filtered empty state drew no Clear the filters button');
  assert.equal(await focusAfter(empty, () => clear.dispatch('click')),
    empty.doc.getElementById('content'),
    'Clear the filters left nothing holding focus');

  /* The same button on a window that is not the pane's default takes the
     other branch: the shell puts the range back and the re-read arrives as
     ops:filters instead. One control, two code paths, and the path an
     operator reaches by changing the window was the one left dropping focus. */
  const wide = await boot({
    search: '?range=7d',
    open: { problems: [problem({ severity: 'warning' })] },
  });
  wide.answers.open = { problems: [] };
  severityButton(wide, 'Critical').dispatch('click');
  await settle();
  const clearWide = buttonNamed(wide.doc.body, /Clear the filters/);
  assert.ok(clearWide, 'the filtered empty state drew no Clear the filters button');
  assert.equal(await focusAfter(wide, () => clearWide.dispatch('click')),
    wide.doc.getElementById('content'),
    'Clear the filters on a window the pane does not start on left nothing holding focus');

  /* And it is CONDITIONAL, which the sites above cannot show: they all start
     from <body>, so a guard that ignored `live` entirely would satisfy every
     one of them while undoing the fix that started this whole class. The
     severity control is marked in place rather than rebuilt, so the operator
     is still standing on the button they pressed and nothing may move them. */
  const standing = await boot({});
  const critical = severityButton(standing, 'Critical');
  critical.focus();
  critical.dispatch('click');
  await settle();
  assert.equal(standing.doc.activeElement, critical,
    'pressing a severity carried the operator off the button they were standing on');

  /* The same question for the range control, which lives in the SHELL rather
     than in this pane and is a <select> rather than a button. That difference
     is the point, so it is asserted rather than described: #fRange is drawn by
     shell-pane-v2.js into .filters, outside the .filters-pane slot this pane
     owns, and it survives a re-read because nothing in this pane redraws it.
     A probe that landed on the pane's own #fCategory would be testing the
     opposite mechanism under this sentence.

     The value has to actually CHANGE. The shell only re-emits ops:filters
     with the new range, and this pane ignores an event whose range it is
     already showing, so dispatching over an unchanged selection would read
     nothing, move nothing, and leave the assertion below passing on a page
     where no re-read ever happened. The call count is the proof it did. */
  const ranged = await boot({ search: '?range=7d' });
  const select = ranged.doc.getElementById('fRange');
  assert.ok(select, 'the shell drew no range control');
  assert.ok(select.closest('.filters'),
    'the range control is not in the shell\'s own filter bar');
  assert.equal(select.closest('.filters-pane'), null,
    'the range control is inside the slot this pane owns, so it is not the shell\'s');
  const readsBefore = ranged.calls.length;
  select.value = '30d';
  select.focus();
  select.dispatch('change');
  await settle();
  assert.ok(ranged.calls.length > readsBefore,
    'changing the range re-read nothing, so nothing was in a position to move focus');
  assert.equal(ranged.doc.activeElement, select,
    'changing a filter carried the operator out of the control they were using');

  /* A rule switch disables itself while the PATCH is in flight, which drops
     focus on its own before the re-read replaces the row. */
  const rules = await boot({});
  const sw = withClass(rules.doc.body, 'sw')[0];
  assert.ok(sw, 'the rules table drew no switch');
  assert.equal(await focusAfter(rules, () => { sw.checked = false; sw.dispatch('change'); }),
    rules.doc.getElementById('content'),
    'turning a rule off left nothing holding focus');
});

/* The first read is not a re-read. Nothing has been thrown away, so there is
   nothing to hand back, and moving focus into the content region on load would
   take a keyboard user past the skip link and the rail without asking. */
test('the first read does not move focus', async () => {
  const dom = await boot({});
  assert.equal(dom.doc.activeElement, null,
    'loading the page moved focus, so the operator was carried past the rail');
});

/* The other half of the class, and the half that is NOT about re-reading: a
   write the server refuses disables its control, fails, and re-enables it,
   re-reading nothing. In Chrome the disable blurs the control to <body> and
   nothing puts it back; in this harness disabling does not move focus at all,
   so the discriminating signal is the same in both -- start with focus on
   NOTHING, and end with it on the control. Without the handback the pane
   leaves it where it was, which here is null and in Chrome is <body>; neither
   is the control. */
test('a write the server refuses hands the control back rather than dropping it', async () => {
  const refused = new Error('The operations API did not answer.');

  const ack = await boot({ acknowledge: refused });
  const take = buttonNamed(problemCards(ack)[0], /I am on it/);
  assert.ok(take, 'the open problem was offered no acknowledge button');
  assert.equal(await focusAfter(ack, () => take.dispatch('click')), take,
    'a refused acknowledge left the operator nowhere, at the top of the document');
  assert.equal(take.disabled, false, 'the refused acknowledge button was left unusable');

  /* "Nowhere" has two spellings and the guard accepts both. Chrome produces
     <body>, which is what focusAfter() rests on because it is the reachable
     one; a document with nothing focused at all produces null, which is
     defensive and is this scenario. Both branches of the guard are pinned, or
     the unpinned one is free to be deleted -- which is exactly how the <body>
     half survived three rounds. */
  const nulled = await boot({ acknowledge: refused });
  const nowhere = buttonNamed(problemCards(nulled)[0], /I am on it/);
  assert.equal(nulled.doc.activeElement, null, 'the page did not start with focus nowhere');
  nowhere.dispatch('click');
  await settle();
  assert.equal(nulled.doc.activeElement, nowhere,
    'a refused acknowledge with focus nowhere at all left it nowhere');

  const rule = await boot({ patch: refused });
  const sw = withClass(rule.doc.body, 'sw')[0];
  assert.ok(sw, 'the rules table drew no switch');
  assert.equal(await focusAfter(rule, () => { sw.checked = false; sw.dispatch('change'); }), sw,
    'a refused rule change left the operator nowhere');

  const closing = await boot({ close: refused });
  buttonNamed(problemCards(closing)[0], /Close/).dispatch('click');
  await settle();
  const form = withClass(problemCards(closing)[0], 'close-form')[0]
    || findAll(problemCards(closing)[0], (n) => n.tagName === 'FORM')[0];
  assert.ok(form, 'pressing Close opened no form');
  const confirm = buttonNamed(form, /Close it/);
  assert.ok(confirm, 'the close form drew no confirm button');
  assert.equal(await focusAfter(closing, () => form.dispatch('submit')), confirm,
    'a refused close left the operator nowhere');
  assert.equal(confirm.disabled, false, 'the refused close button was left unusable');

  /* The refusal is also SAID. The other two writes toast; the close form does
     not, because the form stays open and the message belongs beside it -- so
     that message is the only report a screen reader can get, and it has to
     carry a live role or it is announced to nobody. v1 said this through
     op.confirmAction's role="alert" paragraph. */
  const said = findAll(form, (n) => n.getAttribute && n.getAttribute('role') === 'alert');
  assert.equal(said.length, 1, 'the close form has ' + said.length + ' live regions, not one');
  assert.equal(allText(said[0]), 'The operations API did not answer.',
    'the refusal was written somewhere other than the live region, so nobody is told');

  /* And the handback is conditional, or it becomes its own defect: a close
     submitted with Enter from the note field never blurred the field, so
     moving the operator to the button would take them out of what they were
     typing to tell them it did not send. The live region above is what tells
     them. */
  const typing = await boot({ close: refused });
  buttonNamed(problemCards(typing)[0], /Close/).dispatch('click');
  await settle();
  const openForm = findAll(problemCards(typing)[0], (n) => n.tagName === 'FORM')[0];
  const note = findAll(openForm, (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(note, 'the close form drew no note field');
  note.focus();
  openForm.dispatch('submit');
  await settle();
  assert.equal(typing.doc.activeElement, note,
    'a refused close took the operator out of the note they were writing');
});

/* The re-reads a WRITE starts, which are neither of the two halves above: the
   control is destroyed by the rebuild exactly as a read control is, but the
   call arrives through afterChange() rather than from the control's own
   handler, so an enumeration walked from the control handlers misses both.
   Six review rounds did.

   afterChange() has FOUR call sites, not two: acknowledging and closing each
   have a second path, the server answering ops_problem_moved, which is not a
   failure and re-reads exactly as the success does. Round 8 found the two
   moved branches were outside the enumeration while three places said they
   were inside it, so all four are named here one at a time rather than
   assumed to be one site because they share a function. */
test('a write that lands hands focus back too, not only one that is refused', async () => {
  const moved = () => Object.assign(new Error('That problem has already moved on.'),
    { code: 'ops_problem_moved' });

  const acknowledged = async (answers, why) => {
    const dom = await boot(answers);
    const take = buttonNamed(problemCards(dom)[0], /I am on it/);
    assert.ok(take, 'the open problem was offered no acknowledge button');
    assert.equal(await focusAfter(dom, () => take.dispatch('click')),
      dom.doc.getElementById('content'), why);
  };
  await acknowledged({},
    'acknowledging a problem left the operator nowhere once the card was rebuilt');
  await acknowledged({ acknowledge: moved() },
    'acknowledging a problem somebody else had already changed left the operator nowhere');

  const closed = async (answers, why) => {
    const dom = await boot(answers);
    buttonNamed(problemCards(dom)[0], /Close/).dispatch('click');
    await settle();
    const form = findAll(problemCards(dom)[0], (n) => n.tagName === 'FORM')[0];
    assert.ok(form, 'pressing Close opened no form');
    assert.equal(await focusAfter(dom, () => form.dispatch('submit')),
      dom.doc.getElementById('content'), why);
  };
  await closed({},
    'closing a problem left the operator nowhere once the queue was rebuilt');
  await closed({ close: moved() },
    'closing a problem somebody else had already closed left the operator nowhere');
});

/* One fact, one slot: the queue's footer answers "would we know", and the
   hero above it already says how many rules are watching and when they last
   ran. Stating them again under the queue is the shape the whole remodel
   exists to remove, and it costs more than a literal repeat because "rules
   last ran" and "last check" are the same clock in two phrasings. */
test('the rules inventory is stated once, not in two arithmetics', async () => {
  const text = liveText(await boot({}));

  /* Asserted present first: if the hero stopped saying these, the counts
     below would be satisfied by their absence. */
  const watching = /(\d+ rules? watching)/.exec(text);
  assert.ok(watching, 'nothing on the page says how many rules are watching');
  assert.equal(text.split(watching[1]).length - 1, 1,
    'how many rules are watching is on the page more than once: ' + watching[1]);

  const ran = /rules last ran ((?:an?|\d+) [a-z]+ ago)/.exec(text);
  assert.ok(ran, 'nothing on the page says when the rules last ran');
  assert.equal(text.split(ran[1]).length - 1, 1,
    'when the rules last ran is on the page more than once: ' + ran[1]);
});

/* ====================== controls that would be refused ================== */

/* On a window the queue carries closed problems as well as open ones, so the
   same card that offers Close to an open problem is asked to draw one that is
   already closed. The closed LIST is a different builder and never had these
   controls; the queue is where the gate has to hold. */
test('a closed problem is not offered a control the server can only refuse', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ id: 'prb_done', reference: 'AO-901' })] },
  });
  const card = problemCards(dom).filter((n) => /AO-901/.test(allText(n)))[0];
  assert.ok(card, 'the closed problem was not in the queue at all, so nothing was tested');
  assert.equal(buttonNamed(card, /Close/), null,
    'a problem that is already closed was offered a Close button the server can only refuse');
  assert.equal(buttonNamed(card, /I am on it/), null,
    'a problem that is already closed was offered an acknowledge button');
  assert.ok(buttonNamed(card, /Details/),
    'the closed card lost the one control it should have');

  /* The same card for an open problem does carry them, or the assertions
     above would hold on a pane that draws no controls at all. */
  const live = await boot({ open: { problems: [problem()] } });
  assert.ok(buttonNamed(problemCards(live)[0], /Close/),
    'an open problem was not offered Close, so the gate above proves nothing');
});

test('the close form labels its fields by an id nothing else on the page can take', async () => {
  const dom = await boot({
    open: { problems: [problem({ id: 'prb_dup' })] },
    closed: { problems: [] },
  });
  buttonNamed(problemCards(dom)[0], /Close/).dispatch('click');
  await settle();

  const ids = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('id'))
    .map((n) => n.getAttribute('id'));
  assert.equal(ids.length, new Set(ids).size,
    'two elements on the page carry the same id: ' + JSON.stringify(repeatedIds(dom)));

  const labels = findAll(dom.doc.body, (n) => n.tagName === 'LABEL' && n.getAttribute('for'));
  const formLabels = labels.filter((n) => /^close-(reason|note)-/.test(n.getAttribute('for')));
  assert.equal(formLabels.length, 2,
    'the close form did not label both of its fields');
  formLabels.forEach((label) => {
    const target = label.getAttribute('for');
    assert.ok(dom.doc.getElementById(target),
      'a close-form label points at ' + target + ', which is on no element');
    /* The counter, not the problem id. An id built from the record has to
       answer what characters a record id can contain; this one never asks. */
    assert.match(target, /-\d+$/,
      'a close-form id is not the counter\'s: ' + target);
    assert.doesNotMatch(target, /prb_dup/,
      'a close-form id is built from the record: ' + target);
  });
});

/* =========================== acknowledge vs close ====================== */

test('an unacknowledged problem says nobody has it; one taken on names who has', async () => {
  const nobody = await boot({});
  assert.match(liveText(nobody), /Nobody has picked this up/,
    'an open problem left the absence of an owner to be inferred');

  const taken = await boot({
    open: { problems: [problem({
      status: 'acknowledged',
      acknowledgedAt: at(20 * MINUTE),
      acknowledgedByEmail: 'ops.lead@example.invalid',
    })] },
  });
  const text = liveText(taken);
  assert.match(text, /ops\.lead@example\.invalid took this on/,
    'a problem somebody is on did not say who');
  assert.doesNotMatch(text, /Nobody has picked this up/,
    'a problem somebody is on still said nobody had it');

  /* The footer sentence carries WHEN as well as WHO, so a "Taken on" row in
     the fact grid would put the same relative time on the card twice. The
     needle is bounded to the time itself -- an unbounded capture runs on into
     the next sentence and can never repeat, which is how this assertion first
     passed over the defect it is named for. Asserting the footer printed one
     at all means deleting the footer cannot satisfy the count instead. */
  const card = allText(problemCards(taken)[0]);
  const stamp = /took this on ((?:an?|\d+) [a-z]+ ago)/.exec(card);
  assert.ok(stamp, 'the footer did not say when the problem was taken on');
  const times = card.split(stamp[1]).length - 1;
  assert.equal(times, 1,
    'the time a problem was taken on is on the card ' + times + ' times: ' + stamp[1]);
});

test('taking a problem on and closing it are two different calls', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];

  buttonNamed(card, /I am on it/).dispatch('click');
  await settle();

  const posts = dom.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.endpoint),
    ['/api/ops/alerts/problems/prb_1/acknowledge'],
    'taking a problem on did not post exactly one acknowledgement: ' +
    JSON.stringify(posts.map((c) => c.endpoint)));
});

test('closing a problem sends the reason and the note somebody wrote', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');

  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  assert.ok(form, 'Close opened no form');
  const select = findAll(form, (n) => n.tagName === 'SELECT')[0];
  const note = findAll(form, (n) => n.tagName === 'TEXTAREA')[0];
  select.value = 'no_action_needed';
  note.value = 'Provider had a bad hour. Cleared on its own.';
  form.dispatch('submit');
  await settle();

  const posted = dom.calls.filter((c) => /\/close$/.test(c.endpoint));
  assert.equal(posted.length, 1, 'the close form did not post once');
  assert.equal(posted[0].endpoint, '/api/ops/alerts/problems/prb_1/close');
  assert.equal(posted[0].body.reason, 'no_action_needed');
  assert.equal(posted[0].body.note, 'Provider had a bad hour. Cleared on its own.',
    'the note somebody wrote did not reach the server');
});

/* The route accepts exactly two reasons from a person. `self_resolved` is
   the engine's own, and the close endpoint answers `ops_close_reason_invalid`
   to anybody who sends it, so an option offering it is a button that can only
   fail. The harness does not implement a select's implicit first-option
   default, which is why the close tests above set `.value` by hand and why
   none of them can see WHICH options are on offer -- this one reads the
   option elements themselves. */
test('the close form offers only the two reasons a person is allowed to send', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');
  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  const select = findAll(form, (n) => n.tagName === 'SELECT')[0];
  const offered = findAll(select, (n) => n.tagName === 'OPTION')
    .map((n) => n.getAttribute('value'));
  assert.equal(offered.length, 2,
    'the close form offers ' + offered.length + ' reasons: ' + JSON.stringify(offered));
  assert.equal(offered.indexOf('self_resolved'), -1,
    'the close form offers self_resolved, which the route refuses from a person');
  assert.deepEqual(offered.slice().sort(), ['no_action_needed', 'resolved']);
});

test('a close with no note sends no note rather than an empty one', async () => {
  const dom = await boot({});
  buttonNamed(problemCards(dom)[0], /^Close/).dispatch('click');
  const form = findAll(panel(dom, 'live'), (n) => n.tagName === 'FORM')[0];
  /* The harness does not implement a select's implicit first-option default, so
     the reason is set here the way a browser would have set it. */
  findAll(form, (n) => n.tagName === 'SELECT')[0].value = 'resolved';
  findAll(form, (n) => n.tagName === 'TEXTAREA')[0].value = '   ';
  form.dispatch('submit');
  await settle();

  const body = dom.calls.filter((c) => /\/close$/.test(c.endpoint))[0].body;
  assert.equal(body.note, undefined, 'whitespace was sent as the note it was closed with');
  assert.equal(body.reason, 'resolved');
});

/* ============================== counts and caps ======================== */

test('a full read reads as a floor, and names the problems that went missing', async () => {
  const full = await boot({ open: { problems: manyProblems(100) } });
  const text = liveText(full);
  assert.match(text, /At least \d+ problems open/,
    'a read that came back full printed its count as a total');
  assert.match(text, /most recent ones are missing/,
    'the disclosure did not say WHICH problems went missing');
  assert.doesNotMatch(text, /oldest (problems|ones) (are|were) (not|missing)/i,
    'the disclosure has the direction backwards: a full read drops the newest');

  const short = await boot({ open: { problems: manyProblems(3) } });
  const shortText = liveText(short);
  assert.doesNotMatch(shortText, /At least/,
    'a read that came back short still hedged its count');
  assert.doesNotMatch(shortText, /most recent ones are missing/,
    'a read that came back short was disclosed as truncated');
});

/* ======================= severity there, category here ================== */

test('severity goes to the API and category is applied on what came back', async () => {
  const dom = await boot({
    open: { problems: [
      problem(),
      problem({ id: 'prb_2', reference: 'AO-119', category: 'cost',
        categoryLabel: 'Cost', title: 'Spend is running ahead of the month' }),
    ] },
  });
  assert.equal(problemCards(dom).length, 2);

  const severity = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0];
  severity.dispatch('click');
  await settle();

  const reads = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems');
  const scoped = reads.slice(-2);
  assert.deepEqual(scoped.map((c) => c.query.severity), ['critical', 'critical'],
    'the severity the operator picked never reached the API');
  assert.ok(reads.every((c) => c.query.category === undefined),
    'a category was sent to an endpoint that does not filter on one');

  const category = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'SELECT')[0];
  category.value = 'cost';
  category.dispatch('change');
  await settle();

  const shown = problemCards(dom);
  assert.equal(shown.length, 1, 'the category filter changed nothing on screen');
  assert.match(allText(shown[0]), /Spend is running ahead/,
    'the category filter kept the wrong problem');
});

test('a figure read over a filtered answer says which filter it was read over', async () => {
  const plain = await boot({});
  assert.doesNotMatch(liveText(plain), /filtered by the operations API/,
    'an unfiltered read still claimed to be scoped');

  const dom = await boot({});
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  assert.match(liveText(dom), /Severity is filtered by the operations API/,
    'a severity-scoped answer was presented as a total');
});

/* A problem goes open -> closed and never back, so of two copies the one
   carrying `closedAt` was read later. Keeping the first showed one reference
   as "Still happening" in the queue and "Closed a minute ago" in the list
   below it, on one screen. */
test('a problem that is in both answers is the closed one, not the stale open one', async () => {
  const id = 'prb_r';
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem({ id, reference: 'AO-500', status: 'open' })] },
    closed: { problems: [closedProblem({ id, reference: 'AO-500' })] },
  });
  const cards = problemCards(dom);
  assert.equal(cards.length, 1, 'the problem was drawn twice');
  const text = allText(cards[0]).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /Still happening/,
    'the queue kept the stale open copy of a problem the closed read says is closed: ' + text);
  assert.match(text, /Closed/,
    'the closed copy lost its state as well: ' + text);
});

/* ===================== a closed problem is not an open one ============== */

/* `Open for` measures to now, so on a closed problem it counts on past the
   moment the thing stopped. A range filter admits closed problems into the
   queue -- two of the three windows this pane offers -- so this is the
   ordinary view, not an exotic one. */
test('a closed problem is not told how long it has been open', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  const cards = problemCards(dom);
  assert.equal(cards.length, 1, 'the closed problem was not in the queue at all');
  const text = allText(cards[0]);
  assert.doesNotMatch(text, /Open for/,
    'a closed problem is still being told how long it has been open: ' + text);
  assert.match(text, /Started/,
    'the dated start went missing along with the running total');

  const open = await boot({});
  assert.match(allText(problemCards(open)[0]), /Open for/,
    'an open problem stopped saying how long it has been open');
});

test('a closed card states the reason and the person once, not the word Closed twice', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ closeReason: 'resolved' })] },
  });
  const text = allText(problemCards(dom)[0]).replace(/\s+/g, ' ');
  assert.equal((text.match(/Closed/g) || []).length, 1,
    'the card says "Closed" more than once: ' + text);
  /* Em dash, not "by": two of the three reasons are not clauses, so
     "Nothing to do by somebody" does not parse. */
  assert.match(text, /Resolved \u2014 owner@example\.invalid/,
    'the reason and the person went missing with the duplication: ' + text);

  /* The closed LIST has no pill, so its sentence still carries both. */
  const listed = allText(dom.doc.querySelector('.c-list')).replace(/\s+/g, ' ');
  assert.match(listed, /Closed as resolved by owner@example\.invalid \d+ days ago/,
    'the closed list lost the sentence that is its only statement of when: ' + listed);

  /* The reason an operator can actually choose. It is not a clause, so the
     short form has to hold it without "by" on the end of it. */
  const nothing = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem({ closeReason: 'no_action_needed' })] },
  });
  assert.match(allText(problemCards(nothing)[0]).replace(/\s+/g, ' '),
    /Nothing to do \u2014 owner@example\.invalid/,
    'the short close sentence reads "Nothing to do by somebody", which does not parse');
});

/* ============================== de-duplication ========================= */

test('a problem that is in both answers is one problem', async () => {
  const shared = closedProblem({ id: 'prb_1', reference: 'AO-118' });
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
    closed: { problems: [shared] },
  });

  const refs = problemCards(dom).map((c) => (allText(c).match(/AO-\d+/) || [])[0]);
  assert.deepEqual(refs.sort(), ['AO-118', 'AO-119'],
    'the same problem was drawn twice, once from each read: ' + JSON.stringify(refs));
});

/* ================================ empty ================================ */

test('a filter that matched nothing never claims the system is well', async () => {
  const dom = await boot({ open: { problems: [] } });
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();

  const text = emptyText(dom);
  assert.match(text, /Nothing matches these filters/);
  assert.match(text, /says nothing about the problems these filters exclude/);
  assert.doesNotMatch(text, /Nothing is wrong/,
    'a filtered empty result claimed the system is healthy');
});

test('an empty queue says whether anything was in a position to notice', async () => {
  const watching = await boot({ open: { problems: [] } });
  assert.match(emptyText(watching), /Nothing is wrong, and the watching is working/);

  const blind = await boot({ open: { problems: [] }, rules: blindRules() });
  const text = emptyText(blind);
  assert.match(text, /Nothing is being reported, and that is the problem/);
  assert.doesNotMatch(text, /Nothing is wrong/,
    'a page with nothing judging still said nothing was wrong');
});

/* The ONE fact that tells an empty problems list apart from alerting that has
   stopped is the rules read. When that is the read that failed, the pane has
   built `armedState({})` for itself -- every count zero because nothing
   answered -- and "there are no alert rules at all" read off that object is a
   fabricated fact, printed three inches from "this part is unread, not
   empty". The routing card carried the same defect and was fixed; the empty
   state is its second call site, and the suite was green with it because no
   test booted with an empty open read AND a failed rules read together. */
test('an empty page over a failed rules read does not report that nothing is watching', async () => {
  const dom = await boot({ open: { problems: [] }, rules: new Error('The rules broke.') });
  const text = emptyText(dom);
  assert.doesNotMatch(text, /no alert rules at all/,
    'a rules read that never landed was reported as no rules existing: ' + text);
  assert.doesNotMatch(text, /Treat this as unmonitored/,
    'a rules read that never landed was reported as alerting having stopped');
  assert.match(text, /whether anything is watching is unknown/,
    'the empty page said nothing about the read that failed: ' + text);

  /* The filtered branch is the same sentence on a second call site, where it
     gains " That is the case whatever these filters are set to." -- a
     fabricated fact promoted to an invariant. `picked` is not read off the
     querystring, so this drives the real control. */
  const filtered = await boot({
    open: { problems: [] }, closed: { problems: [] }, rules: new Error('The rules broke.'),
  });
  findAll(filtered.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  const filteredText = emptyText(filtered);
  assert.match(filteredText, /Nothing matches these filters/,
    'the filtered branch was never reached: ' + filteredText);
  assert.doesNotMatch(filteredText, /no alert rules at all/,
    'the filtered empty state fabricated a verdict from a read that never landed: ' +
    filteredText);
  assert.match(filteredText, /whether anything is watching is unknown/,
    'the filtered empty state said nothing about the read that failed: ' + filteredText);

  /* And a read that DID land with no rules still says so, or the fix above is
     "never say it" rather than "say it when it is true". */
  const really = await boot({
    open: { problems: [] }, rules: Object.assign(rulesFixture(), { rules: [] }),
  });
  assert.match(emptyText(really), /no alert rules at all/,
    'an answer that really carries no rules stopped saying so');
});

test('a read that never landed is never allowed to say there is nothing here', async () => {
  const dom = await boot({ open: new Error('The operations API did not answer.') });
  assert.deepEqual(shownState(dom), ['live degraded'],
    'a failed read fell into a state that claims there is nothing here');
  assert.match(liveText(dom), /Nothing here is a zero/);
  assert.doesNotMatch(liveText(dom), /Nothing is wrong/);
});

/* ====================== one read failing, not the pane ================= */

test('one read failing leaves everything the other read on screen', async () => {
  const noRules = await boot({ rules: new Error('The rules could not be read.') });
  assert.equal(problemCards(noRules).length, 1,
    'a failed rules read took the problems off the screen');
  assert.match(liveText(noRules), /The rules could not be read/);
  assert.deepEqual(shownState(noRules), ['live degraded']);

  const noProblems = await boot({ open: new Error('The problems could not be read.') });
  assert.ok(ruleRows(noProblems).length >= 3,
    'a failed problems read took the rules off the screen');
  assert.match(liveText(noProblems), /The problems could not be read/);

  const neither = await boot({
    open: new Error('nothing answered'),
    rules: new Error('nothing answered'),
    closed: new Error('nothing answered'),
  });
  assert.match(liveText(neither), /This pane could not be read/,
    'a pane with nothing readable still drew a shell of one');
});

/* The channels come out of the rules answer. A rules read that never landed
   knows nothing about them, and "no notification channel is set up" is the
   one sentence on this pane that means alerts reach nobody. */
test('a rules read that failed does not report that nothing is set up to notify', async () => {
  const dom = await boot({ rules: new Error('The rules could not be read.') });
  const routing = dom.doc.querySelector('.c-side');
  const text = allText(routing);
  assert.doesNotMatch(text, /No notification channel is set up/,
    'a read that never landed claimed there is no channel: ' + text);
  assert.match(text, /could not be read/,
    'the routing card said nothing at all about the read that failed');

  const landed = await boot({ rules: rulesFixture(undefined) });
  assert.match(allText(landed.doc.querySelector('.c-side')), /Microsoft Teams/,
    'a rules read that landed stopped listing its channels');

  const none = await boot({ rules: Object.assign(rulesFixture(), { channels: [] }) });
  assert.match(allText(none.doc.querySelector('.c-side')), /No notification channel is set up/,
    'an answer that really carries no channel stopped saying so');
});

/* ============================== the rules table ======================== */

test('the rules table draws no reading the answer does not carry, and says so', async () => {
  const dom = await boot({});
  const headers = findAll(dom.doc.body, (n) => n.tagName === 'TH').map((n) => allText(n));
  assert.ok(headers.length >= 5, 'the rules table lost its header row');
  assert.ok(!headers.some((h) => /right now|current/i.test(h)),
    'the table grew a column for a reading the rules answer does not send: ' +
    JSON.stringify(headers));
  assert.match(liveText(dom), /No current reading per rule is in this answer/,
    'the missing column was dropped silently rather than stated');
});

test('a rule that cannot reach a verdict says so in words, and says why', async () => {
  const dom = await boot({});
  const rows = ruleRows(dom).map((r) => allText(r).replace(/\s+/g, ' '));
  assert.ok(rows.some((r) => r.includes('Not enough data to judge, too few measurements so far')),
    'the rule that cannot judge did not say why: ' + JSON.stringify(rows));
  assert.ok(rows.some((r) => r.includes('Firing now')),
    'a firing rule said nothing in words, so the tone is carrying it alone');
});

/* ================================ role gating ========================== */

test('turning a rule on or off is the owner\'s, and everyone else sees the true state', async () => {
  const rules = rulesFixture([
    rule(),
    rule({ ruleKey: 'quiet_rule', title: 'Muted rule', enabled: false,
      lastEvaluationStatus: 'ok', lastFiredAt: null }),
  ]);

  const owner = await boot({ rules });
  const ownerSwitches = withClass(owner.doc.body, 'sw');
  assert.equal(ownerSwitches.length, 2);
  assert.deepEqual(ownerSwitches.map((s) => s.disabled), [false, false],
    'the owner cannot change a rule');

  const operator = await boot({ rules, role: 'operator' });
  const theirs = withClass(operator.doc.body, 'sw');
  assert.deepEqual(theirs.map((s) => s.disabled), [true, true],
    'a non-owner was handed a control the server would refuse');
  assert.deepEqual(theirs.map((s) => s.checked), [true, false],
    'a non-owner was shown the wrong state for the rules: ' +
    JSON.stringify(theirs.map((s) => s.checked)));
});

test('acting on a problem needs a role, and the pane names it instead of offering a refusal', async () => {
  const owner = await boot({});
  const ownerCard = problemCards(owner)[0];
  assert.ok(buttonNamed(ownerCard, /I am on it/), 'an operator lost the acknowledge control');
  assert.ok(buttonNamed(ownerCard, /^Close/), 'an operator lost the close control');

  const viewer = await boot({ role: 'viewer' });
  const card = problemCards(viewer)[0];
  assert.equal(buttonNamed(card, /I am on it/), null,
    'a viewer was offered a control the server would refuse');
  assert.equal(buttonNamed(card, /^Close/), null);
  assert.match(allText(card), /need the operator role/,
    'a viewer was left to work out why the controls are missing');
});

test('a switch the server refuses goes back to where it was', async () => {
  const dom = await boot({ patch: new Error('You may not change this rule.') });
  const sw = withClass(dom.doc.body, 'sw')[0];
  assert.equal(sw.checked, true);

  sw.checked = false;
  sw.dispatch('change');
  await settle();

  assert.equal(sw.checked, true,
    'the switch stayed where the operator put it after the server refused');
  assert.equal(sw.disabled, false, 'the refused switch was left unusable');
});

/* ============================== somebody else ========================== */

test('a problem somebody else changed first is a re-read, not a failure', async () => {
  const moved = Object.assign(new Error('That problem has already moved on.'),
    { code: 'ops_problem_moved' });
  const dom = await boot({ acknowledge: moved });
  const before = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems').length;

  buttonNamed(problemCards(dom)[0], /I am on it/).dispatch('click');
  await settle();

  assert.match(allText(dom.doc.body), /Somebody else changed AO-118 first/,
    'a problem somebody else moved was reported as a failure of this action');
  const after = dom.calls.filter((c) => c.endpoint === '/api/ops/alerts/problems').length;
  assert.ok(after > before, 'the pane did not read again after the problem moved');
});

/* ================================ the badge ============================ */

test('the rail count comes from the read, and no count is drawn when there is none', async () => {
  const two = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  const badges = two.doc.getElementById('rail').querySelectorAll('.nav-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '2');
  assert.match(allText(two.doc.getElementById('rail')), /2 problems with nobody on them/,
    'the count is a bare number to a screen reader');

  const quiet = await boot({
    open: { problems: [problem({ status: 'acknowledged', acknowledgedAt: at(MINUTE),
      acknowledgedByEmail: 'owner@example.invalid' })] },
  });
  assert.equal(quiet.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 0,
    'a zero was drawn as a count');
});

test('a re-read that cannot see the problems takes the count away rather than leaving it', async () => {
  const dom = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  assert.equal(dom.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 1);

  dom.answers.open = new Error('nothing answered');
  dom.answers.rules = new Error('nothing answered');
  dom.answers.closed = new Error('nothing answered');
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();

  assert.match(liveText(dom), /This pane could not be read/);
  assert.equal(dom.doc.getElementById('rail').querySelectorAll('.nav-badge').length, 0,
    'a count from the last read that worked is still beside a pane that cannot be read');
});

/* ========================== what it measured =========================== */

test('a measured figure is printed in its rule\'s unit, or not printed at all', async () => {
  const known = await boot({});
  assert.match(liveText(known), /89\.0%/,
    'a basis-point reading was not turned into a percentage');

  const unknown = await boot({ rules: rulesFixture([]) });
  const card = allText(problemCards(unknown)[0]);
  assert.doesNotMatch(card, /Measured/,
    'a reading was printed with no rule to say what unit it is in');
  assert.doesNotMatch(card, /8900/,
    'a bare 8900 was printed next to a threshold expressed as a percentage');
});

test('a problem card draws no meter', async () => {
  const dom = await boot({});
  assert.equal(withClass(panel(dom, 'live'), 'meter').length, 0,
    'a bar was drawn between an observed value and a threshold, on a scale ' +
    'nothing in the answer sends');
});

test('a span of seconds reads the same here as on the v1 panes', async () => {
  const v1 = v1Operate();
  const seconds = [4.2, 42, 246, 4320];
  const dom = await boot({
    rules: rulesFixture([rule({ thresholdUnit: 'seconds', thresholdLabel: 'over 3m' })]),
    open: { problems: seconds.map((value, i) => problem({
      id: 'prb_' + i, reference: 'AO-' + (300 + i), observedValue: value,
    })) },
  });

  const cards = problemCards(dom).map((c) => allText(c));
  assert.equal(cards.length, seconds.length);
  seconds.forEach((value, i) => {
    const expected = v1.fmt.duration(value);
    assert.ok(cards[i].includes(expected),
      value + 's should read "' + expected + '" as it does on the v1 panes, but the card says: ' +
      cards[i].replace(/\s+/g, ' ').slice(0, 160));
  });
});

/* The v1 implementation, loaded on its own page, to compare against. Reading
   it out of the source rather than restating it here is the point: an
   expectation written in this file would move with the thing it is checking. */
function v1Operate() {
  const dom = makeDom({ tokens: TOKENS });
  const body = dom.element('body');
  dom.root.appendChild(body);
  dom.doc.body = body;
  dom.window.OpsSession = { state: { admin: null }, hasRole: () => true, role: () => 'owner' };
  vm.createContext(dom.window);
  vm.runInContext(REGISTRY_SRC, dom.window, { filename: 'pane-registry.js' });
  vm.runInContext(V1_SHELL_SRC, dom.window, { filename: 'shell.js' });
  vm.runInContext(OPERATE_SRC, dom.window, { filename: 'operate.js' });
  return dom.window.OpsOperate;
}

/* ============================== the close note ========================= */

test('the note a problem was closed with is printed from its own record', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
    detail: {
      runbook: [],
      ruleHistory: [],
      timeline: [
        { eventType: 'fired', actorEmail: null, detail: {}, occurredAt: at(3 * DAY) },
        { eventType: 'closed', actorEmail: 'owner@example.invalid', occurredAt: at(2 * DAY),
          detail: { close_reason: 'self_resolved',
            note: 'The model provider had a bad hour. Latency is back to 3.8s.' } },
      ],
    },
  });

  const card = problemCards(dom)[0];
  buttonNamed(card, /Details/).dispatch('click');
  await settle();

  assert.match(allText(card), /“The model provider had a bad hour\. Latency is back to 3\.8s\.”/,
    'the one sentence saying why it was closed was dropped from the record');
});

test('a record with no note prints no empty quotation', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
    detail: {
      runbook: [], ruleHistory: [],
      timeline: [{ eventType: 'closed', actorEmail: 'owner@example.invalid',
        occurredAt: at(2 * DAY), detail: { close_reason: 'resolved' } }],
    },
  });
  const card = problemCards(dom)[0];
  buttonNamed(card, /Details/).dispatch('click');
  await settle();
  assert.doesNotMatch(allText(card), /“/,
    'a problem closed without a note was drawn as though it had one');
});

/* The record read is the only request on the page whose failure is written
   into a disclosed region instead of toasted, so it is the only one a screen
   reader can miss entirely, and v1 offered a retry that the first draft of
   this pane dropped. Its retry is also a member of the focus class: it sits
   inside the region it replaces. */
test('a record that cannot be read says so out loud and can be asked again', async () => {
  const dom = await boot({ detail: new Error('The operations API did not answer.') });
  const card = problemCards(dom)[0];
  const details = buttonNamed(card, /Details/);
  details.dispatch('click');
  await settle();

  const said = findAll(card, (n) => n.getAttribute && n.getAttribute('role') === 'alert');
  assert.equal(said.length, 1, 'the failed record read has ' + said.length + ' live regions, not one');
  assert.match(allText(said[0]), /did not answer/,
    'the failure was written outside the live region, so nobody is told the record is missing');

  const again = buttonNamed(said[0], /Try again/);
  assert.ok(again, 'a record that could not be read offered no way to ask again');

  /* It really re-reads: the second answer lands, so the button is wired to
     the read rather than being a control that does nothing. */
  dom.answers.detail = { runbook: [], timeline: [], ruleHistory: [] };
  dom.doc.body.focus();
  again.dispatch('click');
  await settle();
  assert.doesNotMatch(allText(card), /did not answer/,
    'pressing Try again left the failure on screen, so it re-read nothing');
  assert.equal(dom.doc.activeElement, details,
    'the retry destroyed itself and left the operator nowhere');
});

test('the closed list says where the note is rather than leaving it out silently', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  assert.match(liveText(dom), /Open one to read the note it was closed with/,
    'the list dropped the close note and said nothing about where it went');
});

/* ====================== how the watching is doing ====================== */

test('the last-fortnight figures are refused over a read that came back full', async () => {
  const honest = await boot({
    search: '?range=30d',
    closed: { problems: [closedProblem(), closedProblem({ id: 'prb_8', reference: 'AO-100' })] },
  });
  assert.match(liveText(honest), /Opened/,
    'the counts were not drawn even over a read that came back short');

  const capped = await boot({
    search: '?range=30d',
    closed: { problems: manyProblems(100).map((p, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (400 + i),
    })) },
  });
  const text = liveText(capped);
  assert.doesNotMatch(text, /Median time to take one on/,
    'a figure about the last fortnight was worked out over a sample missing it');
  assert.match(text, /Nothing is drawn from a sample missing exactly the days it is about/);
});

/* The open read and the closed read are taken at different instants, so one
   problem closed between them comes back in both. The queue de-duplicates;
   the figures beside it were adding the same problem twice. */
test('a problem in both answers is counted once by the figures, not only listed once', async () => {
  const shared = closedProblem({ id: 'prb_1', reference: 'AO-118' });
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [shared] },
    closed: { problems: [shared] },
  });
  const rows = withClass(dom.doc.body, 'w-rows')[0];
  const text = allText(rows).replace(/\s+/g, ' ');
  assert.match(text, /Opened 1\b/,
    'one problem in both answers was counted twice: ' + text);
  assert.match(text, /Closed 1\b/, 'the closure went missing: ' + text);
});

/* The closed read is issued on EVERY load, whatever the range control says,
   so a capped one has to be disclosed on the default window too -- where the
   queue holds no closed problem and the queue's own disclosure never fires. */
test('a capped closed read is disclosed on the window that does not filter by it', async () => {
  const capped = await boot({
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (400 + i),
    })) },
  });
  const listed = allText(capped.doc.querySelector('.c-list').parentNode.parentNode);
  assert.match(listed, /most recent closures are missing from this list/,
    'a capped closed list was drawn with nothing said about it: ' + listed);
  /* The total the foot prints is "<n> closed. Open one to read..."; the
     disclosure sentence also contains "100 closed", which is why this pins
     the whole construction rather than the two words. */
  assert.doesNotMatch(listed, /\d+ closed\. Open one to read/,
    'a total was printed over a read that came back full: ' + listed);

  /* Both directions. A read that came back SHORT of the cap is a real total,
     so the count is still printed and the disclosure is still absent -- an
     invariant checked only one way passes just as well with the figure
     switched off everywhere. */
  const short = await boot({
    closed: { problems: manyProblems(8).map((_, i) => closedProblem({
      id: 'sh_' + i, reference: 'AO-' + (500 + i),
    })) },
  });
  const shortText = allText(short.doc.querySelector('.c-list').parentNode.parentNode);
  assert.doesNotMatch(shortText, /most recent closures are missing/,
    'a closed read that came back short was disclosed as truncated');
  assert.match(shortText, /8 closed\. Open one to read/,
    'a read that came back short stopped saying how many it held: ' + shortText);
});

/* The queue is not the open read. On a window it draws from BOTH reads, so a
   capped closed read makes the QUEUE short -- and short of exactly the recent
   closures the window is made of. The hero counts that queue. This was a
   regression: the note existed, was deleted as a duplicate of the closed
   card's foot, and nothing in the suite noticed either way. */
test('a capped closed read hedges the queue\'s own count, not only the closed list', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [problem()] },
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (700 + i),
    })) },
  });
  const title = allText(withClass(dom.doc.body, 'hero-title')[0]);
  assert.match(title, /^At least /,
    'the hero printed an exact total over a queue drawn from a capped read: ' + title);

  const notes = withClass(dom.doc.body, 'p-notes')[0];
  assert.ok(notes, 'the queue carried no disclosure at all over a capped read');
  const noteText = allText(notes).replace(/\s+/g, ' ');
  assert.match(noteText, /missing from this queue/,
    'the queue said nothing about being short of the window it is counting: ' + noteText);

  /* The default window counts only open problems, and the closed read cannot
     make THAT queue short -- so the hedge must not fire there, or it is on
     every page and says nothing. */
  const openWindow = await boot({
    open: { problems: [problem()] },
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'cl_' + i, reference: 'AO-' + (700 + i),
    })) },
  });
  assert.match(allText(withClass(openWindow.doc.body, 'hero-title')[0]), /^1 problem open/,
    'the open-window count was hedged by a cap that cannot reach it');
  const openNotes = withClass(openWindow.doc.body, 'p-notes')[0];
  assert.ok(!openNotes || !/missing from this queue/.test(allText(openNotes)),
    'the queue hedge fired on a window the closed read cannot shorten');
});

/* The closed query sends no date bound, so once more than PAGE closures exist
   the PAGE that come back are the oldest and every one can predate this
   window. The card then draws "nothing has been closed" from a sample that was
   never in a position to say so -- beside a figures card that refuses to count
   from the SAME sample for the SAME reason. The disclosure used to sit below
   the early return that branch takes. */
test('a capped closed read that reaches back past the window reports no zero', async () => {
  const old = await boot({
    closed: { problems: manyProblems(100).map((_, i) => closedProblem({
      id: 'old_' + i, reference: 'AO-' + (600 + i),
      firedAt: at(61 * DAY), closedAt: at(60 * DAY),
    })) },
  });
  const text = liveText(old);
  assert.doesNotMatch(text, /Nothing has been closed in the last/,
    'a capped read that reaches back past the window was reported as a zero: ' + text);
  assert.match(text, /cannot be told from this read/,
    'the card said nothing about why it cannot answer: ' + text);
  assert.match(text, /most recent closures are missing/,
    'the cap was not disclosed anywhere on a page that has no other disclosure');

  /* A read that came back SHORT and empty is a real zero and still says so. */
  const none = await boot({ closed: { problems: [] } });
  assert.match(liveText(none), /Nothing has been closed in the last/,
    'a read that came back short stopped reporting a genuine zero');
  assert.doesNotMatch(liveText(none), /most recent closures are missing/,
    'a read that came back short was disclosed as capped');
});

test('a rate over too few closures is reported as counts instead', async () => {
  const few = await boot({
    search: '?range=30d',
    closed: { problems: [
      closedProblem({ id: 'c1', closeReason: 'no_action_needed' }),
      closedProblem({ id: 'c2', closeReason: 'resolved' }),
    ] },
  });
  assert.match(liveText(few), /1 of 2, too few to rate/,
    'a rate was implied over two closures');

  const enough = await boot({
    search: '?range=30d',
    closed: { problems: [1, 2, 3, 4, 5, 6].map((n) => closedProblem({
      id: 'c' + n, reference: 'AO-' + (500 + n),
      closeReason: n <= 2 ? 'no_action_needed' : 'resolved',
    })) },
  });
  const text = liveText(enough);
  assert.match(text, /2 of 6/);
  assert.doesNotMatch(text, /too few to rate/,
    'six closures were still treated as too few to say anything about');
});

/* ============================ colour is never alone ==================== */

test('every severity on the page is a word, not only a colour', async () => {
  const dom = await boot({
    open: { problems: [
      problem(),
      problem({ id: 'p2', reference: 'AO-119', severity: 'warning',
        title: 'Spend is running ahead of the month' }),
      problem({ id: 'p3', reference: 'AO-120', severity: 'info',
        title: 'Android 1.1.2 has stopped spreading' }),
    ] },
  });

  const wanted = ['Critical', 'Warning', 'Info'];
  problemCards(dom).forEach((card, i) => {
    assert.match(allText(card), new RegExp('\\b' + wanted[i] + '\\b'),
      'the ' + wanted[i].toLowerCase() + ' problem carries its severity in tone alone');
  });
});

/* =============================== drill-downs =========================== */

test('a problem links to the pane the answer named, at the file the registry gives it', async () => {
  const dom = await boot({});
  const links = findAll(problemCards(dom)[0], (n) => n.tagName === 'A');
  assert.equal(links.length, 1, 'a problem offered more than one way out, or none');
  const href = links[0].getAttribute('href');
  assert.equal(href.split('?')[0], 'jobs-live.html',
    'the doorway does not go to the pane that owns the detail');
  assert.equal(href, dom.shell.paneHref('jobs'),
    'the doorway is not the registry\'s own link for that pane, so it does not ' +
    'carry the selection across: ' + href);
  assert.equal(allText(links[0]), 'Happening now');

  /* The selection travels only as far as the destination has somewhere to put
     it. Happening now declares no filter at all, so its link is the bare file
     and anything appended to it would be a selection that pane cannot apply;
     What happened keeps its window, so the window goes with the operator. */
  const windowed = await boot({
    search: '?range=30d',
    open: { problems: [problem({ workPane: 'run-history', workPaneLabel: 'What happened' })] },
  });
  const across = findAll(problemCards(windowed)[0], (n) => n.tagName === 'A')[0];
  assert.ok(across, 'the windowed problem offered no way out at all');
  assert.equal(across.getAttribute('href'), 'run-history.html?range=30d',
    'the doorway dropped the window the operator had chosen: '
    + across.getAttribute('href'));

  const nowhere = await boot({
    open: { problems: [problem({ workPane: 'a-pane-that-does-not-exist' })] },
  });
  assert.equal(findAll(problemCards(nowhere)[0], (n) => n.tagName === 'A').length, 0,
    'a work pane nothing knows about was drawn as a link anyway');
});

/* The work pane's name is a doorway, so it is not also a label. This is the
   editorial rule the remodel exists for: a fact that is already on the card
   as something you can act on does not get restated as something you read. */
test('the pane that owns the detail is named once on a card, and it is the way out', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];
  const named = findAll(card, (n) =>
    allText(n) === 'Happening now'
    && !(n.childNodes || []).some((child) => child.tagName));
  assert.equal(named.length, 1,
    'the work pane is named ' + named.length + ' times on one card; it belongs '
    + 'in the actions as a doorway, not also in the facts as a chip');
  assert.equal(named[0].tagName, 'A',
    'the one place the work pane is named is a ' + named[0].tagName
    + ', so the name is a label rather than a way to get there');
});

/* ============================= dated timestamps ======================== */

test('a problem carries the dated time it started, not only how long ago', async () => {
  const dom = await boot({});
  const card = allText(problemCards(dom)[0]);
  assert.match(card, /\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} UTC/,
    'the only time on the card is a relative one, which two operators in two ' +
    'time zones cannot quote to each other');
});

/* ======================= the two disclosures on a card ================== */

/* One problem can be on screen twice -- once in the queue, once in "Recently
   closed" -- so an id derived from the problem alone put two elements with
   the same id in the document and both buttons' aria-controls resolved to
   the first. */
function repeatedIds(dom) {
  const ids = findAll(dom.doc.body, (n) => n.getAttribute && n.getAttribute('id'))
    .map((n) => n.getAttribute('id'));
  const seen = {};
  return ids.filter((id) => {
    if (Object.prototype.hasOwnProperty.call(seen, id)) return true;
    seen[id] = true;
    return false;
  });
}

test('two views of one problem do not hand the document two elements with one id', async () => {
  const dom = await boot({
    search: '?range=7d',
    open: { problems: [] },
    closed: { problems: [closedProblem()] },
  });
  assert.deepEqual(repeatedIds(dom), [],
    'one problem on two surfaces put a repeated id in the document: ' +
    JSON.stringify(repeatedIds(dom)));

  /* Both surfaces really are on screen, or the assertion above is vacuous. */
  assert.equal(problemCards(dom).length, 1, 'the problem is not in the queue');
  assert.ok(withClass(dom.doc.body, 'c-row').length >= 1,
    'the problem is not in the closed list');

  /* And several problems on ONE surface. The surface key fixes the first
     collision and says nothing about this one. */
  const many = await boot({
    open: { problems: [problem(), problem({ id: 'prb_2', reference: 'AO-119' })] },
  });
  assert.equal(problemCards(many).length, 2, 'the queue does not hold two problems');
  assert.deepEqual(repeatedIds(many), [],
    'several problems on one surface put a repeated id in the document: ' +
    JSON.stringify(repeatedIds(many)));
});

/* An id that no element carries is a disclosure a screen reader cannot follow,
   and the attribute still reads correctly in the DOM -- so a test that compares
   the two aria-controls STRINGS is true of two dangling references as well as
   two live ones, and counting repeated ids gets MORE green when an id is
   removed. Both of those were in this suite and neither saw it. This resolves
   each reference to an element and asserts it is that button's own region. */
test('every aria-controls on a problem card resolves to that button\'s own region', async () => {
  const dom = await boot({
    search: '?range=7d',
    closed: { problems: [closedProblem()] },
  });
  const buttons = findAll(dom.doc.body,
    (n) => n.tagName === 'BUTTON' && n.getAttribute('aria-controls'));
  assert.ok(buttons.length >= 4,
    'fewer disclosure buttons than the queue and the closed list should hold: ' +
    buttons.length);

  buttons.forEach((button) => {
    const id = button.getAttribute('aria-controls');
    const region = dom.doc.getElementById(id);
    assert.ok(region,
      'aria-controls="' + id + '" on ' + allText(button).trim() +
      ' points at an id no element in the document carries');

    /* And at the right one: the region a click fills, not some other card's. */
    button.dispatch('click');
    assert.ok(allText(region).trim().length > 0,
      'the region ' + id + ' named by ' + allText(button).trim() +
      ' stayed empty when the button was pressed, so it is not that button\'s own');
    button.dispatch('click');
  });
});

/* Details and the close form used to write into one host, so each button
   reported itself expanded over the other one's content, and opening Details
   destroyed a part-filled close form without saying so. */
test('Details and Close each own their own region, and each says so truthfully', async () => {
  const dom = await boot({});
  const card = problemCards(dom)[0];
  const details = buttonNamed(card, /Details/);
  const close = buttonNamed(card, /^Close/);

  assert.notEqual(details.getAttribute('aria-controls'), close.getAttribute('aria-controls'),
    'Details and Close point at the same region');

  close.dispatch('click');
  await settle();
  const note = findAll(panel(dom, 'live'), (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(note, 'Close opened no form');
  note.value = 'Half a sentence somebody was still typing';
  assert.equal(details.getAttribute('aria-expanded'), 'false',
    'opening the close form reported Details as expanded');

  details.dispatch('click');
  await settle();
  assert.equal(close.getAttribute('aria-expanded'), 'true',
    'opening Details said the close form was shut while it was still on screen');
  const still = findAll(panel(dom, 'live'), (n) => n.tagName === 'TEXTAREA')[0];
  assert.ok(still, 'opening Details destroyed the close form');
  assert.equal(still.value, 'Half a sentence somebody was still typing',
    'opening Details threw away what somebody had typed into the close form');
  assert.equal(details.getAttribute('aria-expanded'), 'true');
});

/* ========================= clearing the filters ======================== */

test('clearing the filters puts the window back as well as the pane\'s own controls', async () => {
  const dom = await boot({ search: '?range=30d', open: { problems: [] } });
  findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && allText(n) === 'Critical')[0].dispatch('click');
  await settle();
  assert.equal(dom.shell.filters().range, '30d');

  buttonNamed(panel(dom, 'empty'), /Clear the filters/).dispatch('click');
  await settle();

  assert.equal(dom.shell.filters().range, 'open',
    'the window is a filter the button offered to clear and did not');
  const on = findAll(dom.doc.querySelector('.filters-pane'),
    (n) => n.tagName === 'BUTTON' && n.getAttribute('aria-pressed') === 'true')[0];
  assert.equal(allText(on), 'All', 'the severity the operator picked survived clearing');
});

/* ============================ the page itself ========================== */

/* The sheet's reading rule -- the paragraph at the top of
   ops/assets/pane-alerts-v2.css, not quoted here because a quotation of it
   goes stale in silence and this one had, by one clause, for two rounds -- is
   the whole device this pane's docblock rests on, and it rests in turn on
   those citations resolving. Nothing checked that they did, so any cited test
   could be renamed with the suite green and every sentence citing it would go
   on reading as proven. That is Stadiora/Aria#10632 inside the thing built to
   close it, and the second independent review of PR #75 found it there.

   Every double-quoted run in the sheet is either a title this file registers
   or one of the strings below, which are UI copy the sheet quotes rather than
   citations. Attribute spellings are dropped first, or a role="switch" pairs
   its quotes with the prose either side and every run after it is garbage. */
const SHEET_QUOTES_THAT_ARE_NOT_CITATIONS = ['Still happening'];

/* Which tests the sheet cites, pinned by IDENTITY rather than by a floor:
   a floor of eight against fourteen leaves six deletable in silence, and a
   citation going AWAY unbinds its sentence exactly as a citation going stale
   does. Pinned as a set, so citing one test from two places and then dropping
   one of the two is not a change here -- the claim is which tests hold the
   sheet up, not how many sentences say so. One entry is generated rather
   than typed, because the title it names is generated: it counts the sites
   on the NON-TOKEN PAINT line, so the sheet's own citation of it goes red
   when that line changes size. What generating it buys is one fewer place to
   edit, not that property -- see the note above NON_TOKEN_PAINT_TITLE, which
   is where that was measured. */
/* What this binds: the named test is registered. What it does NOT bind: that
   the named test is rigorous -- gut its body and the citation still resolves
   (mutation M4-R2 on #75). Each cited test carries its own mutations; this one
   only stops the sheet naming a test that no longer exists.

   One shape it does not see: the scan reads STRAIGHT double quotes, so a
   citation respelled with typographic quotes leaves the list entirely. That
   IS caught, because the comparison below is by MULTISET.

   It used to be by set, and this comment used to add that a doubly-cited
   title would therefore have one of its two sites silently unchecked, "at
   the moment" no title being doubly cited. That was false when it was
   written: the rules-table title below is cited twice, at
   pane-alerts-v2.css:150 and :311, and the suite printed the contradiction
   every run -- cited 14 against a 13-entry list. Deleting either site was
   green (found in the sixth review of #75). The list now carries a title
   once per SITE, and the comparison counts. */
const SHEET_CITATIONS = [
  'a problem card carries one severity, in the accent and both inks alike',
  'every rule switch is a real checkbox, reachable, stateful and named',
  'every severity on the page is a word, not only a colour',
  'every status tone here paints the -ink of a tint aria.css also declares',
  'the ink on a severity is the -ink of the accent that severity draws',
  'every test the stylesheet cites by name is a test this file registers',
  'every token this sheet paints with is one aria.css actually declares',
  'the accent this sheet adds is the one aria.css leaves out',
  'the avatar ink is the one paint no aria.css token could have made',
  'the page loads one design system and one theme decision',
  'the reader refuses what READER_PROBES says it refuses, and walks past what it says it misses',
  'the rules table scrolls inside a box a keyboard can reach and a screen reader can name',
  'the rules the sheet justifies by what the page draws name what it draws',
  /* The sheet cites this one wherever a layout rule is justified
     by what the page draws -- the condition pill's phrasing, the rules
     table's columns, the cards per problem, the fact columns and the hero
     child the chip strip is. One entry per SITE, or deleting one site is
     green. The numbers are deliberately not restated here: each is read out
     of the sheet by sheetCount() at one site, and a second spelling of it
     with no reader is the overclaiming this file exists to stop. */
  'the rules the sheet justifies by what the page draws name what it draws',
  'the rules the sheet justifies by what the page draws name what it draws',
  'the rules the sheet justifies by what the page draws name what it draws',
  'the rules the sheet justifies by what the page draws name what it draws',
];

/* The tests this file's own comments cite, pinned by identity for the same
   reason SHEET_CITATIONS is. The bullet at the top cited a title that three
   OTHER ops suites register and this one does not, and nothing moved, because
   the resolver read the stylesheet and never this file (found in the fourth
   review of #75). */
const FILE_CITATIONS = ['the pane never spells innerHTML, outerHTML or insertAdjacentHTML'];

/* The NOT COVERED bullet at the top of this file used to count the
   machine-read lines by hand, and it was one short from the commit that
   added the fourth. The count is gone: the bullet NAMES them, and the names
   are matched both ways against MACHINE_READ_PREFIXES. What that binds, and
   all it binds: machineLine() refuses a prefix that is not on the list, the
   bullet and the list are held equal in both directions, and the sheet
   carries no heading-shaped line that is not on the list. Two absolutes
   stood here -- that a fifth reader cannot be added without listing it, and
   that a fifth line cannot be written in the sheet without being read -- and
   both are DELETED rather than qualified. Neither is bound: a reader that
   matches a prefixed line with its own regex never reaches machineLine() and
   nothing here notices, and the paragraph below already contradicted the
   second one three lines later.

   What it does not see: a machine-read line that does not LOOK like a
   heading. The sheet scan matches an upper-case run, hyphens included,
   before a colon at the start of a line -- so a data line spelled in lower
   case, or one carrying a digit or an underscore, would be invisible to it.
   The hyphen is in that class because leaving it out made the scan blind to
   NON-TOKEN PAINT, which is the FIRST of the four; a character class is a
   shape, and a guard that anchors on one shape cannot see the others. */
test('the NOT COVERED bullet names every prefixed docblock line this file reads as data, '
  + 'and every prose frame over it', () => {
  const bullet = /reads as data are ([\s\S]*?);/.exec(THIS_FILE);
  assert.ok(bullet, 'the NOT COVERED bullet no longer names the lines read as data');
  const namedThere = bullet[1].replace(/\s+/g, ' ').split(/, | and /);
  assert.deepEqual(namedThere, MACHINE_READ_PREFIXES,
    'the bullet and machineLine() disagree about which lines are read as data: '
    + namedThere.join(' / '));

  /* And from the sheet's side: no OTHER line in it is shaped like data. */
  /* Not de-duplicated, and \s* rather than * so this scan indents exactly
     as machineLine() does. Every reader takes the FIRST match, so a second
     copy of a data line is read by nobody: a duplicate SAME FOCUS RING AS
     naming a sheet with no sideways box at all was green, which re-opened
     finding 4 of Stadiora/Aria#10632 from a line the device never reads
     (found in the seventh review of #75, RV7-D1). One line per prefix. */
  const headings = [...PANE_CSS.matchAll(/^\s*([A-Z][A-Z-]+(?: [A-Z-]+)*):/gm)].map((m) => m[1]);
  assert.deepEqual(headings.slice().sort(), [...MACHINE_READ_PREFIXES].sort(),
    'the sheet carries a line shaped like a machine-read one that nothing reads, or a '
    + 'second copy of one that only the first of is read: ' + headings.join(' / '));
  /* The unprefixed kind, counted off the code rather than typed in prose. */
  assert.ok(THIS_FILE.includes('const ' + FRAMES_LIST_NAME + ' = ['),
    'FRAMES_LIST_NAME does not name a list this file declares, so the bullet points at '
    + 'nothing and the check below is comparing a string to itself');
  /* The whole NOT COVERED block, not the one bullet parsed above: the
     frames are named in a different bullet from the prefixes. */
  const notCovered = /NOT COVERED, deliberately[\s\S]*?\*\//.exec(THIS_FILE);
  assert.ok(notCovered, 'the NOT COVERED block is gone, and with it every claim about '
    + 'what this file does not check');
  /* Block-level, and only that: the block names the list twice, so deleting
     one mention is green and deleting both is red (M12-B4/B4c). The claim
     bound here is "the NOT COVERED block points at the list", not which
     sentence in it does the pointing. */
  assert.ok((notCovered[0].match(/(?<![\w$])[A-Z][A-Z0-9_]{3,}(?![\w$])/g) || [])
    .includes(FRAMES_LIST_NAME),
    'the NOT COVERED block stopped naming ' + FRAMES_LIST_NAME + ' as a WHOLE identifier, so '
    + 'the unprefixed readers are enumerated in code and unmentioned in the prose that claims '
    + 'to name them. Substring was not enough: the block naming ' + FRAMES_LIST_NAME + 'S, a '
    + 'constant that does not exist, passed a containment test (RV25-A1) -- and an UPPER_SNAKE '
    + 'match with no boundary was not enough either, because it stops at a lowercase letter, '
    + 'so the same name with a trailing lowercase s passed it (RV26-4)');
  assert.deepEqual(
    [...new Set([...PANE_CSS.matchAll(SHEET_POINTER_SHAPE)].map((m) => m[0]))].sort(),
    [...LISTS_THE_SHEET_NAMES].sort(),
    'the sheet points at a list this file does not track, or stopped pointing at one it '
    + 'does: the list below is asserted against the sheet, not against itself');
  for (const name of LISTS_THE_SHEET_NAMES) {
    assert.ok(THIS_FILE.includes('const ' + name + ' = ['),
      'the sheet names ' + name + ' but this file declares no such list, so the pointer '
      + 'is a dangling name');
    assert.ok(PANE_CSS.includes(name),
      'the sheet stopped naming ' + name + ', so the list is enumerated in code and '
      + 'unmentioned in the prose that claims to name it');
  }
  const framed = outsideSheetCount(THIS_FILE);
  const frames = (framed.match(FRAME_SPELLING) || []).length
    + (framed.match(HELPER_FRAME_SPELLING) || []).length;
  assert.equal(frames, PROSE_FRAMES_OVER_THE_SHEET.length,
    'this file reads the sheet through ' + frames + ' prose frames and names '
    + PROSE_FRAMES_OVER_THE_SHEET.length + ': a frame was added or removed without saying '
    + 'which sentence it reads');

  /* This file's OWN citations, resolved the way the stylesheet's are. The
     marker is the words "The test" before the quote; a citation written
     without it is invisible here, which is the shape this misses and the
     reason FILE_CITATIONS is pinned by identity rather than by a floor.

     That gap has a SECOND face, named by the fifth review of #75: an
     unmarked quotation of a title belonging to NO suite -- an invented one
     -- falls between both halves. The marked half never sees it for want of
     the marker, and the foreign half below rejects it because it is in no
     sibling's title set. Only a real foreign title is caught unmarked. */
  /* Built from parts rather than written as one literal, or the pattern
     matches its own source text and this file cites `([^`. */
  const marker = new RegExp('The' + ' test "([^"]+)"', 'g');
  const marked = [...THIS_FILE.replace(/\s+/g, ' ').matchAll(marker)].map((m) => m[1]);
  assert.deepEqual([...new Set(marked)].sort(), FILE_CITATIONS.slice().sort(),
    'a comment in this file cites a test FILE_CITATIONS does not list, or stopped citing '
    + 'one it does');
  assert.deepEqual(marked.filter((title) => !TEST_TITLES.has(title)), [],
    'a comment in this file names a test this file does not register, so the sentence '
    + 'around it is prose wearing a proof pointer');

  /* And the failure that got here: an UNMARKED quotation of a title that is
     real, but belongs to another suite. Those read as proof to a person and
     bind nothing. */
  const foreign = new Set();
  const siblings = [];
  for (const name of readdirSync(new URL('.', import.meta.url))) {
    if (!/^ops-.*\.test\.mjs$/.test(name) || name === 'ops-alerts-v2.test.mjs') continue;
    for (const m of readFileSync(new URL(name, import.meta.url), 'utf8')
      .matchAll(/^test\('([^']+)'/gm)) foreign.add(m[1]);
    siblings.push(name);
  }
  /* No number is asserted here on purpose: how many siblings exist depends on
     what else is on the branch, and CI reads the PR's MERGE commit, so this
     file sees suites that do not exist in the author's tree (measured: 363
     titles locally, 459 in the Linux log for the same commit).

     NOT COVERED, and deleted rather than repaired: a per-sibling floor
     stood here asserting that every sibling yields at least one title,
     to catch the pattern above going stale. It was wrong on its own
     terms. ops-readme-claims.test.mjs runs every check at module scope
     and registers no test() at all, which is legitimate, so the floor
     reddened this file the moment that suite landed on main -- a guard
     failing on a sibling it has no business having an opinion about. The
     floor is gone and no probe replaced it, because a probe for "does
     this file register tests" is one more pattern over source text that
     the next spelling walks past. What survives is the blind spot stated
     plainly: a sibling that spells its registration in a way the pattern
     above does not match contributes no titles, and an unmarked quotation
     of one of ITS titles is not caught here. */
  assert.ok(siblings.length > 0, 'no sibling ops-* suite was found at all, so the foreign '
    + 'check below compares against an empty set and can never fire');
  /* Asked per known title rather than by scanning this file for quoted runs.
     A scan pairs quote characters in order, so ONE unbalanced " anywhere
     above shifts every pair after it, and this file is full of them. That
     shift is why my round-6 battery could paste a foreign title into a
     comment and watch the suite stay green. No count of them is typed here:
     one was, and it went stale twice inside this pull request's own review
     loop before the eighth review caught it. Membership cannot drift: each
     candidate is a string we already have. */
  const normalised = THIS_FILE.replace(/\s+/g, ' ');
  const quotedForeign = [...foreign]
    .filter((title) => !TEST_TITLES.has(title) && normalised.includes('"' + title + '"'));
  assert.deepEqual(quotedForeign, [],
    'a comment in this file quotes a test title that belongs to a DIFFERENT ops suite, '
    + 'which reads as a proof pointer and is not one');

  console.log('machine-read docblock lines judged: '
    + JSON.stringify({ read: MACHINE_READ_PREFIXES.length, inSheet: headings.length,
      proseFrames: frames, ownCitations: marked.length,
      siblingSuites: siblings.length, foreignTitles: foreign.size }));
});

test('every test the stylesheet cites by name is a test this file registers', async () => {
  const prose = PANE_CSS.replace(/\s+/g, ' ').replace(/[a-zA-Z-]+="[^"]*"/g, '');
  const quoted = [...prose.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  for (const copy of SHEET_QUOTES_THAT_ARE_NOT_CITATIONS) {
    assert.ok(quoted.includes(copy),
      'the sheet no longer quotes ' + JSON.stringify(copy) + ', so the exception for it here '
      + 'is stale and the next quotation of it would be waved through as UI copy');
  }
  /* And the other direction, which was missing: nothing stopped a real title
     from being moved onto that list. A renamed test turns this red, and the
     cheapest green is to exempt the sheet's stale quotation as UI copy --
     two lines, and the guarantee is off for that title forever (found in the
     tenth review of #75).

     A REGISTRY check cannot decide that, because after the rename the
     attacker's string is by construction outside the registry: the eleventh
     review renamed a cited test, exempted its stale quotation and dropped
     the entry, and the suite stayed green (MX-1). A VALUE check can. UI copy
     is a run of text the drawn page actually contains; a test title is not.
     So both directions, the registry one for a title still registered and
     the page one for a title that is not. */
  assert.deepEqual(SHEET_QUOTES_THAT_ARE_NOT_CITATIONS.filter((q) => TEST_TITLES.has(q)), [],
    'a string exempted here as UI copy is also a test this file registers, so a citation '
    + 'can be unbound by moving it onto the exemption list');
  const drawn = await boot({ role: 'owner' });
  const pageText = allText(drawn.doc.body).replace(/\s+/g, ' ');
  for (const copy of SHEET_QUOTES_THAT_ARE_NOT_CITATIONS) {
    assert.ok(pageText.includes(copy),
      'the page does not draw ' + JSON.stringify(copy) + ', so it is not UI copy: a test '
      + 'title renamed and then exempted here would leave the sheet quoting a test that '
      + 'does not exist, beside the sentence that quotation is the proof pointer for');
  }

  const cited = quoted.filter((q) => !SHEET_QUOTES_THAT_ARE_NOT_CITATIONS.includes(q));
  assert.deepEqual(cited.filter((title) => !TEST_TITLES.has(title)), [],
    'the sheet names a test that this file does not register, so the sentence around it is '
    + 'prose wearing a proof pointer');

  /* The EXTENT, not only the verdict: an empty citation list passes the line
     above, and the sheet would then be entirely unbound while this test went
     on saying its citations were fine. A FLOOR is not enough either -- at
     >= 8 against 14 real ones, six could be deleted in silence (found in the
     third review of #75) -- so the list itself is pinned and losing one is a
     deliberate edit here. */
  assert.deepEqual(cited.slice().sort(), [...SHEET_CITATIONS, NON_TOKEN_PAINT_TITLE].sort(),
    'the sheet cites a different MULTISET of tests than SHEET_CITATIONS lists, so a claim '
    + 'has either gained or quietly LOST its proof pointer. Counted per site, not per '
    + 'title: a title cited from two places is listed twice, or deleting one of the two '
    + 'goes unnoticed');
  console.log('stylesheet citations judged: '
    + JSON.stringify({ quoted: quoted.length, cited: cited.length,
      distinctTests: new Set(cited).size }));
});

test('the page loads one design system and one theme decision', () => {
  const html = read('alerts.html');
  /* A TEXT scan, and it reds on a MENTION rather than on a load. Measured
     round 29: a `data-href="assets/operate.css"` decoy beside a real href, and
     a duplicate `href=` the parser discards, both red here although Chrome
     requests only aria.css, shell-pane-v2.css and pane-alerts-v2.css in either
     case (M29-C17, M29-C18 -- both published as false REDS, in the safe
     direction for a v1 asset, which is why this stays a scan). What the page
     actually LOADS is decided by the deepEqual against V2_STYLESHEETS below,
     off the document walk; this loop only says the v1 names are absent. */
  for (const v1 of ['assets/ops.css', 'assets/operate.css', 'assets/shell.js', 'assets/icons.js']) {
    assert.ok(!html.includes(v1),
      'alerts.html loads ' + v1 + ' as well as the v2 sheets; both define .card, ' +
      '.rail, .topbar, .btn, .seg, .pill and .tbl from different token sets');
  }
  for (const v2 of [...V2_STYLESHEETS,
    'assets/aria.js', 'assets/shell-pane-v2.js', 'assets/pane-alerts.js']) {
    assert.ok(html.includes(v2), 'alerts.html no longer loads ' + v2);
  }
  assert.equal((html.match(/assets\/theme\.js/g) || []).length, 1,
    'the theme is decided in more than one place');
  assert.match(html, /Content-Security-Policy/,
    'the page no longer spells Content-Security-Policy anywhere -- which is as much as a scan '
    + 'over text can say: whether what it spells is a <meta> pragma the parser builds, and '
    + 'builds in <head>, is decided in the CSP test below, which parses the page and refuses '
    + 'a pragma it cannot place there (RV25-1, bound in round 29)');
  assert.ok(!/unsafe-inline/.test(html), 'the CSP grew unsafe-inline');
  /* `no unsafe-inline` is not the same claim as `no inline styles`: a hash
     or a nonce opens the <style> route one sheet at a time, with no
     violation reported, and the NOT COVERED bullet at the top of this file
     says that route is CLOSED. So the source list is pinned whole, not
     searched for one keyword (twenty-second review of #75).

     Which list, though, is the whole of it. `style-src` is not what governs
     a <style> ELEMENT when `style-src-elem` is present: CSP3 makes the
     -elem directive the governing one and `style-src` merely its fallback,
     so `style-src 'self'; style-src-elem 'self' 'sha256-...'` leaves the
     directive byte-for-byte 'self' and paints anyway -- measured in Chrome,
     0 violations (twenty-third review of #75). The fallback chain is
     resolved here and the RESULT is pinned, rather than one directive being
     read because it has the expected name. Directive names are ASCII
     case-insensitive, so they are lowercased before the lookup; a duplicate
     directive is ignored by the parser after its first occurrence, so the
     first is what this reads too. `style-src-attr` is NOT in this chain: it
     governs style ATTRIBUTES, not <style> elements, and the attribute route
     is not what the bullet claims to have closed. */
  /* The policy is lifted out of a PARSE of the page's raw bytes, not out of
     a scan over text, and not out of a copy of the page that was decoded
     before anything looked for a tag in it. Every clause there is scar
     tissue:
       - a scan for `content=` has no attribute-name boundary, so
         `data-content="..."` is what gets read (RV21 in the <link> half,
         RV24-1 here), and a boundary answers "is this byte a separator",
         which is strictly weaker than "is this position an attribute name":
         `http-equiv="refresh" http-equiv="Content-Security-Policy"` keeps
         the FIRST to the parser and the LAST to a regex, and
         `data-old=' http-equiv="Content-Security-Policy"'` puts the name
         inside another attribute's VALUE, where the space in front of it is
         a space in a quoted string (RV27-1, which replaced the boundaries
         with a tokeniser);
       - a tokeniser with no DOCUMENT state reads a whole
         `<meta http-equiv=... content=...>` written inside another tag's
         quoted value as the page's policy, while Chrome sees one inert
         attribute and ships none (RV28-2, which replaced the `<meta` scan
         with the nodesOf() walk);
       - and decoding the page BEFORE parsing it puts `&#104;ttp-equiv` and
         `&#99;ontent` into the reader as the attributes the browser does
         not have, and `&#34;` into a value as a quote the browser does not
         see. Chrome enforces no policy for the first two and ships
         `'unsafe-inline'` for the third (RV28-1, which moved the decode
         from the whole document onto extracted attribute values).
     The reader uses HTML's space characters rather than `\s` (see HTML_SP):
     `<meta&#160;http-equiv=...` is a tag whose NAME is the whole of
     `meta&#160;http-equiv="content-security-policy"` to the parser, because
     character references are not decoded inside a tag name either.

     What this block does NOT do is decide where the parser put the pragma.
     It refuses instead: stillInHead() is false for anything it cannot prove
     is still in <head>, and a pragma it is false for is not read. */
  assert.deepEqual(WALK_REFUSALS, [],
    'the document walk refused to model a shape in this page, so nothing below may read a '
    + 'node out of it: a reader that cannot tell where an element ENDS can invent a tag the '
    + 'parser never built, and inventing one is the direction that ships a page with no policy '
    + 'while this file says it has one');
  const cspMetas = META_TAGS.filter((t) => (t.attrs.get('http-equiv') || '').toLowerCase()
    === 'content-security-policy');
  assert.deepEqual(cspMetas.filter((t) => !stillInHead(t)).map((t) => t.text), [],
    'a <meta> pragma in this page is somewhere this reader cannot prove is still <head> -- '
    + 'moved into <body>, put after a </head> or a <template>, or standing after text or an '
    + 'element that ends the head -- and a pragma the parser does not see in head is not a '
    + 'policy at all, so this refuses it rather than reading a policy the browser never had');
  assert.ok(cspMetas.length <= 1,
    'more than one <meta> tag in this page resolves to a Content-Security-Policy pragma, and '
    + 'which one the parser honours is not this reader\'s decision');
  /* No count of the string `Content-Security-Policy` in the page's text is
     taken any more. It was here to refuse the one shape a scan could not
     decide -- a commented-out old policy beside the live one -- and the walk
     decides it: a comment is a comment node and holds no tags, so an old
     policy inside one is not a pragma here, and commenting out the LIVE one
     leaves this block with no policy and reds on the source list below. The
     count is the thing that would have to be deleted for that shape to pass,
     and it could only ever be a false red on the page's prose. */
  const csp = cspMetas.length ? (cspMetas[0].attrs.get('content') ?? null) : null;
  const directives = new Map();
  for (const d of (csp || '').split(';')) {
    const parts = d.trim().split(/\s+/).filter(Boolean);
    if (parts.length && !directives.has(parts[0].toLowerCase())) {
      directives.set(parts[0].toLowerCase(), parts.slice(1));
    }
  }
  const styleElem = ['style-src-elem', 'style-src', 'default-src']
    .map((name) => directives.get(name)).find((list) => list !== undefined);
  assert.deepEqual(styleElem === undefined ? null : styleElem, ["'self'"],
    'the source list that governs a <style> ELEMENT is no longer exactly \'self\': a hash, a '
    + 'nonce or another source -- in style-src-elem, in style-src, or in the default-src this '
    + 'falls back to -- opens the <style> route that the NOT COVERED bullet at the top of this '
    + 'file describes, and it opens it without reporting a violation. That bullet claims the '
    + 'route is shut only IF the page carries this policy at all, which is the part no scan '
    + 'over text can settle (RV25-1)');

  /* The sheet's own first sentence: "Loaded after assets/aria.css and
     assets/shell-pane-v2.css, on ops/alerts.html and nowhere else." Order
     first -- a later sheet wins a tie in the cascade, and this one is written
     to override the two above it. */
  /* Each index is proven to EXIST first. indexOf returns -1 for any other
     spelling, and -1 is below every real index, so both comparisons passed
     whenever the missing link was the left operand -- which is aria.css and
     shell-pane-v2.css, the two sheets the first sentence claims to be loaded
     after. Re-spelling aria.css as href="assets/aria.css?v=2" and moving it
     last was green (found in the seventh review of #75, RV7-3). The guard
     failed OPEN, in the one direction that matters. */
  const at = (href) => {
    const i = html.indexOf('href="' + href + '"');
    assert.ok(i >= 0, 'alerts.html no longer carries href="' + href + '" in that exact '
      + 'spelling, so nothing below can compare its position');
    return i;
  };
  assert.ok(at('assets/aria.css') < at('assets/shell-pane-v2.css'),
    'alerts.html loads shell-pane-v2.css before aria.css');
  assert.ok(at('assets/shell-pane-v2.css') < at('assets/pane-alerts-v2.css'),
    'alerts.html loads pane-alerts-v2.css before the sheets it is written to override');

  /* And nowhere else. */
  const elsewhere = readdirSync(new URL('.', OPS))
    .filter((name) => name.endsWith('.html') && name !== 'alerts.html')
    .filter((name) => read(name).includes('pane-alerts-v2.css'));
  assert.deepEqual(elsewhere, [],
    'pane-alerts-v2.css is loaded by a page other than alerts.html, which its own docblock '
    + 'says never happens');
});

/* A prohibition on the spelling, not a proof about the behaviour: it pins the
   three names, and a value that became markup by some other route would walk
   past it. It is here because those three names are how it would actually
   happen, and because nothing else in the suite would notice. */
test('the pane never spells innerHTML, outerHTML or insertAdjacentHTML', () => {
  assert.ok(!/innerHTML/.test(PANE_SRC), 'the pane reached for innerHTML');
  assert.ok(!/\.outerHTML/.test(PANE_SRC), 'the pane reached for outerHTML');
  assert.ok(!/insertAdjacentHTML/.test(PANE_SRC), 'the pane reached for insertAdjacentHTML');
});

/* A block that is not ready renders words and never a numeral — the Overview
   rule, applied to the one state here that can be mistaken for a zero. */
test('a pane that could not be read prints no numeral that could be read as a count', async () => {
  const dom = await boot({
    open: new Error('nothing answered'),
    rules: new Error('nothing answered'),
    closed: new Error('nothing answered'),
  });
  assert.equal(numerals(liveText(dom)), 0,
    'an unreadable pane printed a numeral: ' + liveText(dom).replace(/\s+/g, ' ').slice(0, 200));
});

/* ===================== the rules table as a region ===================== */

/* The rules table holds a minimum width, so on a phone it scrolls
   inside its own box. A box that scrolls sideways and cannot be focused
   belongs to a pointer: measured on the real page at 375px, that box reported
   clientWidth 343 against scrollWidth 967, with 624px of table past its own
   edge (Stadiora/Aria#10459).

   Everything below is asserted about THE BOX THAT CLIPS -- the table's own
   parent, reached from the table rather than from a class name -- and the
   overflow that makes it clip is read out of the stylesheet, so a rule that
   moved the scrolling somewhere else cannot leave these assertions passing on
   a box that no longer scrolls. */
test('the rules table scrolls inside a box a keyboard can reach and a screen reader can name',
  async () => {
    const dom = await boot({});
    const table = findAll(panel(dom, 'live'),
      (n) => n.tagName === 'TABLE' && allText(n).includes('What it watches'))[0];
    assert.ok(table, 'the pane drew no rules table');

    const box = table.parentNode;
    const classes = (box.className || '').split(/\s+/).filter(Boolean);
    assert.equal(classes.length, 1, 'the box around the table carries more than one class');
    const paint = declarations(PANE_CSS)
      .filter((d) => d.selector === '.' + classes[0] && d.property === 'overflow-x');
    assert.deepEqual(paint.map((d) => d.value), ['auto'],
      'the table\'s own parent is not the box the stylesheet scrolls, so these '
      + 'assertions would be about an element that clips nothing');

    assert.equal(box.getAttribute('tabindex'), '0',
      'the box that clips the table has no tab stop, so the columns past its edge '
      + 'are a pointer\'s alone');
    assert.equal(box.getAttribute('role'), 'region');

    /* A tab stop with no name is announced as "group" and nothing else. The
       name is the table's own caption, so the region and the table cannot end
       up describing themselves differently. */
    const named = box.getAttribute('aria-labelledby');
    assert.ok(named, 'the region has no accessible name');
    const targets = findAll(dom.doc.body, (n) => n.getAttribute('id') === named);
    assert.equal(targets.length, 1,
      'aria-labelledby resolves to ' + targets.length + ' elements, so the name is '
      + (targets.length ? 'ambiguous' : 'nothing at all'));
    assert.equal(targets[0].tagName, 'CAPTION', 'the name is not the table\'s own caption');
    assert.equal(targets[0].parentNode, table, 'the caption names some other table');
    assert.ok(allText(targets[0]).trim().length > 0, 'the caption is empty');

    /* The ring is the global one, moved. aria.css puts :focus-visible OUTSIDE
       the element; this box is flush with its card's left, right and top
       edges, so outside the box is outside the CARD -- measured on the
       rendered page at both widths and both themes in
       antonyrugama/aria-website#72, all of the default ring lands beyond the
       box and none of it on the table.

       The quantity that decides whether a ring lands INSIDE its box is the
       ring's own width, not the offset it is pulled in by: a ring of width w
       painted at offset o spans o to o + w outward from the box edge, so it
       is wholly inside only when o <= -w. Deriving the override from the
       global OFFSET alone left the suite green while aria.css grew a 6px ring
       that a -2px offset leaves 4px of outside the box (Stadiora/Aria#10633).
       Both quantities are read out of aria.css here, and neither is typed. */
    /* WHICH declaration paints is a cascade question, not a document-order
       one: within one origin the last !important wins where there is one,
       and the last declaration otherwise. Reading document order alone took
       2px off a rule painting a 6px !important ring -- 4px of it outside the
       box, suite green -- and aria.css already uses !important four times
       (found in the third review of antonyrugama/aria-website#75). What this
       does NOT model is named in the NOT BOUND list at the top of the sheet:
       one origin, and the :focus-visible selector exactly as spelled. */
    const wins = (decls, what) => {
      assert.ok(decls.length > 0, 'nothing declares ' + what + ' at all');
      const forced = decls.filter((d) => IMPORTANT.test(d.value));
      const kept = forced.length ? forced : decls;
      return kept[kept.length - 1].value.replace(IMPORTANT, '').trim();
    };
    const globalRing = (property) => declarations(ARIA_CSS)
      .filter((d) => d.selector === ':focus-visible' && d.property === property);
    const px = (value, what) => {
      const n = Number(/^(-?[\d.]+)px$/.exec(value)?.[1]);
      assert.ok(Number.isFinite(n), what + ' is not a px length: ' + value);
      return n;
    };

    /* The width comes from the shorthand and the longhand together -- an
       outline-width ABOVE a later outline shorthand is overridden by it, so
       preferring the longhand wherever it sits reads a 1px ring off a rule
       that paints 6px, and preferring document order reads 2px off a 6px
       !important one. Both go through wins(). */
    const widthDecl = wins(declarations(ARIA_CSS).filter((d) => d.selector === ':focus-visible'
      && (d.property === 'outline' || d.property === 'outline-width')),
    'a global outline width');
    const width = px((/(^|\s)(-?[\d.]+px)(\s|$)/.exec(widthDecl) || [])[2] || widthDecl,
      'aria.css\'s global outline width');
    assert.ok(width > 0, 'aria.css\'s global focus ring has no width, so there is no ring');

    const outside = px(wins(globalRing('outline-offset'), 'a global outline-offset'),
      'aria.css\'s global outline-offset');
    assert.ok(outside > -width,
      'aria.css\'s global ring already lands wholly inside the element, so this override has '
      + 'nothing to pull in and the reason written beside it is false');

    const offsets = declarations(PANE_CSS).filter(
      (d) => d.selector === '.' + classes[0] + ':focus-visible' && d.property === 'outline-offset');
    const pulled = px(wins(offsets, 'an offset on ' + classes[0]),
      'the offset on ' + classes[0]);
    assert.ok(pulled + width <= 0,
      'the focus ring on the scrolling box is ' + (pulled + width) + 'px wide outside the box: '
      + 'a ' + width + 'px ring at ' + pulled + 'px needs an offset of at most ' + (-width) + 'px '
      + 'to land on the table it belongs to');

    /* And the two siblings the sheet says carry the same line carry it: read
       out of the sheet's own SAME FOCUS RING AS line, compared declaration
       for declaration, because citing a sibling that differs is the same
       defect class as a docblock that describes paint it does not use
       (Stadiora/Aria#10632). */
    const cited = machineLine('SAME FOCUS RING AS').exec(PANE_CSS);
    assert.ok(cited, 'the sheet no longer names the siblings it says it matches');
    const siblings = cited[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.ok(siblings.length > 0, 'the sheet cites no sibling at all');
    const mine = scrollBoxFocusRule(PANE_CSS);
    assert.deepEqual(mine, [{ property: 'outline-offset', value: pulled + 'px' }],
      'the rule this test compares the siblings against is not the one it just measured');
    for (const name of siblings) {
      assert.deepEqual(scrollBoxFocusRule(read('assets/' + name)), mine,
        name + ' does not draw the same focus ring on its own scrolling box, so the line '
        + 'citing it is false');
    }

    /* And the sibling the sheet says is deliberately NOT on that line really
       differs, by exactly the property it says: naming an excluded sibling is
       a positive claim too, and it was the false half of
       Stadiora/Aria#10632's finding 4. */
    /* The line carries the whole DECLARATION, property and value. Naming the
       property alone left "it resets border-radius: 0" half bound: the
       sibling growing a border-radius: 4px kept the suite green while the
       sentence went on saying 0 (found in the second review of #75). */
    const apart = machineLine('DIFFERENT FOCUS RING',
      '\\s*(\\S+)\\s+adds\\s+([\\w-]+):\\s*(\\S.*?)\\s*').exec(PANE_CSS);
    assert.ok(apart, 'the sheet no longer names the sibling it says it differs from');
    const [, excluded, extra, extraValue] = apart;
    assert.ok(!siblings.includes(excluded),
      excluded + ' is cited as both the same ring and a different one');
    const theirs = scrollBoxFocusRule(read('assets/' + excluded));
    /* BOTH directions. theirs \ mine alone let the sibling DROP a
       declaration unseen: deleting outline-offset: -2px from
       pane-releases-v2.css left the difference still reading as exactly the
       one added declaration, while the sibling's ring went back outside its
       box -- Stadiora/Aria#10459's own defect, behind a green suite (found
       in the seventh review of #75, RV7-4). A set difference is not a
       comparison; "differs by exactly" is an equality. */
    const spell = (ds) => ds.map((d) => d.property + ': ' + d.value).sort();
    assert.deepEqual(spell(theirs), spell([...mine, { property: extra, value: extraValue }]),
      excluded + ' no longer differs from this sheet by exactly ' + extra + ': ' + extraValue
      + ', so the reason it is held apart is false');
    assert.ok(!mine.some((d) => d.property === extra),
      'this sheet declares ' + extra + ' on its own focus rule after all');
  });

/* The focus rule of whichever box a sheet scrolls sideways, found by its
   overflow rather than by a class name: every one of these sheets calls its
   box something different. */
function scrollBoxFocusRule(css) {
  const decls = declarations(css);
  const boxes = decls
    .filter((d) => d.property === 'overflow-x' && d.value === 'auto')
    .map((d) => d.selector);
  assert.equal(boxes.length, 1, 'expected exactly one sideways-scrolling box, found '
    + boxes.length + ': ' + boxes.join(', '));
  return decls
    .filter((d) => d.selector === boxes[0] + ':focus-visible')
    .map((d) => ({ property: d.property, value: d.value }));
}

/* The state the tab stop exists FOR. Every rule switch is disabled for anyone
   below owner, so for them the box holds nothing focusable at all and the stop
   on the box itself is the only way into the columns past its edge. */
test('for a non-owner the scrolling box holds nothing else that can take focus', async () => {
  const dom = await boot({ role: 'viewer' });
  const table = findAll(panel(dom, 'live'),
    (n) => n.tagName === 'TABLE' && allText(n).includes('What it watches'))[0];
  const box = table.parentNode;

  const inside = findAll(box, (n) => n !== box && focusable(n));
  assert.deepEqual(inside.map((n) => n.tagName), [],
    'a non-owner has something else to tab to in here, so this fixture no longer '
    + 'reproduces the state the stop is for');
  assert.ok(focusable(box), 'nothing in or on the box can take focus');
});

/* ========================== what the sheet paints ====================== */

/* ops/assets/pane-alerts-v2.css opens with positive claims about its own
   paint. Prose is where this programme's defects have lived, so they are
   derived from the file here rather than trusted: the sheet itself said "no
   new colour value" while painting one (Stadiora/Aria#10460).

   What the reader below catches and what walks past it USED TO BE A SENTENCE
   here, and the sentence was wrong -- it said "a hex, a colour function or an
   unknown function in the same place would not [walk past]", which is false
   for color-mix(), the one colour function this sheet uses
   (Stadiora/Aria#10632). The sentence is gone. READER_PROBES below is the
   same statement as cases the reader is actually run against, so a blind spot
   that closes or opens fails the suite instead of going stale in a comment.

   Still NOT COVERED: strings, which the reader does not parse. A quoted
   STRING is
   refused only when it carries a brace or a semicolon -- what declarations()
   splits on -- so a colour word inside one reaches the reader as an ordinary
   value and is then judged, or walked past, by the paint stem in its
   property's name like anything else. This sheet's only string is
   content: ''. */

/* Every declaration in a sheet, as { selector, property, value }. A reader
   rather than a regex over the source: `white-space` contains the word
   "white", `--acc` is a custom property holding a colour, and a rule nested
   in @media is still a rule. */
/* A declaration's importance decides the cascade before its position does.
   declarations() keeps the flag in the value, so anything resolving a
   winner has to read it and anything reading a length has to strip it. */
const IMPORTANT = /\s*!\s*important\s*$/i;

function declarations(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const stack = [];
  let buf = '';
  let depth = 0;
  const flush = () => {
    const text = buf.trim();
    const i = text.indexOf(':');
    if (!text || !stack.length || i < 0) return;
    out.push({
      selector: stack[stack.length - 1],
      property: text.slice(0, i).trim(),
      value: text.slice(i + 1).trim().replace(/\s+/g, ' '),
    });
  };
  for (const ch of src) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && (ch === '{' || ch === '}' || ch === ';')) {
      if (ch === '{') stack.push(buf.trim().replace(/\s+/g, ' '));
      else { flush(); if (ch === '}') stack.pop(); }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

/* var() first, then a function name, then a hex, then a measure, then a bare
   word, then the parentheses that nest them. Order matters: `var(--cyan)`
   must not come back as the word `var`.

   Every atom carries the function it sits INSIDE, because `transparent`
   standing alone and `transparent` laid under a token by a color-mix() are
   different paint, and the sheet's docblock claims it only ever uses the
   second (Stadiora/Aria#10632). Without this the two are one pin entry and
   the claim can go stale in place. */
const ATOM =
  /var\(\s*--[\w-]+\s*\)|-?[a-zA-Z][\w-]*\(|#[0-9a-fA-F]{3,8}\b|-?\.?\d[\w.%]*|-?[a-zA-Z][\w-]*|[()]/g;
function atomsIn(value) {
  const out = [];
  const open = [];
  for (const [text] of value.matchAll(ATOM)) {
    if (text === '(') { open.push(''); continue; }
    if (text === ')') { open.pop(); continue; }
    out.push({ atom: text, inside: open[open.length - 1] || '' });
    if (text.endsWith('(') && !text.startsWith('var(')) open.push(text.slice(0, -1));
  }
  return out;
}
const atomsOf = (value) => atomsIn(value).map((a) => a.atom);

/* Property names that can carry a colour, by stem. Anything starting with --
   counts too: .acc-blue sets --acc to one. */
const PAINT_STEMS = ['color', 'background', 'shadow', 'outline', 'border', 'fill', 'stroke'];
const paints = (property) =>
  property.startsWith('--') || PAINT_STEMS.some((stem) => property.includes(stem));

/* Words that appear inside a colour-bearing value and are not paint. Pinned,
   so a fourth one is classified by a person rather than assumed. */
const COLOUR_SYNTAX = ['in', 'inset', 'solid', 'srgb'];

/* The functions this sheet is allowed to call, anywhere. An unknown one is a
   failure rather than a skip: rgb(), hsl() and every other colour function
   arrives here first, and so does a var() written with a fallback -- only the
   bare `var(--token)` spelling is read as a token below. */
const FUNCTIONS = ['color-mix(', 'linear-gradient(', 'minmax(', 'translateX('];

/* The reader's whole verdict on one sheet: every atom it paints with, every
   function it calls, and which of those functions nothing has classified.
   One function, so the probes below and the assertions on the real sheet run
   the same code rather than two readings of it. */
function readPaint(css) {
  const found = [];
  const functions = new Set();
  for (const d of declarations(css)) {
    for (const { atom, inside } of atomsIn(d.value)) {
      if (atom.endsWith('(')) { functions.add(atom); continue; }
      if (atom.startsWith('var(')) continue;
      if (/^-?\.?\d/.test(atom)) continue;
      const site = { selector: d.selector, property: d.property, atom, inside };
      if (atom.startsWith('#')) { found.push(site); continue; }
      if (!paints(d.property) || COLOUR_SYNTAX.includes(atom)) continue;
      found.push(site);
    }
  }
  return {
    found,
    functions: [...functions].sort(),
    unclassified: [...functions].filter((f) => !FUNCTIONS.includes(f)).sort(),
  };
}

/* What the reader refuses and what walks past it, one declaration at a time.
   `refused` is typed from what the assertions below would do with that
   declaration -- report a non-token atom, or call a function FUNCTIONS has
   not classified -- and is never read back out of readPaint().

   The rows marked BLIND SPOT are the ones this guard does NOT catch. They are
   here so that closing a blind spot, or opening a new one, fails the suite:
   the sentence they replaced claimed colour functions were refused
   everywhere, which was false for the only colour function the sheet uses
   (Stadiora/Aria#10632). */
const READER_PROBES = [
  { css: '.probe { color: magenta; }', refused: true,
    why: 'a bare colour keyword on a property whose name carries a paint stem' },
  { css: '.probe { border-color: #ff00ff; }', refused: true, why: 'a hex where colour is expected' },
  { css: '.probe { column-rule: 1px solid #ff00ff; }', refused: true,
    why: 'a hex is refused on EVERY property, paint stem or not' },
  { css: '.probe { column-rule: 1px solid frobnicate(0); }', refused: true,
    why: 'an unclassified function is refused on every property' },
  { css: '.probe { color: color-mix(in srgb, black 50%, white); }', refused: true,
    why: 'the atoms inside a classified function ARE read, on a property that paints' },
  { css: '.probe { --acc: magenta; }', refused: true,
    why: 'a custom property can carry a colour, so every one of them is read' },
  { css: '.probe { column-rule: 1px solid magenta; }', refused: false, stemless: 'column-rule',
    why: 'BLIND SPOT: a bare colour keyword on a property with no paint stem in its name' },
  /* Probing one of the stemless properties the sheet names and writing the
     rest into prose is the claim this file exists to stop making, so each is
     run (found in the third review of #75). No count of them is typed: one
     was, it said five where the sheet names four -- filter came off that
     list in round 4 and the count did not follow -- and the row below had
     been contradicting it in the same file ever since (found in the ninth
     review of #75). The list is bound; a number beside it never was. */
  { css: '.probe { text-decoration: underline magenta; }', refused: false, stemless: 'text-decoration',
    why: 'BLIND SPOT: text-decoration, named by the sheet, carries no paint stem' },
  { css: '.probe { mask-image: linear-gradient(magenta, white); }', refused: false, stemless: 'mask-image',
    why: 'BLIND SPOT: mask-image, named by the sheet, carries no paint stem' },
  { css: '.probe { list-style: square inside magenta; }', refused: false, stemless: 'list-style',
    why: 'BLIND SPOT: list-style, named by the sheet, carries no paint stem' },
  { css: '.probe { filter: drop-shadow(0 0 1px magenta); }', refused: true,
    why: 'NOT a blind spot, though paints("filter") is false: this syntax is an unclassified '
      + 'function, and those are refused everywhere. The OTHER syntax that carries a colour to '
      + 'filter -- a URL reference to an SVG filter that paints one -- is run by its own row '
      + 'below, added in RV27-2, which found this row asserting both in prose while running '
      + 'one. The sheet named filter alongside the four real ones until this row was run. '
      + 'RV22-A2 corrected the sheet\'s copy of this sentence and RV23-A1 caught that this '
      + 'second copy of it, the row\'s own reason, had been left behind' },
  { css: '.probe { column-rule: 1px solid color-mix(in srgb, black 50%, white); }', refused: false,
    why: 'BLIND SPOT: the same, inside a classified colour function -- the exact payload of '
      + 'Stadiora/Aria#10632 finding 1' },
  { css: '.probe { column-rule-color: magenta; }', refused: true,
    why: 'the -color longhand of a stemless shorthand IS caught: the stem is in its name' },
  { css: '.probe { filter: url(#f); }', refused: true,
    why: 'the URL form of a filter: an unclassified function is refused on every property, and '
      + 'this is the syntax the sheet names beside drop-shadow() (RV27-2 -- the sheet claimed '
      + 'both were RUN while only drop-shadow() was)' },
  { css: '.probe { color: var(--cyan); }', refused: false, why: 'a token is what it is for' },
  { css: '.probe { white-space: nowrap; }', refused: false,
    why: 'the reader splits declarations rather than grepping: "white-space" is not white' },
];

test('the reader refuses what READER_PROBES says it refuses, and walks past what it says it misses',
  () => {
    const got = READER_PROBES.map((probe) => {
      const { found, unclassified } = readPaint(probe.css);
      return { css: probe.css, refused: found.length > 0 || unclassified.length > 0 };
    });
    assert.deepEqual(got, READER_PROBES.map((p) => ({ css: p.css, refused: p.refused })),
      'the reader no longer catches what this file says it catches, or no longer misses what '
      + 'it says it misses');

    const counts = {
      probes: got.length,
      refused: got.filter((g) => g.refused).length,
      blindSpots: READER_PROBES.filter((p) => /^BLIND SPOT/.test(p.why)).length,
    };
    assert.deepEqual(counts, { probes: 16, refused: 9, blindSpots: 5 });
    assert.deepEqual(
      READER_PROBES.filter((p) => /^BLIND SPOT/.test(p.why) && p.refused).map((p) => p.css), [],
      'a row is written down as a blind spot while the reader catches it, so the disclosure '
      + 'is worse than the guard');
    console.log('reader probes judged: ' + JSON.stringify(counts));

    /* The paragraph at pane-alerts-v2.css:36-40 NAMES the stemless properties
       a keyword walks past on. Citing the test by title binds that this test
       exists; it does not bind that list, so the list is read out of the sheet
       and deepEqual to the rows marked `stemless`. Removing one from the sheet,
       or adding one the file never probes, fails here. Shape it misses: the
       sentence has to keep the exact frame "on <list> walks past it" -- rewrite
       that frame and the extraction finds nothing, which is why it asserts the
       match is present before comparing. */
    const frame = PANE_CSS.replace(/\s+/g, ' ')
      .match(/so a keyword on ([a-z-]+(?:, [a-z-]+)*) or ([a-z-]+) walks past it/);
    assert.ok(frame, 'the sheet no longer names the stemless properties in the frame this '
      + 'test reads, so nothing is checking that list');
    const namedBySheet = frame[1].split(', ').concat(frame[2]).sort();
    assert.deepEqual(namedBySheet, READER_PROBES.filter((probe) => probe.stemless)
      .map((probe) => probe.stemless).sort(),
      'the sheet names a stemless property this file never probes, or stops naming one it '
      + 'does -- the prose and the probes have drifted apart');

    /* The OTHER half of the same sentence enumerates PAINT_STEMS, and it was
       unread for exactly as long as the stemless half was: the sheet could
       name a stem the reader does not have, or the reader could lose one the
       sheet names, and nothing moved (found in the fourth review of #75).
       Same device, same frame caveat. */
    const stems = PANE_CSS.replace(/\s+/g, ' ')
      .match(/carries a paint stem \(([a-z, -]+)\), so a keyword/);
    assert.ok(stems, 'the sheet no longer names the paint stems in the frame this test '
      + 'reads, so nothing is checking that list either');
    assert.deepEqual(stems[1].split(', ').sort(), PAINT_STEMS.slice().sort(),
      'the sheet names a paint stem the reader does not use, or the reader uses one the '
      + 'sheet does not name');

    /* And the CUSTOM-property half of it, which is the half the sentence got
       wrong: until round 27 it said keywords were looked for ONLY where the
       name carries a stem, while paints() reads every custom property and
       the probe below asserts `--acc: magenta` is read. The quantifier was
       bound by nothing -- rewording it stayed green (RV26-3). What replaced
       it is two-sided: the sheet must say custom properties are read, and
       the reader must actually read one. Neither side is computed from the
       other. */
    const custom = PANE_CSS.replace(/\s+/g, ' ')
      .match(/looks for on every CUSTOM property \(any name starting with two dashes/);
    assert.ok(custom, 'the sheet no longer says custom properties are read, so the half of '
      + 'the reader that reads them is described nowhere');
    assert.equal(paints('--anything-at-all'), true,
      'the sheet says a colour keyword is looked for on every custom property and the reader '
      +       'no longer looks on one');

    /* And the `filter` clause, the third sentence in this paragraph that was
       true of one member and claimed for two. It names both syntaxes that
       carry a colour to filter and says every one of them is a case that
       gets RUN -- while READER_PROBES ran drop-shadow() and nothing ran the
       URL form (RV27-2). Two-sided the same way: the sheet must name the
       pair in this frame, and READER_PROBES must hold a filter row for each
       member of it, each one typed refused (what the reader really answers
       for those rows is bound by the probe test itself, not here).

       The URL half is matched as PROSE and mapped to `url()` in code,
       because the sheet cannot spell `url(` -- a guard below reds it for
       growing one. That literal is the one thing here not read out of the
       sheet; rewording the clause it stands for unmatches the frame and reds
       rather than passing. Shapes this misses: a filter row written as
       anything but `.probe { filter: <fn>( ... `, and a third syntax the
       sheet might name in some other sentence. */
    const FILTER_CLAUSE = new RegExp('both syntaxes that bring a colour to it — '
      + '([a-z-]+\\(\\)), and a URL reference to an SVG filter that paints one — '
      + 'are unclassified functions');
    const bothSyntaxes = PANE_CSS.replace(/\s+/g, ' ').match(FILTER_CLAUSE);
    assert.ok(bothSyntaxes, 'the sheet no longer names the two filter syntaxes in the frame '
      + 'this test reads, so nothing is checking that both of them are run');
    const filterRows = READER_PROBES
      .filter((probe) => /filter: [a-z-]+\(/.test(probe.css))
      .map((probe) => ({ fn: /filter: ([a-z-]+)\(/.exec(probe.css)[1] + '()',
        refused: probe.refused }));
    assert.deepEqual(filterRows.map((row) => row.fn).sort(),
      [bothSyntaxes[1], 'url()'].sort(),
      'the sheet names a filter syntax READER_PROBES never runs, or this file runs one the '
      + 'sheet does not name -- the sentence says every one of them gets RUN');
    assert.deepEqual(filterRows.map((row) => row.refused), filterRows.map(() => true),
      'the sheet says both filter syntaxes are refused as unclassified functions and a probe '
      + 'row says one of them is not');
  });

/* Every atom this sheet paints with that is NOT a token aria.css declares,
   one entry per site, and the function each one sits inside. deepEqual, so a
   new one fails the suite rather than joining the list quietly -- and so does
   removing one, or moving one out of its color-mix(). */
const NON_TOKEN_PAINT = [
  { selector: '.av', property: 'color', atom: 'black', inside: 'color-mix' },
  { selector: '.p-detail', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.p-close', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw:checked', property: 'background', atom: 'transparent', inside: 'color-mix' },
  { selector: '.sw:checked', property: 'box-shadow', atom: 'transparent', inside: 'color-mix' },
];

/* How the docblock spells one of those sites: "black in color-mix()", or the
   bare atom if it is ever painted on its own. The docblock's own line is
   deepEqual to the distinct set of these, so the sentence about WHERE the
   sheet's `transparent` lives cannot drift from the sheet. */
const spell = (site) => (site.inside ? site.atom + ' in ' + site.inside + '()' : site.atom);

/* Generated, and the sheet cites it by this exact text, so the sheet's
   citation goes red when NON_TOKEN_PAINT changes size. SHEET_CITATIONS adds
   this one in rather than typing it -- but measured (M4-P4 on #75), typing it
   out is ALSO caught, by the half of the citation test that requires a cited
   title to be registered: grow the list and the typed 6 stops resolving. So
   generating it removes a place to drift, it is not the only thing holding
   that property. */
const NON_TOKEN_PAINT_TITLE = 'every colour this sheet paints is a token aria.css declares, '
  + 'bar the ' + NON_TOKEN_PAINT.length + ' sites named here';

test(NON_TOKEN_PAINT_TITLE,
  () => {
    for (const quoted of PANE_CSS.match(/'[^'\n]*'|"[^"\n]*"/g) || []) {
      assert.ok(!/[;{}]/.test(quoted),
        'a quoted string carries a brace or a semicolon, which declarations() splits on: '
        + quoted);
    }
    assert.ok(!/\burl\(/i.test(PANE_CSS), 'the sheet grew a url(), which declarations() cannot read');

    const decls = declarations(PANE_CSS);
    assert.ok(decls.length > 150, 'the reader found only ' + decls.length + ' declarations');

    const { found, functions } = readPaint(PANE_CSS);

    assert.deepEqual(functions, FUNCTIONS,
      'the sheet calls a function this test has not classified; every colour function '
      + 'arrives here first');
    assert.deepEqual(found, NON_TOKEN_PAINT,
      'the sheet paints with something that is not a token aria.css declares, or paints one '
      + 'of the exceptions somewhere other than inside the function the docblock names');

    /* And the sheet's own docblock says the same thing in words. It is read
       out of the comment rather than believed, because a docblock that claims
       one thing while the rules below it do another is what filed
       Stadiora/Aria#10460 in the first place. */
    const claimed = machineLine('NON-TOKEN PAINT').exec(PANE_CSS);
    assert.ok(claimed, 'the sheet\'s docblock no longer names what it paints outside the tokens');
    assert.deepEqual(
      claimed[1].split(',').map((s) => s.trim()).filter(Boolean).sort(),
      [...new Set(NON_TOKEN_PAINT.map(spell))].sort(),
      'the docblock names a different set of non-token paint than the sheet uses');
  });

test('every token this sheet paints with is one aria.css actually declares', () => {
  const declared = new Set(
    declarations(ARIA_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));
  const own = new Set(
    declarations(PANE_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));
  assert.ok(declared.size > 20, 'aria.css declared only ' + declared.size + ' custom properties');

  const missing = [];
  for (const d of declarations(PANE_CSS)) {
    for (const atom of atomsOf(d.value)) {
      const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(atom);
      if (!ref || declared.has(ref[1]) || own.has(ref[1])) continue;
      missing.push(d.selector + ' { ' + d.property + ': ' + d.value + ' }');
    }
  }
  assert.deepEqual(missing, [],
    'a rule asks for a custom property nothing declares, so it paints its fallback or nothing');
});

/* The sheet says its three status-ink rules exist because aria.css declares
   .acc-bad and .acc-warn but no blue, so info problems need one declared
   here. Every clause of that is checkable, and none of it was checked
   (independent review of antonyrugama/aria-website#75). */
test('the accent this sheet adds is the one aria.css leaves out', () => {
  const accents = (css) => new Set(declarations(css)
    .filter((d) => /^\.acc-[\w-]+$/.test(d.selector) && d.property === '--acc')
    .map((d) => d.selector));

  const fromAria = accents(ARIA_CSS);
  const fromHere = accents(PANE_CSS);
  for (const named of ['.acc-bad', '.acc-warn']) {
    assert.ok(fromAria.has(named),
      'the comment says aria.css declares ' + named + ' and it does not');
    assert.ok(!fromHere.has(named), named + ' is declared here as well as in aria.css');
  }
  assert.deepEqual([...fromHere], ['.acc-blue'],
    'this sheet declares accents other than the blue it says it adds');
  assert.ok(!fromAria.has('.acc-blue'),
    'aria.css declares .acc-blue after all, so this sheet is copying it rather than adding it');
});

/* "The accent down a problem card, the ink on its title and the glyph beside
   it are three sightings of one fact." Asserted on the drawn page rather than
   on the JS that draws it: whatever severity a card carries, its accent class
   and both of its ink classes have to name the SAME tone. */
test('a problem card carries one severity, in the accent and both inks alike', async () => {
  /* Three severities at once: one tone agreeing with itself proves nothing
     about a mapping, and the fixture's default is a single card. */
  const dom = await boot({
    open: { problems: [
      problem({ id: 'prb_c', reference: 'AO-801', severity: 'critical' }),
      problem({ id: 'prb_w', reference: 'AO-802', severity: 'warning' }),
      problem({ id: 'prb_i', reference: 'AO-803', severity: 'info' }),
    ] },
  });
  const accentOf = { 'acc-bad': 'crit', 'acc-warn': 'warn', 'acc-blue': 'info' };
  const inkOf = { 'is-crit': 'crit', 'is-warn': 'warn', 'is-info': 'info' };
  const named = (node, map) => ((node.getAttribute && node.getAttribute('class')) || '')
    .split(/\s+/).map((c) => map[c]).filter(Boolean);

  const cards = problemCards(dom);
  assert.ok(cards.length >= 2, 'the fixture draws ' + cards.length + ' problem cards, so this '
    + 'cannot see whether different severities agree with themselves');

  const seen = cards.map((card) => {
    const inks = findAll(card, (n) => named(n, inkOf).length).flatMap((n) => named(n, inkOf));
    return {
      accent: named(card, accentOf),
      inkSightings: inks.length,
      tones: [...new Set([...named(card, accentOf), ...inks])],
    };
  });
  assert.deepEqual(seen.filter((s) => s.accent.length !== 1).map((s) => s.accent), [],
    'a problem card carries no accent tone, or more than one');
  assert.deepEqual(seen.filter((s) => s.inkSightings < 2).map((s) => s.inkSightings), [],
    'a problem card shows fewer than the two inks the sheet says it draws');
  assert.deepEqual(seen.filter((s) => s.tones.length !== 1).map((s) => s.tones), [],
    'a problem card shows more than one severity between its accent and its inks');
  assert.ok(new Set(seen.map((s) => s.tones[0])).size >= 2,
    'every card on the fixture is the same severity, so agreeing proves nothing');
});

/* "A real checkbox carrying role=\"switch\", so it is focusable, announced
   with its state and named by the rule it belongs to." Three separate facts
   about a control this sheet styles, and the whole set could be deleted from
   the JS with the suite green (independent review of
   antonyrugama/aria-website#75). */
test('every rule switch is a real checkbox, reachable, stateful and named', async () => {
  const dom = await boot({ role: 'owner' });
  const rows = ruleRows(dom).filter((row) => withClass(row, 'sw').length);
  assert.ok(rows.length >= 2, 'the fixture draws ' + rows.length + ' rule switches');

  for (const row of rows) {
    const sw = withClass(row, 'sw')[0];
    assert.equal(sw.tagName, 'INPUT', 'the switch is not an input');
    assert.equal(sw.getAttribute('type'), 'checkbox', 'the switch is not a checkbox');
    assert.equal(sw.getAttribute('role'), 'switch', 'the checkbox is not exposed as a switch');
    assert.ok(focusable(sw), 'an owner cannot tab to a rule switch');
    assert.equal(typeof sw.checked, 'boolean',
      'the switch carries no state for a screen reader to announce');

    /* Named by the rule it belongs to: the label has to contain the rule's
       own title, which is the .t-main of the row it sits in. */
    const name = sw.getAttribute('aria-label');
    assert.ok(name && name.trim(), 'a rule switch has no accessible name');
    const title = allText(withClass(row, 't-main')[0] || row).trim();
    assert.ok(title.length > 0 && name.includes(title),
      'the switch is named "' + name + '", which does not name the rule "' + title + '"');
  }
});

/* Layout rules in the sheet that are justified by facts about what
   assets/pane-alerts.js draws -- the rules table's columns, the condition
   pill's words being "Still happening", the cards per problem and the fact
   columns -- and every one of those justifications was prose
   (Stadiora/Aria#10632: the first two found in the second review of the fix,
   the last two in the TENTH, still unbound while the sheet claimed every
   unbound claim was enumerated). Delete a column, rename the pill, draw two
   cards for one problem or a fourth fact column, and the sheet goes on
   naming the old shape as the reason its rules exist.

   Both sides are READ, neither is typed. The count in the sheet's own
   sentence is resolved to a number and compared with what the page draws, so
   rewording "Three columns" to "Nine columns" with the citation left in
   place is red here -- which pinning the number in this file could not do,
   and the tenth review demonstrated green at exactly that anchor. */
const COUNT_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/* Words that can be PART of a stated number, which is a wider list than the
   ten this file can resolve: the check below asks what the sheet states, not
   what it can read. `and` is here for "six and twenty", which no sentence in
   the sheet has and every neighbour test would otherwise wave through. */
const NUMBER_ISH = new Set(('zero one two three four five six seven eight nine ten eleven twelve '
  + 'thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty '
  + 'sixty seventy eighty ninety hundred thousand million billion dozen score and').split(' '));

/* The number the SHEET states, at one named site, resolved from its word.
   A pattern that stops matching is a failure, not a zero: the sentence
   moving or being reworded is exactly the drift this reads it to catch. And
   it has to match ONCE -- taking the first of several is how a reader in
   this file has been wrong twice, and the round-11 battery caught it here
   too: /N cards? per problem/ matched the NOT BOUND bullet listing the claim
   before it reached the claim, so the sentence could say three while the
   bullet went on saying one and the page drew one. */
function sheetCount(pattern, says) {
  const prose = PANE_CSS.replace(/\s+/g, ' ');
  const all = [...prose.matchAll(
    new RegExp(pattern.source, pattern.flags.replace(/[gd]/g, '') + 'gd'))];
  assert.equal(all.length, 1, 'pane-alerts-v2.css states ' + JSON.stringify(says) + ' in '
    + all.length + ' places, not one: the sentence this test reads the count out of has '
    + 'moved, been reworded or been duplicated, and nothing is holding it to the page');
  const found = all[0];
  /* What group 1 CAPTURED, not how it is spelled. "Twenty-one" captured by
     (\w+) resolved to 1 while the page drew 1 -- green, and the sheet free
     to state any compound whose tail this table knows (MX-4/5/6, the
     eleventh review of #75). Requiring the spelling `([\w-]+)` was the first
     fix and it was not enough: /\w+-([\w-]+) columns in \d+px/i is spelled
     right, is group 1, and still eats `Sixty-` before the capture starts --
     green with the sheet stating sixty-six and the page drawing six (found
     in the thirteenth review of #75). So the run is required to be WHOLE
     where it sits: nothing word-ish and no hyphen either side of it, which
     is what a maximal `[\w-]` run means and NOT what "the number word the
     sentence states" means -- the two come apart wherever the sheet joins a
     compound with something that is neither (the fourteenth review). It is
     blind to
     whether the pattern ate the rest in a prefix, in a suffix, or inside a
     second group. It says nothing about the shape of the pattern, and a
     pattern with no group 1 at all is refused here rather than crashing. */
  const span = found.indices && found.indices[1];
  assert.ok(Array.isArray(span), 'sheetCount() reads group 1 and was handed a pattern '
    + 'that has none, so nothing can be resolved from it: ' + pattern.source);
  const nextTo = (ch) => /[\w-]/.test(ch || '');
  const context = JSON.stringify(prose.slice(Math.max(0, span[0] - 16), span[1] + 16));
  assert.ok(!nextTo(prose[span[0] - 1]) && !nextTo(prose[span[1]]),
    'pane-alerts-v2.css states ' + context + ' and the pattern for ' + JSON.stringify(says)
    + ' captured only ' + JSON.stringify(prose.slice(span[0], span[1])) + ' of the number '
    + 'word, so a compound the sheet states would resolve to one component of itself');
  /* WHERE the capture is allowed to begin, which the run being whole does
     not settle: three of the four patterns start with the capture itself, so
     `[\w-]+` is free to start at the TAIL component of a compound the sheet
     joins with a space -- "Twenty six columns" resolves to 6, both edges are
     spaces, and 481 tests stay green on a one-word edit to the sheet (found
     in the fourteenth review of #75). What this refuses is exactly one
     thing: a NUMBER_ISH word immediately either side of the capture. That
     covers the spellings the edge test cannot see -- "Sixty\u2011six columns"
     walks past an ASCII edge test and dies here -- which is why widening
     that test to `\p{Pd}` was tried and deleted, no payload having made it
     the thing that fired (M15-B1f). It does NOT cover a modifier that is
     not itself a number word: "Two times six columns", "Half of six
     columns", "Twice one card per problem" and "Double three columns" all
     resolve to the component and are green (the fifteenth review of #75).
     That is on the NOT COVERED list at the top of this file rather than
     chased with a wider word list, because the list would be the claim and
     nothing would bind it. */
  const wordBefore = (prose.slice(0, span[0]).match(/([\w-]+)[^\w-]*$/) || [])[1];
  const wordAfter = (prose.slice(span[1]).match(/^[^\w-]*([\w-]+)/) || [])[1];
  const numberish = (word) => word !== undefined && NUMBER_ISH.has(word.toLowerCase());
  assert.ok(!numberish(wordBefore) && !numberish(wordAfter),
    'pane-alerts-v2.css states ' + context + ' and the pattern for ' + JSON.stringify(says)
    + ' captured ' + JSON.stringify(prose.slice(span[0], span[1])) + ' with a number word '
    + 'beside it, so the sheet states a compound and this resolves one component of it');
  const word = found[1].toLowerCase();
  assert.ok(Object.prototype.hasOwnProperty.call(COUNT_WORDS, word),
    'pane-alerts-v2.css states ' + JSON.stringify(word) + ' where ' + JSON.stringify(says)
    + ' expects a number word, so the count cannot be resolved and compared');
  return COUNT_WORDS[word];
}
test('the rules the sheet justifies by what the page draws name what it draws',
  async () => {
    const dom = await boot({ role: 'owner' });
    const table = withClass(dom.doc.body, 'rules-card')[0];
    assert.ok(table, 'the fixture draws no rules card');
    const head = findAll(table, (n) => n.tagName === 'TR')
      .find((row) => findAll(row, (n) => n.tagName === 'TH').length > 0);
    assert.ok(head, 'the rules table draws no header row');
    const columns = findAll(head, (n) => n.tagName === 'TH').length;
    /* The WIDTH in that sentence is a claim too, and it was typed in prose
       beside a declaration that states it -- change the minimum to 900px and
       the sentence went on reasoning about 760px, with nothing red (found in
       the eleventh review of #75, MX-16). Read from the sheet's own rule, and
       the sentence is then located BY that value, so the two cannot drift
       apart in either direction. */
    const minWidth = declarations(PANE_CSS)
      .filter((d) => d.selector === '.scrollx > .tbl' && d.property === 'min-width');
    assert.equal(minWidth.length, 1,
      'pane-alerts-v2.css declares .scrollx > .tbl { min-width } ' + minWidth.length
      + ' times, so the width its six-columns sentence reasons about is not one value');
    const proseWidth = /in (\d+px) leaves the rule/i.exec(PANE_CSS.replace(/\s+/g, ' '));
    assert.ok(proseWidth, 'pane-alerts-v2.css no longer states the width its six-columns '
      + 'sentence reasons about, so that sentence is held to nothing');
    assert.equal(proseWidth[1], minWidth[0].value,
      'pane-alerts-v2.css reasons about ' + proseWidth[1] + ' of table and declares a '
      + 'minimum of ' + minWidth[0].value);
    /* Width-agnostic on purpose: locating the sentence by the declared value
       would have made a matched pair of edits to sheet and rule fail HERE,
       with a "the sentence has moved" message for a sentence that had not
       moved. The width is bound above, on its own terms. A constructed
       RegExp would also have been a fifth shape the frame count cannot see,
       since HELPER_FRAME_SPELLING reads a literal pattern handed to the
       helper, not a constructed one. */
    assert.equal(columns,
      sheetCount(/([\w-]+) columns in \d+px/i, 'N columns in <width>px'),
      'the rules table draws ' + columns + ' columns, and pane-alerts-v2.css justifies two '
      + 'rules by a different number of them in ' + minWidth[0].value);

    const pill = withClass(dom.doc.body, 'p-live')[0];
    assert.ok(pill, 'no problem on the page is still happening, so nothing carries .p-live');
    const saidWords = /"([^"]+)" wrapping to \w+ words/i.exec(PANE_CSS.replace(/\s+/g, ' '));
    assert.ok(saidWords, 'pane-alerts-v2.css no longer quotes the pill it justifies '
      + 'white-space: nowrap with');
    assert.equal(allText(pill).trim(), saidWords[1],
      'the condition pill reads "' + allText(pill).trim() + '", and pane-alerts-v2.css '
      + 'justifies white-space: nowrap by ' + JSON.stringify(saidWords[1]) + ' wrapping');
    assert.equal(allText(pill).trim().split(/\s+/).length,
      sheetCount(/wrapping to ([\w-]+) words/i, 'wrapping to N words'),
      'the pill reads ' + JSON.stringify(allText(pill).trim()) + ', which is not the number '
      + 'of words pane-alerts-v2.css says wraps');

    /* One card per problem: booted with a KNOWN number of problems, so the
       expectation comes from what was handed in rather than from the page.
       A fixture of one cannot tell "one per problem" from "one, always". */
    const four = await boot({ open: { problems: manyProblems(4) } });
    const list = withClass(four.doc.body, 'p-list')[0];
    assert.ok(list, 'the fixture draws no problem list');
    const cards = withClass(list, 'p-item');
    const perProblem = sheetCount(/([\w-]+) cards? per problem, in a column/i,
      'N cards per problem, in a column');
    assert.equal(cards.length, 4 * perProblem,
      'the page draws ' + cards.length + ' cards for 4 problems, and pane-alerts-v2.css '
      + 'justifies .p-list by there being ' + perProblem + ' card(s) per problem');

    for (const card of cards) {
      const grids = withClass(card, 'p-facts');
      assert.equal(grids.length, 1,
        'a problem card draws ' + grids.length + ' fact grids, not one');
      const columns = withClass(grids[0], 'p-col');
      assert.equal(columns.length,
        sheetCount(/([\w-]+) columns of label-and-value rows/i, 'N columns of label-and-value rows'),
        'a problem card draws ' + columns.length + ' fact columns, and pane-alerts-v2.css '
        + 'justifies .p-facts and .p-col by a different number of them');
    }

    /* "Here it is the chip strip": the sheet moves the hero's THIRD child to
       a row of its own below 980px, and .hero > .hero-chips is the selector
       it does it with. Which child the chip strip is, is a fact about
       pane-alerts.js -- reorder hero() so the chips are appended second and
       the media query moves the wrong element, silently, at a width this
       suite never renders. The child rule needs the strip to be a DIRECT
       child too, so that is asserted rather than inferred from a descendant
       search (found in the eleventh review of #75, MX-17). */
    const hero = withClass(dom.doc.body, 'hero')[0];
    assert.ok(hero, 'the fixture draws no hero');
    const heroKids = (hero.childNodes || []).filter((n) => n.tagName);
    const heroMoves = declarations(PANE_CSS).filter((d) => d.selector === '.hero > .hero-chips');
    assert.ok(heroMoves.length >= 1, 'pane-alerts-v2.css no longer moves .hero > .hero-chips, '
      + 'so the sentence naming the chip strip as the hero child aria.css moves is stale');
    assert.equal(heroKids.length, 3,
      'the hero draws ' + heroKids.length + ' children, and pane-alerts-v2.css reasons about '
      + 'its third');
    assert.ok(((heroKids[2].getAttribute('class') || '').split(/\s+/)).includes('hero-chips'),
      'the hero\'s third child is ' + JSON.stringify(heroKids[2].getAttribute('class'))
      + ', and pane-alerts-v2.css says the child aria.css drops to a row of its own below '
      + '980px is the chip strip');

    /* "label-and-value ROWS": a fact row carries both halves, so the rule
       styling the pair is not styling a single run of text. */
    const rows = withClass(cards[0], 'p-fact');
    assert.ok(rows.length >= 2, 'the first card draws ' + rows.length + ' fact rows');
    for (const row of rows) {
      const label = withClass(row, 'muted')[0];
      const value = withClass(row, 'p-fact-v')[0];
      assert.ok(label && allText(label).trim(), 'a fact row carries no label');
      assert.ok(value && allText(value).trim(), 'a fact row carries no value');
    }
  });

/* The sheet's "Status text takes the -ink variant of its tone, because the
   base colour is the tint and the -ink is the text on that tint." Every .is-
   rule is paired here with the tint aria.css declares beside its ink, so a
   tone painted in its own tint -- the failure the sentence warns about -- is
   a failure rather than a sentence. WHICH tone is its own is the test below
   this one; this one is blind to it, and said so nowhere until the fifteenth
   review of #75 painted critical text amber and watched 73 tests pass. */
test('every status tone here paints the -ink of a tint aria.css also declares', () => {
  const declared = new Set(
    declarations(ARIA_CSS).filter((d) => d.property.startsWith('--')).map((d) => d.property));

  const rules = declarations(PANE_CSS).filter((d) => /^\.is-[\w-]+$/.test(d.selector));
  assert.ok(rules.length >= 3, 'the sheet declares only ' + rules.length + ' status tones');

  const paired = rules.map((d) => {
    const ref = /^var\(\s*(--[\w-]+)-ink\s*\)$/.exec(d.value);
    return {
      selector: d.selector,
      property: d.property,
      tint: ref ? '--' + ref[1].slice(2) : null,
      tintDeclared: !!(ref && declared.has(ref[1])),
      inkDeclared: !!(ref && declared.has(ref[1] + '-ink')),
    };
  });
  assert.deepEqual(paired.filter((p) => p.property !== 'color').map((p) => p.selector), [],
    'a status tone sets something other than the text colour');
  assert.deepEqual(paired.filter((p) => !p.tint).map((p) => p.selector), [],
    'a status tone is painted in something that is not the -ink of a tone');
  assert.deepEqual(paired.filter((p) => !p.tintDeclared || !p.inkDeclared).map((p) => p.selector),
    [], 'a status tone names a tone aria.css does not declare both halves of');
  console.log('status tones judged: ' + JSON.stringify({
    tones: paired.length, pairs: paired.filter((p) => p.tintDeclared && p.inkDeclared).length,
  }));
});

/* WHICH tone is a severity's own, which the test above is blind to. The
   pairing is read off the DRAWN card -- the accent class the page puts on it
   and the ink classes inside it -- and never from a map typed here, because
   an expectation derived from the thing under test moves with the mutation.
   Paint .is-crit in --amber-ink and this is the test that goes red.
   What is read off the card is its CLASSES; what each class declares is read
   out of the sheets the page loads, and the cascade between them is not
   modelled (NOT COVERED, at the top of this file). */
/* Every reader in this file compares BYTES; the browser compares tokens it
   has already decoded. Four reviews running found a spelling that is the
   same thing to a parser and a different string here -- `:is(.acc-bad)`,
   then `<link href= rel=>`, then a `>` inside a quoted value, then
   `--ac\63`, `@\69 mport` and `rel="&#115;tylesheet"` in one round (RV20-1,
   RV20-2, RV20-3). Closing them one spelling at a time is what those four
   rounds did, and each fix was beaten on the axis next door.

   So this refuses the whole class instead of following it. A CSS escape can
   appear in ANY ident -- a property name, an at-keyword, a function, a
   class -- so no sheet the page loads may hold a backslash anywhere, and a
   character reference can appear in any attribute value, so no `&` may
   survive the numeric decode above. Neither is an understanding of what the
   escape MEANT; both are this file saying it cannot read one.

   The price is stated plainly because it is real: a legitimate
   `content: "\201C"` in aria.css, or an `&amp;` in this page's prose, reds
   this test until a person decides what the readers here should do about
   it. That is the loud direction. The quiet direction is what the last four
   reviews kept finding. */
test('no sheet the page loads spells an ident with an escape, and no character reference '
  + 'in the page survives the decoder', () => {
  assert.deepEqual(WALK_REFUSALS, [],
    'the document walk refused to model a shape in this page, so nothing below may read a '
    + 'node out of it: PAGE_SHEETS is the walk\'s answer, and a sheet it never saw holds no '
    + 'escape and spells no reference here no matter what is written in it');
  assert.deepEqual(PAGE_SHEETS.filter((href) => read(href).includes('\\')), [],
    'a sheet the page loads holds a CSS escape, and every reader in this file compares the '
    + 'bytes of a property name, a selector and an at-keyword against a literal: `--ac\\63` '
    + 'is `--acc` to the browser, `@\\69 mport` is `@import`, and neither holds its letters '
    + 'in a row. This file cannot decode one, so it refuses to read the sheet that has it');
  assert.equal(decodeRefs(RAW_HTML).includes('&'), false,
    'the page holds a character reference this reader cannot resolve -- a named one like '
    + '`&amp;`, or a numeric one missing its `;` -- and the parser resolves references inside '
    + 'an attribute value where decodeRefs leaves them alone: an href or a rel that spells '
    + 'one is read here as bytes the browser never sees');
});

/* How many tests read the walk, counted by MACHINE rather than typed into a
   sentence. Two docblocks above said "both tests that read the walk assert
   the refusal list is empty"; there were three, and the third -- the escape
   and character-reference test right above this one -- asserted nothing of
   the kind. The sentence was not merely unproven, it was untrue, and
   re-typing it as "three" would leave the next reader in exactly the same
   position (the thirtieth review of #75, finding 2).

   So no number is typed in prose any more. The reader set is derived here
   from this file's own source: seed with nodesOf(), take the fixpoint of
   top-level definitions that mention something already in the set, and a
   test is a READER if its text names one of them. What the shape misses,
   said plainly: it sees top-level statements and top-level comment blocks
   that begin at column 0 -- a docblock is its own statement here, so prose
   above a definition cannot leak into it -- and it sees the GATE only as
   the literal `assert.deepEqual(WALK_REFUSALS, []` -- a gate written any
   other way reds this test rather than passing it, and a test that merely
   mentions a name in a comment inside its own body is counted as a reader
   and has to carry the gate. Both of those are the loud direction.

   NOT COVERED, and deliberately not enumerated: the reads this CANNOT see.
   A sentence here named one shape -- a read from inside a nested function
   defined in another test -- and called it THE quiet direction, which is a
   claim that a list of blind spots is complete. That list was not complete:
   a test is seen at all only when its registration begins at column 0 with
   `test(`, so a test registered any other way is absent from the set this
   walks and carries no gate whether it reads the walk or not. The sentence
   is deleted rather than extended with the shapes found since, because the
   shape that matters is the one nobody has thought of yet, and thirty
   rounds on this file have been that lesson one spelling at a time. */
test('every test that reads the document walk asserts the walk refused nothing', () => {
  assert.deepEqual(WALK_REFUSALS, [],
    'the document walk refused to model a shape in this page, and this test is itself a '
    + 'reader of it: the set it derives below is the walk\'s own output');
  const lines = THIS_FILE.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    if (/^(const|let|var|function|class|test|describe|\/\*)/.test(l)) heads.push(i);
  });
  const stmts = heads.map((at, k) => ({
    at,
    text: lines.slice(at, k + 1 < heads.length ? heads[k + 1] : lines.length).join('\n'),
  }));
  const walkNames = new Set(['nodesOf']);
  for (let pass = 0; pass < 12; pass += 1) {
    for (const s of stmts) {
      const name = (s.text.match(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/)
        || [])[1];
      if (!name || walkNames.has(name)) continue;
      const rhs = s.text.slice(s.text.indexOf('=') + 1);
      if ([...walkNames].some((w) => new RegExp('\\b' + w + '\\b').test(rhs))) walkNames.add(name);
    }
  }
  const titleOf = (s) => (s.text.match(/^test\(\s*'([^']*)'/) || ['', s.text.slice(0, 60)])[1];
  const tests = stmts.filter((s) => /^test\(/.test(s.text));
  const readers = tests.filter((s) => [...walkNames]
    .some((w) => new RegExp('\\b' + w + '\\b').test(s.text)));
  const ungated = readers.filter((s) => !s.text.includes('assert.deepEqual(WALK_REFUSALS, []'));
  assert.deepEqual(ungated.map((s) => titleOf(s) + ' (line ' + (s.at + 1) + ')'), [],
    'a test reads a value the document walk produced without first asserting the walk refused '
    + 'nothing, so on a page the walk cannot tokenise it reads a node the parser never built '
    + 'and passes. Add `assert.deepEqual(WALK_REFUSALS, [], ...)` to it, or stop reading the '
    + 'walk in it');
  /* `gated` was a fourth field here, readers.length - ungated.length. It could
     not fail: the assertion above throws unless ungated is empty, so by this
     line it always equalled readers. An expectation derived from something
     already asserted is not a second check, and a number that cannot move
     reads as one. Deleted rather than kept for symmetry. */
  const counts = {
    walkNames: walkNames.size,
    tests: tests.length,
    readers: readers.length,
  };
  assert.deepEqual(counts, { walkNames: 8, tests: 77, readers: 4 },
    'the shape of this file moved under the reader census: ' + JSON.stringify(counts) + '. '
    + 'That is not a failure by itself -- it is this count refusing to be a sentence nobody '
    + 'checks. Read the numbers, and if they are right, write them here');
  console.log('walk readers judged: ' + JSON.stringify(counts));
});

test('the ink on a severity is the -ink of the accent that severity draws', async () => {
  const dom = await boot({
    open: { problems: [
      problem({ id: 'prb_c', reference: 'AO-811', severity: 'critical' }),
      problem({ id: 'prb_w', reference: 'AO-812', severity: 'warning' }),
      problem({ id: 'prb_i', reference: 'AO-813', severity: 'info' }),
    ] },
  });
  const classesOf = (n) => (((n.getAttribute && n.getAttribute('class')) || '').split(/\s+/));
  /* The parsed sheet list against the list a PERSON typed, rather than
     against a second reading of the same text. What stood here was a count
     of `rel\s*=\s*...` matches over the decoded page, compared with
     PAGE_SHEETS.length and described as counting "off the raw text" so the
     two readings could not agree with each other about a tag neither had.
     They agreed anyway: `&#114;el="stylesheet"` on the aria.css link is not
     `rel=` to either of them, the page loads with NO design system, and both
     sides counted three (the twenty-eighth review of #75; re-measured in
     Chrome in round 29 -- the page renders unstyled and 76 tests were
     green). The typed list cannot move with the reader, and it pins ORDER
     and SPELLING as well as count, which the equality of two lengths never
     did.

     Deleted with it, as things this no longer needs to refuse: the
     odd-quote check, because the walk cannot cut a tag in half -- a quote
     left open runs to the next `"` in the document, as the parser's does,
     and a tag that reaches EOF without closing is dropped by both, which
     reds here; and the duplicate `href=`/`rel=` refusal, because the walk
     resolves a
     duplicate attribute the way the parser does, keeping the first
     (measured in Chrome, round 28), and `data-href` is an attribute named
     `data-href` to it rather than a boundary problem. A refusal that can no
     longer fire is prose claiming a guard. */
  assert.deepEqual(WALK_REFUSALS, [],
    'the document walk refused to model a shape in this page, so nothing below may read a '
    + 'node out of it: a reader that cannot tell where an element ENDS can invent a tag the '
    + 'parser never built, and inventing one is the direction that ships a page with no policy '
    + 'while this file says it has one');
  assert.deepEqual(PAGE_SHEETS, V2_STYLESHEETS,
    'the sheets this reads out of ops/alerts.html are not the three the page is meant to '
    + 'load, in order: ' + JSON.stringify(PAGE_SHEETS) + ' against '
    + JSON.stringify(V2_STYLESHEETS) + '. Either the page changed, or a <link> in it is '
    + 'spelt in a way this walk reads differently from the browser -- and the rules every '
    + 'assertion below resolves come out of exactly these files');
  assert.deepEqual(PAGE_SHEETS.filter((href) => !href || !existsSync(new URL(href, OPS))), [],
    'the page links a stylesheet this cannot open on disk, so it is read as no declarations '
    + 'at all rather than as the rules it holds');
  assert.deepEqual(PAGE_SHEETS.filter((href) => /@import/i.test(read(href))), [],
    'a sheet the page loads pulls in another sheet with @import, whose rules the browser '
    + 'applies and declarations() discards, so what this resolves is not what the page paints');
  const both = PAGE_SHEETS.flatMap((href) => declarations(read(href))
    .map((d) => ({ ...d, sheet: href })));
  /* Every rule that paints --acc, in every sheet the page loads, listed by
     hand. INVERTED on purpose: the reader does not decide which rules are
     about a severity class, it requires the set of accent painters to be
     exactly this one, so a rule spelled any other way -- `:is(.acc-bad)`,
     `.acc\-bad`, `.\61 cc-bad`, `[class*='cc-bad']`, or `.p-item` naming no
     severity at all -- is a failure for being on no list rather than for
     being understood. Three consecutive reviews of #75 found a spelling the
     previous round's understanding missed; a list cannot be out-spelt. The
     price is that a NEW accent anywhere in the design system reds this until
     it is added here, which is the direction that fails loudly. */
  const ACCENT_PAINTERS = ['.acc-acc', '.acc-bad', '.acc-blue', '.acc-ok', '.acc-vio',
    '.acc-warn'];
  assert.deepEqual([...new Set(both.filter((d) => d.property === '--acc')
    .map((d) => d.selector))].sort(), ACCENT_PAINTERS,
    'the sheets the page loads paint --acc from a rule that is not on ACCENT_PAINTERS, so '
    + 'the accent a severity card draws may be decided somewhere this test never resolves; '
    + 'add it after checking it cannot repaint a severity');
  /* Per ROLE, not one pattern for both: a lazy `(--[\w-]+?)(-ink)?` strips
     the suffix off whichever side it is handed, so an accent painted in its
     own -ink agreed with the ink and the card's whole stripe changed colour
     in both themes with 482 tests green (found in the sixteenth review of
     #75). The tint side must NOT end in -ink and the ink side must, which is
     what "the -ink of" means and is the shape the neighbouring status-tone
     test already used. */
  /* Every rule in every loaded sheet that NAMES this class and paints this
     property, not only the one whose selector is spelled exactly `.acc-bad`.
     The cascade is not modelled -- that way lies a specificity engine in a
     test file -- so the invariant is the stricter and simpler one: a second
     rule naming the class is a failure whatever it would have won, which is
     what the round-17 lookup could not see. `.p-item.acc-bad { --acc }` and
     the same rule in a third sheet both changed the colour of every card's
     rail in a real browser with 482 tests green (found in the seventeenth
     review of #75).

     names() only recognises the class as a whole ATOM of a compound, so
     `:is(.acc-bad)`, `:is(.y, .acc-bad)` and `[class~='acc-bad']` were all
     answered "not about your class" and repainted the rail with 75 tests
     green (found in the eighteenth review of #75). Silently answering the
     shapes it cannot parse is the unsafe direction, so the shapes it cannot
     parse are REFUSED instead: any selector that MENTIONS the class as a
     token while names() denies it is a failure naming the selector.

     That was written here as a closed set, and the next review opened it:
     `.acc\-bad` and `.\61 cc-bad` are the same class to a browser and hold
     none of its letters in a row, so they were neither named nor mentioned
     nor refused (found in the nineteenth review of #75, RV19-1a/1b). The
     lesson taken is not a better decoder. --acc stopped being decided by
     this reader at all, above, and what remains here is a third REFUSAL on
     the two characters this reader cannot follow: a backslash, which starts
     an escape, and `[class`, which tests the attribute rather than naming a
     class. What stays invisible on the ink side is a rule that mentions the
     class nowhere in its text -- by element, by some other class, or by an
     attribute that is not `class` -- and that is on the NOT COVERED list. */
  const names = (selector, cls) => selector.split(/[\s>+~,]+/).some((part) =>
    part.split(/(?=[.:#[])/).some((atom) => atom === cls));
  const mentions = (selector, cls) =>
    new RegExp('(?<![\\w-])' + cls.slice(1) + '(?![\\w-])').test(selector);
  const resolve = (selector, property, wantInk) => {
    assert.deepEqual(both.filter((d) => d.property === property
      && mentions(d.selector, selector) && !names(d.selector, selector))
      .map((d) => d.sheet + ' ' + d.selector), [],
      selector + ' is mentioned by a ' + property + ' rule whose selector this reader cannot '
      + 'take apart -- a class inside :is(), :where() or an attribute test is not an atom of '
      + 'a compound -- so it is refused rather than answered as a rule about some other class');
    assert.deepEqual(both.filter((d) => d.property === property
      && /\\|\[class/.test(d.selector)).map((d) => d.sheet + ' ' + d.selector), [],
      'a ' + property + ' rule is selected by a CSS escape or by testing the class ATTRIBUTE, '
      + 'and this reader decodes neither, so which class it paints is refused rather than '
      + 'answered from the letters that happen to be in it');
    const found = both.filter((d) => names(d.selector, selector) && d.property === property);
    assert.equal(found.length, 1, selector + ' is painted ' + property + ' by ' + found.length
      + ' rules across the sheets the page loads (' + (found.map((d) => d.sheet + ' '
      + d.selector).join(', ') || 'none') + '), so the tone it names is not one value');
    assert.equal(found[0].selector, selector, selector + '\'s only ' + property + ' comes from '
      + found[0].sheet + ' ' + found[0].selector + ', which is a different rule wearing the '
      + 'same class, so what the card draws is not what this class declares');
    const ref = (wantInk ? /^var\(\s*(--[\w-]+)-ink\s*\)$/ : /^var\(\s*(--[\w-]+)\s*\)$/)
      .exec(found[0].value);
    assert.ok(ref && !(!wantInk && /-ink$/.test(ref[1])),
      selector + ' paints ' + JSON.stringify(found[0].value) + ', which is not '
      + (wantInk ? 'the -ink of a token' : 'a tint token') + ', so the sheet\'s sentence '
      + 'about -ink variants is not true of it');
    return ref[1];
  };

  const cards = problemCards(dom);
  assert.ok(cards.length >= 3, 'the fixture draws ' + cards.length + ' problem cards, so this '
    + 'cannot see whether DIFFERENT severities each take their own tone');

  const seen = cards.map((card) => {
    const accent = classesOf(card).filter((c) => /^acc-[\w-]+$/.test(c));
    assert.equal(accent.length, 1, 'a problem card draws ' + accent.length + ' accent classes');
    const inks = [...new Set(findAll(card, (n) => classesOf(n).some((c) => /^is-[\w-]+$/.test(c)))
      .flatMap((n) => classesOf(n).filter((c) => /^is-[\w-]+$/.test(c))))];
    assert.ok(inks.length, 'the ' + accent[0] + ' card draws no status ink at all');
    const tone = resolve('.' + accent[0], '--acc', false);
    return { card: accent[0], tone,
      wrong: inks.filter((c) => resolve('.' + c, 'color', true) !== tone) };
  });
  assert.deepEqual(seen.filter((r) => r.wrong.length).map((r) => r.card + ' draws '
    + r.wrong.join(' ') + ' over ' + r.tone), [],
    'a severity paints its text in the -ink of a tone other than the accent that severity '
    + 'draws, so the sheet names one severity in two colours');
  assert.equal(new Set(seen.map((r) => r.tone)).size, seen.length,
    'two severities draw the same accent token, so agreeing with themselves proves nothing');
  console.log('severity inks judged: ' + JSON.stringify({
    cards: seen.length, tones: [...new Set(seen.map((r) => r.tone))].length,
  }));
});

/* Both files point at sibling tools by filename -- the sheet at
   scripts/check-ops-narrow-overflow.mjs for the 375px measurement it does not
   make, this file at scripts/check-ops-contrast.mjs for the contrast it
   cannot judge. Neither pointer resolved: renaming both tools left 482 tests
   green (found in the seventeenth review of #75). Same class the eighth
   review closed for UPPER_SNAKE pointers with SHEET_POINTER_SHAPE.

   The two sides are counted SEPARATELY. A union against a floor is satisfied
   by this file's own docblock, three lines up, so the sheet could stop
   pointing anywhere at all and the test stayed green while its message went
   on claiming otherwise (found in the eighteenth review of #75). The sheet
   side is really held -- renaming the sheet's pointer reds. The GUARD side
   is not: this file's own comments name sibling scripts in several places,
   including this one, so that floor can only fall if a comment is edited,
   and it is a floor rather than a claim (noted by the nineteenth review,
   which declined to file it for want of a mutation that isolates it). */
test('every script this file and the sheet point at is a script that exists', () => {
  const named = (text) => [...text.matchAll(/scripts\/([\w.-]+\.mjs)/g)].map((m) => m[1]);
  const fromSheet = [...new Set(named(PANE_CSS))];
  const fromGuard = [...new Set(named(THIS_FILE))];
  assert.ok(fromSheet.length, 'the sheet points at no sibling script at all, so this is '
    + 'watching one side of a pair of files and calling it both');
  assert.ok(fromGuard.length, 'this file points at no sibling script at all, so this is '
    + 'watching one side of a pair of files and calling it both');
  const pointers = [...new Set([...fromSheet, ...fromGuard])];
  const missing = pointers.filter((name) =>
    !existsSync(new URL('../scripts/' + name, OPS)));
  assert.deepEqual(missing, [], 'a file points at a script that does not exist, so the reader '
    + 'it sends someone to for the thing neither file measures is a dangling name');
  console.log('script pointers judged: ' + JSON.stringify({
    pointers: pointers.length, fromSheet: fromSheet.length, fromGuard: fromGuard.length,
  }));
});

/* --------------------------------------------- the one exception, and its reason */

/* WCAG relative luminance and contrast ratio, sRGB. Proved against two
   published figures before anything below is believed. */
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c) =>
  0.2126 * channel(c[0] / 255) + 0.7152 * channel(c[1] / 255) + 0.0722 * channel(c[2] / 255);
const ratio = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)]
    : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const rgbOf = (hex) => {
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((c) => c + c).join('') : body;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
/* CSS color-mix(in srgb, ...) and linear-gradient() both interpolate in
   gamma-encoded sRGB, which is componentwise on the 0-255 values. */
const blend = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

/* The two theme blocks aria.css declares, with one level of var() resolved:
   the dark theme writes --cyan-ink: var(--cyan) and the light one writes a
   hex. A token that is not an opaque hex -- --line is an rgba() -- comes back
   null.

   `readable` is the set the AA sweep below can actually try: a null is NOT a
   rejection, and scoring it as one is how the sweep used to report "no token
   could have made this ink" while never having looked at thirteen of them.
   UNREADABLE_TOKENS names every one it cannot read, so a new token in a
   spelling this resolver does not handle fails the suite instead of being
   silently counted as tried (found in the fourth review of
   antonyrugama/aria-website#75, with --rv-stand: rgb(0, 0, 0) -- the same
   colour as #000000, which IS read and DOES stand in). */
function themeTokens(css) {
  const rows = declarations(css).filter((d) => d.property.startsWith('--'));
  const of = (selector) => new Map(
    rows.filter((d) => d.selector === selector).map((d) => [d.property, d.value]));
  const dark = of(':root');
  const light = new Map([...dark, ...of('[data-theme="light"]')]);
  const resolve = (table, name, depth) => {
    const raw = table.get(name);
    if (!raw || (depth || 0) > 4) return null;
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
    if (ref) return resolve(table, ref[1], (depth || 0) + 1);
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? rgbOf(raw) : null;
  };
  const names = [...new Set([...dark.keys(), ...light.keys()])];
  return {
    names,
    raw: (theme, name) => (theme === 'light' ? light : dark).get(name),
    readable: names.filter((name) => resolve(dark, name) && resolve(light, name)),
    dark: (name) => resolve(dark, name),
    light: (name) => resolve(light, name),
  };
}

/* Every token aria.css declares that the resolver above cannot turn into a
   colour, and why. deepEqual, so adding a token in an unhandled spelling is a
   red suite rather than a silent drop. No ordinal here: the one that stood
   here said "a thirteenth" while the list held thirteen, so the next drop
   would have been the fourteenth -- wrong from the commit that wrote it and
   through five reviews, found in the tenth.

   The `why` is not decoration. Each one is checked against the class the
   DECLARED VALUE falls in ("every reason UNREADABLE_TOKENS gives is the
   class its declared value is in"), so the ones whose reason says they are
   translucent rgba() really are colours CSS would take in a color-mix():
   they are here because the resolver reads opaque hex only, not because the
   mix would refuse them. */
const UNREADABLE_TOKENS = [
  { name: '--line', why: 'a colour, but a translucent rgba()' },
  { name: '--line-2', why: 'a colour, but a translucent rgba()' },
  { name: '--edge', why: 'a colour, but a translucent rgba()' },
  { name: '--shadow-1', why: 'a shadow list: offsets, a blur and an rgba()' },
  { name: '--shadow-2', why: 'a shadow list, two of them' },
  { name: '--shadow-3', why: 'a shadow list, two of them' },
  { name: '--r-sm', why: 'a length' },
  { name: '--r', why: 'a length' },
  { name: '--r-lg', why: 'a length' },
  { name: '--r-xl', why: 'a length' },
  { name: '--rail', why: 'a length' },
  { name: '--sans', why: 'a font stack' },
  { name: '--mono', why: 'a font stack' },
];

/* Top-level commas only: a shadow list separates its shadows with commas
   that an rgba() also uses inside its own parentheses, so a naive split
   reports --shadow-1 as four pieces and --sans as one font. */
function commaParts(value) {
  const out = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') depth -= 1;
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(at, i)); at = i + 1; }
  }
  out.push(value.slice(at));
  return out.map((part) => part.trim()).filter((part) => part.length);
}
const isShadowList = (v, n) => {
  const parts = commaParts(v);
  return parts.length === n && parts.every((part) => /rgba?\(/i.test(part) && /px/.test(part));
};

/* What each reason in UNREADABLE_TOKENS MEANS, as a predicate over the RAW
   declared value. Written against CSS syntax rather than derived from the
   table, or the expectation would move with the thing it checks. Coarse on
   purpose: the raw value settles the class and nothing finer. */
const WHY_MEANS = {
  'a colour, but a translucent rgba()': (v) => {
    const m = /^rgba\(([^)]*)\)$/i.exec(v);
    if (!m) return false;
    const parts = m[1].split(',').map((x) => x.trim());
    return parts.length === 4 && Number(parts[3]) < 1;
  },
  'a shadow list: offsets, a blur and an rgba()': (v) => isShadowList(v, 1),
  'a shadow list, two of them': (v) => isShadowList(v, 2),
  'a length': (v) => /^-?[\d.]+(px|rem|em)$/.test(v),
  'a font stack': (v) => commaParts(v).length > 1
    && commaParts(v).every((part) => !/\(|px|#/.test(part)),
};

/* The only raw colour word the sheet is allowed. Spelled out so that changing
   the exception to a different keyword fails here rather than going
   unmeasured. */
const KEYWORD_RGB = { black: [0, 0, 0] };

test('every reason UNREADABLE_TOKENS gives is the class its declared value is in', () => {
  const tokens = themeTokens(ARIA_CSS);
  const wrong = [];
  for (const row of UNREADABLE_TOKENS) {
    assert.ok(Object.prototype.hasOwnProperty.call(WHY_MEANS, row.why),
      'UNREADABLE_TOKENS gives ' + row.name + ' a reason nothing here can check: '
      + JSON.stringify(row.why));
    for (const theme of ['dark', 'light']) {
      const value = tokens.raw(theme, row.name);
      assert.ok(value, row.name + ' is not declared in the ' + theme + ' theme');
      /* The set of reasons TRUE of this value, not just whether its own is:
         a reason that fits two tokens equally is not a reason. */
      const fits = Object.keys(WHY_MEANS).filter((why) => WHY_MEANS[why](value));
      if (fits.length !== 1 || fits[0] !== row.why) {
        wrong.push(row.name + ' (' + theme + ') is declared ' + value + ', which is ['
          + fits.join(' | ') + '], but UNREADABLE_TOKENS says ' + JSON.stringify(row.why));
      }
    }
  }
  assert.deepEqual(wrong, [],
    'UNREADABLE_TOKENS gives a reason its own declared value contradicts, and the docblock '
    + 'above it tells a reader those reasons are why the resolver cannot read them');
  console.log('unreadable-token reasons judged: ' + JSON.stringify({
    tokens: UNREADABLE_TOKENS.length,
    reasons: new Set(UNREADABLE_TOKENS.map((t) => t.why)).size,
  }));
});

test('the avatar ink is the one paint no aria.css token could have made', () => {
  assert.equal(Math.round(ratio(rgbOf('#000000'), rgbOf('#ffffff'))), 21,
    'the contrast formula does not reproduce black on white');
  assert.equal(ratio(rgbOf('#777777'), rgbOf('#ffffff')).toFixed(2), '4.48',
    'the contrast formula does not reproduce the published 4.48:1 of #777 on white');

  const sheet = declarations(PANE_CSS).filter((d) => d.selector === '.av');
  const ink = sheet.filter((d) => d.property === 'color').map((d) => d.value);
  const tile = sheet.filter((d) => d.property === 'background').map((d) => d.value);
  assert.equal(ink.length, 1, '.av declares ' + ink.length + ' inks');
  assert.equal(tile.length, 1, '.av declares ' + tile.length + ' backgrounds');

  const mixed = /^color-mix\(in srgb, var\((--[\w-]+)\) ([\d.]+)%, ([a-z]+)\)$/.exec(ink[0]);
  assert.ok(mixed, '.av\'s ink is no longer a color-mix this test can read: ' + ink[0]);
  const [, inkToken, inkShare, inkKeyword] = mixed;
  assert.ok(KEYWORD_RGB[inkKeyword], '.av mixes toward ' + inkKeyword + ', which has no value here');
  assert.deepEqual(
    NON_TOKEN_PAINT.filter((p) => p.selector === '.av'),
    [{ selector: '.av', property: 'color', atom: inkKeyword, inside: 'color-mix' }],
    'the exception the sheet paints and the exception pinned above have come apart');

  /* The docblock names the token this ink mixes. It named `var(--cyan)` while
     nothing checked it, so swapping the sheet to another token left the
     sentence standing and green (Stadiora/Aria#10632). */
  const named = machineLine('AVATAR INK TOKEN').exec(PANE_CSS);
  assert.ok(named, 'the sheet\'s docblock no longer names the token .av\'s ink mixes');
  assert.equal(named[1].trim(), inkToken,
    'the docblock says .av\'s ink mixes ' + named[1].trim() + ' and the sheet mixes ' + inkToken);

  const stops = (tile[0].match(/var\(\s*--[\w-]+\s*\)/g) || [])
    .map((v) => /--[\w-]+/.exec(v)[0]);
  assert.equal(stops.length, 2, '.av\'s tile is no longer a two-stop gradient of tokens');
  /* "The avatar tile is an opaque gradient of that same token": the ink is
     mixed FROM the tile's own colour, which is why the exception is about
     that token rather than about cyan by name. */
  assert.ok(stops.includes(inkToken),
    '.av\'s ink mixes ' + inkToken + ', which is not one of its tile\'s own stops ('
    + stops.join(', ') + '), so the docblock\'s "a gradient of that same token" is false');

  const tokens = themeTokens(ARIA_CSS);
  const AA = 4.5;

  /* The darkest point of the gradient, sampled rather than argued: luminance
     is convex along an sRGB interpolation, so the minimum is not always an
     endpoint. */
  const worstTile = (theme) => {
    const ends = stops.map((name) => {
      const value = tokens[theme](name);
      assert.ok(value, 'aria.css declares no opaque value for ' + name + ' in ' + theme);
      return value;
    });
    let worst = null;
    for (let i = 0; i <= 100; i += 1) {
      const point = blend(ends[0], ends[1], i / 100);
      if (!worst || luminance(point) < luminance(worst)) worst = point;
    }
    return worst;
  };

  const share = Number(inkShare) / 100;
  const reached = {};
  for (const theme of ['dark', 'light']) {
    const base = tokens[theme](inkToken);
    assert.ok(base, 'aria.css declares no opaque value for ' + inkToken + ' in ' + theme);
    const painted = blend(KEYWORD_RGB[inkKeyword], base, share);
    reached[theme] = ratio(painted, worstTile(theme));
    assert.ok(reached[theme] >= AA,
      'the avatar ink reaches only ' + reached[theme].toFixed(2) + ':1 in ' + theme
      + ' against the darkest point of its own tile');
  }

  /* And the reason the exception exists: every token aria.css declares, tried
     in the same mix, in both themes. The tile is opaque in both, so what is
     behind the card cannot rescue any of them. */
  /* The sweep's EXTENT, not only its verdict: "the same test tries every one
     of them" is green over an empty list too, so the candidate set is pinned
     before it is filtered -- and pinned on the tokens actually TRIED, not on
     the tokens declared, which is a number the unreadable ones cannot move.
     Every name the resolver drops is enumerated and named, rather than
     described by a category. */
  const notRead = tokens.names.filter((name) => !tokens.readable.includes(name));
  assert.deepEqual(notRead.slice().sort(), UNREADABLE_TOKENS.map((t) => t.name).sort(),
    'aria.css declares a token this resolver cannot read and UNREADABLE_TOKENS does not '
    + 'name, so the sweep would score it as rejected without ever trying it');
  const sweep = { declared: tokens.names.length, tried: tokens.readable.length,
    notRead: notRead.length };
  assert.deepEqual(sweep, { declared: 33, tried: 20, notRead: 13 });
  console.log('avatar ink sweep judged: ' + JSON.stringify(sweep));

  const couldStandIn = tokens.readable.filter((name) => ['dark', 'light'].every((theme) => {
    const toward = tokens[theme](name);
    const base = tokens[theme](inkToken);
    assert.ok(toward && base, 'a token on the readable list did not resolve: ' + name);
    return ratio(blend(toward, base, share), worstTile(theme)) >= AA;
  }));
  assert.deepEqual(couldStandIn, [],
    'aria.css now declares a token that could paint this ink, so the exception in the '
    + 'sheet\'s docblock has an answer and should be taken: ' + couldStandIn.join(', '));
});
