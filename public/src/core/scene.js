// Base class for a chapter's world. Each scene owns a THREE.Scene and its own
// update loop.
//
// Scenes are built lazily on first entry and then *retained*: a courseware is
// something people jump around in, so tearing a chapter down on exit would
// mean revisiting it shows an empty room. GPU memory is bounded by building
// only the chapters actually visited, and `dispose()` exists for teardown.
import * as THREE from 'three';

export class Scene {
  constructor(id) {
    this.id = id;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this._disposables = [];
    this.built = false;
  }

  /** Build the world. Called once, on first entry. */
  build(app) {}

  /**
   * Ensure `build()` runs exactly once. The flag is owned here rather than in
   * `build()` so subclasses cannot forget to set it (which would rebuild the
   * world — and duplicate all its geometry — on every chapter entry). It is
   * set only after a successful build, so a throwing build is retried rather
   * than leaving the scene permanently half-constructed.
   */
  ensureBuilt(app) {
    if (!this.built) {
      this.build(app);
      this.built = true;
    }
    return this;
  }

  /** Track a geometry/material/texture for disposal. */
  own(...items) { this._disposables.push(...items); return items[0]; }

  /** Register a material whose uTime uniform should follow the global clock. */
  timed(material) {
    (this._timed ??= []).push(material);
    return material;
  }

  /** Point the volumetric ray pass at a screen-space light position. */
  lightScreen(camera) { return null; }

  /** 0..1 multiplier for 3D marker opacity at this moment. */
  markerFade(localT, time) { return 1; }

  particleCount() { return 0; }

  /** Called on every entry, before the first update. */
  reset(app) {}

  /** @param {number} dt seconds since last frame
   *  @param {number} time absolute clock
   *  @param {number} localT 0..1 progress through this chapter */
  update(dt, time, localT, app) {
    if (this._timed) for (const m of this._timed) {
      if (m.uniforms?.uTime) m.uniforms.uTime.value = time;
    }
  }

  dispose() {
    for (const d of this._disposables) d?.dispose?.();
    this._disposables.length = 0;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach(x => x.dispose?.());
      else m?.dispose?.();
    });
    this.scene.clear();
    this.built = false;
  }
}

/** Convenience: build a THREE.Group and add it to a scene. */
export function add(scene, obj) { scene.add(obj); return obj; }
