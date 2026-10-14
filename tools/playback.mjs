// End-to-end playback test: load the piece, let the timeline run through every
// chapter transition, and report errors, frame rate and scene switches.
// usage: node tools/playback.mjs [seconds]
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECONDS = Number(process.argv[2] ?? 30);
const URL = process.argv[3] ?? 'http://127.0.0.1:8127/?auto=1';
const CHROME = process.env.CHROME
  || ['C:\\Users\\yyy\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const udd = mkdtempSync(join(tmpdir(), 'cellplay-'));
const proc = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--disable-dev-shm-usage', '--mute-audio', '--window-size=1280,720',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
proc.stderr.on('data', d => { stderr += d; });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function port() {
  const f = join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    if (existsSync(f)) {
      try {
        const t = readFileSync(f, 'utf8').split('\n');
        if (t[0] && t[1]) return Number(t[0]);
      } catch {}
    }
    await sleep(100);
  }
  throw new Error('no devtools port\n' + stderr);
}

const errors = [];
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 90000);
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.value;
};

try {
  const p = await port();
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${p}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (!target) await sleep(150);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: URL });

  // wait for boot
  for (let i = 0; i < 120; i++) {
    if (await evaluate('!!(window.__cell && window.__cell.ready)').catch(() => false)) break;
    await sleep(500);
  }
  await evaluate('window.__cell.enter && window.__cell.enter()').catch(() => {});

  console.log(`stepping through every chapter …`);
  const seen = [];
  const samples = [];

  // Walk the whole timeline in fixed strides. Under software rendering the
  // frame clock is clamped, so we drive the timeline directly instead of
  // waiting on wall-clock playback.
  const total = await evaluate('window.__app ? window.__app.scenes.length : 0');
  for (let i = 0; i < total; i++) {
    for (const local of [1, 12, 24]) {
      await evaluate(`window.__app.goToScene(${i}, { play: true, instant: true });
        window.__app.seekGlobal(window.__app.globalTime + ${local});`);
      await sleep(2600);
      const info = JSON.parse(await evaluate('JSON.stringify(window.__cell.info())').catch(() => '{}'));
      if (info.scene && !seen.includes(info.scene)) seen.push(info.scene);
      samples.push(info);
    }
  }

  console.log('chapters visited :', seen.join(' → '));
  const fps = samples.map(s => s.fps).filter(Boolean);
  if (fps.length) {
    console.log(`fps              : min ${Math.min(...fps).toFixed(1)}  max ${Math.max(...fps).toFixed(1)}  avg ${(fps.reduce((a, b) => a + b) / fps.length).toFixed(1)}`);
  }
  const last = samples[samples.length - 1] ?? {};
  console.log('final            :', JSON.stringify(last));
  const finals = await evaluate(`JSON.stringify({
    playing: window.__app.playing,
    scene: window.__app.activeScene,
    time: +window.__app.globalTime.toFixed(1),
    transition: +window.__app.transition.toFixed(2),
    drawables: (() => { let n = 0; window.__app.scenes[window.__app.activeScene].scene.traverse(o => { if (o.visible && (o.isMesh || o.isPoints || o.isLine)) n++; }); return n; })(),
    markers: document.querySelectorAll('.marker').length,
    caption: (document.getElementById('captionText')?.textContent ?? '').slice(0, 24),
  })`).catch(e => 'eval: ' + e.message);
  console.log('dom              :', finals);

  console.log(errors.length ? `ERRORS ${errors.length}` : 'ERRORS 0');
  errors.slice(0, 15).forEach(e => console.log('  ! ' + String(e).split('\n').slice(0, 4).join('\n    ')));
  proc.kill();
  process.exit(errors.length ? 1 : 0);
} catch (err) {
  console.error('FAIL ' + err.message);
  proc.kill();
  process.exit(3);
}
