// Procedural organelle builders. Everything here is generated at runtime:
// no meshes are loaded, every structure is geometry + GLSL built from code.
import * as THREE from 'three';
import { COMMON } from './glsl.js';
import { shellMaterial, tissueMaterial, glassMaterial, flowLineMaterial, ADDITIVE } from './materials.js';
import { mulberry32, TAU } from './util.js';

/* ══════════════════════════════════════════════════════════════ geometry */

/**
 * Tube swept along a curve with a per-t radius function and optional surface
 * noise. Used for chromatin, chromosomes, microtubules and spindle fibres.
 * Adds `aFlow` (0..1 along the tube) so flow-line materials can animate it.
 *
 * `radiusFn(t)` is a *multiplier* on `radius` (returning ~0.5–1.5 tapers the
 * tube); it does not replace it. Every caller relies on this.
 */
export function makeTube(curve, {
  tubularSegments = 128,
  radialSegments = 8,
  radius = 0.1,
  radiusFn = null,
  noiseAmp = 0,
  noiseScale = 3,
  seed = 1,
  closed = false,
} = {}) {
  const frames = curve.computeFrenetFrames(tubularSegments, closed);
  const rnd = mulberry32(seed);
  const pos = [];
  const nor = [];
  const uv = [];
  const flow = [];
  const N = radialSegments + 1;

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const P = curve.getPointAt(closed ? t % 1 : t);
    const Nv = frames.normals[Math.min(i, tubularSegments - 1)];
    const Bv = frames.binormals[Math.min(i, tubularSegments - 1)];
    const baseR = radius * (radiusFn ? radiusFn(t) : 1);
    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const a = v * TAU;
      const sin = Math.sin(a), cos = -Math.cos(a);
      const nx = cos * Nv.x + sin * Bv.x;
      const ny = cos * Nv.y + sin * Bv.y;
      const nz = cos * Nv.z + sin * Bv.z;
      const nrm = Math.hypot(nx, ny, nz) || 1;
      const r = baseR * (noiseAmp > 0
        ? 1 + Math.sin(t * noiseScale * 7.3 + v * 5.1 + seed) * noiseAmp * 0.5
          + Math.sin(t * noiseScale * 2.1 - v * 3.3) * noiseAmp * 0.5
        : 1);
      pos.push(P.x + (nx / nrm) * r, P.y + (ny / nrm) * r, P.z + (nz / nrm) * r);
      nor.push(nx / nrm, ny / nrm, nz / nrm);
      uv.push(t, v);
      flow.push(t);
    }
  }

  const idx = [];
  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = N * (i - 1) + (j - 1);
      const b = N * i + (j - 1);
      const c = N * i + j;
      const d = N * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
  g.setIndex(idx);
  return g;
}

/** Random smooth closed-ish curve inside a sphere of radius `r`. */
export function tangledCurve(rnd, r, points = 9, wobble = 0.55) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * TAU;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const rr = r * (1 - wobble * rnd());
    pts.push(new THREE.Vector3(s * Math.cos(th) * rr, u * rr, s * Math.sin(th) * rr));
  }
  // A lower tension keeps the interpolated spine from overshooting into the
  // tight corners that make swept tubes look faceted.
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
}

/* ══════════════════════════════════════════════════════════════???nucleus */

export function makeNucleus({
  radius = 4.4,
  chromatin = 26,
  pores = 220,
  seed = 5,
  color = 0xff3d9a,
  envelopeColor = 0xff8ad0,
} = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);

  /* envelope: double membrane */
  const envGeo = new THREE.IcosahedronGeometry(radius, 24);
  const envMat = shellMaterial({
    color: envelopeColor, rim: 0xffd6f0, inner: 0x4a0a34,
    power: 2.3, intensity: 0.42, opacity: 0.085,
    noiseScale: 1.5, noiseAmp: 0.10, pulse: 0.10, timeScale: 0.10,
    emissive: 0.9,
  });
  const env = new THREE.Mesh(envGeo, envMat);
  g.add(env);

  const innerGeo = new THREE.IcosahedronGeometry(radius * 0.955, 20);
  const innerMat = shellMaterial({
    color: 0xff5fb4, rim: 0xffe0f4, inner: 0x2a0420,
    power: 3.0, intensity: 0.34, opacity: 0.055,
    noiseScale: 2.4, noiseAmp: 0.06, pulse: 0.06, timeScale: 0.14,
  });
  g.add(new THREE.Mesh(innerGeo, innerMat));

  /* chromatin: tangled fibres filling the interior */
  // Semi-transparent and well separated: overlapping opaque strands merge into
  // a single solid mass and the nucleus loses all interior depth.
  const chromMat = tissueMaterial({
    color: 0x5c0c38, rim: 0xff86cf, emissive: 0xff2f8f, emissiveStrength: 0.20,
    noiseScale: 6.0, relief: 0.0, timeScale: 0.25, rimPower: 2.0, rimGain: 0.30,
    opacity: 0.80,
  });
  const chromMat2 = tissueMaterial({
    color: 0x3d0a38, rim: 0xffb0e6, emissive: 0xd94fff, emissiveStrength: 0.16,
    noiseScale: 7.5, relief: 0.0, timeScale: 0.3, rimPower: 2.2, rimGain: 0.30,
    opacity: 0.80,
  });
  for (let i = 0; i < chromatin; i++) {
    const rr = radius * (0.34 + rnd() * 0.56);
    // More control points keep the spine smooth; a coarse Catmull-Rom with a
    // high tension produces sharp corners that the swept tube renders as
    // creased, ribbon-like facets.
    const curve = tangledCurve(rnd, rr, 10 + Math.floor(rnd() * 5), 0.45);
    const geo = makeTube(curve, {
      tubularSegments: 130, radialSegments: 10,
      radius: radius * (0.030 + rnd() * 0.028),
      radiusFn: (t) => 0.92 + 0.16 * Math.sin(t * 7.0 + i),
      noiseAmp: 0.10, seed: i + 1,
    });
    const m = new THREE.Mesh(geo, i % 3 === 0 ? chromMat2 : chromMat);
    g.add(m);
  }

  /* nucleolus: dense ribosomal factory */
  const nucleolus = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 0.30, 16),
    tissueMaterial({
      color: 0x2a0418, rim: 0xffa8d8, emissive: 0xff5fb0, emissiveStrength: 0.20,
      noiseScale: 5.0, relief: 0.22, timeScale: 0.35, pulse: 0.05, rimPower: 1.8, rimGain: 0.26,
    }),
  );
  nucleolus.position.set(radius * 0.30, -radius * 0.26, radius * 0.20);
  g.add(nucleolus);

  /* nuclear pore complexes on the envelope */
  const poreGeo = new THREE.TorusGeometry(radius * 0.042, radius * 0.013, 6, 16);
  const poreMat = new THREE.MeshBasicMaterial({
    color: 0xffd0ee, transparent: true, opacity: 0.17,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poreMesh = new THREE.InstancedMesh(poreGeo, poreMat, pores);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < pores; i++) {
    // Fibonacci sphere distribution
    const y = 1 - (i / (pores - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    nrm.set(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    dummy.position.copy(nrm).multiplyScalar(radius * 1.005);
    q.setFromUnitVectors(up, nrm);
    dummy.quaternion.copy(q);
    dummy.scale.setScalar(0.8 + rnd() * 0.6);
    dummy.updateMatrix();
    poreMesh.setMatrixAt(i, dummy.matrix);
  }
  poreMesh.instanceMatrix.needsUpdate = true;
  g.add(poreMesh);

  g.userData.materials = [envMat, innerMat, chromMat, chromMat2];
  g.userData.update = (t) => {
    g.rotation.y = t * 0.035;
    g.rotation.x = Math.sin(t * 0.12) * 0.05;
  };
  return g;
}

/* ════════════════════════════════════════════════════════???mitochondrion */

export function makeMitochondrion({
  length = 7.0,
  radius = 2.2,
  cristae = 16,
  seed = 21,
  hot = true,
} = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);

  /* outer membrane: elongated, gently undulating ellipsoid */
  const outerGeo = new THREE.IcosahedronGeometry(1, 28);
  outerGeo.scale(length * 0.5, radius, radius);
  const outerMat = shellMaterial({
    color: 0xffb347, rim: 0xfff0c0, inner: 0x5a2c00,
    power: 2.2, intensity: 0.44, opacity: 0.080,
    noiseScale: 2.0, noiseAmp: 0.055, pulse: 0.10, timeScale: 0.13,
    emissive: 0.85,
  });
  g.add(new THREE.Mesh(outerGeo, outerMat));

  /* inner membrane boundary, slightly smaller */
  const innerGeo = new THREE.IcosahedronGeometry(1, 22);
  innerGeo.scale(length * 0.47, radius * 0.90, radius * 0.90);
  const innerMat = shellMaterial({
    color: 0xff8a1f, rim: 0xffd79a, inner: 0x3a1a00,
    power: 2.8, intensity: 0.36, opacity: 0.062,
    noiseScale: 3.0, noiseAmp: 0.08, pulse: 0.06, timeScale: 0.16,
  });
  g.add(new THREE.Mesh(innerGeo, innerMat));

  /* cristae: flattened wavy shelves projecting inward from the inner membrane */
  const cristaMat = tissueMaterial({
    color: hot ? 0x8a3d00 : 0x1f4a55, rim: 0xffc477, emissive: 0xff8c1a,
    emissiveStrength: hot ? 0.28 : 0.15, noiseScale: 4.5, relief: 0.0, rimGain: 0.40,
    timeScale: 0.4, rimPower: 2.0,
  });
  const cristaGroup = new THREE.Group();
  for (let i = 0; i < cristae; i++) {
    const t = (i + 0.5) / cristae;
    const x = (t - 0.5) * length * 0.86;
    // radius of the envelope at this x (ellipsoid cross-section)
    const k = Math.max(0.18, Math.sqrt(Math.max(0, 1 - Math.pow((x / (length * 0.5)) * 0.98, 2))));
    const rr = radius * 0.92 * k;
    const major = rr * (0.30 + rnd() * 0.46);
    const geo = new THREE.TorusGeometry(major, Math.max(0.045, radius * 0.055), 7, 40);
    // squash into a shelf and ripple the rim so it reads as a folded membrane
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const vx = p.getX(v), vy = p.getY(v), vz = p.getZ(v);
      const ang = Math.atan2(vz, vx);
      const ripple = 1 + Math.sin(ang * 5 + i * 1.7) * 0.18;
      p.setXYZ(v, vx * ripple, vy * 0.34, vz * ripple);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, cristaMat);
    m.position.x = x;
    m.rotation.y = rnd() * 0.9 - 0.45;
    m.rotation.z = (rnd() - 0.5) * 0.35;
    cristaGroup.add(m);
  }
  g.add(cristaGroup);

  /* ATP synthase motors embedded in the cristae */
  const motors = 26;
  const stalkGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.26, 6);
  const headGeo = new THREE.IcosahedronGeometry(0.13, 1);
  const stalkMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false });
  const stalkMesh = new THREE.InstancedMesh(stalkGeo, stalkMat, motors);
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, motors);
  const motorData = [];
  for (let i = 0; i < motors; i++) {
    const t = rnd();
    const x = (t - 0.5) * length * 0.8;
    const k = Math.max(0.2, Math.sqrt(Math.max(0, 1 - Math.pow((x / (length * 0.5)) * 0.98, 2))));
    const rr = radius * 0.55 * k * (0.4 + rnd() * 0.55);
    const a = rnd() * TAU;
    motorData.push({
      base: new THREE.Vector3(x, Math.sin(a) * rr, Math.cos(a) * rr),
      axis: new THREE.Vector3(0, Math.sin(a), Math.cos(a)).normalize(),
      phase: rnd() * TAU,
      speed: 4.5 + rnd() * 3.5,
      scale: 0.75 + rnd() * 0.6,
    });
  }
  g.add(stalkMesh, headMesh);

  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);

  g.userData.materials = [outerMat, innerMat, cristaMat];
  g.userData.update = (t) => {
    for (let i = 0; i < motors; i++) {
      const d = motorData[i];
      q.setFromUnitVectors(up, d.axis);
      // the F1 head spins about the motor axis
      spin.setFromAxisAngle(axisY, t * d.speed + d.phase);
      dummy.position.copy(d.base).addScaledVector(d.axis, 0.16);
      dummy.quaternion.copy(q).multiply(spin);
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      stalkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.copy(d.base).addScaledVector(d.axis, 0.34);
      dummy.quaternion.copy(q).multiply(spin);
      dummy.scale.setScalar(d.scale * (1 + 0.10 * Math.sin(t * d.speed * 0.5 + d.phase)));
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
    }
    stalkMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    cristaGroup.rotation.x = Math.sin(t * 0.22) * 0.06;
  };
  return g;
}

/* ══════════════════════════════════════════════════════════════════???ER */

const ER_VERT = /* glsl */`
${COMMON}
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uSpeed;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vN;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  float n = fbm(vec3(p.xy * uFreq, uTime * uSpeed), 4, 2.1, 0.5);
  vN = n;
  p.z += n * uAmp;
  // gentle global undulation so the cisternae feel alive
  p.z += sin(p.x * 0.8 + uTime * 0.5) * uAmp * 0.35;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ER_FRAG = /* glsl */`
${COMMON}
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vN;
varying vec2 vUv;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewDir);
  float f = fresnel(N, V, 2.4, 0.02);
  // Lumen banding: the sheet reads as a flattened sac rather than a surface,
  // and the fresnel rim is kept low so stacked cisternae stay separable.
  float band = smoothstep(0.44, 0.5, abs(vUv.y - 0.5));
  vec3 col = uColor * (0.35 + 0.55 * (0.5 + 0.5 * vN));
  col += uRim * f * 0.55;
  col += uRim * band * 0.16;
  float a = uOpacity * (0.07 + 0.62 * f + band * 0.10);
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * Rough ER: stacked ruffled cisternae studded with ribosomes.
 */
export function makeERStack({
  count = 6,
  width = 9,
  height = 5,
  amp = 0.55,
  spread = 0.62,
  seed = 33,
  ribosomes = 420,
  color = 0x2affc0,
} = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    ...ADDITIVE,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: amp },
      uFreq: { value: 0.55 },
      uSpeed: { value: 0.16 },
      uColor: { value: new THREE.Color(0x0a3a30) },
      uRim: { value: new THREE.Color(color) },
      uOpacity: { value: 0.55 },
    },
    vertexShader: ER_VERT, fragmentShader: ER_FRAG,
  });

  const sheets = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    // Wide, shallow, closely stacked cisternae: the stack should read as a
    // layered organelle, not a cloud of separate sheets.
    const geo = new THREE.PlaneGeometry(width * (0.80 + 0.20 * (1 - t)), height * (0.85 + 0.15 * (1 - t)), 44, 30);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((rnd() - 0.5) * spread * 1.2, (t - 0.5) * spread * 2.2, (rnd() - 0.5) * spread * 0.7);
    m.rotation.set(
      Math.PI / 2 + (rnd() - 0.5) * 0.30,
      (rnd() - 0.5) * 0.30,
      (rnd() - 0.5) * 0.22,
    );
    sheets.add(m);
  }
  g.add(sheets);

  /* ribosomes bound to the cytosolic face */
  const riboGeo = new THREE.IcosahedronGeometry(0.085, 0);
  const riboMat = new THREE.MeshBasicMaterial({
    color: 0xbfffe8, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const riboMesh = new THREE.InstancedMesh(riboGeo, riboMat, ribosomes);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < ribosomes; i++) {
    dummy.position.set(
      (rnd() - 0.5) * width,
      (rnd() - 0.5) * spread * 2.9,
      (rnd() - 0.5) * height * 0.85,
    );
    dummy.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
    dummy.scale.setScalar(0.7 + rnd() * 0.9);
    dummy.updateMatrix();
    riboMesh.setMatrixAt(i, dummy.matrix);
  }
  riboMesh.instanceMatrix.needsUpdate = true;
  g.add(riboMesh);

  g.userData.materials = [mat];
  g.userData.update = (t) => {
    sheets.rotation.y = Math.sin(t * 0.16) * 0.09;
    sheets.rotation.z = Math.cos(t * 0.13) * 0.05;
  };
  return g;
}

/* ════════════════════════════════════════════════════════════════ Golgi */

export function makeGolgiStack({
  cisternae = 6,
  radius = 2.6,
  seed = 44,
  color = 0x2affc0,
} = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);

  const mat = tissueMaterial({
    color: 0x0a4a44, rim: 0x7dffe0, emissive: 0x1fd8a8, emissiveStrength: 0.38,
    noiseScale: 3.4, relief: 0.03, timeScale: 0.22, rimPower: 2.0, rimGain: 0.45, pulse: 0.02,
  });

  for (let i = 0; i < cisternae; i++) {
    const t = i / (cisternae - 1);
    const r = radius * (0.95 - 0.42 * t);
    // a flattened, slightly ruffled sac
    const geo = new THREE.IcosahedronGeometry(1, 20);
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const ang = Math.atan2(z, x);
      const rr = 1 + Math.sin(ang * 6 + i * 0.9) * 0.09;
      p.setXYZ(v, x * rr, y * 0.17, z * rr);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(r, r, r);
    m.position.y = (0.5 - t) * cisternae * 0.34;
    m.rotation.y = rnd() * 0.4;
    m.rotation.z = (rnd() - 0.5) * 0.10;
    g.add(m);
  }

  /* budding vesicles around the trans face */
  const vesMat = glassMaterial({ color: 0x7dffe0, ior: 0.06, power: 3.0, opacity: 0.55, emissive: 0.9, thickness: 0.5 });
  const vesicles = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU;
    const rr = radius * (0.9 + rnd() * 0.6);
    const v = new THREE.Mesh(new THREE.IcosahedronGeometry(0.10 + rnd() * 0.16, 2), vesMat);
    v.position.set(Math.cos(a) * rr, -cisternae * 0.30 - rnd() * 1.5, Math.sin(a) * rr);
    v.userData.phase = rnd() * TAU;
    v.userData.base = v.position.clone();
    vesicles.add(v);
  }
  g.add(vesicles);

  g.userData.materials = [mat, vesMat];
  g.userData.update = (t) => {
    g.rotation.y = t * 0.06;
    vesicles.children.forEach((v) => {
      v.position.y = v.userData.base.y - ((t * 0.45 + v.userData.phase) % 1.8);
      v.position.x = v.userData.base.x + Math.sin(t * 0.7 + v.userData.phase) * 0.25;
    });
  };
  return g;
}

/* ══════════════════════════════════════════════════════════════???vesicle */

export function makeVesicle({ radius = 0.5, color = 0x7dffe0, cargo = 0xffffff, seed = 1 } = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 4),
    glassMaterial({ color, ior: 0.07, power: 3.2, opacity: 0.5, emissive: 1.0, thickness: 0.6 }),
  );
  g.add(shell);
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 0.42, 2),
    new THREE.MeshBasicMaterial({ color: cargo, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  g.add(core);
  g.userData.update = (t) => { core.scale.setScalar(1 + 0.12 * Math.sin(t * 2.4 + seed)); };
  return g;
}

/* ══════════════════════════════════════════════════════════ cytoskeleton */

export function makeMicrotubules({ count = 16, radius = 9, seed = 77, color = 0x5ef3ff } = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const mat = flowLineMaterial({
    color, hot: 0xffffff, speed: 0.35, dashScale: 3.0, intensity: 0.55, opacity: 0.35,
  });
  for (let i = 0; i < count; i++) {
    const pts = [];
    const n = 5;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const rr = radius * (0.15 + 0.85 * t);
      const u = rnd() * 2 - 1, th = rnd() * TAU;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      pts.push(new THREE.Vector3(s * Math.cos(th) * rr, u * rr * 0.7, s * Math.sin(th) * rr));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo = makeTube(curve, { tubularSegments: 70, radialSegments: 4, radius: 0.035, seed: i });
    g.add(new THREE.Mesh(geo, mat));
  }
  g.userData.materials = [mat];
  return g;
}

/* ══════════════════════════════════════════════════════ plasma membrane */

const LIPID_VERT = /* glsl */`
${COMMON}
uniform float uTime;
uniform float uWave;
uniform float uWaveScale;
uniform float uLayer;      // +1 outer leaflet, -1 inner leaflet
uniform float uRelief;
attribute float aSeed;
attribute float aTilt;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vSeed;
varying float vRipple;
void main(){
  vSeed = aSeed;
  // instance origin in object space
  vec3 iOrigin = instanceMatrix[3].xyz;
  float w = fbm(vec3(iOrigin.xz * uWaveScale, uTime * 0.20), 3, 2.1, 0.5);
  float w2 = sin(iOrigin.x * 0.85 + uTime * 0.75) * 0.5
           + sin(iOrigin.z * 1.05 - uTime * 0.62) * 0.5;
  float ripple = w * 0.85 + w2 * 0.30;
  vRipple = ripple;

  // per-lipid jitter keeps the bilayer fluid rather than crystalline
  vec3 jitter = vec3(
    sin(uTime * 0.9 + aSeed * 61.0),
    sin(uTime * 1.3 + aSeed * 37.0),
    cos(uTime * 1.1 + aSeed * 53.0)) * uRelief;

  vec4 local = instanceMatrix * vec4(position, 1.0);
  local.xyz += jitter;
  local.y += ripple * uWave;
  local.y += uLayer * ripple * uWave * 0.18;

  vec4 wp = modelMatrix * local;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LIPID_FRAG = /* glsl */`
${COMMON}
uniform vec3 uColor;
uniform vec3 uRim;
uniform vec3 uTail;
uniform float uOpacity;
uniform float uIsHead;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vSeed;
varying float vRipple;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewDir);
  float f = fresnel(N, V, 2.2, 0.03);
  vec3 base = mix(uTail, uColor, uIsHead);
  vec3 col = base * (0.45 + 0.75 * clamp(dot(N, normalize(vec3(0.35, 0.9, 0.4))), 0.0, 1.0));
  col += uRim * pow(f, 2.0) * (uIsHead > 0.5 ? 1.5 : 0.45);
  // hydrophobic core reads darker and denser
  col *= mix(0.55, 1.15, uIsHead);
  col += uRim * 0.06 * (0.5 + 0.5 * vRipple);
  float a = uOpacity * (uIsHead > 0.5 ? (0.30 + 0.85 * f) : (0.14 + 0.35 * f));
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * The fluid-mosaic bilayer: two leaflets of phospholipids on a hexagonal
 * lattice, undulating together under a shared noise field.
 */
export function makeMembraneField({
  extent = 13,
  spacing = 0.62,
  leafletGap = 0.55,
  tailLength = 0.95,
  seed = 91,
  color = 0x37e0ff,
} = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);

  // hexagonal lattice positions
  const sites = [];
  const nx = Math.ceil(extent / spacing);
  for (let i = -nx; i <= nx; i++) {
    for (let j = -nx; j <= nx; j++) {
      const x = i * spacing + (j % 2 ? spacing * 0.5 : 0);
      const z = j * spacing * 0.866;
      if (Math.hypot(x, z) > extent) continue;
      sites.push([x + (rnd() - 0.5) * spacing * 0.18, z + (rnd() - 0.5) * spacing * 0.18]);
    }
  }
  const count = sites.length;

  const mkMaterial = (isHead) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    ...ADDITIVE,
    uniforms: {
      uTime: { value: 0 },
      uWave: { value: 0.55 },
      uWaveScale: { value: 0.10 },
      uLayer: { value: 1 },
      uRelief: { value: 0.035 },
      uColor: { value: new THREE.Color(color) },
      uRim: { value: new THREE.Color(0xcdf6ff) },
      uTail: { value: new THREE.Color(0x0d4a66) },
      uOpacity: { value: isHead ? 0.95 : 0.8 },
      uIsHead: { value: isHead ? 1 : 0 },
    },
    vertexShader: LIPID_VERT, fragmentShader: LIPID_FRAG,
  });

  const headMat = mkMaterial(true);
  const tailMat = mkMaterial(false);

  const headGeo = new THREE.IcosahedronGeometry(0.155, 1);
  const tailGeo = new THREE.CylinderGeometry(0.036, 0.028, tailLength, 4, 1, true);
  tailGeo.translate(0, -tailLength * 0.5, 0);

  const heads = new THREE.InstancedMesh(headGeo, headMat, count * 2);
  const tails = new THREE.InstancedMesh(tailGeo, tailMat, count * 2);

  const aSeed = new Float32Array(count * 2);
  const dummy = new THREE.Object3D();
  let k = 0;
  for (const [x, z] of sites) {
    for (const layer of [1, -1]) {
      aSeed[k] = rnd();
      dummy.position.set(x, layer * leafletGap, z);
      dummy.rotation.set((rnd() - 0.5) * 0.25, rnd() * TAU, (rnd() - 0.5) * 0.25);
      dummy.scale.setScalar(0.85 + rnd() * 0.35);
      dummy.updateMatrix();
      heads.setMatrixAt(k, dummy.matrix);
      // tails hang from the head toward the hydrophobic core
      dummy.position.set(x, layer * (leafletGap - 0.12), z);
      dummy.rotation.set((rnd() - 0.5) * 0.22, rnd() * TAU, (rnd() - 0.5) * 0.22);
      dummy.updateMatrix();
      tails.setMatrixAt(k, dummy.matrix);
      k++;
    }
  }
  heads.instanceMatrix.needsUpdate = true;
  tails.instanceMatrix.needsUpdate = true;
  headGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  tailGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed.slice(), 1));
  headGeo.setAttribute('aTilt', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 1));
  tailGeo.setAttribute('aTilt', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 1));

  g.add(heads, tails);

  g.userData.headMat = headMat;
  g.userData.tailMat = tailMat;
  g.userData.count = count * 2;
  g.userData.materials = [headMat, tailMat];
  g.userData.update = (t) => {
    headMat.uniforms.uTime.value = t;
    tailMat.uniforms.uTime.value = t;
  };
  return g;
}

/** A few integral membrane proteins floating in the bilayer. */
export function makeMembraneProteins({ count = 7, extent = 9, seed = 5, color = 0x8b5cf6 } = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const mat = tissueMaterial({
    color: 0x2a1a5a, rim: 0xc9a8ff, emissive: 0x8b5cf6, emissiveStrength: 0.42,
    noiseScale: 3.0, relief: 0.02, timeScale: 0.3, rimPower: 2.0, rimGain: 0.40, pulse: 0.03,
  });
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, rr = extent * (0.25 + rnd() * 0.6);
    const barrel = new THREE.Group();
    // a bundled alpha-helix barrel
    const helices = 5;
    for (let h = 0; h < helices; h++) {
      const ang = (h / helices) * TAU;
      const tube = makeTube(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(Math.cos(ang) * 0.28, -1.05, Math.sin(ang) * 0.28),
          new THREE.Vector3(Math.cos(ang) * 0.34, 0, Math.sin(ang) * 0.34),
          new THREE.Vector3(Math.cos(ang) * 0.28, 1.05, Math.sin(ang) * 0.28),
        ]),
        { tubularSegments: 26, radialSegments: 5, radius: 0.085, noiseAmp: 0.12, seed: h },
      );
      barrel.add(new THREE.Mesh(tube, mat));
    }
    // the globular cap that sticks out of the membrane
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 3), mat);
    cap.position.y = 1.25;
    cap.scale.set(1, 0.72, 1);
    barrel.add(cap);
    barrel.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    barrel.rotation.y = rnd() * TAU;
    barrel.rotation.z = (rnd() - 0.5) * 0.25;
    barrel.scale.setScalar(0.8 + rnd() * 0.6);
    barrel.userData.phase = rnd() * TAU;
    barrel.userData.baseY = 0;
    g.add(barrel);
  }
  g.userData.materials = [mat];
  g.userData.update = (t) => {
    g.children.forEach((c) => {
      c.position.y = Math.sin(t * 0.6 + c.userData.phase) * 0.22;
      c.rotation.y += 0.0015;
    });
  };
  return g;
}

/* ══════════════════════════════════════════════════════════ chromosomes */

/**
 * One chromatid: a tapered rod running corner-to-corner through the centromere.
 * Two of these crossed at the origin form the classic X of a metaphase
 * chromosome, and they stay readable when pulled apart along the spindle axis.
 */
export function makeChromatid({
  length = 3.4, radius = 0.30, seed = 3, dir = [1, 1], bow = 0.18,
} = {}) {
  const rnd = mulberry32(seed);
  const h = length * 0.5;
  const [dx, dy] = dir;
  const pts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = (t - 0.5) * 2;                 // -1 .. 1 along the rod
    // gentle bow so the arms curve like real chromatin rather than a stick
    const off = (1 - u * u) * bow * (dx * dy);
    pts.push(new THREE.Vector3(
      u * h * dx + off * dy * 0.6,
      u * h * dy - off * dx * 0.6,
      (rnd() - 0.5) * length * 0.10 + Math.sin(u * 3.1) * bow * 0.5,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return makeTube(curve, {
    tubularSegments: 84, radialSegments: 10,
    radius,
    // pinched at the centromere (centre), fuller toward the arms
    radiusFn: (t) => 0.55 + 0.60 * Math.abs(Math.cos(t * Math.PI)) + 0.25 * Math.sin(t * Math.PI),
    noiseAmp: 0.22, noiseScale: 3.4, seed,
  });
}

export function makeChromosome({ seed = 3, color = 0x8b5cf6, scale = 1 } = {}) {
  const g = new THREE.Group();
  const mat = tissueMaterial({
    color: 0x2a1050, rim: 0xc4a4ff, emissive: color, emissiveStrength: 0.34,
    noiseScale: 5.0, relief: 0.0, timeScale: 0.35, rimPower: 1.9, rimGain: 0.40, pulse: 0.02,
  });
  const rnd = mulberry32(seed);
  // two chromatids crossing at the centromere
  const dirs = [[1, 1], [-1, 1]];
  for (let i = 0; i < 2; i++) {
    const geo = makeChromatid({
      length: 3.4 * scale, radius: 0.29 * scale,
      seed: seed + i * 37, dir: dirs[i],
      bow: 0.16 + rnd() * 0.12,
    });
    g.add(new THREE.Mesh(geo, mat));
  }
  // centromere: the constriction where sister chromatids are held together
  const cent = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.30 * scale, 3),
    tissueMaterial({
      color: 0x4a1060, rim: 0xffd0ff, emissive: 0xff5fd0, emissiveStrength: 0.40,
      noiseScale: 4.0, relief: 0.05, timeScale: 0.5, rimPower: 2.0, rimGain: 0.35,
    }),
  );
  cent.scale.set(1.35, 0.55, 1.35);
  g.add(cent);
  g.userData.materials = [mat];
  return g;
}

/* ══════════════════════════════════════════════════════════════???spindle */

export function makeSpindle({ count = 44, height = 15, spread = 5.5, seed = 13, color = 0x8b5cf6 } = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  const mat = flowLineMaterial({
    color, hot: 0xffffff, speed: 0.55, dashScale: 4.0, intensity: 0.8, opacity: 0.5,
  });
  const top = new THREE.Vector3(0, height * 0.5, 0);
  const bottom = new THREE.Vector3(0, -height * 0.5, 0);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rnd() * 0.3;
    const rr = spread * (0.35 + rnd() * 0.75);
    const equator = new THREE.Vector3(Math.cos(a) * rr, (rnd() - 0.5) * 0.6, Math.sin(a) * rr);
    const fromTop = i % 2 === 0;
    const curve = new THREE.CatmullRomCurve3(fromTop
      ? [top.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)), equator.clone().lerp(top, 0.45), equator]
      : [bottom.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)), equator.clone().lerp(bottom, 0.45), equator]);
    const geo = makeTube(curve, { tubularSegments: 40, radialSegments: 3, radius: 0.022, seed: i });
    g.add(new THREE.Mesh(geo, mat));
  }
  // the two centrosomes
  const cMat = tissueMaterial({
    color: 0x2a1a5a, rim: 0xd0b8ff, emissive: 0x9d7bff, emissiveStrength: 0.55,
    noiseScale: 6.0, relief: 0.06, timeScale: 0.6, rimPower: 2.2,
  });
  for (const s of [1, -1]) {
    const c = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const t = makeTube(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.6, 0, 0), new THREE.Vector3(0, 0.12 * (i ? 1 : -1), 0), new THREE.Vector3(0.6, 0, 0),
        ]),
        { tubularSegments: 20, radialSegments: 6, radius: 0.10, seed: i },
      );
      const m = new THREE.Mesh(t, cMat);
      m.rotation.z = i ? 0.5 : -0.5;
      c.add(m);
    }
    c.position.y = s * height * 0.5;
    c.scale.setScalar(1.4);
    g.add(c);
  }
  g.userData.materials = [mat, cMat];
  g.userData.update = (t) => { g.rotation.y = t * 0.10; };
  return g;
}

/* ════════════════════════════════════════════════════════════???ribosome */

export function makeRibosome({ color = 0xbfffe8 } = {}) {
  const g = new THREE.Group();
  const large = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.30, 2),
    tissueMaterial({
      color: 0x0d4a44, rim: color, emissive: 0x2affc0, emissiveStrength: 0.45,
      noiseScale: 5.0, relief: 0.06, timeScale: 0.6, rimPower: 2.2,
    }),
  );
  large.scale.set(1, 0.85, 1);
  const small = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.20, 2),
    tissueMaterial({
      color: 0x0d3a4a, rim: 0xa8f0ff, emissive: 0x5ef3ff, emissiveStrength: 0.42,
      noiseScale: 6.0, relief: 0.06, timeScale: 0.7, rimPower: 2.2,
    }),
  );
  small.position.y = 0.28;
  g.add(large, small);
  g.userData.update = (t) => { small.position.y = 0.28 + Math.sin(t * 1.8) * 0.05; };
  return g;
}
