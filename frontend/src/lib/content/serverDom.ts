import { setContentDom } from './dom';

/**
 * The Content Editor's HTML helpers on the server (lib/content/dom): a
 * jsdom window given to them, made on the first call and kept; a failed
 * load is tried again. Imported only by server code that needs it (the
 * MCP's draft package, Chat's file downloads), so the browser's bundle
 * never carries jsdom.
 */

let dom: Promise<void> | null = null;

/** jsdom's window for the editor's helpers, made once. */
export function withContentDom(): Promise<void> {
  dom ??= import('jsdom')
    .then(({ JSDOM }) => {
      const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
      setContentDom(window);
    })
    .catch((err: unknown) => {
      dom = null;
      throw err;
    });
  return dom;
}
