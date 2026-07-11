# PDF Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add styled text boxes anywhere on a loaded PDF (place, drag, resize, font/size/color/bold/italic) and export a PDF whose real text content includes those additions.

**Architecture:** Text boxes live as a separate, editable `overlays: TextBox[]` layer in the zustand store — never written into `bytes` until export. A DOM overlay (`TextLayer`) positioned over the pdf.js render canvas handles all interaction; nothing reloads the doc while editing. On export, `bakeOverlays` uses `pdf-lib` to draw every box onto the pages and produce final bytes.

**Tech Stack:** React 19 + TypeScript + Vite, `pdf-lib` (mutation + bake), `pdfjs-dist` (render + text-extraction verification), Vitest (new, dev-only, unit tests), `puppeteer-core` (existing e2e smoke).

**Scope:** This plan covers **Phase 1 only** (add new text overlays) — a complete, shippable feature on its own. Phase 2 (edit existing text via redact + redraw) gets its own spec-to-plan cycle later, layered onto the same `TextBox` machinery.

## Global Constraints

- No new **runtime** dependency. Vitest is a **devDependency** only. (`.yarnrc` forces `--ignore-engines true` — keep it.)
- Overlay geometry is stored in **PDF points** (`xPt/yPt/wPt/hPt`, `sizePt`), never pixels — zoom affects only rendering.
- `TextBox.page` is **0-based**; the store's public API stays **1-based** (`oneBased` params). Convert at the store boundary only.
- Fonts limited to the standard-14: `sans`→Helvetica, `serif`→Times, `mono`→Courier, with Bold/Italic variants. No font embedding from files.
- pdf-lib coordinate origin is bottom-left; DOM origin is top-left. All conversion lives in `src/lib/overlay.ts` and `src/lib/bake.ts`.
- Don't inline the pdf.js worker (`?url` import in `src/lib/pdf.ts` must stay).
- Two libraries, two jobs: `pdf-lib` mutates/bakes, `pdfjs-dist` renders/extracts. Don't cross them.

---

### Task 1: Overlay core library + test harness

**Files:**
- Create: `src/lib/overlay.ts`
- Create: `src/lib/overlay.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDependency + `test` scripts)

**Interfaces:**
- Consumes: `StandardFonts` from `pdf-lib`.
- Produces (relied on by Tasks 2–5):
  - `type Family = 'sans' | 'serif' | 'mono'`
  - `interface TextBox { id: string; page: number; xPt: number; yPt: number; wPt: number; hPt: number; text: string; family: Family; sizePt: number; color: string; bold: boolean; italic: boolean }`
  - `nextId(): string` and `_resetIdCounter(): void`
  - `remapAfterInsert(boxes: TextBox[], insertIndex: number): TextBox[]`
  - `remapAfterDelete(boxes: TextBox[], deleteIndex: number): TextBox[]`
  - `remapAfterReorder(boxes: TextBox[], from: number, to: number, pageCount: number): TextBox[]`
  - `interface ScreenRect { left: number; top: number; width: number; height: number }`
  - `boxToScreen(box: TextBox, zoom: number): ScreenRect`
  - `pxToPt(px: number, zoom: number): number`
  - `firstBaselineY(pageHeightPt: number, yPt: number, sizePt: number): number`
  - `standardFont(family: Family, bold: boolean, italic: boolean): StandardFonts`
  - `interface Rgb01 { r: number; g: number; b: number }` and `parseHexColor(hex: string): Rgb01`
  - constants `ASCENT_RATIO = 0.8`, `LINE_HEIGHT_RATIO = 1.15`

- [ ] **Step 1: Initialize git (workspace is not a repo yet)**

Run:
```bash
cd /Users/arsalaanabbas.zaidi/Projects/pdf-editor
git init && printf "node_modules/\ndist/\n*.tsbuildinfo\n" > .gitignore
git add -A && git commit -m "chore: init git repo for paperdesk"
```
Expected: repo created, initial commit succeeds.

- [ ] **Step 2: Add Vitest as a dev dependency and test scripts**

Run:
```bash
yarn add -D vitest
```
Then edit `package.json` `"scripts"` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```
Expected: `vitest` appears under `devDependencies`; `yarn test` is runnable (will report "no test files" until Step 4).

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Write the failing test** — `src/lib/overlay.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { StandardFonts } from 'pdf-lib'
import {
  type TextBox,
  nextId,
  _resetIdCounter,
  remapAfterInsert,
  remapAfterDelete,
  remapAfterReorder,
  boxToScreen,
  pxToPt,
  firstBaselineY,
  standardFont,
  parseHexColor,
} from './overlay'

const box = (page: number): TextBox => ({
  id: `b${page}`, page, xPt: 10, yPt: 20, wPt: 100, hPt: 30,
  text: 'x', family: 'sans', sizePt: 16, color: '#111111', bold: false, italic: false,
})

beforeEach(() => _resetIdCounter())

describe('nextId', () => {
  it('produces sequential unique ids', () => {
    expect(nextId()).toBe('tb_1')
    expect(nextId()).toBe('tb_2')
  })
})

describe('page-key remap', () => {
  it('insert shifts pages at/after the insertion index up by one', () => {
    const out = remapAfterInsert([box(0), box(1), box(2)], 1).map((b) => b.page)
    expect(out).toEqual([0, 2, 3])
  })
  it('delete drops the deleted page and shifts later pages down', () => {
    const out = remapAfterDelete([box(0), box(1), box(2)], 1).map((b) => b.page)
    expect(out).toEqual([0, 1]) // page1 dropped, page2 -> 1
  })
  it('reorder applies the same permutation as moving a page', () => {
    // pages [0,1,2,3], move page 0 to index 2 => order [1,2,0,3]
    const out = remapAfterReorder([box(0), box(3)], 0, 2, 4).map((b) => b.page)
    expect(out).toEqual([2, 3]) // old page0 -> pos2, old page3 -> pos3
  })
})

describe('coordinate helpers', () => {
  it('boxToScreen scales points by zoom', () => {
    expect(boxToScreen(box(0), 2)).toEqual({ left: 20, top: 40, width: 200, height: 60 })
  })
  it('pxToPt divides by zoom', () => {
    expect(pxToPt(200, 2)).toBe(100)
  })
  it('firstBaselineY flips origin and drops by ascent', () => {
    // 800 - 20 - 16*0.8 = 767.2
    expect(firstBaselineY(800, 20, 16)).toBeCloseTo(767.2)
  })
})

describe('standardFont', () => {
  it('maps family + weight + style to standard-14 fonts', () => {
    expect(standardFont('sans', false, false)).toBe(StandardFonts.Helvetica)
    expect(standardFont('sans', true, true)).toBe(StandardFonts.HelveticaBoldOblique)
    expect(standardFont('serif', true, false)).toBe(StandardFonts.TimesRomanBold)
    expect(standardFont('mono', false, true)).toBe(StandardFonts.CourierOblique)
  })
})

describe('parseHexColor', () => {
  it('parses #rrggbb into 0..1 channels', () => {
    expect(parseHexColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
  })
  it('expands #rgb shorthand', () => {
    expect(parseHexColor('#0f0')).toEqual({ r: 0, g: 1, b: 0 })
  })
  it('falls back to black on bad input', () => {
    expect(parseHexColor('nonsense')).toEqual({ r: 0, g: 0, b: 0 })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `yarn test`
Expected: FAIL — `Failed to resolve import "./overlay"` / functions not defined.

- [ ] **Step 6: Write `src/lib/overlay.ts`**

```ts
import { StandardFonts } from 'pdf-lib'

export type Family = 'sans' | 'serif' | 'mono'

export interface TextBox {
  id: string
  page: number // 0-based page index
  xPt: number // top-left, PDF points
  yPt: number
  wPt: number
  hPt: number
  text: string
  family: Family
  sizePt: number
  color: string // hex
  bold: boolean
  italic: boolean
}

let _idCounter = 0
export function nextId(): string {
  _idCounter += 1
  return `tb_${_idCounter}`
}
/** Test helper: reset the id counter for deterministic ids. */
export function _resetIdCounter(): void {
  _idCounter = 0
}

// --- page-key remap (0-based indices, mirror the page mutation) ---

export function remapAfterInsert(boxes: TextBox[], insertIndex: number): TextBox[] {
  return boxes.map((b) => (b.page >= insertIndex ? { ...b, page: b.page + 1 } : b))
}

export function remapAfterDelete(boxes: TextBox[], deleteIndex: number): TextBox[] {
  return boxes
    .filter((b) => b.page !== deleteIndex)
    .map((b) => (b.page > deleteIndex ? { ...b, page: b.page - 1 } : b))
}

export function remapAfterReorder(
  boxes: TextBox[],
  from: number,
  to: number,
  pageCount: number,
): TextBox[] {
  // Rebuild the exact permutation movePage() applies to the pages.
  const order = Array.from({ length: pageCount }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  // A box on old page p lands at the new position order.indexOf(p).
  return boxes.map((b) => ({ ...b, page: order.indexOf(b.page) }))
}

// --- coordinate helpers ---

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export function boxToScreen(box: TextBox, zoom: number): ScreenRect {
  return { left: box.xPt * zoom, top: box.yPt * zoom, width: box.wPt * zoom, height: box.hPt * zoom }
}

export function pxToPt(px: number, zoom: number): number {
  return px / zoom
}

export const ASCENT_RATIO = 0.8
export const LINE_HEIGHT_RATIO = 1.15

/** pdf-lib baseline (bottom-left origin) for the first line of a top-anchored box. */
export function firstBaselineY(pageHeightPt: number, yPt: number, sizePt: number): number {
  return pageHeightPt - yPt - sizePt * ASCENT_RATIO
}

// --- font + color mapping ---

export function standardFont(family: Family, bold: boolean, italic: boolean): StandardFonts {
  switch (family) {
    case 'serif':
      if (bold && italic) return StandardFonts.TimesRomanBoldItalic
      if (bold) return StandardFonts.TimesRomanBold
      if (italic) return StandardFonts.TimesRomanItalic
      return StandardFonts.TimesRoman
    case 'mono':
      if (bold && italic) return StandardFonts.CourierBoldOblique
      if (bold) return StandardFonts.CourierBold
      if (italic) return StandardFonts.CourierOblique
      return StandardFonts.Courier
    case 'sans':
    default:
      if (bold && italic) return StandardFonts.HelveticaBoldOblique
      if (bold) return StandardFonts.HelveticaBold
      if (italic) return StandardFonts.HelveticaOblique
      return StandardFonts.Helvetica
  }
}

export interface Rgb01 {
  r: number
  g: number
  b: number
}

export function parseHexColor(hex: string): Rgb01 {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn test`
Expected: PASS — all `overlay.test.ts` cases green.

- [ ] **Step 8: Commit**

```bash
git add package.json yarn.lock vitest.config.ts src/lib/overlay.ts src/lib/overlay.test.ts
git commit -m "feat: overlay core (TextBox, page-key remap, coord + font helpers) + vitest"
```

---

### Task 2: Bake overlays into PDF bytes

**Files:**
- Create: `src/lib/bake.ts`
- Create: `src/lib/bake.test.ts`

**Interfaces:**
- Consumes: `TextBox`, `standardFont`, `parseHexColor`, `firstBaselineY`, `LINE_HEIGHT_RATIO` from `./overlay`; `PDFDocument`, `rgb`, `PDFFont` from `pdf-lib`.
- Produces (relied on by Task 3):
  - `wrapLines(text: string, font: PDFFont, sizePt: number, maxWpt: number): string[]`
  - `bakeOverlays(bytes: Uint8Array, boxes: TextBox[]): Promise<Uint8Array>`

- [ ] **Step 1: Write the failing test** — `src/lib/bake.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bakeOverlays, wrapLines } from './bake'
import type { TextBox } from './overlay'

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([600, 800])
  return doc.save()
}

const boxWith = (text: string): TextBox => ({
  id: 'b1', page: 0, xPt: 50, yPt: 50, wPt: 400, hPt: 200,
  text, family: 'sans', sizePt: 24, color: '#000000', bold: false, italic: false,
})

async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((i: { str?: string }) => i.str ?? '').join(' ')
}

describe('wrapLines', () => {
  it('splits on explicit newlines', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    expect(wrapLines('a\nb', font, 12, 1000)).toEqual(['a', 'b'])
  })
  it('greedily wraps long text to the max width', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const lines = wrapLines('word word word word word word', font, 24, 120)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('bakeOverlays', () => {
  it('preserves page count and returns valid PDF bytes', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('Hello')])
    expect(out.length).toBeGreaterThan(0)
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })
  it('writes real, extractable text into the exported PDF', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('SmokeSentinel')])
    const text = await extractText(out)
    expect(text).toContain('SmokeSentinel')
  })
  it('skips empty boxes and out-of-range pages without throwing', async () => {
    const out = await bakeOverlays(await blankPdf(), [
      boxWith('   '),
      { ...boxWith('offpage'), page: 99 },
    ])
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/lib/bake.test.ts`
Expected: FAIL — `Failed to resolve import "./bake"`.

- [ ] **Step 3: Write `src/lib/bake.ts`**

```ts
import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import {
  type TextBox,
  standardFont,
  parseHexColor,
  firstBaselineY,
  LINE_HEIGHT_RATIO,
} from './overlay'

/** Greedy word-wrap to a max width in points; honours explicit newlines. */
export function wrapLines(text: string, font: PDFFont, sizePt: number, maxWpt: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const trial = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(trial, sizePt) > maxWpt) {
        out.push(line)
        line = word
      } else {
        line = trial
      }
    }
    out.push(line)
  }
  return out
}

/** Draw every overlay box onto its page and return new PDF bytes. Never mutates input. */
export async function bakeOverlays(bytes: Uint8Array, boxes: TextBox[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()
  const fontCache = new Map<string, PDFFont>()

  for (const box of boxes) {
    if (!box.text.trim()) continue
    const page = pages[box.page]
    if (!page) continue

    const fontName = standardFont(box.family, box.bold, box.italic)
    let font = fontCache.get(fontName)
    if (!font) {
      font = await doc.embedFont(fontName)
      fontCache.set(fontName, font)
    }

    const { r, g, b } = parseHexColor(box.color)
    const pageHeight = page.getHeight()
    const lineHeight = box.sizePt * LINE_HEIGHT_RATIO
    let y = firstBaselineY(pageHeight, box.yPt, box.sizePt)

    for (const line of wrapLines(box.text, font, box.sizePt, box.wPt)) {
      page.drawText(line, { x: box.xPt, y, size: box.sizePt, font, color: rgb(r, g, b) })
      y -= lineHeight
    }
  }

  return doc.save()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/lib/bake.test.ts`
Expected: PASS — including the pdfjs text-extraction round-trip (`SmokeSentinel` found). pdfjs prints a fake-worker warning in node; that is expected and harmless.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bake.ts src/lib/bake.test.ts
git commit -m "feat: bakeOverlays draws text boxes into exported PDF (verified round-trip)"
```

---

### Task 3: Store integration (overlay state, actions, remap wiring, bake on export)

**Files:**
- Modify: `src/store/usePdfStore.ts`
- Create: `src/store/usePdfStore.test.ts`

**Interfaces:**
- Consumes: `TextBox`, `nextId`, `remapAfterInsert`, `remapAfterDelete`, `remapAfterReorder` from `../lib/overlay`; `bakeOverlays` from `../lib/bake`.
- Produces (relied on by Tasks 4–5), added to `PdfState`:
  - `tool: 'select' | 'text'`
  - `overlays: TextBox[]`
  - `selectedBoxId: string | null`
  - `setTool(t: 'select' | 'text'): void`
  - `addTextBox(box: Omit<TextBox, 'id'>): void` (assigns id, appends, selects it)
  - `updateTextBox(id: string, patch: Partial<TextBox>): void`
  - `removeTextBox(id: string): void`
  - `selectBox(id: string | null): void`
  - `exportPdf` becomes `() => Promise<void>` and bakes overlays before download.

- [ ] **Step 1: Write the failing test** — `src/store/usePdfStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePdfStore } from './usePdfStore'
import { _resetIdCounter, type TextBox } from '../lib/overlay'

const base: Omit<TextBox, 'id'> = {
  page: 0, xPt: 10, yPt: 10, wPt: 100, hPt: 30,
  text: 'hi', family: 'sans', sizePt: 16, color: '#111111', bold: false, italic: false,
}

beforeEach(() => {
  _resetIdCounter()
  usePdfStore.setState({ overlays: [], selectedBoxId: null, tool: 'select' })
})

describe('overlay actions', () => {
  it('addTextBox assigns an id, appends, and selects it', () => {
    usePdfStore.getState().addTextBox(base)
    const s = usePdfStore.getState()
    expect(s.overlays).toHaveLength(1)
    expect(s.overlays[0].id).toBe('tb_1')
    expect(s.selectedBoxId).toBe('tb_1')
  })

  it('updateTextBox shallow-merges a patch', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().updateTextBox('tb_1', { text: 'bye', bold: true })
    const box = usePdfStore.getState().overlays[0]
    expect(box.text).toBe('bye')
    expect(box.bold).toBe(true)
    expect(box.family).toBe('sans') // untouched
  })

  it('removeTextBox drops the box and clears selection if it was selected', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().removeTextBox('tb_1')
    expect(usePdfStore.getState().overlays).toHaveLength(0)
    expect(usePdfStore.getState().selectedBoxId).toBeNull()
  })

  it('setTool toggles the active tool', () => {
    usePdfStore.getState().setTool('text')
    expect(usePdfStore.getState().tool).toBe('text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/store/usePdfStore.test.ts`
Expected: FAIL — `addTextBox is not a function`.

- [ ] **Step 3: Add imports and state fields to `src/store/usePdfStore.ts`**

At the top, extend the existing import from `../lib/pdf` and add overlay imports:
```ts
import {
  type TextBox,
  nextId,
  remapAfterInsert,
  remapAfterDelete,
  remapAfterReorder,
} from '../lib/overlay'
import { bakeOverlays } from '../lib/bake'
```

In the `PdfState` interface, add fields (near `zoom`) and change `exportPdf`:
```ts
  tool: 'select' | 'text'
  overlays: TextBox[]
  selectedBoxId: string | null

  setTool: (t: 'select' | 'text') => void
  addTextBox: (box: Omit<TextBox, 'id'>) => void
  updateTextBox: (id: string, patch: Partial<TextBox>) => void
  removeTextBox: (id: string) => void
  selectBox: (id: string | null) => void
  exportPdf: () => Promise<void>
```

In the returned object initial state (near `zoom: 1,`), add:
```ts
    tool: 'select',
    overlays: [],
    selectedBoxId: null,
```

- [ ] **Step 4: Add the synchronous overlay actions**

Insert these actions into the returned store object (e.g. after `setZoom`):
```ts
    setTool(tool) {
      set({ tool })
    },

    addTextBox(box) {
      const id = nextId()
      set((s) => ({ overlays: [...s.overlays, { ...box, id }], selectedBoxId: id }))
    },

    updateTextBox(id, patch) {
      set((s) => ({
        overlays: s.overlays.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }))
    },

    removeTextBox(id) {
      set((s) => ({
        overlays: s.overlays.filter((b) => b.id !== id),
        selectedBoxId: s.selectedBoxId === id ? null : s.selectedBoxId,
      }))
    },

    selectBox(id) {
      set({ selectedBoxId: id })
    },
```

- [ ] **Step 5: Wire remap into the page-mutation actions**

In `addBlankPage`, after the successful `await applyBytes(...)` line, add:
```ts
        set((s) => ({ overlays: remapAfterInsert(s.overlays, afterOneBased) }))
```
In `removePage`, after `await applyBytes(...)`, add:
```ts
        set((s) => ({ overlays: remapAfterDelete(s.overlays, oneBased - 1) }))
```
In `reorderPage`, replace the whole `try` block so the page count is captured before mutating and overlays are remapped after the reload:
```ts
      try {
        const count = get().numPages
        const next = await movePage(bytes, fromOneBased - 1, toOneBased - 1)
        await applyBytes(next, toOneBased)
        set((s) => ({
          overlays: remapAfterReorder(s.overlays, fromOneBased - 1, toOneBased - 1, count),
        }))
        set({ status: 'Pages reordered' })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
```

- [ ] **Step 6: Make `exportPdf` bake overlays**

Replace the existing synchronous `exportPdf` with:
```ts
    async exportPdf() {
      const { bytes, fileName, overlays } = get()
      if (!bytes) return
      set({ busy: true, status: 'Exporting…', error: null })
      try {
        const out = await bakeOverlays(bytes, overlays)
        const base = (fileName ?? 'document').replace(/\.pdf$/i, '')
        download(out, `${base}-edited.pdf`)
        set({ status: 'Exported PDF' })
      } catch (e) {
        set({ error: `Export failed: ${(e as Error).message}` })
      } finally {
        set({ busy: false })
      }
    },
```

- [ ] **Step 7: Clear overlays in `reset()`**

In `reset()`, add to the `set({...})` payload:
```ts
        tool: 'select',
        overlays: [],
        selectedBoxId: null,
```

- [ ] **Step 8: Run tests + typecheck**

Run: `yarn test && yarn build`
Expected: All Vitest suites PASS; `tsc -b && vite build` completes with no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/store/usePdfStore.ts src/store/usePdfStore.test.ts
git commit -m "feat: store overlay state, actions, page-key remap, bake on export"
```

---

### Task 4: Interactive text layer + toolbar + wiring

**Files:**
- Create: `src/components/TextLayer.tsx`
- Create: `src/components/TextToolbar.tsx`
- Modify: `src/components/Desk.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/styles/index.css`

**Interfaces:**
- Consumes: store fields/actions from Task 3; `boxToScreen`, `pxToPt`, `TextBox`, `Family` from `../lib/overlay`.
- Produces (relied on by Task 5 — smoke selectors):
  - `[data-testid="tool-text"]` — the "Add text" toggle button in the Header.
  - `[data-testid="text-layer"]` — the overlay container in Desk.
  - `.text-box` / `.text-box-edit` — each editable box; `[data-testid="text-toolbar"]` — the style toolbar.

**Verification note:** DOM drag/contenteditable is verified by build + the Task 5 e2e smoke, not jsdom unit tests (that is the sound test boundary here).

- [ ] **Step 1: Create `src/components/TextLayer.tsx`**

```tsx
import { useRef } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import { boxToScreen, pxToPt, type TextBox } from '../lib/overlay'

interface Props {
  wPx: number
  hPx: number
}

const DEFAULT_SIZE_PT = 16

const cssFamily = (f: TextBox['family']) =>
  f === 'serif' ? 'serif' : f === 'mono' ? 'monospace' : 'sans-serif'

export default function TextLayer({ wPx, hPx }: Props) {
  const { overlays, currentPage, zoom, tool, selectedBoxId, addTextBox, updateTextBox, selectBox } =
    usePdfStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const pageIndex = currentPage - 1
  const boxes = overlays.filter((b) => b.page === pageIndex)

  function onLayerPointerDown(e: React.PointerEvent) {
    if (e.target !== layerRef.current) return // a box (child) was clicked
    if (tool !== 'text') {
      selectBox(null)
      return
    }
    const rect = layerRef.current!.getBoundingClientRect()
    addTextBox({
      page: pageIndex,
      xPt: pxToPt(e.clientX - rect.left, zoom),
      yPt: pxToPt(e.clientY - rect.top, zoom),
      wPt: 160,
      hPt: DEFAULT_SIZE_PT * 1.6,
      text: '',
      family: 'sans',
      sizePt: DEFAULT_SIZE_PT,
      color: '#111111',
      bold: false,
      italic: false,
    })
  }

  function drag(box: TextBox, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const o = { xPt: box.xPt, yPt: box.yPt, wPt: box.wPt, hPt: box.hPt }
    const move = (ev: PointerEvent) => {
      const dx = pxToPt(ev.clientX - sx, zoom)
      const dy = pxToPt(ev.clientY - sy, zoom)
      if (mode === 'move') updateTextBox(box.id, { xPt: o.xPt + dx, yPt: o.yPt + dy })
      else updateTextBox(box.id, { wPt: Math.max(24, o.wPt + dx), hPt: Math.max(16, o.hPt + dy) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={layerRef}
      className={`text-layer${tool === 'text' ? ' adding' : ''}`}
      data-testid="text-layer"
      style={{ width: wPx, height: hPx }}
      onPointerDown={onLayerPointerDown}
    >
      {boxes.map((box) => {
        const r = boxToScreen(box, zoom)
        const selected = selectedBoxId === box.id
        return (
          <div
            key={box.id}
            className={`text-box${selected ? ' selected' : ''}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectBox(box.id)
            }}
          >
            {selected && (
              <span className="drag-handle" onPointerDown={(e) => drag(box, e, 'move')} />
            )}
            <div
              className="text-box-edit"
              contentEditable
              suppressContentEditableWarning
              style={{
                fontFamily: cssFamily(box.family),
                fontSize: box.sizePt * zoom,
                color: box.color,
                fontWeight: box.bold ? 700 : 400,
                fontStyle: box.italic ? 'italic' : 'normal',
              }}
              // Sync external text in only when not focused, to avoid caret jumps.
              ref={(el) => {
                if (el && document.activeElement !== el && el.innerText !== box.text) {
                  el.innerText = box.text
                }
              }}
              onInput={(e) => updateTextBox(box.id, { text: (e.target as HTMLElement).innerText })}
              onBlur={(e) => {
                if (!(e.target as HTMLElement).innerText.trim())
                  usePdfStore.getState().removeTextBox(box.id)
              }}
            />
            {selected && (
              <span className="resize-handle" onPointerDown={(e) => drag(box, e, 'resize')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/TextToolbar.tsx`**

```tsx
import { usePdfStore } from '../store/usePdfStore'
import type { Family } from '../lib/overlay'

export default function TextToolbar() {
  const { overlays, selectedBoxId, updateTextBox, removeTextBox } = usePdfStore()
  const box = overlays.find((b) => b.id === selectedBoxId)
  if (!box) return null
  const patch = (p: Partial<typeof box>) => updateTextBox(box.id, p)

  return (
    <div className="text-toolbar" role="toolbar" aria-label="Text style" data-testid="text-toolbar">
      <select
        value={box.family}
        onChange={(e) => patch({ family: e.target.value as Family })}
        aria-label="Font family"
      >
        <option value="sans">Sans</option>
        <option value="serif">Serif</option>
        <option value="mono">Mono</option>
      </select>
      <input
        className="size mono"
        type="number"
        min={6}
        max={144}
        value={box.sizePt}
        onChange={(e) => patch({ sizePt: Number(e.target.value) || box.sizePt })}
        aria-label="Font size"
      />
      <input
        type="color"
        value={box.color}
        onChange={(e) => patch({ color: e.target.value })}
        aria-label="Text color"
      />
      <button
        className={`btn icon ghost${box.bold ? ' active' : ''}`}
        onClick={() => patch({ bold: !box.bold })}
        aria-label="Bold"
      >
        <b>B</b>
      </button>
      <button
        className={`btn icon ghost${box.italic ? ' active' : ''}`}
        onClick={() => patch({ italic: !box.italic })}
        aria-label="Italic"
      >
        <i>I</i>
      </button>
      <span className="divider" />
      <button
        className="btn icon ghost danger"
        onClick={() => removeTextBox(box.id)}
        aria-label="Delete text box"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Mount the layer + toolbar in `src/components/Desk.tsx`**

Add imports at top:
```tsx
import TextLayer from './TextLayer'
import TextToolbar from './TextToolbar'
```
Inside `.page-sheet`, right after `<canvas ref={canvasRef} />`, add:
```tsx
        {dims && <TextLayer wPx={dims.w * zoom} hPx={dims.h * zoom} />}
```
Add the toolbar just inside the top of the returned `<div className="desk">`, before `.page-sheet`:
```tsx
      <TextToolbar />
```

- [ ] **Step 4: Add the "Add text" tool toggle in `src/components/Header.tsx`**

Extend the store destructure:
```tsx
  const { doc, fileName, fileSize, currentPage, loadFile, exportPdf, busy, tool, setTool } =
    usePdfStore()
```
In the `{doc && (...)}` button group, add as the first button:
```tsx
          <button
            className={`btn${tool === 'text' ? ' active' : ''}`}
            data-testid="tool-text"
            onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
            disabled={busy}
          >
            ＋ Add text
          </button>
```

- [ ] **Step 5: Add styles to `src/styles/index.css`**

Append:
```css
.page-sheet { position: relative; }

.text-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
}
.text-layer.adding { cursor: text; }

.text-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid transparent;
}
.text-box.selected { border-color: #4c8bf5; }

.text-box-edit {
  width: 100%;
  height: 100%;
  outline: none;
  white-space: pre-wrap;
  overflow: hidden;
  line-height: 1.15;
}

.drag-handle {
  position: absolute;
  top: -14px;
  left: 0;
  width: 100%;
  height: 12px;
  cursor: move;
  background: #4c8bf5;
  opacity: 0.5;
  border-radius: 2px;
}
.resize-handle {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
  background: #4c8bf5;
  border-radius: 2px;
}

.text-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
.text-toolbar .size { width: 56px; }
.btn.active { background: #4c8bf5; color: #fff; }
```

- [ ] **Step 6: Typecheck + build**

Run: `yarn build`
Expected: `tsc -b && vite build` completes, no type errors.

- [ ] **Step 7: Manually verify in the dev server**

Run `yarn dev`, load a PDF, click **＋ Add text**, click the page, type. Confirm: box appears, typing works, toolbar changes font/size/color/bold/italic live, drag handle moves it, resize handle resizes, clicking empty space with the tool off deselects, an emptied box disappears on blur.

- [ ] **Step 8: Commit**

```bash
git add src/components/TextLayer.tsx src/components/TextToolbar.tsx src/components/Desk.tsx src/components/Header.tsx src/styles/index.css
git commit -m "feat: interactive text layer, style toolbar, Add-text tool"
```

---

### Task 5: End-to-end smoke coverage

**Files:**
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: selectors from Task 4 (`[data-testid="tool-text"]`, `.text-layer`, `.text-box-edit`), and the existing `button.primary` export button.

- [ ] **Step 1: Add a text-editing pass to `scripts/smoke.mjs`**

Insert the following block **after** the "delete page → 3 pages" check (line ~105) and **before** the "Export PDF" block (line ~107):

```js
  // --- Text editing: add a box, type a sentinel, confirm it holds the text ---
  const SENTINEL = 'SmokeSentinel'
  await page.click('[data-testid="tool-text"]')

  // Click near the top-left of the page to spawn a text box.
  const layer = await page.waitForSelector('.text-layer', { timeout: 4000 })
  const lb = await layer.boundingBox()
  await page.mouse.click(lb.x + 40, lb.y + 40)

  const editable = await page.waitForSelector('.text-box-edit', { timeout: 4000 })
  await editable.focus()
  await page.keyboard.type(SENTINEL)

  const typed = await page.$eval('.text-box-edit', (el) => el.innerText)
  ok('text box captures typed text', typed.includes(SENTINEL), `got "${typed}"`)
  await page.screenshot({ path: `${SHOTS}/03-text-added.png` })
```

- [ ] **Step 2: Assert the exported PDF is a valid file after export**

Replace the existing export block's post-click wait with a download-file check. After `await page.click('button.primary')`, use:

```js
  await new Promise((r) => setTimeout(r, 2000))
  const { readdirSync, readFileSync } = await import('node:fs')
  const pdfs = readdirSync(SHOTS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  const exported = pdfs.length > 0
  let validHeader = false
  if (exported) {
    const head = readFileSync(`${SHOTS}/${pdfs[0]}`).subarray(0, 5).toString('latin1')
    validHeader = head === '%PDF-'
  }
  ok('export produced a .pdf file', exported, pdfs.join(', '))
  ok('exported file has a valid PDF header', validHeader)
```

(Text round-trip inside the exported bytes is already asserted by `bake.test.ts`; the smoke confirms the UI-to-download path end-to-end.)

- [ ] **Step 3: Run the full smoke test**

Run (dev server in another terminal on port 5199):
```bash
node scripts/make-test-pdf.mjs /tmp/test.pdf
yarn dev &
node scripts/smoke.mjs http://localhost:5199/ /tmp/test.pdf /tmp/shots
```
Expected: `N/N checks passed`, process exit 0, including the two new text-editing checks and a valid exported PDF.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test: e2e smoke covers add-text flow and export validity"
```

---

## Final verification

- [ ] `yarn test` — all Vitest suites pass (overlay, bake round-trip, store).
- [ ] `yarn build` — clean type-check and production build.
- [ ] `yarn lint` — no new lint errors.
- [ ] `node scripts/smoke.mjs ...` — full e2e green, exit 0.

## Out of scope (Phase 2, separate plan)

Edit-existing text via redact + redraw: hit-test `page.getTextContent()`, spawn a prefilled `TextBox` plus a background-sampled cover rectangle, bake rect-then-text. Documented fidelity limits (solid backgrounds only). Reuses the entire `TextBox`/`bakeOverlays`/`TextLayer` machinery built here.
