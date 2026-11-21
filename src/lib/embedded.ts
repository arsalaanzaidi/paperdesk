import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib'

/**
 * A font embedded in the PDF that new text can be drawn in by reference: its own glyphs, no
 * fontkit, nothing added to the file. Only Type0 fonts with Identity-H encoding, a TrueType
 * program (CIDFontType2 + FontFile2) and a ToUnicode map qualify, which covers what Word and
 * browsers write. Subsets hold only the glyphs the document used, so check `covers` first.
 */
export interface EmbeddedFont {
  /** The font dictionary, for the page's /Resources /Font. */
  ref: PDFRef
  /** The 2-byte code (CID) that draws `codePoint`, if the font has a real glyph for it. */
  cidFor(codePoint: number): number | undefined
  /** True when every character of `text` (newlines aside) has a glyph in this font. */
  covers(text: string): boolean
  /** `text` as the hex string of CIDs a Tj shows (call `covers` first). */
  hex(text: string): string
}

const name = (n: string) => PDFName.of(n)

function streamBytes(stream: unknown): Uint8Array | null {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode()
  if (stream instanceof PDFStream) return stream.getContents()
  return null
}

/** Font dicts a page can draw with: its own resources, and those of the form XObjects in them. */
function* fontsIn(doc: PDFDocument, resources: PDFDict | undefined, seen: Set<PDFDict>): Generator<[PDFRef, PDFDict]> {
  if (!resources || seen.has(resources)) return
  seen.add(resources)
  const fonts = resources.lookupMaybe(name('Font'), PDFDict)
  for (const [, value] of fonts?.entries() ?? []) {
    const dict = value instanceof PDFRef ? doc.context.lookupMaybe(value, PDFDict) : undefined
    if (value instanceof PDFRef && dict) yield [value, dict]
  }
  const xobjects = resources.lookupMaybe(name('XObject'), PDFDict)
  for (const [, value] of xobjects?.entries() ?? []) {
    const x = doc.context.lookup(value)
    if (x instanceof PDFStream && x.dict.get(name('Subtype')) === name('Form'))
      yield* fontsIn(doc, x.dict.lookupMaybe(name('Resources'), PDFDict), seen)
  }
}

/** Whether a glyph id has an outline, read from the TrueType program's loca table. */
function outlineCheck(program: Uint8Array): (gid: number) => boolean {
  const v = new DataView(program.buffer, program.byteOffset, program.byteLength)
  const tables: Record<string, number> = {}
  for (let i = 0, n = v.getUint16(4); i < n; i++) {
    const at = 12 + 16 * i
    tables[String.fromCharCode(...program.subarray(at, at + 4))] = v.getUint32(at + 8)
  }
  const { head, loca, maxp } = tables
  if (head === undefined || loca === undefined || maxp === undefined) return () => true // can't tell
  const long = v.getInt16(head + 50) === 1
  const numGlyphs = v.getUint16(maxp + 4)
  const offset = (g: number) => (long ? v.getUint32(loca + 4 * g) : v.getUint16(loca + 2 * g) * 2)
  return (gid) => gid > 0 && gid < numGlyphs && offset(gid + 1) > offset(gid)
}

/** The single code point a UTF-16BE hex string spells, or undefined (ligatures map to several). */
function codePointOf(hex: string): number | undefined {
  const units = hex.match(/.{4}/g)?.map((u) => parseInt(u, 16)) ?? []
  const chars = [...String.fromCharCode(...units)]
  return chars.length === 1 ? chars[0].codePointAt(0) : undefined
}

/** Unicode code point → CID, from a ToUnicode CMap's bfchar and bfrange entries (first one wins). */
export function parseToUnicode(cmap: string): Map<number, number> {
  const map = new Map<number, number>()
  const set = (cp: number | undefined, cid: number) => {
    if (cp !== undefined && cid > 0 && !map.has(cp)) map.set(cp, cid)
  }
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const [, src, dst] of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) set(codePointOf(dst), parseInt(src, 16))
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const [, lo, hi, dst, list] of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const first = parseInt(lo, 16)
      const last = parseInt(hi, 16)
      if (dst) {
        const base = codePointOf(dst)
        if (base !== undefined) for (let cid = first; cid <= last; cid++) set(base + cid - first, cid)
      } else {
        ;[...list.matchAll(/<([0-9a-fA-F]+)>/g)].forEach(([, h], i) => {
          if (first + i <= last) set(codePointOf(h), first + i)
        })
      }
    }
  return map
}

/** Pairs a subset may have kept under either code point (an empty space glyph is often U+00A0). */
const ALIASES: [number, number][] = [
  [0x20, 0xa0],
  [0x2d, 0xad],
]

function reusable(doc: PDFDocument, ref: PDFRef, font: PDFDict): EmbeddedFont | null {
  if (font.get(name('Subtype')) !== name('Type0') || font.get(name('Encoding')) !== name('Identity-H')) return null
  const cidFont = font.lookupMaybe(name('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict)
  if (!cidFont || cidFont.get(name('Subtype')) !== name('CIDFontType2')) return null
  const descriptor = cidFont.lookupMaybe(name('FontDescriptor'), PDFDict)
  const program = streamBytes(descriptor && doc.context.lookup(descriptor.get(name('FontFile2'))))
  const toUnicode = streamBytes(doc.context.lookup(font.get(name('ToUnicode'))))
  if (!program || !toUnicode) return null

  // CIDToGIDMap: absent or /Identity means CID = glyph id; a stream lists 2-byte glyph ids per CID.
  const gidMap = streamBytes(doc.context.lookup(cidFont.get(name('CIDToGIDMap'))))
  const gidOf = (cid: number) => (gidMap ? ((gidMap[2 * cid] ?? 0) << 8) | (gidMap[2 * cid + 1] ?? 0) : cid)
  const hasOutline = outlineCheck(program)

  const map = new Map<number, number>()
  for (const [cp, cid] of parseToUnicode(new TextDecoder('latin1').decode(toUnicode)))
    if (hasOutline(gidOf(cid)) || /\s/u.test(String.fromCodePoint(cp))) map.set(cp, cid)
  for (const [a, b] of ALIASES) {
    if (!map.has(a) && map.has(b)) map.set(a, map.get(b)!)
    if (!map.has(b) && map.has(a)) map.set(b, map.get(a)!)
  }

  const codePoints = (text: string) => [...text.normalize('NFC')].filter((c) => c !== '\n').map((c) => c.codePointAt(0)!)
  return {
    ref,
    cidFor: (cp) => map.get(cp),
    covers: (text) => codePoints(text).every((cp) => map.has(cp)),
    hex: (text) =>
      codePoints(text)
        .map((cp) => (map.get(cp) ?? 0).toString(16).toUpperCase().padStart(4, '0'))
        .join(''),
  }
}

/**
 * The embedded font named `baseFont` (pdf.js's font name, subset tag included) that page
 * `pageIndex` draws with, if new text can reuse it; null otherwise.
 */
export function findEmbeddedFont(doc: PDFDocument, pageIndex: number, baseFont: string): EmbeddedFont | null {
  const page = doc.getPages()[pageIndex]
  if (!page || !baseFont) return null
  for (const [ref, dict] of fontsIn(doc, page.node.Resources(), new Set())) {
    const base = dict.get(name('BaseFont'))
    if (base instanceof PDFName && base.decodeText() === baseFont) return reusable(doc, ref, dict)
  }
  return null
}
