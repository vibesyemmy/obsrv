import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio'
import { PaneFooter } from './PaneFooter'

export interface ImagePaneProps {
  src: string
  /** The file's own pixel dimensions. */
  width: number
  height: number
}

/**
 * The left pane in image mode: the file at one image pixel per device pixel.
 *
 * No wheel handling of its own: `.pane-body` scrolls natively, and
 * `TargetCanvas` claims the wheel only in URL mode.
 */
export function ImagePane({ src, width, height }: ImagePaneProps) {
  // Re-read when the window moves between a 1x and a 2x display, like the
  // target canvas: the CSS box divides by it so the browser maps the file 1:1.
  const dpr = useDevicePixelRatio()
  return (
    <div className="pane image-pane">
      <div className="pane-body">
        <img
          src={src}
          alt=""
          style={{ width: `${width / dpr}px`, height: `${height / dpr}px` }}
        />
      </div>
      <PaneFooter role="SOURCE" facts={[`${width}×${height}`, `×${dpr} host`]} />
    </div>
  )
}
