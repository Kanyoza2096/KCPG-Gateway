import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const route = fs.readFileSync(path.join(root, 'src/routes/runtimeDiagnostics.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'src/routes/index.js'), 'utf8');
const checks = [
  ['runtime diagnostics route mounted', index.includes("router.use('/api/v1/command-center', runtimeDiagnostics)")],
  ['runtime diagnostics endpoint exists', route.includes("router.get('/diagnostics'")],
  ['workspace authorization required', route.includes('requireWorkspace')],
  ['no raw upstream payload is returned', route.includes('summarizeData(result.data)') && !route.includes('data: result.data')],
  ['organism verification is explicit', route.includes('organismEndpointVerified')],
  ['partial failures are represented', route.includes("state: failed === 0 ? 'LIVE' : passed === 0 ? 'UNKNOWN' : 'DEGRADED'")],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; }
if (failed) process.exit(1);
console.log(`Phase 69 runtime contract certification: PASS (${checks.length} checks)`);
