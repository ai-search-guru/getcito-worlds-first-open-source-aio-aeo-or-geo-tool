import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanProvider, usePlanContext } from './PlanProvider';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';

/**
 * The demo brand (00380) is shown with Growth, the whole product: while it
 * is the brand on screen the plan context reads Growth, whatever the
 * organization's plan; Billing still reads the organization's own.
 */

// An in-memory localStorage for the brand store to persist to, before the store
// loads: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const { planId, ownPlanId, allowedModelIds } = usePlanContext();
  const { canUse } = useFeatureGate();
  return (
    <output
      data-plan={planId}
      data-own={ownPlanId}
      data-models={JSON.stringify(allowedModelIds)}
      data-shopping={String(canUse('shopping_analytics'))}
    />
  );
}

async function render(planId: 'starter' | 'enterprise', allowedModelIds: string[] | null = []) {
  await act(async () => {
    root.render(
      <PlanProvider planId={planId} allowedModelIds={allowedModelIds}>
        <Probe />
      </PlanProvider>,
    );
  });
  return container.querySelector('output')!.dataset;
}

function brand(id: string, isDemo = false): Brand {
  return {
    id,
    organizationId: 'org1',
    name: isDemo ? 'Brewline Coffee' : 'Acme',
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    isDemo,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

/** The workspace's own brand and its demo brand, the given one selected. */
function selectBrand(id: 'own' | 'demo') {
  useBrandStore.setState({ brands: [brand('own'), brand('demo', true)], activeBrandId: id });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useBrandStore.setState({ brands: [], activeBrandId: null });
  vi.unstubAllEnvs();
});

describe('PlanProvider', () => {
  it('shows the demo brand with Growth, the Billing plan staying Starter', async () => {
    selectBrand('demo');
    const shown = await render('starter');
    expect(shown.plan).toBe('growth');
    expect(shown.own).toBe('starter');
    expect(shown.shopping).toBe('true');
  });

  it("keeps the organization's plan on its own brand", async () => {
    selectBrand('own');
    const shown = await render('starter');
    expect(shown.plan).toBe('starter');
    expect(shown.own).toBe('starter');
    expect(shown.shopping).toBe('false');
  });

  it('follows the brand switcher without a reload', async () => {
    selectBrand('own');
    await render('starter');
    await act(async () => selectBrand('demo'));
    expect(container.querySelector('output')!.dataset.plan).toBe('growth');
  });

  it("keeps Enterprise's own plan and model overrides on the demo brand", async () => {
    selectBrand('demo');
    const shown = await render('enterprise', ['claude-sonnet-5']);
    expect(shown.plan).toBe('enterprise');
    expect(shown.models).toBe('["claude-sonnet-5"]');
  });

  it('shows everything self-hosted, where there is no demo brand', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    selectBrand('demo');
    const shown = await render('starter');
    expect(shown.plan).toBe('self_hosted');
    expect(shown.models).toBe('null');
  });
});
