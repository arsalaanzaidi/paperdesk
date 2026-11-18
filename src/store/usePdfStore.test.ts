import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfStore } from './usePdfStore'
import { _resetIdCounter, type TextBox } from '../lib/overlay'

// The page-mutation actions (addBlankPage/removePage/reorderPage) call real
// pdf.ts functions that need real PDF bytes to parse. Mock the module so the
// remap-wiring tests below are deterministic and hermetic (no real PDF IO).
vi.mock('../lib/pdf', () => ({
  openForRender: vi.fn(),
  insertBlankPage: vi.fn(),
  deletePage: vi.fn(),
  movePage: vi.fn(),
  download: vi.fn(),
}))

// exportPdf's bake path — mocked so the exportPdf test can assert wiring
// without doing real pdf-lib work.
vi.mock('../lib/bake', () => ({
  bakeOverlays: vi.fn(),
}))

import { openForRender, insertBlankPage, deletePage, movePage, download } from '../lib/pdf'
import { bakeOverlays } from '../lib/bake'

const base: Omit<TextBox, 'id'> = {
  page: 0, xPt: 10, yPt: 10, wPt: 100, hPt: 30,
  text: 'hi', family: 'sans', sizePt: 16, color: '#111111', bold: false, italic: false,
}

const mkBox = (id: string, page: number): TextBox => ({ ...base, id, page })

/** Minimal PDFDocumentProxy stand-in: the store only reads `.numPages` and calls `.destroy()`. */
const fakeDoc = (numPages: number): PDFDocumentProxy =>
  ({ numPages, destroy: vi.fn() }) as unknown as PDFDocumentProxy

beforeEach(() => {
  _resetIdCounter()
  vi.clearAllMocks()
  vi.mocked(openForRender).mockResolvedValue(fakeDoc(0))
  vi.mocked(insertBlankPage).mockResolvedValue(new Uint8Array([1]))
  vi.mocked(deletePage).mockResolvedValue(new Uint8Array([2]))
  vi.mocked(movePage).mockResolvedValue(new Uint8Array([3]))
  vi.mocked(download).mockReturnValue(undefined)
  vi.mocked(bakeOverlays).mockResolvedValue(new Uint8Array([4]))
  usePdfStore.setState({
    overlays: [],
    selectedBoxId: null,
    tool: 'select',
    bytes: null,
    doc: null,
    docVersion: 0,
    numPages: 0,
    currentPage: 1,
    fileName: null,
    fileSize: 0,
    status: 'Ready',
    busy: false,
    error: null,
  })
})

describe('overlay actions', () => {
  it('addTextBox assigns an id, appends, and selects it', () => {
    usePdfStore.getState().addTextBox(base)
    const s = usePdfStore.getState()
    expect(s.overlays).toHaveLength(1)
    expect(s.overlays[0].id).toBe('tb_1')
    expect(s.selectedBoxId).toBe('tb_1')
  })

  it('updateTextBox shallow-merges a patch', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().updateTextBox('tb_1', { text: 'bye', bold: true })
    const box = usePdfStore.getState().overlays[0]
    expect(box.text).toBe('bye')
    expect(box.bold).toBe(true)
    expect(box.family).toBe('sans') // untouched
  })

  it('removeTextBox drops the box and clears selection if it was selected', () => {
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().removeTextBox('tb_1')
    expect(usePdfStore.getState().overlays).toHaveLength(0)
    expect(usePdfStore.getState().selectedBoxId).toBeNull()
  })

  it('setTool toggles the active tool', () => {
    usePdfStore.getState().setTool('text')
    expect(usePdfStore.getState().tool).toBe('text')
  })

  it('setCurrentPage clears the current selection', () => {
    usePdfStore.setState({ numPages: 3 })
    usePdfStore.getState().addTextBox(base)
    usePdfStore.getState().setCurrentPage(2)
    expect(usePdfStore.getState().selectedBoxId).toBeNull()
  })
})

// The 0-based/1-based remap wiring between the store's 1-based action API and
// overlay.page (0-based) is the plan's stated main risk. pdf.ts is mocked
// (see top of file) so these drive the real store actions deterministically.
describe('page-mutation remap wiring', () => {
  it('addBlankPage shifts boxes on/after the insertion point by +1', async () => {
    const seedBytes = new Uint8Array([9])
    usePdfStore.setState({
      bytes: seedBytes,
      numPages: 3,
      overlays: [mkBox('a', 0), mkBox('b', 1), mkBox('c', 2)],
    })
    vi.mocked(openForRender).mockResolvedValue(fakeDoc(4))

    await usePdfStore.getState().addBlankPage(2) // insert after 1-based page 2

    expect(insertBlankPage).toHaveBeenCalledWith(seedBytes, 2)
    const pages = Object.fromEntries(usePdfStore.getState().overlays.map((b) => [b.id, b.page]))
    // a,b are before the insertion point and stay put; c was on/after it and shifts +1.
    expect(pages).toEqual({ a: 0, b: 1, c: 3 })
  })

  it('removePage drops boxes on the deleted page and shifts later boxes by -1', async () => {
    const seedBytes = new Uint8Array([9])
    usePdfStore.setState({
      bytes: seedBytes,
      numPages: 3,
      overlays: [mkBox('a', 0), mkBox('b', 1), mkBox('c', 2)],
    })
    vi.mocked(openForRender).mockResolvedValue(fakeDoc(2))

    await usePdfStore.getState().removePage(2) // delete 1-based page 2 (0-based index 1)

    expect(deletePage).toHaveBeenCalledWith(seedBytes, 1)
    const overlays = usePdfStore.getState().overlays
    // b was on the deleted page and is dropped entirely; c shifts down to fill the gap.
    expect(overlays.map((b) => b.id)).toEqual(['a', 'c'])
    const pages = Object.fromEntries(overlays.map((b) => [b.id, b.page]))
    expect(pages).toEqual({ a: 0, c: 1 })
  })

  it('reorderPage remaps boxes by the same permutation applied to the pages', async () => {
    const seedBytes = new Uint8Array([9])
    usePdfStore.setState({
      bytes: seedBytes,
      numPages: 4,
      overlays: [mkBox('a', 0), mkBox('b', 1), mkBox('c', 2), mkBox('d', 3)],
    })
    vi.mocked(openForRender).mockResolvedValue(fakeDoc(4))

    await usePdfStore.getState().reorderPage(1, 3) // move 1-based page 1 to position 3

    expect(movePage).toHaveBeenCalledWith(seedBytes, 0, 2)
    const pages = Object.fromEntries(usePdfStore.getState().overlays.map((b) => [b.id, b.page]))
    // page order becomes [1,2,0,3] (0-based) — a box's new page is its old index's slot in that order.
    expect(pages).toEqual({ a: 2, b: 0, c: 1, d: 3 })
  })
})

describe('exportPdf', () => {
  it('bakes overlays onto the source bytes, downloads the result, and leaves store.bytes untouched', async () => {
    const sourceBytes = new Uint8Array([5, 6, 7])
    const bakedBytes = new Uint8Array([8, 8, 8])
    vi.mocked(bakeOverlays).mockResolvedValue(bakedBytes)
    const overlays = [mkBox('a', 0)]
    usePdfStore.setState({ bytes: sourceBytes, overlays, fileName: 'doc.pdf' })

    await usePdfStore.getState().exportPdf()

    expect(bakeOverlays).toHaveBeenCalledWith(sourceBytes, overlays)
    expect(download).toHaveBeenCalledWith(bakedBytes, 'doc-edited.pdf')
    // exportPdf produces a downloadable copy — it must not overwrite the working doc's bytes.
    expect(usePdfStore.getState().bytes).toBe(sourceBytes)
  })
})

describe('tool', () => {
  it("accepts the 'edit' tool and reset returns to 'select'", () => {
    usePdfStore.getState().setTool('edit')
    expect(usePdfStore.getState().tool).toBe('edit')
    usePdfStore.getState().reset()
    expect(usePdfStore.getState().tool).toBe('select')
  })
})
