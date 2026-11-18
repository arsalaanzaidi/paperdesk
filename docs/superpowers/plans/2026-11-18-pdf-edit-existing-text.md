# Edit Existing Text (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click text that already exists in a PDF, edit it in place, and have export cover the original glyphs with a background-matched rectangle and draw the edited text on top.

**Architecture:** A click on existing text with the new `'edit'` tool becomes another way to spawn a Phase-1 `TextBox`, one that carries an optional `coverColor`. pdf.js `getTextContent()` supplies hit-test rects and style guesses (new `src/lib/textItems.ts`). The cover colour is sampled from one canvas pixel just left of the run. At bake time pdf-lib draws a filled rectangle before the box's text. No new store actions and no new overlay array.

**Tech Stack:** React 19, TypeScript 5.7 (strict), Vite 6, zustand, pdf-lib 1.17, pdfjs-dist 4.10.38, vitest 2 (node environment), puppeteer-core smoke script.

**Spec:** [`docs/superpowers/specs/2026-07-12-pdf-edit-existing-text-design.md`](../specs/2026-07-12-pdf-edit-existing-text-design.md)

## Global Constraints

- No new runtime dependency. pdfjs `getTextContent()` is already bundled.
- pdf-lib is the only thing that mutates page structure or draws overlay content (rectangles and text) at bake time. pdfjs-dist stays read-only.
- Coordinates stay in the existing top-left-origin PDF-point space (`xPt/yPt/wPt/hPt`) that `TextBox` uses. No new coordinate system.
- Boxes without `coverColor` (Phase-1 add-boxes) must bake byte-for-byte the same way as today.
- Cover-colour fallback is white: `#FFFFFF`.
- Dedup tolerance: an existing box whose `(xPt, yPt)` is within `2` pt of the hit rect is selected instead of spawning a new one.
- Redaction warning, verbatim, on the "Edit text" button's `title`: *Covers and replaces existing text visually — the original text is not removed from the file and can still be extracted by other tools.*
- This is **not** secure redaction. Do not claim otherwise in code comments, UI copy or commit messages.
- Node 18 is supported. `.yarnrc` sets `--ignore-engines true`, so keep using `yarn`.
- **Git persona (every commit):** run `git config user.email` from inside `pdf-editor/` right before committing. It must print the personal address `arsalaan.z99@gmail.com`. If it prints the work address, stop and fix it repo-locally (`git config --local ...`). Never edit `~/.gitconfig` or `~/.config/git-persona/*`.
- Commands, all run from `pdf-editor/`: `yarn test` (vitest), `yarn build` (`tsc -b && vite build`), `yarn lint` (eslint, includes `eslint-plugin-react-hooks` v7, which flags synchronous `setState` inside effects).

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/textItems.ts` | Create | Pure logic for pdf.js text items: convert to pt rects, guess style from font name, hit-test, dedup lookup, and `extractTextItems(page)` |
| `src/lib/textItems.test.ts` | Create | Unit tests for the above, including a real pdf-lib → pdf.js round trip |
| `src/lib/pdf.ts` | Modify | Add a thin `getPageTextItems(doc, pageNumber)` wrapper next to `renderPage` |
| `src/lib/overlay.ts` | Modify | `TextBox.coverColor?`, `rgbToHex`, `coverSamplePoint`, `sampleColorAt`, `contrastText` |
| `src/lib/overlay.test.ts` | Modify | Tests for the new colour helpers |
| `src/lib/bake.ts` | Modify | Draw the cover rect before text when `coverColor` is set |
| `src/lib/bake.test.ts` | Modify | Operator-list tests for rect order and for no rect without `coverColor` |
| `src/store/usePdfStore.ts` | Modify | `Tool` type gains `'edit'` |
| `src/store/usePdfStore.test.ts` | Modify | `setTool('edit')` and reset test |
| `src/components/TextLayer.tsx` | Modify | Edit-tool branch: cache items, hit-test, dedup, sample, spawn, auto-focus |
| `src/components/Desk.tsx` | Modify | Pass `canvasRef` to `TextLayer` |
| `src/components/Header.tsx` | Modify | "Edit text" toggle with the redaction warning |
| `src/styles/index.css` | Modify | `.text-layer.editing` cursor |
| `scripts/smoke.mjs` | Modify | Edit-text end-to-end pass and exported-text assertions |

Why `textItems.ts` is separate from `pdf.ts`: `pdf.ts` imports the Vite-only worker URL (`?url`) and sets `GlobalWorkerOptions`, and `usePdfStore.test.ts` mocks the whole module. Keeping the logic in its own file makes it testable in node with the legacy pdfjs build, the same way `bake.test.ts` already works. `pdf.ts` keeps the `getPageTextItems` entry point the spec names.

Facts checked against pdfjs-dist 4.10.38 in node (2026-11-18), which the code below relies on:
- `item.fontName` is an internal id such as `g_d0_f1`, not a font name.
- `content.styles[id].fontFamily` is a generic family: `sans-serif`, `serif` or `monospace`.
- The real base font name (for example `Helvetica-Bold`) and its `bold`/`italic` flags are only in `page.commonObjs.get(id)`, and only after the page's operator list has been built (by `render()` or `getOperatorList()`).
- `getTextContent()` emits zero-width items with an empty `str` before each real run. These must be filtered out.
- For an unrotated page at scale 1, `viewport.transform` is `[1, 0, 0, -1, 0, pageHeight]`, and `item.transform[4..5]` is the baseline origin in PDF space.
- pdf-lib `drawRectangle({x, y, ...})` appears in the operator list as `setFillRGBColor` (bytes 0–255), then `transform [1,0,0,1,x,y]`, `constructPath` and `fill`.

---

### Task 0: Commit the spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-07-12-pdf-edit-existing-text-design.md` (already written, untracked)
- Add: `docs/superpowers/plans/2026-11-18-pdf-edit-existing-text.md` (this file)

- [ ] **Step 1: Check the git persona**

Run: `git config user.email`
Expected: `arsalaan.z99@gmail.com`

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-12-pdf-edit-existing-text-design.md docs/superpowers/plans/2026-11-18-pdf-edit-existing-text.md
git commit -m "docs: add Phase 2 edit-existing-text spec and implementation plan"
```

---

### Task 1: Text-item extraction, hit-testing and dedup

**Files:**
- Create: `src/lib/textItems.ts`
- Create: `src/lib/textItems.test.ts`
- Modify: `src/lib/pdf.ts` (append one function and one import)

**Interfaces:**
- Consumes: `ASCENT_RATIO`, `LINE_HEIGHT_RATIO`, `type Family`, `type TextBox` from `src/lib/overlay.ts` (all exist today).
- Produces:
  - `interface PageTextItem { str: string; xPt: number; yPt: number; wPt: number; hPt: number; sizePt: number; family: Family; bold: boolean; italic: boolean }`
  - `interface FontGuess { family: Family; bold: boolean; italic: boolean }`
  - `guessStyle(baseName: string, genericFamily: string, boldFlag?: boolean, italicFlag?: boolean): FontGuess`
  - `toPageTextItem(raw: RawTextItem, viewportTransform: number[], style: FontGuess): PageTextItem | null`
  - `extractTextItems(page: PDFPageProxy): Promise<PageTextItem[]>`
  - `hitTest(items: PageTextItem[], xPt: number, yPt: number): PageTextItem | null`
  - `findBoxAt(boxes: TextBox[], rect: { xPt: number; yPt: number }, tolPt?: number): TextBox | null` (default `tolPt = 2`)
  - In `pdf.ts`: `getPageTextItems(doc: PDFDocumentProxy, pageNumber: number): Promise<PageTextItem[]>` (`pageNumber` is 1-based, like `renderPage`)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/textItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist'
import {
  guessStyle,
  toPageTextItem,
  extractTextItems,
  hitTest,
  findBoxAt,
  type PageTextItem,
} from './textItems'
import type { TextBox } from './overlay'

const item = (over: Partial<PageTextItem> = {}): PageTextItem => ({
  str: 'hello', xPt: 100, yPt: 200, wPt: 50, hPt: 14, sizePt: 12,
  family: 'sans', bold: false, italic: false, ...over,
})

const box = (over: Partial<TextBox> = {}): TextBox => ({
  id: 'b1', page: 0, xPt: 100, yPt: 200, wPt: 50, hPt: 14, text: 'x',
  family: 'sans', sizePt: 12, color: '#111111', bold: false, italic: false, ...over,
})

describe('guessStyle', () => {
  it('reads bold and italic from the base font name', () => {
    expect(guessStyle('Helvetica-BoldOblique', 'sans-serif')).toEqual({ family: 'sans', bold: true, italic: true })
    expect(guessStyle('ABCDEF+Arial-ItalicMT', 'sans-serif')).toEqual({ family: 'sans', bold: false, italic: true })
  })
  it('maps Times to serif and Courier to mono', () => {
    expect(guessStyle('Times-Roman', 'serif').family).toBe('serif')
    expect(guessStyle('Courier', 'monospace').family).toBe('mono')
  })
  it('falls back to the generic family when the name is unknown or empty', () => {
    expect(guessStyle('', 'serif').family).toBe('serif')
    expect(guessStyle('', 'monospace').family).toBe('mono')
    expect(guessStyle('', '')).toEqual({ family: 'sans', bold: false, italic: false })
  })
  it('honours explicit pdf.js bold/italic flags', () => {
    expect(guessStyle('Foo', 'sans-serif', true, true)).toEqual({ family: 'sans', bold: true, italic: true })
  })
})

describe('toPageTextItem', () => {
  const vt = [1, 0, 0, -1, 0, 800] // unrotated 800pt-tall page at scale 1
  const sans = { family: 'sans' as const, bold: false, italic: false }

  it('converts a baseline-origin run to a top-left pt rect', () => {
    const r = toPageTextItem({ str: 'Hi', transform: [20, 0, 0, 20, 48, 700], width: 100, fontName: 'f' }, vt, sans)!
    expect(r.xPt).toBeCloseTo(48)
    expect(r.yPt).toBeCloseTo(800 - 700 - 20 * 0.8) // baseline minus ascent
    expect(r.sizePt).toBeCloseTo(20)
    expect(r.hPt).toBeCloseTo(20 * 1.15)
    expect(r.wPt).toBeCloseTo(100 + 2) // width plus 10% of size, so re-wrapping does not break the line
    expect(r.str).toBe('Hi')
  })
  it('drops empty, whitespace-only and zero-width runs', () => {
    expect(toPageTextItem({ str: '', transform: [12, 0, 0, 12, 0, 0], width: 0, fontName: 'f' }, vt, sans)).toBeNull()
    expect(toPageTextItem({ str: '   ', transform: [12, 0, 0, 12, 0, 0], width: 9, fontName: 'f' }, vt, sans)).toBeNull()
    expect(toPageTextItem({ str: 'a', transform: [12, 0, 0, 12, 0, 0], width: 0, fontName: 'f' }, vt, sans)).toBeNull()
  })
})

describe('hitTest', () => {
  it('returns the item whose rect contains the point', () => {
    const a = item({ str: 'a', xPt: 0, yPt: 0 })
    const b = item({ str: 'b', xPt: 100, yPt: 200 })
    expect(hitTest([a, b], 120, 205)).toBe(b)
  })
  it('returns null when no item is under the point', () => {
    expect(hitTest([item()], 10, 10)).toBeNull()
  })
})

describe('findBoxAt', () => {
  it('finds a box within 2pt of the rect origin', () => {
    const b = box({ xPt: 101.5, yPt: 198.5 })
    expect(findBoxAt([b], { xPt: 100, yPt: 200 })).toBe(b)
  })
  it('ignores boxes further away than the tolerance', () => {
    expect(findBoxAt([box({ xPt: 103 })], { xPt: 100, yPt: 200 })).toBeNull()
  })
})

describe('extractTextItems (real pdf-lib → pdf.js round trip)', () => {
  async function samplePage() {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)
    const mono = await doc.embedFont(StandardFonts.Courier)
    page.drawText('Bold Title', { x: 48, y: 700, size: 20, font: bold })
    page.drawText('Italic line', { x: 48, y: 600, size: 12, font: italic })
    page.drawText('Mono line', { x: 48, y: 500, size: 10, font: mono })
    const pdf = await pdfjs
      .getDocument({ data: await doc.save(), useWorkerFetch: false, isEvalSupported: false })
      .promise
    return {
      page: (await pdf.getPage(1)) as unknown as PDFPageProxy,
      titleWidth: bold.widthOfTextAtSize('Bold Title', 20),
    }
  }

  it('returns one item per real run, positioned in top-left pt space', async () => {
    const { page, titleWidth } = await samplePage()
    const items = await extractTextItems(page)
    expect(items.map((i) => i.str)).toEqual(['Bold Title', 'Italic line', 'Mono line'])
    const title = items[0]
    expect(title.xPt).toBeCloseTo(48, 1)
    expect(title.yPt).toBeCloseTo(800 - 700 - 16, 1)
    expect(title.sizePt).toBeCloseTo(20, 1)
    expect(title.wPt).toBeCloseTo(titleWidth + 2, 0)
  })

  it('guesses family/bold/italic from the embedded standard fonts', async () => {
    const { page } = await samplePage()
    const [title, italic, mono] = await extractTextItems(page)
    expect(title).toMatchObject({ family: 'sans', bold: true, italic: false })
    expect(italic).toMatchObject({ family: 'serif', bold: false, italic: true })
    expect(mono).toMatchObject({ family: 'mono', bold: false, italic: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/lib/textItems.test.ts`
Expected: FAIL. The import of `./textItems` cannot be resolved.

- [ ] **Step 3: Implement `src/lib/textItems.ts`**

```ts
import type { PDFPageProxy } from 'pdfjs-dist'
import { ASCENT_RATIO, LINE_HEIGHT_RATIO, type Family, type TextBox } from './overlay'

/** One pdf.js text run, converted to the same top-left pt space TextBox uses. */
export interface PageTextItem {
  str: string
  xPt: number
  yPt: number
  wPt: number
  hPt: number
  sizePt: number
  family: Family
  bold: boolean
  italic: boolean
}

export interface FontGuess {
  family: Family
  bold: boolean
  italic: boolean
}

/** The subset of pdf.js's TextItem this module reads. */
export interface RawTextItem {
  str: string
  transform: number[]
  width: number
  fontName: string
}

/** Extra width so re-wrapping the original string at bake time doesn't push its last word to a new line. */
const WIDTH_PAD_RATIO = 0.1

/**
 * Heuristic style guess. `baseName` is the real font name from pdf.js's commonObjs
 * (e.g. "Helvetica-Bold", "ABCDEF+Arial-ItalicMT"), or '' if unknown. `genericFamily`
 * is pdf.js's content.styles fontFamily ("sans-serif" | "serif" | "monospace").
 * Not a real font lookup.
 */
export function guessStyle(
  baseName: string,
  genericFamily: string,
  boldFlag?: boolean,
  italicFlag?: boolean,
): FontGuess {
  const bold = !!boldFlag || /bold|black|heavy|semibold|demi/i.test(baseName)
  const italic = !!italicFlag || /italic|oblique/i.test(baseName)
  let family: Family = 'sans'
  if (/courier|mono|consol/i.test(baseName)) family = 'mono'
  else if (/times|georgia|garamond|serif/i.test(baseName) && !/sans/i.test(baseName)) family = 'serif'
  else if (!baseName && genericFamily === 'serif') family = 'serif'
  else if (!baseName && genericFamily === 'monospace') family = 'mono'
  return { family, bold, italic }
}

/** Convert one run to a pt rect. Returns null for runs that cannot be clicked (empty or zero-size). */
export function toPageTextItem(
  raw: RawTextItem,
  viewportTransform: number[],
  style: FontGuess,
): PageTextItem | null {
  if (!raw.str.trim() || raw.width <= 0) return null
  const [a, b, c, d, e, f] = viewportTransform
  const [, , tc, td, tx, ty] = raw.transform
  const sizePt = Math.hypot(tc, td)
  if (sizePt <= 0) return null
  // Baseline origin, PDF space → viewport (top-left) space.
  const xPt = a * tx + c * ty + e
  const baselineY = b * tx + d * ty + f
  return {
    str: raw.str,
    xPt,
    yPt: baselineY - sizePt * ASCENT_RATIO,
    wPt: raw.width + sizePt * WIDTH_PAD_RATIO,
    hPt: sizePt * LINE_HEIGHT_RATIO,
    sizePt,
    ...style,
  }
}

/** All clickable text runs on a page, in top-left pt space at scale 1. */
export async function extractTextItems(page: PDFPageProxy): Promise<PageTextItem[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const raw = content.items.flatMap((i) => ('str' in i ? [i as RawTextItem] : []))

  // Real font names live in commonObjs, which is only populated once the page's
  // operator list has been built. Desk has usually rendered the page already.
  const ids = [...new Set(raw.map((i) => i.fontName))]
  if (ids.some((id) => !page.commonObjs.has(id))) {
    try {
      await page.getOperatorList()
    } catch {
      // Style guess falls back to the generic family below.
    }
  }

  const styleOf = new Map<string, FontGuess>()
  for (const id of ids) {
    let font: { name?: string; bold?: boolean; italic?: boolean } | undefined
    try {
      font = page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined
    } catch {
      font = undefined
    }
    const generic = content.styles[id]?.fontFamily ?? ''
    styleOf.set(id, guessStyle(font?.name ?? '', generic, font?.bold, font?.italic))
  }

  return raw.flatMap((i) => {
    const it = toPageTextItem(i, viewport.transform, styleOf.get(i.fontName) ?? guessStyle('', ''))
    return it ? [it] : []
  })
}

/** First item whose rect contains the point (pt space), or null. */
export function hitTest(items: PageTextItem[], xPt: number, yPt: number): PageTextItem | null {
  return (
    items.find(
      (i) => xPt >= i.xPt && xPt <= i.xPt + i.wPt && yPt >= i.yPt && yPt <= i.yPt + i.hPt,
    ) ?? null
  )
}

/** A box (callers pass the current page's boxes) whose origin is within tolPt of rect's origin. */
export function findBoxAt(
  boxes: TextBox[],
  rect: { xPt: number; yPt: number },
  tolPt = 2,
): TextBox | null {
  return (
    boxes.find((b) => Math.abs(b.xPt - rect.xPt) <= tolPt && Math.abs(b.yPt - rect.yPt) <= tolPt) ??
    null
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test src/lib/textItems.test.ts`
Expected: PASS (all tests in the file).

If the `extractTextItems` style test fails on `family` for Times/Courier, log `font?.name` for each id. The checked facts above say pdf.js reports `Times-Italic` and `Courier`. Fix `guessStyle` regexes only; do not weaken the test.

- [ ] **Step 5: Add the `getPageTextItems` wrapper to `src/lib/pdf.ts`**

Add to the imports at the top of `src/lib/pdf.ts`:

```ts
import { extractTextItems, type PageTextItem } from './textItems'
```

Add after `renderPageToBlob`:

```ts
/** Clickable text runs on a page (1-based), in top-left pt space. Read-only. */
export async function getPageTextItems(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageTextItem[]> {
  return extractTextItems(await doc.getPage(pageNumber))
}
```

- [ ] **Step 6: Run the full checks**

Run: `yarn test && yarn build && yarn lint`
Expected: all vitest files pass. `tsc -b` and `vite build` succeed (the chunk-size warning is pre-existing and fine). eslint prints no errors.

If `tsc` rejects `page.commonObjs.has` / `.get`, check `node_modules/pdfjs-dist/types/src/display/api.d.ts` for the `commonObjs` declaration on `PDFPageProxy`. Use whatever accessor it declares; do not cast to `any`.

- [ ] **Step 7: Commit**

Run `git config user.email`. It must print `arsalaan.z99@gmail.com`.

```bash
git add src/lib/textItems.ts src/lib/textItems.test.ts src/lib/pdf.ts
git commit -m "feat: extract pdf.js text runs as pt rects with style guess, hit-test, dedup"
```

---

### Task 2: `coverColor`, colour helpers and the cover rect at bake time

**Files:**
- Modify: `src/lib/overlay.ts`
- Modify: `src/lib/overlay.test.ts`
- Modify: `src/lib/bake.ts`
- Modify: `src/lib/bake.test.ts`

**Interfaces:**
- Consumes: the existing `parseHexColor(hex): Rgb01` in `overlay.ts`.
- Produces:
  - `TextBox.coverColor?: string` (hex)
  - `WHITE = '#FFFFFF'`
  - `rgbToHex(r: number, g: number, b: number): string` (0–255 in, uppercase `#RRGGBB` out)
  - `coverSamplePoint(rect: { xPt: number; yPt: number; hPt: number }, zoom: number, pxPerCss: number, canvasW: number, canvasH: number): { x: number; y: number } | null`
  - `sampleColorAt(ctx: Pick<CanvasRenderingContext2D, 'getImageData'>, xPx: number, yPx: number): string`
  - `contrastText(hex: string): string` (`'#FFFFFF'` on dark covers, `'#111111'` on light ones)
  - `bakeOverlays` draws the cover rect at `(xPt, pageHeight - yPt - hPt, wPt, hPt)` before the text when `coverColor` is set

- [ ] **Step 1: Write the failing overlay tests**

In `src/lib/overlay.test.ts`, add the new names to the existing import from `./overlay`:

```ts
  rgbToHex,
  coverSamplePoint,
  sampleColorAt,
  contrastText,
  WHITE,
```

Append at the end of the file:

```ts
describe('rgbToHex', () => {
  it('formats 0-255 channels as uppercase #RRGGBB', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#FF0000')
    expect(rgbToHex(10, 20, 30)).toBe('#0A141E')
  })
  it('round-trips through parseHexColor', () => {
    const { r, g, b } = parseHexColor(rgbToHex(59, 74, 224))
    expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([59, 74, 224])
  })
})

describe('coverSamplePoint', () => {
  it('samples 3 css px left of the run, vertically centred, in device pixels', () => {
    // xCss = 48*1 - 3 = 45, yCss = (100 + 20/2)*1 = 110; pxPerCss 2 → (90, 220)
    expect(coverSamplePoint({ xPt: 48, yPt: 100, hPt: 20 }, 1, 2, 1200, 1600)).toEqual({ x: 90, y: 220 })
  })
  it('clamps to the canvas bounds', () => {
    expect(coverSamplePoint({ xPt: 0, yPt: 5000, hPt: 20 }, 1, 1, 600, 800)).toEqual({ x: 0, y: 799 })
  })
  it('returns null for an empty canvas', () => {
    expect(coverSamplePoint({ xPt: 48, yPt: 100, hPt: 20 }, 1, 1, 0, 0)).toBeNull()
  })
})

describe('sampleColorAt', () => {
  const ctxOf = (rgba: number[]) =>
    ({ getImageData: () => ({ data: new Uint8ClampedArray(rgba) }) }) as unknown as Pick<
      CanvasRenderingContext2D,
      'getImageData'
    >
  it('reads one pixel as hex', () => {
    expect(sampleColorAt(ctxOf([59, 74, 224, 255]), 0, 0)).toBe('#3B4AE0')
  })
  it('treats a fully transparent pixel as white', () => {
    expect(sampleColorAt(ctxOf([0, 0, 0, 0]), 0, 0)).toBe(WHITE)
  })
  it('falls back to white when the read throws', () => {
    const bad = {
      getImageData: () => {
        throw new Error('nope')
      },
    } as unknown as Pick<CanvasRenderingContext2D, 'getImageData'>
    expect(sampleColorAt(bad, 0, 0)).toBe(WHITE)
  })
})

describe('contrastText', () => {
  it('uses white text on dark covers and near-black on light ones', () => {
    expect(contrastText('#3B4AE0')).toBe('#FFFFFF')
    expect(contrastText('#FFFFFF')).toBe('#111111')
  })
})
```

- [ ] **Step 2: Write the failing bake tests**

Append inside the existing `describe('bakeOverlays', ...)` block in `src/lib/bake.test.ts`, after the last `it(...)`:

```ts
  it('draws the cover rectangle before the text when coverColor is set', async () => {
    // boxWith: xPt 50, yPt 50, hPt 200 on an 800pt page → rect origin y = 800 - 50 - 200 = 550
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('Covered'), coverColor: '#FF0000' }])
    const { fnArray, argsArray } = await page1Ops(out)
    const fillIdx = fnArray.findIndex(
      (f, i) =>
        f === pdfjs.OPS.setFillRGBColor &&
        Array.from(argsArray[i] as ArrayLike<number>).join() === '255,0,0',
    )
    const rectIdx = fnArray.findIndex(
      (f, i) => f === pdfjs.OPS.transform && (argsArray[i] as number[]).join() === '1,0,0,1,50,550',
    )
    const textIdx = fnArray.indexOf(pdfjs.OPS.showText)
    expect(fillIdx).toBeGreaterThanOrEqual(0)
    expect(rectIdx).toBeGreaterThan(fillIdx)
    expect(fnArray.indexOf(pdfjs.OPS.constructPath)).toBeGreaterThan(rectIdx)
    expect(textIdx).toBeGreaterThan(rectIdx)
  })

  it('draws no rectangle for boxes without coverColor (Phase-1 output unchanged)', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('Plain')])
    const { fnArray } = await page1Ops(out)
    expect(fnArray).not.toContain(pdfjs.OPS.constructPath)
    expect(fnArray).toContain(pdfjs.OPS.showText)
  })

  it('draws no cover for an edit-box whose text was emptied', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('  '), coverColor: '#FF0000' }])
    const { fnArray } = await page1Ops(out)
    expect(fnArray).not.toContain(pdfjs.OPS.constructPath)
  })
```

Add this helper next to `extractText` near the top of `src/lib/bake.test.ts`:

```ts
async function page1Ops(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise
  return (await doc.getPage(1)).getOperatorList()
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn test src/lib/overlay.test.ts src/lib/bake.test.ts`
Expected: FAIL. `rgbToHex` / `coverSamplePoint` / `sampleColorAt` / `contrastText` / `WHITE` are not exported, `coverColor` does not exist on `TextBox`, and the cover-rect test finds no red fill.

- [ ] **Step 4: Implement in `src/lib/overlay.ts`**

Add to the `TextBox` interface, after `italic: boolean`:

```ts
  /** Edit-boxes only: hex fill drawn at the box bounds before the text at bake time.
   *  Visual cover only — the original glyphs stay in the file (not redaction). */
  coverColor?: string
```

Append at the end of the file:

```ts
export const WHITE = '#FFFFFF'

/** 0-255 channels → uppercase #RRGGBB. Inverse of parseHexColor (×255). */
export function rgbToHex(r: number, g: number, b: number): string {
  const ch = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')
  return `#${ch(r)}${ch(g)}${ch(b)}`.toUpperCase()
}

/** CSS px left of the run where the background is sampled. */
export const COVER_SAMPLE_OFFSET_PX = 3

/**
 * Device-pixel point just left of a run, vertically centred, clamped to the canvas.
 * pxPerCss = canvas.width / canvas.clientWidth (renderPage scales by devicePixelRatio).
 */
export function coverSamplePoint(
  rect: { xPt: number; yPt: number; hPt: number },
  zoom: number,
  pxPerCss: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } | null {
  if (canvasW <= 0 || canvasH <= 0) return null
  const xCss = rect.xPt * zoom - COVER_SAMPLE_OFFSET_PX
  const yCss = (rect.yPt + rect.hPt / 2) * zoom
  const clamp = (v: number, size: number) => Math.min(Math.max(0, Math.round(v)), size - 1)
  return { x: clamp(xCss * pxPerCss, canvasW), y: clamp(yCss * pxPerCss, canvasH) }
}

/** One canvas pixel → hex. White if unreadable or fully transparent (unpainted). */
export function sampleColorAt(
  ctx: Pick<CanvasRenderingContext2D, 'getImageData'>,
  xPx: number,
  yPx: number,
): string {
  try {
    const d = ctx.getImageData(xPx, yPx, 1, 1).data
    if (d[3] === 0) return WHITE
    return rgbToHex(d[0], d[1], d[2])
  } catch {
    return WHITE
  }
}

/** Readable default text colour for a replacement run drawn on `hex`. */
export function contrastText(hex: string): string {
  const { r, g, b } = parseHexColor(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? '#FFFFFF' : '#111111'
}
```

- [ ] **Step 5: Implement the cover rect in `src/lib/bake.ts`**

In `bakeOverlays`, replace this block:

```ts
    const { r, g, b } = parseHexColor(box.color)
    const pageHeight = page.getHeight()
```

with:

```ts
    const pageHeight = page.getHeight()

    // Edit-boxes: paint over the original glyphs first, then draw the new text on top.
    // Visual cover only — the original text stays in the content stream.
    if (box.coverColor) {
      const c = parseHexColor(box.coverColor)
      page.drawRectangle({
        x: box.xPt,
        y: pageHeight - box.yPt - box.hPt,
        width: box.wPt,
        height: box.hPt,
        color: rgb(c.r, c.g, c.b),
      })
    }

    const { r, g, b } = parseHexColor(box.color)
```

The existing `if (!box.text.trim()) continue` at the top of the loop already skips both the cover and the text for an emptied edit-box. That is what the spec wants: reverting an edit restores the original.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test src/lib/overlay.test.ts src/lib/bake.test.ts`
Expected: PASS, including the three existing bake tests, which are unchanged.

- [ ] **Step 7: Run the full checks**

Run: `yarn test && yarn build && yarn lint`
Expected: all pass, no lint errors.

- [ ] **Step 8: Commit**

Run `git config user.email`. It must print `arsalaan.z99@gmail.com`.

```bash
git add src/lib/overlay.ts src/lib/overlay.test.ts src/lib/bake.ts src/lib/bake.test.ts
git commit -m "feat: coverColor on TextBox, colour sampling helpers, bake cover rect before text"
```

---

### Task 3: Add `'edit'` to the store's tool union

**Files:**
- Modify: `src/store/usePdfStore.ts:33`, `:40`
- Modify: `src/store/usePdfStore.test.ts`

**Interfaces:**
- Produces: `export type Tool = 'select' | 'text' | 'edit'`. `PdfState.tool: Tool` and `setTool: (t: Tool) => void`. Header and TextLayer in Task 4 rely on the `'edit'` value.

- [ ] **Step 1: Write the failing test**

Append to `src/store/usePdfStore.test.ts`:

```ts
describe('tool', () => {
  it("accepts the 'edit' tool and reset returns to 'select'", () => {
    usePdfStore.getState().setTool('edit')
    expect(usePdfStore.getState().tool).toBe('edit')
    usePdfStore.getState().reset()
    expect(usePdfStore.getState().tool).toBe('select')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/store/usePdfStore.test.ts && yarn build`
Expected: vitest itself passes, because it does not type-check. `yarn build` (`tsc -b`) FAILS with `Argument of type '"edit"' is not assignable to parameter of type '"select" | "text"'`. That type error is the failing signal for this task.

- [ ] **Step 3: Implement**

In `src/store/usePdfStore.ts`, add above `interface PdfState`:

```ts
export type Tool = 'select' | 'text' | 'edit'
```

Replace `tool: 'select' | 'text'` with `tool: Tool`, and `setTool: (t: 'select' | 'text') => void` with `setTool: (t: Tool) => void`.

- [ ] **Step 4: Run the checks to verify they pass**

Run: `yarn test && yarn build && yarn lint`
Expected: all pass.

- [ ] **Step 5: Commit**

Run `git config user.email`. It must print `arsalaan.z99@gmail.com`.

```bash
git add src/store/usePdfStore.ts src/store/usePdfStore.test.ts
git commit -m "feat: add 'edit' to the store tool union"
```

---

### Task 4: Wire the Edit-text tool into the UI

**Files:**
- Modify: `src/components/Desk.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/TextLayer.tsx` (full replacement below)
- Modify: `src/styles/index.css:602`

**Interfaces:**
- Consumes: `getPageTextItems` (Task 1, `src/lib/pdf.ts`), `hitTest`, `findBoxAt`, `type PageTextItem` (Task 1, `src/lib/textItems.ts`), `coverSamplePoint`, `sampleColorAt`, `contrastText`, `WHITE` (Task 2, `src/lib/overlay.ts`), and the `'edit'` tool (Task 3).
- Produces: `TextLayer` gains the prop `canvasRef: React.RefObject<HTMLCanvasElement | null>`. The DOM test hooks are `data-testid="tool-edit"` on the header button and `data-text-items="<count>"` on `.text-layer`, present only once the edit-mode items for the current page have loaded. Task 5 uses both.

There is no component test harness (vitest runs in `node`, with no jsdom). This task is checked by `tsc`/`lint` plus a manual browser check here, and by the smoke test in Task 5.

- [ ] **Step 1: Pass the canvas ref from `Desk`**

In `src/components/Desk.tsx`, change:

```tsx
        {dims && <TextLayer wPx={dims.w * zoom} hPx={dims.h * zoom} />}
```

to:

```tsx
        {dims && <TextLayer wPx={dims.w * zoom} hPx={dims.h * zoom} canvasRef={canvasRef} />}
```

- [ ] **Step 2: Add the "Edit text" toggle to `Header`**

In `src/components/Header.tsx`, add this right after the existing `＋ Add text` button. Clicking one tool button replaces the other automatically, because `tool` is a single value.

```tsx
          <button
            className={`btn${tool === 'edit' ? ' active' : ''}`}
            data-testid="tool-edit"
            onClick={() => setTool(tool === 'edit' ? 'select' : 'edit')}
            disabled={busy}
            title="Covers and replaces existing text visually — the original text is not removed from the file and can still be extracted by other tools."
          >
            ✎ Edit text
          </button>
```

- [ ] **Step 3: Replace `src/components/TextLayer.tsx`**

This is the full new file. Compared with today's file, the `'text'` path and everything about existing boxes (drag, resize, input, blur-remove, toolbar) behave the same. What is new:
- the `canvasRef` prop;
- a text-item cache that is keyed and only filled asynchronously, which satisfies react-hooks v7's no-sync-setState-in-effect rule;
- the `'edit'` branch;
- auto-focus with the caret at the end for a just-spawned edit-box;
- `background: coverColor` on the editable box, so the original glyphs are hidden in the editor as well as in the export;
- the `editing` class and the `data-text-items` hook.

```tsx
import { useEffect, useRef, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import {
  boxToScreen,
  pxToPt,
  coverSamplePoint,
  sampleColorAt,
  contrastText,
  WHITE,
  type TextBox,
} from '../lib/overlay'
import { getPageTextItems } from '../lib/pdf'
import { hitTest, findBoxAt, type PageTextItem } from '../lib/textItems'

interface Props {
  wPx: number
  hPx: number
  /** The page canvas, read only to sample one background pixel for an edit-box's cover. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

const DEFAULT_SIZE_PT = 16

const cssFamily = (f: TextBox['family']) =>
  f === 'serif' ? 'serif' : f === 'mono' ? 'monospace' : 'sans-serif'

/** Background colour just left of a run, read from the rendered page canvas. */
function sampleCover(canvas: HTMLCanvasElement | null, item: PageTextItem, zoom: number): string {
  if (!canvas || !canvas.clientWidth) return WHITE
  const pt = coverSamplePoint(item, zoom, canvas.width / canvas.clientWidth, canvas.width, canvas.height)
  const ctx = pt ? canvas.getContext('2d') : null
  return pt && ctx ? sampleColorAt(ctx, pt.x, pt.y) : WHITE
}

export default function TextLayer({ wPx, hPx, canvasRef }: Props) {
  const {
    doc,
    docVersion,
    overlays,
    currentPage,
    zoom,
    tool,
    selectedBoxId,
    addTextBox,
    updateTextBox,
    selectBox,
  } = usePdfStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const editRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  /** Set when the edit tool spawns a prefilled box, so the focus effect also focuses non-empty boxes. */
  const focusNext = useRef(false)
  const pageIndex = currentPage - 1
  const boxes = overlays.filter((b) => b.page === pageIndex)

  // Text runs for the current page, fetched only while the edit tool is active.
  // Keyed rather than cleared, so the effect never calls setState synchronously.
  const itemsKey = doc && tool === 'edit' ? `${docVersion}:${pageIndex}` : null
  const [itemsCache, setItemsCache] = useState<{ key: string; items: PageTextItem[] } | null>(null)
  const itemsReady = itemsKey !== null && itemsCache?.key === itemsKey
  const items = itemsReady && itemsCache ? itemsCache.items : []

  useEffect(() => {
    if (!doc || !itemsKey) return
    let cancelled = false
    getPageTextItems(doc, pageIndex + 1)
      .then((found) => {
        if (!cancelled) setItemsCache({ key: itemsKey, items: found })
      })
      .catch(() => {
        if (!cancelled) setItemsCache({ key: itemsKey, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [doc, itemsKey, pageIndex])

  useEffect(() => {
    if (!selectedBoxId) return
    const box = boxes.find((b) => b.id === selectedBoxId)
    if (!box || (box.text !== '' && !focusNext.current)) return
    // Defer past this event loop turn: the pointerdown that creates a box is
    // immediately followed, in the SAME native gesture, by a `mousedown`
    // hit-tested against the pre-click DOM (the empty layer, an ancestor of
    // the box we're about to focus). Focusing synchronously here — even from
    // an effect — still runs before that `mousedown` is dispatched, so it
    // would blur straight back off and, since the box is still empty,
    // trigger the blur handler to delete it. Deferring one tick lets the
    // whole click gesture (mousedown/pointerup/mouseup/click) finish first.
    const t = setTimeout(() => {
      focusNext.current = false
      const el = editRefs.current.get(selectedBoxId)
      if (!el || document.activeElement === el) return
      el.focus()
      // Caret at the end, so typing into a prefilled edit-box appends rather than
      // landing at offset 0.
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }, 0)
    return () => clearTimeout(t)
  }, [selectedBoxId, boxes])

  function pointerPt(e: React.PointerEvent) {
    const rect = layerRef.current!.getBoundingClientRect()
    return { xPt: pxToPt(e.clientX - rect.left, zoom), yPt: pxToPt(e.clientY - rect.top, zoom) }
  }

  function addAtPointer(e: React.PointerEvent) {
    const { xPt, yPt } = pointerPt(e)
    addTextBox({
      page: pageIndex,
      xPt,
      yPt,
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

  function editAtPointer(e: React.PointerEvent) {
    const { xPt, yPt } = pointerPt(e)
    const hit = hitTest(items, xPt, yPt)
    if (!hit) {
      selectBox(null) // nothing under the click: spawn nothing
      return
    }
    const existing = findBoxAt(boxes, hit)
    if (existing) {
      selectBox(existing.id) // repeat click on an already-edited run: no duplicate
      return
    }
    const coverColor = sampleCover(canvasRef.current, hit, zoom)
    focusNext.current = true
    addTextBox({
      page: pageIndex,
      xPt: hit.xPt,
      yPt: hit.yPt,
      wPt: hit.wPt,
      hPt: hit.hPt,
      text: hit.str,
      family: hit.family,
      sizePt: hit.sizePt,
      color: contrastText(coverColor),
      bold: hit.bold,
      italic: hit.italic,
      coverColor,
    })
  }

  function onLayerPointerDown(e: React.PointerEvent) {
    if (e.target !== layerRef.current) return // a box (child) was clicked
    if (tool === 'text') addAtPointer(e)
    else if (tool === 'edit') editAtPointer(e)
    else selectBox(null)
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

  const modeClass = tool === 'text' ? ' adding' : tool === 'edit' ? ' editing' : ''

  return (
    <div
      ref={layerRef}
      className={`text-layer${modeClass}`}
      data-testid="text-layer"
      data-text-items={itemsReady ? items.length : undefined}
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
                // Edit-boxes hide the original glyphs in the editor too, matching export.
                background: box.coverColor,
              }}
              // Sync external text in only when not focused, to avoid caret jumps.
              ref={(el) => {
                if (el) editRefs.current.set(box.id, el)
                else editRefs.current.delete(box.id)
                if (!el || document.activeElement === el) return
                if (el.innerText !== box.text) el.innerText = box.text
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

- [ ] **Step 4: Add the editing cursor**

In `src/styles/index.css`, replace:

```css
.text-layer.adding { cursor: text; }
```

with:

```css
.text-layer.adding,
.text-layer.editing { cursor: text; }
```

- [ ] **Step 5: Run the static checks**

Run: `yarn test && yarn build && yarn lint`
Expected: all pass, with no react-hooks errors.

If eslint flags `react-hooks/refs` on `focusNext.current` or `canvasRef.current`, check that every read is inside an effect, a timeout or an event handler (`editAtPointer`) and none is in the render body. That is what the code above does.

- [ ] **Step 6: Manual browser check**

Run: `node scripts/make-test-pdf.mjs /tmp/test.pdf` and `yarn dev`. Open the printed URL and load `/tmp/test.pdf`. Then check:
1. "✎ Edit text" turns blue. "＋ Add text" turns off when Edit is turned on, and the other way round. Hovering Edit shows the redaction warning tooltip.
2. Click "The quick brown fox…". A box appears over the run, holding that text, with a white background and the caret at the end. Type ` EDITED`.
3. Click the white "Quarterly Report" title in the blue band. The box background is blue and the text is white.
4. Click the same edited run again. It is selected, and no second box appears.
5. Click empty white space. Nothing is spawned.
6. Delete all the text in one edit-box and click away. The box disappears and the original text shows again.
7. Export the PDF and open it. The edited runs are covered and replaced.

- [ ] **Step 7: Commit**

Run `git config user.email`. It must print `arsalaan.z99@gmail.com`.

```bash
git add src/components/Desk.tsx src/components/Header.tsx src/components/TextLayer.tsx src/styles/index.css
git commit -m "feat: Edit text tool — click existing text to cover and replace it in place"
```

---

### Task 5: End-to-end smoke coverage for edit-text

**Files:**
- Modify: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `data-testid="tool-edit"` and `.text-layer[data-text-items]` from Task 4. It also relies on the page layout produced by `scripts/make-test-pdf.mjs`: an A4 page of 595.28 × 841.89 pt, with the sentence "The quick brown fox jumps over the lazy dog." at x = 48, baseline y = 680, size 12, Helvetica. In top-left space its rect is about y 152.3 → 166.1 pt and x 48 → 290 pt.

- [ ] **Step 1: Add the edit-text pass**

In `scripts/smoke.mjs`, insert this block right after the line `await page.screenshot({ path: \`${SHOTS}/03-text-added.png\` })` and before the `// Export PDF` comment:

```js
  // --- Edit existing text: click a known run, replace it, check dedup ---
  const EDIT_SENTINEL = 'EditSentinel'
  const ORIGINAL = 'The quick brown fox'

  // Go to page 1 (every non-blank page of the sample PDF has the sentence).
  while (
    await page.$eval('.page-controls .readout', (el) => !el.textContent.trim().startsWith('1 /'))
  ) {
    await page.click('button[aria-label="Previous page"]')
  }

  await page.click('[data-testid="tool-edit"]')
  await page.waitForSelector('.text-layer[data-text-items]:not([data-text-items="0"])', {
    timeout: 6000,
  })
  ok('edit tool loads text items for the page', true)

  const el2 = await page.$('.text-layer')
  const lb2 = await el2.boundingBox()
  const zoom = lb2.width / 595.28
  const clickX = lb2.x + 108 * zoom // inside the sentence run
  const clickY = lb2.y + 158 * zoom
  const boxesBefore = await page.$$eval('.text-box', (els) => els.length)
  await page.mouse.click(clickX, clickY)

  await page.waitForFunction(
    (orig) => [...document.querySelectorAll('.text-box-edit')].some((e) => e.innerText.includes(orig)),
    { timeout: 4000 },
    ORIGINAL,
  )
  ok('edit click spawns a box prefilled with the original run', true)

  const autoFocused = await page.waitForFunction(
    (orig) => document.activeElement?.innerText?.includes(orig),
    { timeout: 2000 },
    ORIGINAL,
  ).then(() => true, () => false)
  ok('edit box is focused without an extra click', autoFocused)

  const coverBg = await page.$$eval(
    '.text-box-edit',
    (els, orig) => {
      const e = els.find((x) => x.innerText.includes(orig))
      return e ? getComputedStyle(e).backgroundColor : ''
    },
    ORIGINAL,
  )
  ok('edit box carries the sampled cover colour (white page)', coverBg === 'rgb(255, 255, 255)', coverBg)

  // Replace the whole run with the sentinel.
  await page.evaluate(() => document.execCommand('selectAll'))
  await page.keyboard.type(EDIT_SENTINEL)
  const edited = await page.evaluate(() => document.activeElement?.innerText ?? '')
  ok('edit box holds the replacement text', edited === EDIT_SENTINEL, `got "${edited}"`)
  await page.screenshot({ path: `${SHOTS}/04-text-edited.png` })

  // Repeat click on the same spot must select, not stack a duplicate.
  await page.mouse.click(clickX, clickY)
  await new Promise((r) => setTimeout(r, 200))
  const boxesAfter = await page.$$eval('.text-box', (els) => els.length)
  ok('repeat click does not duplicate the edit box', boxesAfter === boxesBefore + 1, `${boxesBefore} → ${boxesAfter}`)
```

- [ ] **Step 2: Assert the exported PDF contains both sentinels**

In `scripts/smoke.mjs`, replace:

```js
  ok('export produced a .pdf file', exported, pdfs.join(', '))
  ok('exported file has a valid PDF header', validHeader)
```

with:

```js
  ok('export produced a .pdf file', exported, pdfs.join(', '))
  ok('exported file has a valid PDF header', validHeader)

  if (exported) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync(`${SHOTS}/${pdfs[0]}`))
    const out = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise
    let allText = ''
    for (let n = 1; n <= out.numPages; n++) {
      const c = await (await out.getPage(n)).getTextContent()
      allText += c.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n'
    }
    ok('exported PDF text contains the added-text sentinel', allText.includes(SENTINEL))
    ok('exported PDF text contains the edit sentinel', allText.includes(EDIT_SENTINEL))
  }
```

The original run is still in the exported text layer by design (this is not redaction), so there is deliberately no "original is gone" assertion. The spec allows that check only as a visual claim. The `04-text-edited.png` screenshot and the bake unit test that checks the rectangle is drawn before the text cover it.

- [ ] **Step 3: Run the smoke test**

`/tmp/shots` must be empty, because the script reads the first `.pdf` it finds there.

```bash
rm -rf /tmp/shots && mkdir -p /tmp/shots && node scripts/make-test-pdf.mjs /tmp/test.pdf
```

In one terminal, run `yarn dev --port 5199 --strictPort`. In another, run:

```bash
node scripts/smoke.mjs http://localhost:5199/ /tmp/test.pdf /tmp/shots
```

Expected: every line prints `PASS`, the summary reads `N/N checks passed`, and the exit code is 0. Open `/tmp/shots/04-text-edited.png`. The sentence should be replaced by `EditSentinel` on a white cover.

If `'edit tool loads text items'` times out, check that `data-text-items` renders. React drops the attribute when the value is `undefined`, but renders `0`.

- [ ] **Step 4: Commit**

Run `git config user.email`. It must print `arsalaan.z99@gmail.com`.

```bash
git add scripts/smoke.mjs
git commit -m "test: e2e smoke covers edit-existing-text flow and exported sentinels"
```

---

## Spec coverage map

| Spec requirement | Task |
|---|---|
| `tool` gains `'edit'` | 3 |
| `TextBox.coverColor?` | 2 |
| `getPageTextItems(doc, pageNumber)` with pt-space rects and best-effort style | 1 |
| Cache per `[doc, docVersion, pageIndex]` only while `tool === 'edit'`, synchronous hit-test | 4 (`itemsKey` cache) |
| Hit grain = one pdf.js item, no merging | 1 (`toPageTextItem` per item) |
| Cover sampled a few px left of the run, vertically centred, clamped, white fallback | 2 (`coverSamplePoint`, `sampleColorAt`), 4 (`sampleCover`) |
| `sampleColorAt(ctx, xPx, yPx)` helper | 2 |
| `TextLayer` receives `canvasRef` from `Desk` | 4 |
| Dedup within ~2pt selects the existing box | 1 (`findBoxAt`), 4 |
| No hit → nothing spawned | 4 (`editAtPointer`) |
| Header "Edit text" toggle, mutually exclusive, redaction-warning `title` | 4 |
| Bake draws the rect before the text only when `coverColor` is set; add-boxes unchanged | 2 |
| Emptied edit-box removed on blur, so the original is restored | existing blur handler, plus 2 (empty skip test) |
| Smoke: prefilled box, edit to sentinel, export contains sentinel | 5 |
| No new runtime dependency | all tasks (none added) |

Two additions beyond the spec, both needed for a usable result:
- **Background on the edit-box in the editor.** The editor shows `coverColor` behind the edit-box, so the original glyphs don't show through while the user types. Without it, the editor would not match the export.
- **Text colour from `contrastText`.** `getTextContent()` does not expose the original text colour, and the spec leaves the text colour unspecified. `contrastText` picks white text on dark covers and near-black text on light ones.
