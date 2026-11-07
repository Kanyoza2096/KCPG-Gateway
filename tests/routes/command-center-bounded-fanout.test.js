'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mapWithConcurrency = require('../../src/utils/mapWithConcurrency');

test('mapWithConcurrency never exceeds its worker limit', async () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  let active = 0;
  let maximumActive = 0;

  const results = await mapWithConcurrency(items, 4, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });

  assert.equal(maximumActive, 4);
  assert.deepEqual(results, items.map((value) => value * 2));
});

test('mapWithConcurrency preserves input order when work completes out of order', async () => {
  const results = await mapWithConcurrency([30, 10, 20], 3, async (delay, index) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return index;
  });

  assert.deepEqual(results, [0, 1, 2]);
});

test('mapWithConcurrency handles empty input without starting workers', async () => {
  const results = await mapWithConcurrency([], 8, async () => {
    throw new Error('mapper should not run');
  });

  assert.deepEqual(results, []);
});

test('mapWithConcurrency rejects invalid concurrency limits', async () => {
  await assert.rejects(() => mapWithConcurrency([1], 0, async (value) => value), RangeError);
  await assert.rejects(() => mapWithConcurrency([1], 1.5, async (value) => value), RangeError);
});

test('a failed source can be represented as an explicit partial result', async () => {
  const results = await mapWithConcurrency(['healthy', 'failed', 'healthy-again'], 2, async (source) => {
    try {
      if (source === 'failed') throw new Error('upstream timeout');
      return { source, ok: true };
    } catch {
      return { source, ok: false, state: 'unreachable' };
    }
  });

  assert.deepEqual(results, [
    { source: 'healthy', ok: true },
    { source: 'failed', ok: false, state: 'unreachable' },
    { source: 'healthy-again', ok: true },
  ]);
});
