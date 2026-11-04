// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { routeRegistry } from './routes';

// The sidebar with Competitors on it (#1809 put it back, now under Reports):
// Chat's registry lists the page once, from the sidebar. Added here only if
// the menu ever drops it again.
vi.mock('@/config/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/dashboard')>();
  const listed = actual.dashboardNav.some((group) =>
    group.items.some((item) => item.href === '/dashboard/competitors'),
  );
  return {
    ...actual,
    dashboardNav: actual.dashboardNav.map((group) =>
      group.title === 'Analytics' && !listed
        ? {
            ...group,
            items: [
              ...group.items,
              {
                title: 'Competitors',
                href: '/dashboard/competitors',
                icon: group.items[0].icon,
                requiredFeature: 'competitor_tracking' as const,
              },
            ],
          }
        : group,
    ),
  };
});

describe('routeRegistry, once the sidebar lists a page Chat also adds', () => {
  it('lists it once', () => {
    const routes = routeRegistry({ cloud: true });
    expect(routes.filter((r) => r.href === '/dashboard/competitors')).toHaveLength(1);
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length);
  });
});
