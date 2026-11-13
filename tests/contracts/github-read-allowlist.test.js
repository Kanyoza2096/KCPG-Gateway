'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bff = fs.readFileSync('src/routes/bff.js', 'utf8');

test('GitHub connector read routes are explicitly exposed through the BFF', () => {
  const readPrefixes = bff.match(/const READ_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.match(readPrefixes, /'\/github'/);
});

test('GitHub connector reads require the sensitive-read scope', () => {
  const sensitivePrefixes = bff.match(/const SENSITIVE_READ_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.match(sensitivePrefixes, /'\/github'/);
});

test('GitHub connector remains read-only through the BFF mutation allowlist', () => {
  const mutationPrefixes = bff.match(/const MUTATION_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(mutationPrefixes, /'\/github'/);
});
