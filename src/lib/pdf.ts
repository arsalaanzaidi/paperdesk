import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'
import { extractTextItems, type PageTextItem } from './textItems'
// Vite resolves this to a hashed URL for the worker bundle.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

// A4 in PDF points (72 dpi), used for blank pages when we can't match a neighbour.
export const A4: [number, number] = [595.28, 841.89]

/**
 * Open a set of PDF bytes for rendering. pdf.js copies what it needs, but it can
 * detach/neuter the incoming ArrayBuffer, so callers should hand over a private
 * copy if they intend to keep the bytes.
 */
export async function openForRender(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: bytes.slice() })
  return task.promise
}

export interface RenderResult {
  width: number
  height: number
}

/** Render a single page onto a canvas at the given scale. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<RenderResult> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context')

  // Account for device pixel ratio so text stays crisp on HiDPI screens.
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  await page.render({ canvasContext: ctx, viewport }).promise
  return { width: viewport.width, height: viewport.height }
}

/** Render a page to a PNG/JPEG blob at the given scale. */
export async function renderPageToBlob(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await renderPage(doc, pageNumber, canvas, scale)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      type,
      quality,
    )
  })
}

/** Clickable text runs on a page (1-based), in top-left pt space. Read-only. */
export async function getPageTextItems(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageTextItem[]> {
  return extractTextItems(await doc.getPage(pageNumber), pdfjsLib.OPS)
}

// --- Mutations (operate on bytes, return new bytes) ---

export async function insertBlankPage(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  // Match the size of the page currently at (or before) the insertion point.
  const ref = doc.getPageCount() > 0 ? doc.getPage(Math.min(index, doc.getPageCount() - 1)) : null
  const size: [number, number] = ref ? [ref.getWidth(), ref.getHeight()] : A4
  doc.insertPage(Math.min(index, doc.getPageCount()), size)
  return doc.save()
}

export async function deletePage(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  if (doc.getPageCount() <= 1) throw new Error('Cannot delete the last remaining page')
  doc.removePage(index)
  return doc.save()
}

/** Move a page from one index to another, preserving page content. */
export async function movePage(
  bytes: Uint8Array,
  fromIndex: number,
  toIndex: number,
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  const count = src.getPageCount()
  if (fromIndex === toIndex) return bytes

  const order = Array.from({ length: count }, (_, i) => i)
  const [moved] = order.splice(fromIndex, 1)
  order.splice(toIndex, 0, moved)

  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, order)
  copied.forEach((p) => out.addPage(p))
  return out.save()
}

export { download } from './download'
