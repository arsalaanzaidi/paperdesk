// Editor side of reusing the PDF's own fonts. Whether an edit-box can draw in its original
// embedded font is decided by the same `findEmbeddedFont` bake uses, run on the same bytes, so the
// editor and the export agree. The editor then shows the box in pdf.js's face for that font.
import { useSyncExternalStore } from 'react'
import { PDFDocument } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { findEmbeddedFont, type EmbeddedFont } from './embedded'
import { cssFontStack } from './fonts'
import type { TextBox } from './overlay'

let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version++
  for (const l of listeners) l()
}

/** Re-render when a font lookup finishes. */
export function useOwnFontsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
}

const libDocs = new WeakMap<Uint8Array, Promise<PDFDocument | null>>()
const fonts = new WeakMap<Uint8Array, Map<string, EmbeddedFont | null>>()
/** pdf.js face (loadedName, like "g_d0_f3") per page and font name, for this proxy. */
const faces = new WeakMap<PDFDocumentProxy, Map<number, Map<string, string>>>()
const pending = new Set<string>()

async function pageFaces(doc: PDFDocumentProxy, pageIndex: number): Promise<Map<string, string>> {
  const page = await doc.getPage(pageIndex + 1)
  await page.getOperatorList() // binds the page's fonts to document.fonts and fills commonObjs
  const { items } = await page.getTextContent()
  const byName = new Map<string, string>()
  for (const item of items) {
    if (!('fontName' in item) || byName.has(item.fontName)) continue
    try {
      const font = page.commonObjs.get(item.fontName) as { name?: string } | undefined
      if (font?.name && !byName.has(font.name)) byName.set(font.name, item.fontName)
    } catch {
      // not loaded: no face to show
    }
  }
  return byName
}

/** Start looking up whether `box`'s original font can be reused, if it hasn't been already. */
export function requestOwnFont(bytes: Uint8Array, doc: PDFDocumentProxy, box: TextBox): void {
  const baseFont = box.sourceFont
  if (!box.coverColor || !baseFont) return
  const key = `${box.page}:${baseFont}`
  const known = fonts.get(bytes)?.has(key) && faces.get(doc)?.has(box.page)
  if (known || pending.has(`${version}|${key}`)) return
  pending.add(`${version}|${key}`)

  let lib = libDocs.get(bytes)
  if (!lib) {
    lib = PDFDocument.load(bytes, { updateMetadata: false }).catch(() => null)
    libDocs.set(bytes, lib)
  }
  const font = lib.then((d) => (d ? findEmbeddedFont(d, box.page, baseFont) : null))
  const names = faces.get(doc)?.get(box.page) ?? pageFaces(doc, box.page).catch(() => new Map<string, string>())
  void Promise.all([font, names]).then(([f, n]) => {
    if (!fonts.has(bytes)) fonts.set(bytes, new Map())
    fonts.get(bytes)!.set(key, f)
    if (!faces.has(doc)) faces.set(doc, new Map())
    faces.get(doc)!.set(box.page, n)
    changed()
  })
}

/**
 * The CSS stack that shows `box` in its original embedded font: pdf.js's face first, then the
 * box's usual stack. Null when that font can't be reused, lacks a character the box holds (the
 * whole box then uses the look-alike, as bake does), or hasn't been looked up yet.
 */
export function ownFontStack(bytes: Uint8Array | null, doc: PDFDocumentProxy | null, box: TextBox): string | null {
  if (!bytes || !doc || !box.coverColor || !box.sourceFont) return null
  const font = fonts.get(bytes)?.get(`${box.page}:${box.sourceFont}`)
  const face = faces.get(doc)?.get(box.page)?.get(box.sourceFont)
  if (!font || !face || !font.covers(box.text)) return null
  return `"${face}", ${cssFontStack(box)}`
}
