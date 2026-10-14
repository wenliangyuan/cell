// Diagnose (and optionally repair) UTF-8 damage in a source file.
// usage: node tools/utf8-check.mjs <file> [--fix]
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const fix = process.argv.includes('--fix');
const buf = readFileSync(file);

// Strict UTF-8 validation, returning the byte offsets of every bad sequence.
function badOffsets(b) {
  const bad = [];
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let n = 0;
    if (c < 0x80) n = 1;
    else if ((c & 0xe0) === 0xc0) n = 2;
    else if ((c & 0xf0) === 0xe0) n = 3;
    else if ((c & 0xf8) === 0xf0) n = 4;
    else { bad.push(i); i++; continue; }
    if (i + n > b.length) { bad.push(i); break; }
    let ok = true;
    for (let k = 1; k < n; k++) if ((b[i + k] & 0xc0) !== 0x80) { ok = false; break; }
    // reject overlongs / surrogates / out-of-range
    if (ok && n === 3) {
      const cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) ok = false;
    }
    if (ok && n === 4) {
      const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      if (cp < 0x10000 || cp > 0x10ffff) ok = false;
    }
    if (!ok) { bad.push(i); i++; } else i += n;
  }
  return bad;
}

const bad = badOffsets(buf);
console.log(`file: ${file}`);
console.log(`bytes: ${buf.length}`);
console.log(`bad sequences: ${bad.length}`);

if (bad.length) {
  // group nearby offsets and show the surrounding text
  const groups = [];
  for (const o of bad) {
    const last = groups[groups.length - 1];
    if (last && o - last[last.length - 1] < 8) last.push(o);
    else groups.push([o]);
  }
  console.log(`clusters: ${groups.length}`);
  for (const g of groups.slice(0, 40)) {
    const s = Math.max(0, g[0] - 45), e = Math.min(buf.length, g[g.length - 1] + 25);
    const ctx = buf.subarray(s, e).toString('latin1').replace(/\n/g, '\\n');
    console.log(`  @${g[0]} (${g.length} bad): ...${ctx}...`);
  }
  if (groups.length > 40) console.log(`  ... ${groups.length - 40} more clusters`);

  if (fix) {
    // Replace every bad byte with '?' so the file becomes valid UTF-8 again,
    // preserving all code (damage is confined to comment banners).
    const out = Buffer.from(buf);
    for (const o of bad) out[o] = 0x3f;
    writeFileSync(file, out);
    console.log('FIXED: bad bytes replaced with "?"');
  }
}
