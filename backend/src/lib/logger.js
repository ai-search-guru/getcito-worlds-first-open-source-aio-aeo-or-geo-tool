import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

/**
 * Never logged: a request's sign-in, and the raw body an error carries. The
 * body parser puts a malformed request's whole body on its error (`err.body`),
 * which the global error handler logs: it may hold a store's sign-in or a
 * site token (#1263).
 */
export const REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'err.body'];

export const logger = pino({
  level,
  redact: REDACT_PATHS,
});

export default logger;
