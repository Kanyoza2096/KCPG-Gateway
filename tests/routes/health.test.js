'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../../src/app');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
        });
      })
      .on('error', reject);
  });
}

describe('health routes', () => {
  it('GET /health/live returns ok', async () => {
    process.env.AUTH_DISABLED = 'true';
    process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
    process.env.PYTHON_INTERNAL_TOKEN = 'test-internal-token';

    // Re-require config is already loaded; app uses existing process env via dotenv at first load.
    const app = createApp();
    const { server, port } = await listen(app);
    try {
      const res = await get(port, '/health/live');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.service, 'kcpg');
    } finally {
      server.close();
    }
  });
});
