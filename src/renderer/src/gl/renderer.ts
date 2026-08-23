import type { FrameSlice, PanelParams } from '../../../shared/types'
import { FRAG_SRC, VERT_SRC } from './shaders'

export interface DrawOptions {
  /** Host pixels per target pixel. */
  scale: number
  params: PanelParams
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
  srcH: WebGLUniformLocation | null
  brightness: WebGLUniformLocation | null
  blackFloor: WebGLUniformLocation | null
  gamut: WebGLUniformLocation | null
  levels: WebGLUniformLocation | null
  dither: WebGLUniformLocation | null
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
  private width = 0
  private height = 0

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

    this.u = {
      tex: gl.getUniformLocation(this.program, 'uTex'),
      scale: gl.getUniformLocation(this.program, 'uScale'),
      srcH: gl.getUniformLocation(this.program, 'uSrcH'),
      brightness: gl.getUniformLocation(this.program, 'uBrightness'),
      blackFloor: gl.getUniformLocation(this.program, 'uBlackFloor'),
      gamut: gl.getUniformLocation(this.program, 'uGamut'),
      levels: gl.getUniformLocation(this.program, 'uLevels'),
      dither: gl.getUniformLocation(this.program, 'uDither'),
    }
  }

  get sourceWidth(): number {
    return this.width
  }

  get sourceHeight(): number {
    return this.height
  }

  /** (Re)allocates the texture. Contents are undefined until the next upload. */
  resizeSource(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
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
    return true
  }

  draw({ scale, params }: DrawOptions): void {
    const gl = this.gl
    const w = Math.max(1, Math.round(this.width * scale))
    const h = Math.max(1, Math.round(this.height * scale))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h

    gl.viewport(0, 0, w, h)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)

    gl.uniform1i(this.u.tex, 0)
    gl.uniform1f(this.u.scale, scale)
    gl.uniform1f(this.u.srcH, this.height)
    gl.uniform1f(this.u.brightness, params.brightness)
    gl.uniform1f(this.u.blackFloor, params.blackFloor)
    gl.uniform1f(this.u.gamut, params.gamut)
    gl.uniform1f(this.u.levels, params.levels)
    gl.uniform1f(this.u.dither, params.dither ? 1 : 0)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
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
