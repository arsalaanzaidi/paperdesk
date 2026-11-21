import { StandardFonts } from 'pdf-lib'
import type { FontKey } from './fonts'

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
  /** The bundled family to draw in (a look-alike of the original, or the user's pick). When set,
   *  it wins over the standard 14 even for WinAnsi text. `family` stays its generic class. */
  fontKey?: FontKey
  /** Edit-boxes only: the original run's font name, subset tag included ("FAKOKM+Calibri-Bold"). */
  sourceFont?: string
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
/**
 * Vertical shift (CSS px) that moves editor text from where CSS put its baseline (`cssRatio` em
 * below the line top, which depends on the font's ascent and descent) to where bake draws it
 * (ASCENT_RATIO em). Negative moves it up.
 */
export function baselineShiftPx(cssRatio: number, fontPx: number): number {
  return (ASCENT_RATIO - cssRatio) * fontPx
}

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

/** Grid points per axis when sampling a cover region (at most COVER_GRID² reads). */
const COVER_GRID = 32

/** Max per-channel distance from a cluster's first colour for a sample to join it. */
const COVER_TOLERANCE = 24

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Device-pixel rect over exactly a run's box, clamped to the canvas. No margin: page outside a
 * tight coloured band (table row, badge) would outvote the band at low zoom.
 * pxPerCss = canvas.width / canvas.clientWidth (renderPage scales by devicePixelRatio).
 */
export function coverSampleRegion(
  rect: { xPt: number; yPt: number; wPt: number; hPt: number },
  zoom: number,
  pxPerCss: number,
  canvasW: number,
  canvasH: number,
): PxRect | null {
  if (canvasW <= 0 || canvasH <= 0) return null
  const s = zoom * pxPerCss
  const x0 = Math.max(0, Math.floor(rect.xPt * s))
  const y0 = Math.max(0, Math.floor(rect.yPt * s))
  const x1 = Math.min(canvasW, Math.ceil((rect.xPt + rect.wPt) * s))
  const y1 = Math.min(canvasH, Math.ceil((rect.yPt + rect.hPt) * s))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

interface Cluster {
  seed: [number, number, number]
  n: number
  /** Exact packed 0xRRGGBB -> count, so the result is a real pixel colour, not a mean. */
  exact: Map<number, number>
}

/**
 * Most common colour in an RGBA image. Grid samples join the first cluster whose seed colour is
 * within COVER_TOLERANCE on every channel, so noisy or scanned backgrounds stay one cluster; the
 * result is the most common exact colour in the largest cluster (a mean would drift off the
 * background towards anti-aliased edge pixels). Ink is a minority of a text run's pixels, so the
 * background wins. Transparent pixels count as white.
 */
export function dominantColor(img: { data: ArrayLike<number>; width: number; height: number }): string {
  const { data, width, height } = img
  if (width <= 0 || height <= 0) return WHITE
  const nx = Math.min(width, COVER_GRID)
  const ny = Math.min(height, COVER_GRID)
  const clusters: Cluster[] = []
  let best: Cluster | null = null
  for (let j = 0; j < ny; j++) {
    const y = Math.floor(((j + 0.5) * height) / ny)
    for (let i = 0; i < nx; i++) {
      const x = Math.floor(((i + 0.5) * width) / nx)
      const o = (y * width + x) * 4
      const [r, g, b] = data[o + 3] === 0 ? [255, 255, 255] : [data[o], data[o + 1], data[o + 2]]
      let c = clusters.find(
        (k) =>
          Math.abs(k.seed[0] - r) <= COVER_TOLERANCE &&
          Math.abs(k.seed[1] - g) <= COVER_TOLERANCE &&
          Math.abs(k.seed[2] - b) <= COVER_TOLERANCE,
      )
      if (!c) clusters.push((c = { seed: [r, g, b], n: 0, exact: new Map() }))
      c.n++
      const key = (r << 16) | (g << 8) | b
      c.exact.set(key, (c.exact.get(key) ?? 0) + 1)
      if (!best || c.n > best.n) best = c
    }
  }
  if (!best) return WHITE
  let mode = 0
  let modeN = -1
  for (const [key, n] of best.exact) if (n > modeN) [mode, modeN] = [key, n]
  return rgbToHex((mode >> 16) & 255, (mode >> 8) & 255, mode & 255)
}

/** Dominant colour of a canvas region, read with one getImageData call. White if unreadable. */
export function sampleCoverColor(ctx: Pick<CanvasRenderingContext2D, 'getImageData'>, region: PxRect): string {
  try {
    return dominantColor(ctx.getImageData(region.x, region.y, region.w, region.h))
  } catch {
    return WHITE
  }
}

/** Readable default text colour for a replacement run drawn on `hex`. */
export function contrastText(hex: string): string {
  const { r, g, b } = parseHexColor(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? '#FFFFFF' : '#111111'
}
