'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedOrigin } = require('../../src/utils/originPolicy');

test('allows the canonical KDO Command Center Pages domain and project previews', () => {
  assert.equal(isAllowedOrigin('https://kdo-command-center.pages.dev'), true);
  assert.equal(isAllowedOrigin('https://16880719.kdo-command-center.pages.dev'), true);
  assert.equal(isAllowedOrigin('https://feature-branch.kdo-command-center.pages.dev'), true);
});

test('does not allow unrelated Cloudflare Pages projects or nested lookalike hosts', () => {
  assert.equal(isAllowedOrigin('https://attacker.pages.dev'), false);
  assert.equal(isAllowedOrigin('https://kdo-command-center.pages.dev.attacker.test'), false);
  assert.equal(isAllowedOrigin('https://nested.preview.kdo-command-center.pages.dev'), false);
  assert.equal(isAllowedOrigin('https://kdo-command-center.pages.dev.evil'), false);
});

test('requires HTTPS and rejects ports, credentials, paths, and malformed origins', () => {
  assert.equal(isAllowedOrigin('http://16880719.kdo-command-center.pages.dev'), false);
  assert.equal(isAllowedOrigin('https://16880719.kdo-command-center.pages.dev:8443'), false);
  assert.equal(isAllowedOrigin('https://user@16880719.kdo-command-center.pages.dev'), false);
  assert.equal(isAllowedOrigin('https://16880719.kdo-command-center.pages.dev/path'), false);
  assert.equal(isAllowedOrigin('not-an-origin'), false);
});

test('supports exact configured HTTPS origins but never treats wildcard as permission', () => {
  assert.equal(isAllowedOrigin('https://control.example.com', ['https://control.example.com']), true);
  assert.equal(isAllowedOrigin('https://attacker.example.com', ['*']), false);
  assert.equal(isAllowedOrigin('https://control.example.com', ['http://control.example.com']), false);
});

test('allows requests without an Origin header for server-to-server clients', () => {
  assert.equal(isAllowedOrigin(undefined), true);
});
