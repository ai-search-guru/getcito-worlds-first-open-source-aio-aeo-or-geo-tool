// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

/**
 * Chat's answers from Help (W1-30, CHAT-19 §3–§6): which questions Help
 * answers, the answer cache's key (question, language, app version), the
 * anonymous gap log, the model's fixed instructions and the source line.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
const openPage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/navigation', () => ({ openPageFor: openPage }));
vi.mock('@/lib/help/search', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/help/search')>();
  const index = real.buildHelpIndex([
    {
      area: 'prompts',
      slug: 'topics',
      meta: {
        title: 'Topics',
        route: '/dashboard/prompts/topics',
        keywords: ['topics', 'group prompts', 'add topic'],
        synonyms: [],
        plan: 'all',
        updated: '2026-10-29',
        approved: true,
      },
      sections: [{ heading: 'Add a topic', text: 'Click New topic.' }],
    },
  ]);
  return { ...real, HELP_INDEX: index };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const help = await import('./helpAnswer');
const { HELP_INDEX, searchHelp } = await import('@/lib/help/search');

const AUTH = {
  userId: 'person-1',
  email: null,
  organizationId: 'org-1',
  role: 'admin' as const,
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
};

beforeEach(() => {
  db.tables = { help_answer_cache: [], help_gaps: [] };
  db.failures = {};
  openPage.mockReset();
});

describe('isHelpQuestion', () => {
  it('takes how-to, where-is and what-it-means questions, in English and Turkish', () => {
    for (const question of [
      'How do I add a topic?',
      'how to export prompts',
      'Where is the Billing page?',
      'Where can I find my API key?',
      'What does share of voice mean?',
      'What is the Signals tab?',
      'Topic nasıl eklenir?',
      'Faturalar nerede?',
      'Share of voice ne demek?',
    ]) {
      expect(help.isHelpQuestion(question), question).toBe(true);
    }
  });

  it("leaves questions about the person's own results, and anything else, to the data path", () => {
    for (const question of [
      'Why did my citations drop on Perplexity?',
      'How is my visibility this month?',
      'How do I improve my visibility?',
      'Compare us with our top competitor',
      'Görünürlüğüm neden düştü?',
      'What is my visibility score?',
      "What's our mention rate metric?",
      'Where do we rank on Perplexity?',
      'Where do I stand against my competitors?',
      'Write a pricing FAQ',
      '',
      null,
      `How do I ${'add '.repeat(200)}?`,
    ]) {
      expect(help.isHelpQuestion(question), String(question).slice(0, 40)).toBe(false);
    }
  });
});

describe('the answer cache key', () => {
  it('reads the same question the same way, by language and app version', () => {
    const key = help.helpCacheKey('How do I add a topic?')!;
    expect(key).toEqual({
      question: 'how do i add a topic',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      lang: 'en',
      appVersion: help.HELP_APP_VERSION,
    });
    expect(help.helpCacheKey('  how do i ADD a topic ')!.hash).toBe(key.hash);
    expect(help.helpCacheKey('Topic nasıl eklenir?')!.lang).toBe('tr');
    expect(help.HELP_APP_VERSION).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
  });

  it('has none for a question naming a site, an email, an id or a long number', () => {
    for (const question of [
      'How do I add acme-corp.com as a competitor?',
      'How do I invite jane@acme.io?',
      'Where is https://example.org/page in Citations?',
      'How do I open 3f8e2b6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b?',
      'How do I find order 1234567?',
    ]) {
      expect(help.helpCacheKey(question), question).toBeNull();
    }
  });

  it('gives a kept answer back once, counting its hit, and none for an article no longer approved', async () => {
    const key = help.helpCacheKey('How do I add a topic?')!;
    await help.saveHelpAnswer(
      key,
      'Click **New topic**.',
      ['prompts/topics'],
      'anthropic/claude-haiku-5.5',
    );
    expect(await help.readHelpAnswer(key)).toEqual({
      answer: 'Click **New topic**.',
      articles: ['prompts/topics'],
    });
    expect(db.tables.help_answer_cache[0].hits).toBe(1);
    expect(await help.readHelpAnswer({ ...key, lang: 'tr' })).toBeNull();
    expect(await help.readHelpAnswer({ ...key, appVersion: '0.0.1+00000000' })).toBeNull();

    db.tables.help_answer_cache[0].articles = ['prompts/gone'];
    expect(await help.readHelpAnswer(key)).toBeNull();
  });

  it('never throws: a failing table is no kept answer', async () => {
    db.failures.help_answer_cache = { message: 'relation does not exist' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = help.helpCacheKey('How do I add a topic?')!;
    await expect(help.saveHelpAnswer(key, 'x', [], 'm')).resolves.toBeUndefined();
    await expect(help.readHelpAnswer(key)).resolves.toBeNull();
    errors.mockRestore();
  });
});

describe('the gap log', () => {
  it('keeps the question scrubbed, its language and the closest article: no workspace, no person', async () => {
    await help.logHelpGap('How do I connect Slack for jane@acme.io?', {
      id: 'prompts/topics',
      score: 1,
    });
    expect(db.tables.help_gaps).toEqual([
      {
        id: expect.any(String),
        question: 'How do I connect Slack for [email]?',
        lang: 'en',
        route: null,
        best_article: 'prompts/topics',
        best_score: 1,
        app_version: help.HELP_APP_VERSION,
      },
    ]);
  });
});

describe('the model and the source', () => {
  it('gives the model the sections, as data, and the question', () => {
    const { matches } = searchHelp('How do I add a topic?', HELP_INDEX);
    const message = help.helpMessage('How do I add a topic?', matches);
    expect(message).toBe(
      "<help_sections>\n## Topics › Add a topic\nClick New topic.\n</help_sections>\n\nThe person's question: How do I add a topic?",
    );
    expect(help.HELP_SYSTEM).toMatch(/Answer only from the Help sections/);
    expect(help.HELP_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('ends with "From Help", and a link to the page where the plan opens it', async () => {
    const [article] = HELP_INDEX.articles;
    openPage.mockResolvedValueOnce({
      found: true,
      title: 'Topics',
      section: 'Prompts',
      locked: false,
      href: '/dashboard/prompts/topics',
      filters: [],
      navigation_only: true,
    });
    expect(await help.helpSources(AUTH, [article])).toBe(
      'From Help: Topics · [Open Topics](/dashboard/prompts/topics)',
    );
    expect(openPage).toHaveBeenCalledWith(AUTH, { route: '/dashboard/prompts/topics' });

    openPage.mockResolvedValueOnce({ found: true, title: 'Topics', section: null, locked: true });
    expect(await help.helpSources(AUTH, [article])).toBe('From Help: Topics');
    openPage.mockRejectedValueOnce(new Error('down'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await help.helpSources(AUTH, [article])).toBe('From Help: Topics');
    errors.mockRestore();
  });
});
