import {
  BarChart3,
  Bot,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  LineChart,
  MessageCircleMore,
  Quote,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { Feature } from '@/config/plans';

/**
 * A brand-level preference that, when present on a NavItem, must be `true`
 * on the active brand for the item to render at all. Distinct from plan-level
 * `requiredFeature` which downgrades the item to a locked/disabled state when
 * the plan doesn't include it — `requiresBrandPref` hides the item entirely so
 * it doesn't appear as a "you could have this if you paid more" hint when the
 * active brand isn't supposed to see Shopping in the first place.
 */
export type BrandPrefKey = 'shoppingModeEnabled';

/** A submenu entry under a NavItem (PROMPT-001). */
export interface NavChild {
  title: string;
  href: string;
  /** On one of its pages, it links to that page: the Editor stays on the draft open. */
  keepsPage?: boolean;
  /** A short tag after the label, e.g. "New". */
  badge?: string;
}

export interface NavItem {
  title: string;
  href: string;
  /** Opens as a submenu under the item; the item itself then toggles it. */
  children?: NavChild[];
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  disabled?: boolean;
  requiredFeature?: Feature;
  requiresBrandPref?: BrandPrefKey;
  /**
   * Only with the new Chat on for the workspace (CHAT_AGENTIC): off, the item
   * is on no menu and in no list of the menu's sections, as its pages aren't
   * there either. Agent Center.
   */
  requiresChatAgentic?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/**
 * The brands page has no item here: the brand switcher above the menu opens
 * it ("Show My All Brands") and the selected brand's settings.
 */
export const dashboardNav: NavGroup[] = [
  /**
   * Chat first, above the groups and in none of them: it is where you ask
   * about anything below, or let the agent do the work. The route stays
   * /dashboard/agent: renaming the URL would break every existing link for a
   * label change, and the sidebar's "Set up" badge keys off that href.
   *
   * Agent Center right under it: the agents that run in Chat, on a page of
   * their own (was Chat › Agents, /dashboard/chat/agents, which redirects
   * here). Gated as Chat is, and there only with the new Chat on.
   */
  {
    items: [
      {
        title: 'Chat',
        href: '/dashboard/agent',
        icon: Sparkles,
        requiredFeature: 'ai_agent',
      },
      {
        title: 'Agent Center',
        href: '/dashboard/agents',
        icon: Bot,
        requiredFeature: 'ai_agent',
        requiresChatAgentic: true,
      },
    ],
  },
  /**
   * New GetCito: the groups name the two things the product does. Execution
   * does the work (actions, content, page fixes); Analytics shows where the
   * brand stands in AI search.
   */
  {
    title: 'Execution',
    items: [
      {
        title: 'Action Center',
        href: '/dashboard/action-center',
        icon: Target,
      },
      // Content Editor (CE-001): a group, like Prompts, and new as a whole.
      // Its pages in the order the work goes: Opportunities (today's page,
      // keeping /dashboard/content) finds what to write, the Plan says what
      // to do next (CE-014), the Editor goes back to the draft last opened,
      // else starts a new page, and the Library lists every page written or
      // changed in GetCito.
      {
        title: 'Content',
        href: '/dashboard/content',
        icon: FileText,
        requiredFeature: 'content_optimization',
        children: [
          { title: 'Opportunities', href: '/dashboard/content' },
          { title: 'Plan', href: '/dashboard/content/plan' },
          // A draft open in the editor (CE-004) is under it.
          { title: 'Editor', href: '/dashboard/content/editor', keepsPage: true },
          { title: 'Library', href: '/dashboard/content/library' },
        ],
      },
      {
        title: 'Site Audit',
        href: '/dashboard/audit',
        icon: Gauge,
        requiredFeature: 'content_optimization',
      },
    ],
  },
  {
    title: 'Analytics',
    items: [
      {
        title: 'Answer Engine Insights',
        href: '/dashboard/insights',
        icon: BarChart3,
        requiredFeature: 'basic_insights',
      },
      // Prompts right under Brand Visibility: adding prompts is the way in,
      // so nothing sits between them (Competitors moved under Reports).
      {
        title: 'Prompts',
        href: '/dashboard/prompts',
        icon: Globe,
        children: [
          { title: 'Tracked Prompts', href: '/dashboard/prompts/tracked' },
          { title: 'Prompt Suggestions', href: '/dashboard/prompts/suggestions' },
          // Was the Topics page (/dashboard/topics, which redirects here).
          { title: 'Topics', href: '/dashboard/prompts/topics' },
          { title: 'Query Fan-outs', href: '/dashboard/prompts/fan-outs' },
          { title: 'Prompts Insights', href: '/dashboard/prompts/insights' },
        ],
      },
      // Mentions & Sentiment (MS-05): beside Citations, its sibling concept.
      {
        title: 'Mentions',
        href: '/dashboard/mentions',
        icon: MessageCircleMore,
      },
      {
        title: 'Citations',
        href: '/dashboard/citations',
        icon: Quote,
      },
      {
        // Product Visibility (ECOM-spec): new as a whole, with its Shelf,
        // Products and the rest, for brands that sell online.
        title: 'Shopping',
        href: '/dashboard/shopping',
        icon: ShoppingBag,
        requiredFeature: 'shopping_analytics',
        requiresBrandPref: 'shoppingModeEnabled',
      },
      {
        title: 'AI Referral Traffic',
        href: '/dashboard/traffic',
        icon: LineChart,
        requiredFeature: 'advanced_analytics',
      },
    ],
  },
  /**
   * Reports sits in its own group rather than under Analytics or Execution,
   * because it draws on both: of its thirteen sections, `auditScore` comes from
   * Site Audit and the rest from the analytics surfaces. Filing it under either
   * heading would understate what it covers.
   *
   * It is also the only way into /dashboard/reports besides the button on
   * Visibility — from Citations or Site Audit there was no route to it at all.
   *
   * Competitors, the head-to-head with each competitor, sits right under it,
   * out of Analytics so that group stays short. Brand Visibility's
   * Leaderboard still opens it.
   */
  {
    items: [
      {
        title: 'Reports',
        href: '/dashboard/reports',
        icon: FileBarChart,
      },
      {
        title: 'Competitors',
        href: '/dashboard/competitors',
        icon: Users,
        requiredFeature: 'competitor_tracking',
      },
    ],
  },
];
