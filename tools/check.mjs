// Syntax-check every ES module in src/ without executing it.
// usage: node tools/check.mjs
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.js', '.mjs'].includes(extname(p))) files.push(p);
  }
})('src');

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.log(`FAIL ${f}`);
    console.log((r.stderr || '').split('\n').slice(0, 8).join('\n'));
  }
}
console.log(`${files.length} modules checked, ${bad} failed`);
process.exit(bad ? 1 : 0);
