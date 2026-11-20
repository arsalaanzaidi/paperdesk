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
  coverSampleRegion,
  dominantColor,
  sampleCoverColor,
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

describe('coverSampleRegion', () => {
  it('covers exactly the run box, in device pixels', () => {
    // No margin: page outside a tight band (table row, badge) must not outvote the band.
    expect(coverSampleRegion({ xPt: 48, yPt: 100, wPt: 60, hPt: 20 }, 1, 2, 1200, 1600)).toEqual({
      x: 96, y: 200, w: 120, h: 40,
    })
  })
  it('scales with zoom', () => {
    expect(coverSampleRegion({ xPt: 48, yPt: 100, wPt: 60, hPt: 20 }, 0.5, 1, 1200, 1600)).toEqual({
      x: 24, y: 50, w: 30, h: 10,
    })
  })
  it('clamps to the canvas bounds', () => {
    expect(coverSampleRegion({ xPt: 0, yPt: 790, wPt: 20, hPt: 20 }, 1, 1, 600, 800)).toEqual({
      x: 0, y: 790, w: 20, h: 10,
    })
  })
  it('returns null for an empty canvas', () => {
    expect(coverSampleRegion({ xPt: 48, yPt: 100, wPt: 60, hPt: 20 }, 1, 1, 0, 0)).toBeNull()
  })
  it('returns null when the region lies entirely off the canvas', () => {
    expect(coverSampleRegion({ xPt: 900, yPt: 100, wPt: 60, hPt: 20 }, 1, 1, 600, 800)).toBeNull()
  })
})

/** w x h RGBA image filled with `bg`, then `paint(x, y)` returning an override colour or null. */
function image(w: number, h: number, bg: number[], paint: (x: number, y: number) => number[] | null = () => null) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(paint(x, y) ?? bg, (y * w + x) * 4)
  return { data, width: w, height: h }
}
const WHITE_PX = [255, 255, 255, 255]
const BLACK_PX = [0, 0, 0, 255]

describe('dominantColor', () => {
  it('returns the background when a previous glyph fills the left margin', () => {
    // Regression: the old single point 3px left of the run landed on the previous letter.
    // Margin x<6 is solid ink (previous glyph); inside the run, every 4th column is ink (~25%).
    const img = image(120, 40, WHITE_PX, (x) => (x < 6 || x % 4 === 0 ? BLACK_PX : null))
    expect(dominantColor(img)).toBe(WHITE)
  })
  it('finds a coloured background behind dark text', () => {
    const img = image(80, 30, [59, 74, 224, 255], (x, y) => (x % 3 === 0 && y % 2 === 0 ? BLACK_PX : null))
    expect(dominantColor(img)).toBe('#3B4AE0')
  })
  it('returns the exact background, not a mean pulled off by anti-aliased edge pixels', () => {
    // Smoke regression: near-white AA pixels joined the white cluster and the mean gave #FEFEFE.
    const img = image(100, 20, WHITE_PX, (x) =>
      x % 10 === 0 ? BLACK_PX : x % 10 === 1 ? [245, 245, 245, 255] : x % 10 === 2 ? [250, 250, 250, 255] : null,
    )
    expect(dominantColor(img)).toBe(WHITE)
  })
  it('keeps a noisy background together across colour boundaries', () => {
    // 127/128 straddles a 4-bit bucket edge; ink (35%) must not win by the background splitting.
    const img = image(100, 20, [127, 127, 127, 255], (x, y) =>
      x % 20 < 7 ? BLACK_PX : (x + y) % 2 ? [128, 128, 128, 255] : null,
    )
    expect(dominantColor(img)).toMatch(/^#(7F|80){3}$/)
  })
  it('keeps an off-white background together when channels jitter independently', () => {
    const img = image(100, 20, WHITE_PX, (x, y) =>
      x % 20 < 7 ? BLACK_PX : [239 + (x % 2), 239 + (y % 2), 239 + ((x + y) % 3 === 0 ? 1 : 0), 255],
    )
    expect(dominantColor(img)).toMatch(/^#(EF|F0){3}$/)
  })
  it('treats fully transparent pixels as white', () => {
    expect(dominantColor(image(10, 10, [0, 0, 0, 0]))).toBe(WHITE)
  })
  it('returns white for an empty image', () => {
    expect(dominantColor({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBe(WHITE)
  })
})

describe('sampleCoverColor', () => {
  const ctxOf = (img: ReturnType<typeof image>) =>
    ({ getImageData: () => img }) as unknown as Pick<CanvasRenderingContext2D, 'getImageData'>
  it('reads the region with one getImageData call', () => {
    const calls: number[][] = []
    const ctx = {
      getImageData: (...a: number[]) => {
        calls.push(a)
        return image(4, 4, [59, 74, 224, 255])
      },
    } as unknown as Pick<CanvasRenderingContext2D, 'getImageData'>
    expect(sampleCoverColor(ctx, { x: 1, y: 2, w: 4, h: 4 })).toBe('#3B4AE0')
    expect(calls).toEqual([[1, 2, 4, 4]])
  })
  it('returns the dominant colour of the region, not the fallback', () => {
    const img = image(8, 8, [220, 30, 40, 255], (x) => (x % 3 === 0 ? WHITE_PX : null))
    expect(sampleCoverColor(ctxOf(img), { x: 0, y: 0, w: 8, h: 8 })).toBe('#DC1E28')
  })
  it('falls back to white when the read throws', () => {
    const bad = {
      getImageData: () => {
        throw new Error('nope')
      },
    } as unknown as Pick<CanvasRenderingContext2D, 'getImageData'>
    expect(sampleCoverColor(bad, { x: 0, y: 0, w: 4, h: 4 })).toBe(WHITE)
  })
})

describe('contrastText', () => {
  it('uses white text on dark covers and near-black on light ones', () => {
    expect(contrastText('#3B4AE0')).toBe('#FFFFFF')
    expect(contrastText('#FFFFFF')).toBe('#111111')
  })
})
