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
