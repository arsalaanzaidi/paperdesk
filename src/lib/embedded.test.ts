import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { findEmbeddedFont } from './embedded'
import { subsetPdf } from './testFixtures'

describe('findEmbeddedFont', () => {
  it('finds a page font by its BaseFont and maps exactly the characters it drew', async () => {
    const doc = await PDFDocument.load(await subsetPdf('Total 1,234'))
    const font = findEmbeddedFont(doc, 0, 'ABCDEF+Arimo')
    expect(font).not.toBeNull()
    expect(font!.covers('Total 4,321')).toBe(true)
    expect(font!.covers('Totals')).toBe(false) // no "s" in the subset
    expect(font!.covers('Total 4.321')).toBe(false) // no "."
    expect(font!.cidFor('T'.codePointAt(0)!)).toBeGreaterThan(0)
  })

  it("encodes text as the font's own 2-byte codes", async () => {
    const doc = await PDFDocument.load(await subsetPdf('ab'))
    const font = findEmbeddedFont(doc, 0, 'ABCDEF+Arimo')!
    const [a, b] = ['a', 'b'].map((c) => font.cidFor(c.codePointAt(0)!)!)
    expect(font.hex('ba')).toBe([b, a].map((cid) => cid.toString(16).toUpperCase().padStart(4, '0')).join(''))
  })

  it('finds a font that lives in a form XObject, as many real PDFs have it', async () => {
    const inner = await PDFDocument.load(await subsetPdf('Total 1,234'))
    const outer = await PDFDocument.create()
    const [embedded] = await outer.embedPdf(inner, [0])
    outer.addPage([600, 800]).drawPage(embedded)
    const doc = await PDFDocument.load(await outer.save())
    expect(findEmbeddedFont(doc, 0, 'ABCDEF+Arimo')?.covers('Total 4,321')).toBe(true)
  })

  it('composes text first, so a decomposed accent still matches', async () => {
    const doc = await PDFDocument.load(await subsetPdf('café'))
    expect(findEmbeddedFont(doc, 0, 'ABCDEF+Arimo')!.covers('café')).toBe(true)
  })

  it('returns null for fonts it cannot reuse and names it cannot find', async () => {
    const d = await PDFDocument.create()
    d.addPage([600, 800]).drawText('Plain', { font: await d.embedFont(StandardFonts.Helvetica) })
    const doc = await PDFDocument.load(await d.save())
    expect(findEmbeddedFont(doc, 0, 'Helvetica')).toBeNull() // not embedded: nothing to reuse
    expect(findEmbeddedFont(doc, 0, 'Nope')).toBeNull()
    expect(findEmbeddedFont(doc, 5, 'Helvetica')).toBeNull()
  })
})
