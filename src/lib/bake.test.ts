import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bakeOverlays, wrapLines } from './bake'
import type { TextBox } from './overlay'

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
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

async function page1Ops(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise
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
