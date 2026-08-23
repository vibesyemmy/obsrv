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
  setViewport(width: number, height: number): Promise<{ width: number; height: number }>
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
}

declare global {
  interface Window {
    obsrv: ObsrvApi
  }
}
