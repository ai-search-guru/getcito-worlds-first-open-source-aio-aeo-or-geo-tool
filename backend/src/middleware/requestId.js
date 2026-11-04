import { randomUUID } from 'node:crypto';
import logger from '../lib/logger.js';

export default function requestIdMiddleware(req, res, next) {
  const id = randomUUID();
  req.id = id;
  req.log = logger.child({ requestId: id });
  res.setHeader('x-request-id', id);
  next();
}
