import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfStore } from '../store/usePdfStore'
import { renderPage } from '../lib/pdf'

const THUMB_WIDTH = 190

function Thumbnail({
  doc,
  docVersion,
  pageNumber,
  active,
  onSelect,
  onDelete,
  drag,
}: {
  doc: PDFDocumentProxy
  docVersion: number
  pageNumber: number
  active: boolean
  onSelect: () => void
  onDelete: () => void
  drag: {
    onDragStart: () => void
    onDragEnd: () => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: () => void
    state: 'none' | 'dragging' | 'before' | 'after'
  }
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const page = await doc.getPage(pageNumber)
      const natural = page.getViewport({ scale: 1 })
      const scale = THUMB_WIDTH / natural.width
      if (cancelled) return
      await renderPage(doc, pageNumber, canvas, scale)
      if (!cancelled) setReady(true)
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [doc, docVersion, pageNumber])

  const cls =
    'thumb' +
    (active ? ' active' : '') +
    (drag.state === 'dragging' ? ' dragging' : '') +
    (drag.state === 'before' ? ' drop-before' : '') +
    (drag.state === 'after' ? ' drop-after' : '')

  return (
    <div
      className={cls}
      draggable
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <button
        onClick={onSelect}
        aria-label={`Go to page ${pageNumber}`}
        aria-current={active}
        style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
      >
        <div className="sheet">
          <canvas ref={canvasRef} />
          {!ready && <div className="placeholder" />}
        </div>
      </button>
      <span className="folio mono">{String(pageNumber).padStart(2, '0')}</span>
      <div className="row-tools">
        <button
          className="tool danger"
          title="Delete page"
          onClick={onDelete}
          aria-label={`Delete page ${pageNumber}`}
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { doc, docVersion, numPages, currentPage, setCurrentPage, addBlankPage, removePage, reorderPage } =
    usePdfStore()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<{ index: number; where: 'before' | 'after' } | null>(null)

  if (!doc) return null

  function dropStateFor(page: number): 'none' | 'dragging' | 'before' | 'after' {
    if (dragFrom === page) return 'dragging'
    if (dropAt?.index === page) return dropAt.where
    return 'none'
  }

  function handleDrop() {
    if (dragFrom == null || !dropAt) return
    // Convert (target page, before/after) into a destination 1-based index.
    let to = dropAt.where === 'before' ? dropAt.index : dropAt.index + 1
    if (dragFrom < to) to -= 1 // account for the moved page leaving its slot
    setDragFrom(null)
    setDropAt(null)
    if (to !== dragFrom) void reorderPage(dragFrom, to)
  }

  const pages = Array.from({ length: numPages }, (_, i) => i + 1)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="label">Pages</span>
        <span className="label mono">{numPages}</span>
      </div>
      <div className="thumbs">
        {pages.map((p) => (
          <Thumbnail
            key={p}
            doc={doc}
            docVersion={docVersion}
            pageNumber={p}
            active={p === currentPage}
            onSelect={() => setCurrentPage(p)}
            onDelete={() => removePage(p)}
            drag={{
              state: dropStateFor(p),
              onDragStart: () => setDragFrom(p),
              onDragEnd: () => {
                setDragFrom(null)
                setDropAt(null)
              },
              onDragOver: (e) => {
                e.preventDefault()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const where = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                setDropAt({ index: p, where })
              },
              onDrop: handleDrop,
            }}
          />
        ))}
      </div>
      <button className="add-page" onClick={() => addBlankPage(currentPage)}>
        + Add blank page
      </button>
    </aside>
  )
}
