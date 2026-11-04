'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberAuth } from '@/lib/memberEmails';
import type { TeamRole } from '@/components/context/RoleProvider';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseTeamRole } from '@/lib/chat/precedence';
import { activitySummary } from '@/lib/chat/activity';
import { undoChange } from '@/lib/chat/undo';
import { CHAT_TOOLS, chatToolByKey } from '@/lib/chat/registry/tools';
import type { ToolArea } from '@/lib/chat/registry/defineTool';
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_EXPORT_MAX,
  activityCsv,
  type ActivityFilters,
  type ActivityRow,
} from '@/lib/chat/activityView';

/**
 * The Activity log page (CHAT-20 §10a; mockup #g-activity), behind
 * CHAT_AGENTIC: every change Chat made, every Undo and every denial
 * (chat_activity_log, 00402). The person sees their own rows; an Admin sees
 * the workspace's and exports them as CSV. A row goes by its label key and
 * its summary in words: a tool's name never reaches the page, nor does
 * what Undo restores (undo_json stays on the server).
 *
 * Every action answers { ok } with a typed failure and never throws (#1777).
 */

export type ActivityFailure = 'chat_off' | 'forbidden' | 'failed';

interface Viewer {
  userId: string;
  organizationId: string;
  role: TeamRole;
}

async function viewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const role = parseTeamRole(profile?.role);
  const organizationId = profile?.organization_id;
  if (!organizationId || !role || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId, role };
}

const COLUMNS =
  'id, created_at, user_id, surface, kind, tool_key, class, mode, approval_kind, auto_via, target_type, target_id, denial_code, summary_key, summary_params, status, undo_until, undone_at';

/** How long a published page's row offers Take down (§6.4); the Library does after. */
const TAKE_DOWN_MS = 30 * 24 * 60 * 60 * 1000;

type LivePage = NonNullable<ActivityRow['takeDown']>;

/** A row that published a page in the last 30 days: its page may be taken down from it. */
const publishedLately = (row: Awaited<ReturnType<typeof readRows>>[number], now: number) =>
  row.kind === 'change' &&
  row.status === 'done' &&
  row.tool_key === 'publishToCms' &&
  row.target_type === 'content_draft' &&
  !!row.target_id &&
  now - Date.parse(row.created_at) < TAKE_DOWN_MS;

/**
 * The pages the page's publish rows put live, still live through GetCito,
 * by draft: what Take down needs (PR 10). Only for an Admin or a Manager,
 * and only rows of the last 30 days; a read that fails offers none.
 */
async function livePagesOf(
  rows: Awaited<ReturnType<typeof readRows>>,
  who: Viewer,
  now: number,
): Promise<Map<string, LivePage>> {
  const live = new Map<string, LivePage>();
  if (who.role !== 'admin' && who.role !== 'manager') return live;
  const ids = [
    ...new Set(
      rows.filter((row) => publishedLately(row, now)).map((row) => row.target_id as string),
    ),
  ];
  if (ids.length === 0) return live;
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('draft_id, target, published_url, content_drafts(title)')
    .eq('organization_id', who.organizationId)
    .eq('status', 'published')
    .in('draft_id', ids);
  if (error) {
    console.error('Failed to read the pages Chat published:', error.message);
    return live;
  }
  for (const send of data ?? []) {
    const target = send.target;
    if (!send.draft_id || (target !== 'webflow' && target !== 'wordpress' && target !== 'wix')) {
      continue;
    }
    const draft = (
      Array.isArray(send.content_drafts) ? send.content_drafts[0] : send.content_drafts
    ) as { title?: string | null } | null;
    live.set(send.draft_id, {
      draftId: send.draft_id,
      title: draft?.title?.trim() || 'Untitled',
      url: send.published_url,
      target,
    });
  }
  return live;
}

/** The label keys of an area's tools, for the Area filter. */
const keysOf = (area: ToolArea) =>
  CHAT_TOOLS.filter((tool) => tool.area === area).map((tool) => tool.labelKey);

/** The rows a viewer may read, with the filters, newest first, from before `before`. */
async function readRows(who: Viewer, filters: ActivityFilters, limit: number) {
  let query = supabaseAdmin
    .from('chat_activity_log')
    .select(COLUMNS)
    .eq('organization_id', who.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  // The person's own rows; an Admin's: everyone's, or one person's.
  if (who.role !== 'admin') query = query.eq('user_id', who.userId);
  else if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.area) query = query.in('tool_key', keysOf(filters.area));
  if (filters.kind === 'denied') query = query.eq('kind', 'access.denied');
  else if (filters.kind === 'write' || filters.kind === 'execute') {
    query = query.eq('class', filters.kind).neq('kind', 'access.denied');
  }
  if (filters.autoOnly) query = query.eq('approval_kind', 'auto');
  if (filters.before) query = query.lt('created_at', filters.before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** People's names, by id: their profile's, else their e-mail's part before the @. */
async function namesOf(organizationId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const [{ data, error }, auth] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('organization_id', organizationId)
      .in('id', ids),
    readMemberAuth(ids),
  ]);
  if (error) throw new Error(error.message);
  for (const id of ids) {
    const profile = (data ?? []).find((row) => row.id === id);
    names.set(id, profile?.full_name?.trim() || auth.get(id)?.email?.split('@')[0] || '');
  }
  return names;
}

function toRow(
  row: Awaited<ReturnType<typeof readRows>>[number],
  who: Viewer,
  names: Map<string, string>,
  now: number,
  live: Map<string, LivePage>,
): ActivityRow {
  const tool = row.tool_key ? chatToolByKey(row.tool_key) : undefined;
  const mine = row.user_id === who.userId;
  return {
    id: row.id,
    at: row.created_at,
    userId: row.user_id,
    person: row.user_id ? (names.get(row.user_id) ?? '') : '',
    isYou: mine,
    surface: row.surface,
    kind: row.kind as ActivityRow['kind'],
    toolKey: row.tool_key,
    area: tool?.area ?? null,
    class: row.class as ActivityRow['class'],
    mode: row.mode,
    approvalKind: row.approval_kind,
    autoVia: row.auto_via,
    denialCode: row.denial_code,
    summaryKey: row.summary_key,
    summaryParams: (row.summary_params ?? {}) as Record<string, string>,
    status: row.status as ActivityRow['status'],
    // Undo is the person's, or an Admin's, while its window is open (§10b).
    canUndo:
      row.kind === 'change' &&
      row.status === 'done' &&
      !!row.undo_until &&
      Date.parse(row.undo_until) > now &&
      (mine || who.role === 'admin'),
    undoneAt: row.undone_at,
    takeDown: publishedLately(row, now) ? (live.get(row.target_id as string) ?? null) : null,
  };
}

/** A page of the log, newest first; `before` reads the next one. */
export async function listActivity(filters: ActivityFilters = {}): Promise<
  | {
      ok: true;
      isAdmin: boolean;
      rows: ActivityRow[];
      hasMore: boolean;
      /** For an Admin's person filter: the workspace's members. */
      people: { id: string; name: string }[];
    }
  | { ok: false; failure: ActivityFailure }
> {
  try {
    const who = await viewer();
    if (!who) return { ok: false, failure: 'chat_off' };
    const isAdmin = who.role === 'admin';
    const read = await readRows(who, filters, ACTIVITY_PAGE_SIZE + 1);
    const page = read.slice(0, ACTIVITY_PAGE_SIZE);

    let people: { id: string; name: string }[] = [];
    let ids = [...new Set(page.map((row) => row.user_id).filter((id): id is string => !!id))];
    if (isAdmin) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('organization_id', who.organizationId);
      if (error) throw new Error(error.message);
      ids = [...new Set([...ids, ...(data ?? []).map((row) => row.id)])];
    }
    const names = await namesOf(who.organizationId, ids);
    if (isAdmin) {
      people = [...names]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const now = Date.now();
    const live = await livePagesOf(page, who, now);
    return {
      ok: true,
      isAdmin,
      rows: page.map((row) => toRow(row, who, names, now, live)),
      hasMore: read.length > ACTIVITY_PAGE_SIZE,
      people,
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** Undoes a change from the log: the person's own, or any for an Admin. */
export async function undoActivity(
  activityId: string,
): Promise<
  | { ok: true; code: string; message: string; href: string | null }
  | { ok: false; failure: ActivityFailure }
> {
  try {
    const who = await viewer();
    if (!who) return { ok: false, failure: 'chat_off' };
    const result = await undoChange({
      activityId,
      userId: who.userId,
      organizationId: who.organizationId,
      surface: 'chat',
    });
    return {
      ok: true,
      code: result.code,
      message: result.message,
      href: result.code === 'conflict' ? result.href : null,
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}

/** The log as CSV, for an Admin: the filtered rows, up to ACTIVITY_EXPORT_MAX. */
export async function exportActivityCsv(
  filters: ActivityFilters = {},
): Promise<{ ok: true; csv: string } | { ok: false; failure: ActivityFailure }> {
  try {
    const who = await viewer();
    if (!who) return { ok: false, failure: 'chat_off' };
    if (who.role !== 'admin') return { ok: false, failure: 'forbidden' };
    const rows = await readRows(who, { ...filters, before: undefined }, ACTIVITY_EXPORT_MAX);
    const ids = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => !!id))];
    const names = await namesOf(who.organizationId, ids);
    const now = Date.now();
    return {
      ok: true,
      csv: activityCsv(
        rows.map((row) => toRow(row, who, names, now, new Map())),
        (key, params) => activitySummary(key, params),
      ),
    };
  } catch {
    return { ok: false, failure: 'failed' };
  }
}
