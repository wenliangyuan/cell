// 04 · 蛋白流水线 — ribosome → rough ER → Golgi → secretory vesicle.
// A single continuous "conveyor": each polypeptide is handed from station to
// station, so the chapter reads as one flowing process rather than four props.
import * as THREE from 'three';
import { Scene } from '../core/scene.js';
import { FieldPoints, ParticleSystem, burst } from '../core/particles.js';
import { tissueMaterial, flowLineMaterial } from '../core/materials.js';
import { makeERStack, makeGolgiStack, makeRibosome, makeVesicle, makeTube } from '../core/builders.js';
import { mulberry32, smoothstep } from '../core/util.js';

/** Station positions along the pipeline (x increases downstream). */
const STATIONS = {
  ribosome: new THREE.Vector3(-12.5, 2.4, 0),
  er: new THREE.Vector3(-6.2, 1.2, 0.5),
  golgi: new THREE.Vector3(3.4, 1.0, 0),
  vesicle: new THREE.Vector3(11.0, -1.4, 1.2),
};

export class ProteinScene extends Scene {
  constructor() {
    super('protein');
  }

  build() {
    const rnd = mulberry32(616);

    /* ── station 1: free ribosomes translating mRNA ────────────────────── */
    this.ribosomeStation = new THREE.Group();
    this.ribosomeStation.position.copy(STATIONS.ribosome);
    const ribo = makeRibosome({ color: 0xbfffe8 });
    ribo.scale.setScalar(1.5);
    this.ribosomeStation.add(ribo);
    this.scene.add(this.ribosomeStation);

    // the mRNA strand threaded through the ribosome
    const mrnaPts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      mrnaPts.push(new THREE.Vector3((t - 0.5) * 5.0, Math.sin(t * 6) * 0.35, Math.cos(t * 5) * 0.35));
    }
    this.mrnaCurve = new THREE.CatmullRomCurve3(mrnaPts, false, 'catmullrom', 0.5);
    const mrnaMat = flowLineMaterial({
      color: 0xffd166, hot: 0xffffff, speed: 1.1, dashScale: 8.0, intensity: 1.4, opacity: 0.95,
    });
    this.timed(mrnaMat);
    const mrnaGeo = makeTube(this.mrnaCurve, { tubularSegments: 120, radialSegments: 4, radius: 0.045 });
    this.ribosomeStation.add(new THREE.Mesh(mrnaGeo, mrnaMat));

    /* ── station 2: rough ER ───────────────────────────────────────────── */
    this.er = makeERStack({ count: 6, width: 9.5, height: 6.0, amp: 0.62, spread: 0.8, seed: 33, ribosomes: 520 });
    this.er.position.copy(STATIONS.er);
    this.er.rotation.set(0.30, 0.55, 0.12);
    this.er.scale.setScalar(0.92);
    this.scene.add(this.er);

    /* ── station 3: Golgi ──────────────────────────────────────────────── */
    this.golgi = makeGolgiStack({ cisternae: 7, radius: 3.0, seed: 44 });
    this.golgi.position.copy(STATIONS.golgi);
    this.golgi.rotation.set(-0.25, 0.35, 0.18);
    this.golgi.scale.setScalar(1.05);
    this.scene.add(this.golgi);

    /* ── station 4: secretory vesicle at the membrane ──────────────────── */
    this.exitVesicle = makeVesicle({ radius: 1.5, color: 0x7dffe0, cargo: 0xffffff, seed: 9 });
    this.exitVesicle.position.copy(STATIONS.vesicle);
    this.scene.add(this.exitVesicle);

    // the membrane the vesicle will fuse with: a curved, rim-lit patch rather
    // than a flat card, so it reads as the cell surface seen from inside
    const memGeo = new THREE.SphereGeometry(26, 48, 32, Math.PI * 0.28, Math.PI * 0.44, Math.PI * 0.22, Math.PI * 0.56);
    const memMat = tissueMaterial({
      color: 0x03151f, rim: 0x37e0ff, emissive: 0x0a3a52, emissiveStrength: 0.40,
      noiseScale: 2.4, relief: 0.5, timeScale: 0.15, rimPower: 3.4, rimGain: 0.30, opacity: 0.34,
    });
    this.timed(memMat);
    this.exitMembrane = new THREE.Mesh(memGeo, memMat);
    // push the patch out to the right so its concave face wraps the exit
    this.exitMembrane.rotation.y = -Math.PI / 2;
    this.exitMembrane.position.set(39.5, -1.0, 0);
    this.scene.add(this.exitMembrane);

    /* ── the conveyor: polypeptides travelling station to station ──────── */
    this.conveyor = new ParticleSystem({ capacity: 3000, sizeScale: 1.0 });
    this.scene.add(this.conveyor.object);

    // discrete cargo: folded proteins riding visible paths
    this.cargo = [];
    const cargoMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 + rnd() * 0.07, 2), cargoMat);
      c.userData.t = rnd();
      c.userData.speed = 0.055 + rnd() * 0.05;
      c.userData.lane = (rnd() - 0.5) * 3.2;
      c.userData.leg = 0;
      this.scene.add(c);
      this.cargo.push(c);
    }

    /* ── ambient cytoplasm ─────────────────────────────────────────────── */
    this.field = new FieldPoints({
      count: 3800, inner: 6, outer: 24, size: 11,
      turbulence: 0.8, flowScale: 0.09, flowSpeed: 0.05, swirl: 0.015,
      tintA: 0x2affc0, tintB: 0x5ef3ff, tintMix: 0.9, opacity: 0.24, hot: 0.18, seed: 88,
    });
    this.scene.add(this.field.object);

    /* ── route legs, one per station hop ───────────────────────────────── */
    this.legs = [
      this._leg(STATIONS.ribosome, STATIONS.er, 1.6, 0.5),
      this._leg(STATIONS.er, STATIONS.golgi, 2.2, -0.4),
      this._leg(STATIONS.golgi, STATIONS.vesicle, 1.8, 0.6),
    ];

    this.lightPos = new THREE.Vector3(-4, 14, 9);
    this._t = 0;
    this._pulseTimer = 0;
  }

  /** A gentle arc from a to b, used as the cargo's travel path. */
  _leg(a, b, arc, side) {
    const mid = a.clone().lerp(b, 0.5);
    mid.y += arc;
    mid.z += side;
    return new THREE.CatmullRomCurve3([
      a.clone(), a.clone().lerp(mid, 0.5), mid, mid.clone().lerp(b, 0.5), b.clone(),
    ], false, 'catmullrom', 0.5);
  }

  particleCount() { return 3800 + this.conveyor.count; }

  lightScreen(camera) {
    const v = this.lightPos.clone().project(camera);
    return new THREE.Vector2(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  }

  markerFade(localT) {
    return smoothstep(0.04, 0.14, localT) * (1 - smoothstep(0.90, 0.99, localT));
  }

  reset() { this.conveyor.clear(); }

  update(dt, time, localT, app) {
    super.update(dt, time, localT, app);
    this._t = time;

    this.field.update(time, dt);
    this.er.userData.update?.(time);
    this.golgi.userData.update?.(time);
    this.exitVesicle.userData.update?.(time);
    this.ribosomeStation.children[0].userData?.update?.(time);

    /* ── ribosome breathing + mRNA feed ──────────────────────────────── */
    this.ribosomeStation.rotation.y = Math.sin(time * 0.3) * 0.25;
    this.ribosomeStation.position.y = STATIONS.ribosome.y + Math.sin(time * 0.8) * 0.14;

    /* ── translation bursts at the ribosome ──────────────────────────── */
    this._pulseTimer -= dt;
    if (this._pulseTimer <= 0) {
      this._pulseTimer = 0.16;
      burst(this.conveyor, 4, {
        x: STATIONS.ribosome.x + 0.4, y: STATIONS.ribosome.y, z: STATIONS.ribosome.z,
        speed: 0.5, life: 1.4, size: 0.5, drag: 0.8, spread: 0.5, jitter: 0.4,
        color: [0.7, 1.0, 0.88],
      });
    }

    /* ── cargo riding the pipeline ───────────────────────────────────── */
    for (const c of this.cargo) {
      c.userData.t += dt * c.userData.speed;
      if (c.userData.t >= 1) {
        c.userData.t -= 1;
        c.userData.leg = (c.userData.leg + 1) % this.legs.length;
        // hand-off puff: the cargo changes compartment
        const at = this.legs[c.userData.leg].getPointAt(0);
        burst(this.conveyor, 12, {
          x: at.x, y: at.y, z: at.z,
          speed: 1.8, life: 0.9, size: 0.55, drag: 1.3,
          color: c.userData.leg === 2 ? [1.0, 0.85, 0.45] : [0.5, 1.0, 0.9],
        });
        if (c.userData.leg === 0) {
          // released from the ER: a vesicle pinches off
          burst(this.conveyor, 20, {
            x: STATIONS.er.x + 1.5, y: STATIONS.er.y - 1.0, z: STATIONS.er.z,
            speed: 2.4, life: 1.2, size: 0.6, drag: 1.0,
            color: [0.6, 1.0, 0.95],
          });
        }
      }
      const leg = this.legs[c.userData.leg];
      const p = c.userData.t;
      const pos = leg.getPointAt(p);
      c.position.copy(pos);
      // spread the cargo laterally so they do not overlap on the path
      c.position.y += c.userData.lane * 0.25 * Math.sin(p * Math.PI);
      c.position.z += c.userData.lane * 0.30 * Math.sin(p * Math.PI);
      c.rotation.set(time * 0.6, time * 0.9, time * 0.4);
      const s = 0.85 + 0.35 * Math.sin(time * 3 + c.userData.t * 10);
      c.scale.setScalar(s);
    }

    this.conveyor.update(dt, (sys, i, d) => {
      // a mild drift toward the downstream (+x) direction
      sys.vx[i] += 0.35 * d;
      sys.vy[i] += (Math.random() - 0.5) * 1.2 * d;
      sys.vz[i] += (Math.random() - 0.5) * 1.2 * d;
      const dr = Math.exp(-sys.drag[i] * d);
      sys.vx[i] *= dr; sys.vy[i] *= dr; sys.vz[i] *= dr;
      sys.px[i] += sys.vx[i] * d;
      sys.py[i] += sys.vy[i] * d;
      sys.pz[i] += sys.vz[i] * d;
    });

    /* ── the exit vesicle swells and finally fuses ───────────────────── */
    const fuseCycle = (time * 0.16) % 1;
    const swell = 1 + smoothstep(0.0, 0.85, fuseCycle) * 0.35;
    this.exitVesicle.scale.setScalar(swell);
    this.exitVesicle.position.x = STATIONS.vesicle.x + smoothstep(0.2, 0.95, fuseCycle) * 2.6;
    if (fuseCycle > 0.95 && !this._fused) {
      this._fused = true;
      burst(this.conveyor, 60, {
        x: this.exitVesicle.position.x, y: this.exitVesicle.position.y, z: this.exitVesicle.position.z,
        speed: 3.2, life: 1.4, size: 0.7, drag: 1.1,
        color: [1.0, 0.95, 0.7],
      });
      app.rig.kick(0.35);
    } else if (fuseCycle < 0.2) {
      this._fused = false;
    }

    // the exit membrane ripples
    this.exitMembrane.rotation.z = Math.sin(time * 0.4) * 0.03;
  }
}
