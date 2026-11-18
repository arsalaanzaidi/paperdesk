import { describe, it, expect, beforeEach } from 'vitest'
import { StandardFonts } from 'pdf-lib'
import {
  type TextBox,
  nextId,
  _resetIdCounter,
  remapAfterInsert,
  remapAfterDelete,
  remapAfterReorder,
  boxToScreen,
  pxToPt,
  firstBaselineY,
  standardFont,
  parseHexColor,
  rgbToHex,
  coverSamplePoint,
  sampleColorAt,
  contrastText,
  WHITE,
} from './overlay'

const box = (page: number): TextBox => ({
  id: `b${page}`, page, xPt: 10, yPt: 20, wPt: 100, hPt: 30,
  text: 'x', family: 'sans', sizePt: 16, color: '#111111', bold: false, italic: false,
})

beforeEach(() => _resetIdCounter())

describe('nextId', () => {
  it('produces sequential unique ids', () => {
    expect(nextId()).toBe('tb_1')
    expect(nextId()).toBe('tb_2')
  })
})

describe('page-key remap', () => {
  it('insert shifts pages at/after the insertion index up by one', () => {
    const out = remapAfterInsert([box(0), box(1), box(2)], 1).map((b) => b.page)
    expect(out).toEqual([0, 2, 3])
  })
  it('delete drops the deleted page and shifts later pages down', () => {
    const out = remapAfterDelete([box(0), box(1), box(2)], 1).map((b) => b.page)
    expect(out).toEqual([0, 1]) // page1 dropped, page2 -> 1
  })
  it('reorder applies the same permutation as moving a page', () => {
    // pages [0,1,2,3], move page 0 to index 2 => order [1,2,0,3]
    const out = remapAfterReorder([box(0), box(3)], 0, 2, 4).map((b) => b.page)
    expect(out).toEqual([2, 3]) // old page0 -> pos2, old page3 -> pos3
  })
})

describe('coordinate helpers', () => {
  it('boxToScreen scales points by zoom', () => {
    expect(boxToScreen(box(0), 2)).toEqual({ left: 20, top: 40, width: 200, height: 60 })
  })
  it('pxToPt divides by zoom', () => {
    expect(pxToPt(200, 2)).toBe(100)
  })
  it('firstBaselineY flips origin and drops by ascent', () => {
    // 800 - 20 - 16*0.8 = 767.2
    expect(firstBaselineY(800, 20, 16)).toBeCloseTo(767.2)
  })
})

describe('standardFont', () => {
  it('maps family + weight + style to standard-14 fonts', () => {
    expect(standardFont('sans', false, false)).toBe(StandardFonts.Helvetica)
    expect(standardFont('sans', true, true)).toBe(StandardFonts.HelveticaBoldOblique)
    expect(standardFont('serif', true, false)).toBe(StandardFonts.TimesRomanBold)
    expect(standardFont('mono', false, true)).toBe(StandardFonts.CourierOblique)
  })
})

describe('parseHexColor', () => {
  it('parses #rrggbb into 0..1 channels', () => {
    expect(parseHexColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
  })
  it('expands #rgb shorthand', () => {
    expect(parseHexColor('#0f0')).toEqual({ r: 0, g: 1, b: 0 })
  })
  it('falls back to black on bad input', () => {
    expect(parseHexColor('nonsense')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('rgbToHex', () => {
  it('formats 0-255 channels as uppercase #RRGGBB', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#FF0000')
    expect(rgbToHex(10, 20, 30)).toBe('#0A141E')
  })
  it('round-trips through parseHexColor', () => {
    const { r, g, b } = parseHexColor(rgbToHex(59, 74, 224))
    expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([59, 74, 224])
  })
})

describe('coverSamplePoint', () => {
  it('samples 3 css px left of the run, vertically centred, in device pixels', () => {
    // xCss = 48*1 - 3 = 45, yCss = (100 + 20/2)*1 = 110; pxPerCss 2 → (90, 220)
    expect(coverSamplePoint({ xPt: 48, yPt: 100, hPt: 20 }, 1, 2, 1200, 1600)).toEqual({ x: 90, y: 220 })
  })
  it('clamps to the canvas bounds', () => {
    expect(coverSamplePoint({ xPt: 0, yPt: 5000, hPt: 20 }, 1, 1, 600, 800)).toEqual({ x: 0, y: 799 })
  })
  it('returns null for an empty canvas', () => {
    expect(coverSamplePoint({ xPt: 48, yPt: 100, hPt: 20 }, 1, 1, 0, 0)).toBeNull()
  })
})

describe('sampleColorAt', () => {
  const ctxOf = (rgba: number[]) =>
    ({ getImageData: () => ({ data: new Uint8ClampedArray(rgba) }) }) as unknown as Pick<
      CanvasRenderingContext2D,
      'getImageData'
    >
  it('reads one pixel as hex', () => {
    expect(sampleColorAt(ctxOf([59, 74, 224, 255]), 0, 0)).toBe('#3B4AE0')
  })
  it('treats a fully transparent pixel as white', () => {
    expect(sampleColorAt(ctxOf([0, 0, 0, 0]), 0, 0)).toBe(WHITE)
  })
  it('falls back to white when the read throws', () => {
    const bad = {
      getImageData: () => {
        throw new Error('nope')
      },
    } as unknown as Pick<CanvasRenderingContext2D, 'getImageData'>
    expect(sampleColorAt(bad, 0, 0)).toBe(WHITE)
  })
})

describe('contrastText', () => {
  it('uses white text on dark covers and near-black on light ones', () => {
    expect(contrastText('#3B4AE0')).toBe('#FFFFFF')
    expect(contrastText('#FFFFFF')).toBe('#111111')
  })
})
