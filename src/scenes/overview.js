// 00 · 细胞全景 — the whole cell as one breathing volume.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { shellMaterial } from '../core/materials.js';
import {
  makeNucleus, makeMitochondrion, makeERStack, makeGolgiStack,
  makeMicrotubules, makeVesicle,
} from '../core/builders.js';
import { mulberry32, TAU, smoothstep } from '../core/util.js';

const CELL_R = 15.0;

export class OverviewScene extends Scene {
  constructor() {
    super('overview');
  }

  build() {
    const rnd = mulberry32(2024);

    /* ── the plasma membrane: a great translucent shell ────────────────── */
    const membraneGeo = new THREE.IcosahedronGeometry(CELL_R, 48);
    this.membraneMat = shellMaterial({
      color: 0x37e0ff, rim: 0xcdf6ff, inner: 0x06283c,
      power: 3.4, intensity: 0.55, opacity: 0.070,
      noiseScale: 1.05, noiseAmp: 0.34, pulse: 0.22, timeScale: 0.085,
      emissive: 0.9, fresnelBias: 0.01,
    });
    this.timed(this.membraneMat);
    const membrane = new THREE.Mesh(membraneGeo, this.membraneMat);
    this.scene.add(membrane);
    this.own(membraneGeo, this.membraneMat);

    // a second, tighter shell adds the "thickness" of the bilayer at this scale
    const membrane2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(CELL_R * 0.975, 40),
      shellMaterial({
        color: 0x2affc0, rim: 0xa8fff0, inner: 0x03302a,
        power: 4.2, intensity: 0.30, opacity: 0.038,
        noiseScale: 1.6, noiseAmp: 0.20, pulse: 0.10, timeScale: 0.11,
      }),
    );
    this.scene.add(membrane2);

    /* ── nucleus, offset from centre so the composition has a subject ──── */
    this.nucleus = makeNucleus({ radius: 4.5, chromatin: 22, pores: 190, seed: 5 });
    this.nucleus.position.set(-1.2, 0.6, 0.8);
    this.nucleus.scale.setScalar(1.0);
    this.scene.add(this.nucleus);

    /* ── mitochondria drifting through the cytoplasm ───────────────────── */
    this.mitos = [];
    const mitoDefs = [
      { p: [10.2, 3.4, 3.6], r: [0.2, 0.9, 0.3], s: 0.85 },
      { p: [7.0, -6.2, -4.4], r: [-0.5, 2.1, 0.8], s: 0.72 },
      { p: [-6.4, 7.4, 3.2], r: [0.9, 0.4, -0.6], s: 0.68 },
      { p: [4.0, 6.8, -7.6], r: [1.4, -0.7, 0.3], s: 0.60 },
      { p: [-8.6, -5.4, -3.0], r: [-0.3, 1.2, 1.1], s: 0.64 },
    ];
    for (let i = 0; i < mitoDefs.length; i++) {
      const d = mitoDefs[i];
      const m = makeMitochondrion({ length: 6.4, radius: 2.0, cristae: 13, seed: 21 + i * 7, hot: true });
      m.position.set(...d.p);
      m.rotation.set(...d.r);
      m.scale.setScalar(d.s);
      m.userData.spin = 0.05 + rnd() * 0.08;
      m.userData.basePos = m.position.clone();
      this.scene.add(m);
      this.mitos.push(m);
    }

    /* ── ER + Golgi ───────────────────────────────────────────────────── */
    this.er = makeERStack({ count: 5, width: 8, height: 5.4, amp: 0.5, spread: 0.72, seed: 33, ribosomes: 260 });
    this.er.position.set(-9.0, -3.8, 5.0);
    this.er.rotation.set(0.5, 0.9, 0.25);
    this.er.scale.setScalar(0.95);
    this.scene.add(this.er);

    this.golgi = makeGolgiStack({ cisternae: 5, radius: 2.5, seed: 44 });
    this.golgi.position.set(-4.4, 5.8, -7.6);
    this.golgi.rotation.set(-0.5, 0.4, 0.3);
    this.golgi.scale.setScalar(0.95);
    this.scene.add(this.golgi);

    /* ── cytoskeleton: long-range structure ───────────────────────────── */
    this.microtubules = makeMicrotubules({ count: 22, radius: CELL_R * 0.86, seed: 77, color: 0x5ef3ff });
    this.scene.add(this.microtubules);

    /* ── cytoplasmic mote field (GPU, analytic) ───────────────────────── */
    this.field = new FieldPoints({
      count: 6500, inner: 1.6, outer: CELL_R * 0.96,
      size: 15, turbulence: 0.85, flowScale: 0.075, flowSpeed: 0.045, swirl: 0.028,
      tintA: 0x2affc0, tintB: 0x5ef3ff, tintMix: 1.0, opacity: 0.30, hot: 0.14, seed: 7,
    });
    this.scene.add(this.field.object);

    /* ── vesicle traffic: vesicles ferrying between organelles ────────── */
    this.traffic = new ParticleSystem({ capacity: 900, sizeScale: 1.0 });
    this.scene.add(this.traffic.object);

    this.vesicleMeshes = [];
    for (let i = 0; i < 14; i++) {
      const v = makeVesicle({ radius: 0.30 + rnd() * 0.22, color: 0x7dffe0, cargo: 0xd8fff4, seed: i });
      const a = rnd() * TAU, b = rnd() * TAU;
      v.userData.route = {
        a: new THREE.Vector3(Math.cos(a) * (5 + rnd() * 6), (rnd() - 0.5) * 10, Math.sin(a) * (5 + rnd() * 6)),
        b: new THREE.Vector3(Math.cos(b) * (5 + rnd() * 6), (rnd() - 0.5) * 10, Math.sin(b) * (5 + rnd() * 6)),
        speed: 0.10 + rnd() * 0.14,
        phase: rnd(),
      };
      this.scene.add(v);
      this.vesicleMeshes.push(v);
    }

    /* ── the key light, placed above and behind the cell ──────────────── */
    this.lightPos = new THREE.Vector3(6, 14, -10);

    this._t = 0;
  }

  particleCount() {
    return 6500 + this.traffic.count;
  }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    return smoothstep(0.02, 0.10, localT) * (1 - smoothstep(0.92, 1.0, localT));
  }

  reset() {
    this.traffic.clear();
  }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;

    this.field.update(time, dt);

    // the whole cell breathes
    const breathe = 1 + Math.sin(time * 0.42) * 0.022 + Math.sin(time * 0.17) * 0.012;
    this.scene.children.forEach(() => {});
    if (this.membraneMat.uniforms) this.membraneMat.uniforms.uIntensity.value = 1.05 + Math.sin(time * 0.5) * 0.12;

    // organelles drift on their own slow orbits
    for (let i = 0; i < this.mitos.length; i++) {
      const m = this.mitos[i];
      const b = m.userData.basePos;
      m.position.set(
        b.x + Math.sin(time * 0.13 + i * 1.7) * 0.9,
        b.y + Math.cos(time * 0.11 + i * 2.3) * 0.8,
        b.z + Math.sin(time * 0.09 + i * 3.1) * 0.9,
      );
      m.rotation.y += dt * m.userData.spin * 0.35;
      m.userData.update?.(time);
    }
    this.nucleus.userData.update?.(time);
    this.er.userData.update?.(time);
    this.golgi.userData.update?.(time);
    this.microtubules.userData.update?.(time);

    // vesicle traffic between organelles
    for (const v of this.vesicleMeshes) {
      const r = v.userData.route;
      const p = (time * r.speed + r.phase) % 1;
      const e = p < 0.5 ? p * 2 : (1 - p) * 2;
      const ease = e * e * (3 - 2 * e);
      v.position.lerpVectors(r.a, r.b, ease);
      // arc the path so vesicles do not travel in straight lines
      v.position.y += Math.sin(p * Math.PI) * 1.6;
      v.userData.update?.(time);
    }

    // a slow current of free molecules in the cytoplasm
    if (Math.random() < 0.6) {
      const a = Math.random() * TAU, u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      const rr = 6 + Math.random() * 8;
      burst(this.traffic, 2, {
        x: s * Math.cos(a) * rr, y: u * rr, z: s * Math.sin(a) * rr,
        speed: 0.35, life: 2.2, size: 0.5, drag: 0.35,
        color: [0.25, 0.95, 0.75],
      });
    }
    this.traffic.update(dt, (sys, i, d) => {
      // curl-ish drift plus a pull toward the cell centre so nothing escapes
      const x = sys.px[i], y = sys.py[i], z = sys.pz[i];
      const r = Math.hypot(x, y, z) || 1;
      const k = 0.12;
      sys.vx[i] += (-x / r) * k * d;
      sys.vy[i] += (-y / r) * k * d;
      sys.vz[i] += (-z / r) * k * d;
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vy[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });
  }
}
