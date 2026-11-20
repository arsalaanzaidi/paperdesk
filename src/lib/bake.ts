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
    const lineHeight = box.sizePt * LINE_HEIGHT_RATIO
    let y = firstBaselineY(pageHeight, box.yPt, box.sizePt)

    // Edit-boxes are single-line in the editor (no soft wrap), so only explicit newlines break here too.
    const lines = box.coverColor ? box.text.split('\n') : wrapLines(box.text, font, box.sizePt, box.wPt)
    for (const line of lines) {
      page.drawText(line, { x: box.xPt, y, size: box.sizePt, font, color: rgb(r, g, b) })
      y -= lineHeight
    }
  }

  return doc.save()
}
