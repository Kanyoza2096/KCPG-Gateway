import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.REDIS_REQUIRED = 'false';
process.env.AUTH_DISABLED = 'true';
const guard = await import('../src/services/authorityGuard.js');
const g = guard.default || guard;
const txmod = await import('../src/services/commandTransaction.js');
const tx = txmod.default || txmod;

const user = { sub: 'chaos-actor', scopes: ['autonomy.execute'] };
const workspaceId = 'ws-chaos';

await g.close();
let guardian = await g.getGuardian();
assert.equal(guardian.locked, false);
const lease = await g.issueLease({ actorId: user.sub, workspaceId, autonomyLevel: 'L4', ttlMs: 5000 });
assert.equal(lease.state, 'issued');

// Guardian lock races with execution: the lease is fenced by generation and must fail.
await g.lock('chaos test', 'owner');
let fenced = await g.fenceLease({ leaseId: lease.leaseId, actorId: user.sub, workspaceId, autonomyLevel: 'L4', transactionId: 'tx-race' });
assert.equal(fenced.allowed, false);
assert.equal(fenced.code, 'GUARDIAN_FENCE_TRIPPED');

// New lease cannot be issued while the Guardian is locked.
await assert.rejects(() => g.issueLease({ actorId: user.sub, workspaceId, autonomyLevel: 'L3' }), /Guardian is locked/);
await g.unlock('owner');

// Duplicate logical request: transaction creation must be idempotent.
const a = await tx.create({ commandId: 'chaos.command', actorId: user.sub, workspaceId, intent: 'chaos', risk: 'medium', requestId: 'r1', idempotencyKey: 'same', autonomyLevel: 'L3', commandLeaseId: 'lease-a' });
const b = await tx.create({ commandId: 'chaos.command', actorId: user.sub, workspaceId, intent: 'chaos', risk: 'medium', requestId: 'r2', idempotencyKey: 'same', autonomyLevel: 'L3', commandLeaseId: 'lease-a' });
assert.equal(a.created, true);
assert.equal(b.created, false);
assert.equal(b.transaction.transactionId, a.transaction.transactionId);

// Cancellation while queued is authoritative; cancellation after execution is only a request.
const cancelled = await tx.cancelBeforeDispatch(a.transaction, user.sub);
assert.equal(cancelled.phase, 'cancelled');

// Expired leases are rejected rather than retried into a side effect.
const shortLease = await g.issueLease({ actorId: user.sub, workspaceId, autonomyLevel: 'L3', ttlMs: 5000 });
await new Promise((resolve) => setTimeout(resolve, 5100));
const expired = await g.fenceLease({ leaseId: shortLease.leaseId, actorId: user.sub, workspaceId, autonomyLevel: 'L3', transactionId: 'tx-expired' });
assert.equal(expired.allowed, false);
assert.equal(expired.code, 'COMMAND_LEASE_EXPIRED');

await g.close();
await tx.close();
console.log('Phase 65 chaos/fencing certification: PASS');
console.log('✓ Guardian lock fences existing autonomous leases');
console.log('✓ Guardian lock prevents new autonomous leases');
console.log('✓ duplicate logical commands remain idempotent');
console.log('✓ queued commands can be authoritatively cancelled');
console.log('✓ expired leases cannot be used for actuation');
