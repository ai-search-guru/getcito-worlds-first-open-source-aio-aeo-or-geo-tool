/**
 * What one `/api` request reads once and keeps until its response ends: the
 * caller's brand access (lib/access.js), however many brands the route
 * checks. Work the request starts and leaves running (a content or tracking
 * job, a brand sync) runs in the same async context and so sees the same
 * store; once the response has finished or the connection closed, the store
 * is closed and every read there is fresh, so access taken away counts from
 * then on. Outside a request (a job of its own, a socket, a test) every read
 * is fresh.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();

/** Express middleware: the request's store for the routes after it, closed with its response. */
export function requestScope(req, res, next) {
  const store = { open: true, kept: new Map() };
  const close = () => {
    store.open = false;
    store.kept.clear();
  };
  res.once('finish', close);
  res.once('close', close);
  scope.run(store, next);
}

/**
 * `read()` once in this request, its promise kept under `key`; read again
 * outside one, or once its response has ended. A failed read isn't kept: the
 * next caller tries again.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export function oncePerRequest(key, read) {
  const store = scope.getStore();
  if (!store?.open) return read();
  const { kept } = store;
  if (!kept.has(key)) {
    const promise = read().catch((err) => {
      if (kept.get(key) === promise) kept.delete(key);
      throw err;
    });
    kept.set(key, promise);
  }
  return kept.get(key);
}
