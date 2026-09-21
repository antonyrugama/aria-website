# Geist, vendored

`assets/aria.css` has named `Geist` first in `--sans` and `Geist Mono` first in
`--mono` since the v2 dashboard was built, and until Stadiora/Aria#10806 nothing
served either. Every pane fell through to the next entry in the stack, so the
dashboard had never once rendered in the typeface its design was approved in.
A missing webfont is invisible by construction: the fallback renders fine, no
check reds, nothing looks broken. It just isn't the thing that was signed off.

These two files are what fixes that. They are checked in rather than fetched
because this repository has no build step, no package manager and no CDN, and
the Content-Security-Policy on every `ops/*.html` allows `font-src 'self'` and
nothing else.

## Provenance

Upstream is Vercel's official pre-built variable WOFF2, taken from `main`:

```
https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/dist/fonts/geist-sans/Geist-Variable.woff2
https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2
```

## Licence

SIL Open Font License 1.1 — `OFL.txt` beside this file, copied verbatim from
the upstream repository root. The copyright line reads `Copyright 2024 The Geist
Project Authors` with **no Reserved Font Name clause**, which is why the subsets
below may keep the family names `Geist` and `Geist Mono`. Had a name been
reserved, the OFL would have required renaming any modified copy, and subsetting
counts as modification. The licence must travel with the fonts, which is what
`OFL.txt` is doing here.

## Why variable, not static instances

The sheets these faces serve ask for fourteen distinct weights: 400, 440, 450, 460, 480, 500, 520, 540, 560, 580, 600, 620, 640, 700.
Geist ships static cuts only in hundreds, so **ten of the fourteen fall between
instances**. Against static faces the browser snaps each of those ten to its
nearest cut, which quietly flattens the design's weight ramp everywhere it is
used. One variable axis renders all fourteen exactly, and
`scripts/ops-webfont.test.mjs` measures the fourteen advance widths to prove the
axis is interpolating rather than snapping.

## Subsetting

Full upstream is 69,760 B + 71,596 B = 141,356 B. Vendored here is
29,272 B + 29,200 B = 58,472 B, a 59% reduction, on a file that loads on
every pane.

Reproduce with `fonttools` (4.65.0 was used):

```sh
pyftsubset Geist-Variable.woff2 \
  --output-file=Geist-Variable.subset.woff2 \
  --flavor=woff2 \
  --layout-features=kern,liga,calt,tnum,ccmp,locl,mark,mkmk \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013,U+2014,U+2018,U+2019,\
U+201C,U+201D,U+2022,U+2026,U+2030,U+2039,U+203A,U+2190-2193,U+20AC,U+2212,\
U+2248,U+2264,U+2265,U+00D7,U+00F7"
```

and identically for `GeistMono-Variable.woff2`.

What that keeps: ASCII, Latin-1 Supplement and Latin Extended-A — so every
European diacritic a person's name is likely to carry — plus the punctuation and
arrows the dashboard draws.

Two different measurements of "what the dashboard uses", and they disagree by an
order of magnitude, so both are stated rather than the flattering one. Scanning
the 86 source files under `ops/**` and `scripts/*.mjs` finds **twelve** distinct
non-ASCII characters: `§ ° ± · × — " " • … → −`. Rendering all ten panes in both
themes and all four preview states finds **one**: U+00B7 MIDDLE DOT. The other
eleven live in comments, in prose, and in branches the stub data does not reach.

Neither figure is the reason the subset is as wide as it is. Production renders
names from an API; the stub renders `Ada Lovelace`. The subset is sized for the
first and can only ever be checked against the second.

What it drops: Cyrillic, Greek, Vietnamese, box drawing (172 glyphs in Mono
alone), circled numerals and vulgar fractions.

Dropping a range is safe here because **font fallback is per character, not per
element**: a codepoint absent from Geist is drawn by the next family in the
stack, not as tofu. The panes render names from an API and cannot promise to
stay inside any subset, so this has to be true rather than hoped for — and the
rendered sweep in `scripts/ops-webfont.test.mjs` is what keeps it honest, by
failing if any glyph the dashboard actually paints comes from a face other than
these two.

> `document.fonts.check()` cannot be used for that. It answers a question about
> family availability, not glyph coverage: against these subsets it returns
> `true` for Cyrillic, CJK and emoji alike. A coverage claim built on it would
> pass unconditionally.
