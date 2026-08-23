import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupported } from '../image/loadImage'
import { useStore } from '../state/store'

const SCALES = [1, 2, 3] as const

export interface DropZoneProps {
  onImage: (file: File, exportScale: number) => void
}

/**
 * Accepts image drops and File → Open Image…, then asks what scale the file was
 * exported at.
 *
 * The prompt is a strip in normal document flow rather than a centred modal:
 * the native `WebContentsView` paints above the page, so an overlay covering
 * the left pane would end up behind it. A strip pushes the panes down instead,
 * and `NativeSlot` reports the new bounds.
 */
export function DropZone({ onImage }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const setToast = useStore(s => s.setToast)

  const accept = useCallback(
    (file: File | undefined): void => {
      if (!file) return
      if (!isSupported(file)) {
        setToast('Unsupported file type')
        return
      }
      setPending(file)
    },
    [setToast],
  )

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (): void => setDragging(false)
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      accept(e.dataTransfer?.files?.[0])
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    const offOpen = window.obsrv.onOpenImage(() => inputRef.current?.click())

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      offOpen()
    }
  }, [accept])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={e => {
          accept(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {dragging && !pending && (
        <div className="strip">Drop a PNG or JPG to see it at 1×</div>
      )}

      {pending && (
        <div className="strip scale-prompt">
          <span>
            <b>{pending.name}</b> — what scale was this exported at?
          </span>
          {SCALES.map(s => (
            <button
              key={s}
              type="button"
              className={`scale-${s}x`}
              onClick={() => {
                const file = pending
                setPending(null)
                onImage(file, s)
              }}
            >
              {s}×
            </button>
          ))}
          <button type="button" className="scale-cancel" onClick={() => setPending(null)}>
            Cancel
          </button>
          <span className="muted">
            Geometry and colour are exact; type is approximate — export at 1× for that.
          </span>
        </div>
      )}
    </>
  )
}
