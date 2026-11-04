import { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import BrandDetailLayout from './layout';

const push = vi.fn();
const nav = vi.hoisted(() => ({ pathname: '/dashboard/brands/b1/settings' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => nav.pathname,
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const brand = (id: string, name: string) => ({
  id,
  name,
  logoUrl: undefined,
  isActive: true,
  domains: [
    { id: `${id}-d`, brandId: id, domain: `${name.toLowerCase()}.example`, isPrimary: true },
  ],
});
const store = vi.hoisted(() => ({
  brands: [] as ReturnType<typeof brand>[],
  activeBrandId: 'b1' as string | null,
  setActiveBrand: vi.fn(),
}));
vi.mock('@/state/useBrandStore', () => ({ useBrandStore: () => store }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** A params promise React reads at once: already fulfilled. */
const params = (id: string) =>
  Object.assign(Promise.resolve({ id }), { status: 'fulfilled', value: { id } });

async function render(id = 'b1', role: TeamRole = 'analyst') {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <Suspense>
            <BrandDetailLayout params={params(id)}>
              <p>page</p>
            </BrandDetailLayout>
          </Suspense>
        </RoleProvider>
      </NextIntlClientProvider>,
    ),
  );
}
async function openSwitch() {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Switch brand"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  store.brands = [brand('b1', 'Acme'), brand('b2', 'Globex')];
  store.setActiveBrand.mockReset();
  push.mockReset();
  nav.pathname = '/dashboard/brands/b1/settings';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('the brand header', () => {
  it("opens another brand's settings from the arrows beside the name", async () => {
    await render();
    expect(container.querySelector('h1')!.textContent).toBe('Acme');
    const items = await openSwitch();
    expect(items).toHaveLength(2);
    await act(async () => items[1].click());
    expect(store.setActiveBrand).toHaveBeenCalledWith('b2');
    expect(push).toHaveBeenCalledWith('/dashboard/brands/b2/settings');
  });

  it("keeps the brand's page: prompts open the other brand's prompts", async () => {
    nav.pathname = '/dashboard/brands/b1/prompts';
    await render();
    const items = await openSwitch();
    await act(async () => items[1].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands/b2/prompts');
  });

  it('has Workspace Settings for admins and managers, not for others', async () => {
    const workspace = () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Workspace Settings');
    await render('b1', 'manager');
    expect(workspace()).toBeDefined();
    await render('b1', 'analyst');
    expect(workspace()).toBeUndefined();
  });

  it('stays put when the same brand is picked', async () => {
    await render();
    const items = await openSwitch();
    await act(async () => items[0].click());
    expect(push).not.toHaveBeenCalled();
    expect(store.setActiveBrand).not.toHaveBeenCalled();
  });
});
