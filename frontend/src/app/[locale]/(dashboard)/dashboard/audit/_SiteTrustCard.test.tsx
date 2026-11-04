import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SiteTrust } from '@/lib/content/siteTrust';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';

const getSiteTrust = vi.fn();
vi.mock('@/lib/actions/audits', () => ({
  getSiteTrust: (...args: unknown[]) => getSiteTrust(...args),
}));

const { SiteTrustCard } = await import('./_SiteTrustCard');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Site trust in Site Audit (CE-043): five checks, each passing or saying what to add. */

const TRUST: SiteTrust = {
  checks: {
    about: { ok: true, url: 'https://acme.com/about' },
    contact: { ok: true, url: 'https://acme.com/contact' },
    editorial: { ok: false, url: null },
    organizationSchema: { ok: true, url: 'https://acme.com/' },
    authorPages: {
      ok: false,
      authors: [
        { name: 'Ada Lovelace', url: 'https://acme.com/authors/ada-lovelace' },
        { name: 'Bob Stone', url: null },
      ],
    },
  },
  score: 3,
  checkedAt: '2026-10-23T12:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  getSiteTrust.mockReset().mockResolvedValue(TRUST);
  openUpgrade.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function render(now?: Date, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC" now={now}>
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <SiteTrustCard brandId="b1" />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const rows = () => [...container.querySelectorAll('li')].map((li) => li.textContent);
const checkAgain = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!;

describe('SiteTrustCard', () => {
  it('shows the score and each check, with its page or what to add', async () => {
    await render();
    expect(getSiteTrust).toHaveBeenCalledWith('b1', false);
    expect(container.querySelector('#site-trust')!.textContent).toContain('Site trust 3/5');
    expect(rows()).toEqual([
      'About page · passesFound on your site.Open',
      'Contact page · passesFound on your site.Open',
      'Editorial policy · missingAdd a page on how you write and check content, at /editorial-policy or /how-we-review.',
      'Organization schema on the home page · passesYour home page names your organization in its JSON-LD.Open',
      'Author pages · missingNo page found for: Bob Stone. Add one for each, such as /authors/their-name.',
    ]);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://acme.com/about');
  });

  it('reads it again on Check again', async () => {
    await render();
    const again = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check again',
    )!;
    await act(async () => again.click());
    expect(getSiteTrust).toHaveBeenLastCalledWith('b1', true);
  });

  it('holds Check again for 10 minutes after a read, and says until when', async () => {
    await render(new Date('2026-10-23T12:04:00.000Z'));
    expect(checkAgain().disabled).toBe(true);
    expect(container.textContent).toContain('You can check again at 12:10 PM.');
    expect(checkAgain().getAttribute('aria-describedby')).toBe('site-trust-recheck');
  });

  it("says the site didn't answer on the rows a partial read leaves failing", async () => {
    getSiteTrust.mockResolvedValue({ ...TRUST, complete: false });
    await render(new Date('2026-10-23T12:04:00.000Z'));
    expect(rows()).toEqual([
      'About page · passesFound on your site.Open',
      'Contact page · passesFound on your site.Open',
      "Editorial policy · not readYour site didn't answer; checking again in a few minutes.",
      'Organization schema on the home page · passesYour home page names your organization in its JSON-LD.Open',
      "Author pages · not readYour site didn't answer; checking again in a few minutes.",
    ]);
  });

  it('still asks for authors first on a partial read', async () => {
    getSiteTrust.mockResolvedValue({
      ...TRUST,
      checks: { ...TRUST.checks, authorPages: { ok: false, authors: [] } },
      complete: false,
    });
    await render(new Date('2026-10-23T12:04:00.000Z'));
    expect(rows()[4]).toContain('Add your authors in Settings › Authors');
  });

  it('reads a partial read again once the 10 minutes are over', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-10-23T12:04:00.000Z'));
      getSiteTrust.mockResolvedValue({ ...TRUST, complete: false });
      await render();
      expect(getSiteTrust).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTime(5 * 60 * 1000));
      expect(getSiteTrust).toHaveBeenCalledTimes(1);
      getSiteTrust.mockResolvedValue({ ...TRUST, checkedAt: '2026-10-23T12:10:00.000Z' });
      await act(async () => vi.advanceTimersByTime(60 * 1000));
      expect(getSiteTrust).toHaveBeenCalledTimes(2);
      expect(getSiteTrust).toHaveBeenLastCalledWith('b1', false);
      expect(rows()[2]).toContain('Add a page on how you write and check content');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads nothing again on a read-only workspace: no partial re-read, Check again opens the upgrade dialog', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-10-23T12:04:00.000Z'));
      getSiteTrust.mockResolvedValue({ ...TRUST, complete: false });
      await render(undefined, true);
      expect(getSiteTrust).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTime(6 * 60 * 1000));
      expect(getSiteTrust).toHaveBeenCalledTimes(1);
      expect(checkAgain().disabled).toBe(false);
      await act(async () => checkAgain().click());
      expect(openUpgrade).toHaveBeenCalledExactlyOnceWith('Checking site trust again needs a plan');
      expect(getSiteTrust).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for authors first when there are none', async () => {
    getSiteTrust.mockResolvedValue({
      ...TRUST,
      checks: { ...TRUST.checks, authorPages: { ok: false, authors: [] } },
    });
    await render();
    expect(rows()[4]).toContain('Add your authors in Settings › Authors');
  });

  it("says so when it can't be read", async () => {
    getSiteTrust.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    expect(container.textContent).toContain("Couldn't read your site trust.");
  });

  it('says so when checking again fails, keeping the read', async () => {
    await render();
    getSiteTrust.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const again = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Check again',
    )!;
    await act(async () => again.click());
    expect(container.textContent).toContain("Couldn't check again. The read above still stands.");
    expect(container.textContent).toContain('Site trust 3/5');
  });

  it('scrolls into view when the address asks for it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    window.history.replaceState(null, '', '#site-trust');
    document.body.appendChild(container);
    await render();
    expect(scroll).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', '#');
    container.remove();
  });
});
