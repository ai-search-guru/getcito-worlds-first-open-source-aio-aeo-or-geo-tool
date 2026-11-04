import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import messages from '../../../messages/en.json';
import { sendCancelFeedback } from '@/lib/actions/cancelFeedback';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/actions/cancelFeedback', () => ({ sendCancelFeedback: vi.fn() }));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const formatted = (days: number) =>
  new Date(Date.now() + days * DAY).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();
const onCancel = vi.fn<() => Promise<boolean>>();

async function render(currentPeriodEnd: string | null = inDays(20)) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CancelSubscriptionDialog
          open
          onOpenChange={onOpenChange}
          currentPeriodEnd={currentPeriodEnd}
          onCancel={onCancel}
        />
      </NextIntlClientProvider>,
    );
  });
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
  });
}

function write(text: string) {
  const box = document.querySelector<HTMLTextAreaElement>('#cancel-feedback-message')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  onCancel.mockResolvedValue(true);
  vi.mocked(sendCancelFeedback).mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('cancelling', () => {
  it('asks what went wrong, and sends the answer once the plan is cancelled', async () => {
    await render();
    expect(document.body.textContent).toContain('Before you go, what went wrong?');
    await click('Too expensive');
    expect(button('Too expensive')!.getAttribute('aria-pressed')).toBe('true');
    write('Too pricey for a team of two.');
    await click('Send and cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(sendCancelFeedback).toHaveBeenCalledWith({
      reasons: ['too_expensive'],
      message: 'Too pricey for a team of two.',
      choice: 'cancel',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('cancels with nothing said, and still tells the team', async () => {
    await render();
    await click('Cancel Subscription');
    expect(sendCancelFeedback).toHaveBeenCalledWith({ reasons: [], message: '', choice: 'cancel' });
  });

  it('sends nothing and stays open when cancelling failed', async () => {
    onCancel.mockResolvedValue(false);
    await render();
    await click('Cancel Subscription');
    expect(sendCancelFeedback).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('giving the team three days', () => {
  it('sends the answer and keeps the plan, once there is something to fix', async () => {
    await render();
    expect(document.body.textContent).toContain(`We'll get back to you by ${formatted(3)}`);
    expect(button('Send and give us 3 days')!.hasAttribute('disabled')).toBe(true);
    await click('Missing a feature I need');
    expect(button('Send and give us 3 days')!.hasAttribute('disabled')).toBe(false);
    await click('Send and give us 3 days');
    expect(onCancel).not.toHaveBeenCalled();
    expect(sendCancelFeedback).toHaveBeenCalledWith({
      reasons: ['missing_feature'],
      message: '',
      choice: 'wait',
    });
    expect(document.body.textContent).toContain("Thanks, we're on it");
    expect(document.body.textContent).toContain(
      `We'll get back to you by ${formatted(3)}. Your plan stays as it is.`,
    );
  });

  it('isn’t offered when the plan renews within those days, or a day after', async () => {
    await render(inDays(2));
    expect(button('Send and give us 3 days')).toBeUndefined();
    await render(inDays(3.5));
    expect(button('Send and give us 3 days')).toBeUndefined();
    expect(document.body.textContent).not.toContain('Give us 3 days?');
    await render(null);
    expect(button('Send and give us 3 days')).toBeUndefined();
  });

  it('says so when the message can’t go, and keeps the form', async () => {
    vi.mocked(sendCancelFeedback).mockResolvedValue({ error: 'too_many' });
    await render();
    write('Please call me.');
    await click('Send and give us 3 days');
    expect(toast.error).toHaveBeenCalledWith(
      "You've sent several messages today. Please write to our support team instead.",
    );
    expect(document.body.textContent).toContain('Before you go, what went wrong?');
  });

  it('leaves only cancelling when the server says waiting can’t work', async () => {
    for (const [error, said] of [
      [
        'too_late',
        'Your plan renews before we could get back to you. You can still cancel it here.',
      ],
      [
        'not_sent',
        "Your message didn't reach our team. Please write to our support team, or cancel the plan here.",
      ],
    ] as const) {
      vi.mocked(sendCancelFeedback).mockResolvedValue({ error });
      await render();
      write('Please call me.');
      await click('Send and give us 3 days');
      expect(toast.error).toHaveBeenLastCalledWith(said);
      expect(document.body.textContent).not.toContain("Thanks, we're on it");
      expect(button('Send and give us 3 days')).toBeUndefined();
      expect(button('Send and cancel')).toBeDefined();
      // A fresh dialog for the next refusal.
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});
