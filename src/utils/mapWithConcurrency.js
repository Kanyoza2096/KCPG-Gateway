'use strict';

/**
 * Map items with a fixed number of workers while preserving input order.
 * A worker rejection rejects the operation; callers that need partial results
 * should handle failures inside the worker, as Command Center does.
 */
async function mapWithConcurrency(items, limit, mapper) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  if (typeof mapper !== 'function') throw new TypeError('mapper must be a function');

  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = mapWithConcurrency;
