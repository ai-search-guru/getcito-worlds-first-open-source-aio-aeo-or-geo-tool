import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-level encryption for the AI provider keys in `organization_ai_keys`.
 *
 * Tradeoff vs. Supabase Vault / pgsodium: doing this at the app layer keeps
 * the only thing that can decrypt the key out of the database entirely —
 * a Postgres user or Supabase admin with read access to `organizations`
 * sees ciphertext only. The master key lives in env (`GETCITO_ENCRYPTION_KEY`)
 * which is rotated via Vercel env management.
 *
 * Algorithm: AES-256-GCM with a fresh 12-byte IV per encryption and the
 * GCM auth tag attached. We store the envelope as a small JSON blob so
 * future versions can bump `v` and migrate without ambiguity.
 *
 * Envelope format: `{ v: 1, iv: <base64>, tag: <base64>, ct: <base64> }`
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM recommended IV size
const KEY_BYTES = 32; // AES-256 = 32-byte key
const VERSION = 1;

interface Envelope {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

function loadMasterKey(): Buffer {
  const raw = process.env.GETCITO_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'GETCITO_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to frontend/.env.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `GETCITO_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext API key for storage. Throws if the env master key
 * is missing or malformed — callers should let that bubble; refusing to
 * write is the correct behavior for misconfigured envs.
 */
export function encryptApiKey(plaintext: string): string {
  if (!plaintext) throw new Error('encryptApiKey: empty plaintext');
  const key = loadMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: Envelope = {
    v: VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an envelope produced by `encryptApiKey`. Returns null if the
 * envelope is malformed, version is unsupported, or decryption fails —
 * callers treat null as "key unusable, surface a re-entry prompt".
 */
export function decryptApiKey(envelopeJson: string | null | undefined): string | null {
  if (!envelopeJson) return null;
  let envelope: Envelope;
  try {
    envelope = JSON.parse(envelopeJson) as Envelope;
  } catch {
    return null;
  }
  if (envelope.v !== VERSION) return null;
  if (!envelope.iv || !envelope.tag || !envelope.ct) return null;
  try {
    const key = loadMasterKey();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ct = Buffer.from(envelope.ct, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Last 4 chars of the plaintext, returned to the UI for "sk-…abcd" display.
 * Mirrored into `organization_ai_keys.key_last4` so reading it back doesn't
 * require decrypt.
 */
export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
