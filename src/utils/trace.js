'use strict';
const crypto = require('crypto');

function hex(bytes) { return crypto.randomBytes(bytes).toString('hex'); }
function validTraceId(v) { return typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v) && !/^0{32}$/.test(v); }
function validSpanId(v) { return typeof v === 'string' && /^[0-9a-f]{16}$/i.test(v) && !/^0{16}$/.test(v); }
function parseTraceparent(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!m || !validTraceId(m[1]) || !validSpanId(m[2])) return null;
  return { traceId: m[1].toLowerCase(), parentSpanId: m[2].toLowerCase(), flags: m[3].toLowerCase() };
}
function startTrace(incoming) {
  const parent = parseTraceparent(incoming);
  const traceId = parent?.traceId || hex(16);
  const spanId = hex(8);
  const flags = parent?.flags || '01';
  return { traceId, spanId, parentSpanId: parent?.parentSpanId || null, traceparent: `00-${traceId}-${spanId}-${flags}` };
}
module.exports = { parseTraceparent, startTrace };
