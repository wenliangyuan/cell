// 01 · 细胞膜 — the fluid mosaic at molecular scale.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { glassMaterial, flowLineMaterial } from '../core/materials.js';
import { makeMembraneField, makeMembraneProteins } from '../core/builders.js';
import { mulberry32, TAU, smoothstep } from '../core/util.js';

const EXTENT = 13.5;

export class MembraneScene extends Scene {
  constructor() {
    super('membrane');
  }

  build() {
    const rnd = mulberry32(515);

    /* ── the bilayer itself: ~1400 phospholipids in two leaflets ───────── */
    this.bilayer = makeMembraneField({
      extent: EXTENT, spacing: 0.66, leafletGap: 0.62,
      tailLength: 1.05, seed: 91, color: 0x37e0ff,
    });
    this.scene.add(this.bilayer);

    /* ── integral proteins drifting in the lipid sea ───────────────────── */
    this.proteins = makeMembraneProteins({ count: 8, extent: EXTENT * 0.68, seed: 5, color: 0x8b5cf6 });
    this.scene.add(this.proteins);

    /* ── cholesterol: rigid little wedges tucked between tails ─────────── */
    this.cholesterol = this._makeCholesterol(rnd, 130);

    /* ── glycocalyx: sugar chains on the outer face ────────────────────── */
    this.glyco = this._makeGlycocalyx(rnd, 90);

    /* ── water above and below, as a drifting mote field ───────────────── */
    this.waterTop = new FieldPoints({
      count: 4200, inner: 5.5, outer: 24, size: 11, turbulence: 1.5,
      flowScale: 0.16, flowSpeed: 0.09, swirl: 0.02, breathe: 0.4,
      tintA: 0x5ef3ff, tintB: 0xcdf6ff, tintMix: 0.7, opacity: 0.30, hot: 0.22, seed: 12,
    });
    this.waterTop.object.position.y = 6.0;
    this.waterTop.object.scale.set(1, 0.30, 1);
    this.scene.add(this.waterTop.object);

    this.waterBot = new FieldPoints({
      count: 3400, inner: 5.5, outer: 24, size: 10, turbulence: 1.2,
      flowScale: 0.18, flowSpeed: 0.07, swirl: -0.02, breathe: 0.4,
      tintA: 0x2affc0, tintB: 0x5ef3ff, tintMix: 0.6, opacity: 0.24, hot: 0.18, seed: 19,
    });
    this.waterBot.object.position.y = -6.5;
    this.waterBot.object.scale.set(1, 0.30, 1);
    this.scene.add(this.waterBot.object);

    /* ── transport events: ions and molecules crossing the bilayer ─────── */
    this.transport = new ParticleSystem({ capacity: 2600, sizeScale: 1.0 });
    this.scene.add(this.transport.object);
    this._transportTimer = 0;

    /* ── a few vesicles fusing with the membrane ───────────────────────── */
    this.fusions = [];
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.0, 4),
        glassMaterial({ color: 0x7dffe0, ior: 0.07, power: 3.0, opacity: 0.5, emissive: 1.0, thickness: 0.6 }),
      );
      v.add(shell);
      const a = rnd() * TAU, rr = EXTENT * (0.3 + rnd() * 0.45);
      v.position.set(Math.cos(a) * rr, -5.5 - rnd() * 1.5, Math.sin(a) * rr);
      v.scale.setScalar(0.9 + rnd() * 0.5);
      v.userData.phase = rnd() * 6;
      this.scene.add(v);
      this.fusions.push(v);
    }

    this.lightPos = new THREE.Vector3(4, 18, 8);
    this._t = 0;
  }

  _makeCholesterol(rnd, count) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const geo = new THREE.CapsuleGeometry(0.055, 0.62, 2, 5);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = rnd() * TAU, rr = EXTENT * Math.sqrt(rnd()) * 0.95;
      dummy.position.set(Math.cos(a) * rr, (rnd() < 0.5 ? 1 : -1) * (0.42 + rnd() * 0.2), Math.sin(a) * rr);
      dummy.rotation.set((rnd() - 0.5) * 0.5, rnd() * TAU, (rnd() - 0.5) * 0.5);
      dummy.scale.setScalar(0.8 + rnd() * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    g.add(mesh);
    g.userData.mesh = mesh;
    return g;
  }

  _makeGlycocalyx(rnd, count) {
    const g = new THREE.Group();
    const mat = flowLineMaterial({
      color: 0xff9ad5, hot: 0xffffff, speed: 0.25, dashScale: 2.0, intensity: 0.7, opacity: 0.55,
    });
    for (let i = 0; i < count; i++) {
      const a = rnd() * TAU, rr = EXTENT * Math.sqrt(rnd()) * 0.92;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = 0.7 + rnd() * 1.5;
      const pts = [];
      const seg = 5;
      for (let k = 0; k <= seg; k++) {
        const t = k / seg;
        pts.push(new THREE.Vector3(
          x + Math.sin(t * 5 + i) * 0.28 * t,
          1.0 + t * h,
          z + Math.cos(t * 4 + i * 1.3) * 0.28 * t,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
      const flow = new Float32Array(15);
      for (let k = 0; k < 15; k++) flow[k] = k / 14;
      geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      g.add(new THREE.Line(geo, mat));
    }
    g.userData.materials = [mat];
    return g;
  }

  particleCount() {
    return 4200 + 3400 + this.transport.count;
  }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    return smoothstep(0.05, 0.16, localT) * (1 - smoothstep(0.90, 0.99, localT));
  }

  reset() { this.transport.clear(); }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;

    this.bilayer.userData.update?.(time);
    this.proteins.userData.update?.(time);
    this.waterTop.update(time, dt);
    this.waterBot.update(time, dt);

    // the bilayer slowly undulates as a whole
    this.bilayer.rotation.y = Math.sin(time * 0.06) * 0.12;
    this.proteins.rotation.y = this.bilayer.rotation.y;

    // lateral diffusion: proteins drift within the plane
    this.proteins.children.forEach((c, i) => {
      const r = Math.hypot(c.position.x, c.position.z);
      if (r > 0.01) {
        const a = Math.atan2(c.position.z, c.position.x) + dt * 0.06 * (i % 2 ? 1 : -1);
        c.position.x = Math.cos(a) * r;
        c.position.z = Math.sin(a) * r;
      }
      c.rotation.y += dt * 0.25 * (i % 3 ? 1 : -1);
    });

    /* ── transport: bursts of ions crossing the membrane ──────────────── */
    this._transportTimer -= dt;
    if (this._transportTimer <= 0) {
      this._transportTimer = 0.42 + Math.random() * 0.5;
      const a = Math.random() * TAU, rr = EXTENT * Math.sqrt(Math.random()) * 0.9;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const outward = Math.random() < 0.6;
      const dir = outward ? 1 : -1;
      burst(this.transport, 16, {
        x, y: dir * 1.4, z,
        speed: 2.6, spread: 0.22, life: 1.5, size: 0.55, drag: 0.5, jitter: 0.35,
        color: outward ? [0.35, 0.95, 1.0] : [1.0, 0.72, 0.35],
      });
    }
    this.transport.update(dt, (sys, i, d) => {
      // once past the bilayer, the drift slows and spreads laterally
      const y = sys.py[i];
      if (Math.abs(y) > 1.6) {
        sys.vy[i] *= Math.exp(-1.6 * d);
        sys.vx[i] += (Math.random() - 0.5) * 1.6 * d;
        sys.vz[i] += (Math.random() - 0.5) * 1.6 * d;
      }
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });

    // vesicles rising and fusing
    this.fusions.forEach((v, i) => {
      const p = ((time * 0.09 + v.userData.phase) % 1);
      v.position.y = -5.5 - 1.5 + p * 5.4;
      v.scale.setScalar((0.9 + i * 0.15) * (1 - p * 0.35));
      v.rotation.y += dt * 0.3;
      if (p > 0.94 && Math.random() < 0.4) {
        burst(this.transport, 10, {
          x: v.position.x, y: -0.9, z: v.position.z,
          speed: 2.0, life: 1.1, size: 0.6, drag: 0.7, color: [0.6, 1.0, 0.85],
        });
      }
    });

    // the bilayer breathes very slightly at rest
    this.bilayer.scale.setScalar(1.0 + 0.02 * Math.sin(time * 0.4));
  }
}
