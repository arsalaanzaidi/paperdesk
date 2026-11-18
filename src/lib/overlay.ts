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
  /** Edit-boxes only: hex fill drawn at the box bounds before the text at bake time.
   *  Visual cover only — the original glyphs stay in the file (not redaction). */
  coverColor?: string
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
