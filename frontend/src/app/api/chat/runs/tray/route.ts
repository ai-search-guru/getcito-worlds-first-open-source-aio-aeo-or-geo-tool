import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { CHAT_RUN_STEP_SELECT, type ChatRunStepMemberRow } from '@/lib/chat/steps';
import type { ApiFailure } from '@/lib/apiFailure';
import {
  chatTrayRun,
  contentTrayRun,
  trayResponse,
  type ChatRunRow,
  type TrayFailure,
  type TrayResult,
  type TrayRun,
} from '@/lib/chat/runsTray';

/** The person's chats the tray looks through, the most recent first. */
const CHATS_LIMIT = 50;
/** Runs read per source, before the tray keeps its newest. */
const RUNS_LIMIT = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A failure as a value the browser reads (TrayFailure), never an HTML error page. */
const fail = (status: number, failure: ApiFailure, error: string) =>
  NextResponse.json<TrayFailure>({ ok: false, failure, error }, { status });

/**
 * GET /api/chat/runs/tray?brand={brandId}
 *
 * The runs tray (Chat agentic plan §2, CHAT-23 G4): the person's own Chat
 * runs, and the Content Agent's runs on the brand's drafts, newest first —
 * the ones under way and those that ended in the last day. Read as the
 * person (their row policies): a chat is its author's only (CHAT-20 §16c),
 * and is asked for by author besides; a draft's runs are its workspace's.
 * Steps by their member columns (CHAT_RUN_STEP_SELECT), never the tool or its
 * debug record. Not there (404) while the new Chat is off for the workspace
 * (CHAT_AGENTIC).
 *
 * Answers `{ ok: true, runs, running, needsYou }`, or `{ ok: false, failure,
 * error }` with its status — also for an error nothing expected — so the
 * tray can say what went wrong in plain words (TrayResult).
 */
export async function GET(req: Request) {
  try {
    return await tray(req);
  } catch (error) {
    console.error('Failed to build the runs tray:', error);
    return fail(500, 'failed', 'Failed to read runs');
  }
}

async function tray(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, 'session', 'Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  const organizationId = profile?.organization_id ?? null;
  if (!organizationId || !chatAgenticEnabled(organizationId)) {
    return fail(404, 'not_found', 'Not found');
  }

  const brandId = new URL(req.url).searchParams.get('brand');
  if (brandId !== null && !UUID.test(brandId)) {
    return fail(400, 'failed', 'Invalid brand');
  }

  const now = Date.now();
  const [chat, content] = await Promise.all([
    chatRuns(supabase, user.id, organizationId, now),
    brandId ? contentRuns(supabase, brandId, now) : Promise.resolve([]),
  ]);
  if (chat === null || content === null) return fail(500, 'failed', 'Failed to read runs');
  return NextResponse.json<TrayResult>({ ok: true, ...trayResponse([...chat, ...content]) });
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The person's own Chat runs in this workspace, with their steps; null when they can't be read. */
async function chatRuns(
  supabase: Supabase,
  userId: string,
  organizationId: string,
  now: number,
): Promise<TrayRun[] | null> {
  const { data: chats, error: chatsError } = await supabase
    .from('chat_conversations')
    .select('id, title')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .order('last_message_at', { ascending: false })
    .limit(CHATS_LIMIT);
  if (chatsError) {
    console.error('Failed to read chats for the runs tray:', chatsError);
    return null;
  }
  if (!chats?.length) return [];
  const titles = new Map(chats.map((c) => [c.id, c.title]));

  const { data: runs, error: runsError } = await supabase
    .from('chat_runs')
    .select('id, conversation_id, status, created_at, finished_at')
    .in('conversation_id', [...titles.keys()])
    .order('created_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (runsError) {
    console.error('Failed to read chat runs for the runs tray:', runsError);
    return null;
  }
  if (!runs?.length) return [];

  const { data: steps, error: stepsError } = await supabase
    .from('chat_run_steps')
    .select(CHAT_RUN_STEP_SELECT)
    .in(
      'run_id',
      runs.map((r) => r.id),
    )
    .order('position', { ascending: true });
  if (stepsError) {
    console.error('Failed to read chat run steps for the runs tray:', stepsError);
    return null;
  }
  const byRun = new Map<string, ChatRunStepMemberRow[]>();
  for (const step of (steps ?? []) as unknown as ChatRunStepMemberRow[]) {
    byRun.set(step.run_id, [...(byRun.get(step.run_id) ?? []), step]);
  }

  return runs.flatMap((run) => {
    // Only runs of the chats read above: the person's own.
    if (!titles.has(run.conversation_id)) return [];
    const row = chatTrayRun(
      run as ChatRunRow,
      titles.get(run.conversation_id) ?? null,
      byRun.get(run.id) ?? [],
      now,
    );
    return row ? [row] : [];
  });
}

/** The Content Agent's runs on the brand's drafts; null when they can't be read. */
async function contentRuns(
  supabase: Supabase,
  brandId: string,
  now: number,
): Promise<TrayRun[] | null> {
  const { data, error } = await supabase
    .from('content_agent_runs')
    .select(
      'id, kind, steps, step, started_at, finished_at, stopped_at, outcome, draft_id, content_drafts!content_agent_runs_draft_id_fkey!inner(title, brand_id)',
    )
    .eq('content_drafts.brand_id', brandId)
    .order('started_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) {
    console.error('Failed to read Content Agent runs for the runs tray:', error);
    return null;
  }
  return (data ?? []).flatMap((row) => {
    const draft = row.content_drafts as { title: string | null; brand_id: string } | null;
    // Only the brand's drafts: the filter above, held here too.
    if (!draft || draft.brand_id !== brandId) return [];
    const run = contentTrayRun(
      row as unknown as Record<string, unknown>,
      { id: row.draft_id, title: draft.title },
      now,
    );
    return run ? [run] : [];
  });
}
