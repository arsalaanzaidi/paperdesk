# paperdesk architecture

An engineering account of how paperdesk works, the decisions behind it, what it costs and where it falls short. Figures were measured on the code as of November 2026.

## 1. Constraints

- **Client-only.** The app is static files; the PDF is never sent anywhere. The only requests after load go to the app's own origin, for bundled font files and lazy chunks.
- **Stack:** React 19, TypeScript, Vite 6, zustand 5.
  - **pdf-lib 1.17** writes everything: page changes, overlays, export.
  - **pdfjs-dist 4.10.38** reads: rendering, text runs, font faces.
  - **fontkit 2.0.4** embeds bundled fonts, and loads lazily.
- **Size:** 3,733 lines in `src`. The main chunk is 1,028 KB minified (361 KB gzip). The pdf.js worker is a separate 1,376 KB file, and fontkit is a 363 KB lazy chunk (150 KB gzip).

## 2. Module map

| Area | Files | Responsibility |
|---|---|---|
| State | `store/usePdfStore.ts` | The PDF bytes, the pdf.js document, overlays, tool, busy/status/error. Every async action follows busy → work → status or error → not busy. |
| PDF I/O | `lib/pdf.ts`, `lib/download.ts` | Open for rendering, render a page, page mutations (insert, delete, move: bytes in, bytes out), download. |
| Overlays | `lib/overlay.ts` | `TextBox` (top-left PDF points), geometry, colours, baseline maths, standard-font mapping, remapping boxes after page changes. |
| Text runs | `lib/textItems.ts` | pdf.js text items as clickable runs: position, size, style guess, fill colour, font name. |
| Export | `lib/bake.ts` | Draws overlays onto a fresh copy of the bytes and returns the exported PDF. |
| Fonts | `lib/fonts.ts`, `lib/textRuns.ts`, `lib/fontkit.ts` | Bundled font catalogue, font matching, font chains, per-grapheme run splitting, the lazy fontkit 2 adapter. |
| Reuse of PDF fonts | `lib/embedded.ts`, `lib/ownFonts.ts` | Finding an embedded font new text can reuse (shared by export and editor) and its pdf.js face for the editor. |
| UI | `components/*` | Header (desktop buttons, phone ☰ menu), Sidebar (thumbnails, drag reorder), Desk (page canvas and controls), TextLayer (boxes, hit-testing, editing), TextToolbar, StatusBar, Toast, UploadZone. |

## 3. Data flow

1. A dropped or picked file becomes `bytes: Uint8Array` in the store, the single source of truth.
2. Page edits (`insertBlankPage`, `deletePage`, `movePage`) load the bytes with pdf-lib, change them, and save new bytes. Then `applyBytes` reopens them with pdf.js, destroys the previous document and bumps `docVersion`. Render effects key on `[doc, docVersion, page]`.
3. Text edits never touch the bytes. They live in `overlays` and are drawn only at export (`bakeOverlays`).

**Trade-off:** every page change re-parses and re-renders the whole document. That is simple and always correct, but it costs O(document size) per change. Large PDFs (50 MB is a soft warning, not a limit) pay for it on each change, and nothing is cached between the sidebar and the desk.

## 4. Editing existing text

- With the Edit text tool, a click is hit-tested against the page's text runs. A hit creates an edit-box with that run's text, position, size, style and colour.
  - The style is guessed from the font name, falling back to pdf.js's generic family, which comes from the font's own serif and fixed-pitch flags.
  - The colour is read from pdf.js's operator list.
- The box is painted over the original with a cover colour: the dominant colour inside the run's box, sampled from the canvas.
- **It is not redaction.** The original glyphs stay in the content stream and can still be extracted. The UI says so.
- **Baseline parity.** Export puts the first baseline 0.8 em below the box top (`ASCENT_RATIO`). CSS puts it wherever the font's metrics say. The editor measures the real CSS baseline per font and pixel size (`cssBaselineRatio`) and shifts the text by the difference (`baselineShiftPx`), so the editor and the export share a baseline. The smoke test asserts this to within 0.3 px.

## 5. Fonts at export

For each box, the first rule that applies:

1. **The PDF's own font** (edit-boxes only), when `findEmbeddedFont` finds it in a reusable form and it has a glyph for every character the box holds.
   - Reusable means Type0 with Identity-H encoding, a TrueType program (CIDFontType2 + FontFile2) and a ToUnicode map, found in the page's resources or a form XObject's.
   - A character counts only if its glyph has an outline in loca (whitespace excepted). Subsets keep glyph ids whose outlines are empty.
   - The box is drawn by reference (`BT /PdOwn Tf … <CIDs> Tj ET`): original glyphs, no fontkit, nothing added to the file.
2. **The standard 14** (pdf-lib's built-in Helvetica, Times, Courier), for a box without a look-alike whose text is all WinAnsi. Nothing downloads. These fonts aren't embedded, so the viewer draws its own versions.
3. **A bundled font chain** (`fontChain`): the box's look-alike, or Arimo, Tinos or Cousine for its family, then Arimo in the same style.
   - `splitRuns` splits each line into per-font runs by grapheme.
   - The faces are embedded as subsets through fontkit 2.
4. **Refusal.** A character no font has stops the export with a message that names it, instead of drawing a blank glyph.

**Look-alike matching** (`matchFont`) works on the font name, after stripping the subset tag, the style after `-` or `,`, and the PS/MT suffix:

| Original | Drawn with | Tier |
|---|---|---|
| Arial, Times New Roman, Courier New | Arimo, Tinos, Cousine | same widths |
| Calibri, Cambria, Georgia, Segoe UI | Carlito, Caladea, Gelasio, Selawik | same widths |
| Arimo, Tinos, Cousine, Carlito, Caladea, Gelasio, Selawik, Open Sans, Roboto | themselves | exact |
| Helvetica, Times, Courier | the standard 14 | exact |
| anything else | the sans/serif/mono guess | approximate |

**Measured:**
- Arimo has the same advance widths as macOS Arial for all 191 shared Latin-1 characters (190 in Bold).
- Gelasio matches Georgia for 188 of 190.
- The Calibri, Cambria and Segoe UI pairings rely on those fonts' documentation, because the originals weren't available to measure.

**The fontkit 2 adapter.** pdf-lib 1.17 subsets through `subset.encodeStream()`, which only `@pdf-lib/fontkit` has. fontkit 2's subset has a plain `encode()`, so `adaptFontkit` adds the stream. fontkit 2 is less than half the size of `@pdf-lib/fontkit` and has its subsetting fixes, and it gave identical output on all the bundled fonts.

## 6. Editor and export parity

The editor makes the same decisions on the same inputs as the export:

- It calls the same `usesBundledFont`, `fontChain` and `findEmbeddedFont`, on the same bytes.
- It loads the same font bytes as `FontFace`s registered per weight and style (`pd-arimo`, …), or uses pdf.js's own face for a reused PDF font.
- It builds the CSS stack in chain order, so the browser falls back per character exactly as `splitRuns` does.
- It sets `font-kerning: none` (pdf-lib doesn't kern) and `font-synthesis: none` (no fake bold or italic).
- It measures the baseline only after the face has loaded.

The smoke test checks the computed fonts in the editor, and the fonts embedded in the exported file.

## 7. Performance and budget

| Item | Size | When it loads |
|---|---|---|
| Main chunk | 361 KB gzip | Page load |
| pdf.js worker | 1.38 MB | First PDF |
| fontkit 2 | 150 KB gzip | First export that needs a bundled font (prefetched when such a box appears) |
| Bundled fonts | 34 TTFs, 10 MB in total, 0.04-0.8 MB each | Only the faces a box uses |

Exported files grow only by the glyphs actually drawn, because bundled fonts are subset and reused PDF fonts add nothing.

## 8. Testing

- **Unit:** 151 tests in 8 files. They run in vitest's `node` environment with no jsdom, so components have no unit tests.
  - Library tests drive real pdf-lib → pdf.js round trips (the legacy pdf.js build), read the bundled font files from disk, and include build checks on every font: it is embeddable, its subsetting is safe, and ₹ is reachable through its chain.
- **Smoke:** `scripts/smoke.mjs` drives the dev server in real Chrome through puppeteer-core, desktop and an emulated iPhone, with 68 checks.
  - It covers load, rendering (real pixels), page changes, add and edit text, ₹, look-alike and original-font edits, the refusal, export (the exported file's text and fonts), the phone menu, focus and layout.
  - `scripts/make-test-pdf.mjs` builds its sample PDF, with real font subsets under subset-tagged names.
- **Checks that can't pass vacuously.** The checks were revised so each fails without its fix, and several were confirmed that way by removing the fix and re-running.
- **CI:** pull requests run lint, unit tests and the build. The smoke test needs a dev server and macOS Chrome, so it runs locally.

## 9. Build and deploy

- Vite builds with a relative base (`./`), so one build works at a domain root and under a sub-path.
- Every push to `master` deploys twice:
  - **Cloudflare Workers Builds** runs `yarn build`, then `npx wrangler deploy` with `wrangler.jsonc`: an assets-only Worker on a custom domain. `public/_headers` sends `X-Robots-Tag: noindex`.
  - **GitHub Actions** (`.github/workflows/pages.yml`) builds, then deploys to GitHub Pages in a separate job. Deploying in the same job as the upload intermittently found no artifact.
- There is no server code.

## 10. Known limitations and risks

- **Scripts:** Latin only (English plus accented letters). There is no shaping or bidi, and pdf-lib drops GPOS, so marks and kerning are lost. Symbols beyond what the text fonts hold, and emoji, are refused. Symbol coverage is planned in `docs/superpowers/plans/2026-11-21-font-support.md`.
- **Fonts without a look-alike** (Verdana, Tahoma, Trebuchet, Century Gothic, Helvetica Neue) are approximate. Exact fonts from the user's device or a file are planned but not built.
- **Reusing PDF fonts** works only for Type0 / Identity-H / TrueType fonts with ToUnicode. Simple TrueType, Type1, Type3 and CFF fonts fall back to look-alikes. It's whole-box: one missing character sends the whole box to the look-alike.
- **Selawik has no italics**, so italic Segoe UI text is drawn upright. Caladea, Open Sans and Selawik have no ₹, so ₹ falls back to Arimo there.
- **Edit text:** the cover is one flat colour. Rotated pages and non-zero MediaBox origins aren't handled. Dragging an edit-box moves its cover, and the original shows through again.
- **A known bug:** styling a new, still-empty Add-text box (Bold, size, family) before typing deletes it, because the box loses focus while empty.
- **Phones:** the page controls and the text toolbar scroll sideways with a wide page (on screens 375 px or narrower they start partly off-screen). A very long file name wraps the status bar onto several lines.
- **Dependencies:** pdf-lib 1.17 sees little maintenance, and paperdesk depends on its internal `encodeStream` call through the fontkit adapter.
- **Tooling:** the smoke test hard-codes the macOS Chrome path.
