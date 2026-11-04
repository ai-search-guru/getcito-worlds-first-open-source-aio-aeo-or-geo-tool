import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
}));

import TopicsPage from './page';
import TopicRedirect from './[id]/page';

describe('the old Topics routes', () => {
  beforeEach(() => redirect.mockClear());

  it('sends /dashboard/topics to the Prompts area’s Topics tab', () => {
    TopicsPage();
    expect(redirect).toHaveBeenCalledWith('/dashboard/prompts/topics');
  });

  it('sends a topic’s old page to its page under Prompts', async () => {
    await TopicRedirect({ params: Promise.resolve({ id: 'topic-1' }) });
    expect(redirect).toHaveBeenCalledWith('/dashboard/prompts/topics/topic-1');
  });

  it('keeps an odd id inside its own path segment', async () => {
    await TopicRedirect({ params: Promise.resolve({ id: 'a/b?c' }) });
    expect(redirect).toHaveBeenCalledWith('/dashboard/prompts/topics/a%2Fb%3Fc');
  });
});
