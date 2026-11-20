import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { download, REVOKE_DELAY_MS } from './download'

describe('download', () => {
  let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.useFakeTimers()
    anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('clicks a download link pointing at a blob URL of the bytes', () => {
    download(new Uint8Array([1, 2, 3]), 'report-edited.pdf')
    expect(anchor.download).toBe('report-edited.pdf')
    expect(anchor.href.startsWith('blob:')).toBe(true)
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
  })

  it('keeps the blob URL alive after the click, because Safari and iOS start the download later', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    download(new Uint8Array([1]), 'report-edited.pdf')
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledWith(anchor.href)
  })

  it('accepts a Blob as is (the PNG export passes one)', () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL')
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    download(png, 'page-1.png')
    expect(createUrl).toHaveBeenCalledWith(png)
  })
})
