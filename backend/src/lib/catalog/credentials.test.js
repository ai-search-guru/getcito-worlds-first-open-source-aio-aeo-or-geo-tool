import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './__fixtures__/fakeDb.js';
import {
  CredentialsKeyError,
  credentialsConfigured,
  openCredentials,
  readCredentials,
  saveCredentials,
  sealCredentials,
} from './credentials.js';

/** A store's sign-in is kept sealed, for its own source only (#1263, 00282). */

const SOURCE = '0b8d6a1e-2a3c-4d5e-8f90-123456789abc';
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const SECRET = { apiKey: 'ck_live_secret_value', apiSecret: 'cs_live_other_value' };

let saved;
beforeEach(() => {
  saved = process.env.CONNECTOR_CREDENTIALS_KEY;
  process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
});
afterEach(() => {
  if (saved === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
  else process.env.CONNECTOR_CREDENTIALS_KEY = saved;
});

describe('sealCredentials / openCredentials', () => {
  it('seals what opens again, with nothing of it in the clear', () => {
    const envelope = sealCredentials(SOURCE, SECRET);
    expect(envelope).not.toContain('secret_value');
    expect(JSON.parse(envelope)).toMatchObject({ v: 1 });
    expect(openCredentials(SOURCE, envelope)).toEqual(SECRET);
  });

  it("uses a fresh IV each time, so the same sign-in doesn't seal the same twice", () => {
    expect(sealCredentials(SOURCE, SECRET)).not.toBe(sealCredentials(SOURCE, SECRET));
  });

  it("doesn't open on another source's row, under another key, or changed", () => {
    const envelope = sealCredentials(SOURCE, SECRET);
    expect(openCredentials(OTHER, envelope)).toBeNull();
    const tampered = JSON.parse(envelope);
    tampered.ct = Buffer.from('x'.repeat(24)).toString('base64');
    expect(openCredentials(SOURCE, JSON.stringify(tampered))).toBeNull();
    expect(openCredentials(SOURCE, 'not json')).toBeNull();
    expect(openCredentials(SOURCE, JSON.stringify({ v: 2 }))).toBeNull();
    process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    expect(openCredentials(SOURCE, envelope)).toBeNull();
  });

  it('refuses to seal or open without a 32-byte key', () => {
    delete process.env.CONNECTOR_CREDENTIALS_KEY;
    expect(credentialsConfigured()).toBe(false);
    expect(() => sealCredentials(SOURCE, SECRET)).toThrow(CredentialsKeyError);
    process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(16).toString('base64');
    expect(credentialsConfigured()).toBe(false);
    expect(() => openCredentials(SOURCE, '{}')).toThrow(CredentialsKeyError);
  });
});

describe('saveCredentials / readCredentials', () => {
  it('keeps one sealed row a source, replaced on a new sign-in', async () => {
    const fake = fakeDb();
    await saveCredentials(SOURCE, SECRET, { setBy: 'user-1', db: fake.db });
    await saveCredentials(SOURCE, { apiKey: 'ck_new' }, { setBy: 'user-1', db: fake.db });
    const rows = fake.rows('catalog_source_credentials');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source_id: SOURCE, set_by: 'user-1' });
    expect(rows[0].secret).not.toContain('ck_new');
    await expect(readCredentials(SOURCE, { db: fake.db })).resolves.toEqual({ apiKey: 'ck_new' });
    await expect(readCredentials(OTHER, { db: fake.db })).resolves.toBeNull();
  });
});
