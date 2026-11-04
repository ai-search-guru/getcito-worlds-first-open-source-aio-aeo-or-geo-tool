// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHelpArticle, type HelpArticle } from './articles';
import {
  HELP_MAX_SECTIONS,
  HELP_MIN_SCORE,
  buildHelpIndex,
  helpWords,
  searchHelp,
  type HelpIndex,
} from './search';

/**
 * Help retrieval (W1-30, CHAT-19 §5 step 3): the approved articles only,
 * kept in approved-articles.json in step with /help, and a question's
 * keywords to the few sections that answer it.
 */

const REPO = path.resolve(__dirname, '../../../..');
const HELP = path.join(REPO, 'help');

function articleFiles(dir = HELP): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return articleFiles(full);
    return entry.endsWith('.md') && full !== path.join(HELP, 'README.md') ? [full] : [];
  });
}

const article = (
  slug: string,
  meta: Partial<HelpArticle['meta']>,
  sections: HelpArticle['sections'],
): HelpArticle => ({
  area: 'prompts',
  slug,
  meta: {
    title: slug,
    route: '/dashboard/prompts/tracked',
    keywords: [],
    synonyms: [],
    plan: 'all',
    updated: '2026-10-29',
    approved: true,
    ...meta,
  },
  sections,
});

const INDEX: HelpIndex = buildHelpIndex([
  article(
    'add-prompts',
    {
      title: 'Add prompts to track',
      keywords: ['add prompt', 'bulk import', 'track prompts'],
      synonyms: ['add queries'],
    },
    [
      { heading: null, text: 'A prompt is a question GetCito asks the AI engines.' },
      { heading: 'Add one prompt', text: 'On Tracked Prompts, click Add prompt.' },
      { heading: 'Add many at once', text: 'Open the Bulk import tab and upload a file.' },
      { heading: 'What counts on your plan', text: 'Every prompt counts on the limit.' },
    ],
  ),
  article(
    'topics',
    { title: 'Topics', route: '/dashboard/prompts/topics', keywords: ['topics', 'group prompts'] },
    [
      { heading: null, text: 'Topics group prompts.' },
      { heading: 'Add a topic', text: 'Click New topic.' },
    ],
  ),
  article('draft', { title: 'Not approved yet', keywords: ['add prompt'], approved: false }, [
    { heading: null, text: 'Never read.' },
  ]),
]);

describe('approved-articles.json', () => {
  it('holds every approved article in /help, and only those (refresh: yarn test -u src/lib/help)', async () => {
    const articles = articleFiles().map((file) =>
      parseHelpArticle(path.relative(REPO, file), readFileSync(file, 'utf8')),
    );
    const index = buildHelpIndex(articles);
    expect(index.articles.every((a) => /^[a-z-]+\/[a-z0-9-]+$/.test(a.id))).toBe(true);
    await expect(`${JSON.stringify(index, null, 2)}\n`).toMatchFileSnapshot(
      './approved-articles.json',
    );
  });
});

describe('buildHelpIndex', () => {
  it('keeps approved articles only, by id, with their sections', () => {
    expect(INDEX.articles.map((a) => a.id)).toEqual(['prompts/add-prompts', 'prompts/topics']);
    expect(INDEX.articles[0]).toMatchObject({
      title: 'Add prompts to track',
      route: '/dashboard/prompts/tracked',
      sections: expect.arrayContaining([{ heading: 'Add one prompt', text: expect.any(String) }]),
    });
  });
});

describe('searchHelp', () => {
  it('finds the sections a how-to question asks about, best first, three at most', () => {
    const found = searchHelp('How do I add a prompt?', INDEX);
    expect(found.matches.length).toBeLessThanOrEqual(HELP_MAX_SECTIONS);
    expect(found.matches[0]).toMatchObject({
      article: { id: 'prompts/add-prompts' },
      section: { heading: 'Add one prompt' },
    });
    expect(found.matches.every((m) => m.score >= HELP_MIN_SCORE)).toBe(true);
    expect(found.best).toEqual({ id: 'prompts/add-prompts', score: expect.any(Number) });
  });

  it('matches plurals and synonyms, and a section by its heading', () => {
    expect(searchHelp('Where can I add queries?', INDEX).matches[0].article.id).toBe(
      'prompts/add-prompts',
    );
    expect(searchHelp('How do I bulk import prompts?', INDEX).matches[0].section.heading).toBe(
      'Add many at once',
    );
    expect(searchHelp('How do I group prompts into topics?', INDEX).matches[0].article.id).toBe(
      'prompts/topics',
    );
  });

  it('says nothing matched, with the closest article, rather than guess', () => {
    const weak = searchHelp('How do I export a track?', INDEX);
    expect(weak.matches).toEqual([]);
    expect(weak.best).toEqual({ id: 'prompts/add-prompts', score: 1 });
    expect(searchHelp('How do I connect Slack?', INDEX)).toEqual({ matches: [], best: null });
    expect(searchHelp('how to', INDEX)).toEqual({ matches: [], best: null });
  });

  it('never reads an article that is not approved', () => {
    const only = buildHelpIndex([
      article('draft', { keywords: ['add prompt'], approved: false }, [
        { heading: null, text: 'x' },
      ]),
    ]);
    expect(searchHelp('How do I add a prompt?', only).matches).toEqual([]);
  });

  it('reads words as matching sees them', () => {
    expect(helpWords('How do I add Prompts to GetCito?')).toEqual(['add', 'prompt']);
  });
});
