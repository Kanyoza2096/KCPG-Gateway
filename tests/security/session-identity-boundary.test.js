'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('browser session route has no local JWT decode or metadata fallback', () => {
  const session = read('src/routes/session.js');
  assert.doesNotMatch(session, /jwt\.decode\s*\(/);
  assert.match(session, /Canonical identity exchange is the only trust boundary/);
  assert.match(session, /return next\(err\)/);
});

test('identity exchange is mandatory in production', () => {
  const config = read('src/config/index.js');
  assert.match(config, /IDENTITY_EXCHANGE_ENABLED must be true in production/);
  assert.match(config, /PYTHON_SERVICE_TOKEN must be set to a strong credential/);
});

test('identity exchange failures cannot produce a gateway session', () => {
  const session = read('src/routes/session.js');
  assert.match(session, /IDENTITY_EXCHANGE_DISABLED/);
  assert.match(session, /IDENTITY_EXCHANGE_SERVICE_CREDENTIAL_MISSING/);
  assert.match(session, /new UnauthorizedError\('Credential validation failed'\)/);
  assert.match(session, /new UpstreamError\('Canonical identity exchange backend is unavailable'/);
  assert.doesNotMatch(session, /falling back to local decode/i);
});
