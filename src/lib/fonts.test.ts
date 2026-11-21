import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { create } from 'fontkit'
import {
  WINANSI,
  needsBundledFont,
  usesBundledFont,
  fontChain,
  cssFontStack,
  faceUrl,
  matchFont,
  FACE_IDS,
} from './fonts'

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

const box = (family: 'sans' | 'serif' | 'mono', bold = false, italic = false, fontKey?: string) =>
  ({ family, bold, italic, fontKey }) as Parameters<typeof fontChain>[0]

describe('fontChain', () => {
  it("is the family's own face, then Arimo in the same style for what it lacks", () => {
    expect(fontChain(box('sans'))).toEqual(['arimo-regular'])
    expect(fontChain(box('serif', true))).toEqual(['tinos-bold', 'arimo-bold'])
    expect(fontChain(box('mono', true, true))).toEqual(['cousine-bolditalic', 'arimo-bolditalic'])
  })
  it('starts with the matched look-alike when the box has one', () => {
    expect(fontChain(box('sans', true, false, 'carlito'))).toEqual(['carlito-bold', 'arimo-bold'])
    expect(fontChain(box('serif', false, true, 'gelasio'))).toEqual(['gelasio-italic', 'arimo-italic'])
  })
  it('uses the nearest style a family has (Selawik has no italics)', () => {
    expect(fontChain(box('sans', false, true, 'selawik'))).toEqual(['selawik-regular', 'arimo-italic'])
    expect(fontChain(box('sans', true, true, 'selawik'))).toEqual(['selawik-bold', 'arimo-bolditalic'])
  })
  it('has a matching CSS stack that ends in the generic family', () => {
    expect(cssFontStack(box('mono'))).toBe('"pd-cousine", "pd-arimo", monospace')
    expect(cssFontStack(box('sans'))).toBe('"pd-arimo", sans-serif')
    expect(cssFontStack(box('serif', false, false, 'caladea'))).toBe('"pd-caladea", "pd-arimo", serif')
  })
})

describe('usesBundledFont', () => {
  it('is true for any box with a look-alike, even plain WinAnsi text', () => {
    expect(usesBundledFont({ ...box('sans', false, false, 'carlito'), text: 'Hello' })).toBe(true)
  })
  it('otherwise only for text the standard 14 cannot draw', () => {
    expect(usesBundledFont({ ...box('sans'), text: 'Hello' })).toBe(false)
    expect(usesBundledFont({ ...box('sans'), text: '₹ 5' })).toBe(true)
  })
})

describe('matchFont', () => {
  it('maps fonts with a metric-compatible open look-alike, whatever the subset tag, style or MT suffix', () => {
    expect(matchFont('FAKOKM+ArialMT')).toEqual({ fontKey: 'arimo', tier: 'metric', source: 'Arial' })
    expect(matchFont('Arial-BoldItalicMT')).toEqual({ fontKey: 'arimo', tier: 'metric', source: 'Arial' })
    expect(matchFont('ABCDEF+Calibri-Bold')).toEqual({ fontKey: 'carlito', tier: 'metric', source: 'Calibri' })
    expect(matchFont('Cambria,Italic')).toEqual({ fontKey: 'caladea', tier: 'metric', source: 'Cambria' })
    expect(matchFont('Georgia')).toEqual({ fontKey: 'gelasio', tier: 'metric', source: 'Georgia' })
    expect(matchFont('SegoeUI-Semibold')).toEqual({ fontKey: 'selawik', tier: 'metric', source: 'Segoe UI' })
    expect(matchFont('TimesNewRomanPSMT')).toEqual({ fontKey: 'tinos', tier: 'metric', source: 'Times New Roman' })
    expect(matchFont('CourierNewPS-BoldMT')).toEqual({ fontKey: 'cousine', tier: 'metric', source: 'Courier New' })
  })
  it('uses bundled families as themselves, ignoring pdf-lib-style random suffixes', () => {
    expect(matchFont('Roboto-Bold')).toEqual({ fontKey: 'roboto', tier: 'exact', source: 'Roboto' })
    expect(matchFont('OpenSans-Italic')).toEqual({ fontKey: 'opensans', tier: 'exact', source: 'Open Sans' })
    expect(matchFont('Arimo-Regular-4512')).toEqual({ fontKey: 'arimo', tier: 'exact', source: 'Arimo' })
  })
  it('keeps the standard 14 (no look-alike) for runs already in Helvetica, Times or Courier', () => {
    expect(matchFont('Helvetica-Bold')).toEqual({ tier: 'exact', source: 'Helvetica' })
    expect(matchFont('Times-Roman')).toEqual({ tier: 'exact', source: 'Times' })
    expect(matchFont('Courier')).toEqual({ tier: 'exact', source: 'Courier' })
  })
  it("calls anything else approximate, so the box's sans/serif/mono guess decides", () => {
    expect(matchFont('ABCDEF+Verdana-Bold')).toEqual({ tier: 'approx', source: 'Verdana' })
    expect(matchFont('ArialNarrow')).toEqual({ tier: 'approx', source: 'ArialNarrow' })
    expect(matchFont('')).toEqual({ tier: 'approx', source: '' })
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
    const keys = [undefined, 'carlito', 'caladea', 'gelasio', 'selawik', 'opensans', 'roboto']
    for (const fontKey of keys) {
      for (const family of ['sans', 'serif', 'mono'] as const) {
        for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
          const chain = fontChain(box(family, bold, italic, fontKey))
          const covered = chain.some((id) => create(readFace(id)).hasGlyphForCodePoint(0x20b9))
          expect(covered, `${fontKey ?? family} bold=${bold} italic=${italic}`).toBe(true)
        }
      }
    }
  })
})
