'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../../src/services/metrics');

test('Prometheus exposition contains gateway counters and process gauges', () => {
  metrics.observeRequest({ durationMs: 120, statusCode: 200 });
  metrics.observeRequest({ durationMs: 800, statusCode: 503 });
  metrics.observeUpstream({ durationMs: 250, statusCode: 200 });
  const text = metrics.prometheus();
  assert.match(text, /kcpg_http_requests_total 2/);
  assert.match(text, /kcpg_http_errors_total 1/);
  assert.match(text, /kcpg_upstream_requests_total 1/);
  assert.match(text, /kcpg_http_request_duration_seconds_bucket/);
  assert.match(text, /kcpg_process_resident_memory_bytes/);
});

test('snapshot explicitly identifies process scope', () => {
  const snap = metrics.snapshot();
  assert.equal(typeof snap.process.pid, 'number');
  assert.equal(typeof snap.requests.total, 'number');
  assert.equal(typeof snap.upstream.total, 'number');
});
