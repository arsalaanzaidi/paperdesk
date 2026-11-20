import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist'
import {
  guessStyle,
  toPageTextItem,
  extractTextItems,
  runColors,
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

describe('runColors', () => {
  const { OPS } = pdfjs
  type Op = [number, unknown[] | null]
  const show = (s: string): Op => [OPS.showText, [[...s].map((unicode) => ({ unicode, isSpace: unicode === ' ' }))]]
  const fill = (r: number, g: number, b: number): Op => [OPS.setFillRGBColor, [r, g, b]]
  const opList = (...ops: Op[]) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) })

  it('gives each run the fill colour it was drawn with', () => {
    const ops = opList(fill(87, 87, 87), show('Total Amount:'), fill(0, 0, 0), show('Fare:'))
    expect(runColors(['Total Amount:', 'Fare:'], ops, OPS)).toEqual(['#575757', '#000000'])
  })
  it('starts black and restores the colour saved before a nested change', () => {
    const ops = opList([OPS.save, null], fill(87, 87, 87), show('Grey'), [OPS.restore, null], show('Black'))
    expect(runColors(['Grey', 'Black'], ops, OPS)).toEqual(['#575757', '#000000'])
  })
  it('matches an item that pdf.js built from several show-text ops, with inserted spaces', () => {
    const ops = opList(fill(200, 0, 0), show('Hello'), show('World'))
    expect(runColors(['Hello World'], ops, OPS)).toEqual(['#C80000'])
  })
  it('takes the most common colour when an item mixes colours', () => {
    const ops = opList(fill(87, 87, 87), show('AB'), fill(0, 0, 0), show('C'))
    expect(runColors(['ABC'], ops, OPS)).toEqual(['#575757'])
  })
  it('matches ligatures that pdf.js normalised in the text content', () => {
    const ops = opList(fill(0, 0, 255), show('ﬁne'))
    expect(runColors(['fine'], ops, OPS)).toEqual(['#0000FF'])
  })
  it('gives invisible text (rendering mode 3, e.g. an OCR layer) no colour', () => {
    const ops = opList([OPS.setTextRenderingMode, [3]], show('OCR'))
    expect(runColors(['OCR'], ops, OPS)).toEqual([undefined])
  })
  it('gives pattern-filled text no colour', () => {
    const ops = opList([OPS.setFillColorN, ['Shading', {}]], show('Fancy'))
    expect(runColors(['Fancy'], ops, OPS)).toEqual([undefined])
  })
  it('gives an item it cannot find no colour, without derailing the items after it', () => {
    const ops = opList(fill(87, 87, 87), show('Alpha'), fill(0, 128, 0), show('Beta'))
    expect(runColors(['Missing', 'Beta'], ops, OPS)).toEqual([undefined, '#008000'])
  })
  it('keeps repeated strings in document order', () => {
    const ops = opList(fill(87, 87, 87), show('Total'), fill(0, 0, 0), show('Total'))
    expect(runColors(['Total', 'Total'], ops, OPS)).toEqual(['#575757', '#000000'])
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
      // drawText emits an unkerned Tj, but widthOfTextAtSize subtracts kerning pairs,
      // so sum per-glyph widths to get the width actually drawn.
      titleWidth: [...'Bold Title'].reduce((w, ch) => w + bold.widthOfTextAtSize(ch, 20), 0),
    }
  }

  it('returns one item per real run, positioned in top-left pt space', async () => {
    const { page, titleWidth } = await samplePage()
    const items = await extractTextItems(page, pdfjs.OPS)
    expect(items.map((i) => i.str)).toEqual(['Bold Title', 'Italic line', 'Mono line'])
    const title = items[0]
    expect(title.xPt).toBeCloseTo(48, 1)
    expect(title.yPt).toBeCloseTo(800 - 700 - 16, 1)
    expect(title.sizePt).toBeCloseTo(20, 1)
    expect(title.wPt).toBeCloseTo(titleWidth + 2, 0)
  })

  it("carries each run's original fill colour", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Grey label', { x: 48, y: 700, size: 12, font, color: rgb(87 / 255, 87 / 255, 87 / 255) })
    page.drawText('Black label', { x: 48, y: 650, size: 12, font })
    const pdf = await pdfjs
      .getDocument({ data: await doc.save(), useWorkerFetch: false, isEvalSupported: false })
      .promise
    try {
      const items = await extractTextItems((await pdf.getPage(1)) as unknown as PDFPageProxy, pdfjs.OPS)
      expect(items.map((i) => [i.str, i.color])).toEqual([
        ['Grey label', '#575757'],
        ['Black label', '#000000'],
      ])
    } finally {
      await pdf.destroy()
    }
  })

  it('guesses family/bold/italic from the embedded standard fonts', async () => {
    const { page } = await samplePage()
    const [title, italic, mono] = await extractTextItems(page, pdfjs.OPS)
    expect(title).toMatchObject({ family: 'sans', bold: true, italic: false })
    expect(italic).toMatchObject({ family: 'serif', bold: false, italic: true })
    expect(mono).toMatchObject({ family: 'mono', bold: false, italic: false })
  })
})
