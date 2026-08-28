#!/usr/bin/env node
// Zero-dependency build for Grocery Discount Hunter (Node >= 18).
//
// Usage: node build/build.js [chrome|firefox|all]   (default: all)
//
// Per target: recreates dist/<target>/, copies extension/src -> dist/<target>/src,
// validates + writes the target manifest as dist/<target>/manifest.json, then
// zips dist/<target> into dist/<target>.zip when a `zip` binary is available.

import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['chrome', 'firefox'];

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`build: error: ${message}`);
  process.exit(1);
}

/** @param {string} dir @returns {number} */
function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count += 1;
  }
  return count;
}

/** @param {'chrome'|'firefox'} target */
function buildTarget(target) {
  const srcDir = path.join(ROOT, 'extension', 'src');
  const manifestPath = path.join(ROOT, 'extension', `manifest.${target}.json`);
  const outDir = path.join(ROOT, 'dist', target);
  const zipPath = path.join(ROOT, 'dist', `${target}.zip`);

  let manifestRaw;
  try {
    manifestRaw = readFileSync(manifestPath, 'utf8');
  } catch (e) {
    fail(`cannot read ${manifestPath}: ${e.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    fail(`invalid JSON in ${manifestPath}: ${e.message}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  try {
    cpSync(srcDir, path.join(outDir, 'src'), { recursive: true });
  } catch (e) {
    fail(`cannot copy ${srcDir} -> ${outDir}: ${e.message}`);
  }
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(zipPath, { force: true });
  let zipNote = null;
  const zip = spawnSync('zip', ['-r', '-q', `../${target}.zip`, '.'], {
    cwd: outDir,
    encoding: 'utf8',
  });
  if (zip.error && zip.error.code === 'ENOENT') {
    zipNote = `note: 'zip' binary not found — skipped ${path.relative(ROOT, zipPath)}. ` +
      `Install zip, or archive dist/${target}/ yourself.`;
  } else if (zip.error) {
    fail(`zip failed for ${target}: ${zip.error.message}`);
  } else if (zip.status !== 0) {
    fail(`zip exited with status ${zip.status} for ${target}: ${(zip.stderr || '').trim()}`);
  }

  const files = countFiles(outDir);
  console.log(`[${target}] ${files} files -> ${path.relative(ROOT, outDir)}/`);
  if (zipNote) console.log(`[${target}] ${zipNote}`);
  else console.log(`[${target}] zipped -> ${path.relative(ROOT, zipPath)}`);
}

const arg = process.argv[2] ?? 'all';
if (process.argv.length > 3 || !['all', ...TARGETS].includes(arg)) {
  fail('usage: node build/build.js [chrome|firefox|all]');
}

for (const target of arg === 'all' ? TARGETS : [arg]) {
  buildTarget(target);
}
console.log('Build complete.');
