import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { KeyFailureError, ProviderDownError, stepFailure } from './engineKey';

/**
 * AGENT-OWN-KEY §5.2: a failed call on the workspace's own key stops the run
 * with the key's class; a provider that didn't answer says so; GetCito's
 * own key failing isn't the workspace's to fix.
 */

const answer = (statusCode: number, body: object) =>
  new APICallError({
    message: 'failed',
    url: 'https://api.example.com',
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
  });

const OWN = { source: 'own' as const, provider: 'openai' as const };
const GETCITO = { source: 'getcito' as const, provider: 'anthropic' as const };

describe('stepFailure', () => {
  it('stops on the own key with its class, naming the model it couldn’t reach', () => {
    const refused = stepFailure(
      OWN,
      'openai/gpt-5.5',
      answer(401, { error: { code: 'invalid_api_key' } }),
    );
    expect(refused).toBeInstanceOf(KeyFailureError);
    expect((refused as KeyFailureError).failure).toEqual({
      class: 'invalid',
      provider: 'openai',
      status: 401,
      model: null,
    });
    const missing = stepFailure(
      OWN,
      'openai/gpt-5.5',
      answer(404, { error: { code: 'model_not_found' } }),
    );
    expect((missing as KeyFailureError).failure).toMatchObject({
      class: 'model',
      model: 'gpt-5.5',
    });
    const openrouter = stepFailure(
      { source: 'own', provider: 'openrouter' },
      'openrouter/openai/gpt-5.5',
      answer(404, { error: { code: 404, message: 'No endpoints found' } }),
    );
    expect((openrouter as KeyFailureError).failure.model).toBe('openai/gpt-5.5');
  });

  it('leaves GetCito’s own key failing to the run’s usual failure', () => {
    expect(stepFailure(GETCITO, 'anthropic/claude-sonnet-5.5', answer(401, {}))).toBeNull();
  });

  it('says a provider that didn’t answer is down, on any key', () => {
    const down = stepFailure(GETCITO, 'anthropic/claude-sonnet-5.5', answer(529, {}));
    expect(down).toBeInstanceOf(ProviderDownError);
    expect((down as ProviderDownError).provider).toBe('anthropic');
    expect(stepFailure(OWN, 'openai/gpt-5.5', new TypeError('fetch failed'))).toBeInstanceOf(
      ProviderDownError,
    );
  });

  it('leaves our own request’s failure as it was', () => {
    expect(
      stepFailure(
        OWN,
        'openai/gpt-5.5',
        answer(400, { error: { code: 'context_length_exceeded' } }),
      ),
    ).toBeNull();
    expect(stepFailure(OWN, 'openai/gpt-5.5', new Error('bad schema'))).toBeNull();
  });
});
