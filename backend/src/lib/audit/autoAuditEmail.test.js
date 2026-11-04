import { beforeEach, describe, expect, it, vi } from 'vitest';

const emails = {
  all1: 'ana@acme.test',
  all2: 'bo@acme.test',
  tea: 'cy@acme.test',
  coffee: 'dee@acme.test',
};
vi.mock('../../config/supabase.js', () => ({
  default: {
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: emails[id] } } }) } },
  },
}));
const readers = vi.hoisted(() => ({ map: new Map() }));
vi.mock('../access.js', () => ({ brandReaders: async () => readers.map }));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('../email.js', () => ({ sendEmail }));

const { renderAutoAuditEmail, sendAutoAuditEmail } = await import('./autoAuditEmail.js');

describe('renderAutoAuditEmail', () => {
  it('sums up the run, with the next run date', () => {
    const { subject, html } = renderAutoAuditEmail({
      brands: [{ name: 'Acme Coffee', pages: 25, completed: 25, criticalIssues: 6 }],
      nextRunAt: '2026-10-28T09:00:00.000Z',
    });
    expect(subject).toBe('Site Audit: 25 pages audited · 6 critical issues');
    expect(html).toContain('25 pages audited · 6 critical issues · next run Oct 28');
    // Open Site Audit lands on Pages, where the run's audits are.
    expect(html).toContain('href="http://localhost:3000/dashboard/audit?tab=pages"');
    // One brand: no per-brand list, nothing failed.
    expect(html).not.toContain('<ul');
    expect(html).not.toContain("couldn't");
  });

  it('lists each brand, says what failed and escapes names', () => {
    const { subject, html } = renderAutoAuditEmail({
      brands: [
        { name: 'Acme <Coffee>', pages: 3, completed: 2, criticalIssues: 1 },
        { name: 'Acme Tea', pages: 1, completed: 1, criticalIssues: 0 },
      ],
      nextRunAt: '2026-11-01T00:00:00.000Z',
    });
    expect(subject).toBe('Site Audit: 3 pages audited · 1 critical issue');
    expect(html).toContain('Acme &lt;Coffee&gt;: 2 pages audited · 1 critical issue');
    expect(html).toContain('Acme Tea: 1 page audited · 0 critical issues');
    expect(html).toContain("1 page couldn't be audited");
  });
});

describe('sendAutoAuditEmail', () => {
  const run = {
    brands: [
      { id: 'coffee', name: 'Acme Coffee', pages: 3, completed: 3, criticalIssues: 1 },
      { id: 'tea', name: 'Acme Tea', pages: 2, completed: 2, criticalIssues: 0 },
    ],
    nextRunAt: '2026-11-01T00:00:00.000Z',
  };

  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(true);
  });

  it('sends one e-mail listing every brand when everyone sees them all, as before', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['all2', new Set(['coffee', 'tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['ana@acme.test', 'bo@acme.test']);
    expect(sendEmail.mock.calls[0][0].html).toContain('Acme Coffee');
    expect(sendEmail.mock.calls[0][0].html).toContain('Acme Tea');
  });

  it('gives someone with Selected brands only the brands they see', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const teaOnly = sendEmail.mock.calls.find(([mail]) => mail.to.includes('cy@acme.test'))[0];
    expect(teaOnly.to).toEqual(['cy@acme.test']);
    expect(teaOnly.html).toContain('2 pages audited');
    expect(teaOnly.html).not.toContain('Acme Coffee');
  });

  it('sends each group of the same brands its own e-mail, and skips someone with no e-mail', async () => {
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
      ['coffee', new Set(['coffee'])],
      // Signed up by a provider that gave no e-mail: nobody to send to.
      ['ghost', new Set(['coffee', 'tea'])],
    ]);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    const mails = sendEmail.mock.calls.map(([mail]) => mail);
    expect(mails.map((mail) => mail.to)).toEqual([
      ['ana@acme.test'],
      ['cy@acme.test'],
      ['dee@acme.test'],
    ]);
    const coffeeOnly = mails[2];
    expect(coffeeOnly.html).toContain('3 pages audited');
    expect(coffeeOnly.html).not.toContain('Acme Tea');
  });

  it('sends nothing to no one, and says when one e-mail wasn’t accepted', async () => {
    readers.map = new Map();
    expect(await sendAutoAuditEmail('org-1', run)).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    readers.map = new Map([
      ['all1', new Set(['coffee', 'tea'])],
      ['tea', new Set(['tea'])],
    ]);
    sendEmail.mockResolvedValueOnce(false);
    expect(await sendAutoAuditEmail('org-1', run)).toBe(false);
  });
});
