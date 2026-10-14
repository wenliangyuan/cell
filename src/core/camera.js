// Cinematic camera rig: catmull-rom spline moves, per-key framing, handheld
// noise, mouse parallax and impact shake, all blended into one pose.
import * as THREE from 'three';
import { damp, makeNoise1D, clamp } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.path = null;
    this.keys = [];
    this.roll = 0;
    this.parallax = new THREE.Vector2();
    this._parallaxTarget = new THREE.Vector2();
    this.shake = 0;
    this._shakeSeed = Math.random() * 100;
    this.noiseX = makeNoise1D(11);
    this.noiseY = makeNoise1D(29);
    this.noiseZ = makeNoise1D(53);
    this.intensity = 1;
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * @param {{pos:[number,number,number], look:[number,number,number], roll?:number,
   *          fov?:number, focus?:number, aperture?:number}[]} keys
   */
  setKeys(keys) {
    this.keys = keys;
    const pts = keys.map(k => new THREE.Vector3(...k.pos));
    this.path = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.42);
    this.lookPts = keys.map(k => new THREE.Vector3(...k.look));
    this.lookPath = new THREE.CatmullRomCurve3(this.lookPts, false, 'catmullrom', 0.42);
  }

  /** Additive camera shake impulse (0..1). */
  kick(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  setPointer(nx, ny) {
    this._parallaxTarget.set(nx, ny);
  }

  /**
   * @param {number} t normalized progress along the path (0..1)
   * @param {number} time absolute time in seconds
   * @param {number} dt delta seconds
   */
  update(t, time, dt, { fovTarget = 42, focusTarget = 12 } = {}) {
    if (!this.path) return;
    const tc = clamp(t, 0, 1);
    this.path.getPointAt(tc, this._pos);
    this.lookPath.getPointAt(tc, this._look);

    // interpolate per-key framing values across the same parameter
    const n = this.keys.length;
    const fk = tc * (n - 1);
    const i0 = Math.min(n - 1, Math.floor(fk));
    const i1 = Math.min(n - 1, i0 + 1);
    const f = fk - i0;
    const lerpKey = (name, dflt) => {
      const a = this.keys[i0][name] ?? dflt;
      const b = this.keys[i1][name] ?? dflt;
      return a + (b - a) * f;
    };
    const roll = lerpKey('roll', 0);
    const fov = lerpKey('fov', fovTarget);
    const focus = lerpKey('focus', focusTarget);
    const aperture = lerpKey('aperture', 0.34);

    // handheld drift: low-frequency noise, larger when the rig is "close in"
    const amp = 0.09 * this.intensity;
    const nx = this.noiseX(time * 0.23) * amp;
    const ny = this.noiseY(time * 0.19) * amp * 0.8;
    const nz = this.noiseZ(time * 0.17) * amp * 0.6;

    // pointer parallax
    this.parallax.x = damp(this.parallax.x, this._parallaxTarget.x, 2.4, dt);
    this.parallax.y = damp(this.parallax.y, this._parallaxTarget.y, 2.4, dt);
    const px = this.parallax.x * 0.42 * this.intensity;
    const py = this.parallax.y * 0.30 * this.intensity;

    // impact shake decays fast and uses higher frequency noise
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const s = this.shake * this.shake;
    const sx = this.noiseX(time * 17.3 + this._shakeSeed) * s * 0.22;
    const sy = this.noiseY(time * 15.1 + this._shakeSeed) * s * 0.22;
    const sr = this.noiseZ(time * 13.7 + this._shakeSeed) * s * 0.035;

    this.camera.position.set(
      this._pos.x + nx + px + sx,
      this._pos.y + ny + py + sy,
      this._pos.z + nz,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._look);
    this.camera.rotateZ(roll + sr + this.parallax.x * 0.02);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    return { focus, aperture };
  }
}
