import { useRef, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'

export default function UploadZone() {
  const inputRef = useRef<HTMLInputElement>(null)
  const loadFile = usePdfStore((s) => s.loadFile)
  const [over, setOver] = useState(false)

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) await loadFile(file)
  }

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="well">
        <div className="sheet-icon" aria-hidden />
        <h1>Drop a PDF to start</h1>
        <p>Rearrange pages, edit, and export — all in your browser.</p>
        <button className="btn primary" onClick={() => inputRef.current?.click()}>
          Choose a PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <div className="hint">Nothing is uploaded — your file never leaves this device.</div>
      </div>
    </div>
  )
}
