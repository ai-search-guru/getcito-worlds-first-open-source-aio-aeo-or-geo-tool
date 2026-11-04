import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An error nothing caught: a rejection is logged and the server keeps
 * serving; an exception is logged and still ends the process with a failure.
 */

const logger = { error: vi.fn(), fatal: vi.fn() };
vi.mock('./logger.js', () => ({ default: logger, logger }));

const { handleProcessErrors } = await import('./processErrors.js');

let exit;
beforeEach(() => {
  vi.clearAllMocks();
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
});
afterEach(() => {
  exit.mockRestore();
});

describe('handleProcessErrors', () => {
  it('logs a rejection nobody handled, and keeps the process running', () => {
    const proc = new EventEmitter();
    handleProcessErrors(proc);
    const reason = new Error('sweep failed');

    proc.emit('unhandledRejection', reason, Promise.resolve());

    expect(logger.error).toHaveBeenCalledWith({ err: reason }, 'unhandled promise rejection');
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs an uncaught exception, then ends the process with 1', () => {
    const proc = new EventEmitter();
    handleProcessErrors(proc);
    const err = new TypeError('x is undefined');

    proc.emit('uncaughtException', err, 'uncaughtException');

    expect(logger.fatal).toHaveBeenCalledWith(
      { err, origin: 'uncaughtException' },
      'uncaught exception',
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.fatal.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });
});

describe('in a real process', () => {
  const run = (code) =>
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
    });
  const moduleUrl = new URL('./processErrors.js', import.meta.url).href;

  it('outlives a rejection nobody handled, and logs it', async () => {
    const { stdout } = await run(`
      import { handleProcessErrors } from '${moduleUrl}';
      handleProcessErrors();
      Promise.reject(new Error('sweep failed'));
      setTimeout(() => console.log('still serving'), 50);
    `);
    expect(stdout).toContain('unhandled promise rejection');
    expect(stdout).toContain('sweep failed');
    expect(stdout).toContain('still serving');
  });

  it('logs an uncaught exception and ends with 1', async () => {
    const failed = await run(`
      import { handleProcessErrors } from '${moduleUrl}';
      handleProcessErrors();
      setTimeout(() => { throw new Error('boom'); }, 0);
      setTimeout(() => console.log('still serving'), 50);
    `).catch((err) => err);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('uncaught exception');
    expect(failed.stdout).toContain('boom');
    expect(failed.stdout).not.toContain('still serving');
  });
});

/** apiServer.js can't be imported here (it listens and starts the crons), so it is read. */
describe("apiServer.js's start", () => {
  it('puts the handlers on the process before the app is made', async () => {
    const source = await readFile(new URL('../apiServer.js', import.meta.url), 'utf8');
    expect(source).toMatch(/import \{ handleProcessErrors \} from '\.\/lib\/processErrors\.js';/);
    const handled = source.indexOf('\nhandleProcessErrors();');
    expect(handled).toBeGreaterThan(0);
    expect(handled).toBeLessThan(source.indexOf('const app = express();'));
  });
});
