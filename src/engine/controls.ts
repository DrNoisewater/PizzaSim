// Camera: one-finger (or left-mouse) drag pans around the shop, pinch or wheel zooms,
// two-finger twist or right-drag rotates. Classic mode swaps drag back to rotate.
import type { Camera } from './scene';
import { clamp, type V3 } from './math';

export class OrbitControls {
  cam: Camera;
  el: HTMLElement;
  target: V3 = [0, 0.6, 0.6];
  yaw = 0.62;
  pitch = 0.86;
  distance = 24;
  minDist = 9;
  maxDist = 40;
  minYaw = -0.75;
  maxYaw = 1.65;
  minPitch = 0.38;
  maxPitch = 1.3;
  panLimit = 7;
  enabled = true;
  /** Auto-rotate for the title screen. */
  autoRotate = 0;
  private goal = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: [...this.target] as V3 };
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private lastAngle = 0;
  /** Classic controls: one-finger drag rotates instead of panning. */
  dragRotates = false;
  private dragMoved = 0;
  private button = 0;
  /** True when the last pointer interaction was a drag (suppresses click). */
  wasDrag = false;

  constructor(cam: Camera, el: HTMLElement) {
    this.cam = cam;
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private baseDist = 24;

  reset() {
    this.goal.yaw = 0.62;
    this.goal.pitch = 0.86;
    this.goal.distance = this.baseDist;
    this.goal.target = [0, 0.6, 0.6];
  }

  /** Pull the camera back on tall (portrait) screens so the whole shop fits. */
  fit(aspect: number) {
    const k = aspect < 1 ? Math.pow(1 / Math.max(0.3, aspect), 0.85) : 1;
    const base = Math.min(48, 24 * k);
    this.maxDist = Math.max(40, base * 1.3);
    if (Math.abs(base - this.baseDist) < 0.01) return;
    const ratio = base / this.baseDist;
    this.baseDist = base;
    this.goal.distance = Math.min(this.maxDist, this.goal.distance * ratio);
    this.distance = this.goal.distance;
  }

  zoomBy(f: number) {
    this.goal.distance = clamp(this.goal.distance * f, this.minDist, this.maxDist);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragMoved = 0;
    this.button = e.button;
    this.wasDrag = false;
    if (this.pointers.size === 2) {
      this.lastPinch = this.pinchDist();
      this.lastAngle = this.pinchAngle();
    }
  };
  private pinchDist() {
    const p = [...this.pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  private pinchAngle() {
    const p = [...this.pointers.values()];
    return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  }
  rotateBy(d: number) {
    this.goal.yaw = clamp(this.goal.yaw + d, this.minYaw, this.maxYaw);
  }
  private rotate(dx: number, dy: number) {
    this.goal.yaw = clamp(this.goal.yaw - dx * 0.006, this.minYaw, this.maxYaw);
    this.goal.pitch = clamp(this.goal.pitch + dy * 0.005, this.minPitch, this.maxPitch);
  }
  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.dragMoved > 6) this.wasDrag = true;
    if (this.pointers.size === 1) {
      const rotate = this.button === 2 || e.shiftKey || e.altKey ? !this.dragRotates : this.dragRotates;
      if (rotate) this.rotate(dx, dy);
      else this.pan(dx, dy);
    } else if (this.pointers.size === 2) {
      prev.x = e.clientX;
      prev.y = e.clientY;
      const d = this.pinchDist();
      if (this.lastPinch > 0) this.goal.distance = clamp(this.goal.distance * (this.lastPinch / d), this.minDist, this.maxDist);
      this.lastPinch = d;
      // twist two fingers to turn the camera
      const a = this.pinchAngle();
      let da = a - this.lastAngle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < 0.5) this.rotateBy(-da);
      this.lastAngle = a;
      this.pan(dx / 2, dy / 2);
      return;
    }
    prev.x = e.clientX;
    prev.y = e.clientY;
  };
  private pan(dx: number, dy: number) {
    // pan speed follows how zoomed in you are, so the ground moves with your finger
    const fov = (this.cam as unknown as { fov?: number }).fov ?? 0.7;
    const s = (this.goal.distance * 2 * Math.tan(fov / 2)) / Math.max(200, this.el.clientHeight);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // screen right = (cos yaw, 0, -sin yaw); screen up on ground = (-sin yaw, 0, -cos yaw)
    const t = this.goal.target;
    const k = 1 / Math.max(0.5, Math.sin(this.pitch));
    t[0] = clamp(t[0] - dx * s * cy - dy * s * sy * k, -this.panLimit, this.panLimit);
    t[2] = clamp(t[2] + dx * s * sy - dy * s * cy * k, -this.panLimit + 1, this.panLimit + 1);
  }
  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.lastPinch = 0;
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoomBy(Math.exp(e.deltaY * 0.0012));
  };

  update(dt: number) {
    if (this.autoRotate) {
      this.goal.yaw += this.autoRotate * dt;
      if (this.goal.yaw > this.maxYaw) this.autoRotate = -Math.abs(this.autoRotate);
      if (this.goal.yaw < this.minYaw + 0.6) this.autoRotate = Math.abs(this.autoRotate);
    }
    const k = 1 - Math.pow(0.0008, dt);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    for (let i = 0; i < 3; i++) this.target[i] += (this.goal.target[i] - this.target[i]) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.cam.eye = [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + sp * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
    this.cam.target = [...this.target] as V3;
  }
}
