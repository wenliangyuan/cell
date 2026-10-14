// Small math / easing / palette helpers shared across the whole piece.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp(invLerp(e0, e1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const pulse = (t, freq = 1, phase = 0) => 0.5 + 0.5 * Math.sin(t * freq * TAU + phase);
/** Frame-rate independent exponential approach. */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutQuint = t => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
export const easeOutBack = (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Deterministic PRNG so every reload composes the same organism. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bioluminescent-abyss palette. Values are linear-ish sRGB hex. */
export const PALETTE = {
  void0: 0x02030a,
  void1: 0x060b1c,
  plasma: 0x5ef3ff,   // structural cyan
  membrane: 0x37e0ff,
  cytoplasm: 0x2affc0, // living green
  nucleus: 0xff3d9a,   // nuclear magenta
  chromatin: 0xff7ad9,
  energy: 0xffb347,    // ATP amber
  energyHot: 0xffe28a,
  violet: 0x8b5cf6,
  bone: 0xeaf6ff,
};

export const cssVar = (name, fallback = '#fff') =>
  (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** hex -> THREE-free [r,g,b] in 0..1 */
export function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Cheap value noise on CPU (for camera drift / organic wobble). */
export function makeNoise1D(seed = 1) {
  const rnd = mulberry32(seed);
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = rnd() * 2 - 1;
  return (x) => {
    const i = Math.floor(x), f = x - i;
    const a = table[((i % 256) + 256) % 256];
    const b = table[(((i + 1) % 256) + 256) % 256];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

/** Format helpers for the HUD. */
export const pad2 = n => String(Math.floor(n)).padStart(2, '0');
export const fmtTime = s => `${pad2(s / 60)}:${pad2(s % 60)}`;
