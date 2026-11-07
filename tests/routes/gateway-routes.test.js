'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-gateway-secret-which-is-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.IDENTITY_EXCHANGE_ENABLED = 'true';
process.env.PYTHON_SERVICE_TOKEN = 'test-python-service-token-which-is-long-enough';
process.env.PYTHON_CORE_BASE_URL = 'http://127.0.0.1:10000';

const { createApp } = require('../../src/app');
const config = require('../../src/config');

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
    if (req.url === '/api/v1/auth/exchange') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        if (payload.access_token === 'not-a-jwt' || String(payload.access_token || '').endsWith('.')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_token' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            sub: 'integration-user',
            role: 'operator',
            workspaceId: 'workspace-1',
            scopes: ['control.write', 'control.read']
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

function token(claims = {}) {
  return jwt.sign({
    sub: 'integration-user',
    email: 'integration@example.test',
    role: 'operator',
    workspace_id: 'workspace-1',
    scopes: ['control.write', 'control.read'],
    ...claims,
  }, config.auth.jwtSecret, { algorithm: 'HS256', audience: config.auth.audience });
}

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
      body: { credential: token() },
    });
    assert.equal(session.status, 200);
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

test('session exchange never accepts an unsigned JWT or user-editable role metadata', async () => {
  const { server, port } = await listen(createApp());
  try {
    const forged = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }).replace(/\s/g, '')).toString('base64url')
      + '.' + Buffer.from(JSON.stringify({
        sub: 'attacker',
        app_metadata: { role: 'owner', workspace_id: 'victim-workspace' },
        user_metadata: { role: 'owner', workspace_id: 'victim-workspace' },
      })).toString('base64url') + '.';
    const response = await request(port, {
      method: 'POST',
      path: '/api/v1/auth/session',
      headers: { origin: 'http://localhost:5173' },
      body: { credential: forged },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.message, 'Credential validation failed');
    assert.equal(response.headers['set-cookie'], undefined);
    // The unsigned JWT shape above documents the exact class of credential that
    // must never be locally decoded into a gateway session.
    assert.equal(jwt.decode(forged)?.app_metadata.role, 'owner');
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
      body: { credential: token({ role: 'owner', app_metadata: { role: 'owner' } }) },
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
      body: { credential: token() },
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
      body: { credential: token() },
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
      body: { credential: 'not-a-jwt' },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Credential validation failed');
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
      body: { credential: token() },
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
  }
});
