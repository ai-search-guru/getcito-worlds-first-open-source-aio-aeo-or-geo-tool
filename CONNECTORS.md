# Building a catalog connector

GetCito keeps each brand's product catalog in one shape: products, variants, images and categories. A **connector** reads one kind of source into it. There are two kinds of connector:

- **A feed:** a public address read without a sign-in. The product feed URL connector (`backend/src/connectors/feed-url/`) reads Google product feeds, Meta catalog CSVs and store CSV exports.
- **A store or marketplace:** read with the brand's own sign-in, for example WooCommerce, Walmart, Trendyol or Hepsiburada.

This guide is for writing a store connector. You can build and test one with no production keys and no real account.

## How a connector fits

A connector is one folder under `backend/src/connectors/<kind>/`, exporting one object. You register it in `backend/src/connectors/index.js` (`CONNECTORS`). Everything else is already there:

- **Settings › Integrations › Product catalog** shows a "Connect {your store}" button and a form built from your `fields`. You write no UI.
- **Connecting:**
  - Your `connect` checks what the person typed with the store.
  - The API makes the source and keeps the sign-in encrypted.
  - It then reads the catalog.
- **Syncing:**
  - The daily run reads every store again after 20 hours, and admins can press **Sync now**.
  - Each run's outcome is shown on the source: synced, couldn't sync, or sign-in refused.
- **The catalog:**
  - Whatever your `readCatalog` returns is written to the catalog.
  - A re-sync changes only what changed.
  - A product that's gone from the store is marked removed.
- **Removing:** removing the store deletes its sign-in and its products.

You write no migration, no route and no UI.

## The interface

| Member | What it is |
|---|---|
| `kind` | The source's kind, a short slug: `woocommerce`, `trendyol`. Lowercase letters, digits and `_`, 2 to 40 characters. |
| `label` | The platform's name as people know it: `WooCommerce`. |
| `fields` | What the person types to connect, in order: `{ name, label, secret?, placeholder?, help? }`. A `secret` field is typed like a password and never shown again. Use `help` to say where in the store to find it, and which access to give it. |
| `connect(input, ctx)` | Checks `input` (the fields' values, as strings) with the store. Returns `{ account, url?, label?, credentials }` (see below). |
| `readCatalog(source, ctx)` | Reads the store's products. Returns `{ items, errors, format }`, where `format` is your `kind`. |
| `syncOrders(source, ctx)` | Optional. `ctx.since` is the cursor: read orders changed after it, oldest change first. Returns `{ orders, skipped?, truncated?, cursor? }`; the shared sync persists the normalized order summaries and line items, then moves the cursor to the sync's start, or, when `truncated` (a page cap was hit), to `cursor`: the last change read. A failed order read leaves the cursor and the catalog's outcome as they were. Removing the store removes its orders. |
| `handleWebhook(event)` | Optional, connector-level verification/normalization. A receiver route and dispatch plumbing are still required before platform webhooks run automatically. |
| `disconnect(source, ctx)` | Optional. Revokes the sign-in at the store when the person removes it, where the platform allows. It's best effort: the source is removed anyway. |

What `connect` returns:
- `account` names the store to the person, such as the shop's domain or the seller id. A brand can connect each account once.
- `url` is the store's address, when it has one.
- `label` is the store's own name, when it gives one.
- `credentials` is an object of strings, kept encrypted for `readCatalog`.

What `ctx` holds:
- `ctx.request` is the HTTP client, and the only way to call the platform.
- In `readCatalog`, `syncOrders` and `disconnect`, `ctx.credentials` is what `connect` returned as `credentials`.
- `source` has `id`, `kind`, `url`, `account`, `format` and, for incremental order sync, `last_orders_synced_at`.

### What `readCatalog` returns

Build each item with `toItem(attributes, n, 'Item')` from `backend/src/lib/feeds/item.js`.

- **Attributes:** use Google product feed attribute names: `id`, `item_group_id`, `title`, `description`, `link`, `image_link`, `additional_image_link`, `brand`, `gtin`, `sku`, `mpn`, `price`, `sale_price`, `availability`, `color`, `size`, `material`, `product_type`. Optional `product_types` links the item to multiple categories; the first sorted category remains `product_type`.
- **Required:** an item needs `id`, `title`, `link`, `price` (for example `"129.00 USD"`) and `availability`. An item without them comes back as an error, which you add to `errors`. The person sees the first five.
- **One item per variant.** Put the product's own id in `item_group_id`, and its own name in `title`. The variant's color and size go in `color` and `size`.

The example connector (`backend/src/connectors/__example__/index.js`) shows all of this in about 100 lines.

### Calling the platform

Call the platform only through `ctx.request(url, { method, headers, query, body })` (`backend/src/connectors/http.js`). It returns `{ status, headers, data }`, with the JSON body in `data`. It:

- reaches only public **https** addresses, on the standard web ports, and doesn't follow redirects. Only the test harness lets it call its fake API over http;
- tries again on 429. A call that changes nothing (GET, HEAD, PUT, DELETE) is also tried again on 502, 503 and 504 and on dropped connections; a POST isn't, since the store may have taken it. It waits as long as the store's `Retry-After` header says, or 1, 2 then 4 seconds. A wait longer than a minute ends the run, and the next daily run tries again;
- stops every call of one sync after 10 minutes, so one slow store can't hold the daily run;
- never puts the query, the headers or the body in an error message.

Send keys in a header (`Authorization`) where the platform allows it, not in the address.

For paging, `nextLink(headers)` reads a `Link: <…>; rel="next"` header. Cap the pages you read, as the example does (`MAX_PAGES`).

### Errors

| Throw | When | The person sees |
|---|---|---|
| `ConnectError` (`./errors.js`) | In `connect`, when what they typed is wrong: "That isn't a WooCommerce site's address." | Your words. Never repeat a secret in them. |
| Errors from `ctx.request` (let them through) | 401 or 403 | "Sign-in refused", and a prompt to update it. |
| Errors from `ctx.request` (let them through) | Anything else | The store couldn't be reached, asked to wait, or answered an error. |
| `FeedFormatError` (`backend/src/lib/feeds/item.js`) | The store's data can't be read at all. | Your message. |

Anything else is logged, with every credential value taken out of its message, and shown as "couldn't be synced".

## Credentials

- **Where they're kept:**
  - The API encrypts the sign-in with AES-256-GCM, under a key only it holds (`CONNECTOR_CREDENTIALS_KEY`).
  - It's bound to its source: copied onto another source's row, it doesn't open.
  - It's kept in `catalog_source_credentials`, which only the service role can read. Members can't even see that a row exists.
- **What to ask for:** the least access the feature needs. Today that's read-only access to products (and, later, orders). Say which permission to tick in your field's `help`.
- **Self-hosting:** set `CONNECTOR_CREDENTIALS_KEY` in `backend/.env` (`openssl rand -base64 32`). Without it, Settings says store connections aren't set up. If the key changes, saved sign-ins can't be opened: those stores show "Sign-in refused" until they're updated.

### A platform read with the workspace's Google sign-in

Some platforms sign in with OAuth through a provider Composio already handles for the workspace, like Search Console and Analytics. Google Merchant Center (`backend/src/connectors/merchant-center/`) is one. Such a connector differs from a store:

- **No `fields` and no `connect`.** It has `signIn`, the Composio provider (`backend/src/lib/composio.js` `PROVIDERS`). The workspace connects that provider once in Settings › Integrations, and Composio keeps the token: it never reaches us, and the source has no row in `catalog_source_credentials`.
- **Picking the account:**
  - `listAccounts(ctx)` returns the accounts the sign-in opens, as `{ id, name }`.
  - The person picks one. `POST /api/catalog/sources` with `input: { account }` then calls `checkAccount(value, ctx)`, which returns `{ account, label?, url? }` or throws a ConnectError.
- **Calls:** `ctx.request(url, { query, signal })` goes through Composio's proxy (`backend/src/lib/catalog/signIn.js`), to the hosts your connector names in `hosts` only (Merchant Center's is `merchantapi.googleapis.com`). It answers like the HTTP client and throws the same `ConnectorHttpError` codes, and one more:
  - `auth`: the sign-in is gone or refused. The source shows "Reconnect it in Settings › Integrations".
  - `not_set_up`: the server's own setup is refused, not the sign-in: Composio's API key, or Google's 403 (the Google Cloud project not registered with Merchant Center, a scope missing). Reconnecting wouldn't help, so the source says the server isn't set up correctly. Both are logged as warnings, with Google's reason, for whoever runs the server.
  - Listing accounts and checking one stop after 30 seconds in all; a sync's calls after 10 minutes.
- **Issues:** `readCatalog` may also return `issues`, the platform's problems per item. The plumbing replaces the source's rows in `catalog_item_issues` with them (00296) and counts them on the source (`last_counts.issues`).
- **The same item listed again:** Merchant Center lists an offer once per language and feed label. The catalog keeps one (a listing that isn't disapproved first, then by feed label and language), keeps the issues of all of them, and counts the others in `repeated` (`last_counts.repeated`), not as skipped.
- **Testing:** pass `runSync` a `signInRequest` stand-in. `merchantCenter.test.js` builds one from the real `signInRequest` with a fake proxy.

## Testing

Connector tests run in `npm test` (in `backend/`), against a fake of the platform's API, with no network and no account. The harness is `backend/src/connectors/testing.js`:

- **`startFakeApi(routes)`:**
  - It serves your routes, `{ 'GET /api/products': (req) => ({ status, headers, json }) }`, as `http://store.test:<port>`.
  - It gives you `request` to pass as `ctx.request`: the real HTTP client, with its waits recorded in `waits` instead of slept.
  - Every call is recorded in `calls`.
- **`runSync(connector, source, { credentials, request })`** syncs through the real plumbing into an in-memory catalog. It returns the outcome and the rows written (`products`, `variants`, `images`, `categories`).

Start from the example's test (`backend/src/connectors/__example__/example.test.js`):

```js
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The plumbing reaches the Supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { runSync, startFakeApi } from '../testing.js';
import woocommerce from './index.js';

let api;
beforeEach(async () => {
  api = await startFakeApi({
    'GET /wp-json/wc/v3/products': () => ({ json: [/* products, from the platform's docs */] }),
  });
});
afterEach(() => api.close());

it('reads every product into the catalog', async () => {
  const { outcome, products } = await runSync(woocommerce, { url: api.origin }, {
    credentials: { consumerKey: 'ck_test', consumerSecret: 'cs_test' },
    request: api.request,
  });
  expect(outcome.status).toBe('ok');
});
```

Cover at least these:
- connecting, with a right and a wrong sign-in;
- paging;
- a 429;
- a product that can't be kept;
- one variant per item.

Fixtures are the platform's answers as its docs show them, or as your own sandbox returns them, with made-up products. Never a real store's data, a real customer or a real key.

## Review checklist

Copy this into your pull request. Every connector is reviewed against it.

- [ ] **Least access:** it asks only for what the feature needs (read-only products), and `help` says which permission to give.
- [ ] **Credentials** live only in the credential store. None is in code, logs, error messages, fixtures, screenshots or the PR. Keys go in headers, not addresses, where the platform allows.
- [ ] **No buyer or customer personal data** is kept. If orders are synced, the shared order writer allowlists order id/date/status/channel/currency/totals/refunds and line-item product/variation ids, quantity and revenue; it never persists billing, shipping, customer or raw payload fields.
- [ ] **Removal:** `disconnect` revokes the sign-in where the platform allows. The platform's data deletion requests are handled where it sends them.
- [ ] **Rate limits:** every call goes through `ctx.request`, pages are capped, and the platform's documented limits are respected.
- [ ] **The platform's data rules** are respected (for example, restricted data on marketplaces).
- [ ] **Tests** run with the harness, with no network and no account. Contributors build against their own sandbox or test accounts. Production keys live only with the core team.
- [ ] **Words:** errors a person sees say what to do, in plain words.

## Current limits

- **Orders:** store connectors may implement `syncOrders(source, ctx)`; the shared persistence path lives in `backend/src/lib/catalog/orders.js` and records an incremental cursor in `catalog_sources.last_orders_synced_at`. Only normalized fields are persisted.
- **Webhooks:** connectors may implement and test signature verification/normalization, but an HTTP receiver and routing/dispatch plumbing are not wired yet. Scheduled and on-demand sync remain the source of truth.
- **OAuth sign-in:** platforms that sign in through a redirect (Etsy, eBay, Amazon) need a callback the plumbing doesn't have yet, unless Composio handles their sign-in, as it does Google's (see above). Open an issue before you start one.
- **API keys:** stores that sign in with keys (WooCommerce, Walmart, Trendyol, Hepsiburada) work today.
