import dotenv from 'dotenv';
import { createApp } from './app.js';
import { sequelize } from './models/index.js';
import { logger } from './config/logger.js';
import { envSchema } from './config/validation.js';
import { startWorkers } from './workers/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const { error: envError, value: envVars } = envSchema.validate(process.env);
if (envError) {
  logger.error('Environment validation error:', envError);
  process.exit(1);
}

const app = createApp({ env });
const port = envVars.PORT || 4000;

const startServer = async () => {
  try {
    logger.info('🔄 Starting server initialization...');
    logger.info('📊 Connecting to database...');
    await sequelize.authenticate();
    logger.info('✅ Database connection established successfully.');

    const server = app.listen(port, () => {
      logger.info(`🚀 API listening on http://localhost:${port}`);
      logger.info(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(
        `🔒 Security: Helmet, CORS${env !== 'development' && env !== 'test' ? ', Rate Limiting' : ' (Rate Limiting disabled in development/test)'} enabled`,
      );
    });

    if (process.env.NODE_ENV !== 'test') {
      startWorkers();
    }

    server.timeout = 30000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    logger.info('✅ Server initialization complete - ready to accept requests');
    logger.info('📡 Health check available at: http://localhost:' + port + '/health');

    return server;
  } catch (error) {
    logger.error('Unable to start server:', error);
    process.exit(1);
  }
};

let serverInstance = null;

// Allow HTTP integration harness to import createApp without listening.
if (process.env.SKIP_SERVER_LISTEN !== '1') {
  startServer()
    .then((server) => {
      serverInstance = server;
    })
    .catch((err) => {
      logger.error('Server failed to start:', err);
      process.exit(1);
    });
}

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} signal received: starting graceful shutdown`);

  try {
    if (serverInstance) {
      await new Promise((resolve) => {
        serverInstance.close(() => {
          logger.info('HTTP server closed.');
          resolve();
        });
      });
    }
    await sequelize.close();
    logger.info('Database connection closed.');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export { app, createApp };
