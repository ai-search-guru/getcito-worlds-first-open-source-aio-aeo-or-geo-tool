import { describe, expect, it } from 'vitest';
import { AI_BOTS } from './aiBots.js';
import { LOGPUSH_FIELDS, logpushJob, vercelDrain } from './botSenderSetup.js';
import { readLogpushBody } from './botLogFormats.js';

/** What a person copies into Cloudflare or Vercel (AT-010, spec §6.1 options B and C). */

const sender = { endpoint: 'https://api.example/bots/ingest', secret: 'getcito_bot_s3cret' };

describe('logpushJob', () => {
  it('filters the http_requests dataset to the bot list and sends the secret as a header', () => {
    const job = logpushJob(sender);
    expect(job.dataset).toBe('http_requests');
    expect(job.destination_conf).toBe(
      'https://api.example/bots/ingest?header_Authorization=Bearer%20getcito_bot_s3cret',
    );
    const filter = JSON.parse(job.filter);
    expect(filter.where.or.map((c) => c.value)).toEqual(AI_BOTS.map((b) => b.userAgent));
    expect(
      filter.where.or.every((c) => c.key === 'ClientRequestUserAgent' && c.operator === 'contains'),
    ).toBe(true);
    // Files stay within what the endpoint reads (botLogFormats.js).
    expect(job.max_upload_records).toBe(10_000);
    expect(job.max_upload_bytes).toBe(5_000_000);
  });

  it('asks for the fields the server reads', async () => {
    const line = Object.fromEntries(
      LOGPUSH_FIELDS.map((f) => [f, f === 'EdgeResponseStatus' ? 200 : 'x']),
    );
    line.EdgeStartTimestamp = '2026-10-19T09:00:00Z';
    line.ClientIP = '1.2.3.4';
    expect((await readLogpushBody(JSON.stringify(line))).requests[0]).toMatchObject({
      ip: '1.2.3.4',
      status: 200,
      at: '2026-10-19T09:00:00.000Z',
    });
  });
});

describe('vercelDrain', () => {
  it('sends JSON logs with the secret as a custom header', () => {
    expect(vercelDrain(sender)).toEqual({
      endpoint: 'https://api.example/bots/ingest',
      format: 'json',
      headers: ['Authorization: Bearer getcito_bot_s3cret'],
      sources: ['static', 'lambda', 'edge', 'external', 'redirect'],
    });
  });
});
