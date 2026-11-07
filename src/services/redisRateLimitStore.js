'use strict';

const Redis = require('ioredis');
const config = require('../config');

/** Fixed-window Redis store for express-rate-limit v7+. */
class RedisRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.client = null;
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async start() {
    if (this.client) return;
    this.client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await this.client.connect();
    if (this.client.status !== 'ready') throw new Error('Redis rate-limit store not ready');
  }

  async increment(key) {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Redis rate-limit store unavailable');
    }
    const redisKey = `${this.prefix}:${key}`;
    const count = await this.client.incr(redisKey);
    if (count === 1) await this.client.pexpire(redisKey, this.windowMs);
    const ttl = await this.client.pttl(redisKey);
    return { totalHits: Number(count), resetTime: new Date(Date.now() + Math.max(0, Number(ttl))) };
  }

  async decrement(key) {
    if (!this.client || this.client.status !== 'ready') return;
    await this.client.decr(`${this.prefix}:${key}`);
  }

  async resetKey(key) {
    if (!this.client || this.client.status !== 'ready') return;
    await this.client.del(`${this.prefix}:${key}`);
  }

  async shutdown() {
    if (!this.client) return;
    await this.client.quit();
    this.client = null;
  }
}

const globalStore = new RedisRateLimitStore('kcpg:rl:global');
const commandStore = new RedisRateLimitStore('kcpg:rl:command');
const authStore = new RedisRateLimitStore('kcpg:rl:auth');

async function startRateLimitStores() {
  if (!config.isProd) return true;
  await globalStore.start();
  await commandStore.start();
  await authStore.start();
  return true;
}

async function stopRateLimitStores() {
  await Promise.allSettled([globalStore.shutdown(), commandStore.shutdown(), authStore.shutdown()]);
}

module.exports = { globalStore, commandStore, authStore, startRateLimitStores, stopRateLimitStores };
