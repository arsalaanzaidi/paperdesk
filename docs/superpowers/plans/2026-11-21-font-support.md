# Font support plan (2026-11-21)

Synthesis of the four reports in `docs/superpowers/research/2026-11-20-font-support-research.md`, scoped to English, every font a PDF uses, and broad symbol support. Section 5 is open.

## Scope

- **Text:** Latin script, so English plus accented letters (café, names). Other scripts are refused with a message, so no shaping or bidi.
- **Fonts:** each original font gets the best match available:
  - exact: its own glyphs, or the same font from the user;
  - metric-compatible: a bundled clone;
  - classified: sans, serif or mono.
- **Font UI:** the toolbar shows which match a box has and offers "Use exact font…". Add-text boxes can pick any bundled font.
- **Symbols:** currency, punctuation, letterlike, arrows, math, technical, box drawing, shapes and dingbats. Emoji per section 5.

## 1. Resolution order

Steps 1-4 test whole words; step 5 works per grapheme.

1. **The run's embedded subset, by reference.** Exact glyphs, no fontkit, +677 B in the sample. Subsets keep about 1.5% of their glyphs, so a miss sends the word on.
2. **The same font, complete:** from `queryLocalFonts` (desktop Chromium, on a click) or a font file the user picked (any browser, iPhone included), if its fsType allows embedding.
3. **A bundled clone:**
   - Arimo for Arial and Helvetica, Tinos for Times, Cousine for Courier;
   - Carlito for Calibri, Caladea for Cambria, Gelasio for Georgia, Selawik for Segoe UI;
   - Open Sans and Roboto as themselves.

   There is no clone for Verdana, Tahoma, Trebuchet, Century Gothic or Helvetica Neue, so those need step 2.
4. **Classified:** FontDescriptor flags (serif, fixed pitch, italic, weight) pick Arimo, Tinos or Cousine.
5. **Symbol chain:** Noto Sans, then Noto Sans Math, Symbols and Symbols 2, then monochrome Noto Emoji if chosen.

The standard 14 stay only for runs already in them and for plain WinAnsi Add-text boxes. They are not embedded, so the viewer draws its own. If no font covers a character, refuse the export and name it: never a silent .notdef.

## 2. Editor/export parity

- `loadFont(id)` hands the same bytes to `new FontFace()` (with weight and style descriptors) and to `embedFont()`.
- One `segmentRuns(text, chain)`, reading cmap JSON for bundled fonts and ToUnicode for subsets, drives both the CSS stack and bake's `drawText` runs. `wrapLines` sums the run widths.
- Editor CSS: `font-kerning: none` (pdf-lib drops GPOS kerning) and `font-synthesis: none`.
- Measure `cssBaselineRatio` only after `face.load()`, because it caches per family.
- Subsets: store the BaseFont, and look up pdf.js's `loadedName` (new on each load) at render. Changing the style in the toolbar re-resolves the font.
- The symbol chain precedes the system emoji font, and VS15 asks for text presentation, so the editor never shows colour glyphs that the PDF can't hold.

## 3. Budget

- Main chunk: about +2 KB. Each font's cmap JSON travels with that font.
- First custom-font export: fontkit (342 KB gzip) plus about 0.25-0.3 MB per style (brotli), all through `import()`.
- The clone catalogue is about 4.4 MB in all, 0.08-0.8 MB per style, on demand.
- Noto Sans is 431-447 KB per style and Symbols 2 is 672 KB. Math, Symbols and Emoji are unmeasured.
- Local and picked fonts download nothing.
- Self-host as Vite assets.

## 4. Phases

1. **Fix ₹.**
   - Spike fontkit (a) and (c) with all 4 styles of Arimo, Tinos and Cousine. Check pdf.js, Preview and Acrobat, and compare Arimo's advances with Arial's.
   - Build check: ₹ in every bundled TTF, and no odd-length glyph records.
   - A non-WinAnsi box switches entirely to its family's font. Check each character after NFC; refuse uncovered ones.
   - Editor parity as in section 2. If `import()` fails after a deploy, ask the user to reload.
   - Tests: `make-test-pdf` embeds an Arimo run with ₹. Smoke a prefilled edit-box, a mono ₹ box and the refusal.
2. **Symbols.** Per-grapheme `segmentRuns` with the Noto chain. A build check confirms the chain covers every target block. Smoke "₹ € ✓ → ≤ ★ ©".
3. **Every font.** Subset reuse, the clone catalogue (through a `fontKey` on TextBox), the classified fallback, and the toolbar's match tier and font list.
4. **Exact fonts from the user.** "Use exact font…" calls `queryLocalFonts`, or extracts the face from a picked .ttf, .otf or .ttc. Then check fsType.

## 5. Decisions for you

- **fontkit.**
  - (a) @pdf-lib/fontkit 1.1.1: fine for bundled TTFs, but its CFF subsetting breaks OTFs in Acrobat.
  - (b) pdf-fontkit 1.8.9: claims fixes, unverified.
  - (c) Upstream fontkit 2 or 3: has the fixes, but needs an untested `encodeStream` shim, and 3.0.0 is 10 days old.
  - *Recommend (c) if its shim passes the phase 1 spike, because user OTFs arrive in phase 4. Otherwise (a).*
- **Emoji.** (a) Refuse them. (b) Monochrome Noto Emoji in editor and export; colour emoji can't go through pdf-lib. *Recommend (b) if you want emoji.*
- **Local fonts on desktop Chromium.** (a) Ask on a click, for the needed names only. (b) Picked files only. *Recommend (a) plus picked files.* It is the only exact path for fonts without a clone. Never store or send the font list.
- **Remembering picked fonts.** (a) For the session. (b) In IndexedDB, on the device. *Recommend (a).*

## 6. Risks

- Subsetting bugs: loca halving, which the build check catches, and CFF in user OTFs.
- The browser's fallback and `segmentRuns` disagreeing on ZWJ, variation selectors or ignorables.
- pdf.js keys a ligature's ToUnicode entry by its first code point, so a subset's "fi" can stand in for "f".
- Lost TJ kerning, and variable fonts that embed only their default outlines.
- Local fonts: fingerprinting, `[]` instead of an error on denial, and .ttc extraction.
- Licences: RFN fonts must be renamed if modified, and fsType rules local and picked fonts.

## Disagreements and unverified claims

- Liberation Sans in pdfjs-dist: one report calls it open-licence, but its name table says GPL with an exception. Don't reuse it.
- ₹ in Arimo and Tinos, and Arimo's Arial metrics, come from docs only. ₹ in Cousine and Carlito is unknown.
- Only a fontkit stub ran.
- Export by reference was tried only on Type0/Identity-H fonts with ToUnicode, read back in pdf.js, with the editor side in Chrome.
- Local fonts were tried headless, with no real permission prompt.
- Not researched: the Noto symbol and emoji fonts' coverage and sizes, and colour emoji through pdf-lib.
