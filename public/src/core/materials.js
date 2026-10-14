// Shared ShaderMaterial library: every surface in the piece is one of these
// procedural looks, so the whole film reads as one material language.
//
// Two rules keep the image cinematic rather than a milky additive soup:
//   1. Emissive/translucent materials premultiply colour by alpha and blend
//      with (One, One) — see ADDITIVE below.
//   2. Every material applies exponential distance fog, so the far side of a
//      structure sinks into the dark and the frame gains depth.
import * as THREE from 'three';
import { COMMON } from './glsl.js';

/**
 * Additive blending for shaders that ALREADY premultiply colour by alpha.
 *
 * three's AdditiveBlending is (SrcAlpha, One), which multiplies alpha in a
 * second time and squares the falloff — with a low-opacity shell that collapses
 * to black. Every emissive material here writes `vec4(col * a, a)`, so the
 * correct blend is (One, One).
 */
export const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
};

/** Shared GLSL: exponential-squared fog driven by camera distance. */
const FOG_PARS = /* glsl */`
uniform float uFogDensity;
uniform float uFogFloor;
`;

const FOG_VERT = /* glsl */`
  float _dist = length(cameraPosition - wp.xyz);
  vFog = uFogFloor + (1.0 - uFogFloor) * exp(-_dist * _dist * uFogDensity * uFogDensity);
`;

const FOG_VARY = 'varying float vFog;';

const FOG_DEFAULTS = { uFogDensity: { value: 0.016 }, uFogFloor: { value: 0.05 } };

/* ═══════════════════════════════════════════════════ translucent shells */

/** Transparent volumetric-ish shell: fresnel rim, noise relief, inner glow. */
export function shellMaterial({
  color = 0x5ef3ff,
  rim = 0x9ff8ff,
  inner = 0x0a4a66,
  power = 2.6,
  intensity = 0.5,
  opacity = 0.12,
  noiseScale = 1.4,
  noiseAmp = 0.35,
  timeScale = 0.12,
  pulse = 0.18,
  emissive = 0.55,
  fresnelBias = 0.02,
  fog = 0.016,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...ADDITIVE,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uRim: { value: new THREE.Color(rim) },
      uInner: { value: new THREE.Color(inner) },
      uPower: { value: power },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uNoiseScale: { value: noiseScale },
      uNoiseAmp: { value: noiseAmp },
      uTimeScale: { value: timeScale },
      uPulse: { value: pulse },
      uEmissive: { value: emissive },
      uFresnelBias: { value: fresnelBias },
      ...FOG_DEFAULTS,
      uFogDensity: { value: fog },
    },
    vertexShader: /* glsl */`
      ${COMMON}
      ${FOG_PARS}
      uniform float uTime;
      uniform float uNoiseScale;
      uniform float uNoiseAmp;
      uniform float uTimeScale;
      uniform float uPulse;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vPos;
      varying float vNoise;
      varying float vWave;
      ${FOG_VARY}

      void main(){
        vec3 p = position;
        float t = uTime * uTimeScale;
        float n = fbm(normalize(position) * uNoiseScale + vec3(0.0, t, t * 0.7), 4, 2.07, 0.5);
        vNoise = n;
        // travelling membrane wave
        vWave = sin(position.y * 2.4 + uTime * 1.35 + n * 3.0) * 0.5 + 0.5;
        p += normal * (n * uNoiseAmp + (vWave - 0.5) * uPulse);

        vPos = p;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        ${FOG_VERT}
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      ${COMMON}
      uniform vec3 uColor;
      uniform vec3 uRim;
      uniform vec3 uInner;
      uniform float uPower;
      uniform float uIntensity;
      uniform float uOpacity;
      uniform float uEmissive;
      uniform float uFresnelBias;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vPos;
      varying float vNoise;
      varying float vWave;
      ${FOG_VARY}

      void main(){
        float f = fresnel(normalize(vNormalW), normalize(vViewDir), uPower, uFresnelBias);
        // thickness illusion: grazing angles read as denser material
        vec3 col = mix(uInner, uColor, f);
        col = mix(col, uRim, pow(f, 3.0));
        float n = 0.5 + 0.5 * vNoise;
        col *= 0.55 + 0.75 * n;
        col += uRim * pow(vWave, 6.0) * 0.20;
        float a = uOpacity * (0.22 + 0.95 * f) * (0.7 + 0.5 * n) * vFog;
        gl_FragColor = vec4(col * uIntensity * uEmissive * a, a);
      }
    `,
  });
}

/** Solid organic body: wrapped noise shading with rim light and subsurface warmth. */
export function tissueMaterial({
  color = 0x0d3b4d,
  rim = 0x5ef3ff,
  emissive = 0x0a2a3a,
  emissiveStrength = 0.35,
  noiseScale = 2.2,
  relief = 0.06,
  timeScale = 0.1,
  opacity = 1.0,
  pulse = 0.0,
  rimPower = 2.4,
  rimGain = 0.85,
  fog = 0.016,
} = {}) {
  const opaque = opacity >= 1.0;
  return new THREE.ShaderMaterial({
    transparent: !opaque,
    depthWrite: opaque,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uRim: { value: new THREE.Color(rim) },
      uEmissive: { value: new THREE.Color(emissive) },
      uEmissiveStrength: { value: emissiveStrength },
      uNoiseScale: { value: noiseScale },
      uRelief: { value: relief },
      uTimeScale: { value: timeScale },
      uOpacity: { value: opacity },
      uPulse: { value: pulse },
      uRimPower: { value: rimPower },
      uRimGain: { value: rimGain },
      ...FOG_DEFAULTS,
      uFogDensity: { value: fog },
    },
    vertexShader: /* glsl */`
      ${COMMON}
      ${FOG_PARS}
      uniform float uTime;
      uniform float uNoiseScale;
      uniform float uRelief;
      uniform float uTimeScale;
      uniform float uPulse;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      varying float vNoise;
      varying float vPulse;
      ${FOG_VARY}

      void main(){
        vec3 dir = normalize(position + 1e-5);
        float t = uTime * uTimeScale;
        float n = fbm(dir * uNoiseScale + vec3(t * 0.8, t, -t * 0.6), 4, 2.13, 0.5);
        vNoise = n;
        vPulse = sin(uTime * 0.9 + n * 2.4) * 0.5 + 0.5;
        vec3 p = position + normal * (n * uRelief + vPulse * uPulse);
        vLocal = p;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        ${FOG_VERT}
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      ${COMMON}
      uniform vec3 uColor;
      uniform vec3 uRim;
      uniform vec3 uEmissive;
      uniform float uEmissiveStrength;
      uniform float uOpacity;
      uniform float uRimPower;
      uniform float uRimGain;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      varying float vNoise;
      varying float vPulse;
      ${FOG_VARY}

      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDir);
        float f = fresnel(N, V, uRimPower, 0.02);
        // two-sided wrap lighting keeps the form readable without a real light rig
        float key = clamp(dot(N, normalize(vec3(0.4, 0.75, 0.5))) * 0.5 + 0.5, 0.0, 1.0);
        float fill = clamp(dot(N, normalize(vec3(-0.6, -0.3, -0.6))) * 0.5 + 0.5, 0.0, 1.0);

        vec3 col = uColor * (0.30 + 0.95 * key * key);
        col += uEmissive * uEmissiveStrength * (0.35 + 0.65 * vPulse) * (0.4 + 0.6 * key);
        col += uRim * pow(f, 2.2) * uRimGain;
        col *= 0.78 + 0.42 * (0.5 + 0.5 * vNoise);
        col += uRim * fill * 0.05;      // fake subsurface bleed

        gl_FragColor = vec4(col * mix(vFog, 1.0, 0.35), uOpacity);
      }
    `,
  });
}

/** Emissive membrane / filament line renderer with animated dash flow. */
export function flowLineMaterial({
  color = 0x5ef3ff,
  hot = 0xffffff,
  speed = 1.0,
  dashScale = 6.0,
  intensity = 1.4,
  opacity = 0.9,
  fog = 0.016,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    ...ADDITIVE,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uHot: { value: new THREE.Color(hot) },
      uSpeed: { value: speed },
      uDashScale: { value: dashScale },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      ...FOG_DEFAULTS,
      uFogDensity: { value: fog },
    },
    vertexShader: /* glsl */`
      ${FOG_PARS}
      uniform float uTime;
      uniform float uSpeed;
      attribute float aFlow;
      varying float vFlow;
      varying float vViewDir;
      ${FOG_VARY}
      void main(){
        vFlow = aFlow;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vViewDir = 1.0;
        ${FOG_VERT}
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uDashScale;
      uniform float uIntensity;
      uniform float uOpacity;
      varying float vFlow;
      varying float vViewDir;
      ${FOG_VARY}
      void main(){
        float phase = fract(vFlow * uDashScale - uTime * uSpeed);
        float pulse = pow(1.0 - abs(phase * 2.0 - 1.0), 3.5);
        vec3 col = mix(uColor, uHot, pow(pulse, 2.0));
        float a = uOpacity * (0.12 + 0.95 * pulse) * vFog;
        gl_FragColor = vec4(col * uIntensity * a, a);
      }
    `,
  });
}

/** Refractive glass shell used for vesicles / nuclei (thin-film iridescence). */
export function glassMaterial({
  color = 0x9fe9ff,
  ior = 0.055,
  power = 3.0,
  opacity = 0.22,
  emissive = 0.5,
  thickness = 0.4,
  fog = 0.016,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    ...ADDITIVE,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uIor: { value: ior },
      uPower: { value: power },
      uOpacity: { value: opacity },
      uEmissive: { value: emissive },
      uThickness: { value: thickness },
      ...FOG_DEFAULTS,
      uFogDensity: { value: fog },
    },
    vertexShader: /* glsl */`
      ${COMMON}
      ${FOG_PARS}
      uniform float uTime;
      uniform float uThickness;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      varying float vNoise;
      ${FOG_VARY}
      void main(){
        float n = fbm(normalize(position) * 3.1 + vec3(0.0, uTime * 0.12, 0.0), 3, 2.1, 0.5);
        vNoise = n;
        vec3 p = position + normal * n * uThickness * 0.12;
        vLocal = p;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        ${FOG_VERT}
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      ${COMMON}
      uniform vec3 uColor;
      uniform float uIor;
      uniform float uPower;
      uniform float uOpacity;
      uniform float uEmissive;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      varying float vNoise;
      ${FOG_VARY}
      void main(){
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDir);
        float f = fresnel(N, V, uPower, 0.015);
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        // thin-film interference across the shell thickness
        vec3 iri = thinFilm(cosT, 0.55 + vNoise * 0.25, 1.34);
        vec3 col = mix(uColor, uColor * iri * 1.6, 0.55);
        col += uColor * pow(f, 2.5) * 1.3;
        float a = uOpacity * (0.10 + 0.95 * f) * (0.8 + 0.4 * vNoise) * vFog;
        gl_FragColor = vec4(col * uEmissive * a, a);
      }
    `,
  });
}

/** Keep a set of materials' uTime uniforms in sync with the global clock. */
export function bindTime(materials, clock) {
  const list = materials.filter(Boolean);
  return {
    update(t) { for (const m of list) if (m.uniforms?.uTime) m.uniforms.uTime.value = t; },
  };
}
