// Entry point: probe WebGL2, build the app, compile shaders, then reveal.
import * as THREE from 'three';
import { App } from './app.js';
import { SCENE_STARTS } from './content.js';

const boot = document.getElementById('boot');
const bootBar = document.getElementById('bootBar');
const bootStatus = document.getElementById('bootStatus');
const bootEnter = document.getElementById('bootEnter');
const fatal = document.getElementById('fatal');
const fatalMsg = document.getElementById('fatalMsg');

const setStatus = (pct, text) => {
  bootBar.style.width = `${pct}%`;
  if (text) bootStatus.textContent = text;
};

function fail(err) {
  fatal.hidden = false;
  fatalMsg.textContent = String(err?.stack ?? err);
  boot.classList.add('done');
  console.error(err);
}

async function main() {
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) {
    fail(new Error('此浏览器不支持 WebGL2，无法运行本课件。\n请使用最新版 Chrome / Edge / Firefox / Safari。'));
    return;
  }

  setStatus(8, '正在初始化渲染管线…');

  const app = new App(canvas);
  window.__app = app;

  setStatus(22, '正在编译着色器…');

  // Scenes are code-split so the first frame is not blocked by later chapters.
  const [{ OverviewScene }, { MembraneScene }, { NucleusScene },
         { MitochondrionScene }, { ProteinScene }, { MitosisScene }] = await Promise.all([
    import('./scenes/overview.js'),
    import('./scenes/membrane.js'),
    import('./scenes/nucleus.js'),
    import('./scenes/mitochondrion.js'),
    import('./scenes/protein.js'),
    import('./scenes/mitosis.js'),
  ]);

  setStatus(46, '正在生成细胞结构…');
  const scenes = [
    ['正在构建细胞全景…', new OverviewScene()],
    ['正在构建细胞膜…', new MembraneScene()],
    ['正在构建细胞核…', new NucleusScene()],
    ['正在构建线粒体…', new MitochondrionScene()],
    ['正在构建蛋白流水线…', new ProteinScene()],
    ['正在构建分裂动画…', new MitosisScene()],
  ];
  const total = scenes.length;
  for (let i = 0; i < total; i++) {
    const [label, scene] = scenes[i];
    setStatus(46 + Math.round((i / total) * 46), label);
    app.register(scene);
    scene.ensureBuilt(app);
    await nextFrame();
  }

  // Compile every program up front: a chapter must never stutter on first entry.
  setStatus(94, '正在预编译着色器…');
  await app.warmup();

  app.ready = true;
  window.__cell.ready = true;

  setStatus(100, '就绪');
  bootEnter.hidden = false;

  const enter = () => {
    if (app._entered) return;
    app._entered = true;
    boot.classList.add('done');
    app.hud.show();
    app.hud.scheduleHintDismiss(10);
    app.start();
    window.removeEventListener('keydown', onKey);
  };

  // The hint has to describe the input device actually in use.
  const hintEl = document.getElementById('hint');
  if (hintEl && matchMedia('(pointer: coarse)').matches) {
    hintEl.textContent = '单指拖动旋转视角 · 双指捏合缩放 · 点按章节切换';
  }
  const onKey = (e) => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') enter(); };
  bootEnter.addEventListener('click', enter);
  window.addEventListener('keydown', onKey);

  // Control surface for automated capture / deep links:
  //   ?auto=1        skip the gate
  //   ?scene=3&t=8   jump straight into a chapter at a given local time
  //   ?pause=1       hold the timeline (useful for stills)
  window.__cell.enter = enter;
  const q = new URLSearchParams(location.search);
  if (q.has('auto')) {
    enter();
    const si = Number(q.get('scene'));
    if (Number.isFinite(si) && si >= 0) app.goToScene(si, { play: true, instant: true });
    const t = Number(q.get('t'));
    if (Number.isFinite(t) && q.has('t')) {
      app.seekGlobal(SCENE_STARTS[app.activeScene] + t);
    }
    if (q.has('pause')) app.playing = false;
  }
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

main().catch(fail);
