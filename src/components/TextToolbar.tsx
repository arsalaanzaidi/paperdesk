import { usePdfStore } from '../store/usePdfStore'
import type { Family, TextBox } from '../lib/overlay'
import { FAMILIES, matchFont, type FontKey } from '../lib/fonts'
import { ownFontStack, useOwnFontsVersion } from '../lib/ownFonts'

const GENERIC: Record<Family, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' }
const KEYS = Object.keys(FAMILIES) as FontKey[]

/**
 * How the box's original font is drawn, while the box still uses the font it was matched to:
 * "for Calibri" for a same-width look-alike, "≈ Verdana" for a guess. Nothing when exact.
 */
function matchLabel(box: TextBox): { text: string; title: string } | null {
  if (!box.sourceFont) return null
  const m = matchFont(box.sourceFont)
  if (m.tier === 'exact' || box.fontKey !== m.fontKey || !m.source) return null
  if (m.tier === 'metric' && m.fontKey)
    return {
      text: `for ${m.source}`,
      title: `${m.source} isn't available here, so this box uses ${FAMILIES[m.fontKey].label}, which has the same letter widths.`,
    }
  return {
    text: `≈ ${m.source}`,
    title: `${m.source} isn't available here, so this box uses a similar ${GENERIC[box.family].toLowerCase()} font. Letters may look and space a little differently.`,
  }
}

export default function TextToolbar() {
  const { bytes, doc, overlays, selectedBoxId, updateTextBox, removeTextBox } = usePdfStore()
  useOwnFontsVersion()
  const box = overlays.find((b) => b.id === selectedBoxId)
  if (!box) return null
  const patch = (p: Partial<typeof box>) => updateTextBox(box.id, p)
  // A generic family draws in the standard 14 (or Arimo/Tinos/Cousine); a bundled one always in itself.
  const chooseFont = (value: string) =>
    value in GENERIC
      ? patch({ family: value as Family, fontKey: undefined })
      : patch({ fontKey: value as FontKey, family: FAMILIES[value as FontKey].generic })
  // The PDF's own font beats any look-alike while it has every character the box holds.
  const match = ownFontStack(bytes, doc, box)
    ? { text: 'original font', title: "This box uses the PDF's own font: it has every character you've typed." }
    : matchLabel(box)

  return (
    <div className="text-toolbar" role="toolbar" aria-label="Text style" data-testid="text-toolbar">
      <select value={box.fontKey ?? box.family} onChange={(e) => chooseFont(e.target.value)} aria-label="Font family">
        <optgroup label="Standard">
          {(Object.keys(GENERIC) as Family[]).map((f) => (
            <option key={f} value={f}>
              {GENERIC[f]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Bundled">
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {FAMILIES[k].label}
            </option>
          ))}
        </optgroup>
      </select>
      {match && (
        <span className="font-match" title={match.title} data-testid="font-match">
          {match.text}
        </span>
      )}
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
