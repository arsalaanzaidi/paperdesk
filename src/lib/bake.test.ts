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
})
