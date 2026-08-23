import type { FrameSlice, PanelParams } from '../../../shared/types'
import { FRAG_SRC, VERT_SRC } from './shaders'

export interface DrawOptions {
  /** Host pixels per target pixel. */
  scale: number
  params: PanelParams
  /**
   * Fit mode's minification filter: sample through LINEAR_MIPMAP_LINEAR with
   * normalized coordinates instead of `texelFetch`, so a ~0.3× overview does
   * not moiré. Off (the default) is bit-identical to the v1 exact path.
   */
  smooth?: boolean
}

/**
 * Absolute ceiling on either backing-store axis, whatever the GPU reports.
 * A 4096-wide viewport at a large magnification could otherwise ask for a
 * canvas Chromium silently refuses (it then paints nothing, with no error).
 */
export const MAX_OUTPUT_SIZE = 16384

/**
 * The magnification actually drawable for a `srcW`×`srcH` source: `scale`
 * unless `round(src × scale)` would exceed `max` on either axis, in which case
 * the scale is reduced uniformly — both axes by the same factor — so the
 * whole frame still fits. Pure, so `TargetCanvas` can size its CSS box and
 * input maths from the same number the renderer draws with.
 */
export function fitScale(srcW: number, srcH: number, scale: number, max: number): number {
  if (!(scale > 0 && Number.isFinite(scale))) return scale
  if (srcW <= 0 || srcH <= 0) return scale
  if (Math.round(srcW * scale) <= max && Math.round(srcH * scale) <= max) return scale
  return Math.min(max / srcW, max / srcH)
}

let probedMaxTexture: number | null = null

/**
 * The largest texture axis this GPU accepts, capped at `MAX_OUTPUT_SIZE`.
 * Probed once on a throwaway context (released straight away) so the image
 * loader can refuse an export before decoding it; `MAX_OUTPUT_SIZE` alone if
 * WebGL2 is unavailable — `TargetCanvas` reports that as fatal anyway.
 */
export function probeMaxTextureSize(): number {
  if (probedMaxTexture !== null) return probedMaxTexture
  const gl = document.createElement('canvas').getContext('webgl2')
  const max = gl
    ? Math.min(MAX_OUTPUT_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number)
    : MAX_OUTPUT_SIZE
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  probedMaxTexture = max
  return max
}

export interface GlRendererOptions {
  /** Keeps the drawing buffer after composite so `readPixels` is reliable. */
  preserveDrawingBuffer?: boolean
}

/** Spec §9: without WebGL2 the app cannot function and shows a fatal dialog. */
export class WebGL2UnavailableError extends Error {
  constructor(detail = 'WebGL2 is not available') {
    super(detail)
    this.name = 'WebGL2UnavailableError'
  }
}

interface Uniforms {
  tex: WebGLUniformLocation | null
  scale: WebGLUniformLocation | null
  canvasH: WebGLUniformLocation | null
  srcSize: WebGLUniformLocation | null
  brightness: WebGLUniformLocation | null
  blackFloor: WebGLUniformLocation | null
  gamut: WebGLUniformLocation | null
  levels: WebGLUniformLocation | null
  dither: WebGLUniformLocation | null
  smooth: WebGLUniformLocation | null
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new WebGL2UnavailableError('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown'
    gl.deleteShader(sh)
    throw new Error(`shader compile failed: ${log}`)
  }
  return sh
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new WebGL2UnavailableError('createProgram failed')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown'
    gl.deleteProgram(program)
    throw new Error(`program link failed: ${log}`)
  }
  return program
}

/**
 * Owns the target texture and the single draw call that turns it into the
 * right-hand pane. Knows nothing about React, IPC or presets.
 */
export class GlRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly tex: WebGLTexture
  private readonly vao: WebGLVertexArrayObject
  private readonly u: Uniforms
  private readonly maxOutput: number
  private width = 0
  private height = 0
  private applied = 0
  private smoothFilter = false
  /** Mip levels stale after an upload; regenerated lazily, only for smooth draws. */
  private mipsDirty = true

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: GlRendererOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    })
    if (!gl) throw new WebGL2UnavailableError()
    this.gl = gl

    this.program = buildProgram(gl)

    const vao = gl.createVertexArray()
    const tex = gl.createTexture()
    if (!vao || !tex) throw new WebGL2UnavailableError('could not allocate GL objects')
    this.vao = vao
    this.tex = tex

    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // Dirty rects are tightly packed at any width.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    this.maxOutput = Math.min(
      MAX_OUTPUT_SIZE,
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    )

    this.u = {
      tex: gl.getUniformLocation(this.program, 'uTex'),
      scale: gl.getUniformLocation(this.program, 'uScale'),
      canvasH: gl.getUniformLocation(this.program, 'uCanvasH'),
      srcSize: gl.getUniformLocation(this.program, 'uSrcSize'),
      brightness: gl.getUniformLocation(this.program, 'uBrightness'),
      blackFloor: gl.getUniformLocation(this.program, 'uBlackFloor'),
      gamut: gl.getUniformLocation(this.program, 'uGamut'),
      levels: gl.getUniformLocation(this.program, 'uLevels'),
      dither: gl.getUniformLocation(this.program, 'uDither'),
      smooth: gl.getUniformLocation(this.program, 'uSmooth'),
    }
  }

  get sourceWidth(): number {
    return this.width
  }

  get sourceHeight(): number {
    return this.height
  }

  /**
   * Backing-store size in host (physical) pixels after the last `draw`. The
   * CSS box must be exactly `outputWidth / devicePixelRatio` wide (and the
   * same for height) or Chromium resamples the canvas and the 1x pixels blur.
   */
  get outputWidth(): number {
    return this.canvas.width
  }

  get outputHeight(): number {
    return this.canvas.height
  }

  /** Largest backing-store axis this context will draw: the GPU's limit or `MAX_OUTPUT_SIZE`. */
  get maxOutputSize(): number {
    return this.maxOutput
  }

  /**
   * The magnification the last `draw` used — the requested scale, or the
   * uniformly reduced one when the backing store had to be clamped.
   */
  get appliedScale(): number {
    return this.applied
  }

  /** (Re)allocates the texture. Contents are undefined until the next upload. */
  resizeSource(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    this.mipsDirty = true
  }

  /**
   * Uploads one dirty rect. `slice.data` is BGRA and goes in untouched — the
   * fragment shader reads the texel as `.bgr`.
   *
   * Returns `false` and uploads nothing when the rect does not fit the current
   * texture. That happens for a few hundred milliseconds after a viewport
   * change, while frames painted against the old size are still in flight;
   * they are stale by definition, so dropping them is the right answer.
   */
  uploadSlice(slice: FrameSlice): boolean {
    if (
      slice.x < 0 ||
      slice.y < 0 ||
      slice.width <= 0 ||
      slice.height <= 0 ||
      slice.x + slice.width > this.width ||
      slice.y + slice.height > this.height ||
      slice.data.byteLength < slice.width * slice.height * 4
    ) {
      return false
    }
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      slice.x,
      slice.y,
      slice.width,
      slice.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      slice.data,
    )
    this.mipsDirty = true
    return true
  }

  /**
   * One fullscreen draw. Returns `false` and touches nothing when `scale` is
   * not a positive finite number (a zero-sized pane mid-layout, say). A scale
   * the backing store cannot hold is reduced with `fitScale`, never refused.
   */
  draw({ scale: requested, params, smooth = false }: DrawOptions): boolean {
    if (!(requested > 0 && Number.isFinite(requested))) return false
    const gl = this.gl
    const scale = fitScale(this.width, this.height, requested, this.maxOutput)
    this.applied = scale
    const w = Math.max(1, Math.round(this.width * scale))
    const h = Math.max(1, Math.round(this.height * scale))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h

    gl.viewport(0, 0, w, h)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)

    // The min filter follows the draw's path; mips are (re)generated only
    // while smooth mode is asking for them, never on the exact path.
    if (smooth !== this.smoothFilter) {
      this.smoothFilter = smooth
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        smooth ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST,
      )
    }
    if (smooth && this.mipsDirty) {
      gl.generateMipmap(gl.TEXTURE_2D)
      this.mipsDirty = false
    }

    gl.uniform1i(this.u.tex, 0)
    gl.uniform1f(this.u.scale, scale)
    gl.uniform1f(this.u.canvasH, h)
    gl.uniform2i(this.u.srcSize, this.width, this.height)
    gl.uniform1f(this.u.brightness, params.brightness)
    gl.uniform1f(this.u.blackFloor, params.blackFloor)
    gl.uniform1f(this.u.gamut, params.gamut)
    gl.uniform1f(this.u.levels, params.levels)
    gl.uniform1f(this.u.dither, params.dither ? 1 : 0)
    gl.uniform1f(this.u.smooth, smooth ? 1 : 0)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return true
  }

  /** RGBA rows top-down, matching the frame and image conventions. */
  readPixels(): Uint8Array {
    const gl = this.gl
    const w = this.canvas.width
    const h = this.canvas.height
    const raw = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)

    const out = new Uint8Array(raw.length)
    const stride = w * 4
    for (let y = 0; y < h; y++) {
      out.set(raw.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride)
    }
    return out
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteTexture(this.tex)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}
