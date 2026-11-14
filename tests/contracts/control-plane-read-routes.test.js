'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bff = fs.readFileSync('src/routes/bff.js', 'utf8');
const readPrefixes = bff.match(/const READ_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';
const sensitivePrefixes = bff.match(/const SENSITIVE_READ_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';
const mutationPrefixes = bff.match(/const MUTATION_PREFIXES = \[([\s\S]*?)\];/)?.[1] || '';

const readOnlyEvidencePrefixes = [
  '/outbox',
  '/decisions',
  '/connectors',
  '/sector-packs',
  '/ai-control-plane',
  '/failure-recovery',
];

test('authoritative evidence read surfaces are explicitly exposed', () => {
  for (const prefix of readOnlyEvidencePrefixes) {
    assert.match(readPrefixes, new RegExp(`['"]\\${prefix}['"]`), `missing read allowlist: ${prefix}`);
  }
});

test('authoritative evidence reads require the control.read scope', () => {
  for (const prefix of readOnlyEvidencePrefixes) {
    assert.match(sensitivePrefixes, new RegExp(`['"]\\${prefix}['"]`), `missing sensitive-read gate: ${prefix}`);
  }
});

test('read-only evidence prefixes do not silently gain mutation authority', () => {
  for (const prefix of readOnlyEvidencePrefixes) {
    assert.doesNotMatch(mutationPrefixes, new RegExp(`['"]\\${prefix}['"]`), `unexpected mutation allowlist: ${prefix}`);
  }
});

test('social-account reads remain owner-scoped and sensitive', () => {
  assert.match(readPrefixes, /'\/social-accounts'/);
  assert.match(sensitivePrefixes, /'\/social-accounts'/);
  assert.match(mutationPrefixes, /'\/social-accounts'/);
  assert.match(bff, /OWNER_MUTATION_PREFIXES/);
});
