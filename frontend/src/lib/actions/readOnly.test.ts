// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server actions on a read-only workspace (GetCito Cloud, plan not active):
 * one that writes refuses before it writes anything, and writes once the
 * plan is active; setup's writes stay open to an organization that never
 * subscribed; the person's own profile (their work areas too) and a
 * page-opened trace stay open.
 */

let org: { subscription_status: string | null; stripe_subscription_id: string | null };
/** The brand the actions name is the organization's demo brand (00380). */
let demo: boolean;
let writes: string[];
/** What each update set, by table. */
let updates: { table: string; values: unknown }[];

/**
 * A query builder whose every call chains; records a write, resolves to
 * `row`, or to a list of it unless the query asked for one row.
 */
function query(table: string): unknown {
  const row =
    table === 'profiles'
      ? { organization_id: 'org-1', organizations: org }
      : table === 'brands'
        ? { id: 'brand-1', industry: null, shopping_mode_enabled: false, is_demo: demo }
        : table === 'prompts'
          ? { id: 'prompt-1', platforms: ['chatgpt'] }
          : { id: 'row-1', brand_id: 'brand-1', prompt_id: 'prompt-1', name: 'Acme', domain: '' };
  let one = false;
  const builder: unknown = new Proxy(
    {},
    {
      get: (_, prop) => {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) =>
            resolve({ data: one ? row : [row], error: null });
        }
        return (...args: unknown[]) => {
          if (prop === 'single' || prop === 'maybeSingle') one = true;
          if (['insert', 'update', 'upsert', 'delete'].includes(prop as string)) {
            writes.push(`${table}.${String(prop)}`);
          }
          if (prop === 'update') updates.push({ table, values: args[0] });
          return builder;
        };
      },
    },
  );
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      updateUser: async () => {
        writes.push('auth.updateUser');
        return { error: null };
      },
    },
    from: (table: string) => query(table),
    rpc: async (fn: string) => {
      writes.push(`rpc.${fn}`);
      return { data: true, error: null };
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { DemoBrandError, SubscriptionInactiveError } = await import('@/lib/subscriptionGuard');
const { addCompetitor, deleteCompetitor } = await import('./competitor');
const { markBrandAsEcommerce, setBrandShoppingMode } = await import('./brand');
const { addPromptNote } = await import('./promptWorkflow');
const { markGettingStartedPageOpened } = await import('./gettingStarted');
const { updateAccountName } = await import('./organization');
const { setMemberMenu, setMenuManager, setMyWorkAreas, setRoleMenu } = await import('./menuAccess');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
  demo = false;
  writes = [];
  updates = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server actions on a read-only workspace', () => {
  it('refuse before writing anything', async () => {
    await expect(addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' })).rejects.toThrow(
      SubscriptionInactiveError,
    );
    await expect(deleteCompetitor('row-1')).rejects.toThrow(SubscriptionInactiveError);
    await expect(addPromptNote('prompt-1', 'Check the answer')).rejects.toThrow(
      SubscriptionInactiveError,
    );
    expect(writes).toEqual([]);
  });

  it('write once the plan is active', async () => {
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
    await addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' });
    await deleteCompetitor('row-1');
    await addPromptNote('prompt-1', 'Check the answer');
    expect(writes).toEqual(['competitors.insert', 'competitors.delete', 'prompt_notes.insert']);
  });

  it("let setup's writes through for an organization that never subscribed, and only those", async () => {
    org = { subscription_status: null, stripe_subscription_id: null };
    await addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' });
    await expect(deleteCompetitor('row-1')).rejects.toThrow(SubscriptionInactiveError);
    expect(writes).toEqual(['competitors.insert']);
  });

  it('let setup turn Shopping mode on for an organization that never subscribed', async () => {
    org = { subscription_status: null, stripe_subscription_id: null };
    await expect(markBrandAsEcommerce('brand-1')).resolves.toEqual({
      industry: 'E-commerce & Retail',
      promptsUpdated: 1,
      siteType: 'ecommerce',
    });
    // The site type too, as a detection (00379).
    expect(updates).toContainEqual({
      table: 'brands',
      values: { site_type: 'ecommerce', site_type_detected_at: expect.any(String) },
    });
    expect(updates).toContainEqual({
      table: 'brands',
      values: { industry: 'E-commerce & Retail' },
    });
    expect(updates).toContainEqual({ table: 'brands', values: { shopping_mode_enabled: true } });
    expect(writes).toEqual([
      'brands.update',
      'brands.update',
      'brands.update',
      'prompts.update',
      'brand_platforms.upsert',
    ]);

    // Outside setup, the same change waits for a plan.
    writes = [];
    await expect(setBrandShoppingMode('brand-1', true)).rejects.toThrow(SubscriptionInactiveError);
    expect(writes).toEqual([]);
  });

  it("keep the person's own profile and a page-opened trace open", async () => {
    await updateAccountName('Ada');
    await markGettingStartedPageOpened('brand-1', 'visibility');
    expect(writes).toEqual([
      'profiles.update',
      'auth.updateUser',
      'rpc.getting_started_page_opened',
    ]);
  });

  it('refuse a menu change, and keep answering "What do you work on?" open', async () => {
    await expect(setRoleMenu('analyst', ['content'])).rejects.toThrow(SubscriptionInactiveError);
    await expect(
      setMemberMenu('00000000-0000-4000-8000-000000000001', { shown: [], hidden: [] }),
    ).rejects.toThrow(SubscriptionInactiveError);
    await expect(setMenuManager('00000000-0000-4000-8000-000000000001', true)).rejects.toThrow(
      SubscriptionInactiveError,
    );
    expect(writes).toEqual([]);

    await setMyWorkAreas([]);
    expect(writes).toEqual(['profiles.update']);
  });

  it('never gate self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await addPromptNote('prompt-1', 'Check the answer');
    expect(writes).toEqual(['prompt_notes.insert']);
  });
});

describe('server actions on the demo brand', () => {
  beforeEach(() => {
    demo = true;
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
  });

  it('refuse a write for the demo brand before writing anything, whatever the plan', async () => {
    await expect(addCompetitor('brand-1', { name: 'Acme', domain: 'acme.com' })).rejects.toThrow(
      DemoBrandError,
    );
    await expect(setBrandShoppingMode('brand-1', true)).rejects.toThrow(DemoBrandError);
    // Setup's own write on it, too.
    await expect(markBrandAsEcommerce('brand-1')).rejects.toThrow(DemoBrandError);
    expect(writes).toEqual([]);
  });

  it("leave the writes that name no brand alone: the person's profile, a note by its prompt", async () => {
    await updateAccountName('Ada');
    await addPromptNote('prompt-1', 'Check the answer');
    expect(writes).toEqual(['profiles.update', 'auth.updateUser', 'prompt_notes.insert']);
  });
});
