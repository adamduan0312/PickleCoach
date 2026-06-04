import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { sequelize } from './models/index.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { logger } from './config/logger.js';
import { envSchema } from './config/validation.js';
import { startWorkers } from './workers/index.js';


/* this line is only used when there is just one general ".env" file 
dotenv.config();
*/

// Determine environment, default to 'development' if not set
const env = process.env.NODE_ENV || 'development';

// Load the corresponding .env file
dotenv.config({ path: `.env.${env}` });

// Validate environment variables
const { error: envError, value: envVars } = envSchema.validate(process.env);
if (envError) {
  logger.error('Environment validation error:', envError);
  process.exit(1);
} 

const app = express();
const port = envVars.PORT || 4000;

// Security middleware — CSP is a baseline; tighten scriptSrc when you add non-self assets/CDNs.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: avoid wildcard origin with credentials in production (browser behavior + security).
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

const corsAllowedOrigins = buildCorsOrigin();
const corsOptions = {
  origin: corsAllowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Compression
app.use(compression());

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID and logging
app.use(requestId);
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { requestId: req.id, ip: req.ip });
  next();
});

// Rate limiting (disabled in development for easier testing).
// General API is looser than /api/auth (login, register, refresh, password flows).
// TODO(horizontal scale): replace in-memory store with Redis — see middleware/rateLimiter.js
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_GENERAL = 200;
const RATE_LIMIT_AUTH = 40;
if (env !== 'development') {
  app.use('/api', rateLimiter(RATE_WINDOW_MS, RATE_LIMIT_GENERAL));
  app.use('/api/auth', rateLimiter(RATE_WINDOW_MS, RATE_LIMIT_AUTH));
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// API Routes
app.use('/api', routes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Database connection and server start
const startServer = async () => {
  try {
    logger.info('🔄 Starting server initialization...');
    logger.info('📊 Connecting to database...');
    await sequelize.authenticate();
    logger.info('✅ Database connection established successfully.');

    const server = app.listen(port, () => {
      logger.info(`🚀 API listening on http://localhost:${port}`);
      logger.info(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔒 Security: Helmet, CORS${env !== 'development' ? ', Rate Limiting' : ' (Rate Limiting disabled in development)'} enabled`);
    });

    // Start background workers
    if (process.env.NODE_ENV !== 'test') {
      startWorkers();
    }

    // Request timeout (30 seconds)
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

// Store server reference for graceful shutdown
let serverInstance = null;

startServer().then((server) => {
  serverInstance = server;
}).catch((err) => {
  logger.error('Server failed to start:', err);
  process.exit(1);
});

// Graceful shutdown: stop accepting requests first, then close DB
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

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

