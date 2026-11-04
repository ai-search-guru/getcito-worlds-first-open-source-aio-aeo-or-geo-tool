// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientEventProblems, type ChatEvent } from './events';

/**
 * The editable approval card (W3-02), on the schedule's row: the form its
 * card shows (When as a date or rule that reads the same later, its line,
 * the run's model and use), and the input the person's edits make, read by
 * the row's schema again — or refused with the card's own words.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const estimate = vi.hoisted(() => ({ value: { kind: 'share', share: 0.02 } as unknown }));
vi.mock('./schedule/estimate', () => ({ readRunEstimate: vi.fn(async () => estimate.value) }));

const { cardFormOf, cardFormValuesInput, editedInput } = await import('./cardForm');
const { chatTool } = await import('./registry/tools');

const tool = chatTool('create_schedule')!;
const IST = 'Europe/Istanbul';
// Friday 16 October 2026, 14:00 in Istanbul.
const ctx = {
  timezone: IST,
  organizationId: 'org-1',
  userId: 'user-1',
  now: new Date('2026-10-16T11:00:00.000Z'),
};
const asked = tool.inputSchema.parse({
  title: 'Citations check',
  when: 'in 3 days',
  prompt: 'Check the citations for /pricing',
}) as Record<string, unknown>;

beforeEach(() => {
  estimate.value = { kind: 'share', share: 0.02 };
});

describe('the schedule card’s form', () => {
  it('shows When as the date it read, with its line, and the run’s model and use', async () => {
    const { form } = await cardFormOf(tool, asked, ctx);
    expect(form).toMatchObject({ kind: 'schedule', zone: IST, submit: 'Create schedule' });
    const when = form!.fields.find((f) => f.name === 'when')!;
    // "in 3 days" is fixed to its day: approved tomorrow, it is still Mon 19 Oct.
    expect(when.value).toBe('19 Oct 2026 at 09:00');
    expect(when.hint).toBe('Once, Mon 19 Oct, 09:00 · Europe/Istanbul');
    expect(form!.fields.map((f) => f.name)).toEqual([
      'title',
      'prompt',
      'when',
      'deliver',
      'changeOnly',
    ]);
    expect(form!.notes).toEqual(['Runs on Auto · Normal', '≈ 2% of monthly AI usage per run']);
    // The card's event carries no id, money or tool name.
    const event = {
      type: 'confirm.required',
      seq: 1,
      data: {
        n: 1,
        action: 'Schedule work',
        target: '',
        digest: 'abcdefgh',
        canDontAskAgain: false,
        form,
      },
    } as ChatEvent;
    expect(clientEventProblems(event)).toEqual([]);
  });

  it('says a run is on the workspace’s own key, or uses the limit, when there is no figure', async () => {
    estimate.value = { kind: 'own_key' };
    expect((await cardFormOf(tool, asked, ctx)).form!.notes).toContain(
      'Runs on your workspace’s own AI key',
    );
    estimate.value = { kind: 'unknown' };
    expect((await cardFormOf(tool, asked, ctx)).form!.notes).toContain(
      'Each run uses your monthly AI limit, like a chat',
    );
  });

  it('shows no form when it can’t be read: the card stays a plain approval', async () => {
    const broken = { form: { fields: () => Promise.reject(new Error('down')), apply: vi.fn() } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await cardFormOf(broken as never, asked, ctx)).toEqual({});
  });
});

describe('what the card’s edits make', () => {
  it('applies the edited values, read by the row’s schema', () => {
    const made = editedInput(
      tool,
      asked,
      {
        title: '  Weekly citations  ',
        when: 'every Monday at 8',
        deliver: 'both',
        changeOnly: true,
        prompt: ' Check the citations each week ',
      },
      ctx,
    );
    expect(made).toEqual({
      ok: true,
      input: expect.objectContaining({
        title: 'Weekly citations',
        when: 'every Monday at 8',
        deliver_to: 'both',
        change_only: true,
        prompt: 'Check the citations each week',
      }),
    });
  });

  it('refuses a When that doesn’t read, in the card’s words, and an input the row doesn’t take', () => {
    expect(editedInput(tool, asked, { when: 'next Friday' }, ctx)).toEqual({
      ok: false,
      error: 'That could be Fri 23 Oct, 09:00 or Fri 30 Oct, 09:00. Say which one.',
    });
    expect(editedInput(tool, asked, { deliver: 'slack' }, ctx)).toEqual({ ok: false, error: null });
    expect(editedInput(tool, asked, { title: '' }, ctx)).toEqual({ ok: false, error: null });
    // Emptied, the prompt goes: a job with no skill then asks nothing.
    expect(editedInput(tool, asked, { prompt: '  ' }, ctx)).toEqual({ ok: false, error: null });
  });

  it('keeps change-only off a one-time job whatever the card says', () => {
    const made = editedInput(tool, asked, { changeOnly: true }, ctx);
    expect(made.ok && made.input.change_only).toBe(false);
  });

  it('takes field names and short values only from the browser', () => {
    expect(cardFormValuesInput.safeParse({ when: 'x', changeOnly: true }).success).toBe(true);
    expect(cardFormValuesInput.safeParse({ brand_id: 'x' }).success).toBe(false);
    expect(cardFormValuesInput.safeParse({ when: { at: 1 } }).success).toBe(false);
    expect(
      cardFormValuesInput.safeParse(
        Object.fromEntries([...Array(13)].map((_, i) => [`f${'a'.repeat(i)}`, 'x'])),
      ).success,
    ).toBe(false);
  });
});
