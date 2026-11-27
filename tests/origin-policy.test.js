'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedOrigin } = require('../src/utils/originPolicy');

test('allows the exact KDO Render Command Center HTTPS origin', () => {
  assert.equal(isAllowedOrigin('https://kdo-commad-center.onrender.com'), true);
});

test('does not trust arbitrary Render subdomains', () => {
  assert.equal(isAllowedOrigin('https://another-app.onrender.com'), false);
  assert.equal(isAllowedOrigin('https://kdo-command-center.onrender.com'), false);
});

test('does not trust insecure or non-origin variants of the Render hostname', () => {
  assert.equal(isAllowedOrigin('http://kdo-commad-center.onrender.com'), false);
  assert.equal(isAllowedOrigin('https://kdo-commad-center.onrender.com:444'), false);
  assert.equal(isAllowedOrigin('https://kdo-commad-center.onrender.com/path'), false);
});

test('preserves the existing KDO Cloudflare Pages trust rule', () => {
  assert.equal(isAllowedOrigin('https://kdo-command-center.pages.dev'), true);
  assert.equal(isAllowedOrigin('https://preview.kdo-command-center.pages.dev'), true);
});

test('continues to reject wildcard configured origins', () => {
  assert.equal(isAllowedOrigin('https://untrusted.example', ['*']), false);
});
