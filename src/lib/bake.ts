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
