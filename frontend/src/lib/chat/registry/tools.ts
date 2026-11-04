import type { TeamRole } from '@/components/context/RoleProvider';
import type { ChatTool, PlanGate, ToolFlags } from './defineTool';
import { ACTION_CENTER_TOOLS } from './actionCenterTools';
import { AUDIT_TOOLS } from './auditTools';
import { COMPETITOR_TOOLS } from './competitorTools';
import { CONTENT_TOOLS } from './contentTools';
import { PROMPT_TOOLS } from './promptTools';
import { READ_TOOLS } from './readTools';
import { MEMORY_TOOLS } from './memoryTools';
import { REPORT_TOOLS } from './reportTools';
import { SCHEDULE_TOOLS } from './scheduleTools';
import { SKILL_TOOLS } from './skillTools';
import { TOPIC_TOOLS } from './topicTools';
import { WHY_TOOLS } from './whyTools';
import { WRITE_TOOLS } from './writeTools';
import { AREA_READS } from './areas';
import { NAVIGATION_READS } from './navigation';
import { WHATS_NEW_READS } from './whatsNew';

/**
 * Every tool Chat may call (CHAT-20 §9). One without a row here isn't
 * available to Chat. The rows, with their internal and MCP names, stay on
 * the server: the approval checks, the run steps' `tool` column and the MCP
 * parity read them here. What a browser gets is registryCatalog().
 */
export const CHAT_TOOLS: readonly ChatTool[] = [
  ...READ_TOOLS,
  ...AREA_READS,
  ...NAVIGATION_READS,
  ...WHATS_NEW_READS,
  ...WHY_TOOLS,
  ...WRITE_TOOLS,
  ...PROMPT_TOOLS,
  ...TOPIC_TOOLS,
  ...COMPETITOR_TOOLS,
  ...ACTION_CENTER_TOOLS,
  ...CONTENT_TOOLS,
  ...REPORT_TOOLS,
  ...AUDIT_TOOLS,
  ...SCHEDULE_TOOLS,
  ...SKILL_TOOLS,
  ...MEMORY_TOOLS,
];

/** The row of a tool, by its internal name; undefined for a name with no row. */
export function chatTool(name: string): ChatTool | undefined {
  return CHAT_TOOLS.find((tool) => tool.name === name);
}

/**
 * The row a catalog entry's `key` stands for: how the server reads which
 * tool a Settings page means (a policy change, say). Undefined for a key
 * with no row.
 */
export function chatToolByKey(key: string): ChatTool | undefined {
  return CHAT_TOOLS.find((tool) => tool.labelKey === key);
}

/**
 * A row as a page shows it: its decisions, under its label key, without
 * its names, schema, code or fixture.
 */
export type ToolCatalogEntry = Pick<
  ChatTool,
  'area' | 'class' | 'defaultPolicy' | 'maxPolicy' | 'minRole' | 'costClass' | 'route'
> & {
  /** The label key: `chatTools.{key}.name` in messages/en.json names it. */
  key: string;
  flags: ToolFlags;
  planGate: PlanGate | null;
  /** Roles left out of a row open to every role. */
  excludeRoles: TeamRole[];
};

/**
 * The registry as plain data for the browser: Settings › Chat, "What Chat
 * can do" and Roles & access (CHAT-20 §4a, §20). Every row, in registry
 * order, built from the rows on each call so it can't drift from what the
 * server checks. A tool's name, internal or MCP, never reaches a customer
 * (CHAT-03 item 22), so a row goes by its label key, which a page sends
 * back for chatToolByKey. Server code only (a server component or action
 * passes the result on): the rows import the functions they call.
 */
export function registryCatalog(tools: readonly ChatTool[] = CHAT_TOOLS): ToolCatalogEntry[] {
  return tools.map((tool) => ({
    key: tool.labelKey,
    area: tool.area,
    class: tool.class,
    defaultPolicy: tool.defaultPolicy,
    maxPolicy: tool.maxPolicy,
    flags: { ...tool.flags },
    minRole: tool.minRole,
    excludeRoles: [...tool.excludeRoles],
    planGate: tool.planGate ? { ...tool.planGate } : null,
    costClass: tool.costClass,
    route: tool.route,
  }));
}
