/**
 * The part of jsdom the server uses (lib/mcp/contentPackage.ts): a window
 * for the Content Editor's HTML helpers. jsdom ships no types, and this is
 * all of it the app reads.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
