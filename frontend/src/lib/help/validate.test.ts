// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HELP_AREAS,
  HELP_PLANS,
  MAX_SECTION_WORDS,
  parseHelpArticle,
  wordCount,
  type HelpArticle,
} from './articles';
import { SETTINGS_SECTIONS } from '@/app/[locale]/(dashboard)/dashboard/settings/_sections';

/**
 * Every Help article (repo /help, CHAT-19 §4) keeps the format Chat's Help
 * answers rely on: its front matter, a route to a page of the app, short
 * sections, and nothing internal (CHAT-19 §3 "Never shown").
 */

const REPO = path.resolve(__dirname, '../../../..');
const HELP = path.join(REPO, 'help');
const APP = path.join(REPO, 'frontend/src/app/[locale]/(dashboard)');

function articleFiles(dir = HELP): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return articleFiles(full);
    return entry.endsWith('.md') && full !== path.join(HELP, 'README.md') ? [full] : [];
  });
}

/** The app's page for a route: a folder per segment, or a [param] folder for any. */
function pageExists(route: string): boolean {
  let dirs = [APP];
  for (const segment of route.split('?')[0].split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const named = path.join(dir, segment);
      const params = readdirSync(dir)
        .filter((entry) => /^\[[^.\]]+\]$/.test(entry))
        .map((entry) => path.join(dir, entry));
      return [...(existsSync(named) ? [named] : []), ...params];
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Words that would show internals in an answer (CHAT-19 §3). */
const INTERNAL =
  /\b(supabase|postgres(ql)?|sql|migration|database table|api\/|localhost|organization_id|brand_id|json|webhook secret|stack trace)\b/i;

function problemsOf(file: string, article: HelpArticle): string[] {
  const at = path.relative(REPO, file);
  const out: string[] = [];
  const m = article.meta;
  const say = (problem: string) => out.push(`${at}: ${problem}`);

  if (!(HELP_AREAS as readonly string[]).includes(article.area))
    say(`unknown area ${article.area}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(article.slug)) say('slug is not kebab-case');
  if (typeof m.title !== 'string' || !m.title || m.title.length > 80)
    say('title missing or over 80');
  if (typeof m.route !== 'string' || !m.route.startsWith('/dashboard')) {
    say('route must be an app page under /dashboard');
  } else {
    if (!pageExists(m.route)) say(`route ${m.route} is no page of the app`);
    const section = /^\/dashboard\/settings\/([^/?]+)/.exec(m.route)?.[1];
    if (section && !(SETTINGS_SECTIONS as readonly string[]).includes(section)) {
      say(`route ${m.route} names no Settings section`);
    }
  }
  if (!Array.isArray(m.keywords) || m.keywords.length < 3) say('needs 3 keywords or more');
  if (!Array.isArray(m.synonyms)) say('synonyms must be a list');
  if (!(HELP_PLANS as readonly string[]).includes(m.plan as string))
    say('plan must be all, starter, growth or enterprise');
  for (const key of ['updated', 'last_checked'] as const) {
    const value = m[key];
    if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) {
      say(`${key} must be YYYY-MM-DD`);
    }
  }
  if (typeof m.owner !== 'string' || !m.owner) say('owner missing');
  if (typeof m.app_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.app_version)) {
    say('app_version must be x.y.z');
  }
  if (typeof m.approved !== 'boolean') say('approved must be true or false');
  if (!Array.isArray(m.sources) || m.sources.length === 0)
    say('sources must list what it was written from');
  for (const source of Array.isArray(m.sources) ? m.sources : []) {
    if (!existsSync(path.join(REPO, source))) say(`source ${source} doesn't exist`);
  }

  const headed = article.sections.filter((s) => s.heading);
  if (headed.length < 2) say('needs two sections or more');
  for (const section of article.sections) {
    const name = section.heading ?? '(intro)';
    const words = wordCount(section.text);
    if (words === 0) say(`section ${name} is empty`);
    if (words > MAX_SECTION_WORDS)
      say(`section ${name} has ${words} words (max ${MAX_SECTION_WORDS})`);
  }
  const body = article.sections.map((s) => `${s.heading ?? ''}\n${s.text}`).join('\n');
  if (/`/.test(body)) say('no code: backticks are not allowed');
  if (/\]\(/.test(body)) say('no links: Chat adds the page card from route');
  if (/<[a-z][^>]*>/i.test(body)) say('no HTML');
  if (/\/dashboard\b/.test(body)) say('name pages by their names, not their addresses');
  const internal = INTERNAL.exec(body);
  if (internal) say(`internal detail "${internal[0]}"`);
  return out;
}

describe('parseHelpArticle', () => {
  it('reads the front matter and splits the sections, the intro first', () => {
    const article = parseHelpArticle(
      'help/prompts/add-prompts.md',
      [
        '---',
        'title: Add prompts',
        'route: /dashboard/prompts/tracked',
        'keywords: [prompts, add, "bulk import"]',
        'synonyms: []',
        'approved: false',
        '---',
        'Prompts are the questions GetCito asks AI engines.',
        '',
        '## One at a time',
        'Click Add prompt.',
        '## Many at once',
        'Use Bulk import.',
      ].join('\n'),
    );
    expect(article).toEqual({
      area: 'prompts',
      slug: 'add-prompts',
      meta: {
        title: 'Add prompts',
        route: '/dashboard/prompts/tracked',
        keywords: ['prompts', 'add', 'bulk import'],
        synonyms: [],
        approved: false,
      },
      sections: [
        { heading: null, text: 'Prompts are the questions GetCito asks AI engines.' },
        { heading: 'One at a time', text: 'Click Add prompt.' },
        { heading: 'Many at once', text: 'Use Bulk import.' },
      ],
    });
  });

  it('counts the words a reader reads', () => {
    // The dash is a mark, not a word.
    expect(wordCount('**Add** a prompt — in 2 clicks.')).toBe(6);
  });
});

describe('the Help articles', () => {
  const files = articleFiles();
  const articles = files.map((file) => ({
    file,
    article: parseHelpArticle(file, readFileSync(file, 'utf8')),
  }));

  it('cover the live app: forty articles or more', () => {
    expect(articles.length).toBeGreaterThanOrEqual(40);
  });

  it('keep the format Chat answers from, and nothing internal', () => {
    const problems = articles.flatMap(({ file, article }) => problemsOf(file, article));
    expect(problems).toEqual([]);
  });

  it('give each article its own slug and title', () => {
    const repeated = (values: string[]) => values.filter((value, i) => values.indexOf(value) !== i);
    expect(repeated(articles.map(({ article }) => article.slug))).toEqual([]);
    expect(repeated(articles.map(({ article }) => String(article.meta.title)))).toEqual([]);
  });
});
