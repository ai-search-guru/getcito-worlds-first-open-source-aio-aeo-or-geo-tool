// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const marked = vi.hoisted(() => vi.fn(async (...args: unknown[]) => args.length >= 0));
vi.mock('./reads', () => ({ MAX_SHOWN: 3, markWhatsNewRead: marked }));
vi.mock('./entries.json', () => ({
  default: {
    entries: ['agent-center', 'chat', 'chat-focus', 'daily-suggestions'].map((slug) => ({
      slug,
      feature: slug === 'agent-center' ? 'Agent Center' : slug,
      homeLine: 'Home.',
      route: '/dashboard/chat',
      plans: ['starter', 'growth', 'enterprise'],
      planMode: 'hide',
      published: '2026-11-01',
      lines: ['One.', 'Two.', 'Three.'],
    })),
  },
}));

const { showWhatsNew, updatesOf, whatsNewCards, whatsNewStepDetail } = await import('./run');
const { applyChatEvent, emptyRun } = await import('../runState');
const { chatEvent } = await import('../events');

/**
 * What's new in a run (W4-20, W4-21; CHAT-11 items 10–11, 18): its step
 * says how many updates it found for the plan; the updates show as cards in
 * the approved words, never the model's, and count as read.
 */

beforeEach(() => marked.mockClear());

describe('whatsNewStepDetail', () => {
  it('counts the updates the read found for the plan', () => {
    expect(whatsNewStepDetail({ updates: [{}, {}, {}] })).toBe('3 updates for your plan');
    expect(whatsNewStepDetail({ updates: [{}] })).toBe('1 update for your plan');
    expect(whatsNewStepDetail({ updates: [] })).toBe('Nothing new for your plan');
    expect(whatsNewStepDetail(null)).toBe('Nothing new for your plan');
    expect(updatesOf({ updates: 'x' })).toEqual([]);
  });
});

describe('whatsNewCards', () => {
  it('shows each update as its approved entry, three at most, with the plans that include it', () => {
    const cards = whatsNewCards({
      updates: [
        {
          feature: 'Agent Center',
          lines: ['The model’s own words.'],
          on_plans: 'Growth and Enterprise',
        },
        { feature: 'Made up' },
        { feature: 'chat' },
        { feature: 'Agent Center' },
        { feature: 'chat-focus' },
        { feature: 'daily-suggestions' },
      ],
    });
    expect(cards).toEqual([
      {
        slug: 'agent-center',
        feature: 'Agent Center',
        lines: ['One.', 'Two.', 'Three.'],
        href: '/dashboard/chat',
        onPlans: 'Growth and Enterprise',
      },
      { slug: 'chat', feature: 'chat', lines: ['One.', 'Two.', 'Three.'], href: '/dashboard/chat' },
      {
        slug: 'chat-focus',
        feature: 'chat-focus',
        lines: ['One.', 'Two.', 'Three.'],
        href: '/dashboard/chat',
      },
    ]);
  });

  it('builds an event the browser may get, and a run that keeps the cards', () => {
    const cards = whatsNewCards({ updates: [{ feature: 'Agent Center' }] });
    const event = chatEvent('whats_new.ready', 4, { entries: cards });
    expect(applyChatEvent(emptyRun(), event).whatsNew).toEqual(cards);
  });
});

describe('showWhatsNew', () => {
  it('shows the cards, then marks them read for the person', async () => {
    const emit = vi.fn();
    await showWhatsNew({ updates: [{ feature: 'Agent Center' }, { feature: 'chat' }] }, 'u1', emit);
    expect(emit).toHaveBeenCalledWith({
      entries: [
        expect.objectContaining({ slug: 'agent-center' }),
        expect.objectContaining({ slug: 'chat' }),
      ],
    });
    expect(marked).toHaveBeenCalledWith('u1', ['agent-center', 'chat']);
  });

  it('shows and marks nothing when the read found nothing', async () => {
    const emit = vi.fn();
    await showWhatsNew({ updates: [] }, 'u1', emit);
    expect(emit).not.toHaveBeenCalled();
    expect(marked).not.toHaveBeenCalled();
  });
});
