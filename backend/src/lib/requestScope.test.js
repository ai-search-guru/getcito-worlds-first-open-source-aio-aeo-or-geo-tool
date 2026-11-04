import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { oncePerRequest, requestScope } from './requestScope.js';

/** What a request reads once (lib/requestScope.js): kept for that request only. */

/** Runs `fn` inside one request's store; `res` is the response it closes with. */
const inRequest = (fn, res = new EventEmitter()) =>
  new Promise((resolve, reject) => requestScope({}, res, () => fn().then(resolve, reject)));

describe('oncePerRequest', () => {
  it('reads once in a request, afresh in the next and outside one', async () => {
    const read = vi.fn(async () => 'value');
    await inRequest(async () => {
      expect(await oncePerRequest('k', read)).toBe('value');
      expect(await oncePerRequest('k', read)).toBe('value');
    });
    expect(read).toHaveBeenCalledTimes(1);
    await inRequest(() => oncePerRequest('k', read));
    await oncePerRequest('k', read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps no failed read: the next caller in the request tries again', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce('value');
    await inRequest(async () => {
      await expect(oncePerRequest('k', read)).rejects.toThrow('connection reset');
      expect(await oncePerRequest('k', read)).toBe('value');
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(['finish', 'close'])(
    'reads afresh once the response has ended (%s), in work the request left running',
    async (event) => {
      const read = vi.fn(async () => 'value');
      const res = new EventEmitter();
      await inRequest(async () => {
        await oncePerRequest('k', read);
        await oncePerRequest('k', read);
        expect(read).toHaveBeenCalledTimes(1);
        // A job started here and not awaited goes on in this async context.
        res.emit(event);
        await oncePerRequest('k', read);
        await oncePerRequest('k', read);
      }, res);
      expect(read).toHaveBeenCalledTimes(3);
    },
  );
});
