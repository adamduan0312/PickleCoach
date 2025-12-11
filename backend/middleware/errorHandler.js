import { logger } from '../config/logger.js';

export const errorHandler = (err, req, res, next) => {
  const requestId = req.id || 'unknown';
  
  // Log error with context
  logger.error('Request error', {
    requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
    ip: req.ip,
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: err.message,
      requestId,
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
      details: err.message,
      requestId,
    });
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid reference',
      details: err.message,
      requestId,
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      requestId,
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFound = (req, res) => {
  res.status(404).json({ error: 'Route not found' });
};
