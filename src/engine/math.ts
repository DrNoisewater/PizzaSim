// Minimal column-major 4x4 matrix + vector math for the Crust renderer.
export type V3 = [number, number, number];
export type M4 = Float32Array;

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export const m4 = {
  create(): M4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(o: M4): M4 {
    o.fill(0);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },
  copy(o: M4, a: M4): M4 {
    o.set(a);
    return o;
  },
  /** o = a * b */
  mul(o: M4, a: M4, b: M4): M4 {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },
  perspective(o: M4, fovy: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) * nf;
    o[11] = -1;
    o[14] = 2 * far * near * nf;
    return o;
  },
  ortho(o: M4, l: number, r: number, b: number, t: number, n: number, f: number): M4 {
    o.fill(0);
    o[0] = 2 / (r - l);
    o[5] = 2 / (t - b);
    o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l);
    o[13] = -(t + b) / (t - b);
    o[14] = -(f + n) / (f - n);
    o[15] = 1;
    return o;
  },
  lookAt(o: M4, eye: V3, target: V3, up: V3): M4 {
    let z = v3.sub(eye, target);
    z = v3.norm(z);
    let x = v3.cross(up, z);
    if (v3.len(x) < 1e-6) x = [1, 0, 0];
    x = v3.norm(x);
    const y = v3.cross(z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3.dot(x, eye);
    o[13] = -v3.dot(y, eye);
    o[14] = -v3.dot(z, eye);
    o[15] = 1;
    return o;
  },
  invert(o: M4, a: M4): M4 | null {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  /** Compose T * Ry * Rx * Rz * S. Yaw is applied last so Y rotation reads naturally. */
  compose(o: M4, p: V3, r: V3, s: V3): M4 {
    const [rx, ry, rz] = r;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + sy * sx * sz;
    const m01 = cx * sz;
    const m02 = -sy * cz + cy * sx * sz;
    const m10 = -cy * sz + sy * sx * cz;
    const m11 = cx * cz;
    const m12 = sy * sz + cy * sx * cz;
    const m20 = sy * cx;
    const m21 = -sx;
    const m22 = cy * cx;
    o[0] = m00 * s[0]; o[1] = m01 * s[0]; o[2] = m02 * s[0]; o[3] = 0;
    o[4] = m10 * s[1]; o[5] = m11 * s[1]; o[6] = m12 * s[1]; o[7] = 0;
    o[8] = m20 * s[2]; o[9] = m21 * s[2]; o[10] = m22 * s[2]; o[11] = 0;
    o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1;
    return o;
  },
  /** Inverse-transpose of the upper 3x3, written to a 9-element array. */
  normalMat(o: Float32Array, a: M4): Float32Array {
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[4], a11 = a[5], a12 = a[6];
    const a20 = a[8], a21 = a[9], a22 = a[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) det = 1e-8;
    det = 1 / det;
    // inverse (row-major thinking) then transpose into column-major mat3
    const i00 = b01 * det;
    const i01 = (-a22 * a01 + a02 * a21) * det;
    const i02 = (a12 * a01 - a02 * a11) * det;
    const i10 = b11 * det;
    const i11 = (a22 * a00 - a02 * a20) * det;
    const i12 = (-a12 * a00 + a02 * a10) * det;
    const i20 = b21 * det;
    const i21 = (-a21 * a00 + a01 * a20) * det;
    const i22 = (a11 * a00 - a01 * a10) * det;
    // transpose
    o[0] = i00; o[1] = i10; o[2] = i20;
    o[3] = i01; o[4] = i11; o[5] = i21;
    o[6] = i02; o[7] = i12; o[8] = i22;
    return o;
  },
  transformPoint(m: M4, p: V3): V3 {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
};

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** "#rrggbb" -> [r,g,b] in 0..1 */
export function hex(c: string): V3 {
  const n = parseInt(c.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function mixColor(a: V3, b: V3, t: number): V3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
