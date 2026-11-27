'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-gateway-secret-which-is-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.IDENTITY_EXCHANGE_ENABLED = 'true';
process.env.PYTHON_SERVICE_TOKEN = 'test-python-service-token-which-is-long-enough';
process.env.PYTHON_CORE_BASE_URL = 'http://127.0.0.1:10000';
process.env.KCPG_CONTEXT_SIGNING_SECRET = 'test-kcpg-context-secret-that-is-long-enough';

const { createApp } = require('../../src/app');
const config = require('../../src/config');
const { COMMANDS } = require('../../src/contracts/commands');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: options.method || 'GET',
      path: options.path || '/',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: body });
      });
    });
    req.once('error', reject);
    if (options.body) req.end(JSON.stringify(options.body)); else req.end();
  });
}

let mockBackend;
let directorRuntimeHeaders = null;
let knowledgeReviewRuntimeHeaders = null;
test.before(() => {
  mockBackend = http.createServer((req, res) => {
    if (req.url === '/api/v1/auth/exchange' || req.url === '/api/v1/auth/workspace') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        if (req.url === '/api/v1/auth/exchange' && payload.password !== 'valid-password') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_credentials' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const readOnlyPrincipal = ['reader@example.test', 'no-read@example.test'].includes(payload.email);
          const adminPrincipal = ['admin@example.test', 'admin-writer@example.test'].includes(payload.email);
          const scopes = ['reader@example.test', 'admin@example.test'].includes(payload.email) ? ['control.read'] : payload.email === 'admin-writer@example.test' ? ['control.write', 'control.read'] : payload.email === 'no-read@example.test' ? [] : ['control.write', 'control.read', 'director.read', 'director.write'];
          res.end(JSON.stringify(req.url === '/api/v1/auth/workspace' ? {
            ok: true,
            principal_id: payload.principal_id,
            workspace_id: payload.workspace_id,
            role: 'operator',
            platformRole: null,
            platformPermissions: []
          } : {
            ok: true,
            sub: 'integration-user',
            role: adminPrincipal ? 'admin' : readOnlyPrincipal ? 'viewer' : 'operator',
            workspaceId: payload.workspace_id || 'workspace-1',
            scopes
          }));
        }
      });
    } else if (req.url.startsWith('/director/missions/')) {
      directorRuntimeHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mission_id: 'mission-a', workspace_id: req.headers['x-workspace-id'], events: [] }));
    } else if (req.url.startsWith('/api/v1/admin/knowledge/lightweight-review')) {
      knowledgeReviewRuntimeHeaders = req.headers;
      res.writeHead(req.headers['x-kcpg-context-actor-role'] === 'admin' ? 200 : 403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.headers['x-kcpg-context-actor-role'] === 'admin' ? { ok: true, read_only: true } : { detail: 'Human workspace administrator authority required' }));
    } else if (req.url.startsWith('/api/v1/business-activation/knowledge/read')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'COVERED', answerable: true }));
    } else if (req.url.startsWith('/api/v1/business-activation/extractions')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, extraction_id: 'extraction-1' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  mockBackend.listen(10000);
});

test.after(() => {
  if (mockBackend) mockBackend.close();
});

test('canonical routes are mounted and health is public', async () => {
  const { server, port } = await listen(createApp());
  try {
    const health = await request(port, { path: '/health/live' });
    assert.equal(health.status, 200);
    assert.equal(health.body.service, 'kcpg');

    const protectedRoute = await request(port, { path: '/api/v1/control-plane/overview' });
    assert.equal(protectedRoute.status, 401);
  } finally {
    server.close();
  }
});

test('session exchange creates an HttpOnly cookie and cookie authenticates subsequent requests', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    assert.equal(session.body.workspaceId, 'workspace-1');
    assert.equal(session.body.token, undefined, 'session JWT must not be exposed to browser JavaScript');
    assert.match(session.headers['set-cookie'][0], /HttpOnly/);
    assert.match(session.headers['set-cookie'][0], /SameSite=Lax/);

    const me = await request(port, {
      path: '/api/v1/auth/me',
      headers: { cookie: session.headers['set-cookie'][0].split(';')[0] },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.sub, 'integration-user');
    assert.equal(me.body.role, 'operator');
  } finally {
    server.close();
  }
});


test('login forwards a remembered workspace preference for backend authorization', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password', workspace_id: 'workspace-2' },
    });
    assert.equal(session.status, 200);
    assert.equal(session.body.workspaceId, 'workspace-2');
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const refreshed = await request(port, {
      path: '/api/v1/auth/session',
      headers: { cookie },
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.workspaceId, 'workspace-2');
  } finally {
    server.close();
  }
});

test('session authority comes from KDO, not browser-supplied role or scope fields', async () => {
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password', role: 'owner', scopes: ['*'] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.role, 'operator');
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);

    const legacy = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { credential: 'browser-token-is-no-longer-accepted' },
    });
    assert.equal(legacy.status, 400);
    assert.equal(legacy.headers['set-cookie'], undefined);
  } finally {
    server.close();
  }
});

test('workspace switch uses the existing HttpOnly session, not a browser identity token', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const switched = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session/workspace',
      headers: { origin: 'http://localhost:5173', cookie },
      body: { workspace_id: 'workspace-2' },
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.workspaceId, 'workspace-2');
    assert.match(switched.headers['set-cookie'][0], /HttpOnly/);
  } finally {
    server.close();
  }
});

test('session creation fails closed when canonical identity exchange is disabled', async () => {
  const previous = config.python.identityExchangeEnabled;
  config.python.identityExchangeEnabled = false;
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'IDENTITY_EXCHANGE_DISABLED');
    assert.equal(response.headers['set-cookie'], undefined);
  } finally {
    config.python.identityExchangeEnabled = previous;
    server.close();
  }
});

test('session creation fails closed when the service credential is missing', async () => {
  const previous = config.python.serviceToken;
  config.python.serviceToken = '';
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'IDENTITY_EXCHANGE_SERVICE_CREDENTIAL_MISSING');
    assert.equal(response.headers['set-cookie'], undefined);
  } finally {
    config.python.serviceToken = previous;
    server.close();
  }
});

test('session creation fails closed when the identity exchange backend is unavailable', async () => {
  const previous = config.python.baseUrl;
  config.python.baseUrl = 'http://127.0.0.1:1';
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, 'UPSTREAM_ERROR');
    assert.equal(response.headers['set-cookie'], undefined);
  } finally {
    config.python.baseUrl = previous;
    server.close();
  }
});

test('session exchange rejects invalid credentials', async () => {
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'wrong-password' },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.message, 'Invalid email or password');
  } finally {
    server.close();
  }
});

test('cross-origin state-changing requests are rejected', async () => {
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'https://evil.example' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
  }
});

test('command discovery exposes the registry authorization contract to Control Plane clients', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];

    const response = await request(port, {
      path: '/api/v1/commands',
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const command = response.body.commands.find((entry) => entry.id === 'api_key.generate');
    assert.ok(command, 'API-key generation command must be discoverable');
    assert.deepEqual(command.scopes, ['control.write', 'security.write']);
    assert.equal(command.minRole, 'owner');
    assert.equal(command.workspaceRequired, true);

    const factConfirmation = response.body.commands.find((entry) => entry.id === 'business_activation.facts.confirm');
    assert.ok(factConfirmation, 'Business Activation fact confirmation must be discoverable');
    assert.deepEqual(factConfirmation.scopes, ['control.write', 'knowledge.write']);
    assert.equal(factConfirmation.minRole, 'operator');
  } finally {
    server.close();
  }
});


test('Business Activation read POSTs require control.read while extraction remains an operator write', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'reader@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];

    const knowledge = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/knowledge/read',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', fact_type: 'business_knowledge', limit: 1 },
    });
    assert.equal(knowledge.status, 200);
    assert.equal(knowledge.body.status, 'COVERED');

    const crossWorkspaceRead = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/knowledge/read',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-2' },
      body: { workspace_id: 'workspace-2', fact_type: 'business_knowledge', limit: 1 },
    });
    assert.equal(crossWorkspaceRead.status, 403, 'read route cannot cross the authenticated workspace boundary');

    const extraction = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/extractions',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', operator_text: 'A local retail business', fact_types_in_scope: ['business_knowledge'] },
    });
    assert.equal(extraction.status, 403, 'viewer with read scope cannot create extraction records');

    const operatorSession = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'operator@example.test', password: 'valid-password' },
    });
    assert.equal(operatorSession.status, 200);
    const operatorCookie = operatorSession.headers['set-cookie'][0].split(';')[0];
    const operatorExtraction = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/extractions',
      headers: { origin: 'http://localhost:5173', cookie: operatorCookie, 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', operator_text: 'A local retail business', fact_types_in_scope: ['business_knowledge'] },
    });
    assert.equal(operatorExtraction.status, 200, 'operator with control.write may create extraction records');

    const unauthenticatedRead = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/knowledge/read',
      headers: { origin: 'http://localhost:5173', 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', fact_type: 'business_knowledge', limit: 1 },
    });
    assert.equal(unauthenticatedRead.status, 401, 'knowledge read still requires an authenticated gateway session');
  } finally {
    server.close();
  }
});

test('API-key generation command forwards requested scopes and bounded expiry fields', () => {
  const command = COMMANDS['api_key.generate'];
  assert.ok(command);
  assert.deepEqual(command.bodyKeys, ['label', 'scopes', 'expires_in_days', 'workspace_id']);
});



test('Director mission runtime proxy forwards a signed human actor envelope', async () => {
  directorRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      path: '/director/missions/mission-a/orchestration/timeline?limit=25',
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.workspace_id, 'workspace-1');
    assert.ok(directorRuntimeHeaders);
    assert.equal(directorRuntimeHeaders['x-kcpg-context-actor-id'], 'integration-user');
    assert.equal(directorRuntimeHeaders['x-kcpg-context-actor-role'], 'operator');
    assert.equal(directorRuntimeHeaders['x-kcpg-context-workspace-id'], 'workspace-1');
    assert.match(directorRuntimeHeaders['x-kcpg-context-signature'], /^[a-f0-9]{64}$/);
  } finally {
    server.close();
  }
});

test('Director mission runtime proxy denies viewer task assignment', async () => {
  directorRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'reader@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      method: 'POST',
      path: '/director/missions/mission-a/orchestration/tasks/task-a/assign',
      headers: { cookie },
      body: { engine_id: 'content_intelligence' },
    });
    assert.equal(response.status, 403);
    assert.equal(directorRuntimeHeaders, null);
  } finally {
    server.close();
  }
});


test('Director mission runtime mutations cannot bypass durable KCPG command transactions', async () => {
  directorRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      method: 'POST',
      path: '/director/missions/mission-a/orchestration/tasks/task-a/assign',
      headers: { cookie },
      body: { engine_id: 'content_intelligence' },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'DIRECTOR_RUNTIME_COMMAND_GATEWAY_REQUIRED');
    assert.equal(directorRuntimeHeaders, null);
  } finally {
    server.close();
  }
});


test('Director task approval and rejection cannot bypass durable KCPG command transactions', async () => {
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'integration@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    for (const decision of ['approve', 'reject']) {
      const response = await request(port, {
        method: 'POST',
        path: `/director/tasks/task-a/${decision}`,
        headers: { cookie },
        body: {},
      });
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'DIRECTOR_RUNTIME_COMMAND_GATEWAY_REQUIRED');
    }
  } finally {
    server.close();
  }
});


test('admin lightweight knowledge review is exposed as a read-only sensitive POST with signed human admin context', async () => {
  knowledgeReviewRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'admin@example.test', password: 'valid-password' },
    });
    assert.equal(session.status, 200);
    const cookie = session.headers['set-cookie'][0].split(';')[0];

    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/admin/knowledge/lightweight-review',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: {},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, read_only: true });
    assert.ok(knowledgeReviewRuntimeHeaders);
    assert.equal(knowledgeReviewRuntimeHeaders['x-kcpg-context-actor-id'], 'integration-user');
    assert.equal(knowledgeReviewRuntimeHeaders['x-kcpg-context-actor-role'], 'admin');
    assert.equal(knowledgeReviewRuntimeHeaders['x-kcpg-context-workspace-id'], 'workspace-1');
    assert.match(knowledgeReviewRuntimeHeaders['x-kcpg-context-signature'], /^[a-f0-9]{64}$/);
  } finally {
    server.close();
  }
});

test('admin lightweight knowledge review leaves administrator enforcement to KDO and rejects operator role', async () => {
  knowledgeReviewRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'operator@example.test', password: 'valid-password' },
    });
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/admin/knowledge/lightweight-review',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: {},
    });
    assert.equal(response.status, 403);
    assert.equal(knowledgeReviewRuntimeHeaders['x-kcpg-context-actor-role'], 'operator');
  } finally {
    server.close();
  }
});

test('admin lightweight knowledge review rejects cross-workspace context before forwarding', async () => {
  knowledgeReviewRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'admin@example.test', password: 'valid-password' },
    });
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/admin/knowledge/lightweight-review',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-2' },
      body: {},
    });
    assert.equal(response.status, 403);
    assert.equal(knowledgeReviewRuntimeHeaders, null);
  } finally {
    server.close();
  }
});

test('admin lightweight knowledge review requires an authenticated session', async () => {
  knowledgeReviewRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/admin/knowledge/lightweight-review',
      headers: { origin: 'http://localhost:5173', 'X-Workspace-ID': 'workspace-1' },
      body: {},
    });
    assert.equal(response.status, 401);
    assert.equal(knowledgeReviewRuntimeHeaders, null);
  } finally {
    server.close();
  }
});


test('admin lightweight knowledge review apply requires admin control.write and forwards signed human context', async () => {
  knowledgeReviewRuntimeHeaders = null;
  const { server, port } = await listen(createApp());
  try {
    const session = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'admin-writer@example.test', password: 'valid-password' },
    });
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/admin/knowledge/lightweight-review/apply',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: {},
    });
    assert.equal(response.status, 200);
    assert.equal(knowledgeReviewRuntimeHeaders['x-kcpg-context-actor-role'], 'admin');
  } finally {
    server.close();
  }
});
