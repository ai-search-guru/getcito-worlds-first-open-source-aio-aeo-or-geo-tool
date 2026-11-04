import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatAccess, RoleMember } from '@/lib/actions/chatAccess';
import type { CapabilityArea, PlanCard } from '@/lib/chat/access';
import type { ToolCatalogEntry } from '@/lib/chat/registry/tools';

/** Roles & access, Your access, the plan card and "What Chat can do" (CHAT-20 §4a, §4b, §7a, §8). */

const getChatAccess = vi.fn();
const listRoleMembers = vi.fn();
vi.mock('@/lib/actions/chatAccess', () => ({
  getChatAccess: () => getChatAccess(),
  listRoleMembers: () => listRoleMembers(),
}));
vi.mock('@/lib/actions/team', () => ({ updateMemberRole: vi.fn() }));
const requestAccess = vi.fn();
const listAccessRequests = vi.fn();
const decideAccessRequest = vi.fn();
const withdrawAccessRequest = vi.fn();
vi.mock('@/lib/actions/chatAccessRequests', () => ({
  requestAccess: (...args: unknown[]) => requestAccess(...args),
  listAccessRequests: () => listAccessRequests(),
  decideAccessRequest: (...args: unknown[]) => decideAccessRequest(...args),
  withdrawAccessRequest: (...args: unknown[]) => withdrawAccessRequest(...args),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/context/upgradeGate', () => ({
  useUpgradeGate: () => ({ guard: (fn: unknown) => fn }),
}));
vi.mock('@/components/context/AiUsageProvider', () => ({
  useAiUsage: () => ({ usage: { percentUsed: 18 }, refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RolesAccessSection } = await import('./RolesAccessSection');
const { YourAccessCard } = await import('./YourAccessCard');
const { YourPlanCard } = await import('./PlanCard');
const { CapabilitiesView } = await import('./CapabilitiesView');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  getChatAccess.mockReset();
  listRoleMembers.mockReset();
  for (const fn of [
    requestAccess,
    decideAccessRequest,
    withdrawAccessRequest,
    ...Object.values(toast),
  ]) {
    fn.mockReset();
  }
  listAccessRequests.mockReset();
  listAccessRequests.mockResolvedValue({ ok: true, isAdmin: false, requests: [] });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        now={new Date('2026-10-29T12:00:00Z')}
      >
        {node}
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';

const starter: PlanCard = {
  planId: 'starter',
  planName: 'Starter',
  priceMonthly: 49,
  isTrial: false,
  chips: [
    { key: 'platforms', count: 2, locked: null },
    { key: 'fullAuto', locked: 'growth' },
  ],
  next: {
    planId: 'growth',
    planName: 'Growth',
    priceMonthly: 249,
    priceDiff: 200,
    afterTrial: false,
    benefits: [
      { key: 'morePlatforms', count: 6 },
      { key: 'aiLimit', times: 5 },
    ],
  },
};

const access = (over: Partial<ChatAccess> = {}): ChatAccess => ({
  role: 'manager',
  brands: { scope: 'all', names: [] },
  plan: starter,
  yourAccess: [
    { key: 'read', class: 'read', value: 'yes' },
    {
      key: 'execute',
      class: 'execute',
      value: 'after_click_except',
      off: ['publishing', 'feeds'],
    },
    { key: 'settings', class: 'write', value: 'ask_admin' },
  ],
  switches: {
    managerExecuteOff: ['publishing'],
    fullAutoForMembers: true,
    fullAutoLocked: 'growth',
    setBy: 'Ayşe',
  },
  toolLocks: {},
  ...over,
});

const members: RoleMember[] = [
  {
    userId: 'u1',
    name: 'Sam Lee',
    email: 'sam@getcito.example',
    role: 'admin',
    lastActiveAt: '2026-10-29T11:48:00Z',
    isYou: false,
    brands: { scope: 'all', names: [] },
  },
  {
    userId: 'u2',
    name: 'alex',
    email: null,
    role: 'manager',
    lastActiveAt: null,
    isYou: true,
    brands: { scope: 'selected', names: ['Acme', 'Brewline Coffee'] },
  },
];

describe('YourPlanCard', () => {
  it('shows the plan, what it locks, the AI limit used, and what Growth adds for an Admin', async () => {
    await render(<YourPlanCard plan={starter} isAdmin />);
    expect(text()).toContain('Starter$49/mo');
    expect(text()).toContain('2 AI platforms');
    expect(
      container.querySelector('[title="Needs Growth · you\'re on Starter"]')?.textContent,
    ).toContain('Full auto');
    expect(text()).toContain('18% used');
    expect(text()).toContain("With Growth you'd also get");
    expect(text()).toContain('See your brand in 6 more AI platforms');
    expect(text()).toContain('5× the monthly AI limit');
    expect(text()).toContain('+$200/mo');
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).not.toBeNull();
    expect(text()).toContain('Upgrade');
  });

  it('leaves Upgrade to Admins, and the next plan off Enterprise', async () => {
    await render(<YourPlanCard plan={starter} isAdmin={false} />);
    expect(text()).not.toContain('Upgrade');
    await render(
      <YourPlanCard
        plan={{
          ...starter,
          planId: 'enterprise',
          planName: 'Enterprise',
          priceMonthly: null,
          next: null,
        }}
        isAdmin
      />,
    );
    expect(text()).toContain('EnterpriseCustom contract');
    expect(text()).not.toContain("you'd also get");
    expect(text()).not.toContain('Upgrade');
  });
});

describe('YourAccessCard', () => {
  it("says the person's role and what Chat may do as them", async () => {
    await render(<YourAccessCard access={access()} />);
    expect(text()).toContain('Your accessManager');
    expect(text()).toContain('All brands');
    expect(text()).toContain('After your click, except publishing, feed pushes');
    expect(text()).toContain('Ask your Admin');
    expect(container.querySelector('a[href="/dashboard/settings/roles-access"]')?.textContent).toBe(
      'See what each role can do',
    );
    expect(container.querySelector('a[href="/dashboard/chat/capabilities"]')).not.toBeNull();
  });

  it('lists the brands an Admin chose for someone with Selected brands (BRAND-ACCESS §3.2)', async () => {
    await render(
      <YourAccessCard
        access={access({ brands: { scope: 'selected', names: ['Acme', 'Brewline Coffee'] } })}
      />,
    );
    expect(text()).toContain('Acme, Brewline Coffee');
    expect(text()).toContain('An Admin chose these brands for you.');
    expect(text()).not.toContain('All brands');
  });
});

describe('RolesAccessSection', () => {
  it("is read-only for a Manager: no e-mails, no role picker, the switches' state", async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access() });
    listRoleMembers.mockResolvedValue({
      ok: true,
      members: members.map((m) => ({ ...m, email: null })),
    });
    await render(<RolesAccessSection />);
    expect(text()).toContain("You're a Manager · read-only here");
    expect(text()).not.toContain('@');
    expect(container.querySelector('[aria-label="Role"]')).toBeNull();
    expect(text()).toContain('WRITE with approval · EXECUTE after click');
    expect(text()).toContain('12 minutes ago');
    expect(text()).toContain('Not yet');
    expect(text()).toContain('What each role can do');
    expect(text()).toContain('Off for publishing');
    expect(text()).toContain('Needs Growth');
    expect(text()).toContain('Set by Ayşe');
  });

  it('gives an Admin the e-mails and a role picker for everyone but themselves', async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access({ role: 'admin' }) });
    listRoleMembers.mockResolvedValue({ ok: true, members });
    await render(<RolesAccessSection />);
    expect(text()).not.toContain('read-only here');
    expect(text()).toContain('sam@getcito.example');
    expect(container.querySelectorAll('[aria-label="Role"]')).toHaveLength(1);
  });

  it("shows each member's brands: All brands, or how many and which", async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access({ role: 'admin' }) });
    listRoleMembers.mockResolvedValue({
      ok: true,
      members: [
        ...members,
        {
          userId: 'u3',
          name: 'Kim',
          email: null,
          role: 'analyst',
          lastActiveAt: null,
          isYou: false,
          // Someone else's brands, to a viewer who may not see them.
          brands: { scope: 'selected', names: null },
        },
      ],
    });
    await render(<RolesAccessSection />);
    const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows.find((row) => row.includes('Sam Lee'))).toContain('All brands');
    expect(rows.find((row) => row.includes('alex'))).toContain('2 brandsAcme, Brewline Coffee');
    expect(rows.find((row) => row.includes('Kim'))).toContain('Selected brands');
  });

  it('says so in plain words when it cannot be read, and reads again on Retry', async () => {
    getChatAccess.mockResolvedValue({ ok: false, failure: 'failed' });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    await render(<RolesAccessSection />);
    expect(text()).toContain("Couldn't load Roles & access");
    getChatAccess.mockResolvedValue({ ok: true, access: access() });
    await act(async () =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click(),
    );
    expect(getChatAccess).toHaveBeenCalledTimes(2);
    expect(text()).toContain('What each role can do');
  });

  it("says the requests couldn't load, apart from the rest of the page", async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access() });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    listAccessRequests.mockResolvedValue({ ok: false, failure: 'failed' });
    await render(<RolesAccessSection />);
    expect(text()).toContain("Couldn't load the requests.");
    expect(text()).toContain('What each role can do');
  });
});

describe('CapabilitiesView', () => {
  const entry = (
    key: string,
    cls: ToolCatalogEntry['class'],
    over: Partial<ToolCatalogEntry> = {},
  ) =>
    ({
      key,
      area: 'prompts',
      class: cls,
      defaultPolicy: cls === 'read' ? 'on' : 'ask_full_auto',
      maxPolicy: cls === 'read' ? 'on' : 'always',
      flags: { alwaysCard: false, costCard: false, adminMayTurnOff: false, goLiveOnOwn: false },
      minRole: 'analyst',
      excludeRoles: [],
      planGate: null,
      costClass: 'C1',
      route: null,
      ...over,
    }) as ToolCatalogEntry;
  const areas: CapabilityArea[] = [
    {
      area: 'prompts',
      read: [entry('trackedPrompts', 'read')],
      write: [entry('dismissSuggestion', 'write', { excludeRoles: ['agency_partner'] })],
      execute: [],
      writers: ['admin', 'manager', 'analyst'],
    },
    {
      area: 'citations',
      read: [entry('citations', 'read', { area: 'citations' })],
      write: [],
      execute: [],
      writers: [],
    },
  ];

  it('lists each area with its tools, who may change it, and what the plan locks', async () => {
    await render(
      <CapabilitiesView access={access({ toolLocks: { citations: 'growth' } })} areas={areas} />,
    );
    expect(text()).toContain('What Chat can do2 areas');
    expect(text()).toContain('Read tracked prompts');
    expect(text()).toContain('Dismiss prompt suggestions');
    expect(text()).toContain('Admin · Manager · Analyst');
    expect(text()).toContain('Read: all roles');
    expect(text()).toContain('Read citationsNeeds Growth');
  });

  it('narrows to areas with changes, and to a search', async () => {
    await render(<CapabilitiesView access={access()} areas={areas} />);
    const button = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;
    await act(async () => button('Has WRITE').click());
    expect(text()).not.toContain('Read citations');
    await act(async () => button('All').click());
    const input = container.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'citat');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(text()).toContain('Read citations');
    expect(text()).not.toContain('Read tracked prompts');
  });
});

const button = (label: string, root: ParentNode = container) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

describe('Ask your Admin', () => {
  it('sends what the person needs, with the rule, after their click', async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access() });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    requestAccess.mockResolvedValue({ ok: true, id: 'r1' });
    await render(<RolesAccessSection />);
    expect(requestAccess).not.toHaveBeenCalled();
    // The plan card has its own (for the next plan); this is the read-only bar's.
    const bar = [...container.querySelectorAll('div')].find((d) =>
      d.textContent?.startsWith("You're a Manager"),
    )!;
    await act(async () => button('Ask your Admin', bar)!.click());
    const box = document.body.querySelector('textarea')!;
    expect(box.value).toBe('Change my role so I can make changes in this workspace');
    await act(async () => button('Send', document.body)!.click());
    expect(requestAccess).toHaveBeenCalledWith({
      asked: 'Change my role so I can make changes in this workspace',
      ruleKind: 'role',
      ruleDetail: 'Your role is Manager.',
      toolKey: null,
    });
    expect(toast.success).toHaveBeenCalledWith('Sent to your Admins');
  });

  it('says when ten requests already wait, or this one was asked today', async () => {
    await render(<YourAccessCard access={access()} />);
    requestAccess.mockResolvedValue({ ok: false, reason: 'too_many' });
    await act(async () => button('Ask your Admin')!.click());
    await act(async () => button('Send', document.body)!.click());
    expect(toast.error).toHaveBeenCalledWith(
      'You have 10 requests waiting. Withdraw one, or wait for your Admins.',
    );
    requestAccess.mockResolvedValue({ ok: false, reason: 'already_today' });
    await act(async () => button('Send', document.body)!.click());
    expect(toast.info).toHaveBeenCalledWith('You already asked for this today.');
  });

  it("puts Ask your Admin in Upgrade's place on the plan card, for the next plan", async () => {
    await render(<YourPlanCard plan={starter} isAdmin={false} />);
    await act(async () => button('Ask your Admin')!.click());
    expect(document.body.querySelector('textarea')!.value).toBe('Upgrade to Growth');
    expect(document.body.textContent).toContain("Needs Growth · you're on Starter");
  });
});

describe('Requests', () => {
  const request = (over = {}) => ({
    id: 'r1',
    requester: 'Taylor Brooks',
    isYours: false,
    asked: 'Add competitors · Peec AI',
    toolKey: 'addCompetitors',
    ruleKind: 'role',
    ruleDetail: 'Your role is Analyst.',
    draftedText: null,
    status: 'pending',
    createdAt: '2026-10-29T11:00:00Z',
    decidedAt: null,
    ...over,
  });

  it("lets an Admin approve or dismiss a workspace's waiting request, with a count", async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access({ role: 'admin' }) });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    listAccessRequests.mockResolvedValue({
      ok: true,
      isAdmin: true,
      requests: [request(), request({ id: 'r2', status: 'approved' })],
    });
    decideAccessRequest.mockResolvedValue({ ok: true });
    const changed = vi.fn();
    await render(<RolesAccessSection onRequestsChanged={changed} />);
    const section = container.querySelector('[aria-labelledby="chat-access-requests"]')!;
    expect(section.textContent).toContain('Requests1');
    expect(section.textContent).toContain(
      'From Taylor Brooks · Your role is Analyst. · 1 hour ago',
    );
    expect(section.textContent).toContain('Approved');
    expect([...section.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Approve',
      'Dismiss',
    ]);
    await act(async () => button('Approve', section)!.click());
    expect(decideAccessRequest).toHaveBeenCalledWith('r1', 'approved');
    expect(changed).toHaveBeenCalled();
    decideAccessRequest.mockResolvedValue({ ok: false, reason: 'already_decided' });
    await act(async () => button('Dismiss', section)!.click());
    expect(toast.info).toHaveBeenCalledWith('Another Admin already decided it.');
  });

  it('shows an Admin the line a Workspace memory request saves, and why an approval saved nothing', async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access({ role: 'admin' }) });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    listAccessRequests.mockResolvedValue({
      ok: true,
      isAdmin: true,
      requests: [
        request({
          asked: 'Add to Workspace memory: “House style: AP”',
          toolKey: 'memorySave',
          draftedText: 'House style: AP',
        }),
      ],
    });
    decideAccessRequest.mockResolvedValue({
      ok: false,
      reason: 'not_saved',
      message: 'Memory is full. Delete or shorten an item first.',
    });
    await render(<RolesAccessSection />);
    const section = container.querySelector('[aria-labelledby="chat-access-requests"]')!;
    expect(section.textContent).toContain('Approving saves: “House style: AP”');
    await act(async () => button('Approve', section)!.click());
    expect(toast.error).toHaveBeenCalledWith(
      'Not saved, so it still waits: Memory is full. Delete or shorten an item first.',
    );
    expect(toast.success).not.toHaveBeenCalled();
    decideAccessRequest.mockResolvedValue({ ok: true });
    await act(async () => button('Approve', section)!.click());
    expect(toast.success).toHaveBeenCalledWith('Approved. The line is in Workspace memory now.');
  });

  it('lets anyone else withdraw their own waiting request', async () => {
    getChatAccess.mockResolvedValue({ ok: true, access: access() });
    listRoleMembers.mockResolvedValue({ ok: true, members: [] });
    listAccessRequests.mockResolvedValue({
      ok: true,
      isAdmin: false,
      requests: [request({ isYours: true })],
    });
    withdrawAccessRequest.mockResolvedValue(true);
    await render(<RolesAccessSection />);
    const section = container.querySelector('[aria-labelledby="chat-access-requests"]')!;
    expect(section.textContent).toContain('Your requests');
    expect(section.textContent).not.toContain('From ');
    await act(async () => button('Withdraw', section)!.click());
    expect(withdrawAccessRequest).toHaveBeenCalledWith('r1');
    expect(toast.success).toHaveBeenCalledWith('Withdrawn');
  });
});
