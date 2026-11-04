import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatAgenticForUser, chatPathOfAgentPath, legacyAgentApiGone } from './legacyRoute';

/**
 * Agent Chat's old addresses (CHAT-01 item 2): /dashboard/agent and every
 * path under it map to the matching /dashboard/chat path, only where the new
 * Chat is on; the workspace is read only when CHAT_AGENTIC_ORGS narrows it.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chatPathOfAgentPath', () => {
  it('maps the page and every path under it', () => {
    expect(chatPathOfAgentPath('/dashboard/agent')).toBe('/dashboard/chat');
    expect(chatPathOfAgentPath('/dashboard/agent/')).toBe('/dashboard/chat');
    expect(chatPathOfAgentPath('/dashboard/agent/abc/def')).toBe('/dashboard/chat/abc/def');
  });
  it('leaves every other path alone', () => {
    expect(chatPathOfAgentPath('/dashboard/agents')).toBeNull();
    expect(chatPathOfAgentPath('/dashboard/chat')).toBeNull();
    expect(chatPathOfAgentPath('/dashboard/content/agent')).toBeNull();
  });
});

describe('chatAgenticForUser', () => {
  it('is off, reading nothing, while CHAT_AGENTIC is off', async () => {
    const org = vi.fn(async () => 'org-1');
    expect(await chatAgenticForUser(org)).toBe(false);
    expect(org).not.toHaveBeenCalled();
  });
  it('is on for everyone without reading the workspace when no list narrows it', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    const org = vi.fn(async () => 'org-1');
    expect(await chatAgenticForUser(org)).toBe(true);
    expect(org).not.toHaveBeenCalled();
  });
  it('asks for the workspace when a list narrows it', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-1');
    expect(await chatAgenticForUser(async () => 'org-1')).toBe(true);
    expect(await chatAgenticForUser(async () => 'org-2')).toBe(false);
    expect(await chatAgenticForUser(async () => null)).toBe(false);
  });
});

describe('legacyAgentApiGone', () => {
  it("lets Agent Chat's API answer while the new Chat is off", () => {
    expect(legacyAgentApiGone('org-1')).toBeNull();
  });
  it('answers 404 where the new Chat is on for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    const gone = legacyAgentApiGone('org-1');
    expect(gone?.status).toBe(404);
    expect(await gone?.json()).toEqual({ error: 'Not found' });
  });
  it('follows CHAT_AGENTIC_ORGS when a list narrows it', () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-1');
    expect(legacyAgentApiGone('org-1')?.status).toBe(404);
    expect(legacyAgentApiGone('org-2')).toBeNull();
    expect(legacyAgentApiGone(null)).toBeNull();
  });
});
