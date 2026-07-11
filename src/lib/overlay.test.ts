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
