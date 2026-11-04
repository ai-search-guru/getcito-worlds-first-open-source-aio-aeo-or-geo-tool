import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { toCsv } from '@/lib/csv';
import type { ToolArea, ToolClass } from './registry/defineTool';

/**
 * The Activity log page's rows (CHAT-20 §10a; lib/actions/chatActivity.ts
 * reads them), and what the page and its CSV say about each.
 */

/** Rows a page of the log shows before "Load more". */
export const ACTIVITY_PAGE_SIZE = 50;
/** Rows an Admin's CSV holds at most. */
export const ACTIVITY_EXPORT_MAX = 5000;

export interface ActivityFilters {
  /** An Admin's: one person's rows. */
  userId?: string | null;
  area?: ToolArea | null;
  /** Changes of a class, or the denials. */
  kind?: 'write' | 'execute' | 'denied' | null;
  /** Only what ran without a card. */
  autoOnly?: boolean;
  /** Rows older than this (ISO): the next page. */
  before?: string;
}

export interface ActivityRow {
  id: string;
  at: string;
  userId: string | null;
  person: string;
  isYou: boolean;
  surface: string;
  kind: 'change' | 'undo' | 'access.denied';
  /** The row's label key (chatTools.{key}); never a tool's name. */
  toolKey: string | null;
  area: ToolArea | null;
  class: ToolClass;
  mode: string | null;
  approvalKind: string | null;
  autoVia: string | null;
  denialCode: string | null;
  summaryKey: string | null;
  summaryParams: Record<string, string>;
  status: 'done' | 'undone' | 'undo_conflict';
  canUndo: boolean;
  undoneAt: string | null;
  /**
   * A page this row published, still live, an Admin or a Manager may take
   * down from here for 30 days (AUTONOMOUS-GO-LIVE §6.4, PR 10); else null.
   */
  takeDown: {
    draftId: string;
    title: string;
    url: string | null;
    target: 'webflow' | 'wordpress' | 'wix';
  } | null;
}

/** How a row ran, as the Approval column says it. */
export type ApprovalLabel =
  'denied' | 'card' | 'click' | 'always' | 'full_auto' | 'dont_ask_again' | 'go_live' | 'run';

export function approvalLabel(
  row: Pick<ActivityRow, 'kind' | 'approvalKind' | 'autoVia'>,
): ApprovalLabel {
  if (row.kind === 'access.denied') return 'denied';
  if (row.approvalKind === 'ask') return 'card';
  if (row.approvalKind === 'click') return 'click';
  if (row.approvalKind === 'auto') {
    // An agent's step that went live on its own (AUTONOMOUS-GO-LIVE §6.4), never Full auto's.
    return row.autoVia === 'always' || row.autoVia === 'dont_ask_again' || row.autoVia === 'go_live'
      ? row.autoVia
      : 'full_auto';
  }
  return 'run';
}

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAccess.activity' });
const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });

const toolName = (key: string | null) =>
  key && Object.hasOwn(messages.chatTools, key)
    ? toolT(`${key as keyof (typeof messages)['chatTools']}.name`)
    : '';

/**
 * An Admin's export: one line per row, in words, as the page shows it. The
 * cells are escaped by lib/csv (formulas included).
 */
export function activityCsv(
  rows: ActivityRow[],
  summaryOf: (key: string, params: Record<string, string>) => string,
): string {
  const headers = [
    'time',
    'person',
    'surface',
    'event',
    'tool',
    'class',
    'mode',
    'approval',
    'status',
  ];
  return toCsv(
    rows.map((row) => ({
      time: row.at,
      person: row.person,
      surface: row.surface,
      event: row.summaryKey ? summaryOf(row.summaryKey, row.summaryParams) : '',
      tool: toolName(row.toolKey),
      class: row.kind === 'access.denied' ? 'denied' : row.class,
      mode: row.mode ?? '',
      approval: t(`approval.${approvalLabel(row)}`),
      status: t(`status.${row.status}`),
    })),
    headers,
  );
}
