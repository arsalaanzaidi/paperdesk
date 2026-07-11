import { usePdfStore } from '../store/usePdfStore'

export default function StatusBar() {
  const { status, busy, error, doc } = usePdfStore()
  const dotClass = 'dot' + (error ? ' err' : busy ? ' busy' : '')

  return (
    <footer className="statusbar">
      <span className={dotClass} aria-hidden />
      <span>{error ?? status}</span>
      <span className="spacer" />
      {doc && (
        <span className="privacy" title="All processing happens locally in your browser">
          🔒 stays on your device
        </span>
      )}
    </footer>
  )
}
