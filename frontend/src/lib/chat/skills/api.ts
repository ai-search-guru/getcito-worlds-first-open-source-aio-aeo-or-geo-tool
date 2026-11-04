import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiFailure } from '@/lib/apiFailure';
import type { ChatActor } from '../engine';
import { runFailure } from '../runApi';
import { readSkillViewer, skillRefusal, type SkillRefusal, type SkillViewer } from './store';

/**
 * What the skills routes (/api/chat/skills…) share: the person as the
 * rules read them, a skill's id from the path, the body of an on/off, and
 * refusals as values the browser reads (#1777): `{ ok: false, failure,
 * code, error }`. Server only.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A workspace skill's id from the path, or null. */
export const skillIdOf = (value: string) => (UUID.test(value) ? value : null);

export type SkillParams = { params: Promise<{ id: string }> };

/** On or off (PATCH). */
export const enabledBody = z.strictObject({ enabled: z.boolean() });

/** The person as the skills' rules read them, or 404 when they aren't in the workspace now. */
export async function skillViewerFor(actor: ChatActor): Promise<SkillViewer | NextResponse> {
  const viewer = await readSkillViewer(actor);
  return viewer ?? runFailure(404, 'not_found', 'not_found', 'Not found');
}

/** A refusal as the browser reads it. */
export function skillRefusalResponse(refusal: SkillRefusal): NextResponse {
  const failure: ApiFailure =
    refusal.status === 404
      ? 'not_found'
      : refusal.status === 402
        ? 'subscription'
        : refusal.code === 'skill_limit'
          ? 'limit'
          : refusal.code === 'request_limit' || refusal.code === 'github_busy'
            ? 'busy'
            : 'failed';
  return NextResponse.json(
    {
      ok: false,
      failure,
      code: refusal.code,
      error: refusal.message,
      ...(refusal.detail ? { detail: refusal.detail } : {}),
    },
    { status: refusal.status },
  );
}

/** A body or id that doesn't parse: 400 or 404, as a value. */
export const invalidSkillResponse = () =>
  skillRefusalResponse(
    skillRefusal('invalid', { problems: 'the request is missing what to change' }).refusal,
  );
export const missingSkillResponse = () => skillRefusalResponse(skillRefusal('not_found').refusal);
