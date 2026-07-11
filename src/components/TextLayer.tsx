import { useEffect, useRef } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import { boxToScreen, pxToPt, type TextBox } from '../lib/overlay'

interface Props {
  wPx: number
  hPx: number
}

const DEFAULT_SIZE_PT = 16

const cssFamily = (f: TextBox['family']) =>
  f === 'serif' ? 'serif' : f === 'mono' ? 'monospace' : 'sans-serif'

export default function TextLayer({ wPx, hPx }: Props) {
  const { overlays, currentPage, zoom, tool, selectedBoxId, addTextBox, updateTextBox, selectBox } =
    usePdfStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const editRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const pageIndex = currentPage - 1
  const boxes = overlays.filter((b) => b.page === pageIndex)

  useEffect(() => {
    if (!selectedBoxId) return
    const box = boxes.find((b) => b.id === selectedBoxId)
    if (!box || box.text !== '') return
    // Defer past this event loop turn: the pointerdown that creates a box is
    // immediately followed, in the SAME native gesture, by a `mousedown`
    // hit-tested against the pre-click DOM (the empty layer, an ancestor of
    // the box we're about to focus). Focusing synchronously here — even from
    // an effect — still runs before that `mousedown` is dispatched, so it
    // would blur straight back off and, since the box is still empty,
    // trigger the blur handler to delete it. Deferring one tick lets the
    // whole click gesture (mousedown/pointerup/mouseup/click) finish first.
    const t = setTimeout(() => {
      const el = editRefs.current.get(selectedBoxId)
      if (el && document.activeElement !== el) el.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [selectedBoxId, boxes])

  function onLayerPointerDown(e: React.PointerEvent) {
    if (e.target !== layerRef.current) return // a box (child) was clicked
    if (tool !== 'text') {
      selectBox(null)
      return
    }
    const rect = layerRef.current!.getBoundingClientRect()
    addTextBox({
      page: pageIndex,
      xPt: pxToPt(e.clientX - rect.left, zoom),
      yPt: pxToPt(e.clientY - rect.top, zoom),
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

  return (
    <div
      ref={layerRef}
      className={`text-layer${tool === 'text' ? ' adding' : ''}`}
      data-testid="text-layer"
      style={{ width: wPx, height: hPx }}
      onPointerDown={onLayerPointerDown}
    >
      {boxes.map((box) => {
        const r = boxToScreen(box, zoom)
        const selected = selectedBoxId === box.id
        return (
          <div
            key={box.id}
            className={`text-box${selected ? ' selected' : ''}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            onPointerDown={(e) => {
              e.stopPropagation()
              selectBox(box.id)
            }}
          >
            {selected && (
              <span className="drag-handle" onPointerDown={(e) => drag(box, e, 'move')} />
            )}
            <div
              className="text-box-edit"
              contentEditable
              suppressContentEditableWarning
              style={{
                fontFamily: cssFamily(box.family),
                fontSize: box.sizePt * zoom,
                color: box.color,
                fontWeight: box.bold ? 700 : 400,
                fontStyle: box.italic ? 'italic' : 'normal',
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
