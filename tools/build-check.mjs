// Build every chapter in isolation and report any failure.
// Catches missing imports / bad geometry args that only surface at runtime.
// usage: node tools/build-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://127.0.0.1:8127/?auto=1';
const CHROME = process.env.CHROME
  || ['C:\\Users\\yyy\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const udd = mkdtempSync(join(tmpdir(), 'cellbuild-'));
const proc = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--disable-dev-shm-usage', '--mute-audio', '--window-size=800,450',
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
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + m)); } }, 60000);
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
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: URL });

  for (let i = 0; i < 180; i++) {
    if (await evaluate('!!(window.__cell && window.__cell.ready)').catch(() => false)) break;
    await sleep(500);
  }

  // Force-build every chapter and render one frame of each.
  const report = await evaluate(`(async () => {
    const app = window.__app;
    const out = [];
    for (let i = 0; i < app.scenes.length; i++) {
      const s = app.scenes[i];
      try {
        s.ensureBuilt(app);
        app._activate(i, { instant: true });
        app.seekGlobal(app.globalTime + 6);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        let draw = 0;
        s.scene.traverse(o => { if (o.visible && (o.isMesh || o.isPoints || o.isLine)) draw++; });
        out.push({ i, id: s.id, ok: true, children: s.scene.children.length, drawables: draw });
      } catch (e) {
        out.push({ i, id: s.id, ok: false, error: String(e && e.message || e) });
      }
    }
    return JSON.stringify(out);
  })()`);

  const rows = JSON.parse(report);
  let bad = 0;
  for (const r of rows) {
    if (r.ok && r.drawables > 0) console.log(`  OK   [${r.i}] ${r.id.padEnd(14)} children=${String(r.children).padStart(3)} drawables=${r.drawables}`);
    else { bad++; console.log(`  FAIL [${r.i}] ${r.id.padEnd(14)} ${r.error ?? 'empty scene (drawables=' + r.drawables + ')'}`); }
  }
  const real = errors.filter(e => !/favicon/i.test(e));
  console.log(`scenes: ${rows.length - bad}/${rows.length} built, errors: ${real.length}`);
  real.slice(0, 10).forEach(e => console.log('  ! ' + String(e).split('\n').slice(0, 4).join('\n    ')));
  proc.kill();
  process.exit(bad || real.length ? 1 : 0);
} catch (err) {
  console.error('FAIL ' + err.message);
  proc.kill();
  process.exit(3);
}
