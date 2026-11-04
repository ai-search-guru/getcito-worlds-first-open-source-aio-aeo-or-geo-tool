import type { AgentDetail, AgentListItem, AgentListResult, AgentRunView } from '../agents';

/** Agents as the agents API answers them, for Chat › Agents' tests. Tests only. */

export const AGENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const NOW = new Date('2026-10-30T12:00:00Z');

const noOutcomes = {
  pending: 0,
  improved: 0,
  no_meaningful_change: 0,
  declined: 0,
  not_measurable: 0,
};

export function listItem(extra: Partial<AgentListItem> = {}): AgentListItem {
  return {
    id: AGENT_ID,
    name: 'Citation win-back',
    status: 'active',
    pausedReason: null,
    visibility: 'workspace',
    mine: true,
    ownerInitials: 'AK',
    skills: ['winback', 'refresh'],
    mode: 'auto',
    triggers: [
      {
        kind: 'schedule',
        config: {
          type: 'recurring',
          rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
          // Its clock is Istanbul's (UTC+3); the tests' screen is UTC.
          timezone: 'Europe/Istanbul',
        },
        enabled: true,
        nextFireAt: '2026-11-02T06:00:00.000Z',
        lastFiredAt: '2026-10-26T06:00:00.000Z',
      },
      {
        kind: 'signal',
        config: { category: 'recover' },
        enabled: true,
        nextFireAt: null,
        lastFiredAt: null,
      },
    ],
    scope: { allBrands: false, brands: ['GetCito'] },
    lastRun: { status: 'done', at: '2026-10-30T09:14:00.000Z' },
    outcomes30d: { ...noOutcomes, improved: 4, pending: 2 },
    usage30d: { share: 0.034, ownKeyShare: 0, runs: 4 },
    maxRunShare: 0.1,
    maxMonthShare: null,
    version: 2,
    updatedAt: '2026-10-29T10:00:00.000Z',
    can: { run: true, pause: true, resume: false },
    ...extra,
  };
}

export function listResult(
  agents: AgentListItem[],
  extra: Partial<AgentListResult> = {},
): AgentListResult {
  return {
    agents,
    keyFailure: null,
    counts: { mine: 2, workspace: 5, paused: 1, archived: 3 },
    active: 4,
    activeInWorkspace: 4,
    activeLimit: 25,
    ...extra,
  };
}

export function run(extra: Partial<AgentRunView> = {}): AgentRunView {
  return {
    status: 'done',
    triggerKind: 'schedule',
    version: 2,
    brand: 'GetCito',
    by: null,
    queuedAt: '2026-10-30T09:00:00.000Z',
    startedAt: '2026-10-30T09:01:00.000Z',
    finishedAt: '2026-10-30T09:14:00.000Z',
    skippedReason: null,
    stopReason: null,
    outcome: 'improved',
    outcomeConfidence: 'medium',
    usageShare: 0.032,
    maxShare: 0.1,
    chatId: 'cccccccc-0000-4000-8000-000000000001',
    ...extra,
  };
}

const NONE = {
  create: false,
  edit: false,
  activate: false,
  pause: false,
  resume: false,
  archive: false,
  restore: false,
  delete: false,
  duplicate: false,
  takeOver: false,
  run: false,
};

export function detail(extra: Partial<AgentDetail> = {}): AgentDetail {
  return {
    ...listItem(),
    createdAt: '2026-10-01T10:00:00.000Z',
    activatedAt: '2026-10-02T10:00:00.000Z',
    archivedAt: null,
    settings: {
      skills: ['winback', 'refresh'],
      instructions: null,
      mode: 'auto',
      connections: [
        { key: 'google_search_console', required: true },
        { key: 'webflow', required: false },
      ],
      model: 'auto',
      effort: 'normal',
      scope: { brand_ids: ['bbbbbbbb-0000-4000-8000-000000000001'], engines: ['perplexity-web'] },
      notifyUserIds: [],
      followupDays: 14,
    },
    brands: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'GetCito' }],
    recentRuns: [run()],
    usagePeriod: { share: 0.021, ownKeyShare: 0, runs: 3 },
    can: { ...NONE },
    limits: { activeAgents: 25, runsAtOnce: 5, eventRunsPerDay: 6 },
    ...extra,
  };
}

/** Every button an Admin gets on an active agent someone else owns. */
export const ADMIN_CAN = {
  ...NONE,
  create: true,
  edit: true,
  pause: true,
  archive: true,
  duplicate: true,
  takeOver: true,
  run: true,
};

export { NONE as NOTHING_CAN };
