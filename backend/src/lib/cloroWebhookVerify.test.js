import { describe, it, expect } from 'vitest';
import { verifyCloroWebhook } from './cloroWebhookVerify.js';

function buildSignature(secret, rawBody, timestamp) {
  const hmac = require('crypto')
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return `v1=${hmac}`;
}

describe('cloro-webhook-verify', () => {
  const secret = 'whsec_test_secret';
  const rawBody = Buffer.from('{"event":"test"}');

  it('should verify a valid webhook signature', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const sig = buildSignature(secret, rawBody, ts);

    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret,
      nowMs: now,
    });

    expect(result.ok).toBe(true);
  });

  it('should reject missing signature header', () => {
    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: undefined,
      timestampHeader: '1700000000',
      secret,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toBe('missing signature headers');
  });

  it('should reject missing timestamp header', () => {
    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: 'v1=abc',
      timestampHeader: undefined,
      secret,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toBe('missing signature headers');
  });

  it('should reject an invalid timestamp', () => {
    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: 'v1=abc',
      timestampHeader: 'not-a-number',
      secret,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.reason).toBe('invalid timestamp');
  });

  it('should reject a stale timestamp', () => {
    const now = 1_700_000_000_000;
    const staleTs = Math.floor(now / 1000) - 600;
    const sig = buildSignature(secret, rawBody, staleTs);

    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: String(staleTs),
      secret,
      nowMs: now,
      toleranceSeconds: 300,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.reason).toBe('stale timestamp');
  });

  it('should reject a signature mismatch', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const badSig = 'v1=0000000000000000000000000000000000000000000000000000000000000000';

    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: badSig,
      timestampHeader: String(ts),
      secret,
      nowMs: now,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toBe('signature mismatch');
  });

  it('should strip v1= prefix from signature', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const hmac = require('crypto')
      .createHmac('sha256', secret)
      .update(`${ts}.`)
      .update(rawBody)
      .digest('hex');
    const sig = `v1=${hmac}`;

    const result = verifyCloroWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret,
      nowMs: now,
    });

    expect(result.ok).toBe(true);
  });
});
