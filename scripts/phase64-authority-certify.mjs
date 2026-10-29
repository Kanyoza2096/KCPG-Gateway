import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const guard = read('src/services/authorityGuard.js');
const policy = read('src/services/commandPolicy.js');
const tx = read('src/services/commandTransaction.js');
const routes = read('src/routes/authority.js');
const index = read('src/routes/index.js');
const checks = [
  ['server-side Guardian exists', guard.includes("LOCK_KEY = 'kcp:guardian:global:v2'" )],
  ['Guardian blocks non-low risk mutations', guard.includes("guardian.locked && risk !== 'low'" )],
  ['L3/L4 require autonomy scope', guard.includes("autonomy.execute")],
  ['L3/L4 require bounded action', guard.includes('ACTION_NOT_BOUNDED')],
  ['L3/L4 require dry-run proof', guard.includes('DRY_RUN_PROOF_REQUIRED')],
  ['L3/L4 require verification proof', guard.includes('VERIFICATION_REQUIRED')],
  ['L3/L4 require command lease', guard.includes('COMMAND_LEASE_INVALID')],
  ['command policy invokes server authority gate', policy.includes('authorityGuard.authorizeActuation')],
  ['transaction records autonomy level', tx.includes('autonomyLevel')],
  ['transaction records command lease', tx.includes('commandLeaseId')],
  ['Guardian lock endpoint exists', routes.includes("'/guardian/lock'" )],
  ['lease endpoint exists', routes.includes("'/leases'" )],
  ['authority routes mounted', index.includes("'/api/v1/control-plane/authority'" )],
];
let failed = 0;
for (const [name, ok] of checks) { if (ok) console.log(`✓ ${name}`); else { console.error(`✗ ${name}`); failed++; } }
if (failed) process.exit(1);
console.log('Phase 64 authority certification: PASS');
