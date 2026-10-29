'use strict';
const { startTrace } = require('../utils/trace');
function tracing(req, res, next) {
  const trace = startTrace(req.get('traceparent'));
  req.trace = trace;
  res.setHeader('traceparent', trace.traceparent);
  res.setHeader('X-Trace-ID', trace.traceId);
  next();
}
module.exports = { tracing };
