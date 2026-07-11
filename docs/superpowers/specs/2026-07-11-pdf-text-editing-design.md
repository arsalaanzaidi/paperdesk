# paperdesk — Text Editing Design

**Date:** July 11, 2026
**Project:** paperdesk (client-side PDF page editor)
**Status:** Design Approved
**Depends on:** existing upload / render / page-management / PDF-export flow

---

## Overview

Add text editing to paperdesk. Two phases, shipped in order:

- **Phase 1 — Add text overlays.** The user adds new text boxes on top of the PDF: place, drag, resize, and style (font family, size, color, bold, italic). Existing PDF content is untouched. Fidelity is perfect because the text is new.
- **Phase 2 — Edit existing text (redact + redraw).** The user clicks existing text; paperdesk covers it with a background-matched rectangle and redraws the edited text on top. This is an approximation with known fidelity limits, layered onto the same overlay machinery.

Everything stays client-side. No new runtime dependency is added — the interactive layer is plain DOM over the existing render canvas, and baking uses the `pdf-lib` already in the stack.

### Decisions locked during brainstorming

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Both phases, overlays first | Overlays are the honest, robust core; edit-existing reuses the same layer |
| Overlay UI tech | DOM overlay, no new dependency | Keeps the lean stack (pdf-lib + pdfjs only); native text UX; no second canvas coord system |
| Round-trip | Deferred — bake only at export | Typing/drag stays instant (no per-keystroke doc reload); boxes stay editable |
| Fonts | Standard-3 (Helvetica/Times/Courier) + bold/italic + size + color | Zero embedding weight; renders identically in DOM overlay and pdf-lib export |

---

## Architecture

The single source of truth remains `bytes: Uint8Array` in the zustand store. Text overlays are a **separate, editable state layer** that never lives inside `bytes` until export. This keeps the "bytes in, bytes out" model intact for structural mutations while making text editing a live, reload-free experience.

```
usePdfStore
├── bytes / doc / docVersion / currentPage / zoom   (existing)
├── overlays: TextBox[]                              (new — editable text layer)
├── selectedBoxId: string | null                     (new)
└── tool: 'select' | 'text'                           (new)

Desk
└── .page-sheet
    ├── <canvas>        pdfjs read-only render (existing)
    └── <TextLayer>     absolute DOM overlay (new)
        └── per-box contenteditable + drag/resize handles

Header  → "Add text" tool toggle (existing export button unchanged)
TextToolbar → style controls for the selected box (new)

Export path: bakeOverlays(bytes, overlays) → pdf-lib drawText → download
```

Two libraries keep their existing jobs; text editing does not blur the boundary:

- **pdf-lib** — the only thing that mutates page structure and now also **draws overlay text at bake time**.
- **pdfjs-dist** — read-only rendering. In Phase 2 it additionally supplies `getTextContent()` for hit-testing existing text.

---

## Data Model

New store state:

```ts
type TextBox = {
  id: string            // stable unique id
  page: number          // 0-based page index the box belongs to
  xPt: number           // top-left x, PDF points (zoom-independent)
  yPt: number           // top-left y, PDF points, measured from page top
  wPt: number           // width, PDF points
  hPt: number           // height, PDF points
  text: string
  family: 'sans' | 'serif' | 'mono'
  sizePt: number        // font size in PDF points
  color: string         // hex, e.g. "#111111"
  bold: boolean
  italic: boolean
}
```

Added to `PdfState`:

```ts
overlays: TextBox[]
selectedBoxId: string | null
tool: 'select' | 'text'
```

**Why points, not pixels:** boxes are stored in PDF points so zoom changes only affect rendering, never the stored geometry. A box placed at 100% looks identical at 200% and exports to the same spot.

---

## Coordinate Model (the crux)

PDF space: origin bottom-left, y increases upward, unit = point (1/72 inch).
DOM space: origin top-left, y increases downward, unit = CSS pixel.

**Render (points → screen):** pdf.js renders the page at `scale = zoom`, so the canvas CSS size is `pagePt * zoom`. Each box's on-screen rect, positioned inside `.page-sheet` (the same box the canvas fills):

```
left   = xPt * zoom
top    = yPt * zoom
width  = wPt * zoom
height = hPt * zoom
fontPx = sizePt * zoom
```

CSS families map straight across: `sans → sans-serif`, `serif → serif`, `mono → monospace`, mirroring Helvetica / Times / Courier.

**Export (points → pdf-lib):** pdf-lib's origin is bottom-left, and `drawText` places the text **baseline**. For a box at `yPt` from the top of a page of height `Hpt`:

```
y_baseline = Hpt - yPt - ascent(font, sizePt)   // first line
```

Multi-line text wraps at the box width; each subsequent line drops by the line height. Baseline/ascent and wrapping are handled inside `bakeOverlays`, not by callers.

---

## Components

### `TextLayer.tsx` (new)
Absolutely-positioned `<div>` filling `.page-sheet`, mounted alongside the canvas in `Desk.tsx`. Responsibilities:

- Render only the current page's boxes (`overlays.filter(b => b.page === currentPage - 1)`).
- **Add:** when `tool === 'text'`, a click on empty space creates a box at the click point and selects it.
- **Select:** click a box → `selectedBoxId`.
- **Edit:** each box is `contenteditable`; typing updates `text`.
- **Drag:** pointer-drag the box body updates `xPt/yPt` (screen delta ÷ zoom).
- **Resize:** a corner handle updates `wPt/hPt`.
- **Deselect / discard:** clicking empty space (in select tool) deselects; a box left empty on blur is removed.

It receives `zoom` and the page's point dimensions from `Desk`. It owns no persistent state — every change flows through store actions.

### `TextToolbar.tsx` (new)
Shown when `selectedBoxId` is set. Controls: family (sans/serif/mono), size (number), color (picker), **B**, *I*, delete. Each control calls `updateTextBox(id, patch)`.

### `Desk.tsx` (modified)
Mounts `<TextLayer>` inside `.page-sheet`, passing `zoom` and page px dims. Existing render effect and page/zoom controls are unchanged.

### `Header.tsx` (modified)
Adds an "Add text" toggle that flips `tool` between `'select'` and `'text'`. The existing export button is unchanged (it now triggers the bake path).

---

## Store Actions

New:

```ts
setTool(tool)
addTextBox(box)                 // generates id, pushes, selects
updateTextBox(id, patch)        // shallow-merge a partial TextBox
removeTextBox(id)
selectBox(id | null)
```

None of these reload the doc — they mutate `overlays` / `selectedBoxId` / `tool` only, so typing and dragging are instant.

**Page-op remap (the one accepted chore):** `addBlankPage`, `removePage`, and `reorderPage` must apply the *same* index transform to `overlays[].page` that they apply to the pages themselves:

- `addBlankPage(afterIndex)` → boxes with `page > afterIndex` shift +1.
- `removePage(index)` → drop boxes with `page === index`; boxes with `page > index` shift −1.
- `reorderPage(from, to)` → apply the identical permutation used to reorder the pages to each box's `page`.

`reset()` clears `overlays`, `selectedBoxId`, and resets `tool` to `'select'`.

---

## Export / Bake

New in `src/lib/pdf.ts`:

```ts
async function bakeOverlays(bytes: Uint8Array, overlays: TextBox[]): Promise<Uint8Array>
```

- Load `bytes` with `PDFDocument`.
- Embed the needed standard fonts once, keyed by `(family, bold, italic)` → Helvetica / Times / Courier with their Bold / Oblique / BoldOblique variants.
- For each box: resolve the target page, convert point geometry to a bottom-left baseline, `page.drawText(text, { x, y, size, font, color, ... })` with width-based line wrapping.
- `.save()` → new bytes.

`exportPdf` in the store changes to: `const out = await bakeOverlays(bytes, overlays); download(out, ...)`. The bake output is **not** written back into store `bytes` — overlays stay live and editable after export.

---

## Phase 2 — Edit Existing Text (later)

Layered onto the same overlay machinery once Phase 1 ships:

1. In `tool === 'text'` (or a dedicated "edit text" tool), clicking the canvas hit-tests against `page.getTextContent()` items for the current page.
2. On a hit, spawn a `TextBox` prefilled with the extracted string, position, and best-effort size, plus a **cover rectangle** whose fill is sampled from a canvas pixel just outside the glyph run (to approximate the page background).
3. At bake time, draw the cover rectangle first, then the replacement text on top.

**Known fidelity limits (documented, not hidden):**

- Works acceptably for solid-color (esp. white) backgrounds.
- Breaks on colored gradients, textured, or image backgrounds — the cover rectangle will be visible.
- Font matching is approximate (mapped to the standard-3); exact original fonts are not recovered.
- Positioning is best-effort from the pdf.js text-item transform.

These limits are the reason Phase 1 (honest new-text overlays) ships first and stands on its own.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Text box left empty on blur | Silently removed |
| Invalid / unparseable color | Fall back to black `#000000` |
| Bake (export) throws | Existing store `error` field set → `Toast` + `StatusBar` show it |
| Phase 2: no text item under click | No-op (nothing spawned) |

---

## Testing

No unit-test runner is configured (consistent with the current project). Extend the existing end-to-end smoke script:

`scripts/smoke.mjs` gains a text-editing pass:

1. Load the sample PDF.
2. Activate the "Add text" tool, click the canvas, type a known sentinel string.
3. Trigger export; capture the downloaded bytes.
4. Reload the exported bytes with pdf.js and assert `getTextContent()` on the target page contains the sentinel string.
5. Exit non-zero on any failed assertion (matching the script's existing convention).

---

## Out of Scope (MVP)

- Custom font upload / embedding (needs `fontkit` + font files).
- Rich text within a single box (mixed styles per character).
- Text rotation.
- Word (.docx) and image export (tracked separately as their own spec).
- OCR of scanned/raster text.

---

## Success Criteria

- User can add a styled text box, move/resize/restyle it, across any page, with instant (< 50ms) feedback and no full-doc reload.
- Overlays survive page add/delete/reorder with correct page association.
- Export produces a PDF whose real text content includes the added text (verified by the smoke script).
- No new runtime dependency added; bundle stays lean.
- Phase 2 edit-existing works on solid-background text and degrades honestly (documented) elsewhere.
