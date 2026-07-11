import { usePdfStore } from '../store/usePdfStore'
import type { Family } from '../lib/overlay'

export default function TextToolbar() {
  const { overlays, selectedBoxId, updateTextBox, removeTextBox } = usePdfStore()
  const box = overlays.find((b) => b.id === selectedBoxId)
  if (!box) return null
  const patch = (p: Partial<typeof box>) => updateTextBox(box.id, p)

  return (
    <div className="text-toolbar" role="toolbar" aria-label="Text style" data-testid="text-toolbar">
      <select
        value={box.family}
        onChange={(e) => patch({ family: e.target.value as Family })}
        aria-label="Font family"
      >
        <option value="sans">Sans</option>
        <option value="serif">Serif</option>
        <option value="mono">Mono</option>
      </select>
      <input
        className="size mono"
        type="number"
        min={6}
        max={144}
        value={box.sizePt}
        onChange={(e) => patch({ sizePt: Number(e.target.value) || box.sizePt })}
        aria-label="Font size"
      />
      <input
        type="color"
        value={box.color}
        onChange={(e) => patch({ color: e.target.value })}
        aria-label="Text color"
      />
      <button
        className={`btn icon ghost${box.bold ? ' active' : ''}`}
        onClick={() => patch({ bold: !box.bold })}
        aria-label="Bold"
      >
        <b>B</b>
      </button>
      <button
        className={`btn icon ghost${box.italic ? ' active' : ''}`}
        onClick={() => patch({ italic: !box.italic })}
        aria-label="Italic"
      >
        <i>I</i>
      </button>
      <span className="divider" />
      <button
        className="btn icon ghost danger"
        onClick={() => removeTextBox(box.id)}
        aria-label="Delete text box"
      >
        ✕
      </button>
    </div>
  )
}
