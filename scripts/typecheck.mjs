'use strict';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'coverage', 'dist']);
let files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (extname(entry.name) === '.js' && !entry.name.endsWith('.config.js')) files.push(full);
  }
}
await walk(join(root, 'src'));
files.push(join(root, 'server.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Source syntax check passed for ${files.length} JavaScript files.`);
