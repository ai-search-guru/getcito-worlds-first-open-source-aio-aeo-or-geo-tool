import feedUrl from './feed-url/index.js';
import merchantCenter from './merchant-center/index.js';
import wooCommerce from './woocommerce/index.js';

/**
 * Catalog connectors (#1263): one folder each under `backend/src/connectors/`,
 * all writing the same catalog (00278) through `syncCatalog`
 * (lib/catalog/sync.js). A connector says what a source of its kind holds;
 * the plumbing (lib/catalog/sources.js) syncs it, records how it went, and
 * runs it daily and on demand. CONNECTORS.md, at the repo's root, is the
 * guide to writing one.
 *
 * Every connector is an object with:
 *   - `kind`: the `catalog_sources.kind` it reads, a short slug (00282);
 *   - `readCatalog(source, ctx)`: the source's products, as the feed
 *     parsers' items (`{ items, errors, format }`). It throws FeedFormatError
 *     for data it can't read, and lets the HTTP client's errors through.
 *     `ctx.request` is the HTTP client (./http.js `requestJson`), and for a
 *     store `ctx.credentials` is what its `connect` kept.
 *
 * A store or marketplace, read with the brand's own sign-in, also has:
 *   - `label`: the platform's name, as the Settings card shows it;
 *   - `fields`: what the person types to connect it, in order:
 *     `{ name, label, secret?, placeholder?, help? }`. A secret field is
 *     kept encrypted and never shown again;
 *   - `connect(input, ctx)`: checks what the person typed with the platform
 *     and returns `{ account, url?, label?, credentials }`: `account` names
 *     the store to the person (a shop domain, a seller id), `credentials` is
 *     an object of strings kept encrypted for `readCatalog`. It throws
 *     ConnectError (./errors.js) with words the person can act on;
 *   - optionally `disconnect(source, ctx)`: revokes the sign-in at the
 *     platform when the person removes the store, best effort.
 *   - optionally `syncOrders(source, ctx)`: normalized orders for the shared
 *     persistence path (lib/catalog/orders.js), which strips buyer fields;
 *   - optionally `handleWebhook(event)`: connector-level verification and
 *     normalization. A shared HTTP receiver/dispatch route is not wired yet.
 *
 * A platform read with the workspace's own sign-in (#1270), made in
 * Settings › Integrations and kept by Composio, has instead of `fields` and
 * `connect`:
 *   - `signIn`: the Composio provider (lib/composio.js PROVIDERS). Its
 *     `ctx.request` goes through that sign-in (lib/catalog/signIn.js);
 *   - `hosts`: the API hosts that request may call, over https; any other
 *     address is refused;
 *   - `listAccounts(ctx)`: the accounts the sign-in opens, `{ id, name }`,
 *     for the person to pick one;
 *   - `checkAccount(value, ctx)`: the picked account checked, as
 *     `{ account, label?, url? }`, or a ConnectError.
 *   Its `readCatalog` may also return `issues`: the platform's problems per
 *   item (lib/catalog/issues.js); and `repeated`: the listings of an item
 *   read already (another language or feed label), kept once and counted,
 *   not skipped.
 *
 * A connector never logs credentials or a buyer's personal data, and reads
 * only what its feature needs.
 */
export const CONNECTORS = {
  [feedUrl.kind]: feedUrl,
  [merchantCenter.kind]: merchantCenter,
  [wooCommerce.kind]: wooCommerce,
};

/** The connector for a source's kind, or null. */
export function connectorFor(kind, connectors = CONNECTORS) {
  return Object.hasOwn(connectors, kind) ? connectors[kind] : null;
}

/** Whether a connector reads a store with the brand's sign-in. */
export function isStore(connector) {
  return typeof connector?.connect === 'function';
}

/** Whether a connector reads with the workspace's own sign-in (Composio). */
export function isSignIn(connector) {
  return typeof connector?.signIn === 'string';
}

/** The platforms read with the workspace's sign-in, as the Settings card lists them. */
export function signInConnectors(connectors = CONNECTORS) {
  return Object.values(connectors)
    .filter(isSignIn)
    .map(({ kind, label, signIn }) => ({ kind, label, provider: signIn }));
}

/** The stores a person can connect, as the Settings card lists them. */
export function storeConnectors(connectors = CONNECTORS) {
  return Object.values(connectors)
    .filter(isStore)
    .map(({ kind, label, fields }) => ({
      kind,
      label,
      fields: (fields ?? []).map(({ name, label: fieldLabel, secret, placeholder, help }) => ({
        name,
        label: fieldLabel,
        secret: !!secret,
        placeholder: placeholder ?? null,
        help: help ?? null,
      })),
    }));
}
