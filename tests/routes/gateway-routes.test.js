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
        } else if (req.url === '/api/v1/business-activation/knowledge/read') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'COVERED', answerable: true }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const readOnlyPrincipal = ['reader@example.test', 'no-read@example.test'].includes(payload.email);
          const scopes = payload.email === 'reader@example.test' ? ['control.read'] : payload.email === 'no-read@example.test' ? [] : ['control.write', 'control.read'];
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
            role: readOnlyPrincipal ? 'viewer' : 'operator',
            workspaceId: 'workspace-1',
            scopes
          }));
        }
      });
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

    const extraction = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/extractions',
      headers: { origin: 'http://localhost:5173', cookie, 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', operator_text: 'A local retail business', fact_types_in_scope: ['business_knowledge'] },
    });
    assert.equal(extraction.status, 403, 'viewer with read scope cannot create extraction records');

    const noReadSession = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { email: 'no-read@example.test', password: 'valid-password' },
    });
    assert.equal(noReadSession.status, 200);
    const noReadCookie = noReadSession.headers['set-cookie'][0].split(';')[0];
    const deniedRead = await request(port, {
      method: 'POST',
      path: '/api/v1/business-activation/knowledge/read',
      headers: { origin: 'http://localhost:5173', cookie: noReadCookie, 'X-Workspace-ID': 'workspace-1' },
      body: { workspace_id: 'workspace-1', fact_type: 'business_knowledge', limit: 1 },
    });
    assert.equal(deniedRead.status, 403, 'knowledge read requires control.read');
  } finally {
    server.close();
  }
});

test('API-key generation command forwards requested scopes and bounded expiry fields', () => {
  const command = COMMANDS['api_key.generate'];
  assert.ok(command);
  assert.deepEqual(command.bodyKeys, ['label', 'scopes', 'expires_in_days', 'workspace_id']);
});

