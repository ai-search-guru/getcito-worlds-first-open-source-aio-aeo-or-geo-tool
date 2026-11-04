import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

/**
 * Settings › Team on a read-only workspace (plan not active): Invite, a
 * role, Resend and Edit brands open the upgrade dialog instead, and change
 * nothing. Remove and Revoke still work: they end access. On an active plan
 * all work. An admin chooses the brands each person sees (BRAND-ACCESS
 * §3.2) on a plan with more than one brand.
 */

const team = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  getTeamInfo: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  inviteMember: vi.fn(),
  listShareableBrands: vi.fn(),
  setMemberBrands: vi.fn(),
}));
vi.mock('@/lib/actions/team', () => team);
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TeamSection } = await import('./TeamSection');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const ME = {
  userId: 'u1',
  email: 'ada@acme.test',
  fullName: 'Ada Admin',
  avatarUrl: null,
  role: 'admin',
  createdAt: '2026-01-01',
  isCurrentUser: true,
  brandAccess: { scope: 'all', brandIds: [] as string[] },
};
const BOB = { ...ME, userId: 'u2', email: 'bob@acme.test', fullName: 'Bob', role: 'analyst' };
BOB.isCurrentUser = false;
const INVITE = {
  id: 'i1',
  email: 'cal@acme.test',
  role: 'analyst',
  status: 'pending',
  invitedBy: 'u1',
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-10-01',
  acceptedAt: null,
  brandAccess: { scope: 'selected', brandIds: ['b1', 'b2'] },
};
const BRANDS = [
  { id: 'b1', name: 'Acme' },
  { id: 'b2', name: 'Globex' },
];

beforeEach(() => {
  vi.clearAllMocks();
  team.listMembers.mockResolvedValue([ME, BOB]);
  team.listInvitations.mockResolvedValue([INVITE]);
  team.getTeamInfo.mockResolvedValue({
    memberCount: 2,
    pendingCount: 1,
    seatsUsed: 3,
    maxTeamMembers: 5,
    canInvite: true,
    planName: 'Growth',
    multiBrand: true,
  });
  team.listShareableBrands.mockResolvedValue(BRANDS);
  team.setMemberBrands.mockResolvedValue({ brandAccess: { scope: 'selected', brandIds: ['b2'] } });
  team.removeMember.mockResolvedValue(undefined);
  team.revokeInvitation.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <TeamSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const byText = (text: string) =>
  [...document.body.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (b) => b.textContent?.trim() === text,
  );
const byLabel = (label: string) =>
  document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
const click = (el: Element | undefined) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const dialog = () => document.querySelector('[role="dialog"]');

describe('TeamSection on a read-only workspace', () => {
  it('invites and resends nothing: each opens the upgrade dialog', async () => {
    await render(true);
    await click(byText('Invite member'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Inviting members needs a plan');
    expect(dialog()).toBeNull();

    await click(byLabel('Invitation actions'));
    await click(byText('Resend invite'));
    expect(openUpgrade).toHaveBeenLastCalledWith('Resending invitations needs a plan');

    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(team.inviteMember).not.toHaveBeenCalled();
    expect(team.resendInvitation).not.toHaveBeenCalled();
  });

  it('still removes a member and revokes an invitation: they end access', async () => {
    await render(true);
    await click(byLabel('Remove team member'));
    expect(dialog()?.textContent).toContain('Remove');
    await click(byText('Remove member'));
    expect(team.removeMember).toHaveBeenCalledWith('u2');

    await click(byLabel('Invitation actions'));
    await click(byText('Revoke'));
    expect(team.revokeInvitation).toHaveBeenCalledWith('i1');
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('changes no role: picking one opens the upgrade dialog', async () => {
    await render(true);
    await click(container.querySelector('[role="combobox"]')!);
    const manager = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Manager',
    )!;
    await act(async () => {
      manager.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(manager);
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Changing roles needs a plan');
    expect(team.updateMemberRole).not.toHaveBeenCalled();
  });

  it("shows a new invitation's link outside session replays", async () => {
    team.inviteMember.mockResolvedValue({
      inviteLink: 'https://app.getcito.test/en/invite/tok_123',
      emailSent: false,
    });
    await render(false);
    await click(byText('Invite member'));
    const email = document.querySelector<HTMLInputElement>('#invite-email')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        email,
        'cal@acme.test',
      );
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Send invitation'));

    expect(team.inviteMember).toHaveBeenCalledWith('cal@acme.test', 'analyst', {
      scope: 'all',
      brandIds: [],
    });
    const link = [...document.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.value === 'https://app.getcito.test/en/invite/tok_123',
    );
    expect(link?.classList.contains('ph-no-capture')).toBe(true);
  });

  it('opens Invite and asks before removing on an active plan', async () => {
    await render(false);
    await click(byText('Invite member'));
    expect(dialog()?.textContent).toContain('Invite');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await click(byLabel('Remove team member'));
    await click(byText('Remove member'));
    expect(team.removeMember).toHaveBeenCalledWith('u2');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});

const radio = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
    r.textContent?.startsWith(name),
  );
const checkbox = (brand: string) =>
  [...document.querySelectorAll<HTMLElement>('label')]
    .find((l) => l.textContent === brand)
    ?.querySelector<HTMLElement>('[role="checkbox"]') ?? undefined;

async function typeEmail(value: string) {
  const email = document.querySelector<HTMLInputElement>('#invite-email')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(email, value);
    email.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TeamSection: brands each person sees', () => {
  it('invites to Selected brands: at least one brand, kept by the invitation', async () => {
    team.inviteMember.mockResolvedValue({ inviteLink: 'https://x.test/i/t', emailSent: true });
    await render(false);
    await click(byText('Invite member'));
    expect(radio('All brands')?.getAttribute('aria-checked')).toBe('true');
    await typeEmail('cal@acme.test');

    await click(radio('Selected brands'));
    expect(dialog()?.textContent).toContain('Pick at least one brand.');
    expect(byText('Send invitation')?.hasAttribute('disabled')).toBe(true);

    await click(checkbox('Globex'));
    expect(dialog()?.textContent).toContain('1 brand picked.');
    await click(byText('Send invitation'));
    expect(team.inviteMember).toHaveBeenCalledWith('cal@acme.test', 'analyst', {
      scope: 'selected',
      brandIds: ['b2'],
    });
  });

  it('shows each person’s brands to an admin, and the invitation’s', async () => {
    await render(false);
    expect(container.textContent).toContain('2 brands');
    expect(byLabel('Edit brands for Bob')?.textContent).toBe('All brands');
    // An admin's own row: All brands, nothing to edit.
    expect(document.querySelector('button[aria-label="Edit brands for Ada Admin"]')).toBeNull();
  });

  it('edits a person’s brands in a dialog, saved in one go', async () => {
    await render(false);
    await click(byLabel('Edit brands for Bob'));
    expect(dialog()?.textContent).toContain('Choose which brands Bob sees.');
    await click(radio('Selected brands'));
    expect(byText('Save')?.hasAttribute('disabled')).toBe(true);
    await click(checkbox('Globex'));
    await click(byText('Save'));
    expect(team.setMemberBrands).toHaveBeenCalledWith('u2', {
      scope: 'selected',
      brandIds: ['b2'],
    });
    expect(team.listMembers).toHaveBeenCalledTimes(2);
  });

  it('opens the upgrade dialog instead of Edit brands on a read-only workspace', async () => {
    await render(true);
    await click(byLabel('Edit brands for Bob'));
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Changing roles needs a plan');
    expect(dialog()).toBeNull();
    expect(team.setMemberBrands).not.toHaveBeenCalled();
  });

  it('asks nothing about brands on a one-brand plan', async () => {
    team.getTeamInfo.mockResolvedValue({
      memberCount: 2,
      pendingCount: 1,
      seatsUsed: 3,
      maxTeamMembers: 5,
      canInvite: true,
      planName: 'Starter',
      multiBrand: false,
    });
    await render(false);
    expect(team.listShareableBrands).not.toHaveBeenCalled();
    expect(document.querySelector('button[aria-label="Edit brands for Bob"]')).toBeNull();
    await click(byText('Invite member'));
    expect(radio('All brands')).toBeUndefined();
  });
});
