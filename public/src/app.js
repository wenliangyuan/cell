// Application shell: renderer, clock, scene switching, input, post stack.
import * as THREE from 'three';
import { PostStack } from './core/post.js';
import { CameraRig } from './core/camera.js';
import { HUD } from './core/ui.js';
import { SCENES, SCENE_STARTS, TOTAL_DURATION, sceneAt } from './content.js';
import { clamp, damp } from './core/util.js';

const FADE_TIME = 0.85;   // seconds of black between chapters

export class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.time = 0;

    /* ── renderer ─────────────────────────────────────────────────────── */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // the post stack handles edges; MSAA on an HDR target is wasteful
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.autoClear = true;
    // We render into linear HDR targets and do our own sRGB conversion in the
    // composite pass, so three's automatic output conversion must stay off.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.resScale = 1.0;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.rig = new CameraRig(this.camera);

    this.post = new PostStack(this.renderer, { width: 1, height: 1 });

    /* ── state ────────────────────────────────────────────────────────── */
    this.scenes = [];
    this.activeScene = -1;
    this.globalTime = SCENE_STARTS[0] + 0.001;
    this.playing = true;
    this.transition = 0;            // 1 = fully black
    this.pendingScene = -1;
    this.ready = false;
    this.paused = false;

    this.fps = 60;
    this._fpsAcc = 0; this._fpsFrames = 0;

    this.hud = new HUD(this);

    this._bindInput();
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.resize();

    // Expose a tiny control surface for automated verification.
    window.__cell = {
      app: this,
      ready: false,
      goto: (i) => this.goToScene(i, { play: true, instant: true }),
      seek: (t) => this.seekGlobal(t),
      pause: () => { this.playing = false; },
      play: () => { this.playing = true; },
      info: () => ({
        scene: SCENES[this.activeScene]?.id ?? null,
        sceneIndex: this.activeScene,
        time: +this.globalTime.toFixed(2),
        playing: this.playing,
        fps: +this.fps.toFixed(1),
        particles: this.particleCount(),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        programs: this.renderer.info.programs?.length ?? 0,
        resScale: +this.resScale.toFixed(2),
        size: [this.width, this.height],
      }),
    };
  }

  /* ══════════════════════════════════════════════════════════ scene graph */

  register(scene) {
    this.scenes.push(scene);
    return scene;
  }

  particleCount() {
    let n = 0;
    for (const s of this.scenes) n += s.particleCount?.() ?? 0;
    return n;
  }

  /* ══════════════════════════════════════════════════════════════ lifecycle */

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h;
    const pr = this.maxPixelRatio * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const bw = Math.floor(w * pr), bh = Math.floor(h * pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(bw, bh);
  }

  _bindInput() {
    const el = this.canvas;
    let down = false, lx = 0, ly = 0;
    this.pointer = { x: 0, y: 0 };

    // Track live pointers so a two-finger pinch can drive the dolly — phones
    // have no wheel event, which is the only zoom on desktop.
    const touches = new Map();
    let pinchDist = 0;

    el.addEventListener('pointerdown', (e) => {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = true; lx = e.clientX; ly = e.clientY;
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('is-dragging');
      this.hud.hideHint();
      if (touches.size === 2) pinchDist = this._pinchSpan(touches);
    });
    el.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = el.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);

      if (touches.size === 2) {
        // pinch to dolly; suppress the orbit while two fingers are down
        const span = this._pinchSpan(touches);
        if (pinchDist > 0 && span > 0) {
          this.zoom = clamp((this.zoom ?? 1) * (pinchDist / span), 0.45, 2.4);
        }
        pinchDist = span;
        lx = e.clientX; ly = e.clientY;
        this.rig.setPointer(this.pointer.x, this.pointer.y);
        return;
      }

      if (down) {
        const dx = (e.clientX - lx) / r.width;
        const dy = (e.clientY - ly) / r.height;
        lx = e.clientX; ly = e.clientY;
        this.orbitYaw = (this.orbitYaw ?? 0) - dx * 2.4;
        this.orbitPitch = clamp((this.orbitPitch ?? 0) - dy * 1.6, -0.9, 0.9);
      }
      this.rig.setPointer(this.pointer.x, this.pointer.y);
    });
    const up = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinchDist = 0;
      down = touches.size > 0;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (!down) document.body.classList.remove('is-dragging');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp((this.zoom ?? 1) * (1 + Math.sign(e.deltaY) * 0.075), 0.45, 2.4);
    }, { passive: false });
    // stop iOS from rubber-banding / double-tap zooming the page
    el.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    el.addEventListener('gesturestart', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (e.code === 'ArrowRight') this.goToScene((this.activeScene + 1) % SCENES.length, { play: true });
      else if (e.code === 'ArrowLeft') this.goToScene((this.activeScene - 1 + SCENES.length) % SCENES.length, { play: true });
      else if (e.code === 'KeyR') { this.seekGlobal(SCENE_STARTS[this.activeScene] + 0.001); }
      else if (e.code === 'KeyF') this.toggleFullscreen();
    });
  }

  /** Distance between the two active pointers, in CSS pixels. */
  _pinchSpan(touches) {
    const [a, b] = [...touches.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  togglePlay() {
    this.playing = !this.playing;
    this.hud.updateTransport(this.globalTime, this.playing);
  }

  seekGlobal(t) {
    const clamped = clamp(t, 0, TOTAL_DURATION - 0.001);
    const idx = sceneAt(clamped);
    if (idx !== this.activeScene) {
      this._activate(idx, { instant: true });
    }
    this.globalTime = clamped;
  }

  goToScene(index, { play = false, instant = false } = {}) {
    if (index === this.activeScene) {
      // Re-entering the current chapter must never rebuild (and thereby
      // dispose) the world that is already on screen — just rewind it.
      this.globalTime = SCENE_STARTS[index] + 0.001;
      this.scenes[index]?.reset?.(this);
      if (play) this.playing = true;
      this.transition = 0;
      this.hud.fadeVeil(false);
      return;
    }
    if (instant) { this._activate(index, { instant: true }); return; }
    this.pendingScene = index;
    if (play) this.playing = true;
  }

  /** Hard cut to a scene. Previously built chapters are kept, not destroyed,
   *  so revisiting one is instant and still populated. */
  _activate(index, { instant = false } = {}) {
    const scene = this.scenes[index]?.ensureBuilt(this);
    if (!scene) return;

    this.activeScene = index;
    const def = SCENES[index];

    scene.reset?.(this);
    this.rig.setKeys(def.keys);
    this.applyGrade(def.grade);
    this.hud.setScene(index);
    this.globalTime = SCENE_STARTS[index] + 0.001;
    this.transition = instant ? 0 : 1;

    if (instant) this.hud.fadeVeil(false);
  }

  applyGrade(g) {
    if (!g) return;
    const u = this.post.u;
    if (g.exposure !== undefined) u.uExposure.value = g.exposure;
    if (g.bloom !== undefined) u.uBloomStrength.value = g.bloom;
    if (g.rays !== undefined) u.uRaysStrength.value = g.rays;
    if (g.saturation !== undefined) u.uSaturation.value = g.saturation;
    if (g.contrast !== undefined) u.uContrast.value = g.contrast;
    if (g.chroma !== undefined) u.uChroma.value = g.chroma;
    if (g.vignette !== undefined) u.uVignette.value = g.vignette;
    if (g.grain !== undefined) u.uGrain.value = g.grain;
    if (g.lift) u.uLift.value.setRGB(...g.lift);
    if (g.gain) u.uGain.value.setRGB(...g.gain);
    if (g.raysTint) u.uRaysTint.value.setRGB(...g.raysTint);
  }

  /* ═════════════════════════════════════════════════════════════════ frame */

  start() {
    if (this.activeScene < 0) this._activate(0, { instant: true });
    this.renderer.setAnimationLoop(() => this._frame());
  }

  /**
   * Force every program (scenes + post stack) to compile before the user is
   * let in, so no chapter stutters on its first frame.
   */
  async warmup() {
    const rt = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: true });
    const prev = this.renderer.getRenderTarget();
    for (const s of this.scenes) {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(s.scene, this.camera);
      await new Promise(r => setTimeout(r, 0));
    }
    this.renderer.setRenderTarget(prev);
    rt.dispose();
    // compile the post chain too
    this.post.render(this.scenes[0].scene, this.camera, { time: 0, raysStrength: 0.4 });
    this.renderer.getContext().finish?.();
  }

  _frame() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);      // clamp after tab switches
    this.time += dt;

    // fps meter
    this._fpsAcc += raw; this._fpsFrames++;
    if (this._fpsAcc > 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0; this._fpsFrames = 0;
      this._autoScale();
    }

    /* chapter advance */
    if (this.playing && !this.paused) {
      this.globalTime += dt;
      if (this.globalTime >= TOTAL_DURATION) {
        this.globalTime = TOTAL_DURATION - 0.001;
        this.playing = false;
      }
      const idx = sceneAt(this.globalTime);
      if (idx !== this.activeScene && this.pendingScene < 0) {
        this._activate(idx);
      }
    }

    /* queued chapter change (rail click / arrow keys) */
    if (this.pendingScene >= 0) {
      this.transition = Math.min(1, this.transition + dt / (FADE_TIME * 0.5));
      if (this.transition >= 1) {
        const idx = this.pendingScene;
        this.pendingScene = -1;
        this._activate(idx);
      }
    } else if (this.transition > 0) {
      this.transition = Math.max(0, this.transition - dt / FADE_TIME);
    }

    const scene = this.scenes[this.activeScene];
    const def = SCENES[this.activeScene];
    const local = this.globalTime - SCENE_STARTS[this.activeScene];
    const localT = clamp(local / def.duration);

    /* camera */
    const framing = this.rig.update(localT, this.time, dt, {
      fovTarget: def.keys[0].fov ?? 42,
      focusTarget: def.keys[0].focus ?? 20,
    });

    // User orbit / dolly is applied as a spherical offset around the point the
    // choreography is currently looking at — not around the world origin, which
    // would swing the camera wildly in chapters framed off-centre.
    const zoom = this.zoom ?? 1;
    const yaw = this.orbitYaw ?? 0;
    const pitch = this.orbitPitch ?? 0;
    if (zoom !== 1 || yaw !== 0 || pitch !== 0) {
      const kf = Math.min(def.keys.length - 1, Math.round(localT * (def.keys.length - 1)));
      const target = new THREE.Vector3(...def.keys[kf].look);
      const off = this.camera.position.clone().sub(target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.radius *= zoom;
      sph.theta += yaw;
      sph.phi = clamp(sph.phi + pitch, 0.12, Math.PI - 0.12);
      this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
      this.camera.lookAt(target);
    }

    /* scene simulation */
    scene.update?.(dt, this.time, localT, this);

    /* post */
    this.post.u.uFocus.value = damp(this.post.u.uFocus.value, framing.focus, 4, dt);
    this.post.u.uAperture.value = damp(this.post.u.uAperture.value, framing.aperture, 4, dt);
    this.post.u.uFade.value = 1 - this.transition;
    // the DOM veil follows the same fade, so the dip-to-black is consistent
    this.hud.fadeVeil(this.transition > 0.02);

    let lightScreen = null;
    if (scene.lightScreen) {
      const v = scene.lightScreen(this.camera);
      if (v) lightScreen = v;
    }

    this.post.render(scene.scene, this.camera, {
      time: this.time,
      lightScreen,
      raysStrength: def.grade?.rays ?? 0.5,
    });

    /* HUD */
    this.hud.updateTransport(this.globalTime, this.playing);
    this.hud.updateMarkers(this.camera, this.width, this.height, {
      fade: scene.markerFade?.(localT, this.time) ?? 1,
    });
    this.hud.updateTelemetry(this.fps, this.particleCount(), this.post.u.uFocus.value);

    window.__cell.ready = true;
  }

  /** Keep the frame budget by trading resolution when the GPU struggles. */
  _autoScale() {
    if (!this.ready) return;
    if (this.fps < 34 && this.resScale > 0.62) {
      this.resScale = Math.max(0.62, this.resScale - 0.09);
      this.resize();
    } else if (this.fps > 56 && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + 0.05);
      this.resize();
    }
  }
}
