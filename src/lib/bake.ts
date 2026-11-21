import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import {
  type TextBox,
  standardFont,
  parseHexColor,
  firstBaselineY,
  LINE_HEIGHT_RATIO,
} from './overlay'
import {
  type FaceId,
  usesBundledFont,
  fontChain,
  loadFontBytes as fetchFontBytes,
  FontsUnavailableError,
} from './fonts'
import { splitRuns, type TextRun } from './textRuns'
import { loadFontkit } from './fontkit'

/** Greedy word-wrap to a max width in points by any width function; honours explicit newlines. */
export function wrapLinesBy(text: string, widthOf: (s: string) => number, maxWpt: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const trial = line ? `${line} ${word}` : word
      if (line && widthOf(trial) > maxWpt) {
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

/** Greedy word-wrap in one font. */
export function wrapLines(text: string, font: PDFFont, sizePt: number, maxWpt: number): string[] {
  return wrapLinesBy(text, (s) => font.widthOfTextAtSize(s, sizePt), maxWpt)
}

export interface BakeOptions {
  /** Where bundled font bytes come from; the browser fetches them, tests read them from disk. */
  loadFontBytes?: (id: FaceId) => Promise<Uint8Array>
}

interface Face {
  font: PDFFont
  has: (codePoint: number) => boolean
}

/** Draw every overlay box onto its page and return new PDF bytes. Never mutates input. */
export async function bakeOverlays(
  bytes: Uint8Array,
  boxes: TextBox[],
  { loadFontBytes = fetchFontBytes }: BakeOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()
  const standard = new Map<string, PDFFont>()
  const bundled = new Map<FaceId, Promise<Face>>()
  let fontkit: Promise<void> | null = null

  // Bundled faces are subset at save, so the file only grows by the glyphs actually drawn.
  const bundledFace = (id: FaceId): Promise<Face> => {
    let face = bundled.get(id)
    if (!face) {
      face = (async () => {
        let data: Uint8Array
        try {
          fontkit ??= loadFontkit().then((fk) => doc.registerFontkit(fk))
          await fontkit
          data = await loadFontBytes(id)
        } catch {
          throw new FontsUnavailableError()
        }
        const font = await doc.embedFont(data, { subset: true })
        const set = new Set(font.getCharacterSet())
        return { font, has: (cp: number) => set.has(cp) }
      })()
      bundled.set(id, face)
    }
    return face
  }

  for (const box of boxes) {
    const text = box.text.normalize('NFC')
    if (!text.trim()) continue
    const page = pages[box.page]
    if (!page) continue

    // Text the standard 14 can draw keeps them: nothing to download. Anything else is split into
    // runs over the box's font chain, and a character no font has stops the export.
    let fonts: PDFFont[]
    let runsOf: (line: string) => TextRun[]
    if (usesBundledFont({ ...box, text })) {
      const faces = await Promise.all(fontChain(box).map(bundledFace))
      const covers = faces.map((f) => f.has)
      fonts = faces.map((f) => f.font)
      runsOf = (line) => splitRuns(line, covers)
      runsOf(text.replace(/\n/g, ' ')) // refuse before drawing anything
    } else {
      const name = standardFont(box.family, box.bold, box.italic)
      let font = standard.get(name)
      if (!font) {
        font = await doc.embedFont(name)
        standard.set(name, font)
      }
      fonts = [font]
      runsOf = (line) => (line ? [{ text: line, font: 0 }] : [])
    }
    const widthOf = (s: string) =>
      runsOf(s).reduce((w, run) => w + fonts[run.font].widthOfTextAtSize(run.text, box.sizePt), 0)

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
    const lines = box.coverColor ? text.split('\n') : wrapLinesBy(text, widthOf, box.wPt)
    for (const line of lines) {
      let x = box.xPt
      for (const run of runsOf(line)) {
        const font = fonts[run.font]
        page.drawText(run.text, { x, y, size: box.sizePt, font, color: rgb(r, g, b) })
        x += font.widthOfTextAtSize(run.text, box.sizePt)
      }
      y -= lineHeight
    }
  }

  return doc.save()
}
