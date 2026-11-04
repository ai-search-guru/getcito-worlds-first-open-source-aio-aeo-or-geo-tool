// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

const readWhatsNew = vi.hoisted(() => vi.fn());
vi.mock('@/lib/chat/whats-new/reads', () => ({ MAX_SHOWN: 3, readWhatsNew }));

const { getWhatsNewFor } = await import('./whatsNew');

/**
 * get_whats_new's read (W4-20): the person's plan's updates, the named one
 * first, as the model reads them: the team's lines, the page to try, the
 * plans that include one their plan doesn't, never a price or brand data.
 */

const auth = (organizationId: string | null = 'org-1'): McpAuthContext => ({
  userId: 'u1',
  email: null,
  organizationId,
  role: 'analyst',
  apiKeyId: 'agent-internal',
});

beforeEach(() => {
  readWhatsNew.mockReset();
  readWhatsNew.mockResolvedValue({
    planName: 'Starter',
    more: true,
    hasUnread: true,
    items: [
      {
        slug: 'agent-center',
        feature: 'Agent Center',
        homeLine: 'Agent Center runs routine work for you.',
        lines: ['One.', 'Two.', 'Three.'],
        route: '/dashboard/agents',
        onPlans: null,
        published: '2026-11-03',
        read: false,
      },
      {
        slug: 'full-auto',
        feature: 'Full auto',
        homeLine: 'Full auto.',
        lines: ['One.', 'Two.', 'Three.'],
        route: '/dashboard/chat',
        onPlans: 'Growth and Enterprise',
        published: '2026-11-01',
        read: true,
      },
    ],
  });
});

describe('getWhatsNewFor', () => {
  it('reads the person’s updates, three at most, the named one first', async () => {
    const read = await getWhatsNewFor(auth(), { feature: 'Agent Center', limit: 9 });
    expect(readWhatsNew).toHaveBeenCalledWith({
      userId: 'u1',
      organizationId: 'org-1',
      feature: 'Agent Center',
      shown: undefined,
      limit: 3,
    });
    expect(read).toMatchObject({
      plan: 'Starter',
      older_updates: true,
      updates: [
        {
          feature: 'Agent Center',
          lines: ['One.', 'Two.', 'Three.'],
          try_it: '/dashboard/agents',
          published: '2026-11-03',
          new_for_you: true,
        },
        { feature: 'Full auto', on_plans: 'Growth and Enterprise', new_for_you: false },
      ],
    });
    expect(read?.updates[0]).not.toHaveProperty('on_plans');
    expect(JSON.stringify(read)).not.toMatch(/slug|\$/);
  });

  it('reads nothing without an organization', async () => {
    expect(await getWhatsNewFor(auth(null), {})).toBeNull();
    expect(readWhatsNew).not.toHaveBeenCalled();
  });
});
