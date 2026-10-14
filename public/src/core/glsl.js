// Hand-written GLSL building blocks: gradient noise, fbm, curl flow, SDF helpers,
// fresnel / thin-film, and the shared "look" functions used by every scene.

export const NOISE = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

// Ashima / Gustavson simplex noise (public domain).
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p, int oct, float lac, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * snoise(p);
    n += a;
    p *= lac;
    a *= gain;
  }
  return s / max(n, 1e-4);
}

// Divergence-free flow: curl of an fbm potential field.
vec3 curlNoise(vec3 p, float eps){
  float n1 = snoise(vec3(p.x, p.y + eps, p.z));
  float n2 = snoise(vec3(p.x, p.y - eps, p.z));
  float n3 = snoise(vec3(p.x, p.y, p.z + eps));
  float n4 = snoise(vec3(p.x, p.y, p.z - eps));
  float n5 = snoise(vec3(p.x + eps, p.y, p.z));
  float n6 = snoise(vec3(p.x - eps, p.y, p.z));
  vec3 dx = vec3(n3 - n4, n1 - n2, n5 - n6) / (2.0 * eps);
  float m1 = snoise(vec3(p.x, p.y + eps, p.z + 31.7));
  float m2 = snoise(vec3(p.x, p.y - eps, p.z + 31.7));
  float m3 = snoise(vec3(p.x, p.y + 17.3, p.z + eps));
  float m4 = snoise(vec3(p.x, p.y + 17.3, p.z - eps));
  float m5 = snoise(vec3(p.x + eps, p.y + 17.3, p.z));
  float m6 = snoise(vec3(p.x - eps, p.y + 17.3, p.z));
  vec3 dy = vec3(m3 - m4, m1 - m2, m5 - m6) / (2.0 * eps);
  return normalize(cross(dy, dx) + 1e-6);
}

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash31(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
`;

export const SDF = /* glsl */`
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdTorus(vec3 p, vec2 t){
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

export const LOOK = /* glsl */`
// Filmic-ish tonemap used inside individual passes when we want self-lit particles
// to keep their punch before the final ACES composite.
vec3 tonemapFilmic(vec3 x){
  const float A = 0.22, B = 0.30, C = 0.10, D = 0.20, E = 0.01, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Schlick fresnel with a rim bias, tuned for thin translucent shells.
float fresnel(vec3 n, vec3 v, float power, float bias){
  return clamp(bias + (1.0 - bias) * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), power), 0.0, 1.0);
}

// Iridescence: cheap thin-film approximation from view angle + thickness.
vec3 thinFilm(float cosTheta, float thickness, float ior){
  float d = thickness * (1.0 - cosTheta) * ior;
  vec3 wl = vec3(0.0, 2.094, 4.188);
  vec3 phase = wl + d * 12.566;
  return 0.5 + 0.5 * cos(phase);
}

// Hue-shifted emission ramp: keeps highlights from clipping to white mush.
vec3 emissionRamp(float t, vec3 cold, vec3 mid, vec3 hot){
  vec3 c = mix(cold, mid, smoothstep(0.0, 0.55, t));
  return mix(c, hot, smoothstep(0.5, 1.0, t));
}
`;

export const COMMON = NOISE + SDF + LOOK;

/** Vertex-shader snippet for a full-screen triangle-strip quad (post passes). */
export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FS_VERT_NDC = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
