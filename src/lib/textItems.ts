import type { PDFPageProxy } from 'pdfjs-dist'
import { ASCENT_RATIO, LINE_HEIGHT_RATIO, rgbToHex, type Family, type TextBox } from './overlay'

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
  /** The run's original fill colour (#RRGGBB), when the operator list says what it is. */
  color?: string
  /** The run's font name without its subset tag ("Calibri-Bold"), when pdf.js knows it. */
  baseFont?: string
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

/** The subset of pdf.js's operator list that runColors reads. */
export interface OpList {
  fnArray: ArrayLike<number>
  argsArray: ArrayLike<unknown>
}

/** pdf.js's OPS table (op name to code). Passed in so this module needs no pdf.js runtime import. */
export type OpCodes = Record<string, number>

/** Text rendering modes that paint nothing (3) or only clip (7). */
const INVISIBLE_MODES = new Set([3, 7])

/** NFKC (pdf.js normalises ligatures in text content) and no whitespace (pdf.js inserts spaces). */
const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')

/**
 * Fill colour of each text item, read from the page's operator list. pdf.js has already turned
 * grey, CMYK and other colour spaces into setFillRGBColor (0-255) there. Show-text glyphs are
 * lined up with the items in document order; an item gets the most common colour among its
 * characters, or undefined when it is invisible, pattern-filled or cannot be found.
 */
export function runColors(texts: string[], ops: OpList, OPS: OpCodes): (string | undefined)[] {
  let state: { fill: string | null; mode: number } = { fill: '#000000', mode: 0 }
  const stack: (typeof state)[] = []
  let stream = ''
  const colorAt: (string | null)[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as ArrayLike<unknown> | null
    if (fn === OPS.save) stack.push({ ...state })
    else if (fn === OPS.restore) state = stack.pop() ?? state
    else if (fn === OPS.setFillRGBColor && args)
      state.fill = rgbToHex(Number(args[0]), Number(args[1]), Number(args[2]))
    else if (fn === OPS.setFillColorN || fn === OPS.setFillTransparent) state.fill = null
    else if (fn === OPS.setTextRenderingMode && args) state.mode = Number(args[0])
    else if ((fn === OPS.showText || fn === OPS.showSpacedText) && args) {
      const color = INVISIBLE_MODES.has(state.mode) ? null : state.fill
      for (const g of (args[0] ?? []) as unknown[]) {
        if (!g || typeof g !== 'object') continue // spacing numbers
        const chars = squash(String((g as { unicode?: unknown }).unicode ?? ''))
        stream += chars
        for (let c = 0; c < chars.length; c++) colorAt.push(color)
      }
    }
  }

  let cursor = 0
  return texts.map((text) => {
    const target = squash(text)
    if (!target) return undefined
    let at = stream.indexOf(target, cursor)
    if (at >= 0) cursor = at + target.length
    else at = stream.indexOf(target) // out of order: look anywhere, keep the cursor
    if (at < 0) return undefined
    const counts = new Map<string | null, number>()
    for (let c = at; c < at + target.length; c++) counts.set(colorAt[c], (counts.get(colorAt[c]) ?? 0) + 1)
    let best: string | null = null
    let bestN = 0
    for (const [color, n] of counts) if (n > bestN) [best, bestN] = [color, n]
    return best ?? undefined
  })
}

/** Extra width so re-wrapping the original string at bake time doesn't push its last word to a new line. */
const WIDTH_PAD_RATIO = 0.1

const MONO_NAMES = /courier|mono|consol|menlo|cousine/i
const SERIF_NAMES = /times|georgia|garamond|cambria|caladea|gelasio|tinos|palatino|antiqua|bookman|baskerville|caslon|didot|serif/i
const SANS_NAMES = /arial|helvetica|calibri|carlito|segoe|selawik|verdana|tahoma|roboto|opensans|open sans|arimo|sans/i

/**
 * Heuristic style guess. `baseName` is the real font name from pdf.js's commonObjs
 * (e.g. "Helvetica-Bold", "ABCDEF+Arial-ItalicMT"), or '' if unknown. `genericFamily`
 * is pdf.js's content.styles fontFamily ("sans-serif" | "serif" | "monospace"), which pdf.js
 * derives from the font's own serif and fixed-pitch flags: it decides when the name doesn't.
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
  if (MONO_NAMES.test(baseName)) family = 'mono'
  else if (SERIF_NAMES.test(baseName) && !/sans/i.test(baseName)) family = 'serif'
  else if (SANS_NAMES.test(baseName)) family = 'sans'
  else if (genericFamily === 'serif') family = 'serif'
  else if (genericFamily === 'monospace') family = 'mono'
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

/** All clickable text runs on a page, in top-left pt space at scale 1. `OPS` is pdf.js's op table. */
export async function extractTextItems(page: PDFPageProxy, OPS: OpCodes): Promise<PageTextItem[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const raw = content.items.flatMap((i) => ('str' in i ? [i as RawTextItem] : []))

  // The operator list carries each run's fill colour. Building it also populates commonObjs,
  // where the real font names live; pdf.js caches it per page.
  const ids = [...new Set(raw.map((i) => i.fontName))]
  let colors: (string | undefined)[] = []
  try {
    colors = runColors(raw.map((i) => i.str), await page.getOperatorList(), OPS)
  } catch {
    // Colours fall back to the editor default; style guess falls back to the generic family.
  }

  const styleOf = new Map<string, FontGuess>()
  const nameOf = new Map<string, string>()
  for (const id of ids) {
    let font: { name?: string; bold?: boolean; italic?: boolean } | undefined
    try {
      font = page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined
    } catch {
      font = undefined
    }
    const generic = content.styles[id]?.fontFamily ?? ''
    styleOf.set(id, guessStyle(font?.name ?? '', generic, font?.bold, font?.italic))
    if (font?.name) nameOf.set(id, font.name.replace(/^[A-Z]{6}\+/, ''))
  }

  return raw.flatMap((i, n) => {
    const it = toPageTextItem(i, viewport.transform, styleOf.get(i.fontName) ?? guessStyle('', ''))
    if (!it) return []
    const baseFont = nameOf.get(i.fontName)
    return [{ ...it, ...(colors[n] && { color: colors[n] }), ...(baseFont && { baseFont }) }]
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
