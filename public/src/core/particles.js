// Two particle engines:
//  - FieldPoints : fully GPU-driven analytic motion (huge counts, zero CPU cost)
//  - ParticleSystem : pooled CPU simulation with lifetimes (event-driven bursts)
import * as THREE from 'three';
import { COMMON } from './glsl.js';
import { ADDITIVE } from './materials.js';
import { mulberry32 } from './util.js';

/* ------------------------------------------------------------------ sprites */

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.82)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.26)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.055)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  _glowTex.needsUpdate = true;
  return _glowTex;
}

let _sparkTex = null;
export function sparkTexture() {
  if (_sparkTex) return _sparkTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  // four-point anamorphic star + soft core
  const core = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.16);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.beginPath(); g.arc(0, 0, s * 0.16, 0, Math.PI * 2); g.fill();
  for (let k = 0; k < 2; k++) {
    g.save();
    g.rotate(k * Math.PI / 2);
    const lg = g.createLinearGradient(-s / 2, 0, s / 2, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-s / 2, -1.1, s, 2.2);
    g.restore();
  }
  _sparkTex = new THREE.CanvasTexture(c);
  _sparkTex.colorSpace = THREE.SRGBColorSpace;
  return _sparkTex;
}

/* ------------------------------------------------------- GPU field points */

const FIELD_VERT = /* glsl */`
${COMMON}
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform float uTurbulence;
uniform float uFlowScale;
uniform float uFlowSpeed;
uniform float uInner;
uniform float uOuter;
uniform float uBreathe;
uniform float uSwirl;
uniform vec3  uTintA;
uniform vec3  uTintB;
uniform float uTintMix;
uniform float uOpacity;
uniform float uFogDensity;
attribute float aSeed;
attribute float aScale;
attribute float aBand;
varying vec3  vColor;
varying float vAlpha;
varying float vSeed;

void main(){
  vec3 p = position;
  float r = length(p);
  vec3 dir = p / max(r, 1e-4);

  // organic breathing of the whole body
  float br = 1.0 + uBreathe * 0.06 * sin(uTime * 0.55 + r * 0.7);

  // divergence-free drift so motes never collapse into clumps
  vec3 flow = curlNoise(p * uFlowScale + vec3(0.0, uTime * uFlowSpeed, uTime * uFlowSpeed * 0.6), 0.35);
  p += flow * uTurbulence * (0.35 + aScale);

  // slow global swirl around Y, stronger near the core
  float ang = uTime * uSwirl * (1.4 - clamp(r / max(uOuter, 1e-3), 0.0, 1.0));
  p.xz = rot2(ang) * p.xz;

  // keep the shell alive: wrap particles that escape back toward the band
  float rr = length(p);
  float shell = mix(uInner, uOuter, aBand);
  p = mix(p, dir * shell, smoothstep(0.55, 1.0, abs(rr - shell) / max(shell, 1e-3)) * 0.85) * br;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = -mv.z;
  gl_PointSize = uSize * aScale * uPixelRatio * (11.0 / max(dist, 0.35));

  float fog = exp(-dist * dist * uFogDensity * uFogDensity);
  float twinkle = 0.62 + 0.38 * sin(uTime * (1.3 + aSeed * 3.4) + aSeed * 41.0);
  vAlpha = uOpacity * twinkle * smoothstep(0.0, 0.35, aBand) * (0.06 + 0.94 * fog);
  vColor = mix(uTintA, uTintB, clamp(aBand * uTintMix + aSeed * 0.22, 0.0, 1.0));
  vSeed = aSeed;
}
`;

const FIELD_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uTime;
uniform float uHot;
varying vec3  vColor;
varying float vAlpha;
varying float vSeed;

void main(){
  vec2 uv = gl_PointCoord;
  vec4 tex = texture2D(uMap, uv);
  float a = tex.a * vAlpha;
  if (a < 0.003) discard;
  float core = pow(tex.a, 2.6);
  vec3 col = vColor + vec3(core) * uHot;
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * Large ambient mote field. Motion is entirely analytic in the vertex shader:
 * CPU cost is one uniform update per frame regardless of particle count.
 */
export class FieldPoints {
  constructor({
    count = 12000,
    inner = 2.0,
    outer = 12.0,
    size = 22,
    turbulence = 0.55,
    flowScale = 0.11,
    flowSpeed = 0.055,
    swirl = 0.035,
    breathe = 1.0,
    tintA = 0x2affc0,
    tintB = 0x5ef3ff,
    tintMix = 1.0,
    opacity = 0.9,
    hot = 0.35,
    seed = 7,
    map = null,
  } = {}) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const aSeed = new Float32Array(count);
    const aScale = new Float32Array(count);
    const aBand = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // uniform direction, radius biased toward the shell
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const band = Math.pow(rnd(), 0.65);
      const r = inner + (outer - inner) * band + (rnd() - 0.5) * (outer - inner) * 0.14;
      pos[i * 3 + 0] = s * Math.cos(th) * r;
      pos[i * 3 + 1] = u * r * 0.86;
      pos[i * 3 + 2] = s * Math.sin(th) * r;
      aSeed[i] = rnd();
      aScale[i] = 0.35 + Math.pow(rnd(), 2.2) * 1.5;
      aBand[i] = band;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(aScale, 1));
    geo.setAttribute('aBand', new THREE.BufferAttribute(aBand, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 2.2);

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: size },
      uPixelRatio: { value: Math.min(devicePixelRatio || 1, 2) },
      uTurbulence: { value: turbulence },
      uFlowScale: { value: flowScale },
      uFlowSpeed: { value: flowSpeed },
      uSwirl: { value: swirl },
      uInner: { value: inner },
      uOuter: { value: outer },
      uBreathe: { value: breathe },
      uTintA: { value: new THREE.Color(tintA) },
      uTintB: { value: new THREE.Color(tintB) },
      uTintMix: { value: tintMix },
      uOpacity: { value: opacity },
      uHot: { value: hot },
      uFogDensity: { value: 0.014 },
      uMap: { value: map ?? glowTexture() },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      ...ADDITIVE,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.object = this.points;
  }

  update(t, dt) {
    this.uniforms.uTime.value = t;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

/* ------------------------------------------------- pooled CPU particle sim */

const SYS_VERT = /* glsl */`
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uFogDensity;
uniform sampler2D uMap;
attribute float aSize;
attribute float aLife;   // 0..1 remaining
attribute vec3  aColor;
attribute float aSeed;
varying vec3  vColor;
varying float vLife;
varying float vSeed;

void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = aSize * uSizeScale * uPixelRatio * (13.0 / max(dist, 0.3)) * (0.35 + 0.65 * aLife);
  float fog = exp(-dist * dist * uFogDensity * uFogDensity);
  vColor = aColor * (0.10 + 0.90 * fog);
  vLife = aLife;
  vSeed = aSeed;
}
`;

const SYS_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec3  vColor;
varying float vLife;
varying float vSeed;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  // soft round sprite without a texture fetch dependency on alpha edges
  float core = smoothstep(0.5, 0.0, d);
  float a = core * core * vLife;
  if (a < 0.004) discard;
  vec3 col = vColor * (0.6 + 1.9 * pow(core, 3.0));
  gl_FragColor = vec4(col * a, a);
}
`;

export class ParticleSystem {
  /**
   * @param {object} o
   * @param {number} o.capacity   hard cap on simultaneous particles
   * @param {'additive'|'normal'} o.blending
   */
  constructor({ capacity = 6000, blending = 'additive', sizeScale = 1 } = {}) {
    this.capacity = capacity;
    // Live particles occupy [0, count). Slots at index >= count are free and are
    // recycled by the next spawn, so no free list needs maintaining.
    this.count = 0;

    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.cr = f(); this.cg = f(); this.cb = f();
    this.size = f(); this.life = f(); this.maxLife = f(); this.seed = f();
    this.drag = f(); this.grav = f();

    const geo = new THREE.BufferGeometry();
    this.rPos = new Float32Array(capacity * 3);
    this.rCol = new Float32Array(capacity * 3);
    this.rSize = new Float32Array(capacity);
    this.rLife = new Float32Array(capacity);
    this.rSeed = new Float32Array(capacity);

    geo.setAttribute('position', new THREE.BufferAttribute(this.rPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.rCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.rSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.rLife, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.rSeed, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo = geo;

    this.uniforms = {
      uPixelRatio: { value: Math.min(devicePixelRatio || 1, 2) },
      uSizeScale: { value: sizeScale },
      uFogDensity: { value: 0.013 },
      uMap: { value: glowTexture() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SYS_VERT,
      fragmentShader: SYS_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      ...(blending === 'additive' ? ADDITIVE : { blending: THREE.NormalBlending }),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.object = this.points;
    this._rnd = mulberry32(1337);
  }

  /** Allocate one particle. Returns its index, or -1 when the pool is exhausted. */
  spawn({
    x = 0, y = 0, z = 0,
    vx = 0, vy = 0, vz = 0,
    color = [1, 1, 1],
    size = 1, life = 1, drag = 0.6, gravity = 0,
  } = {}) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.cr[i] = color[0]; this.cg[i] = color[1]; this.cb[i] = color[2];
    this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag; this.grav[i] = gravity;
    this.seed[i] = this._rnd();
    return i;
  }

  /** Copy slot `from` onto slot `to` (used by swap-compaction). */
  _move(to, from) {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.cr[to] = this.cr[from]; this.cg[to] = this.cg[from]; this.cb[to] = this.cb[from];
    this.size[to] = this.size[from]; this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from]; this.seed[to] = this.seed[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }

  /**
   * Advance the simulation and repack the pool.
   * `behavior(sys, i, dt)` integrates one live particle in place.
   */
  update(dt, behavior) {
    for (let i = 0; i < this.count; i++) {
      if (behavior) behavior(this, i, dt);
      this.life[i] -= dt;
    }
    // swap-compact: drop dead particles without disturbing the free tail
    let n = this.count;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) { this._move(i, n); i--; }
      }
    }
    this.count = n;

    // write render buffers
    const rp = this.rPos, rc = this.rCol, rs = this.rSize, rl = this.rLife, rd = this.rSeed;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      rp[i3] = this.px[i]; rp[i3 + 1] = this.py[i]; rp[i3 + 2] = this.pz[i];
      rc[i3] = this.cr[i]; rc[i3 + 1] = this.cg[i]; rc[i3 + 2] = this.cb[i];
      rs[i] = this.size[i];
      const l = this.maxLife[i] > 0 ? this.life[i] / this.maxLife[i] : 0;
      rl[i] = l * l * (3 - 2 * l);
      rd[i] = this.seed[i];
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSeed.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() { this.geo.dispose(); this.points.material.dispose(); }
}

/** Emit `n` particles from a point with a spherical velocity distribution. */
export function burst(sys, n, {
  x = 0, y = 0, z = 0, speed = 1, spread = 1, color = [1, 1, 1],
  size = 1, life = 1, drag = 1.2, gravity = 0, jitter = 0, sizeJitter = 0.5,
} = {}) {
  const rnd = sys._rnd;
  for (let k = 0; k < n; k++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const sp = speed * (0.35 + rnd() * 0.9);
    sys.spawn({
      x: x + (rnd() - 0.5) * jitter,
      y: y + (rnd() - 0.5) * jitter,
      z: z + (rnd() - 0.5) * jitter,
      vx: s * Math.cos(th) * sp * spread,
      vy: u * sp * spread,
      vz: s * Math.sin(th) * sp * spread,
      color,
      size: size * (1 - sizeJitter * 0.5 + rnd() * sizeJitter),
      life: life * (0.55 + rnd() * 0.8),
      drag, gravity,
    });
  }
}
