import type { BrandPrefKey, NavChild, NavItem } from '@/config/dashboard';
import { menuSectionOf } from '@/lib/menuAccess';

type Translator = (key: string) => string;

/** Every dashboard title rendered from dashboardNav is resolved through this
 * map. Keeping it outside either layout component prevents the desktop and
 * mobile menus from silently falling out of sync. */
export const dashboardNavLabelKeys: Record<string, string> = {
  Chat: 'chat',
  'Agent Center': 'agentCenter',
  'Action Center': 'actionCenter',
  'Answer Engine Insights': 'insights',
  Competitors: 'competitors',
  'AI Referral Traffic': 'traffic',
  Prompts: 'prompts',
  'Tracked Prompts': 'trackedPrompts',
  'Prompt Suggestions': 'promptSuggestions',
  Topics: 'topics',
  'Query Fan-outs': 'queryFanouts',
  'Prompts Insights': 'promptsInsights',
  Content: 'content',
  Plan: 'contentPlan',
  Editor: 'contentEditor',
  Opportunities: 'contentOpportunities',
  Library: 'contentLibrary',
  'Site Audit': 'audit',
  Citations: 'citations',
  Mentions: 'mentions',
  Shopping: 'shopping',
  Reports: 'reports',
};

/** Map from the static group title string in dashboard.ts to its nav key. */
export const dashboardNavGroupKeys: Record<string, string> = {
  Execution: 'execution',
  Analytics: 'analytics',
};

/** Resolve a NavGroup.title to its translated label, or return the raw string
 *  as a fallback so new groups surface immediately rather than silently. */
export function getDashboardNavGroupLabel(title: string, t: Translator): string {
  const key = dashboardNavGroupKeys[title];
  return key ? t(key) : title;
}

export function getDashboardNavLabel(title: string, t: Translator): string {
  const key = dashboardNavLabelKeys[title];
  return key ? t(key) : title;
}

/**
 * The submenu entry the current page belongs to: its own route, or a page
 * under it (a topic's page sits under Topics, a draft under the Editor).
 * When one entry's route holds another's
 * (Opportunities is /dashboard/content, the Library is
 * /dashboard/content/library), the longer match wins, so only one is current.
 */
export function activeChildHref(children: NavChild[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const { href } of children) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && href.length > bestLength) {
      best = href;
      bestLength = href.length;
    }
  }
  return best;
}

/**
 * Where a submenu entry links: its route, or the page open under it when it
 * keeps it (the Editor, on a draft: clicking it doesn't open the draft again).
 */
export function childLinkHref(child: NavChild, pathname: string): string {
  return child.keepsPage && pathname.startsWith(`${child.href}/`) ? pathname : child.href;
}

/** Brand preferences hide a navigation item entirely; they are intentionally
 * separate from plan gates, which render a visible but disabled item. So do
 * the sections the viewer's menu leaves out (menu access): off the menu, the
 * page still opens from a link. And so does the new Chat off for the
 * workspace (CHAT_AGENTIC) an item only it has (Agent Center), whose pages
 * aren't there then. */
export function shouldShowDashboardNavItem(
  item: NavItem,
  brandPrefs: Record<BrandPrefKey, boolean>,
  hiddenSections: ReadonlySet<string> = new Set(),
  chatAgentic = false,
): boolean {
  if (item.requiresChatAgentic && !chatAgentic) return false;
  const section = menuSectionOf(item.href);
  if (section && hiddenSections.has(section)) return false;
  return !item.requiresBrandPref || brandPrefs[item.requiresBrandPref];
}

/** Chat's menu item: its route stays /dashboard/agent. */
export const CHAT_HREF = '/dashboard/agent';

/** Chat's address with the new Chat on for the workspace (CHAT_AGENTIC, CHAT-01 item 1). */
export const CHAT_AGENTIC_HREF = '/dashboard/chat';

/**
 * Where a menu item links. With the new Chat on, Chat opens /dashboard/chat
 * (its old address would only redirect there) and is the current page on
 * every Chat route; the item keeps CHAT_HREF for its badge and menu section.
 */
export function navItemHref(item: Pick<NavItem, 'href'>, chatAgentic: boolean): string {
  return chatAgentic && item.href === CHAT_HREF ? CHAT_AGENTIC_HREF : item.href;
}

/**
 * The badge beside a menu item. Chat has its own: that it needs setting up
 * while the organization has no provider key for it (`chatSetUp`, the words
 * to show; cloud only), never with the new Chat on (`chatAgentic`), which
 * runs on the plan's AI limit without a key. The demo brand is no exception:
 * its Chat is the real one, locked as the rest of the demo. Every other item
 * keeps its own.
 */
export function dashboardNavBadge(
  item: NavItem,
  { chatAgentic = false, chatSetUp = null }: { chatAgentic?: boolean; chatSetUp?: string | null },
): string | undefined {
  if (item.href === CHAT_HREF && chatSetUp && !chatAgentic) return chatSetUp;
  return item.badge;
}
