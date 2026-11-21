import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFDict, PDFName, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bakeOverlays, wrapLines } from './bake'
import { faceUrl, type FaceId } from './fonts'
import { subsetPdf } from './testFixtures'
import type { TextBox } from './overlay'

/** The bundled fonts, read from disk (the browser fetches them). */
const fromDisk = vi.fn(async (id: FaceId) => new Uint8Array(readFileSync(fileURLToPath(faceUrl(id)))))

/** BaseFont names of every font in a saved PDF, without their ABCDEF+ subset tag. */
async function fontNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const names: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font')) {
      const base = obj.get(PDFName.of('BaseFont'))
      if (base instanceof PDFName && !obj.get(PDFName.of('DescendantFonts')))
        names.push(base.decodeText().replace(/^[A-Z]{6}\+/, ''))
    }
  }
  return names
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([600, 800])
  return doc.save()
}

const boxWith = (text: string): TextBox => ({
  id: 'b1', page: 0, xPt: 50, yPt: 50, wPt: 400, hPt: 200,
  text, family: 'sans', sizePt: 24, color: '#000000', bold: false, italic: false,
})

async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, isEvalSupported: false }).promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

async function page1Ops(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, isEvalSupported: false }).promise
  return (await doc.getPage(1)).getOperatorList()
}

describe('wrapLines', () => {
  it('splits on explicit newlines', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    expect(wrapLines('a\nb', font, 12, 1000)).toEqual(['a', 'b'])
  })
  it('greedily wraps long text to the max width', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const lines = wrapLines('word word word word word word', font, 24, 120)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('bakeOverlays', () => {
  it('preserves page count and returns valid PDF bytes', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('Hello')])
    expect(out.length).toBeGreaterThan(0)
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })
  it('writes real, extractable text into the exported PDF', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('SmokeSentinel')])
    const text = await extractText(out)
    expect(text).toContain('SmokeSentinel')
  })
  it('skips empty boxes and out-of-range pages without throwing', async () => {
    const out = await bakeOverlays(await blankPdf(), [
      boxWith('   '),
      { ...boxWith('offpage'), page: 99 },
    ])
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })

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

  it('bakes an edit-box (coverColor) as a single line even when wider than wPt', async () => {
    const long = { ...boxWith('The quick brown fox jumps over the lazy dog'), wPt: 60 }
    const count = (fns: number[]) => fns.filter((f) => f === pdfjs.OPS.showText).length

    const edit = await page1Ops(await bakeOverlays(await blankPdf(), [{ ...long, coverColor: '#FFFFFF' }]))
    expect(count(edit.fnArray)).toBe(1)

    // Phase-1 add-boxes (no coverColor) still wrap to wPt.
    const add = await page1Ops(await bakeOverlays(await blankPdf(), [long]))
    expect(count(add.fnArray)).toBeGreaterThan(1)
  })

  it('draws no cover for an edit-box whose text was emptied', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('  '), coverColor: '#FF0000' }])
    const { fnArray } = await page1Ops(out)
    expect(fnArray).not.toContain(pdfjs.OPS.constructPath)
  })
})

describe('bakeOverlays with text the standard fonts cannot draw', () => {
  const opts = { loadFontBytes: fromDisk }

  it('exports ₹ in a sans box with Arimo, as real extractable text', async () => {
    const out = await bakeOverlays(await blankPdf(), [boxWith('Total ₹ 1,234.50')], opts)
    expect(await extractText(out)).toContain('Total ₹ 1,234.50')
    expect((await fontNames(out)).some((n) => n.startsWith('Arimo'))).toBe(true)
  })

  it('uses Tinos for serif boxes, in the box style', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('₹ 9'), family: 'serif', bold: true }], opts)
    expect((await fontNames(out)).some((n) => n.startsWith('Tinos-Bold'))).toBe(true)
  })

  it('draws a mono box in Cousine and only the ₹ it lacks in Arimo', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('Mono ₹ 7'), family: 'mono' }], opts)
    const names = await fontNames(out)
    expect(names.some((n) => n.startsWith('Cousine'))).toBe(true)
    expect(names.some((n) => n.startsWith('Arimo'))).toBe(true)
    expect((await extractText(out)).replace(/\s+/g, ' ')).toContain('Mono ₹ 7')
  })

  it('keeps an edit-box that holds ₹ on one line', async () => {
    const box = { ...boxWith('Total ₹ 1,234.50 and a long tail of words'), wPt: 40, coverColor: '#FFFFFF' }
    const { fnArray } = await page1Ops(await bakeOverlays(await blankPdf(), [box], opts))
    // One line, but one showText per font run: Arimo has every character here.
    expect(fnArray.filter((f) => f === pdfjs.OPS.showText).length).toBe(1)
  })

  it('wraps a mixed-font add-box by the widths of its runs', async () => {
    const box = { ...boxWith('₹ one ₹ two ₹ three ₹ four'), family: 'mono' as const, wPt: 90 }
    const out = await bakeOverlays(await blankPdf(), [box], opts)
    const doc = await pdfjs.getDocument({ data: out.slice(), useWorkerFetch: false, isEvalSupported: false }).promise
    const { items } = await (await doc.getPage(1)).getTextContent()
    const lineTops = new Set(items.filter((i) => 'str' in i && i.str.trim()).map((i) => ('transform' in i ? Math.round(i.transform[5]) : 0)))
    expect(lineTops.size).toBeGreaterThan(1)
  })

  it('draws a box matched to a look-alike in that font, even for plain WinAnsi text', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('Quarterly totals'), fontKey: 'carlito', bold: true }], opts)
    const names = await fontNames(out)
    expect(names.some((n) => n.startsWith('Carlito-Bold'))).toBe(true)
    expect(names.some((n) => n.startsWith('Helvetica'))).toBe(false)
    expect(await extractText(out)).toContain('Quarterly totals')
  })

  it('draws italic Selawik boxes upright, as Selawik has no italic', async () => {
    const out = await bakeOverlays(await blankPdf(), [{ ...boxWith('Slanted?'), fontKey: 'selawik', italic: true }], opts)
    expect((await fontNames(out)).some((n) => /^Selawik(?!.*Italic)/.test(n))).toBe(true)
  })

  it("draws an edit-box in the PDF's own font when it has every character, embedding nothing", async () => {
    const original = await subsetPdf('Total 1,234')
    const before = await fontNames(original)
    const box = { ...boxWith('Total 4,321'), coverColor: '#FFFFFF', sourceFont: 'ABCDEF+Arimo', fontKey: 'arimo' as const }
    fromDisk.mockClear()
    const out = await bakeOverlays(original, [box], opts)
    expect(fromDisk).not.toHaveBeenCalled()
    expect(await fontNames(out)).toEqual(before)
    const doc = await pdfjs.getDocument({ data: out.slice(), useWorkerFetch: false, isEvalSupported: false }).promise
    const { items } = await (await doc.getPage(1)).getTextContent()
    const orig = items.find((i) => 'str' in i && i.str === 'Total 1,234')
    const edit = items.find((i) => 'str' in i && i.str === 'Total 4,321')
    expect(edit && 'fontName' in edit && orig && 'fontName' in orig && edit.fontName === orig.fontName).toBe(true)
  })

  it("uses the look-alike for the whole box when the PDF's font lacks a character", async () => {
    const box = { ...boxWith('Totals 4,321'), coverColor: '#FFFFFF', sourceFont: 'ABCDEF+Arimo', fontKey: 'arimo' as const }
    const out = await bakeOverlays(await subsetPdf('Total 1,234'), [box], opts)
    expect((await fontNames(out)).filter((n) => n.startsWith('Arimo-Regular')).length).toBe(1)
    expect(await extractText(out)).toContain('Totals 4,321')
  })

  it('loads no font for plain WinAnsi text', async () => {
    fromDisk.mockClear()
    await bakeOverlays(await blankPdf(), [boxWith('café — “quoted” €5')], opts)
    expect(fromDisk).not.toHaveBeenCalled()
  })

  it('refuses a character no bundled font has, and names it', async () => {
    await expect(bakeOverlays(await blankPdf(), [boxWith('Hello 漢')], opts)).rejects.toThrow('漢 (U+6F22)')
  })

  it('asks for a reload when the fonts cannot be fetched (a deploy replaced them)', async () => {
    const gone = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(bakeOverlays(await blankPdf(), [boxWith('₹ 1')], { loadFontBytes: gone })).rejects.toThrow(/reload/i)
  })
})
