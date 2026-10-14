// HUD controller: chapter rail + phone dock, DOM markers projected from 3D
// anchors, captions and telemetry.
import * as THREE from 'three';
import { SCENES, TOTAL_DURATION } from '../content.js';
import { fmtTime } from './util.js';

const _v = new THREE.Vector3();

export class HUD {
  constructor(app) {
    this.app = app;
    this.el = {
      hud: document.getElementById('hud'),
      rail: document.getElementById('rail'),
      dock: document.getElementById('dock'),
      markers: document.getElementById('markers'),
      chapterIndex: document.getElementById('chapterIndex'),
      chapterTitle: document.getElementById('chapterTitle'),
      chapterLatin: document.getElementById('chapterLatin'),
      captionText: document.getElementById('captionText'),
      timeNow: document.getElementById('timeNow'),
      timeAll: document.getElementById('timeAll'),
      hint: document.getElementById('hint'),
      tFps: document.getElementById('tFps'),
      tParticles: document.getElementById('tParticles'),
      tDepth: document.getElementById('tDepth'),
      veil: document.getElementById('veil'),
    };

    this.markerNodes = [];
    this.currentScene = -1;
    this._buildChapters();

    this.el.timeAll.textContent = fmtTime(TOTAL_DURATION);

    // Label widths change with the viewport and again when the webfont lands,
    // and the screen-edge clamp depends on them.
    window.addEventListener('resize', () => this.remeasureMarkers());
    document.fonts?.ready.then(() => this.remeasureMarkers()).catch(() => {});
  }

  /** Both chapter navigators share one item list; CSS decides which shows. */
  _buildChapters() {
    SCENES.forEach((s, i) => {
      const rail = document.createElement('button');
      rail.className = 'rail__item';
      rail.innerHTML = `<span class="rail__idx">${s.index}</span><span class="rail__label">${s.title}</span>`;
      rail.addEventListener('click', () => this.app.goToScene(i, { play: true }));
      this.el.rail.appendChild(rail);

      const chip = document.createElement('button');
      chip.className = 'dock__item';
      chip.innerHTML = `<span class="dock__idx">${s.index}</span><span class="dock__label">${s.title}</span>`;
      chip.addEventListener('click', () => this.app.goToScene(i, { play: true }));
      this.el.dock.appendChild(chip);
    });
    this.railItems = [...this.el.rail.children];
    this.dockItems = [...this.el.dock.children];
  }

  show() {
    this.el.hud.classList.add('on');
    this.el.hud.setAttribute('aria-hidden', 'false');
  }

  /** Rebuild the DOM nodes for the active scene's 3D markers. */
  setScene(index) {
    const scene = SCENES[index];
    this.currentScene = index;

    this.railItems.forEach((el, i) => el.classList.toggle('is-active', i === index));
    this.dockItems.forEach((el, i) => el.classList.toggle('is-active', i === index));

    this.el.chapterIndex.textContent = scene.index;
    this.el.chapterTitle.textContent = scene.title;
    this.el.chapterLatin.textContent = scene.latin;
    this.el.captionText.innerHTML = scene.caption;

    document.documentElement.style.setProperty('--accent', scene.accent);

    // keep the active chip visible in the horizontally scrolling dock
    this.dockItems[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });

    // markers
    this.el.markers.innerHTML = '';
    this.markerNodes = (scene.markers ?? []).map((m) => {
      const node = document.createElement('div');
      node.className = 'marker';
      node.innerHTML = `
        <span class="marker__ring"></span>
        <span class="marker__dot"></span>
        <span class="marker__line"></span>
        <span class="marker__card">
          <span class="marker__name">${m.name}</span>
          <span class="marker__en">${m.en}</span>
        </span>`;
      this.el.markers.appendChild(node);
      return {
        node,
        pos: new THREE.Vector3(...m.pos),
        card: node.querySelector('.marker__card'),
        w: 0,
      };
    });
    // Label widths are needed to keep them on screen; measure once the browser
    // has laid the new nodes out (and again on resize).
    this._measureMarkers();
  }

  _measureMarkers() {
    for (const m of this.markerNodes) {
      m.w = m.card.offsetWidth;
      m.h = m.card.offsetHeight;
    }
  }

  /** Re-measure after a resize or a webfont swap; label sizes feed the clamp. */
  remeasureMarkers() {
    this._measureMarkers();
  }

  /**
   * Screen-space band the footer occupies, read live. Caching it broke during
   * programmatic resizes (Emulation.setDeviceMetricsOverride does not always
   * raise a window resize event), which let labels drift under the footer.
   */
  _bottomBand() {
    this.el.footer ??= document.querySelector('.hud__bottom');
    return this.el.footer ? this.el.footer.getBoundingClientRect().top : window.innerHeight;
  }

  /**
   * Project the 3D anchors and place their labels.
   *
   * Labels are repositioned rather than dropped wherever there is a legal spot
   * for them: on wide screens the card is nudged vertically to clear the
   * footer, on phones the pill flips above the dot when there is no room below.
   * An anchor is only hidden when it is genuinely off-frame or behind camera,
   * because an annotation the viewer cannot read is worse than none.
   */
  updateMarkers(camera, width, height, { fade = 1 } = {}) {
    const band = this._bottomBand();
    const top = 6;
    const compact = width <= 700 || window.innerHeight <= 470;
    const EDGE = 8;

    // Pill and card have very different sizes, and switching between them
    // (rotating a phone, dragging a window edge) does not always raise a
    // resize event — re-measure when the layout class flips.
    if (compact !== this._lastCompact) { this._lastCompact = compact; this.remeasureMarkers(); }

    for (const m of this.markerNodes) {
      _v.copy(m.pos).project(camera);
      const behind = _v.z > 1;
      const x = (_v.x * 0.5 + 0.5) * width;
      const y = (-_v.y * 0.5 + 0.5) * height;

      const cw = m.w || 60;
      const ch = m.h || 22;
      let shift = 0;   // horizontal nudge, px
      let dy = 0;      // vertical nudge, wide layout
      let pillY = 0;   // pill offset from the dot, compact layout
      let on = !behind && fade > 0.05;

      if (on && compact) {
        // pill sits under the dot, or flips above it when the footer is close
        const below = 13;
        const above = -(ch + 13);
        const fitsBelow = y + below + ch <= band - 2;
        const fitsAbove = y + above + ch <= band - 2 && y + above >= top;
        if (fitsBelow) pillY = below;
        else if (fitsAbove) pillY = above;
        else on = false;
        if (on) {
          const want = x + cw / 2 + EDGE;
          if (want > width) shift = width - want;
          if (x - cw / 2 + shift < EDGE) shift = EDGE - x + cw / 2;
        }
      } else if (on) {
        // card is vertically centred on the dot and hangs off a leader line
        const pushLeft = x > width * 0.62;
        m.node.classList.toggle('marker--left', pushLeft);
        const anchor = x + (pushLeft ? -66 : 66);
        const l0 = pushLeft ? anchor - cw : anchor;
        if (l0 < EDGE) shift = EDGE - l0;
        else if (l0 + cw > width - EDGE) shift = width - EDGE - (l0 + cw);

        const cy = y + dy;
        if (cy - ch / 2 < top) dy = top - (y - ch / 2);
        else if (cy + ch / 2 > band - 4) dy = (band - 4) - (y + ch / 2);
        // if it still cannot fit, the footer is simply too tall for this anchor
        if (y + dy - ch / 2 < top || y + dy + ch / 2 > band - 2) on = false;
      }

      if (!on) { m.node.classList.remove('on'); continue; }

      m.node.classList.add('on');
      m.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      m.node.style.setProperty('--label-shift', `${shift.toFixed(1)}px`);
      m.node.style.setProperty('--label-dy', `${dy.toFixed(1)}px`);
      m.node.style.setProperty('--label-y', `${pillY.toFixed(1)}px`);
      // fade out as a label approaches the footer rather than clipping abruptly
      const room = band - (y + (compact ? Math.max(pillY, 0) + ch : ch / 2));
      m.node.style.opacity = String(fade * (room > 70 ? 1 : Math.max(0.15, room / 70)));
    }
  }

  /** Elapsed-time readout. The progress bar and play button were removed, so
   *  this is now the only transport affordance. */
  updateTransport(globalTime, playing) {
    this.el.timeNow.textContent = fmtTime(globalTime);
    void playing;
  }

  updateTelemetry(fps, particles, depthUm) {
    this.el.tFps.textContent = String(Math.round(fps));
    this.el.tParticles.textContent = particles > 1000
      ? `${(particles / 1000).toFixed(1)}k` : String(particles);
    this.el.tDepth.textContent = depthUm.toFixed(1);
  }

  fadeVeil(on) { this.el.veil.classList.toggle('on', on); }

  hideHint() {
    if (this.el.hint && !this.el.hint.classList.contains('gone')) {
      this.el.hint.classList.add('gone');
    }
  }

  /** Auto-dismiss the interaction hint a few seconds after entering. */
  scheduleHintDismiss(seconds = 9) {
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hideHint(), seconds * 1000);
  }
}
