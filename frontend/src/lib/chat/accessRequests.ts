import type { DenialRuleKind } from './denial';

/**
 * "Ask your Admin" requests (CHAT-20 §4c, chat_access_requests 00403), as
 * the server actions (lib/actions/chatAccessRequests.ts) and Roles &
 * access › Requests share them.
 */

/** Pending requests a person may have at once. */
export const MAX_PENDING_REQUESTS = 10;

/**
 * Requests a person may send in a UTC day, withdrawn ones too: withdrawing
 * frees a pending place, so this is what bounds a day's rows.
 */
export const MAX_REQUESTS_PER_DAY = 20;

/** The longest drafted change a request keeps, as JSON text. */
export const MAX_DRAFTED_CHANGE_CHARS = 8_000;

/** How far back Requests lists the decided ones. */
export const REQUEST_HISTORY_DAYS = 30;

/** The rules a request may be about: the denial's (denial.ts), as the table checks them. */
export const ACCESS_REQUEST_RULES = [
  'role',
  'plan',
  'policy',
  'workspace',
  'brand',
  'demo',
] as const satisfies readonly DenialRuleKind[];

export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export interface AccessRequest {
  id: string;
  /** The requester's name, or the part of their e-mail before the @. */
  requester: string;
  isYours: boolean;
  asked: string;
  /** The registry row's label key; null for a request about the plan or the role. */
  toolKey: string | null;
  ruleKind: (typeof ACCESS_REQUEST_RULES)[number];
  ruleDetail: string;
  /** The line an approval saves (a Manager's Workspace memory request); null for any other. */
  draftedText: string | null;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}
