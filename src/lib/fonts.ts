import type { Family, TextBox } from './overlay'

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

// Vite emits each file as a hashed asset; only these URL strings land in the main chunk. Each one
// must be a literal `new URL('…', import.meta.url)` for Vite to find it.
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
  'carlito-regular': new URL('../assets/fonts/Carlito-Regular.ttf', import.meta.url).href,
  'carlito-bold': new URL('../assets/fonts/Carlito-Bold.ttf', import.meta.url).href,
  'carlito-italic': new URL('../assets/fonts/Carlito-Italic.ttf', import.meta.url).href,
  'carlito-bolditalic': new URL('../assets/fonts/Carlito-BoldItalic.ttf', import.meta.url).href,
  'caladea-regular': new URL('../assets/fonts/Caladea-Regular.ttf', import.meta.url).href,
  'caladea-bold': new URL('../assets/fonts/Caladea-Bold.ttf', import.meta.url).href,
  'caladea-italic': new URL('../assets/fonts/Caladea-Italic.ttf', import.meta.url).href,
  'caladea-bolditalic': new URL('../assets/fonts/Caladea-BoldItalic.ttf', import.meta.url).href,
  'gelasio-regular': new URL('../assets/fonts/Gelasio-Regular.ttf', import.meta.url).href,
  'gelasio-bold': new URL('../assets/fonts/Gelasio-Bold.ttf', import.meta.url).href,
  'gelasio-italic': new URL('../assets/fonts/Gelasio-Italic.ttf', import.meta.url).href,
  'gelasio-bolditalic': new URL('../assets/fonts/Gelasio-BoldItalic.ttf', import.meta.url).href,
  'selawik-regular': new URL('../assets/fonts/Selawik-Regular.ttf', import.meta.url).href,
  'selawik-bold': new URL('../assets/fonts/Selawik-Bold.ttf', import.meta.url).href,
  'opensans-regular': new URL('../assets/fonts/OpenSans-Regular.ttf', import.meta.url).href,
  'opensans-bold': new URL('../assets/fonts/OpenSans-Bold.ttf', import.meta.url).href,
  'opensans-italic': new URL('../assets/fonts/OpenSans-Italic.ttf', import.meta.url).href,
  'opensans-bolditalic': new URL('../assets/fonts/OpenSans-BoldItalic.ttf', import.meta.url).href,
  'roboto-regular': new URL('../assets/fonts/Roboto-Regular.ttf', import.meta.url).href,
  'roboto-bold': new URL('../assets/fonts/Roboto-Bold.ttf', import.meta.url).href,
  'roboto-italic': new URL('../assets/fonts/Roboto-Italic.ttf', import.meta.url).href,
  'roboto-bolditalic': new URL('../assets/fonts/Roboto-BoldItalic.ttf', import.meta.url).href,
} as const

export type FaceId = keyof typeof URLS
export const FACE_IDS = Object.keys(URLS) as FaceId[]
export const faceUrl = (id: FaceId): string => URLS[id]

/** The bundled families: their generic class (the box's `family`) and display name. */
export const FAMILIES = {
  arimo: { label: 'Arimo', generic: 'sans' },
  tinos: { label: 'Tinos', generic: 'serif' },
  cousine: { label: 'Cousine', generic: 'mono' },
  carlito: { label: 'Carlito', generic: 'sans' },
  caladea: { label: 'Caladea', generic: 'serif' },
  gelasio: { label: 'Gelasio', generic: 'serif' },
  selawik: { label: 'Selawik', generic: 'sans' },
  opensans: { label: 'Open Sans', generic: 'sans' },
  roboto: { label: 'Roboto', generic: 'sans' },
} as const satisfies Record<string, { label: string; generic: Family }>

export type FontKey = keyof typeof FAMILIES

/** Each family's own stand-in when a box has no look-alike: Arimo, Tinos and Cousine. */
const OWN = { sans: 'arimo', serif: 'tinos', mono: 'cousine' } as const
type Style = 'regular' | 'bold' | 'italic' | 'bolditalic'
const styleOf = (bold: boolean, italic: boolean): Style =>
  bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular'

/** The face of `key` nearest to `style`: without italic first (Selawik has none), then regular. */
function faceIn(key: FontKey, style: Style): FaceId {
  for (const s of [style, style === 'bolditalic' ? 'bold' : 'regular', 'regular']) {
    const id = `${key}-${s}`
    if (id in URLS) return id as FaceId
  }
  throw new Error(`no face for ${key}`)
}

type FontBox = Pick<TextBox, 'family' | 'bold' | 'italic' | 'fontKey'>

/**
 * The faces a box draws with, in order: its look-alike (or its family's own stand-in), then
 * Arimo in the same style for the characters that one lacks (Cousine has no ₹).
 */
export function fontChain(box: FontBox): FaceId[] {
  const style = styleOf(box.bold, box.italic)
  const own = faceIn(box.fontKey ?? OWN[box.family], style)
  const fallback = `arimo-${style}` as FaceId
  return own === fallback ? [own] : [own, fallback]
}

/** The editor's CSS stack for the same chain; the browser falls back per character the same way. */
export function cssFontStack(box: Pick<TextBox, 'family' | 'fontKey'>): string {
  const generic = box.family === 'serif' ? 'serif' : box.family === 'mono' ? 'monospace' : 'sans-serif'
  const own = box.fontKey ?? OWN[box.family]
  const faces = own === 'arimo' ? ['pd-arimo'] : [`pd-${own}`, 'pd-arimo']
  return [...faces.map((f) => `"${f}"`), generic].join(', ')
}

/** A box with a look-alike always draws in it; otherwise only text the standard 14 can't draw does. */
export function usesBundledFont(box: Pick<TextBox, 'fontKey' | 'text'>): boolean {
  return !!box.fontKey || needsBundledFont(box.text)
}

export type MatchTier = 'exact' | 'metric' | 'approx'

/** How an original font is drawn: `exact` itself, `metric` a look-alike with its widths, `approx` a guess. */
export interface FontMatch {
  fontKey?: FontKey
  tier: MatchTier
  /** The original family's name, for the toolbar ("Calibri"). */
  source: string
}

/** Known families by squashed name: [look-alike or none (standard 14), tier, display name]. */
const KNOWN: Record<string, [FontKey | undefined, MatchTier, string]> = {
  helvetica: [undefined, 'exact', 'Helvetica'],
  times: [undefined, 'exact', 'Times'],
  courier: [undefined, 'exact', 'Courier'],
  arial: ['arimo', 'metric', 'Arial'],
  liberationsans: ['arimo', 'metric', 'Liberation Sans'],
  timesnewroman: ['tinos', 'metric', 'Times New Roman'],
  liberationserif: ['tinos', 'metric', 'Liberation Serif'],
  couriernew: ['cousine', 'metric', 'Courier New'],
  liberationmono: ['cousine', 'metric', 'Liberation Mono'],
  calibri: ['carlito', 'metric', 'Calibri'],
  cambria: ['caladea', 'metric', 'Cambria'],
  georgia: ['gelasio', 'metric', 'Georgia'],
  segoeui: ['selawik', 'metric', 'Segoe UI'],
  ...Object.fromEntries(
    (Object.keys(FAMILIES) as FontKey[]).map((k) => [k, [k, 'exact', FAMILIES[k].label] as [FontKey, MatchTier, string]]),
  ),
}

/**
 * Match a PDF font name (pdf.js's BaseFont, e.g. "FAKOKM+ArialMT", "Calibri-Bold", "Cambria,Italic")
 * to how paperdesk draws it. The family is the name without its subset tag, a pdf-lib random
 * suffix, the style after "-" or ",", and the PS/MT suffix.
 */
export function matchFont(baseFont: string): FontMatch {
  const family = baseFont
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/-\d+$/, '')
    .split(/[-,]/)[0]
    .replace(/(PSMT|MT|PS)$/, '')
  const known = KNOWN[family.toLowerCase()]
  if (!known) return { tier: 'approx', source: family }
  const [fontKey, tier, source] = known
  return fontKey ? { fontKey, tier, source } : { tier, source }
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
