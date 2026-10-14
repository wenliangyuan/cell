// 02 · 细胞核 — the genome vault: envelope, pores, chromatin, nucleolus.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { flowLineMaterial } from '../core/materials.js';
import { makeNucleus } from '../core/builders.js';
import { mulberry32, TAU, smoothstep } from '../core/util.js';

const R = 5.2;

export class NucleusScene extends Scene {
  constructor() {
    super('nucleus');
  }

  build() {
    const rnd = mulberry32(808);

    /* ── the nucleus itself ────────────────────────────────────────────── */
    this.nucleus = makeNucleus({ radius: R, chromatin: 44, pores: 300, seed: 5 });
    this.scene.add(this.nucleus);

    /* ── mRNA transcripts leaving through the pores ────────────────────── */
    this.mrna = [];
    const mrnaMat = flowLineMaterial({
      color: 0xffd166, hot: 0xffffff, speed: 1.6, dashScale: 3.0, intensity: 1.5, opacity: 0.95,
    });
    this.timed(mrnaMat);
    for (let i = 0; i < 26; i++) {
      const pts = [];
      const n = 8;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        pts.push(new THREE.Vector3(
          Math.sin(t * 7 + i) * 0.35 * (1 - t),
          -t * 2.4,
          Math.cos(t * 6 + i * 1.7) * 0.35 * (1 - t),
        ));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const flow = new Float32Array(n);
      for (let k = 0; k < n; k++) flow[k] = k / (n - 1);
      geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      const line = new THREE.Line(geo, mrnaMat);
      line.visible = false;
      this.scene.add(line);
      this.mrna.push({
        line,
        start: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        life: rnd() * 3,
        duration: 2.4 + rnd() * 2.0,
        active: false,
      });
    }

    /* ── import traffic: proteins heading in through the pores ─────────── */
    this.imports = new ParticleSystem({ capacity: 2200, sizeScale: 1.0 });
    this.scene.add(this.imports.object);

    /* ── cytoplasmic field around the nucleus ──────────────────────────── */
    this.field = new FieldPoints({
      count: 4200, inner: R * 1.25, outer: 17, size: 12,
      turbulence: 0.9, flowScale: 0.10, flowSpeed: 0.05, swirl: 0.02,
      tintA: 0xff5fb4, tintB: 0x8b5cf6, tintMix: 0.8, opacity: 0.26, hot: 0.22, seed: 31,
    });
    this.scene.add(this.field.object);

    /* ── the nuclear lamina: a filament cage just inside the envelope ──── */
    this.lamina = this._makeLamina(rnd);

    this.lightPos = new THREE.Vector3(-7, 11, -9);
    this._t = 0;
  }

  _makeLamina(rnd) {
    const g = new THREE.Group();
    const mat = flowLineMaterial({
      color: 0xff8ad0, hot: 0xffffff, speed: 0.3, dashScale: 2.2, intensity: 0.5, opacity: 0.3,
    });
    for (let i = 0; i < 60; i++) {
      const pts = [];
      const n = 6;
      const u0 = rnd() * 2 - 1, th0 = rnd() * TAU;
      for (let k = 0; k < n; k++) {
        const u = Math.max(-1, Math.min(1, u0 + (rnd() - 0.5) * 0.5));
        const th = th0 + k * 0.5 + (rnd() - 0.5) * 0.4;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        const rr = R * (0.90 + rnd() * 0.05);
        pts.push(new THREE.Vector3(s * Math.cos(th) * rr, u * rr, s * Math.sin(th) * rr));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(18));
      const flow = new Float32Array(19);
      for (let k = 0; k < 19; k++) flow[k] = k / 18;
      geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      g.add(new THREE.Line(geo, mat));
    }
    g.userData.materials = [mat];
    this.scene.add(g);
    return g;
  }

  particleCount() { return 4200 + this.imports.count; }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    return smoothstep(0.04, 0.14, localT) * (1 - smoothstep(0.90, 0.99, localT));
  }

  reset() {
    this.imports.clear();
    for (const m of this.mrna) { m.active = false; m.line.visible = false; m.life = Math.random() * 3; }
  }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;

    this.nucleus.userData.update?.(time);
    this.field.update(time, dt);
    this.lamina.rotation.y = -time * 0.02;

    /* ── mRNA export through nuclear pores ───────────────────────────── */
    for (const m of this.mrna) {
      m.life -= dt;
      if (!m.active && m.life <= 0) {
        // launch from a random point on the envelope
        const u = Math.random() * 2 - 1, th = Math.random() * TAU;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        m.dir.set(s * Math.cos(th), u, s * Math.sin(th)).normalize();
        m.start.copy(m.dir).multiplyScalar(R * 0.98);
        m.line.position.copy(m.start);
        m.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), m.dir);
        m.line.visible = true;
        m.active = true;
        m.age = 0;
        m.duration = 1.8 + Math.random() * 2.2;
        // a puff of particles at the pore
        burst(this.imports, 14, {
          x: m.start.x, y: m.start.y, z: m.start.z,
          speed: 1.4, life: 1.2, size: 0.55, drag: 0.6, spread: 0.8,
          color: [1.0, 0.82, 0.40],
        });
      } else if (m.active) {
        m.age += dt;
        const p = m.age / m.duration;
        // slide outward along the pore axis while unspooling
        m.line.position.copy(m.start).addScaledVector(m.dir, p * 4.2);
        m.line.scale.set(1, 1 + p * 0.8, 1);
        if (p >= 1) { m.active = false; m.line.visible = false; m.life = 0.4 + Math.random() * 2.4; }
      }
    }

    /* ── importin traffic: particles converging on the pores ─────────── */
    if (Math.random() < 0.55) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const dir = new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
      const r0 = R * (2.4 + Math.random() * 1.6);
      burst(this.imports, 5, {
        x: dir.x * r0, y: dir.y * r0, z: dir.z * r0,
        speed: 0.2, life: 2.4, size: 0.5, drag: 0.1, spread: 0.4, jitter: 0.6,
        color: [0.55, 0.95, 1.0],
      });
    }
    this.imports.update(dt, (sys, i, d) => {
      const x = sys.px[i], y = sys.py[i], z = sys.pz[i];
      const r = Math.hypot(x, y, z) || 1;
      // pull toward the envelope
      const k = 2.2;
      sys.vx[i] += (-x / r) * k * d;
      sys.vy[i] += (-y / r) * k * d;
      sys.vz[i] += (-z / r) * k * d;
      // tangential swirl so the traffic spirals in
      sys.vx[i] += (-z / r) * 0.9 * d;
      sys.vz[i] += (x / r) * 0.9 * d;
      if (r < R * 1.02) { sys.life[i] = Math.min(sys.life[i], 0.18); }
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vy[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });

    // the envelope breathes and the whole nucleus turns
    const breathe = 1 + Math.sin(time * 0.55) * 0.012;
    this.nucleus.scale.setScalar(breathe);
    this.lamina.scale.setScalar(breathe);
  }
}
