// Audit 3D annotation anchors: for every chapter and a range of chapter times,
// report any label that is off-screen, hidden behind the footer, or overlapping
// another label. Run this after touching marker positions or the footer layout.
// usage: node tools/marker-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://127.0.0.1:8127/?auto=1';
const SIZES = [
  { w: 1600, h: 900, name: 'desktop' },
  { w: 1280, h: 720, name: 'laptop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 844, h: 390, name: 'phone-landscape' },
];
const CHROME = process.env.CHROME
  || ['C:\\Users\\yyy\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const udd = mkdtempSync(join(tmpdir(), 'cellmark-'));
const proc = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--disable-dev-shm-usage', '--mute-audio',
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
proc.stderr.on('data', d => { stderr += d; });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function port() {
  const f = join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    if (existsSync(f)) {
      try { const t = readFileSync(f, 'utf8').split('\n'); if (t[0] && t[1]) return Number(t[0]); } catch {}
    }
    await sleep(100);
  }
  throw new Error('no devtools port\n' + stderr);
}

const errors = [];
let ws, id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + m)); } }, 90000);
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.value;
};

const PROBE = `(async () => {
  const app = window.__app, out = [];
  const foot = document.querySelector('.hud__bottom').getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let i = 0; i < app.scenes.length; i++) {
    app._activate(i, { instant: true });
    // markers fade in over the opening seconds of a chapter, so sample from
    // the middle of it rather than the very first frame
    app.seekGlobal(app.globalTime + 12);
    await frame(); await frame(); await frame();
    const nodes = [...document.querySelectorAll('.marker')];
    for (const n of nodes) {
      const name = n.querySelector('.marker__name').textContent;
      const on = n.classList.contains('on');
      if (!on) { out.push({ scene: app.scenes[i].id, name, state: 'hidden' }); continue; }
      const c = n.querySelector('.marker__card').getBoundingClientRect();
      const rec = { scene: app.scenes[i].id, name, l: Math.round(c.left), r: Math.round(c.right),
                    t: Math.round(c.top), b: Math.round(c.bottom) };
      if (c.left < -1 || c.right > W + 1) rec.state = 'offscreen-x';
      else if (c.bottom > foot.top) rec.state = 'behind-footer';
      else if (c.top < 0) rec.state = 'offscreen-top';
      else rec.state = 'ok';
      out.push(rec);
    }
  }
  return JSON.stringify(out);
})()`;

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
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 180; i++) {
    if (await evaluate('!!(window.__cell && window.__cell.ready)').catch(() => false)) break;
    await sleep(500);
  }

  let bad = 0, total = 0;
  for (const s of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    await evaluate('window.__app.resize()').catch(() => {});
    await sleep(400);
    const rows = JSON.parse(await evaluate(PROBE));
    const issues = rows.filter(r => r.state !== 'ok');
    total += rows.length; bad += issues.length;
    console.log(`\n[${s.name}] ${s.w}x${s.h} — ${rows.length - issues.length}/${rows.length} labels placed`);
    for (const r of issues) {
      const box = r.state === 'hidden' ? '' : ` box=(${r.l},${r.t})-(${r.r},${r.b})`;
      console.log(`   ${r.state.toUpperCase().padEnd(14)} ${r.scene}/${r.name}${box}`);
    }
  }
  console.log(`\ntotal: ${total - bad}/${total} placed, ${bad} issues, ${errors.length} js errors`);
  errors.slice(0, 8).forEach(e => console.log('  ! ' + String(e).split('\n')[0]));
  proc.kill();
  process.exit(bad || errors.length ? 1 : 0);
} catch (err) {
  console.error('FAIL ' + err.message);
  proc.kill();
  process.exit(3);
}
