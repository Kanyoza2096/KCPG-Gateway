'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sessionSource = fs.readFileSync(path.join(root, 'src/routes/session.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'src/config/index.js'), 'utf8');

 test('KCPG identity exchange uses the canonical nested configuration flag', () => {
  assert.match(sessionSource, /config\.python\.identityExchangeEnabled/);
  assert.doesNotMatch(sessionSource, /config\.identityExchangeEnabled/);
});

test('KCPG identity exchange calls backend auth exchange, not context/me', () => {
  assert.match(sessionSource, /axios\.post\(`\$\{config\.python\.baseUrl\}\/api\/v1\/auth\/exchange`/);
  assert.match(sessionSource, /access_token:\s*token/);
  assert.doesNotMatch(sessionSource, /\/api\/v1\/context\/me/);
});

test('KCPG authenticates the internal exchange with the Python service credential', () => {
  assert.match(sessionSource, /Authorization:\s*`Bearer \$\{config\.python\.serviceToken\}`/);
  assert.match(sessionSource, /if \(!config\.python\.serviceToken\)/);
});

test('backend-facing exchange contract remains POST /api/v1/auth/exchange', () => {
  assert.match(configSource, /identityExchangeEnabled:\s*env\.IDENTITY_EXCHANGE_ENABLED/);
  assert.match(sessionSource, /payload\?\.workspace_id \|\| payload\?\.workspaceId/);
  assert.match(sessionSource, /payload\?\.principal_id \|\| payload\?\.sub/);
});
