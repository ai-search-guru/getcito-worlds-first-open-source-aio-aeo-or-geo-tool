import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, isDashboardHomeItem } from './home';
import { ACTION_CENTER_TABS } from '@/lib/action-center/tabs';

/**
 * New GetCito (AC-ALT2 §3): everything starts at the Action Center's
 * Actions, and its tabs read Actions · Signals · KPIs · History.
 */
describe('the dashboard home', () => {
  it("is the Action Center's Actions", () => {
    expect(DASHBOARD_HOME).toBe('/dashboard/action-center/actions');
  });

  it('marks the Action Center item as the one the home page sits under', () => {
    expect(isDashboardHomeItem('/dashboard/action-center')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/action-center/actions')).toBe(true);
    expect(isDashboardHomeItem('/dashboard/insights')).toBe(false);
    expect(isDashboardHomeItem('/dashboard/action')).toBe(false);
  });

  it('opens the Action Center on Actions, then Signals, KPIs and History', () => {
    expect(ACTION_CENTER_TABS.map((tab) => tab.key)).toEqual([
      'actions',
      'signals',
      'kpis',
      'history',
    ]);
    expect(ACTION_CENTER_TABS[0].href).toBe(DASHBOARD_HOME);
  });
});
