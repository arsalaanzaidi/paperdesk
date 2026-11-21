import type { Family } from './overlay'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/**
 * What pdf-lib's standard 14 fonts can draw (WinAnsi): ASCII, Latin-1 and the 27 extras WinAnsi
 * puts at 0x80-0x9F (€, curly quotes, dashes, ™, Œ…). Anything else needs a bundled font.
 */
export const WINANSI: ReadonlySet<number> = new Set([
  ...range(0x20, 0x7e),
  ...range(0xa0, 0xff),
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e,
  0x0178,
])

/** True when the standard 14 fonts can't draw `text`, so bake and the editor use a bundled font. */
export function needsBundledFont(text: string): boolean {
  for (const ch of text.normalize('NFC')) if (ch !== '\n' && !WINANSI.has(ch.codePointAt(0)!)) return true
  return false
}

// Vite emits each file as a hashed asset; only these URL strings land in the main chunk.
const URLS = {
  'arimo-regular': new URL('../assets/fonts/Arimo-Regular.ttf', import.meta.url).href,
  'arimo-bold': new URL('../assets/fonts/Arimo-Bold.ttf', import.meta.url).href,
  'arimo-italic': new URL('../assets/fonts/Arimo-Italic.ttf', import.meta.url).href,
  'arimo-bolditalic': new URL('../assets/fonts/Arimo-BoldItalic.ttf', import.meta.url).href,
  'tinos-regular': new URL('../assets/fonts/Tinos-Regular.ttf', import.meta.url).href,
  'tinos-bold': new URL('../assets/fonts/Tinos-Bold.ttf', import.meta.url).href,
  'tinos-italic': new URL('../assets/fonts/Tinos-Italic.ttf', import.meta.url).href,
  'tinos-bolditalic': new URL('../assets/fonts/Tinos-BoldItalic.ttf', import.meta.url).href,
  'cousine-regular': new URL('../assets/fonts/Cousine-Regular.ttf', import.meta.url).href,
  'cousine-bold': new URL('../assets/fonts/Cousine-Bold.ttf', import.meta.url).href,
  'cousine-italic': new URL('../assets/fonts/Cousine-Italic.ttf', import.meta.url).href,
  'cousine-bolditalic': new URL('../assets/fonts/Cousine-BoldItalic.ttf', import.meta.url).href,
} as const

export type FaceId = keyof typeof URLS
export const FACE_IDS = Object.keys(URLS) as FaceId[]
export const faceUrl = (id: FaceId): string => URLS[id]

/** Metric-compatible stand-ins: Arimo for Arial/Helvetica, Tinos for Times, Cousine for Courier. */
const OWN = { sans: 'arimo', serif: 'tinos', mono: 'cousine' } as const
const styleOf = (bold: boolean, italic: boolean) =>
  bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular'

/**
 * The faces a box draws with, in order: its family's own, then Arimo in the same style for the
 * characters that one lacks (Cousine has no ₹).
 */
export function fontChain(family: Family, bold: boolean, italic: boolean): FaceId[] {
  const style = styleOf(bold, italic)
  const own = `${OWN[family]}-${style}` as FaceId
  return OWN[family] === 'arimo' ? [own] : [own, `arimo-${style}` as FaceId]
}

/** The editor's CSS stack for the same chain; the browser falls back per character the same way. */
export function cssFontStack(family: Family): string {
  const generic = family === 'serif' ? 'serif' : family === 'mono' ? 'monospace' : 'sans-serif'
  const faces = OWN[family] === 'arimo' ? ['pd-arimo'] : [`pd-${OWN[family]}`, 'pd-arimo']
  return [...faces.map((f) => `"${f}"`), generic].join(', ')
}

/** Export or the editor couldn't get a bundled font or fontkit, most likely after a deploy. */
export class FontsUnavailableError extends Error {
  constructor() {
    super('Could not load the fonts this export needs. Reload the page and export again.')
  }
}

const bytes = new Map<FaceId, Promise<Uint8Array>>()

/** Fetch a bundled font once; bake and the editor share the bytes. */
export function loadFontBytes(id: FaceId): Promise<Uint8Array> {
  let p = bytes.get(id)
  if (!p) {
    p = fetch(URLS[id]).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.url}`)
      return new Uint8Array(await r.arrayBuffer())
    })
    p.catch(() => bytes.delete(id))
    bytes.set(id, p)
  }
  return p
}

const faces = new Map<FaceId, Promise<void>>()
const loaded = new Set<FaceId>()

export const faceLoaded = (id: FaceId): boolean => loaded.has(id)

/** Register a bundled face with `document.fonts` under its pd-* family, weight and style. */
export function loadFace(id: FaceId): Promise<void> {
  let p = faces.get(id)
  if (!p) {
    const [family, style] = id.split('-')
    p = loadFontBytes(id).then(async (data) => {
      const face = new FontFace(`pd-${family}`, data.slice().buffer as ArrayBuffer, {
        weight: style.includes('bold') ? '700' : '400',
        style: style.includes('italic') ? 'italic' : 'normal',
      })
      await face.load()
      document.fonts.add(face)
      loaded.add(id)
    })
    p.catch(() => faces.delete(id))
    faces.set(id, p)
  }
  return p
}
