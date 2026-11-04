import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPendingTab } from './pendingTab';

function fakeTab() {
  const body = document.implementation.createHTMLDocument('').body;
  return {
    closed: false,
    document: { title: '', body },
    location: { replace: vi.fn() },
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('openPendingTab', () => {
  it('opens a tab at once, says what is happening, then moves it to the page', () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

    const pending = openPendingTab('Adding prompts…');
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(pending.opened).toBe(true);
    expect(tab.document.title).toBe('Adding prompts…');
    expect(tab.document.body.textContent).toBe('Adding prompts…');

    pending.go('/dashboard/prompts/tracked');
    expect(tab.location.replace).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard/prompts/tracked`,
    );
  });

  it('closes the tab when there is nothing to show', () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

    const pending = openPendingTab('Adding prompts…');
    pending.close();
    expect(tab.close).toHaveBeenCalledTimes(1);
    // A tab the user already closed is left alone.
    pending.go('/dashboard/prompts/tracked');
    pending.close();
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalledTimes(1);
  });

  it('says so when the browser blocks the tab', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    const pending = openPendingTab('Adding prompts…');
    expect(pending.opened).toBe(false);
    expect(() => {
      pending.go('/dashboard/prompts/tracked');
      pending.close();
    }).not.toThrow();
  });
});
