import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Sign-up from an invitation link (`?invite=…&email=…&next=/invite/…`): the
 * form keeps the invited address and the way back, and the link's token and
 * address leave the address bar once read (SEC-10a).
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const oauthNext = vi.hoisted(() => [] as (string | null | undefined)[]);
vi.mock('@/components/auth/OauthButtons', () => ({
  OAuthButtons: ({ next }: { next?: string | null }) => {
    oauthNext.push(next);
    return null;
  },
}));

const { SignUpForm } = await import('./SignUpForm');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  oauthNext.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

function render() {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SignUpForm />
      </NextIntlClientProvider>,
    ),
  );
}

const emailInput = () => container.querySelector<HTMLInputElement>('#email')!;

describe('SignUpForm', () => {
  it("takes an invitation's token and address out of the address bar, and keeps them", () => {
    window.history.replaceState(
      null,
      '',
      '/en/sign-up?invite=tok_123&email=cal%40acme.test&next=%2Fen%2Finvite%2Ftok_123',
    );
    render();
    expect(window.location.pathname).toBe('/en/sign-up');
    expect(window.location.search).toBe('');

    // Drawn again with the clean address: the form still has what it read.
    render();
    expect(emailInput().value).toBe('cal@acme.test');
    expect(emailInput().disabled).toBe(true);
    expect(oauthNext.at(-1)).toBe('/en/invite/tok_123');
  });

  it('leaves a sign-up without an invitation as it is', () => {
    window.history.replaceState(null, '', '/en/sign-up?next=%2Fen%2Fdashboard%2Fchat');
    render();
    expect(window.location.search).toBe('?next=%2Fen%2Fdashboard%2Fchat');
    expect(emailInput().value).toBe('');
    expect(emailInput().disabled).toBe(false);
    expect(oauthNext.at(-1)).toBe('/en/dashboard/chat');
  });
});
