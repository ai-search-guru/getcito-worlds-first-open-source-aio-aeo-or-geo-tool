import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Resend's answer, told apart: accepted, refused (nothing went out), or no
 * answer at all (it may have gone out), and nothing to do without config.
 */

vi.mock('./logger.js', () => ({ logger: { warn: vi.fn() } }));

const { deliverEmail, sendEmail } = await import('./email.js');

const message = { to: ['team@acme.example'], subject: 'Hi', html: '<p>Hi</p>' };
const answer = (status, body = '{}') => ({ ok: status < 300, status, text: async () => body });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('RESEND_FROM_EMAIL', 'GetCito <hello@acme.example>');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('deliverEmail', () => {
  it('says sent when Resend accepts it, and refused when it answers with an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, '{"id":"e1"}'));
    expect(await deliverEmail(message)).toBe('sent');
    fetchMock.mockResolvedValueOnce(answer(422, '{"message":"invalid"}'));
    expect(await deliverEmail(message)).toBe('refused');
  });

  it('says unknown when no answer came: a timeout or a dropped connection', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    expect(await deliverEmail(message)).toBe('unknown');
  });

  it('sends a reply to replyTo when given', async () => {
    fetchMock.mockResolvedValue(answer(200));
    await deliverEmail({ ...message, replyTo: 'ada@customer.example' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reply_to).toBe('ada@customer.example');
    await deliverEmail(message);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reply_to');
  });

  it('skips without config or recipients', async () => {
    expect(await deliverEmail({ ...message, to: [] })).toBe('skipped');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await deliverEmail(message)).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendEmail', () => {
  it('is true only when Resend accepted it', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    expect(await sendEmail(message)).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await sendEmail(message)).toBe(false);
  });
});
