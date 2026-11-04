import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { dashboardNav } from '@/config/dashboard';
import { type Feature, isCloud } from '@/config/plans';
import { ALL_DATE_PRESETS } from '@/config/datePresets';
import { PROMPT_RANGE_PRESETS, SCRAPER_GROUPS } from '@/config/promptOptions';
import { dashboardNavLabelKeys } from '@/lib/dashboardNavigation';
import {
  SETTINGS_SECTIONS,
  hasSettingsSection,
} from '@/app/[locale]/(dashboard)/dashboard/settings/_sections';
import type { ChatHref } from './events';

/**
 * Chat's "Go to a page" (CHAT-19 §2, Wave 1 W1-28): the pages Chat can
 * open, made from the live sidebar (config/dashboard.ts) and Settings'
 * sections, named as the sidebar names them, with the filters each page
 * keeps in its address; and a rules-based router that answers plain "open
 * X for Y" requests without the model. It answers only when it understood
 * every word; anything else (a question, a filter it doesn't know) is the
 * model's. Pure: no database, no AI usage.
 */

/** A filter a page keeps in its address, and the values it takes. */
export interface RouteFilter {
  key: 'range' | 'platform';
  /** The page's query parameter. */
  param: string;
  /** The values the page accepts. */
  values: readonly string[];
}

export interface ChatRoute {
  /** The address without /dashboard/: "insights", "prompts/tracked", "settings/billing". */
  id: string;
  href: ChatHref;
  /** As the sidebar or Settings names it. */
  name: string;
  /** The item it sits under ("Prompts", "Settings"); null for a top-level page. */
  section: string | null;
  /** The plan feature its page needs; a plan without it can't open it. */
  requiredFeature?: Feature;
  /** Other words people use for it, lower case. */
  synonyms: readonly string[];
  filters: readonly RouteFilter[];
}

const navT = createTranslator({ locale: 'en', messages, namespace: 'nav' });
const settingsT = createTranslator({ locale: 'en', messages, namespace: 'settings' });
const actionCenterT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter' });
const brandsT = createTranslator({ locale: 'en', messages, namespace: 'brands' });

/** The platform ids the pages filter by: the answer engines tracked. */
export const PLATFORM_IDS = SCRAPER_GROUPS.flatMap((group) => group.scrapers.map((s) => s.id));
export type PlatformId = (typeof PLATFORM_IDS)[number];

const RANGE = (param: string, values: readonly string[]): RouteFilter => ({
  key: 'range',
  param,
  values: values.filter((v) => v !== 'custom'),
});
const PLATFORM = (param: string): RouteFilter => ({ key: 'platform', param, values: PLATFORM_IDS });

/** What each page's address keeps (the pages' readUrlParam / readUrlChoice), by id. */
const FILTERS: Record<string, readonly RouteFilter[]> = {
  // No platform: Insights' `model` is the answers' model slugs (model_used,
  // "gpt-5-5,gpt-5-3-mini"), not a platform id, so `model=chatgpt-web`
  // would open an empty page.
  insights: [RANGE('range', ALL_DATE_PRESETS)],
  citations: [RANGE('preset', ['24h', '7d', '30d', '90d', 'all']), PLATFORM('platform')],
  prompts: [RANGE('range', PROMPT_RANGE_PRESETS)],
  'prompts/tracked': [RANGE('range', PROMPT_RANGE_PRESETS)],
  'prompts/topics': [RANGE('range', PROMPT_RANGE_PRESETS)],
  'prompts/fan-outs': [RANGE('range', PROMPT_RANGE_PRESETS)],
  competitors: [RANGE('preset', ['7d', '30d', '90d', 'all'])],
};

/** Other words for a page, by id. */
const SYNONYMS: Record<string, readonly string[]> = {
  // "insights" alone is this page's address and Prompts › Insights' name: the model asks.
  insights: ['visibility', 'answer engine insights', 'visibility dashboard', 'insights'],
  // Was Chat › Agents.
  agents: ['agents', 'my agents', 'agent centre'],
  'action-center': ['actions', 'action centre'],
  'action-center/signals': ['signals'],
  'action-center/kpis': ['kpis', 'kpi', 'goals'],
  'action-center/history': ['action history', 'history'],
  content: ['content opportunities', 'opportunities'],
  'content/plan': ['content plan'],
  'content/editor': ['content editor', 'editor'],
  'content/library': ['content library', 'drafts', 'library'],
  audit: ['site audit', 'audits'],
  'prompts/tracked': ['tracked prompts', 'my prompts'],
  'prompts/suggestions': ['prompt suggestions', 'suggestions'],
  'prompts/fan-outs': ['query fan-outs', 'fan-outs', 'fanouts', 'fan outs'],
  'prompts/insights': ['prompts insights', 'prompt insights', 'search volume', 'ai search volume'],
  mentions: ['mentions & sentiment', 'mentions and sentiment', 'sentiment'],
  citations: ['sources', 'cited sources'],
  shopping: ['product visibility', 'shopping'],
  traffic: ['ai traffic', 'referral traffic', 'traffic'],
  competitors: ['competitors', 'competitor comparison', 'head to head'],
  brands: ['brands', 'all brands', 'my brands'],
  settings: ['settings'],
  'settings/billing': ['plan', 'subscription'],
  'settings/api-keys': ['api key', 'mcp'],
  'settings/roles-access': ['roles and access', 'roles', 'permissions'],
};

/** Pages the sidebar doesn't list but people go to, named as their page names them. */
const EXTRA_PAGES: {
  href: ChatHref;
  name: string;
  section: string | null;
  requiredFeature?: Feature;
}[] = [
  {
    href: '/dashboard/action-center/signals',
    name: actionCenterT('tabs.signals'),
    section: navT('actionCenter'),
  },
  {
    href: '/dashboard/action-center/kpis',
    name: actionCenterT('tabs.kpis'),
    section: navT('actionCenter'),
  },
  {
    href: '/dashboard/action-center/history',
    name: actionCenterT('tabs.history'),
    section: navT('actionCenter'),
  },
  {
    href: '/dashboard/competitors',
    name: navT('competitors'),
    section: null,
    requiredFeature: 'competitor_tracking',
  },
  { href: '/dashboard/brands', name: brandsT('title'), section: null },
];

/** Settings sections by their Settings name. */
const SETTINGS_NAMES: Partial<Record<(typeof SETTINGS_SECTIONS)[number], string>> = {
  account: settingsT('account'),
  organization: settingsT('organization'),
  team: settingsT('team'),
  'roles-access': settingsT('rolesAccess'),
  'menu-access': settingsT('menuAccess.title'),
  notifications: settingsT('notifications'),
  integrations: settingsT('integrations'),
  'api-keys': settingsT('apiKeys'),
  'ai-providers': settingsT('aiProviders'),
  billing: settingsT('billing'),
};

const idOf = (href: string) => href.replace(/^\/dashboard\/?/, '');
const navName = (title: string) =>
  dashboardNavLabelKeys[title] ? navT(dashboardNavLabelKeys[title] as never) : title;

function route(
  href: ChatHref,
  name: string,
  section: string | null,
  requiredFeature?: Feature,
): ChatRoute {
  const id = idOf(href);
  return {
    id,
    href,
    name,
    section,
    ...(requiredFeature ? { requiredFeature } : {}),
    synonyms: SYNONYMS[id] ?? [],
    filters: FILTERS[id] ?? [],
  };
}

/**
 * Every page Chat can open, from the live sidebar and Settings, in the
 * sidebar's order: Settings' sections this install shows (no Billing or AI
 * Providers on a self-hosted one). Chat itself (its own page) isn't one.
 */
export function routeRegistry({ cloud = isCloud() }: { cloud?: boolean } = {}): ChatRoute[] {
  const out: ChatRoute[] = [];
  for (const group of dashboardNav) {
    for (const item of group.items) {
      if (item.href === '/dashboard/agent') continue;
      const name = navName(item.title);
      out.push(route(item.href as ChatHref, name, null, item.requiredFeature));
      for (const child of item.children ?? []) {
        // Content's Opportunities is the item's own address.
        if (child.href === item.href) continue;
        out.push(route(child.href as ChatHref, navName(child.title), name, item.requiredFeature));
      }
    }
  }
  for (const page of EXTRA_PAGES) {
    // A page the sidebar lists (Competitors, once it's back on it) is there already.
    if (out.some((r) => r.href === page.href)) continue;
    out.push(route(page.href, page.name, page.section, page.requiredFeature));
  }
  out.push(route('/dashboard/settings', navT('settings'), null));
  for (const section of SETTINGS_SECTIONS) {
    const name = SETTINGS_NAMES[section];
    if (name && hasSettingsSection(section, { isCloud: cloud })) {
      out.push(route(`/dashboard/settings/${section}`, name, navT('settings')));
    }
  }
  return out;
}

/** A route by its id or its address; undefined for none. */
export function routeById(idOrHref: string, routes = routeRegistry()): ChatRoute | undefined {
  const id = idOf(idOrHref.trim());
  return routes.find((r) => r.id === id);
}

/** The address with the filters the page keeps; one it doesn't is left out. */
export function hrefWithFilters(
  route: ChatRoute,
  filters: Partial<Record<RouteFilter['key'], string>>,
): { href: ChatHref; applied: { key: RouteFilter['key']; value: string }[] } {
  const params = new URLSearchParams();
  const applied: { key: RouteFilter['key']; value: string }[] = [];
  for (const filter of route.filters) {
    const value = filters[filter.key];
    if (!value || !filter.values.includes(value)) continue;
    params.set(filter.param, value);
    applied.push({ key: filter.key, value });
  }
  const query = params.toString();
  return { href: (query ? `${route.href}?${query}` : route.href) as ChatHref, applied };
}

/** Platform names people say, to the ids the pages filter by. */
const PLATFORM_WORDS: [string, PlatformId][] = [
  ['google ai overviews', 'google-aio'],
  ['ai overviews', 'google-aio'],
  ['google ai mode', 'google-aimode'],
  ['ai mode', 'google-aimode'],
  ['microsoft copilot', 'copilot-web'],
  ['copilot', 'copilot-web'],
  ['google gemini', 'gemini-web'],
  ['gemini', 'gemini-web'],
  ['chatgpt', 'chatgpt-web'],
  ['perplexity', 'perplexity-web'],
  ['grok', 'grok-web'],
];

/** Date ranges people say, to the pages' range values. */
const RANGE_WORDS: [RegExp, string][] = [
  [/\b(last|past) 24 hours\b|\btoday\b|\b24h\b/, '24h'],
  [/\b(last|past) (7 days|week)\b|\b7d\b|\bthis week\b/, '7d'],
  [/\b(last|past) (30 days|month)\b|\b30d\b|\bthis month\b/, '30d'],
  [/\b(last|past) (90 days|3 months|three months|quarter)\b|\b90d\b/, '90d'],
  [/\ball time\b/, 'all'],
];

const NAV_VERB = /^(please )?(open|show( me)?|take me to|go to|navigate to|bring up|jump to)\b/;
/** Words a plain request may hold around the page and its filters. */
const FILLER = new Set(
  'the a an my our page tab screen view for from on in with and of please me to over during only data results'.split(
    ' ',
  ),
);

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[›>»|,.!;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hasPhrase = (text: string, phrase: string) =>
  new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text);

/** The words a route may be asked by: its name, under its section, and its synonyms. */
function phrasesOf(route: ChatRoute): string[] {
  const name = normalize(route.name);
  return [
    name,
    ...(route.section ? [normalize(`${route.section} ${route.name}`)] : []),
    ...route.synonyms.map(normalize),
  ];
}

export interface RoutedRequest {
  route: ChatRoute;
  filters: Partial<Record<RouteFilter['key'], string>>;
}

/**
 * A plain navigation request ("Open Visibility for Perplexity, last 30
 * days", "Take me to Settings › AI Providers"), or null for anything it
 * didn't fully understand: no navigation verb, a question, a page it
 * doesn't know, or words left over (a filter it can't set). Null goes to
 * the model; a match needs no model and no AI usage.
 */
export function routeRequest(text: string, routes = routeRegistry()): RoutedRequest | null {
  const said = normalize(text);
  if (/\?/.test(text) || /\b(why|how|what|which|explain|compare|summari[sz]e)\b/.test(said)) {
    return null;
  }
  const verb = NAV_VERB.exec(said);
  if (!verb) return null;
  let rest = ` ${said.slice(verb[0].length).trim()} `;

  // The page: the longest phrase of any route found in the request. Two
  // pages it could be ("plan": Content › Plan or Billing) are the model's.
  let best: { route: ChatRoute; phrase: string } | null = null;
  let tied = false;
  for (const route of routes) {
    for (const phrase of phrasesOf(route)) {
      if (!hasPhrase(rest.trim(), phrase)) continue;
      if (!best || phrase.length > best.phrase.length) {
        best = { route, phrase };
        tied = false;
      } else if (phrase.length === best.phrase.length && route.id !== best.route.id) {
        tied = true;
      }
    }
  }
  if (!best || tied) return null;
  rest = rest.replace(` ${best.phrase} `, ' ');

  const filters: RoutedRequest['filters'] = {};
  for (const [phrase, platform] of PLATFORM_WORDS) {
    if (hasPhrase(rest.trim(), phrase)) {
      filters.platform = platform;
      rest = rest.replace(` ${phrase} `, ' ');
      break;
    }
  }
  for (const [pattern, range] of RANGE_WORDS) {
    const match = pattern.exec(rest);
    if (match) {
      filters.range = range;
      rest = rest.replace(match[0], ' ');
      break;
    }
  }
  // A filter the page doesn't keep, or words it didn't understand: the model's.
  const supported = new Set(best.route.filters.map((f) => f.key));
  if (Object.keys(filters).some((key) => !supported.has(key as RouteFilter['key']))) return null;
  const left = rest.split(' ').filter((word) => word && !FILLER.has(word));
  if (left.length > 0) return null;
  const { applied } = hrefWithFilters(best.route, filters);
  // A value the page doesn't take (an all-time range where there's none) isn't understood either.
  if (applied.length !== Object.keys(filters).length) return null;
  return { route: best.route, filters };
}
