import type { Database } from '@/types/supabase';
import {
  CHAT_STEP_KINDS,
  CHAT_STEP_STATUSES,
  maskIds,
  type ChatStep,
  type ChatStepKind,
  type ChatStepScope,
  type ChatStepStatus,
} from './events';

type StepRow = Database['public']['Tables']['chat_run_steps']['Row'];

/**
 * chat_run_steps' columns a member may read: every one but `tool`,
 * `debug_json` and the step's measure (00410), which stay with the server
 * and staff (00400's grants; CHAT-03 item 22). As a member, select these by
 * name: `select('*')` asks for the others too and is refused (42501).
 */
export const CHAT_RUN_STEP_MEMBER_COLUMNS = [
  'id',
  'run_id',
  'position',
  'kind',
  'status',
  'label',
  'detail',
  'scope_json',
  'row_count',
  'data_as_of',
  'started_at',
  'finished_at',
] as const satisfies readonly (keyof StepRow)[];

/** The member columns as a PostgREST select list. */
export const CHAT_RUN_STEP_SELECT = CHAT_RUN_STEP_MEMBER_COLUMNS.join(', ');

/** A step row as a member reads it; a server's full row is one too. */
export type ChatRunStepMemberRow = Pick<StepRow, (typeof CHAT_RUN_STEP_MEMBER_COLUMNS)[number]>;

const isKind = (kind: string): kind is ChatStepKind =>
  (CHAT_STEP_KINDS as readonly string[]).includes(kind);
const isStatus = (status: string): status is ChatStepStatus =>
  (CHAT_STEP_STATUSES as readonly string[]).includes(status);

const text = (value: unknown) =>
  typeof value === 'string' && value !== '' ? maskIds(value) : undefined;

/** scope_json's names (subject, dateRange, platforms, brand, unit), and nothing else it may hold. */
function scopeOf(json: unknown): ChatStepScope | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const raw = json as Record<string, unknown>;
  const scope: ChatStepScope = {};
  const subject = text(raw.subject);
  const dateRange = text(raw.dateRange);
  const brand = text(raw.brand);
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map(text).filter((name): name is string => !!name)
    : [];
  if (subject) scope.subject = subject;
  if (dateRange) scope.dateRange = dateRange;
  if (platforms.length > 0) scope.platforms = platforms;
  if (brand) scope.brand = brand;
  if (raw.unit === 'items') scope.unit = 'items';
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/**
 * A stored step as the browser gets it — for the conversation API and a
 * reload (CHAT-03 items 1 and 21) — the one way steps leave the server.
 * Built field by field, never spread from the row, so a row read with the
 * service role gives up its `tool` and `debug_json` here too; a uuid in its
 * words shows as "…". Null for a kind or status this build doesn't know (a
 * newer server's), which the browser skips, as it skips an unknown event.
 */
export function toClientStep(row: ChatRunStepMemberRow): ChatStep | null {
  if (!isKind(row.kind) || !isStatus(row.status)) return null;
  const step: ChatStep = {
    n: row.position,
    kind: row.kind,
    status: row.status,
    label: maskIds(row.label),
  };
  const detail = text(row.detail);
  const scope = scopeOf(row.scope_json);
  if (detail) step.detail = detail;
  if (scope) step.scope = scope;
  if (row.row_count !== null) step.rowCount = row.row_count;
  const dataAsOf = row.data_as_of ? Date.parse(row.data_as_of) : NaN;
  if (!Number.isNaN(dataAsOf)) step.dataAsOf = new Date(dataAsOf).toISOString();
  return step;
}
