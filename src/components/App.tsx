import { useEffect } from 'react'
import { usePdfStore } from '../store/usePdfStore'
import Header from './Header'
import Sidebar from './Sidebar'
import Desk from './Desk'
import UploadZone from './UploadZone'
import StatusBar from './StatusBar'
import Toast from './Toast'

export default function App() {
  const doc = usePdfStore((s) => s.doc)
  const reset = usePdfStore((s) => s.reset)

  // Release the pdf.js worker doc when the app unmounts.
  useEffect(() => () => reset(), [reset])

  return (
    <div className="app">
      <Header />
      {doc ? (
        <div className="body">
          <Sidebar />
          <Desk />
        </div>
      ) : (
        <div className="body">
          <UploadZone />
        </div>
      )}
      <StatusBar />
      <Toast />
    </div>
  )
}
