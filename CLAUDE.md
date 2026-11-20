# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**paperdesk** — a client-side PDF page editor (React 19 + TypeScript + Vite). Everything runs in the browser: no server, no upload. A dropped/selected PDF is held as `Uint8Array` bytes in app state; edits round-trip through `pdf-lib` (mutate bytes → new bytes), while `pdfjs-dist` handles read-only rendering to `<canvas>`.

## Commands

```bash
yarn install
yarn dev              # Vite dev server
yarn build             # tsc -b (project references) && vite build
yarn lint              # eslint .
yarn preview           # preview production build
yarn test              # vitest run (unit tests, node environment)
yarn test:watch        # vitest in watch mode
```

Unit tests are `src/**/*.test.ts`, and they run with vitest in a `node` environment. There is no jsdom, so React components have no unit tests. Library tests that need pdf.js import the legacy build (`pdfjs-dist/legacy/build/pdf.mjs`) directly, because `src/lib/pdf.ts` imports the Vite-only worker URL (`?url`). `usePdfStore.test.ts` mocks `../lib/pdf` and `../lib/bake`.

The UI is covered by an end-to-end smoke script that drives a running dev server with real Chrome:

```bash
node scripts/make-test-pdf.mjs /tmp/test.pdf     # generate a 3-page sample PDF
yarn dev                                          # in one terminal
node scripts/smoke.mjs http://localhost:5199/ /tmp/test.pdf /tmp/shots   # in another
```

`scripts/smoke.mjs` uses `puppeteer-core` against the system Chrome install (hardcoded path `/Applications/Google Chrome.app/...`, i.e. macOS-only as written). It exercises the full flow — load, render (asserts real non-white pixels, not just canvas size), navigate pages, add/delete a page, add a text box, edit existing text, export (asserts the exported PDF's text contains both sentinels) — and exits non-zero on any failed check. `/tmp/shots` must be empty before a run: the export check reads the first `.pdf` it finds there.

## Architecture

### Data flow: bytes in, bytes out

The single source of truth is `bytes: Uint8Array` in the zustand store (`src/store/usePdfStore.ts`). Every mutation (`insertBlankPage`, `deletePage`, `movePage` in `src/lib/pdf.ts`) takes bytes in, loads them with `pdf-lib`'s `PDFDocument`, mutates, and returns new bytes via `.save()` — it never mutates the live pdf.js doc in place. After a mutation, the store calls `applyBytes()`, which re-opens the new bytes with pdf.js (`openForRender`) to get a fresh `PDFDocumentProxy` for rendering, destroys the previous proxy, and bumps `docVersion`.

This means every edit reloads and re-renders the whole document from scratch — simple and correct, but not incremental. `docVersion` exists purely so page/thumbnail components know a re-render is needed even when `currentPage`/`pageNumber` haven't changed (the `doc` object reference alone isn't a reliable enough dependency for effects).

Two libraries, two jobs — don't cross them:
- **pdf-lib** (`PDFDocument`) — the only thing that mutates page structure (insert/delete/reorder), draws overlay content (text and cover rectangles, at bake time) and produces the exported bytes.
- **pdfjs-dist** (`PDFDocumentProxy`) — read-only: rendering to canvas (`renderPage`, `renderPageToBlob` in `src/lib/pdf.ts`) and reading existing text runs (`getPageTextItems`, backed by `src/lib/textItems.ts`). Its worker is wired up via `PdfWorker` imported with Vite's `?url` suffix (`pdfjs-dist/build/pdf.worker.min.mjs?url`) and set as `pdfjsLib.GlobalWorkerOptions.workerSrc` — this must stay un-inlined by Vite (see comment in `vite.config.ts`).

`openForRender` calls `bytes.slice()` before handing data to pdf.js, because pdf.js can detach/neuter the underlying `ArrayBuffer` — callers that need to keep `bytes` around must not hand over the original.

### Store shape (`src/store/usePdfStore.ts`)

All async mutation actions (`loadFile`, `addBlankPage`, `removePage`, `reorderPage`) follow the same pattern: set `busy` + `status`, do the work, set `status` or `error` on completion, clear `busy` in `finally`. `error` and `status` are separate fields — `StatusBar` shows `error ?? status`, and `Toast` transiently pops up `error` for 4s then clears it (only if it hasn't since changed).

Page indices: the store's public API is 1-based (`oneBased` params), matching how humans think about pages; `src/lib/pdf.ts` mutation functions are 0-based (`index`), matching pdf-lib's API. The conversion happens at the store boundary — keep it that way rather than mixing conventions in one layer.

### Text overlays

Text edits are not written to `bytes` while editing. They live in the store as `overlays: TextBox[]` (`src/lib/overlay.ts`), positioned in top-left-origin PDF points (`xPt/yPt/wPt/hPt`, 0-based `page`). `exportPdf` calls `bakeOverlays` (`src/lib/bake.ts`), which draws them with pdf-lib only at export. Page insert/delete/reorder remap box pages with `remapAfterInsert/Delete/Reorder`. Loading another file clears `overlays`.

- **Add text** (`tool: 'text'`): a click spawns an empty box. A box left empty on blur is removed. Text soft-wraps to `wPt` (`wrapLines`).
- **Edit text** (`tool: 'edit'`): `TextLayer` fetches the page's pdf.js text runs (cached per `docVersion:pageIndex`) and hit-tests the click against them. A hit spawns a box prefilled with the run and a `coverColor` sampled from the canvas: the dominant colour (`dominantColor`, tolerance clusters over a grid, most common exact colour of the largest) inside the run's box, so a neighbouring glyph or the run's own ink doesn't win. The box's text colour is the run's original fill colour: `runColors` reads it from pdf.js's operator list (where pdf.js has turned every colour space into `setFillRGBColor`) and lines the show-text glyphs up with the text items. Unknown, invisible or pattern-filled runs fall back to `contrastText(coverColor)`. `extractTextItems(page, OPS)` takes pdf.js's `OPS` table as an argument so `textItems.ts` needs no pdf.js runtime import (tests pass the legacy build's). A repeat click within 2pt selects the existing box. Edit-boxes are single-line in both the editor (`.text-box-edit.cover`, `white-space: pre`) and bake (split on `\n` only).
- In the editor, the cover is the outer `.text-box`'s background, and the selection frame is an `outline` (no layout space). So the cover spans the whole run box and the text starts at its corner. A border would push the text 1px down and right of where bake draws it, and a cover on the inner `.text-box-edit` would leave a ring where the original glyph tops show through.
- At bake, a box with `coverColor` gets a filled rectangle drawn first, then its text. This is **not** redaction: the original glyphs stay in the content stream and can still be extracted. The "Edit text" button's `title` says so.
- Bake puts the first baseline `ASCENT_RATIO` (0.8) em below the box top. CSS puts it at the font's own ascent plus half the leading, snapped to whole pixels, so the ratio changes with font and size (0.83-0.92 em seen in Chrome). The editor measures it per font and pixel size (`cssBaselineRatio` in `TextLayer`, cached) and shifts its text by `baselineShiftPx`, so editor and export share a baseline. Both use `LINE_HEIGHT_RATIO` for line spacing. pdf-lib's `widthOfTextAtSize` includes kerning but `drawText` does not kern, so don't use it as an oracle for drawn widths.

Design docs: `docs/superpowers/specs/` and `docs/superpowers/plans/`.

### Components (`src/components/`)

`App.tsx` swaps between `UploadZone` (no doc loaded) and `Sidebar` + `Desk` (doc loaded), plus an always-present `Header`/`StatusBar`/`Toast`. Sidebar thumbnails and the Desk's main canvas each run their own render effect keyed on `[doc, docVersion, pageNumber/currentPage]` — there's no shared render cache between them.

Reordering (`Sidebar.tsx`) is native HTML drag-and-drop tracking `dragFrom` (page being dragged) and `dropAt` (`{ index, where: 'before' | 'after' }`); `handleDrop` converts that into a destination 1-based index, adjusting for the source page vacating its slot (`if (dragFrom < to) to -= 1`) before calling `reorderPage`.

### Git Workflow

Use plain `git` for local work (branch, commit, merge). The repo has no remote yet. Do feature work on a branch, not directly on `master`.

Before every commit or push, run `git config user.email` from inside the repo. It must print the personal identity (`arsalaan.z99@gmail.com`). An `includeIf` for `~/Personal Projects/` sets it. Never change the global git config: it is the work persona. If a remote is added, use the `github.com-personal` SSH host alias.

## Constraints worth knowing

- `MAX_BYTES` (50MB) in the store is a soft warning threshold, not a hard limit — large files still load, just with a status message.
- `removePage` refuses to delete the last remaining page (checked both in the store and in `deletePage` itself).
- `.yarnrc` forces `--ignore-engines true` because `pdfjs-dist` declares `node>=20` in its engines field even though it's a browser library — this is safe to ignore since Vite/esbuild handles it fine under Node 18.
- Known limits of Edit text:
  - the cover is one flat colour (the region's dominant colour), so gradients, images or heavy ink covering most of the run's box give a poor match;
  - rotated pages and non-zero MediaBox origins are not handled;
  - dragging an edit-box moves its cover, and the original text shows again at the old spot.
