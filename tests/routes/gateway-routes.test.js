'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-gateway-secret-which-is-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:5173';

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
