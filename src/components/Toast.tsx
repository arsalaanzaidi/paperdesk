import { useEffect, useState } from 'react'
import { usePdfStore } from '../store/usePdfStore'

export default function Toast() {
  const error = usePdfStore((s) => s.error)
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (!error) return
    setShown(error)
    const t = setTimeout(() => {
      setShown(null)
      // Clear the store error only if it hasn't changed since.
      if (usePdfStore.getState().error === error) usePdfStore.setState({ error: null })
    }, 4000)
    return () => clearTimeout(t)
  }, [error])

  if (!shown) return null
  return (
    <div className="toast err" role="alert">
      {shown}
    </div>
  )
}
