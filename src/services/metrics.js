'use strict';

const os = require('os');

const buckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const state = {
  requests: 0,
  errors: 0,
  durations: Array(buckets.length + 1).fill(0),
  upstreamRequests: 0,
  upstreamErrors: 0,
  upstreamDurations: Array(buckets.length + 1).fill(0),
};

function observe(target, seconds) {
  const i = buckets.findIndex((b) => seconds <= b);
  target[i === -1 ? buckets.length : i] += 1;
}

function observeRequest({ durationMs, statusCode }) {
  state.requests += 1;
  if (statusCode >= 500) state.errors += 1;
  observe(state.durations, Math.max(0, durationMs) / 1000);
}

function observeUpstream({ durationMs, statusCode, failed = false }) {
  state.upstreamRequests += 1;
  if (failed || statusCode >= 500 || statusCode === 0) state.upstreamErrors += 1;
  observe(state.upstreamDurations, Math.max(0, durationMs) / 1000);
}

function renderHistogram(name, help, values) {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} histogram\n`;
  let cumulative = 0;
  buckets.forEach((bucket, i) => {
    cumulative += values[i];
    out += `${name}_bucket{le="${bucket}"} ${cumulative}\n`;
  });
  cumulative += values[buckets.length];
  out += `${name}_bucket{le="+Inf"} ${cumulative}\n`;
  out += `${name}_count ${cumulative}\n`;
  return out;
}

function histogramQuantile(values, q) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = total * q;
  let cumulative = 0;
  for (let i = 0; i < values.length; i += 1) {
    cumulative += values[i];
    if (cumulative >= target) return i < buckets.length ? buckets[i] : null;
  }
  return null;
}

function sloSnapshot({ targetAvailability = 0.995, latencySeconds = 0.5 } = {}) {
  const total = state.requests;
  const good = Math.max(0, total - state.errors);
  const availability = total ? good / total : null;
  const p95 = histogramQuantile(state.durations, 0.95);
  const latencyGood = state.durations.reduce((sum, count, i) => {
    const upper = i < buckets.length ? buckets[i] : Infinity;
    return sum + (upper <= latencySeconds ? count : 0);
  }, 0);
  const latencyCompliance = total ? latencyGood / total : null;
  const availabilityBudget = availability == null ? null : availability - targetAvailability;
  return {
    scope: 'instance',
    requests_total: total,
    errors_5xx: state.errors,
    availability,
    target_availability: targetAvailability,
    error_budget_remaining: availabilityBudget,
    latency_p95_seconds: p95,
    latency_target_seconds: latencySeconds,
    latency_compliance: latencyCompliance,
    observed_at: new Date().toISOString(),
  };
}

function prometheus() {
  const mem = process.memoryUsage();
  let out = '';
  out += '# HELP kcpg_http_requests_total Total HTTP requests handled by this gateway process.\n# TYPE kcpg_http_requests_total counter\n';
  out += `kcpg_http_requests_total ${state.requests}\n`;
  out += '# HELP kcpg_http_errors_total HTTP 5xx responses emitted by this gateway process.\n# TYPE kcpg_http_errors_total counter\n';
  out += `kcpg_http_errors_total ${state.errors}\n`;
  out += '# HELP kcpg_upstream_requests_total Requests sent to the Python core.\n# TYPE kcpg_upstream_requests_total counter\n';
  out += `kcpg_upstream_requests_total ${state.upstreamRequests}\n`;
  out += '# HELP kcpg_upstream_errors_total Failed/5xx Python core requests.\n# TYPE kcpg_upstream_errors_total counter\n';
  out += `kcpg_upstream_errors_total ${state.upstreamErrors}\n`;
  out += renderHistogram('kcpg_http_request_duration_seconds', 'HTTP request duration.', state.durations);
  out += renderHistogram('kcpg_upstream_request_duration_seconds', 'Python core request duration.', state.upstreamDurations);
  out += '# HELP kcpg_process_resident_memory_bytes Resident process memory.\n# TYPE kcpg_process_resident_memory_bytes gauge\n';
  out += `kcpg_process_resident_memory_bytes ${mem.rss}\n`;
  out += '# HELP kcpg_process_heap_used_bytes Node.js heap used.\n# TYPE kcpg_process_heap_used_bytes gauge\n';
  out += `kcpg_process_heap_used_bytes ${mem.heapUsed}\n`;
  out += '# HELP kcpg_process_uptime_seconds Gateway process uptime.\n# TYPE kcpg_process_uptime_seconds gauge\n';
  out += `kcpg_process_uptime_seconds ${process.uptime()}\n`;
  out += '# HELP kcpg_nodejs_cpu_user_seconds_total Node.js process user CPU time.\n# TYPE kcpg_nodejs_cpu_user_seconds_total counter\n';
  out += `kcpg_nodejs_cpu_user_seconds_total ${process.cpuUsage().user / 1e6}\n`;
  out += '# HELP kcpg_nodejs_cpu_system_seconds_total Node.js process system CPU time.\n# TYPE kcpg_nodejs_cpu_system_seconds_total counter\n';
  out += `kcpg_nodejs_cpu_system_seconds_total ${process.cpuUsage().system / 1e6}\n`;
  return out;
}

function snapshot() {
  return {
    process: {
      pid: process.pid,
      uptime_seconds: process.uptime(),
      memory_rss_bytes: process.memoryUsage().rss,
      heap_used_bytes: process.memoryUsage().heapUsed,
      hostname: os.hostname(),
    },
    requests: { total: state.requests, errors_5xx: state.errors },
    upstream: { total: state.upstreamRequests, errors: state.upstreamErrors },
  };
}

module.exports = { observeRequest, observeUpstream, prometheus, snapshot, sloSnapshot };
