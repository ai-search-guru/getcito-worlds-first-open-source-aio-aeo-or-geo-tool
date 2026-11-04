import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ThemeToggle } from './ThemeToggle';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const theme = vi.hoisted(() => ({ resolved: 'light', set: vi.fn() }));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: theme.resolved, setTheme: theme.set }),
}));

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ThemeToggle />
      </NextIntlClientProvider>,
    );
  });
  return container.querySelector('button')!;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  theme.set.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ThemeToggle', () => {
  it('offers dark mode while the dashboard is light, and switches to it', () => {
    theme.resolved = 'light';
    const button = render();
    expect(button.getAttribute('aria-label')).toBe('Switch to dark mode');
    act(() => button.click());
    expect(theme.set).toHaveBeenCalledWith('dark');
  });

  it('offers light mode while the dashboard is dark, and switches back', () => {
    theme.resolved = 'dark';
    const button = render();
    expect(button.getAttribute('aria-label')).toBe('Switch to light mode');
    act(() => button.click());
    expect(theme.set).toHaveBeenCalledWith('light');
  });
});
