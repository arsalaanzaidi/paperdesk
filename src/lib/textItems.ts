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
