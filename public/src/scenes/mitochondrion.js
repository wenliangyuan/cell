// 03 · 线粒体 — cristae, the proton gradient, and the ATP synthase motor.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { tissueMaterial, flowLineMaterial } from '../core/materials.js';
import { makeMitochondrion } from '../core/builders.js';
import { mulberry32, TAU, smoothstep } from '../core/util.js';

export class MitochondrionScene extends Scene {
  constructor() {
    super('mitochondrion');
  }

  build() {
    const rnd = mulberry32(404);

    /* ── the organelle, scaled up to fill the frame ────────────────────── */
    this.mito = makeMitochondrion({ length: 9.5, radius: 3.0, cristae: 18, seed: 21, hot: true });
    this.mito.rotation.z = 0.28;
    this.mito.rotation.y = 0.4;
    this.scene.add(this.mito);

    /* ── the proton gradient: H+ pooling in the intermembrane space ────── */
    // A shell field squeezed between the outer and inner membranes.
    this.protons = new FieldPoints({
      count: 3400, inner: 2.9, outer: 4.6, size: 12,
      turbulence: 1.1, flowScale: 0.22, flowSpeed: 0.11, swirl: 0.05, breathe: 0.6,
      tintA: 0xffd166, tintB: 0xfff0b0, tintMix: 0.9, opacity: 0.34, hot: 0.30, seed: 55,
    });
    this.protons.object.scale.set(1.55, 0.95, 0.95);
    this.protons.object.rotation.copy(this.mito.rotation);
    this.scene.add(this.protons.object);

    /* ── matrix-side motes: the Krebs cycle churn ──────────────────────── */
    this.matrix = new FieldPoints({
      count: 2600, inner: 0.6, outer: 4.0, size: 11,
      turbulence: 1.4, flowScale: 0.28, flowSpeed: 0.14, swirl: 0.06, breathe: 0.5,
      tintA: 0xff8a1f, tintB: 0xffd166, tintMix: 0.7, opacity: 0.26, hot: 0.22, seed: 61,
    });
    this.matrix.object.scale.set(1.5, 0.92, 0.92);
    this.matrix.object.rotation.copy(this.mito.rotation);
    this.scene.add(this.matrix.object);

    /* ── electrons: discrete carriers hopping down the ETC ─────────────── */
    this.electrons = new ParticleSystem({ capacity: 1800, sizeScale: 1.1 });
    this.scene.add(this.electrons.object);

    /* ── ATP molecules released into the cytoplasm ─────────────────────── */
    this.atp = new ParticleSystem({ capacity: 2400, sizeScale: 1.2 });
    this.scene.add(this.atp.object);

    /* ── the ETC: a chain of complexes along the inner membrane ────────── */
    this.etc = this._makeETC(rnd);

    this.lightPos = new THREE.Vector3(2, 13, 6);
    this._t = 0;
    this._etcPhase = 0;
    this._atpTimer = 0;
  }

  _makeETC(rnd) {
    const g = new THREE.Group();
    const mat = tissueMaterial({
      color: 0x5a2c00, rim: 0xffd79a, emissive: 0xff8c1a, emissiveStrength: 0.55,
      noiseScale: 5.5, relief: 0.08, timeScale: 0.5, rimPower: 2.0, pulse: 0.05,
    });
    this.timed(mat);

    // four complexes sitting on a crista edge, plus mobile carriers between them
    const nodes = [];
    const N = 4;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = (t - 0.5) * 7.4;
      const y = Math.sin(t * Math.PI) * 0.4 - 0.2;
      const z = 1.9 + Math.sin(i * 2.1) * 0.5;
      const node = new THREE.Group();
      // a lumpy membrane protein complex
      const lobes = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < lobes; k++) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.30 + rnd() * 0.26, 3),
          mat,
        );
        m.position.set((rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.7);
        m.scale.set(1, 0.8 + rnd() * 0.6, 1);
        node.add(m);
      }
      node.position.set(x, y, z);
      node.userData.base = new THREE.Vector3(x, y, z);
      node.userData.phase = rnd() * TAU;
      g.add(node);
      nodes.push(node);
    }

    // mobile electron carriers shuttling between the complexes
    const carrierMat = flowLineMaterial({
      color: 0xffe28a, hot: 0xffffff, speed: 2.2, dashScale: 5.0, intensity: 1.6, opacity: 0.9,
    });
    this.timed(carrierMat);
    const carriers = [];
    for (let i = 0; i < 22; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.10, 1), new THREE.MeshBasicMaterial({
        color: 0xffe28a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      c.userData.t = rnd();
      c.userData.speed = 0.14 + rnd() * 0.22;
      c.userData.lane = rnd() * 0.7 - 0.35;
      g.add(c);
      carriers.push(c);
    }

    g.userData.nodes = nodes;
    g.userData.carriers = carriers;
    g.userData.materials = [mat, carrierMat];

    // the path the carriers follow
    this._etcPath = new THREE.CatmullRomCurve3(
      nodes.map(n => n.userData.base.clone()),
      false, 'catmullrom', 0.4,
    );
    return g;
  }

  particleCount() {
    return 3400 + 2600 + this.electrons.count + this.atp.count;
  }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    return smoothstep(0.04, 0.14, localT) * (1 - smoothstep(0.90, 0.99, localT));
  }

  reset() {
    this.electrons.clear();
    this.atp.clear();
    this._etcPhase = 0;
  }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;

    this.mito.userData.update?.(time);
    this.protons.update(time, dt);
    this.matrix.update(time, dt);

    // the whole organelle pulses with the respiratory rhythm
    const beat = 1 + Math.sin(time * 1.15) * 0.018 + Math.sin(time * 0.43) * 0.010;
    this.mito.scale.setScalar(beat);
    this.protons.object.scale.set(1.55 * beat, 0.95 * beat, 0.95 * beat);
    this.matrix.object.scale.set(1.5 * beat, 0.92 * beat, 0.92 * beat);

    /* ── ETC: carriers shuttling along the chain, complexes pulsing ────── */
    const path = this._etcPath;
    for (const c of this.etc.userData.carriers) {
      c.userData.t = (c.userData.t + dt * c.userData.speed) % 1;
      const p = path.getPointAt(c.userData.t);
      c.position.set(p.x, p.y + c.userData.lane * 0.5, p.z + Math.sin(time * 2 + c.userData.t * 8) * 0.3);
      c.scale.setScalar(0.8 + 0.5 * Math.sin(time * 6 + c.userData.t * 20));
      // each time a carrier reaches a complex, it releases energy
      const prev = c.userData.lastT ?? 0;
      if (Math.floor(c.userData.t * 4) !== Math.floor(prev * 4)) {
        burst(this.electrons, 8, {
          x: c.position.x, y: c.position.y, z: c.position.z,
          speed: 1.6, life: 0.7, size: 0.5, drag: 1.4, spread: 1,
          color: [1.0, 0.90, 0.55],
        });
      }
      c.userData.lastT = c.userData.t;
    }
    for (const n of this.etc.userData.nodes) {
      const s = 1 + Math.sin(time * 2.2 + n.userData.phase) * 0.05;
      n.scale.setScalar(s);
      n.position.y = n.userData.base.y + Math.sin(time * 0.9 + n.userData.phase) * 0.10;
    }

    this.electrons.update(dt, (sys, i, d) => {
      sys.vy[i] -= 0.6 * d;
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vy[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });

    /* ── ATP synthesis: a steady stream ejected from the cristae ──────── */
    this._atpTimer -= dt;
    if (this._atpTimer <= 0) {
      this._atpTimer = 0.075;
      // pick a random ATP synthase site on the organelle surface
      const a = Math.random() * TAU;
      const x = (Math.random() - 0.5) * 8.0;
      const k = Math.max(0.2, Math.sqrt(Math.max(0, 1 - Math.pow((x / 4.75) * 0.98, 2))));
      const rr = 3.0 * 0.75 * k;
      const y = Math.sin(a) * rr, z = Math.cos(a) * rr;
      const dir = new THREE.Vector3(0, Math.sin(a), Math.cos(a)).normalize();
      burst(this.atp, 2, {
        x: x * 1.05, y: y * 1.4, z: z * 1.4,
        speed: 0.9, life: 2.6, size: 0.65, drag: 0.35, spread: 0.35, jitter: 0.3,
        color: [1.0, 0.78, 0.32],
      });
      // nudge them outward
      for (let i = Math.max(0, this.atp.count - 2); i < this.atp.count; i++) {
        this.atp.vx[i] += dir.x * 1.4;
        this.atp.vy[i] += dir.y * 1.4;
        this.atp.vz[i] += dir.z * 1.4;
      }
    }
    this.atp.update(dt, (sys, i, d) => {
      // ATP diffuses away and fades
      sys.vx[i] += (Math.random() - 0.5) * 1.2 * d;
      sys.vy[i] += (Math.random() - 0.5) * 1.2 * d;
      sys.vz[i] += (Math.random() - 0.5) * 1.2 * d;
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vy[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });
  }
}
