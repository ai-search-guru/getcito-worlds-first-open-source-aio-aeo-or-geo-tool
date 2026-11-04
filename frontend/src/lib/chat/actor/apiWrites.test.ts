// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat's writes through the API server for a run with no session
 * (update_opportunity, dismiss_prompt_suggestion runFor): the session's
 * requests, sent as the run's person with the acting secret, and the
 * server's refusals of the way given back as values.
 */

const SECRET = 'b'.repeat(64);
const PERSON = 'aaaaaaaa-0000-4000-8000-000000000001';
const OPPORTUNITY = '55555555-5555-4555-8555-555555555555';
const SUGGESTION = '77777777-7777-4777-8777-777777777777';
const actor = { userId: PERSON, organizationId: 'org-1' };

vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { dismissSuggestionFor, updateOpportunityStatusFor } = await import('./apiWrites');

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
};
const actingHeaders = { Authorization: `Bearer ${SECRET}`, 'X-Acting-User': PERSON };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('updateOpportunityStatusFor', () => {
  it('sends the status as the run’s person, and gives the opportunity back', async () => {
    answer(200, { id: OPPORTUNITY, status: 'dismissed' });
    expect(
      await updateOpportunityStatusFor(actor, OPPORTUNITY, 'dismissed', 'not_relevant'),
    ).toEqual({ id: OPPORTUNITY, status: 'dismissed' });
    expect(lastCall()).toMatchObject({
      url: `http://api.test/api/content/${OPPORTUNITY}/status`,
      method: 'PATCH',
      headers: actingHeaders,
      body: { status: 'dismissed', reason: 'not_relevant' },
    });
    answer(200, { id: OPPORTUNITY, status: 'reviewed' });
    await updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed');
    expect(lastCall().body).toEqual({ status: 'reviewed' });
  });

  it('throws the route’s refusal as the session’s action does, and says the way’s', async () => {
    answer(403, { error: 'Only admins and managers can change opportunities' });
    await expect(updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed')).rejects.toThrow(
      /admins and managers/,
    );
    answer(403, { code: 'chat_off', message: 'Chat is off for this workspace' });
    expect(await updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed')).toMatchObject({
      ok: false,
      reason: 'chat_off',
      message: expect.stringMatching(/Chat is off/),
    });
  });
});

describe('dismissSuggestionFor', () => {
  it('dismisses as the run’s person, and says a 401 in their words', async () => {
    answer(200, { success: true });
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toEqual({ success: true });
    expect(lastCall()).toMatchObject({
      url: `http://api.test/api/prompts/suggestions/${SUGGESTION}/dismiss`,
      method: 'POST',
      headers: actingHeaders,
      body: undefined,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(401, { message: 'Unauthorized API Request' });
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toMatchObject({
      ok: false,
      reason: 'acting_refused',
    });
    vi.mocked(console.warn).mockRestore();
  });

  it('sends nothing while the way is closed', async () => {
    vi.stubEnv('CHAT_ACTING_SECRET', '');
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toMatchObject({
      ok: false,
      reason: 'acting_refused',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
