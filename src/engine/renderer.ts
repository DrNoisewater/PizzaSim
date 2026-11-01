// Crust renderer: a small WebGL2 forward renderer with hemisphere + sun lighting,
// PCF shadow map, up to 8 point lights, fog, rim light, vertex colors, textures, sprites,
// and an optional post stack (4x MSAA, emissive glow bloom, color grade, vignette).
import { m4, type V3 } from './math';
import { Camera, Mesh, Node, Sprite, Texture, type Environment } from './scene';
import type { Geometry } from './geometry';

const MAX_POINTS = 8;

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec3 aColor;
uniform mat4 uModel, uViewProj, uLightVP;
uniform mat3 uNormalMat;
out vec3 vWorld; out vec3 vNormal; out vec2 vUv; out vec3 vColor; out vec4 vShadow;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUv = aUv; vColor = aColor;
  vShadow = uLightVP * w;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in vec3 vColor; in vec4 vShadow;
uniform vec3 uColor; uniform vec3 uEmissive; uniform float uOpacity; uniform float uHighlight; uniform float uGlow;
uniform int uUseMap; uniform sampler2D uMap; uniform int uUnlit; uniform int uReceive;
uniform vec3 uSky, uGround, uSunDir, uSunColor, uFog, uCamPos;
uniform float uFogNear, uFogFar, uShadowOn, uRim;
uniform sampler2DShadow uShadowMap;
uniform int uNumPoints;
uniform vec3 uPointPos[${MAX_POINTS}]; uniform vec3 uPointColor[${MAX_POINTS}]; uniform float uPointRange[${MAX_POINTS}];
layout(location=0) out vec4 frag;
layout(location=1) out vec4 glow;
float shadowAt(){
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++)
    s += texture(uShadowMap, vec3(p.xy + vec2(x, y) * texel, p.z - 0.0015));
  return s / 9.0;
}
void main(){
  vec3 base = uColor * vColor; float a = uOpacity;
  if (uUseMap == 1) { vec4 t = texture(uMap, vUv); base *= t.rgb; a *= t.a; }
  if (a < 0.02) discard;
  vec3 col;
  if (uUnlit == 1) {
    col = base + uEmissive;
  } else {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(uCamPos - vWorld);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
    float ndl = dot(n, -uSunDir);
    float wrap = max((ndl + 0.18) / 1.18, 0.0);
    float sh = (uShadowOn > 0.5 && uReceive == 1) ? shadowAt() : 1.0;
    vec3 light = amb + uSunColor * wrap * mix(0.32, 1.0, sh);
    for (int i = 0; i < ${MAX_POINTS}; i++) {
      if (i >= uNumPoints) break;
      vec3 L = uPointPos[i] - vWorld;
      float d = length(L);
      float att = clamp(1.0 - d / uPointRange[i], 0.0, 1.0);
      att *= att;
      light += uPointColor[i] * (0.35 + 0.65 * max(dot(n, L / max(d, 0.001)), 0.0)) * att;
    }
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col = base * light + uSky * rim * uRim + uEmissive;
  }
  col += vec3(1.0, 0.85, 0.45) * uHighlight;
  float f = clamp((length(vWorld - uCamPos) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFog, f);
  // gentle filmic shoulder so bright interiors don't clip
  col = col / (1.0 + max(col - 1.0, 0.0));
  frag = vec4(col, a);
  glow = vec4((uEmissive * 0.6 + col * uGlow) * 0.5 * (1.0 - f), a);
}`;

const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uModel, uLightVP;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;
const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 frag;
void main(){ frag = vec4(1.0); }`;

const SPRITE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform vec3 uCenter; uniform vec2 uSize; uniform vec3 uRight, uUp; uniform mat4 uViewProj; uniform float uSpin;
out vec2 vUv;
void main(){
  float c = cos(uSpin), s = sin(uSpin);
  vec2 k = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y);
  vec3 p = uCenter + uRight * k.x * uSize.x + uUp * k.y * uSize.y;
  vUv = vec2(aCorner.x + 0.5, aCorner.y + 0.5);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;
const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uMap; uniform float uOpacity; uniform vec3 uTint; uniform float uGlow;
layout(location=0) out vec4 frag;
layout(location=1) out vec4 glow;
void main(){
  vec4 t = texture(uMap, vUv);
  float a = t.a * uOpacity;
  if (a < 0.01) discard;
  vec3 c = t.rgb * uTint;
  frag = vec4(c, a);
  glow = vec4(c * uGlow * 0.5, a);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
void main(){ gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
layout(location=0) out vec4 frag;
layout(location=1) out vec4 glow;
void main(){ frag = uColor; glow = vec4(0.0, 0.0, 0.0, uColor.a); }`;

// ---- post-processing (fullscreen triangle from gl_VertexID)
const POST_VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const DOWN_FS = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel;
out vec4 frag;
void main(){
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  frag = vec4(c * 0.25, 1.0);
}`;
const BLUR_FS = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uDir;
out vec4 frag;
void main(){
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += texture(uSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  frag = vec4(c, 1.0);
}`;
const COMPOSITE_FS = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uScene, uB1, uB2; uniform float uBloom, uVignette, uSat;
out vec4 frag;
void main(){
  vec3 c = texture(uScene, vUv).rgb;
  vec3 b = texture(uB1, vUv).rgb * 1.1 + texture(uB2, vUv).rgb * 1.6;
  c += b * 2.0 * uBloom;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * 1.04 + 0.5;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * uVignette;
  c = c / (1.0 + max(c - 1.0, 0.0) * 0.7);
  frag = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

interface GpuGeo {
  vao: WebGLVertexArrayObject;
  bufs: WebGLBuffer[];
}

/** Dynamic line batch (rain streaks). */
export class Lines {
  data = new Float32Array(0);
  count = 0;
  color: [number, number, number, number] = [0.7, 0.8, 1, 0.35];
  visible = true;
  gpu: { vao: WebGLVertexArrayObject; buf: WebGLBuffer } | null = null;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** MSAA scene + glow buffers, resolve targets and a two-level bloom chain. */
class PostStack {
  gl: WebGL2RenderingContext;
  w = 0;
  h = 0;
  samples: number;
  ms: WebGLFramebuffer | null = null;
  rbs: WebGLRenderbuffer[] = [];
  scene: Target | null = null;
  glow: Target | null = null;
  halfA: Target | null = null;
  halfB: Target | null = null;
  qA: Target | null = null;
  qB: Target | null = null;
  ok = true;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
  }
  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }
  private free() {
    const gl = this.gl;
    if (this.ms) gl.deleteFramebuffer(this.ms);
    for (const r of this.rbs) gl.deleteRenderbuffer(r);
    this.rbs = [];
    for (const t of [this.scene, this.glow, this.halfA, this.halfB, this.qA, this.qB]) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
  }
  ensure(w: number, h: number) {
    if (w === this.w && h === this.h && this.ms) return this.ok;
    const gl = this.gl;
    this.free();
    this.w = w;
    this.h = h;
    this.ms = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms);
    const rb = (fmt: number, att: number) => {
      const r = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, fmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, att, gl.RENDERBUFFER, r);
      this.rbs.push(r);
    };
    rb(gl.RGBA8, gl.COLOR_ATTACHMENT0);
    rb(gl.RGBA8, gl.COLOR_ATTACHMENT1);
    rb(gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT);
    this.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    this.scene = this.target(w, h);
    this.glow = this.target(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.halfA = this.target(hw, hh);
    this.halfB = this.target(hw, hh);
    this.qA = this.target(qw, qh);
    this.qB = this.target(qw, qh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.ok;
  }
}

export interface PostOptions {
  enabled: boolean;
  bloom: number;
  vignette: number;
  saturation: number;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  width = 1;
  height = 1;
  dpr = 1;
  private main: Prog;
  private depth: Prog;
  private sprite: Prog;
  private line: Prog;
  private down: Prog;
  private blur: Prog;
  private comp: Prog;
  private post: PostStack;
  private emptyVao: WebGLVertexArrayObject;
  private shadowFbo: WebGLFramebuffer | null = null;
  private shadowTex: WebGLTexture | null = null;
  shadowSize = 2048;
  private lightVP = m4.create();
  private quadVao: WebGLVertexArrayObject;
  private nm = new Float32Array(9);
  private whiteTex: WebGLTexture;
  lines: Lines[] = [];
  stats = { draws: 0 };
  postOpts: PostOptions = { enabled: true, bloom: 1, vignette: 0.55, saturation: 1.08 };
  rim = 0.22;

  constructor(canvas: HTMLCanvasElement, opts: { shadowSize?: number } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    if (opts.shadowSize) this.shadowSize = opts.shadowSize;
    this.main = this.program(VS, FS, [
      'uModel', 'uViewProj', 'uLightVP', 'uNormalMat', 'uColor', 'uEmissive', 'uOpacity', 'uHighlight', 'uGlow', 'uUseMap', 'uMap', 'uUnlit', 'uReceive',
      'uSky', 'uGround', 'uSunDir', 'uSunColor', 'uFog', 'uCamPos', 'uFogNear', 'uFogFar', 'uShadowOn', 'uRim', 'uShadowMap', 'uNumPoints',
      'uPointPos', 'uPointColor', 'uPointRange',
    ]);
    this.depth = this.program(DEPTH_VS, DEPTH_FS, ['uModel', 'uLightVP']);
    this.sprite = this.program(SPRITE_VS, SPRITE_FS, ['uCenter', 'uSize', 'uRight', 'uUp', 'uViewProj', 'uSpin', 'uMap', 'uOpacity', 'uTint', 'uGlow']);
    this.line = this.program(LINE_VS, LINE_FS, ['uViewProj', 'uColor']);
    this.down = this.program(POST_VS, DOWN_FS, ['uSrc', 'uTexel']);
    this.blur = this.program(POST_VS, BLUR_FS, ['uSrc', 'uDir']);
    this.comp = this.program(POST_VS, COMPOSITE_FS, ['uScene', 'uB1', 'uB2', 'uBloom', 'uVignette', 'uSat']);
    this.post = new PostStack(gl);
    this.emptyVao = gl.createVertexArray()!;
    // sprite quad
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const qb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.whiteTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.setupShadow();
  }

  private program(vs: string, fs: string, uniforms: string[]): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniforms) {
      u[name] = gl.getUniformLocation(p, name) ?? gl.getUniformLocation(p, name + '[0]');
    }
    return { p, u };
  }

  private setupShadow() {
    const gl = this.gl;
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setShadowSize(size: number) {
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.setupShadow();
  }

  setSize(w: number, h: number, dpr: number) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  private gpuGeo(g: Geometry): GpuGeo {
    if (g.gpu) return g.gpu as GpuGeo;
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const bufs: WebGLBuffer[] = [];
    const attr = (loc: number, data: Float32Array, size: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      bufs.push(b);
    };
    attr(0, g.positions, 3);
    attr(1, g.normals, 3);
    attr(2, g.uvs, 2);
    attr(3, g.colors, 3);
    gl.bindVertexArray(null);
    const gg = { vao, bufs };
    g.gpu = gg;
    return gg;
  }

  /** Free GPU buffers of a geometry that will not be drawn again. */
  disposeGeometry(g: Geometry) {
    const gg = g.gpu as GpuGeo | null;
    if (!gg) return;
    const gl = this.gl;
    gl.deleteVertexArray(gg.vao);
    for (const b of gg.bufs) gl.deleteBuffer(b);
    g.gpu = null;
  }

  private tex(t: Texture): WebGLTexture {
    const gl = this.gl;
    if (!t.gpu) t.gpu = gl.createTexture();
    if (t.needsUpdate) {
      gl.bindTexture(gl.TEXTURE_2D, t.gpu);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const wrap = t.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (t.nearest) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const af = gl.getExtension('EXT_texture_filter_anisotropic');
        if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      }
      t.needsUpdate = false;
    }
    return t.gpu!;
  }

  disposeTexture(t: Texture) {
    if (t.gpu) this.gl.deleteTexture(t.gpu);
    t.gpu = null;
    t.needsUpdate = true;
  }

  render(root: Node, cam: Camera, env: Environment) {
    const gl = this.gl;
    this.stats.draws = 0;
    cam.aspect = this.width / this.height;
    cam.update();
    root.updateWorld(null);

    const opaque: Mesh[] = [];
    const transparent: Mesh[] = [];
    const sprites: Sprite[] = [];
    const collect = (n: Node) => {
      if (!n.visible) return;
      if (n instanceof Mesh) (n.material.transparent ? transparent : opaque).push(n);
      else if (n instanceof Sprite) sprites.push(n);
      for (const c of n.children) collect(c);
    };
    collect(root);

    // --- shadow pass
    const sd = env.sunDir;
    const c = env.shadowCenter;
    const R = env.shadowRadius;
    const lightEye: V3 = [c[0] - sd[0] * 40, c[1] - sd[1] * 40, c[2] - sd[2] * 40];
    const lv = m4.create(), lp = m4.create();
    m4.lookAt(lv, lightEye, c, Math.abs(sd[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    m4.ortho(lp, -R, R, -R, R, 1, 90);
    m4.mul(this.lightVP, lp, lv);
    const shadowsOn = env.shadows && sd[1] < -0.05;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    if (shadowsOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.depth.p);
      gl.uniformMatrix4fv(this.depth.u.uLightVP, false, this.lightVP);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      for (const m of opaque) {
        if (!m.castShadow) continue;
        const g = this.gpuGeo(m.geometry);
        gl.bindVertexArray(g.vao);
        gl.uniformMatrix4fv(this.depth.u.uModel, false, m.world);
        gl.drawArrays(gl.TRIANGLES, 0, m.geometry.count);
        this.stats.draws++;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // --- main pass target
    const cw = this.canvas.width, ch = this.canvas.height;
    const usePost = this.postOpts.enabled && this.post.ensure(cw, ch);
    if (usePost) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.post.ms);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, cw, ch);
      gl.clearBufferfv(gl.COLOR, 0, [env.clear[0], env.clear[1], env.clear[2], 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(env.clear[0], env.clear[1], env.clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.disable(gl.CULL_FACE);
    const P = this.main;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);
    gl.uniformMatrix4fv(P.u.uLightVP, false, this.lightVP);
    gl.uniform3fv(P.u.uSky, env.sky);
    gl.uniform3fv(P.u.uGround, env.ground);
    gl.uniform3fv(P.u.uSunDir, sd);
    gl.uniform3fv(P.u.uSunColor, env.sunColor);
    gl.uniform3fv(P.u.uFog, env.fog);
    gl.uniform3fv(P.u.uCamPos, cam.eye);
    gl.uniform1f(P.u.uFogNear, env.fogNear);
    gl.uniform1f(P.u.uFogFar, env.fogFar);
    gl.uniform1f(P.u.uShadowOn, shadowsOn ? 1 : 0);
    gl.uniform1f(P.u.uRim, this.rim);
    const pts = env.points.slice(0, MAX_POINTS);
    gl.uniform1i(P.u.uNumPoints, pts.length);
    if (pts.length) {
      const pp = new Float32Array(MAX_POINTS * 3), pc = new Float32Array(MAX_POINTS * 3), pr = new Float32Array(MAX_POINTS);
      pts.forEach((p, i) => {
        pp.set(p.pos, i * 3);
        pc.set(p.color, i * 3);
        pr[i] = p.range;
      });
      gl.uniform3fv(P.u.uPointPos, pp);
      gl.uniform3fv(P.u.uPointColor, pc);
      gl.uniform1fv(P.u.uPointRange, pr);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(P.u.uShadowMap, 1);
    gl.uniform1i(P.u.uMap, 0);

    const drawMesh = (m: Mesh) => {
      const mat = m.material;
      const g = this.gpuGeo(m.geometry);
      gl.bindVertexArray(g.vao);
      gl.uniformMatrix4fv(P.u.uModel, false, m.world);
      m4.normalMat(this.nm, m.world);
      gl.uniformMatrix3fv(P.u.uNormalMat, false, this.nm);
      gl.uniform3fv(P.u.uColor, mat.color);
      gl.uniform3f(P.u.uEmissive, mat.emissive[0] * mat.emissiveIntensity, mat.emissive[1] * mat.emissiveIntensity, mat.emissive[2] * mat.emissiveIntensity);
      gl.uniform1f(P.u.uOpacity, mat.opacity);
      gl.uniform1f(P.u.uHighlight, mat.highlight);
      gl.uniform1f(P.u.uGlow, mat.glow);
      gl.uniform1i(P.u.uUnlit, mat.unlit ? 1 : 0);
      gl.uniform1i(P.u.uReceive, m.receiveShadow ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      if (mat.map) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex(mat.map));
        gl.uniform1i(P.u.uUseMap, 1);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.whiteTex);
        gl.uniform1i(P.u.uUseMap, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, m.geometry.count);
      this.stats.draws++;
    };

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const m of opaque) drawMesh(m);

    // transparent, back to front
    if (transparent.length) {
      const e = cam.eye;
      const dist = (m: Mesh) => {
        const w = m.world;
        return (w[12] - e[0]) ** 2 + (w[13] - e[1]) ** 2 + (w[14] - e[2]) ** 2;
      };
      transparent.sort((a, b) => dist(b) - dist(a));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const m of transparent) drawMesh(m);
      gl.depthMask(true);
    }

    // lines (rain)
    if (this.lines.length) {
      const L = this.line;
      gl.useProgram(L.p);
      gl.uniformMatrix4fv(L.u.uViewProj, false, cam.viewProj);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const ln of this.lines) {
        if (!ln.visible || !ln.count) continue;
        if (!ln.gpu) {
          const vao = gl.createVertexArray()!;
          gl.bindVertexArray(vao);
          const buf = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
          ln.gpu = { vao, buf };
        }
        gl.bindVertexArray(ln.gpu.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, ln.gpu.buf);
        gl.bufferData(gl.ARRAY_BUFFER, ln.data.subarray(0, ln.count * 3), gl.DYNAMIC_DRAW);
        gl.uniform4fv(L.u.uColor, ln.color);
        gl.drawArrays(gl.LINES, 0, ln.count);
        this.stats.draws++;
      }
      gl.depthMask(true);
    }

    // sprites
    if (sprites.length) {
      const S = this.sprite;
      gl.useProgram(S.p);
      gl.uniformMatrix4fv(S.u.uViewProj, false, cam.viewProj);
      const v = cam.view;
      gl.uniform3f(S.u.uRight, v[0], v[4], v[8]);
      gl.uniform3f(S.u.uUp, v[1], v[5], v[9]);
      gl.uniform1i(S.u.uMap, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(this.quadVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const e = cam.eye;
      sprites.sort((a, b) => {
        const da = (a.world[12] - e[0]) ** 2 + (a.world[13] - e[1]) ** 2 + (a.world[14] - e[2]) ** 2;
        const db = (b.world[12] - e[0]) ** 2 + (b.world[13] - e[1]) ** 2 + (b.world[14] - e[2]) ** 2;
        return db - da;
      });
      let lastTex: Texture | null = null;
      for (const s of sprites) {
        if (s.opacity <= 0.01) continue;
        if (s.texture !== lastTex) {
          gl.bindTexture(gl.TEXTURE_2D, this.tex(s.texture));
          lastTex = s.texture;
        }
        gl.uniform3f(S.u.uCenter, s.world[12], s.world[13], s.world[14]);
        gl.uniform2f(S.u.uSize, s.width * s.scale[0], s.height * s.scale[1]);
        gl.uniform1f(S.u.uOpacity, s.opacity);
        gl.uniform3fv(S.u.uTint, s.tint);
        gl.uniform1f(S.u.uGlow, s.glow);
        gl.uniform1f(S.u.uSpin, s.spin);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.stats.draws++;
      }
      gl.depthMask(true);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    if (usePost) this.postProcess(cw, ch);
  }

  private postProcess(cw: number, ch: number) {
    const gl = this.gl;
    const ps = this.post;
    // resolve MSAA color and glow
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ps.ms);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ps.scene!.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ps.glow!.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    const pass = (prog: Prog, src: WebGLTexture, dst: Target | null, setup: () => void) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
      gl.viewport(0, 0, dst ? dst.w : cw, dst ? dst.h : ch);
      gl.useProgram(prog.p);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(prog.u.uSrc ?? prog.u.uScene, 0);
      setup();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    if (this.postOpts.bloom > 0) {
      const g = ps.glow!, hA = ps.halfA!, hB = ps.halfB!, qA = ps.qA!, qB = ps.qB!;
      pass(this.down, g.tex, hA, () => gl.uniform2f(this.down.u.uTexel, 1 / g.w, 1 / g.h));
      pass(this.blur, hA.tex, hB, () => gl.uniform2f(this.blur.u.uDir, 1 / hA.w, 0));
      pass(this.blur, hB.tex, hA, () => gl.uniform2f(this.blur.u.uDir, 0, 1 / hA.h));
      pass(this.down, hA.tex, qA, () => gl.uniform2f(this.down.u.uTexel, 1 / hA.w, 1 / hA.h));
      pass(this.blur, qA.tex, qB, () => gl.uniform2f(this.blur.u.uDir, 1.5 / qA.w, 0));
      pass(this.blur, qB.tex, qA, () => gl.uniform2f(this.blur.u.uDir, 0, 1.5 / qA.h));
    }
    // composite to the canvas
    const C = this.comp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ps.scene!.tex);
    gl.uniform1i(C.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ps.halfA!.tex);
    gl.uniform1i(C.u.uB1, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ps.qA!.tex);
    gl.uniform1i(C.u.uB2, 2);
    gl.uniform1f(C.u.uBloom, this.postOpts.bloom);
    gl.uniform1f(C.u.uVignette, this.postOpts.vignette);
    gl.uniform1f(C.u.uSat, this.postOpts.saturation);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }
}

export { Camera };
