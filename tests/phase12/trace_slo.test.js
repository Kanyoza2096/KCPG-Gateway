const test = require('node:test');
const assert = require('node:assert/strict');
const { startTrace, parseTraceparent } = require('../../src/utils/trace');
const metrics = require('../../src/services/metrics');

test('W3C trace context is generated and valid', () => {
  const t = startTrace();
  assert.match(t.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.equal(parseTraceparent(t.traceparent).traceId, t.traceId);
});

test('incoming trace context is continued', () => {
  const parent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  const t = startTrace(parent);
  assert.equal(t.traceId, '0123456789abcdef0123456789abcdef');
  assert.notEqual(t.spanId, '0123456789abcdef');
});

test('SLO snapshot is based on observed requests only', () => {
  const before = metrics.snapshot().requests.total;
  metrics.observeRequest({ durationMs: 100, statusCode: 200 });
  metrics.observeRequest({ durationMs: 700, statusCode: 500 });
  const slo = metrics.sloSnapshot();
  assert.equal(slo.requests_total, before + 2);
  assert.ok(slo.availability !== null);
  assert.equal(slo.scope, 'instance');
});
