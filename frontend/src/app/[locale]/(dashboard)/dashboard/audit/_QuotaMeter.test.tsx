import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditAutoStatus, AuditQuota } from '@/lib/actions/audits';
import { UpgradeDialogContext } from '@/components/context/upgradeGate';
import { EmptyPoolMessage } from './_QuotaMeter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * "You've used your N audits" while auto-audit's runs still keep some (spec
 * §4.4); never without an active plan, whose 0 left isn't used up.
 */

const auto = (reserved: number): AuditAutoStatus => ({
  enabled: true,
  setting: null,
  emailAfterRun: false,
  perRun: 5,
  reserved,
  used: 5,
  running: 0,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  runs: [],
  nextRun: { day: 7, at: '2026-10-07T00:00:00.000Z' },
});

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

async function render(quota: AuditQuota, isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
        >
          <EmptyPoolMessage quota={quota} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

describe('EmptyPoolMessage', () => {
  it("says the user's share is used up while auto-audit's runs still keep some", async () => {
    await render({ used: 80, limit: 100, remaining: 0, auto: auto(20) });
    expect(container.textContent).toBe(
      "You've used your 75 audits. 20 auto audits are still scheduled. Turn off auto-audit to use them now, or upgrade.",
    );
  });

  it('says nothing without an active plan, though its runs read as still scheduled', async () => {
    await render({ used: 80, limit: 0, remaining: 0, noPlan: true, auto: auto(20) });
    expect(container.textContent).toBe('');
  });

  it('says nothing on a read-only workspace, marked or not', async () => {
    await render({ used: 80, limit: 100, remaining: 0, auto: auto(20) }, true);
    expect(container.textContent).toBe('');
  });
});
