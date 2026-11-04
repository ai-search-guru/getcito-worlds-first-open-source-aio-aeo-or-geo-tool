import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { IN_FILTER_CHUNK } from '../chunkedIn.js';
import { logger } from '../logger.js';
import { fakeDb } from './__fixtures__/fakeDb.js';
import {
  MAX_PURGED,
  PURGE_BATCH,
  REMOVED_KEEP_DAYS,
  purgeRemovedCatalogProducts,
} from './purge.js';

const NOW = new Date('2026-10-28T06:00:00.000Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

let fake;
let info;
let warn;
beforeEach(() => {
  fake = fakeDb();
  info = vi.spyOn(logger, 'info').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A product with one variant, an image and a category link. */
function product(id, removedAt) {
  fake.rows('catalog_products').push({ id, brand_id: 'brand-1', removed_at: removedAt });
  fake.rows('catalog_variants').push({ id: `${id}-v`, product_id: id, removed_at: removedAt });
  fake.rows('catalog_images').push({ id: `${id}-i`, product_id: id });
  fake.rows('catalog_product_categories').push({ product_id: id, category_id: 'c1' });
}

/** The fake's db, counting each read's limit and each delete's ids. */
function counted() {
  const reads = [];
  const deletes = [];
  const db = {
    from: (table) => {
      const builder = fake.db.from(table);
      const { limit, delete: remove, in: within } = builder;
      let deleting = false;
      builder.limit = (n) => {
        reads.push(n);
        return limit(n);
      };
      builder.delete = () => {
        deleting = true;
        return remove();
      };
      builder.in = (column, values) => {
        if (deleting) deletes.push(values.length);
        return within(column, values);
      };
      return builder;
    },
  };
  return { db, reads, deletes };
}

describe('purgeRemovedCatalogProducts', () => {
  it('deletes products removed over 90 days ago, with their variants, images and categories', async () => {
    product('old', daysAgo(REMOVED_KEEP_DAYS + 1));
    product('recent', daysAgo(REMOVED_KEEP_DAYS - 1));
    product('live', null);

    const purged = await purgeRemovedCatalogProducts({ db: fake.db, now: NOW });

    expect(purged).toBe(1);
    expect(fake.rows('catalog_products').map((p) => p.id)).toEqual(['recent', 'live']);
    for (const table of ['catalog_variants', 'catalog_images', 'catalog_product_categories']) {
      expect(fake.rows(table).map((r) => r.product_id)).toEqual(['recent', 'live']);
    }
    expect(info).toHaveBeenCalledWith({ purged: 1 }, '[catalog] removed products purged');
  });

  it('keeps a product a sync brought back between the read and the delete', async () => {
    product('old', daysAgo(REMOVED_KEEP_DAYS + 5));
    const db = {
      from: (table) => {
        const builder = fake.db.from(table);
        const { delete: remove } = builder;
        builder.delete = () => {
          // The sync makes it live again first.
          fake.rows('catalog_products')[0].removed_at = null;
          return remove();
        };
        return builder;
      },
    };

    expect(await purgeRemovedCatalogProducts({ db, now: NOW })).toBe(0);
    expect(fake.rows('catalog_products')).toHaveLength(1);
  });

  it('reads PURGE_BATCH at a time, deletes IN_FILTER_CHUNK ids a request, and stops at MAX_PURGED', async () => {
    const over = MAX_PURGED + 50;
    for (let i = 0; i < over; i++) {
      fake.rows('catalog_products').push({
        id: `p${String(i).padStart(6, '0')}`,
        removed_at: daysAgo(REMOVED_KEEP_DAYS + 10),
      });
    }
    const { db, reads, deletes } = counted();

    const purged = await purgeRemovedCatalogProducts({ db, now: NOW });

    expect(purged).toBe(MAX_PURGED);
    expect(fake.rows('catalog_products')).toHaveLength(50);
    expect(reads).toEqual(Array(MAX_PURGED / PURGE_BATCH).fill(PURGE_BATCH));
    expect(Math.max(...deletes)).toBe(IN_FILTER_CHUNK);
    expect(deletes.reduce((a, b) => a + b, 0)).toBe(MAX_PURGED);
    expect(warn).toHaveBeenCalledWith(
      { purged: MAX_PURGED },
      '[catalog] removed products purge stopped early; the rest goes tomorrow',
    );

    // The rest the next day.
    expect(await purgeRemovedCatalogProducts({ db: fake.db, now: NOW })).toBe(50);
    expect(fake.rows('catalog_products')).toHaveLength(0);
  });

  it('logs a failure and resolves, so the daily run goes on', async () => {
    product('old', daysAgo(REMOVED_KEEP_DAYS + 1));
    const failing = {
      from: () => {
        const query = {
          select: () => query,
          lt: () => query,
          limit: () => query,
          then: (resolve) => resolve({ data: null, error: { message: 'statement timeout' } }),
        };
        return query;
      },
    };

    await expect(purgeRemovedCatalogProducts({ db: failing, now: NOW })).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(
      { err: { name: 'Error', message: 'catalog_products read: statement timeout' }, purged: 0 },
      '[catalog] removed products purge failed; the rest goes tomorrow',
    );

    // A client that throws outright is caught as well.
    const throwing = {
      from: () => {
        throw new TypeError('fetch failed');
      },
    };
    await expect(purgeRemovedCatalogProducts({ db: throwing, now: NOW })).resolves.toBe(0);
    expect(fake.rows('catalog_products')).toHaveLength(1);
  });
});
