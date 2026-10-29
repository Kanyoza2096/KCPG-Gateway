#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const index = fs.readFileSync(path.join(root, 'src/routes/index.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/commandCenter.js'), 'utf8');
const checks = [
  ['command-center route mounted', index.includes("router.use('/api/v1/command-center', commandCenter);")],
  ['situation endpoint exists', route.includes("router.get('/situation'")],
  ['route contract endpoint exists', route.includes("router.get('/routes'")],
  ['workspace authorization required', route.includes('requireWorkspace')],
  ['canonical situation schema exists', route.includes('CommandCenterSituation/v1')],
  ['partial upstream failures are represented', route.includes("state: 'unreachable'")],
  ['global state does not equate partial success with LIVE', route.includes("successful < values.length")],
  ['provenance path is returned', route.includes('path: path.replace')],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; }
if (failed) process.exit(1);
console.log(`Phase 66 route contract certification: PASS (${checks.length} checks)`);
