import { useRef } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import { renderPageToBlob, download } from '../lib/pdf'

function formatSize(bytes: number): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function Header() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { doc, fileName, fileSize, currentPage, loadFile, exportPdf, busy, tool, setTool } =
    usePdfStore()

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

  return (
    <header className="header">
      <div className="brand">
        <span className="mark">◆</span>
        <span>paperdesk</span>
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
      <button className="btn ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
        {doc ? 'Open another' : 'Open PDF'}
      </button>

      {doc && (
        <>
          <button
            className={`btn${tool === 'text' ? ' active' : ''}`}
            data-testid="tool-text"
            onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
            disabled={busy}
          >
            ＋ Add text
          </button>
          <button className="btn" onClick={exportPng} disabled={busy}>
            Save page PNG
          </button>
          <button className="btn primary" onClick={exportPdf} disabled={busy}>
            ↓ Export PDF
          </button>
        </>
      )}
    </header>
  )
}
