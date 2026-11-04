import { createHash } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';

const WRITE_CHUNK = 500;
const FILTER_CHUNK = 100;

const clip = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const amount = (value) => {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
};

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hashOf(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

/**
 * The kept rows of these orders only, FILTER_CHUNK ids a request: a sync
 * reads what it changes, not every order the store ever had.
 */
async function readKept(db, brandId, source, externalIds) {
  const rows = [];
  for (const ids of chunks([...new Set(externalIds)], FILTER_CHUNK)) {
    const { data, error } = await db
      .from('catalog_orders')
      .select('id, external_id, content_hash')
      .eq('brand_id', brandId)
      .eq('source', source)
      .in('external_id', ids);
    if (error) throw new Error(`catalog_orders read: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

function cleanOrder(order) {
  const external_id = clip(order?.external_id, 300);
  const placed_at = isoDate(order?.placed_at);
  if (!external_id || !placed_at) return null;

  const currency = clip(order.currency, 3)?.toUpperCase() ?? null;
  const safeCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
  const items = [];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const external_line_id = clip(item?.external_line_id, 300);
    const external_product_id = clip(item?.external_product_id, 300);
    const quantity = Number(item?.quantity);
    if (
      !external_line_id ||
      !external_product_id ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      continue;
    }

    items.push({
      external_line_id,
      external_product_id,
      external_variation_id: clip(item.external_variation_id, 300),
      quantity,
      revenue: amount(item.revenue),
    });
  }

  // Intentionally construct an allowlist. Do not pass through or spread the
  // platform order: it includes billing, shipping and customer identifiers.
  return {
    external_id,
    placed_at,
    modified_at: isoDate(order.modified_at),
    status: clip(order.status, 50) ?? '',
    channel: clip(order.channel, 100) ?? '',
    currency: safeCurrency,
    total: amount(order.total),
    refunded_total: amount(order.refunded_total),
    items,
  };
}

/**
 * Persists only the normalized financial/order-line fields returned by a
 * connector. Existing order lines are replaced only when that order changes.
 */
export async function syncCatalogOrders(
  brandId,
  source,
  orders,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const at = now.toISOString();
  const counts = { added: 0, changed: 0, unchanged: 0, skipped: 0, items: 0 };
  // By external id: an order changed while the store was paged can come twice,
  // and one upsert can't write the same row twice. The later read wins.
  const byId = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const safe = cleanOrder(order);
    if (!safe) {
      counts.skipped++;
      continue;
    }
    byId.delete(safe.external_id);
    byId.set(safe.external_id, {
      ...safe,
      content_hash: hashOf(safe),
      // Mark the order as incomplete until its replacement line items have
      // been written. If a later write fails, the next sync sees this distinct
      // hash and retries instead of mistaking a partial order for a complete one.
      pending_hash: hashOf({ pending: true, order: safe }),
    });
  }
  const normalized = [...byId.values()];

  const kept = await readKept(
    db,
    brandId,
    source,
    normalized.map((order) => order.external_id),
  );
  const keptById = new Map(kept.map((row) => [row.external_id, row]));
  const idsByExternal = new Map(kept.map((row) => [row.external_id, row.id]));
  const writes = [];
  const changed = [];

  for (const order of normalized) {
    const previous = keptById.get(order.external_id);
    if (previous && previous.content_hash === order.content_hash) {
      counts.unchanged++;
      continue;
    }

    counts[previous ? 'changed' : 'added']++;
    changed.push(order);
    const { items: _items, content_hash: _contentHash, pending_hash, ...columns } = order;
    writes.push({
      brand_id: brandId,
      source,
      ...columns,
      content_hash: pending_hash,
      updated_at: at,
    });
  }

  for (const batch of chunks(writes, WRITE_CHUNK)) {
    const { data, error } = await db
      .from('catalog_orders')
      .upsert(batch, { onConflict: 'brand_id,source,external_id' })
      .select('id, external_id');
    if (error) throw new Error(`catalog_orders write: ${error.message}`);
    for (const row of data ?? []) idsByExternal.set(row.external_id, row.id);
  }

  const changedIds = changed.map((order) => idsByExternal.get(order.external_id)).filter(Boolean);
  for (const ids of chunks(changedIds, FILTER_CHUNK)) {
    const { error } = await db.from('catalog_order_items').delete().in('order_id', ids);
    if (error) throw new Error(`catalog_order_items clear: ${error.message}`);
  }

  const lineRows = changed.flatMap((order) => {
    const orderId = idsByExternal.get(order.external_id);
    if (!orderId) return [];
    return order.items.map((item) => ({
      brand_id: brandId,
      order_id: orderId,
      ...item,
    }));
  });
  for (const batch of chunks(lineRows, WRITE_CHUNK)) {
    const { error } = await db.from('catalog_order_items').insert(batch);
    if (error) throw new Error(`catalog_order_items write: ${error.message}`);
  }

  // Commit the complete content hash only after the line items have been
  // replaced successfully. Leaving the pending hash on failure makes retries
  // idempotent while still repairing a partially written order.
  // The whole row again, not just the hash: Postgres checks an upsert's row
  // for NOT NULL columns (placed_at) before it finds the conflict.
  const completedWrites = writes.map((row, i) => ({
    ...row,
    content_hash: changed[i].content_hash,
  }));
  for (const batch of chunks(completedWrites, WRITE_CHUNK)) {
    const { error } = await db
      .from('catalog_orders')
      .upsert(batch, { onConflict: 'brand_id,source,external_id' });
    if (error) throw new Error(`catalog_orders completion write: ${error.message}`);
  }

  counts.items = lineRows.length;
  return counts;
}
