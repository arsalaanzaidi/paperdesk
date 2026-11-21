import { useEffect, useRef, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import {
  boxToScreen,
  pxToPt,
  coverSampleRegion,
  sampleCoverColor,
  contrastText,
  baselineShiftPx,
  ASCENT_RATIO,
  LINE_HEIGHT_RATIO,
  WHITE,
  type TextBox,
} from '../lib/overlay'
import { getPageTextItems } from '../lib/pdf'
import { hitTest, findBoxAt, type PageTextItem } from '../lib/textItems'
import { needsBundledFont, fontChain, cssFontStack, faceLoaded, loadFace, type FaceId } from '../lib/fonts'
import { loadFontkit } from '../lib/fontkit'

interface Props {
  wPx: number
  hPx: number
  /** The page canvas, read only to sample the background colour for an edit-box's cover. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

const DEFAULT_SIZE_PT = 16

const cssFamily = (f: TextBox['family']) =>
  f === 'serif' ? 'serif' : f === 'mono' ? 'monospace' : 'sans-serif'

const baselineCache = new Map<string, number>()

/**
 * Where the browser puts the first baseline for this font at this size, in em below the top of a
 * line box with line-height LINE_HEIGHT_RATIO (as .text-box-edit uses). It depends on the font's
 * ascent and descent, and Chrome snaps it to whole pixels, so the ratio changes with size: it is
 * measured at the real pixel size and cached per font and size. Generic system families are ready
 * synchronously; a web font would need re-measuring once it has loaded.
 */
function cssBaselineRatio(family: string, weight: number, style: string, fontPx: number): number {
  const key = `${family}|${weight}|${style}|${fontPx.toFixed(2)}`
  const cached = baselineCache.get(key)
  if (cached !== undefined) return cached
  const host = document.createElement('div')
  host.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;' +
    `font:${style} ${weight} ${fontPx}px/${LINE_HEIGHT_RATIO} ${family}`
  host.textContent = 'Hg'
  const mark = document.createElement('span')
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  host.appendChild(mark)
  document.body.appendChild(host)
  const ratio = (mark.getBoundingClientRect().top - host.getBoundingClientRect().top) / fontPx
  host.remove()
  const result = Number.isFinite(ratio) && ratio > 0 ? ratio : ASCENT_RATIO
  baselineCache.set(key, result)
  return result
}

/**
 * The CSS stack of the bundled faces bake will draw this box with, once every one of them has
 * loaded; null while the box is plain WinAnsi (standard 14 at export) or its faces are loading.
 */
function bundledStack(box: TextBox): string | null {
  if (!needsBundledFont(box.text)) return null
  return fontChain(box.family, box.bold, box.italic).every(faceLoaded) ? cssFontStack(box.family) : null
}

/** Dominant background colour around a run, read from the rendered page canvas. */
function sampleCover(canvas: HTMLCanvasElement | null, item: PageTextItem, zoom: number): string {
  if (!canvas || !canvas.clientWidth) return WHITE
  const region = coverSampleRegion(item, zoom, canvas.width / canvas.clientWidth, canvas.width, canvas.height)
  const ctx = region ? canvas.getContext('2d') : null
  return region && ctx ? sampleCoverColor(ctx, region) : WHITE
}

export default function TextLayer({ wPx, hPx, canvasRef }: Props) {
  const {
    doc,
    docVersion,
    overlays,
    currentPage,
    zoom,
    tool,
    selectedBoxId,
    addTextBox,
    updateTextBox,
    selectBox,
  } = usePdfStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const editRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  /** Id of the prefilled box the edit tool just spawned, so the focus effect also focuses it although non-empty. */
  const focusNext = useRef<string | null>(null)
  const pageIndex = currentPage - 1
  const boxes = overlays.filter((b) => b.page === pageIndex)

  // Text runs for the current page, fetched only while the edit tool is active.
  // Keyed rather than cleared, so the effect never calls setState synchronously.
  const itemsKey = doc && tool === 'edit' ? `${docVersion}:${pageIndex}` : null
  const [itemsCache, setItemsCache] = useState<{ key: string; items: PageTextItem[] } | null>(null)
  const itemsReady = itemsKey !== null && itemsCache?.key === itemsKey
  const items = itemsReady && itemsCache ? itemsCache.items : []

  useEffect(() => {
    if (!doc || !itemsKey) return
    let cancelled = false
    getPageTextItems(doc, pageIndex + 1)
      .then((found) => {
        if (!cancelled) setItemsCache({ key: itemsKey, items: found })
      })
      .catch(() => {
        if (!cancelled) setItemsCache({ key: itemsKey, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [doc, itemsKey, pageIndex])

  // Boxes with text the standard 14 can't draw show the bundled faces bake will embed. Load them
  // (and warm fontkit for the export) and re-render once they're in document.fonts.
  const [, setFacesReady] = useState(0)
  const missingFaces = [
    ...new Set(
      boxes.filter((b) => needsBundledFont(b.text)).flatMap((b) => fontChain(b.family, b.bold, b.italic)),
    ),
  ]
    .filter((id) => !faceLoaded(id))
    .sort()
    .join(',')
  useEffect(() => {
    if (!missingFaces) return
    let cancelled = false
    loadFontkit().catch(() => {}) // export reports it if this fails
    Promise.all(missingFaces.split(',').map((id) => loadFace(id as FaceId))).then(
      () => {
        if (!cancelled) setFacesReady((n) => n + 1)
      },
      () => {}, // the editor keeps the generic family; export asks for a reload
    )
    return () => {
      cancelled = true
    }
  }, [missingFaces])

  useEffect(() => {
    if (!selectedBoxId) return
    const box = boxes.find((b) => b.id === selectedBoxId)
    if (!box || (box.text !== '' && focusNext.current !== box.id)) return
    // Defer past this event loop turn: the pointerdown that creates a box is
    // immediately followed, in the SAME native gesture, by a `mousedown`
    // hit-tested against the pre-click DOM (the empty layer, an ancestor of
    // the box we're about to focus). Focusing synchronously here — even from
    // an effect — still runs before that `mousedown` is dispatched, so it
    // would blur straight back off and, since the box is still empty,
    // trigger the blur handler to delete it. Deferring one tick lets the
    // whole click gesture (mousedown/pointerup/mouseup/click) finish first.
    const t = setTimeout(() => {
      if (focusNext.current === selectedBoxId) focusNext.current = null
      const el = editRefs.current.get(selectedBoxId)
      if (!el || document.activeElement === el) return
      el.focus()
      // Caret at the end, so typing into a prefilled edit-box appends rather than
      // landing at offset 0.
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }, 0)
    return () => clearTimeout(t)
  }, [selectedBoxId, boxes])

  function pointerPt(e: React.PointerEvent) {
    const rect = layerRef.current!.getBoundingClientRect()
    return { xPt: pxToPt(e.clientX - rect.left, zoom), yPt: pxToPt(e.clientY - rect.top, zoom) }
  }

  function addAtPointer(e: React.PointerEvent) {
    const { xPt, yPt } = pointerPt(e)
    addTextBox({
      page: pageIndex,
      xPt,
      yPt,
      wPt: 160,
      hPt: DEFAULT_SIZE_PT * 1.6,
      text: '',
      family: 'sans',
      sizePt: DEFAULT_SIZE_PT,
      color: '#111111',
      bold: false,
      italic: false,
    })
  }

  function editAtPointer(e: React.PointerEvent) {
    const { xPt, yPt } = pointerPt(e)
    const hit = hitTest(items, xPt, yPt)
    if (!hit) {
      selectBox(null) // nothing under the click: spawn nothing
      return
    }
    const existing = findBoxAt(boxes, hit)
    if (existing) {
      selectBox(existing.id) // repeat click on an already-edited run: no duplicate
      return
    }
    const coverColor = sampleCover(canvasRef.current, hit, zoom)
    addTextBox({
      page: pageIndex,
      xPt: hit.xPt,
      yPt: hit.yPt,
      wPt: hit.wPt,
      hPt: hit.hPt,
      text: hit.str,
      family: hit.family,
      sizePt: hit.sizePt,
      color: hit.color ?? contrastText(coverColor), // original run colour when the op list told us
      bold: hit.bold,
      italic: hit.italic,
      coverColor,
    })
    focusNext.current = usePdfStore.getState().selectedBoxId // addTextBox selects the new id synchronously
  }

  function onLayerPointerDown(e: React.PointerEvent) {
    if (e.target !== layerRef.current) return // a box (child) was clicked
    if (tool === 'text') addAtPointer(e)
    else if (tool === 'edit') editAtPointer(e)
    else selectBox(null)
  }

  function drag(box: TextBox, e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const o = { xPt: box.xPt, yPt: box.yPt, wPt: box.wPt, hPt: box.hPt }
    const move = (ev: PointerEvent) => {
      const dx = pxToPt(ev.clientX - sx, zoom)
      const dy = pxToPt(ev.clientY - sy, zoom)
      if (mode === 'move') updateTextBox(box.id, { xPt: o.xPt + dx, yPt: o.yPt + dy })
      else updateTextBox(box.id, { wPt: Math.max(24, o.wPt + dx), hPt: Math.max(16, o.hPt + dy) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const modeClass = tool === 'text' ? ' adding' : tool === 'edit' ? ' editing' : ''

  return (
    <div
      ref={layerRef}
      className={`text-layer${modeClass}`}
      data-testid="text-layer"
      data-text-items={itemsReady ? items.length : undefined}
      style={{ width: wPx, height: hPx }}
      onPointerDown={onLayerPointerDown}
    >
      {boxes.map((box) => {
        const r = boxToScreen(box, zoom)
        const selected = selectedBoxId === box.id
        const stack = bundledStack(box)
        const family = stack ?? cssFamily(box.family)
        return (
          <div
            key={box.id}
            className={`text-box${selected ? ' selected' : ''}`}
            // Edit-boxes hide the original glyphs in the editor too, matching export. The cover is
            // painted on this box, not the inner editor, so it spans the whole run box.
            style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: box.coverColor }}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectBox(box.id)
            }}
          >
            {selected && (
              <span className="drag-handle" onPointerDown={(e) => drag(box, e, 'move')} />
            )}
            <div
              className={`text-box-edit${box.coverColor ? ' cover' : ''}`}
              contentEditable
              suppressContentEditableWarning
              style={{
                fontFamily: family,
                // The bundled faces are registered per weight and style; never fake bold or italic.
                fontSynthesis: stack ? 'none' : undefined,
                fontSize: box.sizePt * zoom,
                color: box.color,
                fontWeight: box.bold ? 700 : 400,
                fontStyle: box.italic ? 'italic' : 'normal',
                // Put the baseline where bake draws it, whatever this font's CSS metrics are.
                transform: `translateY(${baselineShiftPx(
                  cssBaselineRatio(
                    family,
                    box.bold ? 700 : 400,
                    box.italic ? 'italic' : 'normal',
                    box.sizePt * zoom,
                  ),
                  box.sizePt * zoom,
                )}px)`,
              }}
              // Sync external text in only when not focused, to avoid caret jumps.
              ref={(el) => {
                if (el) editRefs.current.set(box.id, el)
                else editRefs.current.delete(box.id)
                if (!el || document.activeElement === el) return
                if (el.innerText !== box.text) el.innerText = box.text
              }}
              onInput={(e) => updateTextBox(box.id, { text: (e.target as HTMLElement).innerText })}
              onBlur={(e) => {
                if (!(e.target as HTMLElement).innerText.trim())
                  usePdfStore.getState().removeTextBox(box.id)
              }}
            />
            {selected && (
              <span className="resize-handle" onPointerDown={(e) => drag(box, e, 'resize')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
