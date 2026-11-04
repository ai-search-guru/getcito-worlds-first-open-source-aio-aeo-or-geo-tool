import type { ContentOpportunity } from '@/types';
import type { RunActor } from './access';
import { actingRefusalOf, apiAs, type ActingRefusal } from './api';

/**
 * Chat's writes through the API server for a run with no session behind it
 * (update_opportunity, dismiss_prompt_suggestion runFor): the same requests
 * as updateOpportunityStatus and dismissSuggestion, sent as the run's
 * person (api.ts). The API checks them as their session would be (the demo
 * brand, the plan, the brand, the route's role), as it checks the session's
 * own. A refusal of the acting way comes back as a value the engine acts
 * on. Server only, and never a server action: the person is the caller's word.
 */

/** updateOpportunityStatus for the run's person: the opportunity, or why the way refused. */
export async function updateOpportunityStatusFor(
  actor: RunActor,
  id: string,
  status: string,
  reason?: 'not_relevant' | 'wrong_angle',
): Promise<ContentOpportunity | ActingRefusal> {
  try {
    const res = await apiAs(actor, `/api/content/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status, ...(reason ? { reason } : {}) },
    });
    if (!res.ok) throw new Error(String(res.body.error || `Server error: ${res.status}`));
    return res.body as unknown as ContentOpportunity;
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    throw err;
  }
}

/** dismissSuggestion for the run's person. */
export async function dismissSuggestionFor(
  actor: RunActor,
  suggestionId: string,
): Promise<{ success: boolean } | ActingRefusal> {
  try {
    const res = await apiAs(
      actor,
      `/api/prompts/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(String(res.body.error || `Server error: ${res.status}`));
    return res.body as { success: boolean };
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    throw err;
  }
}
