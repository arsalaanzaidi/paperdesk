import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  openForRender,
  insertBlankPage,
  deletePage,
  movePage,
  download,
} from '../lib/pdf'

interface PdfState {
  bytes: Uint8Array | null
  doc: PDFDocumentProxy | null
  /** Bumped whenever `doc` is replaced, so views know to re-render. */
  docVersion: number
  numPages: number
  currentPage: number
  zoom: number
  fileName: string | null
  fileSize: number
  status: string
  busy: boolean
  error: string | null

  loadFile: (file: File) => Promise<void>
  setCurrentPage: (n: number) => void
  setZoom: (z: number) => void
  addBlankPage: (afterOneBased: number) => Promise<void>
  removePage: (oneBased: number) => Promise<void>
  reorderPage: (fromOneBased: number, toOneBased: number) => Promise<void>
  exportPdf: () => void
  reset: () => void
}

const MAX_BYTES = 50 * 1024 * 1024 // 50MB soft limit per the design doc

export const usePdfStore = create<PdfState>((set, get) => {
  /** Replace the render doc from new bytes, destroying the previous one. */
  async function applyBytes(bytes: Uint8Array, keepPage?: number) {
    const prev = get().doc
    const doc = await openForRender(bytes)
    // Destroy the old doc *after* the new one loads so a failure leaves us intact.
    if (prev) void prev.destroy()
    const numPages = doc.numPages
    const currentPage = Math.min(Math.max(1, keepPage ?? get().currentPage), numPages)
    set((s) => ({
      bytes,
      doc,
      docVersion: s.docVersion + 1,
      numPages,
      currentPage,
    }))
  }

  return {
    bytes: null,
    doc: null,
    docVersion: 0,
    numPages: 0,
    currentPage: 1,
    zoom: 1,
    fileName: null,
    fileSize: 0,
    status: 'Ready',
    busy: false,
    error: null,

    async loadFile(file) {
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      if (!isPdf) {
        set({ error: 'Please select a valid PDF file.' })
        return
      }
      set({ busy: true, status: 'Loading…', error: null })
      try {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        set({ fileName: file.name, fileSize: file.size })
        await applyBytes(bytes, 1)
        const warn =
          file.size > MAX_BYTES
            ? ' (large file — performance may be degraded)'
            : ''
        set({ status: `Loaded ${file.name}${warn}` })
      } catch (e) {
        set({ error: `Failed to open PDF: ${(e as Error).message}` })
      } finally {
        set({ busy: false })
      }
    },

    setCurrentPage(n) {
      const { numPages } = get()
      set({ currentPage: Math.min(Math.max(1, n), numPages || 1) })
    },

    setZoom(z) {
      set({ zoom: Math.min(Math.max(0.5, z), 2) })
    },

    async addBlankPage(afterOneBased) {
      const { bytes } = get()
      if (!bytes) return
      set({ busy: true, status: 'Adding page…', error: null })
      try {
        const next = await insertBlankPage(bytes, afterOneBased) // insert after = at index
        await applyBytes(next, afterOneBased + 1)
        set({ status: 'Blank page added' })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    async removePage(oneBased) {
      const { bytes, numPages } = get()
      if (!bytes) return
      if (numPages <= 1) {
        set({ error: 'Cannot delete the last remaining page.' })
        return
      }
      set({ busy: true, status: 'Deleting page…', error: null })
      try {
        const next = await deletePage(bytes, oneBased - 1)
        await applyBytes(next, Math.min(oneBased, numPages - 1))
        set({ status: 'Page deleted' })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    async reorderPage(fromOneBased, toOneBased) {
      const { bytes } = get()
      if (!bytes || fromOneBased === toOneBased) return
      set({ busy: true, status: 'Reordering…', error: null })
      try {
        const next = await movePage(bytes, fromOneBased - 1, toOneBased - 1)
        await applyBytes(next, toOneBased)
        set({ status: 'Pages reordered' })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    exportPdf() {
      const { bytes, fileName } = get()
      if (!bytes) return
      const base = (fileName ?? 'document').replace(/\.pdf$/i, '')
      download(bytes, `${base}-edited.pdf`)
      set({ status: 'Exported PDF' })
    },

    reset() {
      const { doc } = get()
      if (doc) void doc.destroy()
      set({
        bytes: null,
        doc: null,
        numPages: 0,
        currentPage: 1,
        zoom: 1,
        fileName: null,
        fileSize: 0,
        status: 'Ready',
        error: null,
      })
    },
  }
})
