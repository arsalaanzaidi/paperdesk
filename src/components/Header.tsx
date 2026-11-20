import { useEffect, useRef, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import { renderPageToBlob, download } from '../lib/pdf'

function formatSize(bytes: number): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const EDIT_TEXT_TITLE =
  'Covers and replaces existing text visually — the original text is not removed from the file and can still be extracted by other tools.'

/** The phone layout. Keep in step with `@media (max-width: 720px)` in index.css. */
const NARROW = '(max-width: 720px)'

export default function Header() {
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const { doc, fileName, fileSize, currentPage, loadFile, exportPdf, busy, tool, setTool } =
    usePdfStore()

  // Escape closes the phone menu. So does the layout widening past phone size (turning the phone,
  // resizing the window), which hides the menu: left open, it would pop back up later. A tap
  // outside the menu lands on the backdrop, which closes it too.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    const narrow = window.matchMedia(NARROW)
    const onWiden = () => {
      if (!narrow.matches) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    narrow.addEventListener('change', onWiden)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      narrow.removeEventListener('change', onWiden)
    }
  }, [menuOpen])

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await loadFile(file)
    e.target.value = '' // allow re-picking the same file
  }

  async function exportPng() {
    if (!doc) return
    const blob = await renderPageToBlob(doc, currentPage, 2) // 2x for print-ish clarity
    const base = (fileName ?? 'page').replace(/\.pdf$/i, '')
    download(blob, `${base}-p${currentPage}.png`)
    usePdfStore.setState({ status: `Exported page ${currentPage} as PNG` })
  }

  const openPicker = () => inputRef.current?.click()
  const toggleTool = (t: typeof tool) => setTool(tool === t ? 'select' : t)
  /**
   * Close the menu and run its action. Focus goes back to ☰ first, before the chosen item
   * unmounts. It all happens in the same tap, so iOS still lets the action open the file picker.
   */
  const choose = (action: () => void) => {
    menuButtonRef.current?.focus()
    setMenuOpen(false)
    action()
  }
  /** Keyboard focus leaving the menu (Tab past the last item) closes it. */
  const onMenuBlur = (e: React.FocusEvent) => {
    // No relatedTarget means focus went nowhere, as when a tap lands on the backdrop. The
    // backdrop's click closes the menu then. Closing here as well would remove the backdrop
    // mid-tap and let the rest of the tap through to whatever is underneath.
    const next = e.relatedTarget
    if (next instanceof Node && !menuRef.current?.contains(next)) setMenuOpen(false)
  }

  return (
    <header className="header">
      <div className="brand">
        <span className="mark">◆</span>
        {/* Phones drop the name only once a PDF is open and the header fills up. */}
        <span className={doc ? 'wide-only' : undefined}>paperdesk</span>
      </div>

      {fileName && (
        <div className="filechip" title={fileName}>
          <span className="name">{fileName}</span>
          {fileSize > 0 && <span className="mono">· {formatSize(fileSize)}</span>}
        </div>
      )}

      <div className="spacer" />

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={onPickFile}
      />
      {/* Phones (.wide-only hidden) show only Export PDF and the ☰ menu once a PDF is open. */}
      <button className={`btn ghost${doc ? ' wide-only' : ''}`} onClick={openPicker} disabled={busy}>
        {doc ? 'Open another' : 'Open PDF'}
      </button>

      {doc && (
        <>
          <button
            className={`btn wide-only${tool === 'text' ? ' active' : ''}`}
            data-testid="tool-text"
            onClick={() => toggleTool('text')}
            disabled={busy}
          >
            ＋ Add text
          </button>
          <button
            className={`btn wide-only${tool === 'edit' ? ' active' : ''}`}
            data-testid="tool-edit"
            onClick={() => toggleTool('edit')}
            disabled={busy}
            title={EDIT_TEXT_TITLE}
          >
            ✎ Edit text
          </button>
          <button className="btn wide-only" onClick={exportPng} disabled={busy}>
            Save page PNG
          </button>
          <button className="btn primary" onClick={exportPdf} disabled={busy}>
            {/* One flex item, so " PDF" gets a normal word space rather than the .btn gap. */}
            <span>↓ Export<span className="wide-only"> PDF</span></span>
          </button>

          {/* A disclosure, not an ARIA menu: plain buttons, aria-expanded on ☰, aria-pressed on the tools. */}
          <div className="menu narrow-only" ref={menuRef} onBlur={onMenuBlur}>
            <button
              ref={menuButtonRef}
              className={`btn menu-button${tool !== 'select' ? ' active' : ''}`}
              aria-label="More actions"
              aria-expanded={menuOpen}
              aria-controls="header-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              ☰
            </button>
            {/* The tap that closes the menu lands here, so it can't also act on the page. It
                closes on click, not pointerdown: removing the backdrop mid-tap would send the
                rest of the tap to whatever is underneath. */}
            {menuOpen && <div className="menu-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
            {menuOpen && (
              <div className="menu-panel" id="header-menu">
                <button className="menu-item" onClick={() => choose(openPicker)} disabled={busy}>
                  Open another
                </button>
                <button
                  aria-pressed={tool === 'text'}
                  data-testid="menu-tool-text"
                  className="menu-item"
                  onClick={() => choose(() => toggleTool('text'))}
                  disabled={busy}
                >
                  ＋ Add text
                </button>
                <button
                  aria-pressed={tool === 'edit'}
                  data-testid="menu-tool-edit"
                  className="menu-item"
                  onClick={() => choose(() => toggleTool('edit'))}
                  disabled={busy}
                  title={EDIT_TEXT_TITLE}
                >
                  ✎ Edit text
                </button>
                <button className="menu-item" onClick={() => choose(() => void exportPng())} disabled={busy}>
                  Save page PNG
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  )
}
