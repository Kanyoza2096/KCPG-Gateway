'use strict';

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { UpstreamError } = require('../utils/errors');
const metrics = require('./metrics');

/**
 * HTTP client for the Python autonomous core.
 *
 * Auth model: the gateway uses a dedicated internal service credential.
 * The browser/operator credential is never forwarded to Python.
 *   X-Workspace-ID: optional workspace scope for species/master token
 *   X-Request-Id: correlation
 *
 */
const client = axios.create({
  baseURL: config.python.baseUrl,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.python.serviceToken}`,
    'User-Agent': `kcpg/${config.version}`,
  },
  validateStatus: () => true,
});

/**
 * Call Python autonomous core.
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.path
 * @param {object} [opts.body]
 * @param {object} [opts.query]
 * @param {string} [opts.requestId]
 * @param {object} [opts.user] - gateway user claims (workspace scoping)
 * @param {number} [opts.timeout]
 * @param {string} [opts.commandId] - gateway transaction id for end-to-end verification
 */
async function callPython({ method = 'GET', path, body, query, requestId, user, timeout, traceparent, commandId, gatewayContext }) {
  const headers = {};
  if (requestId) {
    headers['X-Request-Id'] = requestId;
    headers['X-Correlation-ID'] = requestId;
  }
  if (traceparent) headers['traceparent'] = String(traceparent);
  if (commandId) headers['X-Command-ID'] = String(commandId);
  if (gatewayContext) {
    const secret = config.python.contextSigningSecret;
    if (!secret || secret.length < 32) {
      const err = new Error('KCPG_CONTEXT_SIGNING_SECRET is required for trusted gateway context forwarding');
      err.code = 'KCPG_CONTEXT_SIGNING_SECRET_MISSING';
      throw err;
    }
    const timestamp = String(Date.now());
    const actorId = String(gatewayContext.actorId || '');
    const actorRole = String(gatewayContext.actorRole || 'viewer');
    const workspaceId = String(gatewayContext.workspaceId || '');
    const contextRequestId = String(gatewayContext.requestId || requestId || '');
    if (!actorId || !workspaceId || !contextRequestId) {
      const err = new Error('Incomplete trusted gateway context');
      err.code = 'KCPG_CONTEXT_INCOMPLETE';
      throw err;
    }
    const canonical = [timestamp, contextRequestId, workspaceId, actorId, actorRole].join('|');
    headers['X-KCPG-Context-Timestamp'] = timestamp;
    headers['X-KCPG-Context-Request-ID'] = contextRequestId;
    headers['X-KCPG-Context-Workspace-ID'] = workspaceId;
    headers['X-KCPG-Context-Actor-ID'] = actorId;
    headers['X-KCPG-Context-Actor-Role'] = actorRole;
    headers['X-KCPG-Context-Signature'] = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  }
  if (user?.sub) headers['X-User-Id'] = String(user.sub);
  if (user?.role) headers['X-User-Role'] = String(user.role);

  // Workspace is selected by the gateway after authorization. Never let the upstream
  // client silently replace a valid secondary workspace with the user's primary one.
  const workspaceId = user?.__requestWorkspaceId || user?.workspaceId || null;
  if (workspaceId) {
    headers['X-Workspace-ID'] = String(workspaceId);
    headers['X-Workspace-Id'] = String(workspaceId);
  }

  const started = process.hrtime.bigint();
  try {
    const res = await client.request({
      method,
      url: path,
      data: body,
      params: query,
      headers,
      timeout: timeout || 30_000,
    });

    metrics.observeUpstream({ durationMs: Number(process.hrtime.bigint() - started) / 1e6, statusCode: res.status });

    if (res.status >= 500) {
      logger.error('python_upstream_5xx', {
        path,
        status: res.status,
        requestId,
      });
      throw new UpstreamError('Python core error', {
        status: res.status,
        data: res.data,
      });
    }

    return {
      status: res.status,
      data: res.data,
      headers: res.headers,
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    metrics.observeUpstream({ durationMs: Number(process.hrtime.bigint() - started) / 1e6, statusCode: 0, failed: true });
    logger.error('python_upstream_unreachable', {
      path,
      message: err.message,
      requestId,
    });
    throw new UpstreamError('Python core unreachable', { cause: err.message });
  }
}

async function ping() {
  try {
    const res = await client.get('/health/live', { timeout: 5_000 });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Public uplink used by Control Plane connection tests */
async function publicStatus() {
  try {
    const res = await client.get('/api/v1/status', { timeout: 8_000 });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      data: res.data,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

module.exports = {
  callPython,
  ping,
  publicStatus,
};
