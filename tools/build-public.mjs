// Assemble the deployable bundle in ./public.
// Copies the site plus the vendored three.js, and excludes dev tooling,
// screenshots and this script itself.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const SKIP = new Set(['tools', 'shots', 'public', 'node_modules', '.git', '.wrangler']);

if (existsSync(PUB)) rmSync(PUB, { recursive: true, force: true });
mkdirSync(PUB, { recursive: true });

// index.html + src/ + vendor/
cpSync(join(ROOT, 'index.html'), join(PUB, 'index.html'));
cpSync(join(ROOT, 'src'), join(PUB, 'src'), { recursive: true });
cpSync(join(ROOT, 'vendor'), join(PUB, 'vendor'), { recursive: true });
if (existsSync(join(ROOT, 'README.md'))) {
  cpSync(join(ROOT, 'README.md'), join(PUB, 'README.md'));
}

// .nojekyll-style guard is meaningless on Workers, but a robots file is polite.
writeFileSync(join(PUB, 'robots.txt'), 'User-agent: *\nAllow: /\n');

let files = 0;
let bytes = 0;
const walk = (dir, rel = '') => {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(p).isDirectory()) walk(p, r);
    else { files++; bytes += statSync(p).size; }
  }
};
import { readdirSync, statSync } from 'node:fs';
walk(PUB);

console.log(`public/ ready — ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
