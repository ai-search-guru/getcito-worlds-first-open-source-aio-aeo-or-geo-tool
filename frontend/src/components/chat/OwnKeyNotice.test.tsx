import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/context/RoleProvider';
import type { FailingKey } from '@/lib/chat/keyHealth';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ChatKeyNotice } = await import('./OwnKeyNotice');

/**
 * The composer's line while the workspace's own AI key fails (AGENT-OWN-KEY
 * §5.2 item 5): why, and where to fix it for an Admin.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(failing: FailingKey | null, role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <ChatKeyNotice failing={failing} />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const line = () => container.querySelector('[data-slot="chat-key-notice"]');

describe('ChatKeyNotice', () => {
  it('says why and that Chat stops on the key, with Fix in AI Providers for an Admin', async () => {
    await render({ class: 'invalid', provider: 'anthropic' });
    expect(line()!.textContent).toContain(
      'Anthropic turned down your workspace’s key. Chat stops on it until it’s fixed.',
    );
    const fix = line()!.querySelector('[data-action="chat.fixKey"]')!;
    expect(fix.getAttribute('href')).toBe('/dashboard/settings/ai-providers');
  });

  it('asks an Admin for anyone else, and says nothing while the key works', async () => {
    await render({ class: 'unreadable', provider: 'azure' }, 'analyst');
    expect(line()!.textContent).toContain('An Admin can fix it in Settings › AI Providers.');
    expect(line()!.querySelector('[data-action="chat.fixKey"]')).toBeNull();
    await render(null);
    expect(line()).toBeNull();
  });
});
