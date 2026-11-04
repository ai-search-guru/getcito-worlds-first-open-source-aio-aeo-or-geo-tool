import { describe, expect, it } from 'vitest';
import {
  buildCancelFeedbackEmail,
  canWait,
  cancelFeedbackSchema,
  feedbackRecipients,
} from './cancelFeedback.js';

/**
 * Why a customer cancels, or asks for three days first: what is accepted,
 * who it goes to, and the e-mail the team reads.
 */

describe('cancelFeedbackSchema', () => {
  it('takes the reasons once each and a trimmed message, both optional', () => {
    expect(
      cancelFeedbackSchema.parse({
        reasons: ['too_expensive', 'too_expensive', 'switching'],
        message: '  Too pricey for us.  ',
        choice: 'cancel',
      }),
    ).toEqual({
      reasons: ['too_expensive', 'switching'],
      message: 'Too pricey for us.',
      choice: 'cancel',
    });
    expect(cancelFeedbackSchema.parse({ choice: 'wait' })).toEqual({
      reasons: [],
      message: '',
      choice: 'wait',
    });
  });

  it('refuses an unknown reason or choice, and a message over 2,000 characters', () => {
    expect(cancelFeedbackSchema.safeParse({ reasons: ['bored'], choice: 'cancel' }).success).toBe(
      false,
    );
    expect(cancelFeedbackSchema.safeParse({ choice: 'pause' }).success).toBe(false);
    expect(
      cancelFeedbackSchema.safeParse({ choice: 'cancel', message: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
});

describe('feedbackRecipients', () => {
  it('reads the comma-separated addresses, and none when unset', () => {
    expect(feedbackRecipients(' owner@example.com, support@example.com ,')).toEqual([
      'owner@example.com',
      'support@example.com',
    ]);
    expect(feedbackRecipients('')).toEqual([]);
  });
});

describe('buildCancelFeedbackEmail', () => {
  const org = {
    name: 'Acme Coffee',
    plan: 'growth',
    subscription_status: 'active',
    subscription_ends_at: '2026-11-03T10:00:00Z',
  };
  const user = { name: 'Ada', email: 'ada@acme.example', role: 'admin' };
  const now = new Date('2026-10-21T12:00:00Z');

  it('says in the subject that the customer waits, and by when to act', () => {
    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback: { reasons: ['missing_feature'], message: 'We need Slack alerts.', choice: 'wait' },
      now,
    });
    expect(subject).toBe('Acme Coffee asks us to act within 3 days before cancelling');
    expect(html).toContain('Wait 3 days for us to act');
    // The moment to act by, with its time: the customer sees it in their own zone.
    expect(html).toContain('October 24, 2026, 12:00 UTC');
    expect(html).toContain('November 3, 2026');
    expect(html).toContain('growth · active');
    expect(html).toContain('Ada &lt;ada@acme.example&gt; (admin)');
    expect(html).toContain('Missing a feature they need');
    expect(html).toContain('We need Slack alerts.');
  });

  it('says the plan was cancelled, with no reasons or message given', () => {
    const { subject, html } = buildCancelFeedbackEmail({
      org,
      user,
      feedback: { reasons: [], message: '', choice: 'cancel' },
      now,
    });
    expect(subject).toBe('Acme Coffee cancelled their plan');
    expect(html).toContain('Cancel at the end of the period');
    expect(html).not.toContain('Act by');
    expect(html).toContain('None ticked');
    expect(html).toContain('No message');
  });

  it('escapes what the customer wrote', () => {
    const { html } = buildCancelFeedbackEmail({
      org: { ...org, name: '<b>Acme</b>' },
      user,
      feedback: { reasons: [], message: '<script>alert(1)</script>', choice: 'cancel' },
      now,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Acme</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('canWait', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('offers three days only with a day to spare before the plan renews', () => {
    expect(canWait('2026-10-25T12:00:01Z', now)).toBe(true);
    expect(canWait('2026-10-25T12:00:00Z', now)).toBe(false);
    expect(canWait('2026-10-24T13:00:00Z', now)).toBe(false);
    expect(canWait(null, now)).toBe(false);
    expect(canWait('not a date', now)).toBe(false);
  });
});
