import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * "Add a topic first": an admin or a manager gets "Add a topic" (a link to
 * the Topics tab with Add Topic open, another page, or a button that opens
 * it in place); anyone else, who can't add topics (#1790), is told whom to
 * ask, with no way in that would be refused.
 */

const viewer = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/useUserRole', () => ({
  useUserRole: () => ({ canManage: viewer.canManage }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, onClick }: React.ComponentProps<'a'>) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const { TopicFirstDialog, TopicFirstNotice } = await import('./TopicFirst');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();

beforeEach(() => {
  viewer.canManage = true;
  onOpenChange.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) =>
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
const text = () => document.body.textContent ?? '';
const addTopic = () =>
  [...document.body.querySelectorAll<HTMLElement>('a, button')].find(
    (el) => el.textContent === 'Add a topic',
  );

describe('TopicFirstDialog', () => {
  it('links an admin or a manager to the Topics tab with Add Topic open', () => {
    render(<TopicFirstDialog open onOpenChange={onOpenChange} />);
    expect(text()).toContain('Add a topic first');
    expect(text()).toContain('Add a topic, then come back here.');
    expect(addTopic()?.getAttribute('href')).toBe('/dashboard/prompts/topics?new=1');
  });

  it("links to another page's topics when told to", () => {
    render(
      <TopicFirstDialog
        open
        onOpenChange={onOpenChange}
        href="/dashboard/brands/b2/topics#add-topic"
      />,
    );
    expect(addTopic()?.getAttribute('href')).toBe('/dashboard/brands/b2/topics#add-topic');
  });

  it('opens Add Topic in place, closing itself, when the page gives a way to', async () => {
    const onAddTopic = vi.fn();
    render(<TopicFirstDialog open onOpenChange={onOpenChange} onAddTopic={onAddTopic} />);
    const button = addTopic()!;
    expect(button.tagName).toBe('BUTTON');
    await act(async () => button.click());
    expect(onAddTopic).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('tells anyone else to ask an admin or a manager, without a way in', () => {
    viewer.canManage = false;
    render(<TopicFirstDialog open onOpenChange={onOpenChange} onAddTopic={vi.fn()} />);
    expect(text()).toContain(
      'Prompts are grouped under topics. Ask an admin or a manager to add a topic first.',
    );
    expect(text()).not.toContain('Add a topic, then come back here.');
    expect(addTopic()).toBeUndefined();
    expect(
      [...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Close'),
    ).toBe(true);
  });
});

describe('TopicFirstNotice', () => {
  it('says to add a topic, or whom to ask', () => {
    render(<TopicFirstNotice />);
    expect(container.textContent).toContain('Add a topic, then come back here.');
    viewer.canManage = false;
    render(<TopicFirstNotice key="analyst" />);
    expect(container.textContent).toContain('Ask an admin or a manager to add a topic first.');
  });
});
