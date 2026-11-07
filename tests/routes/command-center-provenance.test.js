'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../../src/routes/commandCenter.js'),
  'utf8',
);

test('workspace situation preserves the exact KDO-authored canonical evidence envelope', () => {
  assert.match(
    routeSource,
    /\['canonicalSituationEvidence', '\/api\/v1\/command-center\/situation'\]/,
  );
  assert.match(
    routeSource,
    /canonicalEvidence:\s*sources\.canonicalSituationEvidence\?\.data\s*\?\?\s*null/,
  );
  assert.match(
    routeSource,
    /fingerprint attests only to canonicalEvidence, not to the aggregate projection/,
  );
});
