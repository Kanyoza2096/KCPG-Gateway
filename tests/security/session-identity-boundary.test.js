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
  assert.match(session, /identity exchange is the only trust boundary/);
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

test('platform authority is carried only from canonical exchange into a human gateway session', () => {
  const session = read('src/routes/session.js');
  const token = read('src/utils/token.js');
  assert.match(session, /payload\.platformRole/);
  assert.match(session, /platform_role:\s*\['super_admin', 'operator'\]/);
  assert.match(session, /principal_type:\s*'human'/);
  assert.match(token, /platformRole:\s*\['super_admin', 'operator'\]/);
  assert.match(token, /principalType:\s*payload\.principal_type === 'machine' \? 'machine' : 'human'/);
});

test('platform scope requires an explicit human platform grant, not wildcard workspace scopes', () => {
  const middleware = read('src/middleware/auth.js');
  const commandCenter = read('src/routes/commandCenter.js');
  const roles = read('src/contracts/roles.js');
  assert.match(middleware, /function requirePlatformRole/);
  assert.match(middleware, /req\.user\?\.platformRole !== 'super_admin'/);
  assert.match(commandCenter, /req\.user\?\.principalType === 'human'/);
  assert.match(commandCenter, /req\.user\?\.platformRole/);
  assert.doesNotMatch(commandCenter, /scopes\?\.includes\('\*'\) \|\| req\.user\?\.scopes\?\.includes\('species'\)/);
  assert.match(roles, /if \(user === 'species' \|\| minimum === 'species'\) return user === minimum/);
});

test('platform super admin receives full platform admission while workspace owner remains scoped', () => {
  const session = read('src/routes/session.js');
  const middleware = read('src/middleware/auth.js');
  const token = read('src/utils/token.js');
  assert.match(session, /if \(platformRole === 'super_admin'\) scopes\.push\('\*'\)/);
  assert.match(token, /payload\.platform_role === 'super_admin'\) resolved\.push\('\*'\)/);
  assert.match(middleware, /req\.user\.principalType === 'human' && req\.user\.platformRole === 'super_admin'/);
  assert.match(middleware, /req\.user\?\.platformRole !== 'super_admin'/);
});

test('global guardian controls are reserved for platform super admin', () => {
  const authority = read('src/routes/authority.js');
  assert.match(authority, /router\.post\('\/guardian\/lock', requireAuth, requirePlatformRole\('super_admin'\)/);
  assert.match(authority, /router\.post\('\/guardian\/unlock', requireAuth, requirePlatformRole\('super_admin'\)/);
  assert.doesNotMatch(authority, /router\.post\('\/guardian\/(?:lock|unlock)', requireAuth, requireRole\('owner'\)/);
});

test('command execution cannot use workspace wildcard to cross tenants', () => {
  const policy = read('src/services/commandPolicy.js');
  assert.match(policy, /const isPlatformSuperAdmin = user\.principalType === 'human' && user\.platformRole === 'super_admin'/);
  assert.match(policy, /requestedWorkspace && !allowedWorkspaces\.has\(requestedWorkspace\) && !isPlatformSuperAdmin/);
  assert.doesNotMatch(policy, /requestedWorkspace && !allowedWorkspaces\.has\(requestedWorkspace\) && !user\.scopes\?\.includes\('\*'\)/);
});
