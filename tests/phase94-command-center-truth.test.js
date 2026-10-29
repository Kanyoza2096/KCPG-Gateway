'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('command center uses canonical systemHealth key for critical posture', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'commandCenter.js'), 'utf8');
  assert.match(file, /\['systemHealth',\s*'\/api\/v1\/system\/health'\]/);
  assert.match(file, /const critical = \['systemHealth', 'deepHealth', 'status', 'organismVitals'\];/);
  assert.doesNotMatch(file, /const critical = \['system', 'deepHealth', 'status', 'organismVitals'\];/);
});
