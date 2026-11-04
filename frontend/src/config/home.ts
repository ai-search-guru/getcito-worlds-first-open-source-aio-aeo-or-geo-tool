/**
 * Where a signed-in user starts (New GetCito, AC-ALT2 §3): the Action
 * Center's Actions, where Getting started and the actions live. /dashboard
 * and /dashboard/action-center redirect here, and onboarding, payment and a
 * new brand land here.
 */
export const DASHBOARD_HOME = '/dashboard/action-center/actions';

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
