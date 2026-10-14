// Headless screenshot + console capture via Chrome DevTools Protocol.
// usage: node tools/shot.mjs --url http://127.0.0.1:8127/ --out shots/x.png --wait 9000
//        [--w 1600 --h 900] [--eval "window.__cell.goto(3)"] [--pre "expr" --prewait 1500]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const url = arg('url', 'http://127.0.0.1:8127/');
const out = resolve(arg('out', 'shots/shot.png'));
const waitMs = Number(arg('wait', 9000));
const width = Number(arg('w', 1600));
const height = Number(arg('h', 900));
const preExpr = arg('pre', '');
const preWait = Number(arg('prewait', 2000));
const evalExpr = arg('eval', '');

const CHROME = process.env.CHROME
  || ['C:\\Users\\yyy\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
     .find(p => existsSync(p));
if (!CHROME) { console.error('no chrome found'); process.exit(2); }

const udd = mkdtempSync(join(tmpdir(), 'cellshot-'));
const proc = spawn(CHROME, [
  '--headless=new',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--mute-audio', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--window-size=${width},${height}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
proc.stderr.on('data', d => { stderr += d.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtoolsPort() {
  const f = join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    if (existsSync(f)) {
      try {
        const txt = readFileSync(f, 'utf8').split('\n');
        if (txt[0] && txt[1]) return { port: Number(txt[0]), path: txt[1].trim() };
      } catch { /* chrome may still be writing the file */ }
    }
    await sleep(100);
  }
  throw new Error('devtools port timeout\n' + stderr);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = []; this.errors = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
        c.logs.push(`[${msg.params.type}] ${text}`);
        if (msg.params.type === 'error') c.errors.push(text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        c.errors.push(d.exception?.description ?? d.text);
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        c.logs.push(`[log:${e.level}] ${e.text} ${e.url ?? ''}`);
        if (e.level === 'error') c.errors.push(`${e.text} ${e.url ?? ''}`);
      } else if (msg.method === 'Network.loadingFailed') {
        c.errors.push(`NETFAIL ${msg.params.errorText} ${msg.params.type ?? ''}`);
      } else if (msg.method === 'Network.responseReceived') {
        const r = msg.params.response;
        if (r.status >= 400) c.errors.push(`HTTP ${r.status} ${r.url}`);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('cdp timeout ' + method)); } }, 120000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result?.value;
  }
}

try {
  const { port } = await devtoolsPort();
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === 'page');
    } catch {}
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('no page target');

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });

  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);

  // wait for app readiness flag if present
  for (let i = 0; i < 60; i++) {
    const ready = await cdp.evaluate('!!(window.__cell && window.__cell.ready)').catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  if (preExpr) { await cdp.evaluate(preExpr).catch(e => cdp.errors.push('pre: ' + e.message)); await sleep(preWait); }
  if (evalExpr) {
    const r = await cdp.evaluate(evalExpr).catch(e => { cdp.errors.push('eval: ' + e.message); return null; });
    if (r !== null && r !== undefined) console.log('EVAL ' + r);
    await sleep(1200);
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const info = await cdp.evaluate('JSON.stringify(window.__cell ? (window.__cell.info ? window.__cell.info() : {}) : {})').catch(() => '{}');
  const probe = await cdp.evaluate(`JSON.stringify({
    fatal: document.getElementById('fatalMsg')?.textContent?.slice(0,1200) ?? null,
    fatalShown: !document.getElementById('fatal')?.hidden,
    bootStatus: document.getElementById('bootStatus')?.textContent ?? null,
    enterHidden: document.getElementById('bootEnter')?.hidden ?? null,
    title: document.title,
  })`).catch(e => JSON.stringify({ probeError: e.message }));
  console.log('SHOT ' + out);
  console.log('INFO ' + info);
  console.log('PROBE ' + probe);
  if (cdp.errors.length) {
    console.log('ERRORS ' + cdp.errors.length);
    cdp.errors.slice(0, 25).forEach(e => console.log('  ! ' + String(e).split('\n').slice(0, 6).join('\n    ')));
  } else console.log('ERRORS 0');
  const warn = cdp.logs.filter(l => /warn/i.test(l)).slice(0, 12);
  warn.forEach(w => console.log('  ~ ' + w.slice(0, 400)));
  proc.kill();
  process.exit(cdp.errors.length ? 1 : 0);
} catch (err) {
  console.error('FAIL ' + err.message);
  proc.kill();
  process.exit(3);
}
