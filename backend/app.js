/**
 * Express application factory (no listen). Used by server.js and HTTP integration tests.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { sequelize } from './models/index.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { logger } from './config/logger.js';

/**
 * @param {{ env?: string }} [options]
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const env = options.env || process.env.NODE_ENV || 'development';
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  function buildCorsOrigin() {
    const raw = process.env.FRONTEND_URL;
    if (raw && String(raw).trim()) {
      return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (env === 'development' || env === 'test') {
      return true;
    }
    logger.warn(
      'CORS: FRONTEND_URL is unset in production — falling back to permissive origin. Set FRONTEND_URL (comma-separated allowlist) for a strict deployment.',
    );
    return true;
  }

  app.use(
    cors({
      origin: buildCorsOrigin(),
      credentials: true,
      optionsSuccessStatus: 200,
    }),
  );

  app.use(compression());

  // Stripe webhooks need the raw body for signature verification (before express.json).
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(requestId);
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { requestId: req.id, ip: req.ip });
    next();
  });

  const RATE_WINDOW_MS = 15 * 60 * 1000;
  const RATE_LIMIT_GENERAL = 200;
  const RATE_LIMIT_AUTH = 40;
  if (env !== 'development' && env !== 'test') {
    app.use('/api', rateLimiter(RATE_WINDOW_MS, RATE_LIMIT_GENERAL));
    app.use('/api/auth', rateLimiter(RATE_WINDOW_MS, RATE_LIMIT_AUTH));
  }

  app.get('/health', async (req, res) => {
    try {
      await sequelize.authenticate();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
        uptime: process.uptime(),
      });
    } catch {
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      });
    }
  });

  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
