import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionDetail, ActionItem } from '@/lib/actions/actionCenter';
import type { Affected } from '@/lib/action-center/affected';

const { toast, written } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  written: [] as { sheets: { sheet?: string }[]; file: string }[],
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('write-excel-file/browser', () => ({
  default: (sheets: { sheet?: string }[]) => ({
    toFile: async (file: string) => {
      written.push({ sheets, file });
    },
  }),
}));
vi.mock('@/lib/actions/content', () => ({
  getOpportunity: async () => ({
    id: 'o1',
    title: 'Coffee subscription guide',
    decision: null,
    brief: null,
    sourceData: { targetPages: [{ url: 'https://acme.example/subscriptions', title: '' }] },
  }),
  getOpportunityBasket: async () => ({
    clusters: [{ prompts: [{ text: 'Best coffee subscription?' }] }],
    queries: [{ query: 'coffee subscription', included: true }],
  }),
}));

const { ActionExportButtons } = await import('./ActionExportButtons');

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let clipboard: string[];

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

/** Opens the Export menu and picks one of its items. */
async function exportAs(name: string) {
  const trigger = button('Export');
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger.click();
  });
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toEqual(['Export CSV', 'Export Excel']);
  await act(async () => items.find((item) => item.textContent === name)!.click());
}

const action = {
  id: 'a1',
  actionNo: 52,
  category: 'recover',
  kind: 'recover_visibility',
  impact: 'high',
  status: 'new',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-08T09:00:00Z',
  updatedAt: '2026-10-15T12:30:00Z',
  taskTotal: 1,
  taskCompleted: 0,
  signalCount: 1,
  priorityScore: 84,
  priorityLevel: 'high',
  priorityReason: {
    change: 'dropped',
    subject: { entity: 'prompts', count: 3 },
    demand: 'high',
    realDemand: null,
    commercial: true,
    heldBefore: true,
    days: 2,
    sources: 1,
  },
} as ActionItem;

const detail = {
  tasks: [
    {
      id: 't1',
      position: 0,
      taskKey: null,
      title: 'Refresh /pricing',
      status: 'todo',
      titleParams: {},
      dependsOn: [],
      skipReason: null,
      details: null,
    },
  ],
  signals: [
    {
      id: 's1',
      category: 'visibility',
      kind: 'sharp_drop',
      impact: 'high',
      status: 'new',
      source: ['ai_results'],
      detectedAt: '2026-10-08T05:00:00Z',
      lastDetectedAt: '2026-10-15T05:00:00Z',
      resolvedAt: null,
      previousValue: 40,
      currentValue: 20,
      changeValue: -20,
      payload: {},
      kpiKeys: [],
      actionId: 'a1',
      where: { platforms: ['gemini-web'], regions: [], topics: [] },
    },
  ],
  events: [
    { id: 'e1', event: 'created', data: {}, actorId: null, createdAt: '2026-10-08T09:00:00Z' },
  ],
  kpis: [],
} as unknown as ActionDetail;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  clipboard = [];
  written.length = 0;
  toast.success.mockReset();
  toast.error.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void clipboard.push(text) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ActionExportButtons', () => {
  it('waits for the action to load', () => {
    render(<ActionExportButtons action={action} detail={null} />);
    expect(['Copy Data', 'Export'].map((name) => button(name).disabled)).toEqual([true, true]);
  });

  const copyButton = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Copy all"]')!;

  it('opens every tab of the action as Markdown, and copies it all in one click', async () => {
    render(<ActionExportButtons action={action} detail={detail} />);
    await act(async () => button('Copy Data').click());
    const shown = document.querySelector('textarea')?.value ?? '';
    expect(shown).toMatch(/^# Recover lost visibility \(AC-52\)\n/);
    // The priority stands where impact used to: impact is one of its factors.
    expect(shown).toContain('Priority: 84 (High) · Category: Recover · Status:');
    expect(shown).not.toContain('Impact:');
    expect(shown).toContain(
      'Why this priority: A sharp drop on 3 high-demand prompts 2 days ago — commercial intent, previously visible.',
    );
    expect(shown).toContain('## Tasks (1)\n1. Refresh /pricing (To Do)');
    expect(shown).toContain('## Signals (1)\n- Visibility · ');
    expect(shown).toContain('## History (1)\n- 2026-10-08 · ');
    expect(shown).toContain(
      'Link: http://localhost:3000/dashboard/action-center/actions?action=a1',
    );
    expect(clipboard).toEqual([]);

    await act(async () => copyButton().click());
    expect(clipboard).toEqual([shown]);
    expect(toast.success).toHaveBeenCalledWith('Action AC-52 copied: 1 task, 1 signal');
    // The icon says it copied.
    expect(copyButton()).toBeNull();
    expect(document.querySelector('button[aria-label="Copied"]')).not.toBeNull();
  });

  it('uses the Why and Goal the drawer wrote from the action’s data (AC-003)', async () => {
    render(
      <ActionExportButtons
        action={action}
        detail={detail}
        story={{
          family: 'visibilityLoss',
          why: 'Your AI visibility fell from 40% to 20% on Gemini on Oct 8.',
          goal: 'AI visibility back to 40% on Gemini by Nov 7.',
        }}
      />,
    );
    await act(async () => button('Copy Data').click());
    const shown = document.querySelector('textarea')?.value ?? '';
    expect(shown).toContain('Why: Your AI visibility fell from 40% to 20% on Gemini on Oct 8.');
    expect(shown).toContain('Goal: AI visibility back to 40% on Gemini by Nov 7.');
  });

  it("copies with the browser's command where the clipboard is blocked", async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('denied')) },
    });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    render(<ActionExportButtons action={action} detail={detail} />);
    await act(async () => button('Copy Data').click());
    await act(async () => copyButton().click());
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(toast.success).toHaveBeenCalledWith('Action AC-52 copied: 1 task, 1 signal');
  });

  const affected = (over: Partial<Affected>): Affected => ({
    prompts: [],
    pages: [],
    promptTotal: 0,
    pageTotal: 0,
    platforms: [],
    lostPages: [],
    competitors: [],
    topics: [],
    ...over,
  });
  const prompt = (text: string) => ({
    id: null,
    text,
    platforms: [],
    lostPages: [],
    citedInstead: [],
    leaders: [],
    topics: [],
  });

  it('says how many prompts it copied, counting a group past the ones it names (AC-005)', async () => {
    render(
      <ActionExportButtons
        action={action}
        detail={detail}
        affected={affected({
          prompts: [prompt('Best coffee subscription?'), prompt('Coffee delivery')],
          promptTotal: 7,
        })}
      />,
    );
    await act(async () => button('Copy Data').click());
    await act(async () => copyButton().click());
    expect(toast.success).toHaveBeenCalledWith('Action AC-52 copied: 7 prompts, 1 task, 1 signal');
  });

  it('counts the pages of an action about pages', async () => {
    render(
      <ActionExportButtons
        action={action}
        detail={detail}
        affected={affected({
          pages: [
            {
              url: 'https://acme.example/pricing',
              sessions: 32,
              before: 40,
              platforms: [],
              issues: [],
            },
          ],
          pageTotal: 1,
        })}
      />,
    );
    await act(async () => button('Copy Data').click());
    await act(async () => copyButton().click());
    expect(toast.success).toHaveBeenCalledWith('Action AC-52 copied: 1 page, 1 task, 1 signal');
  });

  it('says so when neither way can copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('denied')) },
    });
    document.execCommand = vi.fn(() => false);
    render(<ActionExportButtons action={action} detail={detail} />);
    await act(async () => button('Copy Data').click());
    await act(async () => copyButton().click());
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't copy. The text is selected: press ⌘C or Ctrl+C.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('adds what a content opportunity action was sent from', async () => {
    render(
      <ActionExportButtons
        action={{ ...action, kind: 'content_opportunity', payload: { opportunityId: 'o1' } }}
        detail={detail}
      />,
    );
    await act(async () => button('Copy Data').click());
    const shown = document.querySelector('textarea')?.value ?? '';
    expect(shown).toContain('Content opportunity: Coffee subscription guide');
    expect(shown).toContain('Pages:\n- https://acme.example/subscriptions');
    expect(shown).toContain('1 prompt to answer:\n- Best coffee subscription?');
  });

  it('downloads a CSV Excel reads as UTF-8, named after the action', async () => {
    const saved: { blob: Blob; name: string }[] = [];
    URL.createObjectURL = (blob: Blob) => {
      saved.push({ blob, name: '' });
      return 'blob:csv';
    };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved[saved.length - 1].name = this.download;
    });
    render(<ActionExportButtons action={action} detail={detail} />);
    await exportAs('Export CSV');
    click.mockRestore();
    expect(saved[0].name).toBe('action-AC-52.csv');
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(saved[0].blob);
    });
    // UTF-8's byte order mark, then the header row.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.split('\n')[0]).toMatch(/^section,action,ref,/);
  });

  it('writes an Excel workbook with a sheet per tab', async () => {
    render(<ActionExportButtons action={action} detail={detail} />);
    await exportAs('Export Excel');
    expect(written).toHaveLength(1);
    expect(written[0].sheets.map((s) => s.sheet)).toEqual([
      'Action',
      'Tasks',
      'Signals',
      'History',
    ]);
    expect(written[0].file).toBe('action-AC-52.xlsx');
  });
});
