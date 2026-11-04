import { describe, expect, it } from 'vitest';
import { webhookSecretsMatch } from './webhookSecret.js';

describe('webhookSecretsMatch', () => {
  it('rejects missing stored or supplied secrets', () => {
    expect(webhookSecretsMatch(undefined, 'secret')).toBe(false);
    expect(webhookSecretsMatch('secret', undefined)).toBe(false);
    expect(webhookSecretsMatch('', 'secret')).toBe(false);
    expect(webhookSecretsMatch('secret', '')).toBe(false);
  });

  it('rejects a wrong secret, including values with a different byte length', () => {
    expect(webhookSecretsMatch('correct-secret', 'wrong-secret')).toBe(false);
    expect(webhookSecretsMatch('secret', 'a much longer secret')).toBe(false);
  });

  it('accepts the exact configured secret', () => {
    expect(webhookSecretsMatch('shared-webhook-secret', 'shared-webhook-secret')).toBe(true);
  });
});
