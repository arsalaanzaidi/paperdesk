import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { create } from 'fontkit'
import { WINANSI, needsBundledFont, fontChain, cssFontStack, faceUrl, FACE_IDS } from './fonts'

const readFace = (id: (typeof FACE_IDS)[number]) => new Uint8Array(readFileSync(fileURLToPath(faceUrl(id))))

describe('WINANSI', () => {
  it('is exactly what the standard 14 fonts can draw', async () => {
    const doc = await PDFDocument.create()
    for (const name of [StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.Courier]) {
      const set = (await doc.embedFont(name)).getCharacterSet()
      expect([...WINANSI].sort((a, b) => a - b)).toEqual([...set].sort((a, b) => a - b))
    }
  })
})

describe('needsBundledFont', () => {
  it('keeps the standard fonts for WinAnsi text, accents, dashes and curly quotes included', () => {
    expect(needsBundledFont('café — “quoted” €5\nnext line')).toBe(false)
  })
  it('wants a bundled font for anything else, such as ₹ or ✓', () => {
    expect(needsBundledFont('Total ₹ 500')).toBe(true)
    expect(needsBundledFont('done ✓')).toBe(true)
  })
  it('composes decomposed accents first, so e + U+0301 still counts as WinAnsi', () => {
    expect(needsBundledFont('café')).toBe(false)
  })
})

describe('fontChain', () => {
  it("is the family's own face, then Arimo in the same style for what it lacks", () => {
    expect(fontChain('sans', false, false)).toEqual(['arimo-regular'])
    expect(fontChain('serif', true, false)).toEqual(['tinos-bold', 'arimo-bold'])
    expect(fontChain('mono', true, true)).toEqual(['cousine-bolditalic', 'arimo-bolditalic'])
  })
  it('has a matching CSS stack that ends in the generic family', () => {
    expect(cssFontStack('mono')).toBe('"pd-cousine", "pd-arimo", monospace')
    expect(cssFontStack('sans')).toBe('"pd-arimo", sans-serif')
  })
})

// Build checks on the shipped font files (see docs/superpowers/plans/2026-11-21-font-support.md).
describe('bundled fonts', () => {
  for (const id of FACE_IDS) {
    it(`${id} can be embedded and subset safely`, () => {
      const font = create(readFace(id))
      // fsType bit 1 (restricted licence) forbids embedding.
      expect(font['OS/2'].fsType.noEmbedding).toBe(false)
      // @pdf-lib/fontkit halved short-format loca offsets without padding; keep to fonts it can't hit.
      const offsets = font.loca.offsets
      const odd = offsets.slice(1).filter((o, i) => (o - offsets[i]) % 2 !== 0).length
      expect(font.head.indexToLocFormat === 1 || odd === 0).toBe(true)
    })
  }

  it('every style of every family can draw ₹ through its chain', () => {
    for (const family of ['sans', 'serif', 'mono'] as const) {
      for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
        const covered = fontChain(family, bold, italic).some((id) => create(readFace(id)).hasGlyphForCodePoint(0x20b9))
        expect(covered, `${family} bold=${bold} italic=${italic}`).toBe(true)
      }
    }
  })
})
