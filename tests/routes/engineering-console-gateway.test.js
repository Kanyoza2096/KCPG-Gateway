'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-gateway-secret-which-is-long-enough';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.PYTHON_CORE_BASE_URL = 'http://127.0.0.1:10000';
process.env.PYTHON_SERVICE_TOKEN = 'test-internal-service-token';
process.env.KCPG_CONTEXT_SIGNING_SECRET = 'test-context-signing-secret-long-enough';

const { createApp } = require('../../src/app');
const config = require('../../src/config');

function listen(app, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.once('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

function token(role = 'operator', workspaceId = 'workspace-1') {
  return jwt.sign({ sub: 'actor-123', email: 'actor@example.test', role, workspace_id: workspaceId }, config.auth.jwtSecret,
    { algorithm: 'HS256', audience: config.auth.audience });
}

let upstream;
let gateway;
let upstreamRequests = [];
test.before(async () => {
  upstream = await listen(http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString(); });
    req.on('end', () => {
      upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      const response = req.url.startsWith('/api/v1/engineering/console/tasks')
        ? { task_id: 'task-1', status: 'proposed', revision: 1 }
        : { provider_configured: true, database_connected: true, dynamic_agent_planning: false };
      res.writeHead(req.method === 'POST' && req.url.endsWith('/tasks') ? 202 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  }), 10000);
  gateway = await listen(createApp());
});

test.after(async () => {
  if (gateway?.server) await new Promise((resolve) => gateway.server.close(resolve));
  if (upstream?.server) await new Promise((resolve) => upstream.server.close(resolve));
});

test('engineering capabilities are explicitly forwarded with signed actor and workspace context', async () => {
  const response = await request(gateway.port, {
    path: '/api/v1/engineering/console/capabilities',
    headers: { authorization: `Bearer ${token()}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider_configured, true);
  const forwarded = upstreamRequests.at(-1);
  assert.equal(forwarded.url, '/api/v1/engineering/console/capabilities?workspace_id=workspace-1');
  assert.equal(forwarded.headers['x-kcpg-context-actor-id'], 'actor-123');
  assert.equal(forwarded.headers['x-kcpg-context-workspace-id'], 'workspace-1');
  assert.match(forwarded.headers['x-kcpg-context-signature'], /^[a-f0-9]{64}$/);
  assert.equal(forwarded.headers.authorization, 'Bearer test-internal-service-token');
});

test('task intake forwards server-selected workspace and rejects browser workspace spoofing', async () => {
  const before = upstreamRequests.length;
  const denied = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks',
    headers: { authorization: `Bearer ${token()}` },
    body: { objective: 'Create a safe feature', workspace_id: 'another-workspace' },
  });
  assert.equal(denied.status, 403);
  assert.equal(upstreamRequests.length, before);

  const accepted = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks',
    headers: { authorization: `Bearer ${token()}` },
    body: { objective: 'Create a safe feature', acceptance_criteria: ['Tests pass'], idempotency_key: 'task-request-1' },
  });
  assert.equal(accepted.status, 202);
  const forwarded = upstreamRequests.at(-1);
  assert.equal(forwarded.body.workspace_id, 'workspace-1');
  assert.equal(forwarded.body.objective, 'Create a safe feature');
  assert.equal(forwarded.headers['x-kcpg-context-actor-id'], 'actor-123');
});

test('viewer cannot mutate engineering tasks', async () => {
  const before = upstreamRequests.length;
  const response = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks',
    headers: { authorization: `Bearer ${token('viewer')}` },
    body: { objective: 'Should be denied' },
  });
  assert.equal(response.status, 403);
  assert.equal(upstreamRequests.length, before);
});

test('plan review decisions require a positive expected revision', async () => {
  const response = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks/task-1/decision',
    headers: { authorization: `Bearer ${token()}` },
    body: { decision: 'approve', expected_revision: 0 },
  });
  assert.equal(response.status, 400);
});


test('AI plan generation is operator-gated and forwards only the server-selected workspace', async () => {
  const before = upstreamRequests.length;
  const denied = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks/task-1/plan/generate',
    headers: { authorization: `Bearer ${token('viewer')}` },
  });
  assert.equal(denied.status, 403);
  assert.equal(upstreamRequests.length, before);

  const accepted = await request(gateway.port, {
    method: 'POST', path: '/api/v1/engineering/console/tasks/task-1/plan/generate',
    headers: { authorization: `Bearer ${token()}` },
  });
  assert.equal(accepted.status, 200);
  const forwarded = upstreamRequests.at(-1);
  assert.equal(forwarded.url, '/api/v1/engineering/console/tasks/task-1/plan/generate');
  assert.equal(JSON.parse(forwarded.body).workspace_id, 'workspace-1');
  assert.equal(forwarded.headers['x-kcpg-context-actor-id'], 'actor-123');
});
