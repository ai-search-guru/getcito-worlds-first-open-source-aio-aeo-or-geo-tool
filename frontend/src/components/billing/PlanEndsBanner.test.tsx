import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { PlanProvider } from '@/components/context/PlanProvider';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';

/**
 * The app-wide band while a canceled plan runs to the end of its period
 * (00386): when it ends, Keep my plan for an admin, a note for others, and
 * closed for the browser session.
 */

const brands = vi.hoisted(() => ({
  loaded: true,
  activeBrandId: 'b1',
  brands: [{ id: 'b1', isDemo: false }],
}));
vi.mock('@/state/useBrandStore', () => ({
  useBrandStore: (selector: (state: typeof brands) => unknown) => selector(brands),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

// An in-memory sessionStorage, emptied before each test.
const session = new Map<string, string>();
Object.defineProperty(window, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => void session.set(key, value),
    removeItem: (key: string) => void session.delete(key),
    clear: () => session.clear(),
  },
});

const { PlanEndsBanner, PLAN_ENDS_CLOSED_KEY } = await import('./PlanEndsBanner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ENDS = '2099-11-20T12:00:00.000Z';
const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

let container: HTMLDivElement;
let root: Root;

async function render({
  role = 'admin',
  planEndsAt = ENDS,
  status = 'active',
  active = true,
}: {
  role?: TeamRole;
  planEndsAt?: string | null;
  status?: string;
  active?: boolean;
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlanProvider
          planId="growth"
          subscriptionActive={active}
          subscriptionStatus={status}
          planEndsAt={planEndsAt}
        >
          <RoleProvider role={role}>
            <PlanEndsBanner />
          </RoleProvider>
        </PlanProvider>
      </NextIntlClientProvider>,
    );
  });
}
const buttons = () => [...container.querySelectorAll('button')];
const button = (name: string) =>
  buttons().find((b) => b.textContent === name || b.getAttribute('aria-label') === name);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  router.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  session.clear();
  brands.activeBrandId = 'b1';
  brands.brands = [{ id: 'b1', isDemo: false }];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('PlanEndsBanner', () => {
  it('says when a canceled plan ends, and keeps it for an admin', async () => {
    await render();
    expect(container.textContent).toContain('Your plan ends on November 20, 2099.');
    expect(container.firstElementChild!.className).toContain('bg-amber-50');
    expect(container.firstElementChild!.className).toContain('dark:bg-amber-950/30');

    await act(async () => button('Keep my plan')!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stripe/subscription',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reactivate: true }) }),
    );
    expect(toast.success).toHaveBeenCalledWith('Subscription reactivated.');
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.innerHTML).toBe('');
  });

  it('says so if the plan couldn’t be kept, and stays', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await render();
    await act(async () => button('Keep my plan')!.click());
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't keep the plan. Try again from Settings › Billing.",
    );
    expect(container.textContent).toContain('Your plan ends on');
  });

  it('asks other members to have an admin keep it', async () => {
    for (const role of ['manager', 'analyst'] as const) {
      await render({ role });
      expect(container.textContent).toBe(
        'Your plan ends on November 20, 2099. To keep it, ask an admin of your workspace.',
      );
      expect(button('Keep my plan')).toBeUndefined();
    }
  });

  it('says a canceled trial’s plan won’t start', async () => {
    await render({ status: 'trialing' });
    expect(container.textContent).toContain(
      "Your free trial ends on November 20, 2099, and your plan won't start.",
    );
  });

  it('closes for the browser session, until the plan is canceled to another date', async () => {
    await render();
    await act(async () => button('Close')!.click());
    expect(container.innerHTML).toBe('');
    expect(session.get(PLAN_ENDS_CLOSED_KEY)).toBe(ENDS);

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.innerHTML).toBe('');

    await render({ planEndsAt: '2099-12-20T12:00:00.000Z' });
    expect(container.textContent).toContain('Your plan ends on December 20, 2099.');
  });

  it('shows nothing for a plan that renews, has ended, or is read-only, nor on the demo brand', async () => {
    for (const props of [
      { planEndsAt: null },
      { planEndsAt: '2020-01-01T12:00:00.000Z' },
      { active: false },
    ]) {
      await render(props);
      expect(container.innerHTML).toBe('');
    }
    brands.brands = [{ id: 'b1', isDemo: true }];
    await render();
    expect(container.innerHTML).toBe('');
  });
});
