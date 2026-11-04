import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';

/**
 * A store source's sign-in (#1263, 00282), kept in
 * `catalog_source_credentials`, which only the service role reads.
 *
 * It is encrypted here, with a key only the API holds
 * (`CONNECTOR_CREDENTIALS_KEY`, 32 bytes in base64), so the database never
 * sees it in the clear. The envelope is the web's `keyEncryption.ts` one:
 * AES-256-GCM with a fresh 12-byte IV, `{ v, iv, tag, ct }`. The source's id
 * is the GCM associated data, so an envelope copied onto another source's
 * row doesn't open.
 *
 * Credentials never go in a log, an error message or a response.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = 1;

/** Credentials can't be kept or read: the API has no (valid) key. */
export class CredentialsKeyError extends Error {
  constructor() {
    super(
      `CONNECTOR_CREDENTIALS_KEY must be ${KEY_BYTES} bytes in base64 (openssl rand -base64 32)`,
    );
    this.name = 'CredentialsKeyError';
  }
}

function masterKey() {
  const raw = process.env.CONNECTOR_CREDENTIALS_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== KEY_BYTES) throw new CredentialsKeyError();
  return key;
}

/** Whether the API can keep a store's sign-in. */
export function credentialsConfigured() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** A source's credentials (an object of strings), sealed for its row. */
export function sealCredentials(sourceId, credentials) {
  const key = masterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(String(sourceId), 'utf8'));
  const ct = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  });
}

/**
 * The credentials sealed for this source, or null when the envelope is
 * malformed, another source's, or the key can't open it. Throws only
 * CredentialsKeyError, when the API has no key at all.
 */
export function openCredentials(sourceId, envelopeJson) {
  const key = masterKey();
  try {
    const envelope = JSON.parse(envelopeJson);
    if (envelope?.v !== VERSION || !envelope.iv || !envelope.tag || !envelope.ct) return null;
    const decipher = createDecipheriv(ALGO, key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(String(sourceId), 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const text = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const credentials = JSON.parse(text);
    return credentials && typeof credentials === 'object' ? credentials : null;
  } catch {
    return null;
  }
}

/** Keeps (or replaces) a source's credentials. */
export async function saveCredentials(
  sourceId,
  credentials,
  { setBy = null, db = supabaseAdmin } = {},
) {
  const secret = sealCredentials(sourceId, credentials);
  const { error } = await db
    .from('catalog_source_credentials')
    .upsert(
      { source_id: sourceId, secret, set_at: new Date().toISOString(), set_by: setBy },
      { onConflict: 'source_id' },
    );
  if (error) throw new Error(`catalog_source_credentials write: ${error.code ?? 'error'}`);
}

/** A source's credentials, or null when it has none it can open. */
export async function readCredentials(sourceId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('catalog_source_credentials')
    .select('secret')
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) throw new Error(`catalog_source_credentials read: ${error.code ?? 'error'}`);
  return data?.secret ? openCredentials(sourceId, data.secret) : null;
}
