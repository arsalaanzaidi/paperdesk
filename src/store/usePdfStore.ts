import { create } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  openForRender,
  insertBlankPage,
  deletePage,
  movePage,
  download,
} from '../lib/pdf'
import {
  type TextBox,
  nextId,
  remapAfterInsert,
  remapAfterDelete,
  remapAfterReorder,
} from '../lib/overlay'
import { bakeOverlays } from '../lib/bake'

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

  tool: 'select' | 'text'
  overlays: TextBox[]
  selectedBoxId: string | null

  loadFile: (file: File) => Promise<void>
  setCurrentPage: (n: number) => void
  setZoom: (z: number) => void
  setTool: (t: 'select' | 'text') => void
  addTextBox: (box: Omit<TextBox, 'id'>) => void
  updateTextBox: (id: string, patch: Partial<TextBox>) => void
  removeTextBox: (id: string) => void
  selectBox: (id: string | null) => void
  addBlankPage: (afterOneBased: number) => Promise<void>
  removePage: (oneBased: number) => Promise<void>
  reorderPage: (fromOneBased: number, toOneBased: number) => Promise<void>
  exportPdf: () => Promise<void>
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

    tool: 'select',
    overlays: [],
    selectedBoxId: null,

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

    setTool(tool) {
      set({ tool })
    },

    addTextBox(box) {
      const id = nextId()
      set((s) => ({ overlays: [...s.overlays, { ...box, id }], selectedBoxId: id }))
    },

    updateTextBox(id, patch) {
      set((s) => ({
        overlays: s.overlays.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }))
    },

    removeTextBox(id) {
      set((s) => ({
        overlays: s.overlays.filter((b) => b.id !== id),
        selectedBoxId: s.selectedBoxId === id ? null : s.selectedBoxId,
      }))
    },

    selectBox(id) {
      set({ selectedBoxId: id })
    },

    async addBlankPage(afterOneBased) {
      const { bytes } = get()
      if (!bytes) return
      set({ busy: true, status: 'Adding page…', error: null })
      try {
        const next = await insertBlankPage(bytes, afterOneBased) // insert after = at index
        await applyBytes(next, afterOneBased + 1)
        set((s) => ({ overlays: remapAfterInsert(s.overlays, afterOneBased) }))
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
        set((s) => ({ overlays: remapAfterDelete(s.overlays, oneBased - 1) }))
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
        const count = get().numPages
        const next = await movePage(bytes, fromOneBased - 1, toOneBased - 1)
        await applyBytes(next, toOneBased)
        set((s) => ({
          overlays: remapAfterReorder(s.overlays, fromOneBased - 1, toOneBased - 1, count),
        }))
        set({ status: 'Pages reordered' })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    async exportPdf() {
      const { bytes, fileName, overlays } = get()
      if (!bytes) return
      set({ busy: true, status: 'Exporting…', error: null })
      try {
        const out = await bakeOverlays(bytes, overlays)
        const base = (fileName ?? 'document').replace(/\.pdf$/i, '')
        download(out, `${base}-edited.pdf`)
        set({ status: 'Exported PDF' })
      } catch (e) {
        set({ error: `Export failed: ${(e as Error).message}` })
      } finally {
        set({ busy: false })
      }
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
        tool: 'select',
        overlays: [],
        selectedBoxId: null,
      })
    },
  }
})
