import { useEffect, useRef, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import { renderPage } from '../lib/pdf'

/** Recognise common trim sizes so the readout reads like a print spec. */
function trimLabel(wPt: number, hPt: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) < 3
  const w = Math.round(wPt)
  const h = Math.round(hPt)
  if ((near(wPt, 595) && near(hPt, 842)) || (near(wPt, 842) && near(hPt, 595))) return 'A4'
  if ((near(wPt, 612) && near(hPt, 792)) || (near(wPt, 792) && near(hPt, 612))) return 'Letter'
  if ((near(wPt, 612) && near(hPt, 1008)) || (near(wPt, 1008) && near(hPt, 612))) return 'Legal'
  return `${w}×${h}pt`
}

export default function Desk() {
  const { doc, docVersion, numPages, currentPage, zoom, setCurrentPage, setZoom } = usePdfStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function draw() {
      const canvas = canvasRef.current
      if (!canvas || !doc) return
      const page = await doc.getPage(currentPage)
      const natural = page.getViewport({ scale: 1 })
      if (cancelled) return
      await renderPage(doc, currentPage, canvas, zoom) // crispness handled via devicePixelRatio
      if (!cancelled) setDims({ w: natural.width, h: natural.height })
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [doc, docVersion, currentPage, zoom])

  if (!doc) return null

  return (
    <div className="desk">
      <div className="page-sheet">
        <canvas ref={canvasRef} />
      </div>

      <div className="page-controls" role="toolbar" aria-label="Page controls">
        <button
          className="btn icon ghost"
          onClick={() => setCurrentPage(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className="readout mono">
          {currentPage} / {numPages}
        </span>
        <button
          className="btn icon ghost"
          onClick={() => setCurrentPage(currentPage + 1)}
          disabled={currentPage >= numPages}
          aria-label="Next page"
        >
          ›
        </button>

        <span className="divider" />

        <button
          className="btn icon ghost"
          onClick={() => setZoom(Math.round((zoom - 0.1) * 10) / 10)}
          disabled={zoom <= 0.5}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="zoom-val mono">{Math.round(zoom * 100)}%</span>
        <button
          className="btn icon ghost"
          onClick={() => setZoom(Math.round((zoom + 0.1) * 10) / 10)}
          disabled={zoom >= 2}
          aria-label="Zoom in"
        >
          +
        </button>

        {dims && (
          <>
            <span className="divider" />
            <span className="readout mono">{trimLabel(dims.w, dims.h)}</span>
          </>
        )}
      </div>
    </div>
  )
}
