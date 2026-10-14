// Custom HDR post-processing stack.
//
//   scene -> [HDR RT + depth]
//              |-> god rays   (radial scatter from a projected light)
//              |-> bloom      (threshold -> 5-level progressive downsample/upsample)
//              |-> dof blur   (half-res separable, CoC-weighted in the composite)
//              \-> composite  (CA, barrel, DOF mix, bloom, rays, ACES, grade, grain)
//
// Written from scratch (rather than importing three's examples/jsm chain) so the
// grade, the DOF model and the volumetric pass share one consistent colour pipeline.
import * as THREE from 'three';
import { FS_VERT, LOOK } from './glsl.js';

class FullScreenQuad {
  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, null);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target ?? null);
    renderer.render(this.scene, this.camera);
  }
  /** Draw with additive blending, preserving whatever is already in `target`. */
  renderAdditive(renderer, material, target) {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    material.blending = THREE.AdditiveBlending;
    material.transparent = true;
    material.needsUpdate = true;
    this.render(renderer, material, target);
    material.blending = THREE.NoBlending;
    material.transparent = false;
    material.needsUpdate = true;
    renderer.autoClear = prevAuto;
  }
  dispose() { this.geometry.dispose(); }
}

const DEPTH_UTIL = /* glsl */`
uniform float uNear;
uniform float uFar;
float viewZ(float d){
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
`;

const BLIT_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
void main(){ gl_FragColor = texture2D(tSrc, vUv); }
`;

/* ------------------------------------------------------------ bright pass */

const PREFILTER_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * contrib, vec3(uClamp)), 1.0);
}
`;

/* --------------------------------------------------------- down / upsample */

const DOWNSAMPLE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main(){
  // 13-tap Call-of-Duty style box filter: stable, no fireflies
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + vec2(-2.0,  2.0) * t).rgb;
  vec3 b = texture2D(tSrc, vUv + vec2( 0.0,  2.0) * t).rgb;
  vec3 c = texture2D(tSrc, vUv + vec2( 2.0,  2.0) * t).rgb;
  vec3 d = texture2D(tSrc, vUv + vec2(-2.0,  0.0) * t).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + vec2( 2.0,  0.0) * t).rgb;
  vec3 g = texture2D(tSrc, vUv + vec2(-2.0, -2.0) * t).rgb;
  vec3 h = texture2D(tSrc, vUv + vec2( 0.0, -2.0) * t).rgb;
  vec3 i = texture2D(tSrc, vUv + vec2( 2.0, -2.0) * t).rgb;
  vec3 j = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * t).rgb;
  vec3 k = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * t).rgb;
  vec3 l = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * t).rgb;
  vec3 m = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * t).rgb;
  vec3 o = e * 0.125;
  o += (a + c + g + i) * 0.03125;
  o += (b + d + f + h) * 0.0625;
  o += (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

const UPSAMPLE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uAnamorphic;
void main(){
  vec2 t = uTexel * uRadius;
  t.x *= uAnamorphic;                 // wider horizontal tent = anamorphic streak
  vec3 s = texture2D(tSrc, vUv + vec2(-t.x,  t.y)).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2( 0.0,  t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( t.x,  t.y)).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2(-t.x,  0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2( t.x,  0.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb * 1.0;
  s += texture2D(tSrc, vUv + vec2( 0.0, -t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( t.x, -t.y)).rgb * 1.0;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

/* --------------------------------------------------------------- god rays */

const RAYS_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2  uLight;      // light position in UV space
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uExposure;
uniform int   uSamples;
void main(){
  vec2 delta = (vUv - uLight) * (uDensity / float(uSamples));
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++){
    if (i >= uSamples) break;
    uv -= delta;
    vec3 s = texture2D(tSrc, clamp(uv, 0.0, 1.0)).rgb;
    acc += s * decay * uWeight;
    decay *= uDecay;
  }
  gl_FragColor = vec4(acc * uExposure / float(uSamples), 1.0);
}
`;

/* ---------------------------------------------------------------- dof blur */

const DOF_BLUR_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
void main(){
  // 9-tap ring + centre: cheap but smooth enough at half res
  vec2 d = uDir * uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 0.20;
  s += texture2D(tSrc, vUv + d * 1.0).rgb * 0.13;
  s += texture2D(tSrc, vUv - d * 1.0).rgb * 0.13;
  s += texture2D(tSrc, vUv + d * 2.2).rgb * 0.10;
  s += texture2D(tSrc, vUv - d * 2.2).rgb * 0.10;
  s += texture2D(tSrc, vUv + d * 3.6).rgb * 0.07;
  s += texture2D(tSrc, vUv - d * 3.6).rgb * 0.07;
  s += texture2D(tSrc, vUv + d * 5.2).rgb * 0.05;
  s += texture2D(tSrc, vUv - d * 5.2).rgb * 0.05;
  s += texture2D(tSrc, vUv + vec2(d.y, -d.x) * 3.0).rgb * 0.05;
  s += texture2D(tSrc, vUv - vec2(d.y, -d.x) * 3.0).rgb * 0.05;
  gl_FragColor = vec4(s, 1.0);
}
`;

/* --------------------------------------------------------------- composite */

const COMPOSITE_FRAG = /* glsl */`
${LOOK}
${DEPTH_UTIL}
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform sampler2D tDof;
uniform sampler2D tDepth;

uniform float uTime;
uniform vec2  uResolution;
uniform float uBloomStrength;
uniform float uRaysStrength;
uniform vec3  uRaysTint;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxBlur;
uniform float uChroma;
uniform float uBarrel;
uniform float uVignette;
uniform float uGrain;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3  uLift;
uniform vec3  uGain;
uniform float uFade;
uniform float uScan;

vec3 sampleScene(vec2 uv){
  // chromatic aberration scales with radius; strongest in the corners
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float amt = uChroma * r2;
  vec2 off = c * amt;
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;
  return col;
}

void main(){
  vec2 uv = vUv;

  // subtle barrel distortion before sampling
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + uBarrel * dot(cc, cc));

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 scene = sampleScene(uv);
  float d = texture2D(tDepth, uv).x;
  float vz = viewZ(d);

  // thin-lens circle of confusion, signed (negative = near field)
  float coc = clamp((vz - uFocus) / max(vz, 0.001) * uAperture, -1.0, 1.0);
  float blurAmt = clamp(abs(coc) * uMaxBlur, 0.0, 1.0);
  // keep the far background from smearing into mush
  blurAmt *= smoothstep(0.0, 0.35, blurAmt);
  vec3 dof = texture2D(tDof, uv).rgb;
  vec3 col = mix(scene, dof, blurAmt);

  // volumetric scatter + bloom
  vec3 rays = texture2D(tRays, uv).rgb * uRaysTint;
  vec3 bloom = texture2D(tBloom, uv).rgb;
  col += rays * uRaysStrength + bloom * uBloomStrength;

  // exposure + filmic tonemap
  col *= uExposure;
  col = aces(col);

  // grade: lift / gain, saturation, contrast around 0.5
  col = col * uGain + uLift * (1.0 - col);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // vignette
  vec2 vc = vUv - 0.5;
  float vig = 1.0 - uVignette * pow(clamp(dot(vc, vc) * 2.0, 0.0, 1.0), 1.35);
  col *= vig;

  // animated grain, luminance-weighted so highlights stay clean
  float g = fract(sin(dot(vUv * uResolution + uTime * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain * (1.0 - 0.7 * luma);

  // very light scan structure for a captured-through-glass feel
  col *= 1.0 - uScan * 0.5 * (0.5 + 0.5 * sin(vUv.y * uResolution.y * 3.14159));

  // fade to black for scene transitions
  col *= uFade;

  // linear -> sRGB (renderer output conversion is bypassed for ShaderMaterial)
  col = max(col, vec3(0.0));
  vec3 srgb = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  gl_FragColor = vec4(srgb, 1.0);
}
`;

/* ------------------------------------------------------------------- stack */

const LEVELS = 5;

export class PostStack {
  constructor(renderer, { width, height, quality = 1 } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.quad = new FullScreenQuad();
    this.width = width;
    this.height = height;

    const rtOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtOpts = rtOpts;

    this.sceneRT = new THREE.WebGLRenderTarget(width, height, {
      ...rtOpts,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
    });
    this.sceneRT.depthTexture.format = THREE.DepthFormat;
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.bloomRT = [];
    this.bloomTmp = [];
    for (let i = 0; i < LEVELS; i++) {
      const w = Math.max(1, width >> (i + 1));
      const h = Math.max(1, height >> (i + 1));
      this.bloomRT.push(new THREE.WebGLRenderTarget(w, h, rtOpts));
      this.bloomTmp.push(new THREE.WebGLRenderTarget(w, h, rtOpts));
    }

    const hw = Math.max(1, width >> 1), hh = Math.max(1, height >> 1);
    this.dofRT = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this.dofTmp = new THREE.WebGLRenderTarget(hw, hh, rtOpts);

    const qw = Math.max(1, width >> 2), qh = Math.max(1, height >> 2);
    this.raysRT = new THREE.WebGLRenderTarget(qw, qh, rtOpts);
    this.raysTmp = new THREE.WebGLRenderTarget(qw, qh, rtOpts);

    this._buildMaterials();
  }

  _buildMaterials() {
    const M = (frag, uniforms) => new THREE.ShaderMaterial({
      uniforms, vertexShader: FS_VERT, fragmentShader: frag,
      depthTest: false, depthWrite: false,
    });

    this.matBlit = M(BLIT_FRAG, { tSrc: { value: null } });

    this.matPrefilter = M(PREFILTER_FRAG, {
      tSrc: { value: null },
      uThreshold: { value: 0.72 },
      uKnee: { value: 0.42 },
      uClamp: { value: 24.0 },
    });

    this.matDown = M(DOWNSAMPLE_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
    });

    this.matUp = M(UPSAMPLE_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.15 },
      uAnamorphic: { value: 1.6 },
    });

    this.matRays = M(RAYS_FRAG, {
      tSrc: { value: null },
      uLight: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.82 },
      uDecay: { value: 0.955 },
      uWeight: { value: 0.42 },
      uExposure: { value: 0.62 },
      uSamples: { value: 40 },
    });

    this.matDof = M(DOF_BLUR_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
    });

    this.matComposite = M(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      tDof: { value: null },
      tDepth: { value: null },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uBloomStrength: { value: 0.55 },
      uRaysStrength: { value: 0.40 },
      uRaysTint: { value: new THREE.Color(0x8fd8ff) },
      uFocus: { value: 12 },
      uAperture: { value: 0.35 },
      uMaxBlur: { value: 1.0 },
      uChroma: { value: 0.0028 },
      uBarrel: { value: 0.045 },
      uVignette: { value: 0.82 },
      uGrain: { value: 0.016 },
      uExposure: { value: 0.95 },
      uSaturation: { value: 1.06 },
      uContrast: { value: 1.07 },
      uLift: { value: new THREE.Color(0.014, 0.026, 0.046) },
      uGain: { value: new THREE.Color(1.02, 1.0, 0.99) },
      uFade: { value: 1 },
      uScan: { value: 0.012 },
    });

    // One shared uniform object so callers can drive the look from the outside.
    this.u = this.matComposite.uniforms;
    this.uRays = this.matRays.uniforms;
    this.uPre = this.matPrefilter.uniforms;
    this.uUp = this.matUp.uniforms;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.sceneRT.setSize(width, height);
    if (this.sceneRT.depthTexture) {
      this.sceneRT.depthTexture.image.width = width;
      this.sceneRT.depthTexture.image.height = height;
      this.sceneRT.depthTexture.needsUpdate = true;
    }
    for (let i = 0; i < LEVELS; i++) {
      const w = Math.max(1, width >> (i + 1));
      const h = Math.max(1, height >> (i + 1));
      this.bloomRT[i].setSize(w, h);
      this.bloomTmp[i].setSize(w, h);
    }
    this.dofRT.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.dofTmp.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    this.raysRT.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.raysTmp.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.u.uResolution.value.set(width, height);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{lightScreen?: THREE.Vector3|null, raysStrength?: number, time?: number}} opts
   */
  render(scene, camera, opts = {}) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    // 1. scene into HDR target
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    const q = this.quad;
    const bw = this.width, bh = this.height;

    // 2. god rays at quarter res
    const raysOn = (opts.raysStrength ?? this.u.uRaysStrength.value) > 0.001;
    if (raysOn) {
      this.matPrefilter.uniforms.tSrc.value = this.sceneRT.texture;
      this.matPrefilter.uniforms.uThreshold.value = 0.72;
      this.matPrefilter.uniforms.uKnee.value = 0.7;
      q.render(r, this.matPrefilter, this.raysTmp);

      const L = opts.lightScreen;
      this.matRays.uniforms.tSrc.value = this.raysTmp.texture;
      if (L) this.matRays.uniforms.uLight.value.set(L.x, L.y);
      q.render(r, this.matRays, this.raysRT);
      this.matPrefilter.uniforms.uThreshold.value = 1.05;
      this.matPrefilter.uniforms.uKnee.value = 0.55;
    } else {
      r.setRenderTarget(this.raysRT);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
    }

    // 3. bloom: threshold then progressive downsample / additive tent upsample
    this.matPrefilter.uniforms.tSrc.value = this.sceneRT.texture;
    q.render(r, this.matPrefilter, this.bloomRT[0]);

    for (let i = 1; i < LEVELS; i++) {
      const src = this.bloomRT[i - 1];
      this.matDown.uniforms.tSrc.value = src.texture;
      this.matDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      q.render(r, this.matDown, this.bloomRT[i]);
    }

    // Each level is tent-upsampled and added into the level above it, so the
    // final bloomRT[0] carries the full multi-scale glow in one texture.
    for (let i = LEVELS - 1; i > 0; i--) {
      const src = this.bloomRT[i];
      this.matUp.uniforms.tSrc.value = src.texture;
      this.matUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      q.renderAdditive(r, this.matUp, this.bloomRT[i - 1]);
    }

    // 4. DOF: half-res separable blur of the scene
    this.matDof.uniforms.tSrc.value = this.sceneRT.texture;
    this.matDof.uniforms.uTexel.value.set(1 / this.dofTmp.width, 1 / this.dofTmp.height);
    this.matDof.uniforms.uDir.value.set(1, 0);
    q.render(r, this.matDof, this.dofTmp);
    this.matDof.uniforms.tSrc.value = this.dofTmp.texture;
    this.matDof.uniforms.uDir.value.set(0, 1);
    q.render(r, this.matDof, this.dofRT);

    // 5. composite to screen
    const u = this.u;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.bloomRT[0].texture;
    u.tRays.value = this.raysRT.texture;
    u.tDof.value = this.dofRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uTime.value = opts.time ?? 0;
    u.uResolution.value.set(bw, bh);
    if (opts.raysStrength !== undefined) u.uRaysStrength.value = opts.raysStrength;

    r.setRenderTarget(null);
    r.autoClear = prevAutoClear;
    q.render(r, this.matComposite, null);
  }

  dispose() {
    this.quad.dispose();
    this.sceneRT.dispose();
    this.sceneRT.depthTexture?.dispose();
    [...this.bloomRT, ...this.bloomTmp, this.dofRT, this.dofTmp, this.raysRT, this.raysTmp]
      .forEach(rt => rt.dispose());
    [this.matBlit, this.matPrefilter, this.matDown, this.matUp, this.matRays, this.matDof, this.matComposite]
      .forEach(m => m.dispose());
  }
}
