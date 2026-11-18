# paperdesk — Edit Existing Text (Phase 2) Design

**Date:** July 12, 2026
**Project:** paperdesk (client-side PDF page editor)
**Status:** Design Approved
**Depends on:** Phase 1 — add text overlays (shipped, `master` HEAD `261f8f5`)

---

## Overview

Phase 1 let users add new text boxes on top of a PDF. This phase lets users click **existing** text already in the PDF, edit it in place, and have export cover the original glyphs with a background-matched rectangle and redraw the edited text on top.

This is layered onto the exact same overlay machinery as Phase 1 — no new data array, no new render tree shape. A click on existing text just becomes another way to spawn a `TextBox`, one that happens to carry a `coverColor`.

**This is not secure redaction.** The original glyphs remain in the PDF's text layer / content stream — only visually covered by the drawn rectangle and new text. Copy-paste or text-extraction tools can still recover the "removed" text. This must be surfaced to the user (see UI section) and is the single most important known limit of this feature.

---

## Architecture

```
usePdfStore
├── tool: 'select' | 'text' | 'edit'        (extended — 'edit' is new)
└── overlays: TextBox[]                      (TextBox gains coverColor?: string)

lib/pdf.ts
└── getPageTextItems(doc, pageNumber)        (new — wraps pdfjs getTextContent(),
                                               returns pt-space rects + best-effort style)

TextLayer.tsx
├── caches getPageTextItems() per [doc, docVersion, pageIndex] when tool === 'edit'
├── onLayerPointerDown, tool === 'edit': hit-test click against cached items
│   ├── hit + an existing edit-box already covers it  → select that box
│   ├── hit, no existing box                          → sample cover color from
│   │                                                    canvasRef, addTextBox(...)
│   │                                                    with coverColor set
│   └── no hit                                         → no-op
└── tool === 'text' path and click-on-existing-box path: unchanged

bake.ts
└── per box: if coverColor is set, drawRectangle(box bounds, coverColor)
             BEFORE drawing the box's text (unchanged for boxes without coverColor)
```

Two libraries keep their existing jobs; this phase doesn't blur the boundary:

- **pdf-lib** — still the only thing that mutates page structure and draws overlay content (rectangles now, in addition to text) at bake time.
- **pdfjs-dist** — still read-only. `getTextContent()` (already anticipated in the Phase 1 spec) is the only new pdfjs surface used, and it stays inside `lib/pdf.ts` alongside `renderPage`/`openForRender`.

---

## Data model

One new optional field on the existing `TextBox` (`overlay.ts`):

```ts
type TextBox = {
  // ...all existing fields, unchanged...
  coverColor?: string   // hex; when set, bake draws a filled rect at the box's
                         // bounds before drawing text. Absent for Phase-1 add-boxes.
}
```

Nothing else changes. Remap-on-page-mutation (`remapAfterInsert/Delete/Reorder`), drag/resize, store actions (`addTextBox`/`updateTextBox`/`removeTextBox`/`selectBox`), and `TextToolbar` all already operate generically over `overlays` — zero changes needed to any of them.

---

## Hit-testing & coordinates

New `getPageTextItems(doc, pageNumber)` in `lib/pdf.ts`:

- Calls `page.getTextContent()`, filters out empty/whitespace-only items.
- Converts each item's `transform`/`width`/`height` into the same top-left-origin point space (`xPt/yPt/wPt/hPt`) that `TextBox` already uses, via `page.getViewport({ scale: 1 })` — the same coordinate convention `renderPage` already relies on, so no new coordinate system enters the app.
- Returns `{ str, xPt, yPt, wPt, hPt, sizePt, family, bold, italic }` per item, where:
  - `sizePt` is approximated from the item's transform scale.
  - `family`/`bold`/`italic` are guessed from the item's internal `fontName` string (`"Bold"` → bold, `"Italic"`/`"Oblique"` → italic, `"Times"` → serif, `"Courier"` → mono, else sans/false/false). This is a heuristic, not a real font lookup — matches the fidelity limits already accepted for this phase.

`TextLayer` fetches and caches this list per page (effect keyed on `[doc, docVersion, pageIndex]`, only while `tool === 'edit'`) so a click hit-tests synchronously against the cache — no per-click async round-trip, no click-to-edit latency.

Hit-test grain is whatever pdf.js returns as one text item — sometimes a full line (common in simply-generated PDFs), sometimes a smaller fragment (common in PDFs with many small runs). No merging/splitting logic is added for this MVP.

---

## Cover-color sampling

On a hit:

1. Convert the item's pt-rect back to canvas pixels (`* zoom`, same math `boxToScreen` already does).
2. Sample one pixel just outside the run's bounding box (e.g. a couple px to the left, vertically centered), clamped to canvas bounds, via `canvasRef.current.getContext('2d').getImageData(x, y, 1, 1)`.
3. Convert the sampled RGBA to hex. Falls back to white (`#FFFFFF`) if the sample point is out of bounds or unreadable.

`TextLayer` receives the existing canvas element's ref from `Desk` (new prop) purely to read this one pixel — it does not render to or otherwise touch the canvas.

This approximation is known to fail on gradients, textured, or image backgrounds (the cover rectangle will be visibly wrong there) — same documented limit as the original Phase 1 spec's Phase-2 sketch.

---

## Dedup on repeat click

Before creating a new edit-box, `TextLayer` scans the current page's `overlays` for one whose `(xPt, yPt)` is within ~2pt of the hit rect. If found, that box is selected instead of a new (overlapping, duplicate) one being spawned. This is the same kind of scan already implicit in "click a box → select it," just applied before box creation instead of relying on DOM hit-testing (since at this point no DOM box exists yet for a first-time click).

---

## Components

### `lib/pdf.ts` (modified)
Adds `getPageTextItems`. No changes to existing exports.

### `overlay.ts` (modified)
`TextBox` gains `coverColor?: string`. New pure helper `sampleColorAt(ctx, xPx, yPx): string` (mirrors the existing `parseHexColor`, going the other direction: canvas pixel → hex).

### `TextLayer.tsx` (modified)
- New prop: `canvasRef: React.RefObject<HTMLCanvasElement>`.
- New local state: cached text items for the current page (only populated while `tool === 'edit'`).
- `onLayerPointerDown` branches on `tool`: `'text'` behaves exactly as today (unchanged); `'edit'` runs the hit-test/dedup/sample/create flow above; anything else deselects, as today.

### `Desk.tsx` (modified)
Passes its existing `canvasRef` down to `<TextLayer>` as a new prop. No other changes.

### `Header.tsx` (modified)
Second toggle button, "Edit text," using the same `tool` enum (mutually exclusive with "Add text" — setting one clears the other automatically since `tool` is a single value). `title` attribute carries the redaction-limit warning: *"Covers and replaces existing text visually — the original text is not removed from the file and can still be extracted by other tools."*

### `bake.ts` (modified)
Per box, if `coverColor` is set: `page.drawRectangle({ x: box.xPt, y: pageHeight - box.yPt - box.hPt, width: box.wPt, height: box.hPt, color: rgb(...) })` before the existing `drawText` loop. Boxes without `coverColor` (Phase-1 add-boxes) are unaffected — identical output to today.

---

## Store actions

No new actions. `setTool` already accepts any value of its (now three-member) union. `addTextBox` already accepts an arbitrary `Omit<TextBox, 'id'>`, so passing one with `coverColor` set requires no signature change.

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| Edit tool active, click has no text item under it | No-op (nothing spawned) |
| Edit tool active, click hits a run already turned into an edit-box | Select the existing box (no duplicate) |
| Cover-color sample point out of canvas bounds | Falls back to white (`#FFFFFF`) |
| Edited box dragged after creation | Cover rectangle moves with it — original text reappears at the old spot (documented limit, not fixed) |
| Text box (edit or add) left empty on blur | Silently removed (unchanged from Phase 1) — for an edit-box this also means the cover rect is gone, i.e. reverting an edit before export restores the original text exactly, since nothing is written to `bytes` until bake |

---

## Testing

Extend `scripts/smoke.mjs` with an edit-text pass:

1. Load the sample PDF (`scripts/make-test-pdf.mjs`), which contains known text at a known page position.
2. Activate "Edit text," click that known text region.
3. Assert a prefilled editable box appears containing the original run's string.
4. Edit it to a sentinel string.
5. Export; reload the exported bytes with pdf.js and assert `getTextContent()` on the target page contains the sentinel — and, if feasible, no longer contains the original string as a separate visible run at that position (documented as a *visual* claim only, given the redaction caveat above).
6. Exit non-zero on any failed assertion, matching the script's existing convention.

---

## Out of scope (MVP)

- Secure/true redaction (removing the original content-stream text) — explicitly out of scope; this feature is cover-and-redraw only.
- Merging multiple pdf.js text items sharing a line into one editable run.
- Exact original font recovery (embedding/matching beyond the standard-3 + bold/italic heuristic).
- Independent cover-rect vs. text positioning (i.e., a cover that stays pinned when the replacement text box is dragged).
- Rich text within a single edited run (mixed styles per character).
- Visual distinction in the editor between an edit-box and an add-box beyond selection state.

---

## Success criteria

- Clicking existing PDF text with "Edit text" active spawns an editable box prefilled with that text, positioned and roughly sized to match the original run.
- Editing and exporting produces a PDF where the sentinel replacement text is present in the real text layer at that position, with the original run visually covered.
- Repeat clicks on the same run select the existing edit-box rather than stacking duplicates.
- Deleting an edit-box before export restores the original text with no trace of the edit.
- No new runtime dependency added; bundle stays lean (pdfjs's `getTextContent()` is already bundled).
- The non-secure-redaction limit is visible to the user in the UI, not just in this document.
