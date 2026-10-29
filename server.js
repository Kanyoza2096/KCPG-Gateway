'use strict';

const http = require('http');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { createApp } = require('./src/app');
const { createSocketServer } = require('./src/socket');
const eventBus = require('./src/services/eventBus');
const { startRateLimitStores, stopRateLimitStores } = require('./src/services/redisRateLimitStore');
const commandTransactions = require('./src/services/commandTransaction');
const resourceState = require('./src/services/resourceState');

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  createSocketServer(server);

  const redisOk = await eventBus.start();
  if (config.isProd) await startRateLimitStores();
  if (!redisOk) {
    if (config.isProd && config.redis.required) {
      throw new Error('Redis is required in production but could not be initialized');
    }
    logger.warn('starting_without_redis', {
      hint: 'Realtime fan-out is development-only without Redis',
    });
  }

  server.listen(config.port, () => {
    logger.info('kcpg_listening', {
      port: config.port,
      env: config.nodeEnv,
      python: config.python.baseUrl,
      authDisabled: config.auth.disabled,
    });
  });

  const shutdown = async (signal) => {
    logger.info('shutdown', { signal });
    server.close(async () => {
      await eventBus.stop();
      await commandTransactions.close();
      await resourceState.close();
      await stopRateLimitStores();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('fatal_startup', { message: err.message, stack: err.stack });
  process.exit(1);
});
