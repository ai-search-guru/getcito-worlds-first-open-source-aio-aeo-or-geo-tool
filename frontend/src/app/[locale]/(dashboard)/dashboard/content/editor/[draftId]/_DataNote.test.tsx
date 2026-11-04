import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { useAuthStore } from '@/state/useAuthStore';
import { DATA_NOTE_KEY, DataNote, UsesYourData } from './_DataNote';

const updateUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: (...args: unknown[]) => updateUser(...args) } }),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const person = (metadata: Record<string, unknown> = {}) =>
  ({ id: 'u1', email: 'demo@getcito.local', user_metadata: metadata }) as unknown as User;

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  updateUser.mockReset();
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Uses your data', () => {
  it('counts the sources kept, and Edit sources opens them', async () => {
    const onEdit = vi.fn();
    await render(
      <UsesYourData
        counts={{ prompt: 1, fanout: 21, cited_page: 20, gsc_query: 10 }}
        onEdit={onEdit}
      />,
    );
    expect(container.textContent).toBe(
      'Uses your data: 1 prompt · 21 fan-outs · 20 cited pages · 10 Search Console queries · Edit sources',
    );
    await act(async () => container.querySelector('button')!.click());
    expect(onEdit).toHaveBeenCalled();
  });

  it('says when none are kept', async () => {
    await render(
      <UsesYourData
        counts={{ prompt: 0, fanout: 0, cited_page: 0, gsc_query: 0 }}
        onEdit={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('No sources kept yet · Edit sources');
  });
});

describe('the data note', () => {
  it('waits until the person is known, and never shows once they closed it', async () => {
    await render(<DataNote />);
    expect(container.textContent).toBe('');

    await act(async () => useAuthStore.setState({ user: person({ [DATA_NOTE_KEY]: true }) }));
    expect(container.textContent).toBe('');
  });

  it('shows on a first visit, and closing it is kept in the person’s own metadata', async () => {
    const closed = person({ full_name: 'Demo', [DATA_NOTE_KEY]: true });
    updateUser.mockResolvedValue({ data: { user: closed }, error: null });
    useAuthStore.setState({ user: person({ full_name: 'Demo' }) });
    await render(<DataNote />);
    expect(container.textContent).toBe(
      'Content Agent writes from your dataYour prompts, fan-outs, cited pages and Search Console queries. Every change shows the sources it used.',
    );

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    );
    expect(container.textContent).toBe('');
    expect(updateUser).toHaveBeenCalledWith({ data: { [DATA_NOTE_KEY]: true } });
    expect(useAuthStore.getState().user).toBe(closed);
  });

  it('goes away even when keeping it closed fails, and shows again next time', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateUser.mockResolvedValue({ data: { user: null }, error: new Error('offline') });
    useAuthStore.setState({ user: person() });
    await render(<DataNote />);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    );
    expect(container.textContent).toBe('');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    // Nothing was kept: the next visit shows it again.
    act(() => root.unmount());
    root = createRoot(container);
    await render(<DataNote />);
    expect(container.textContent).toContain('Content Agent writes from your data');
  });
});
