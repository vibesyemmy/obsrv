import { useEffect } from 'react'
import { useStore } from '../state/store'

const DISMISS_MS = 4000

export function Toast() {
  const toast = useStore(s => s.toast)
  const setToast = useStore(s => s.setToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, setToast])

  if (!toast) return null
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  )
}
