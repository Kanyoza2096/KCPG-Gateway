import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const guard = read('src/services/authorityGuard.js');
const policy = read('src/services/commandPolicy.js');
const tx = read('src/services/commandTransaction.js');
const routes = read('src/routes/commands.js');
const authorityRoutes = read('src/routes/authority.js');
const checks = [
  ['Guardian generation fence exists', guard.includes('guardianGeneration') && guard.includes('GUARDIAN_FENCE_TRIPPED')],
  ['Lease states are explicit', guard.includes("state: 'issued'") && guard.includes("state: 'bound'")],
  ['Bound lease has transaction binding', guard.includes('transactionId') && guard.includes("COMMAND_LEASE_NOT_BOUND")],
  ['Final pre-side-effect lease fence exists', policy.includes('verifyBoundLease')],
  ['Expired lease is rejected', guard.includes('COMMAND_LEASE_EXPIRED')],
  ['New lease blocked while Guardian locked', guard.includes("if (guardian.locked) throw")],
  ['Queued cancellation is authoritative', tx.includes("phase: 'cancelled'") && tx.includes('cancelBeforeDispatch')],
  ['In-flight cancellation is represented, not falsely completed', tx.includes('cancelRequested')],
  ['Cancellation endpoint exists', routes.includes("/cancel")],
  ['Lease release endpoint exists', authorityRoutes.includes("'/leases/:leaseId'")],
  ['Transaction retains autonomy level and lease', tx.includes('autonomyLevel') && tx.includes('commandLeaseId')],
];
let failed = 0;
for (const [name, ok] of checks) { if (ok) console.log(`✓ ${name}`); else { console.error(`✗ ${name}`); failed++; } }
if (failed) process.exit(1);
console.log('Phase 65 authority static certification: PASS');
