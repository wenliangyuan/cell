// 05 · 有丝分裂 — one cell becoming two, choreographed in six phases.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { ADDITIVE } from '../core/materials.js';
import { makeChromosome, makeSpindle, makeNucleus } from '../core/builders.js';
import { mulberry32, TAU, smoothstep, clamp, easeInOutCubic } from '../core/util.js';

const R = 11.0;

/** Phase boundaries as fractions of the chapter. */
const PHASE = {
  condense: [0.00, 0.18],
  spindle: [0.14, 0.34],
  align: [0.30, 0.48],
  separate: [0.48, 0.68],
  reform: [0.66, 0.84],
  cleave: [0.80, 1.00],
};

const ramp = (t, [a, b]) => smoothstep(a, b, t);

export class MitosisScene extends Scene {
  constructor() {
    super('mitosis');
  }

  build() {
    const rnd = mulberry32(909);

    /* ── the cell: a shell that will pinch in two ──────────────────────── */
    this.cellMat = this._makeCellMaterial();
    const cellGeo = new THREE.IcosahedronGeometry(R, 48);
    this.cell = new THREE.Mesh(cellGeo, this.cellMat);
    this.scene.add(this.cell);
    this.own(cellGeo);

    /* ── chromatin → chromosomes ───────────────────────────────────────── */
    this.chromatin = makeNucleus({ radius: R * 0.62, chromatin: 26, pores: 120, seed: 17 });
    this.scene.add(this.chromatin);

    this.chromosomes = [];
    const N = 6;
    for (let i = 0; i < N; i++) {
      // Scaled up so the X shape still reads at the wide anaphase framing.
      const c = makeChromosome({ seed: 3 + i * 11, color: [0x8b5cf6, 0xff3d9a, 0x5ef3ff][i % 3], scale: 1.5 });
      // give each chromosome a home slot on the metaphase plate, spaced far
      // enough apart that neighbouring X shapes stay legible
      const ang = (i / N) * TAU;
      const rr = 5.4 + (i % 3) * 1.5;
      c.userData.home = new THREE.Vector3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
      c.userData.ang = ang;
      c.userData.rr = rr;
      c.userData.spin = (rnd() - 0.5) * 0.5;
      c.userData.tilt = (rnd() - 0.5) * 0.6;
      c.scale.setScalar(0.001);
      c.visible = false;
      this.scene.add(c);
      this.chromosomes.push(c);
    }

    /* ── the spindle ───────────────────────────────────────────────────── */
    this.spindle = makeSpindle({ count: 54, height: 24, spread: 6.4, seed: 13, color: 0x9d7bff });
    this.spindle.visible = false;
    this.spindle.scale.set(0.001, 1, 0.001);
    this.scene.add(this.spindle);

    /* ── daughter nuclei that re-form at the poles ─────────────────────── */
    this.daughters = [];
    for (const s of [1, -1]) {
      const d = makeNucleus({ radius: R * 0.42, chromatin: 8, pores: 90, seed: 23 + (s > 0 ? 0 : 5) });
      d.position.set(0, s * 7.0, 0);
      d.scale.setScalar(0.001);
      d.visible = false;
      this.scene.add(d);
      this.daughters.push(d);
    }

    /* ── cytoplasm ─────────────────────────────────────────────────────── */
    this.field = new FieldPoints({
      count: 5200, inner: 2, outer: R * 0.96, size: 12,
      turbulence: 0.9, flowScale: 0.085, flowSpeed: 0.05, swirl: 0.03,
      tintA: 0x8b5cf6, tintB: 0x5ef3ff, tintMix: 0.9, opacity: 0.26, hot: 0.20, seed: 71,
    });
    this.scene.add(this.field.object);

    /* ── kinetochore traffic: particles running along the spindle ──────── */
    this.traffic = new ParticleSystem({ capacity: 3000, sizeScale: 1.0 });
    this.scene.add(this.traffic.object);

    this.lightPos = new THREE.Vector3(0, 16, -12);
    this._t = 0;
    this._cleaveKicked = false;
  }

  _makeCellMaterial() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      ...ADDITIVE,
      uniforms: {
        uTime: { value: 0 },
        uFurrow: { value: 0 },
        uStretch: { value: 1 },
        uColor: { value: new THREE.Color(0x8b5cf6) },
        uRim: { value: new THREE.Color(0xd8c8ff) },
        uInner: { value: new THREE.Color(0x160a33) },
        uOpacity: { value: 0.075 },
        uRadius: { value: R },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform float uFurrow;
        uniform float uStretch;
        uniform float uRadius;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying float vFurrow;
        varying vec3 vPos;

        void main(){
          vec3 p = position;
          // elongate along the division axis
          p.y *= uStretch;
          // the contractile ring: pinch the equator
          float eq = exp(-pow(p.y / (uRadius * 0.34), 2.0));
          float pinch = 1.0 - uFurrow * eq * 0.92;
          p.xz *= pinch;
          // the poles bulge to conserve volume
          float pole = exp(-pow((abs(p.y) - uRadius * uStretch * 0.75) / (uRadius * 0.5), 2.0));
          p.xz *= 1.0 + uFurrow * pole * 0.22;
          vFurrow = uFurrow * eq;
          vPos = p;

          // living surface: slow ripples
          float w = sin(p.y * 0.55 + uTime * 1.1) * cos(p.x * 0.42 - uTime * 0.8);
          p += normalize(p) * w * 0.16;

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform vec3 uRim;
        uniform vec3 uInner;
        uniform float uOpacity;
        uniform float uTime;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        varying float vFurrow;
        varying vec3 vPos;

        void main(){
          vec3 N = normalize(vNormalW);
          vec3 V = normalize(vViewDir);
          // rim-dominant: the membrane should read as a boundary, not a surface
          float f = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
          vec3 col = mix(uInner, uColor, f * 0.9);
          col = mix(col, uRim, pow(f, 2.5));
          // the contractile ring glows as it tightens
          col += uRim * vFurrow * 2.4;
          float a = uOpacity * (0.06 + 1.0 * f + vFurrow * 1.8);
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    return mat;
  }

  particleCount() { return 5200 + this.traffic.count; }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    // markers change meaning as the chapter progresses; fade them out during
    // the fast anaphase movement to keep the frame readable
    const base = smoothstep(0.02, 0.10, localT) * (1 - smoothstep(0.92, 1.0, localT));
    return base * (1 - smoothstep(0.50, 0.62, localT) * 0.85);
  }

  reset() {
    this.traffic.clear();
    this._cleaveKicked = false;
    for (const c of this.chromosomes) { c.scale.setScalar(0.001); c.visible = false; }
    this.daughters.forEach(d => { d.scale.setScalar(0.001); d.visible = false; });
    this.spindle.visible = false;
    this.spindle.scale.set(0.001, 1, 0.001);
    this.cellMat.uniforms.uFurrow.value = 0;
    this.cellMat.uniforms.uStretch.value = 1;
  }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;
    this.cellMat.uniforms.uTime.value = time;
    this.field.update(time, dt);

    const condense = ramp(localT, PHASE.condense);
    const spindleT = ramp(localT, PHASE.spindle);
    const align = ramp(localT, PHASE.align);
    const separate = easeInOutCubic(ramp(localT, PHASE.separate));
    const reform = ramp(localT, PHASE.reform);
    const cleave = ramp(localT, PHASE.cleave);

    /* ── chromatin condenses into discrete chromosomes ────────────────── */
    this.chromatin.visible = condense < 0.995;
    if (this.chromatin.visible) {
      const s = 1 - condense * 0.55;
      this.chromatin.scale.setScalar(s);
      this.chromatin.userData.update?.(time);
      // the chromatin mesh dissolves as chromosomes appear
      this.chromatin.traverse((o) => {
        if (o.material?.uniforms?.uOpacity) o.material.uniforms.uOpacity.value = 0.30 * (1 - condense);
      });
    }

    /* ── the spindle assembles ────────────────────────────────────────── */
    const sp = clamp(spindleT);
    this.spindle.visible = sp > 0.01;
    if (this.spindle.visible) {
      this.spindle.scale.set(0.05 + 0.95 * sp, 0.4 + 0.6 * sp, 0.05 + 0.95 * sp);
      this.spindle.userData.update?.(time);
    }

    /* ── chromosomes: appear, migrate to the plate, then separate ─────── */
    // The spindle spans ±12 (height 24), so the chromatids travel from the
    // metaphase plate out to just inside the poles.
    const poleDist = 7.5 + separate * 4.0;
    for (let i = 0; i < this.chromosomes.length; i++) {
      const c = this.chromosomes[i];
      const appear = smoothstep(0.05 + i * 0.012, 0.30 + i * 0.012, condense + spindleT * 0.35);
      c.visible = appear > 0.01;
      if (!c.visible) continue;
      c.scale.setScalar(appear);

      const home = c.userData.home;
      const spread = 1 + separate * 0.55;
      const x = home.x * spread;
      const z = home.z * spread;

      // The chromosome group sits on the metaphase plate; each of its two
      // chromatids is then dragged toward its own pole during anaphase.
      c.position.set(x, 0, z);
      c.rotation.y = c.userData.ang + Math.PI / 2 + time * c.userData.spin * 0.4;
      c.rotation.z = c.userData.tilt + Math.sin(time * 0.5 + i) * 0.08;
      const pull = separate * poleDist;
      c.children.forEach((child, k) => {
        if (k < 2) {
          // the two sister chromatids: one to each pole
          const dir = k === 0 ? 1 : -1;
          child.position.y = dir * pull;
          // splay outward as they are pulled, so the arms trail behind
          child.rotation.z = dir * separate * 0.30;
          child.scale.setScalar(1 - separate * 0.12);
        }
      });
      // the centromere splits once the chromatids are under way
      if (c.children[2]) c.children[2].scale.setScalar(Math.max(0.001, 1 - separate * 1.6));
    }

    /* ── daughter nuclei re-form at the poles ────────────────────────── */
    const reformAmt = clamp(reform);
    for (let i = 0; i < this.daughters.length; i++) {
      const d = this.daughters[i];
      const s = Math.max(0.001, reformAmt);
      d.visible = reformAmt > 0.01;
      if (!d.visible) continue;
      d.scale.setScalar(s);
      const sign = i === 0 ? 1 : -1;
      d.position.set(0, sign * (poleDist + 0.5), 0);
      d.userData.update?.(time);
    }

    /* ── cytokinesis: the ring contracts ─────────────────────────────── */
    this.cellMat.uniforms.uFurrow.value = cleave * 0.96;
    this.cellMat.uniforms.uStretch.value = 1 + cleave * 0.30;
    if (cleave > 0.55 && !this._cleaveKicked) {
      this._cleaveKicked = true;
      app.rig.kick(0.5);
    }

    /* ── spindle traffic: particles streaming pole-ward ───────────────── */
    if (separate > 0.02 && separate < 0.98 && Math.random() < 0.8) {
      const c = this.chromosomes[(Math.random() * this.chromosomes.length) | 0];
      const sign = Math.random() < 0.5 ? 1 : -1;
      burst(this.traffic, 4, {
        x: c.position.x, y: 0, z: c.position.z,
        speed: 0.4, life: 1.1, size: 0.45, drag: 0.4, spread: 0.3, jitter: 0.5,
        color: [0.7, 0.55, 1.0],
      });
      for (let i = Math.max(0, this.traffic.count - 4); i < this.traffic.count; i++) {
        this.traffic.vy[i] += sign * 9.0;
      }
    }
    this.traffic.update(dt, (sys, i, d) => {
      // accelerate along the spindle axis and fade at the poles
      sys.vy[i] *= Math.exp(-0.4 * d);
      sys.vx[i] *= Math.exp(-1.6 * d);
      sys.vz[i] *= Math.exp(-1.6 * d);
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
      if (Math.abs(sys.py[i]) > 11) sys.life[i] = Math.min(sys.life[i], 0.15);
    });

    // the cytoplasm field squeezes with the furrow
    const pinch = 1 - cleave * 0.35;
    this.field.object.scale.set(pinch, 1 + cleave * 0.25, pinch);
  }
}
