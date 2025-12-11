import { randomUUID } from 'crypto';

// Add request ID to all requests for tracing
export const requestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
};
