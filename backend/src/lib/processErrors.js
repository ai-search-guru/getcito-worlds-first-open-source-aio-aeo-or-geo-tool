/**
 * What the server does with an error nothing caught (2026-10-29).
 *
 * On Node 20 a promise rejection nobody handled ends the whole process, so
 * one missed `.catch` in a background sweep took the API down for every
 * request until it restarted. It is logged now, and the server keeps
 * serving. An uncaught exception still ends the process, as before (after a
 * throw nothing says its state is sound), only logged first so the crash
 * says why.
 */

import logger from './logger.js';

export function logUnhandledRejection(reason) {
  logger.error({ err: reason }, 'unhandled promise rejection');
}

export function exitOnUncaughtException(err, origin) {
  logger.fatal({ err, origin }, 'uncaught exception');
  process.exit(1);
}

/** Puts both on the process, once, when the server starts. */
export function handleProcessErrors(proc = process) {
  proc.on('unhandledRejection', logUnhandledRejection);
  proc.on('uncaughtException', exitOnUncaughtException);
}
