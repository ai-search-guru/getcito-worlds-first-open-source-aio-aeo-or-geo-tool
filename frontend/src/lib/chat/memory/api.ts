import { NextResponse } from 'next/server';
import type { ApiFailure } from '@/lib/apiFailure';
import type { ChatActor } from '../engine';
import { runFailure } from '../runApi';
import { memoryRefusal, readMemoryViewer, type MemoryRefusal, type MemoryViewer } from './store';

/**
 * What the memory routes (/api/chat/memory…) share: the person as the
 * rules read them, a line's id from the path, and refusals as values the
 * browser reads (#1777): `{ ok: false, failure, code, error }`. Server only.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A line's or a brand's id, or null. */
export const memoryIdOf = (value: string | null | undefined) =>
  value && UUID.test(value) ? value : null;

export type MemoryParams = { params: Promise<{ id: string }> };

/** The person as the memory's rules read them, or 404 when they aren't in the workspace now. */
export async function memoryViewerFor(actor: ChatActor): Promise<MemoryViewer | NextResponse> {
  const viewer = await readMemoryViewer(actor);
  return viewer ?? runFailure(404, 'not_found', 'not_found', 'Not found');
}

/** A refusal as the browser reads it. */
export function memoryRefusalResponse(refusal: MemoryRefusal): NextResponse {
  const failure: ApiFailure =
    refusal.status === 404
      ? 'not_found'
      : refusal.status === 402
        ? 'subscription'
        : refusal.code === 'full'
          ? 'limit'
          : refusal.code === 'request_limit'
            ? 'busy'
            : 'failed';
  return NextResponse.json(
    { ok: false, failure, code: refusal.code, error: refusal.message },
    { status: refusal.status },
  );
}

/** A body or id that doesn't parse: 400 or 404, as a value. */
export const invalidMemoryResponse = () => memoryRefusalResponse(memoryRefusal('invalid').refusal);
export const missingMemoryResponse = () =>
  memoryRefusalResponse(memoryRefusal('not_found').refusal);
