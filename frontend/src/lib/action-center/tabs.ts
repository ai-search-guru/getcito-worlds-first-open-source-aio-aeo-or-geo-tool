/**
 * The Action Center's tabs, in order: Actions first (New GetCito, AC-ALT2 §3:
 * everything starts at Actions), then Signals, KPIs and History.
 */
export const ACTION_CENTER_TABS = [
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'kpis', href: '/dashboard/action-center/kpis' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;

/**
 * Needs review (AC-010): tasks an agent wrote without the exact page, the
 * change, Done when or how it is checked. After the others, for admins and
 * managers only.
 */
export const REVIEW_TAB = { key: 'review', href: '/dashboard/action-center/review' } as const;

/** The review page tells the tab when a task is approved or dismissed, so its count reads again. */
export const TASK_REVIEWS_CHANGED = 'action-task-reviews-changed';
