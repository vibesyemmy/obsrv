import type { AgentApplyPatch, AgentUiReport } from './control'
import type { FrameSlice, HostInfo, LoadError, Settings, TargetInputEvent } from './types'

export interface FrameMessage {
  frame: FrameSlice
  frameWidth: number
  frameHeight: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ObsrvApi {
  navigate(url: string): Promise<string>
  reload(): void
  back(): void
  forward(): void
  /**
   * `width`/`height` are CSS pixels; `deviceScaleFactor` (default 1) is the
   * raster density — the target paints `width x height` x the factor.
   */
  setViewport(width: number, height: number, deviceScaleFactor?: number): Promise<{ width: number; height: number }>
  setNativeBounds(rect: Rect): void
  setMode(mode: 'url' | 'image'): void
  sendInput(ev: TargetInputEvent): void
  getHostInfo(): Promise<HostInfo>
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<void>
  onFrame(cb: (m: FrameMessage) => void): () => void
  onUrlChanged(cb: (url: string) => void): () => void
  onLoadError(cb: (e: LoadError) => void): () => void
  onHostChanged(cb: (h: HostInfo) => void): () => void
  onTargetLoading(cb: (loading: boolean) => void): () => void
  /**
   * The target started a main-frame, cross-document navigation — a paint is
   * owed. `onTargetLoading` also fires for subframe loads, which owe nothing;
   * the stall watchdog keys off this, the toolbar spinner off that.
   */
  onTargetNavigating(cb: () => void): () => void
  /** File → Open Image… in the app menu; the renderer opens its own picker. */
  onOpenImage(cb: () => void): () => void
  /** View → Open Location (Cmd+L) in the app menu; the renderer focuses its URL bar. */
  onFocusUrl(cb: () => void): () => void
  /**
   * A design export was dropped on the native pane. Main refused the
   * navigation and hands the path over; the renderer reads it with
   * `readImageFile` and feeds the same decode path as a drop on itself.
   */
  onOpenImagePath(cb: (path: string) => void): () => void
  /** The bytes of a PNG/JPEG at `path`; rejects on any other extension or an oversized file. */
  readImageFile(path: string): Promise<Uint8Array>
  /**
   * Reports the toolbar's state (plus the target pane's window-relative
   * bounds, once measured) to main, which mirrors it so the agent-control
   * server can answer `status` — and crop `captureTarget` — without a
   * renderer round-trip.
   */
  reportUiState(s: AgentUiReport): void
  /**
   * An agent-control command asks for a preset / profile / view-mode change;
   * the renderer applies it through the same store actions the toolbar uses.
   */
  onAgentApply(cb: (patch: AgentApplyPatch) => void): () => void
  /** An authenticated agent-control command arrived; the toolbar shows its AGENT indicator. */
  onAgentActivity(cb: () => void): () => void
}

declare global {
  interface Window {
    obsrv: ObsrvApi
  }
}
