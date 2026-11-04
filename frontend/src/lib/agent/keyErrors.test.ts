import { APICallError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import type { AiProvider } from '@/lib/agent/providers';
import { classifyProviderError, isKeyFailureClass } from './keyErrors';

/**
 * AGENT-OWN-KEY §5.1: each provider's answer sorted by what it says about
 * the key. The bodies are the providers' documented error answers.
 */

const answer = (statusCode: number | undefined, body: unknown, data?: unknown) =>
  new APICallError({
    message: 'failed',
    url: 'https://api.example.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    responseBody: body === undefined ? undefined : JSON.stringify(body),
    data,
  });

const retried = (error: unknown) =>
  new RetryError({ message: 'retried', reason: 'maxRetriesExceeded', errors: [error, error] });

const sort = (provider: AiProvider, error: unknown) => classifyProviderError(provider, error);

const anthropicError = (type: string, message: string) => ({
  type: 'error',
  error: { type, message },
});
const openaiError = (code: string, type = code) => ({
  error: { message: 'failed', type, param: null, code },
});
const googleError = (code: number, status: string, reason?: string) => ({
  error: {
    code,
    message: 'failed',
    status,
    details: reason
      ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }]
      : [],
  },
});
const openrouterError = (code: number, message: string) => ({ error: { code, message } });

describe('classifyProviderError', () => {
  it('reads a refused key as invalid, from every provider', () => {
    expect(
      sort('anthropic', answer(401, anthropicError('authentication_error', 'invalid x-api-key'))),
    ).toEqual({
      class: 'invalid',
      status: 401,
    });
    expect(
      sort('anthropic', answer(403, anthropicError('permission_error', 'not allowed'))).class,
    ).toBe('invalid');
    expect(
      sort('openai', answer(401, openaiError('invalid_api_key', 'invalid_request_error'))).class,
    ).toBe('invalid');
    expect(
      sort('google', answer(400, googleError(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'))).class,
    ).toBe('invalid');
    expect(sort('google', answer(403, googleError(403, 'PERMISSION_DENIED'))).class).toBe(
      'invalid',
    );
    expect(
      sort('azure', answer(401, { error: { code: '401', message: 'Access denied' } })).class,
    ).toBe('invalid');
    expect(sort('azure', answer(403, { error: { code: '403', message: 'Forbidden' } })).class).toBe(
      'invalid',
    );
    expect(
      sort('openrouter', answer(401, openrouterError(401, 'No auth credentials found'))).class,
    ).toBe('invalid');
  });

  it('reads an account that can’t pay as no_credit', () => {
    expect(sort('openai', answer(429, openaiError('insufficient_quota'))).class).toBe('no_credit');
    expect(sort('azure', answer(429, openaiError('insufficient_quota'))).class).toBe('no_credit');
    expect(
      sort('openrouter', answer(402, openrouterError(402, 'Insufficient credits'))).class,
    ).toBe('no_credit');
    expect(
      sort(
        'anthropic',
        answer(
          400,
          anthropicError(
            'invalid_request_error',
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
          ),
        ),
      ),
    ).toEqual({ class: 'no_credit', status: 400 });
    expect(sort('anthropic', answer(400, anthropicError('billing_error', 'billing'))).class).toBe(
      'no_credit',
    );
  });

  it('reads a model the key can’t reach as model', () => {
    expect(
      sort('anthropic', answer(404, anthropicError('not_found_error', 'model: x'))).class,
    ).toBe('model');
    expect(sort('openai', answer(404, openaiError('model_not_found'))).class).toBe('model');
    expect(
      sort('azure', answer(404, { error: { code: 'DeploymentNotFound', message: 'missing' } }))
        .class,
    ).toBe('model');
    expect(
      sort('openrouter', answer(404, openrouterError(404, 'No endpoints found for x/y'))).class,
    ).toBe('model');
    expect(sort('google', answer(404, googleError(404, 'NOT_FOUND'))).class).toBe('model');
  });

  it('reads a busy or down provider as transient, the key unmarked', () => {
    expect(sort('openai', answer(429, openaiError('rate_limit_exceeded', 'requests'))).class).toBe(
      'transient',
    );
    expect(sort('google', answer(429, googleError(429, 'RESOURCE_EXHAUSTED'))).class).toBe(
      'transient',
    );
    expect(
      sort('anthropic', answer(529, anthropicError('overloaded_error', 'Overloaded'))),
    ).toEqual({
      class: 'transient',
      status: 529,
    });
    expect(sort('anthropic', answer(500, anthropicError('api_error', 'Internal'))).class).toBe(
      'transient',
    );
    expect(sort('openai', answer(503, undefined)).class).toBe('transient');
    expect(sort('openai', answer(408, undefined)).class).toBe('transient');
    // No answer at all: the connection dropped.
    expect(sort('openai', answer(undefined, undefined))).toEqual({
      class: 'transient',
      status: null,
    });
    expect(sort('openai', new TypeError('fetch failed')).class).toBe('transient');
    expect(
      sort('openai', Object.assign(new Error('timed out'), { name: 'TimeoutError' })).class,
    ).toBe('transient');
  });

  it('reads our own request, and OpenRouter’s moderation flag, as request', () => {
    expect(
      sort('anthropic', answer(400, anthropicError('invalid_request_error', 'prompt is too long'))),
    ).toEqual({ class: 'request', status: 400 });
    expect(sort('openai', answer(413, undefined)).class).toBe('request');
    expect(sort('openrouter', answer(403, openrouterError(403, 'Input was flagged'))).class).toBe(
      'request',
    );
    expect(sort('anthropic', new Error('tool input did not match its schema'))).toEqual({
      class: 'request',
      status: null,
    });
    expect(sort('anthropic', 'a string')).toEqual({ class: 'request', status: null });
  });

  it('reads through the SDK’s retries to the last answer', () => {
    expect(sort('openai', retried(answer(429, openaiError('insufficient_quota'))))).toEqual({
      class: 'no_credit',
      status: 429,
    });
    expect(
      sort('anthropic', retried(answer(529, anthropicError('overloaded_error', 'x')))).class,
    ).toBe('transient');
    expect(sort('openai', retried(new TypeError('fetch failed'))).class).toBe('transient');
  });

  it('reads the SDK’s parsed body when there is no raw one', () => {
    expect(
      sort('openai', answer(429, undefined, { error: { code: 'insufficient_quota' } })).class,
    ).toBe('no_credit');
  });
});

describe('isKeyFailureClass', () => {
  it('names the four classes that mark the key', () => {
    expect(['invalid', 'no_credit', 'model', 'unreadable'].every(isKeyFailureClass)).toBe(true);
    expect(['transient', 'request', null, 'other'].some(isKeyFailureClass)).toBe(false);
  });
});
