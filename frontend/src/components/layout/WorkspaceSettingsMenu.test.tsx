import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import { WorkspaceSettingsMenu } from './WorkspaceSettingsMenu';

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
const plan = vi.hoisted(() => ({ isCloud: true }));
vi.mock('@/components/context/PlanProvider', () => ({ usePlanContext: () => plan }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <WorkspaceSettingsMenu />
        </RoleProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>('button');
async function openMenu() {
  await act(async () => {
    trigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger()!.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  plan.isCloud = true;
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('WorkspaceSettingsMenu', () => {
  it("opens the workspace's settings sections, each at its own address", async () => {
    await render('admin');
    expect(trigger()!.textContent).toBe('Workspace Settings');
    const items = await openMenu();
    expect(items.map((i) => i.textContent)).toEqual(['Account', 'Organization', 'Team', 'Billing']);
    await act(async () => items[2].click());
    expect(push).toHaveBeenCalledWith('/dashboard/settings/team');
  });

  it('shows for managers too', async () => {
    await render('manager');
    expect(trigger()).not.toBeNull();
  });

  it.each(['analyst', 'agency_partner'] as const)('is hidden from an %s', async (role) => {
    await render(role);
    expect(container.innerHTML).toBe('');
  });

  it('leaves Billing out where settings have none (self-host)', async () => {
    plan.isCloud = false;
    await render('admin');
    const items = await openMenu();
    expect(items.map((i) => i.textContent)).toEqual(['Account', 'Organization', 'Team']);
  });
});
