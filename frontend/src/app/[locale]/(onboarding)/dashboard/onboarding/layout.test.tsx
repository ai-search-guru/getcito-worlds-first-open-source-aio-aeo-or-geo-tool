// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The onboarding wizard reads whether the new Chat is on for the workspace
 * (CHAT_AGENTIC) as the welcome page does, so its work areas show Agent
 * Center only where the menu will.
 */

const db = vi.hoisted(() => ({ organizationId: null as string | null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { organization_id: db.organizationId },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { default: OnboardingWizardLayout } = await import('./layout');
const { ChatAgenticProvider } = await import('@/components/context/ChatAgenticProvider');

const chatOn = async () => {
  const tree = (await OnboardingWizardLayout({ children: null })) as {
    type: unknown;
    props: { enabled: boolean };
  };
  expect(tree.type).toBe(ChatAgenticProvider);
  return tree.props.enabled;
};

beforeEach(() => {
  db.organizationId = 'org-1';
  vi.stubEnv('CHAT_AGENTIC', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('OnboardingWizardLayout', () => {
  it('has the new Chat on where it is on for the workspace', async () => {
    expect(await chatOn()).toBe(true);
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2, org-1');
    expect(await chatOn()).toBe(true);
  });

  it('has it off with the flag off, or on only for other workspaces', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect(await chatOn()).toBe(false);
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatOn()).toBe(false);
  });

  it('before the workspace exists, has it on only where it is on for every workspace', async () => {
    db.organizationId = null;
    expect(await chatOn()).toBe(true);
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect(await chatOn()).toBe(false);
  });
});
