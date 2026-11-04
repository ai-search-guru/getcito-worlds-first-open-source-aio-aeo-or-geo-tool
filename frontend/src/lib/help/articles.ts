/**
 * GetCito Help (CHAT-19 §4): one Markdown article per page, feature,
 * metric, setting and main task, in the repo's /help/{area}/{slug}.md, that
 * Chat answers how-to questions from (only approved ones), section by
 * section. This reads an article's front matter and splits it into the
 * sections retrieval returns one at a time. No dependency: the front matter
 * is a small fixed subset of YAML (`key: value`, `key: [a, b]`, booleans).
 */

/** The folders under /help: one per area of the app. */
export const HELP_AREAS = [
  'getting-started',
  'visibility',
  'prompts',
  'mentions',
  'citations',
  'competitors',
  'content',
  'site-audit',
  'action-center',
  'ai-traffic',
  'reports',
  'settings',
  'chat',
] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

/** The lowest plan an article's feature needs; `all` for every plan and self-hosted. */
export const HELP_PLANS = ['all', 'starter', 'growth', 'enterprise'] as const;
export type HelpPlan = (typeof HELP_PLANS)[number];

/** Words a section may have at most, so retrieval can return one alone (§4). */
export const MAX_SECTION_WORDS = 150;

export interface HelpFrontMatter {
  title: string;
  /** The page it is about, which Chat's navigation card opens. */
  route: string;
  keywords: string[];
  synonyms: string[];
  plan: HelpPlan;
  /** YYYY-MM-DD: when the article last changed. */
  updated: string;
  /** YYYY-MM-DD: when it was last checked against the app. */
  last_checked: string;
  owner: string;
  /** The app version it was checked against (package.json). */
  app_version: string;
  /** Chat answers only from approved articles. */
  approved: boolean;
  /** The documentation it was written from (repo paths). */
  sources: string[];
}

export interface HelpSection {
  /** Null for the text before the first heading. */
  heading: string | null;
  text: string;
}

export interface HelpArticle {
  area: string;
  slug: string;
  meta: Partial<HelpFrontMatter>;
  sections: HelpSection[];
}

const LIST_FIELDS = new Set(['keywords', 'synonyms', 'sources']);

function parseValue(key: string, raw: string): unknown {
  const value = raw.trim();
  if (LIST_FIELDS.has(key)) {
    if (!value.startsWith('[') || !value.endsWith(']')) return undefined;
    const inner = value.slice(1, -1).trim();
    return inner === ''
      ? []
      : inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, ''));
  }
  if (value === 'true' || value === 'false') return value === 'true';
  return value.replace(/^["']|["']$/g, '');
}

/** An article's front matter and sections; `path` is help/{area}/{slug}.md. */
export function parseHelpArticle(path: string, text: string): HelpArticle {
  const parts = path.replace(/\\/g, '/').split('/');
  const slug = (parts.at(-1) ?? '').replace(/\.md$/, '');
  const area = parts.at(-2) ?? '';
  const meta: Record<string, unknown> = {};
  let body = text;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match) {
    for (const line of match[1].split('\n')) {
      const at = line.indexOf(':');
      if (at <= 0) continue;
      const key = line.slice(0, at).trim();
      meta[key] = parseValue(key, line.slice(at + 1));
    }
    body = text.slice(match[0].length);
  }
  const sections: HelpSection[] = [];
  let current: HelpSection = { heading: null, text: '' };
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current.heading !== null || current.text.trim()) sections.push(current);
      current = { heading: heading[1].trim(), text: '' };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.heading !== null || current.text.trim()) sections.push(current);
  return {
    area,
    slug,
    meta: meta as Partial<HelpFrontMatter>,
    sections: sections.map((s) => ({ ...s, text: s.text.trim() })),
  };
}

/** Words in a section, as a reader counts them: Markdown marks aside. */
export function wordCount(text: string): number {
  return text
    .replace(/[#*_>`[\]()|-]/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
