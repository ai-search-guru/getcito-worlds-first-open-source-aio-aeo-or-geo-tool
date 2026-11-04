// @vitest-environment node
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

const { default: OldAgentsRedirect } = await import('./page');

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const open = (path: string[] | undefined, query: Record<string, string | string[]> = {}) =>
  OldAgentsRedirect({
    params: Promise.resolve(path ? { path } : {}),
    searchParams: Promise.resolve(query),
  });

describe('the old Chat › Agents routes', () => {
  beforeEach(() => permanentRedirect.mockClear());

  it('sends /dashboard/chat/agents to Agent Center, for good', async () => {
    await open(undefined);
    expect(permanentRedirect).toHaveBeenCalledWith('/dashboard/agents');
  });

  it('sends an agent’s page, its Edit and New agent to the same page there', async () => {
    await open([ID]);
    expect(permanentRedirect).toHaveBeenLastCalledWith(`/dashboard/agents/${ID}`);
    await open([ID, 'edit']);
    expect(permanentRedirect).toHaveBeenLastCalledWith(`/dashboard/agents/${ID}/edit`);
    await open(['new']);
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents/new');
  });

  it('keeps the query, every value of it', async () => {
    await open(['new'], { skill: 'winback' });
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents/new?skill=winback');
    await open(undefined, { tab: 'paused', q: ['a b', 'c'] });
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents?tab=paused&q=a+b&q=c');
  });

  it('keeps an odd segment inside its own path segment', async () => {
    await open(['a/b?c']);
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents/a%2Fb%3Fc');
  });
});

describe('the old Chat › Agents folder', () => {
  // A page left beside the catch-all (agents/new, agents/[id]/edit…) wins
  // over it, so its old address opens the old page inside Chat instead of
  // redirecting. Merging main into the branch brought those two back once.
  it('holds only the redirect', () => {
    const folder = fileURLToPath(new URL('..', import.meta.url));
    const pages = readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter((file) => /(^|\/)(page|layout|route)\.tsx?$/.test(file))
      .sort();
    expect(pages).toEqual(['[[...path]]/page.tsx']);
  });
});
