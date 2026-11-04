import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { PLANS, type PlanId } from '@/config/plans';
import { SHORTCUT_PLAYBOOK, type FocusShortcut } from './focusHome';
import type { ToolDenial } from './precedence';
import type { ChatTool } from './registry/defineTool';
import { SHORTCUTS, isShortcutId, keepsTrigger, type ShortcutId } from './shortcuts';
import type { ShortcutPlaybook } from './skills/library';

/**
 * A shortcut's run on the server (CHAT-08 items 4, 7, 8; W2-09): which
 * shortcut a message really started, what its run may read, and the line
 * that says what the plan leaves out. The playbook itself is a hidden
 * library skill (skills/library.ts); engine.ts loads it. Server only.
 */

const toolT = createTranslator({ locale: 'en', messages, namespace: 'chatTools' });

/** A shortcut's trigger words, as the / menu puts them in the box. */
function triggerOf(id: ShortcutId): string {
  const key = SHORTCUTS.find((shortcut) => shortcut.id === id)!.key;
  return messages.chatComposer.slash.shortcuts[key].starter;
}

/** The words of the Home chips that run with a shortcut (focusHome.ts SHORTCUT_PLAYBOOK). */
function chipMessagesOf(id: ShortcutId): string[] {
  const words = messages.chatShell.home.byFocus.shortcuts as Record<string, string>;
  return (Object.entries(SHORTCUT_PLAYBOOK) as [FocusShortcut, ShortcutId][])
    .filter(([, playbook]) => playbook === id)
    .map(([chip]) => words[`${chip}Message`])
    .filter((message): message is string => typeof message === 'string');
}

/**
 * The shortcut a message was sent with, when the message is still that
 * shortcut's: it starts with the shortcut's trigger words (the / menu), or
 * is one of its Home chips' messages word for word. Null otherwise, for an
 * id that is no shortcut's, or none: the message then runs as the person's
 * own request, with every read (CHAT-08 item 4). Never trusted as sent.
 */
export function messageShortcut(id: unknown, message: string): ShortcutId | null {
  if (!isShortcutId(id)) return null;
  const said = message.trim();
  if (keepsTrigger(said, triggerOf(id))) return id;
  return chipMessagesOf(id).includes(said) ? id : null;
}

/**
 * The tools a shortcut's run gets (CHAT-08: "a shortcut run reads only its
 * data plan's sources"): of the ones offered, the reads its playbook names
 * and every other tool. A change still goes through its own card; the
 * playbook narrows what is read, never what may be changed.
 */
export function playbookTools(
  offered: readonly ChatTool[],
  playbook: Pick<ShortcutPlaybook, 'reads'>,
): ChatTool[] {
  const reads = new Set(playbook.reads);
  return offered.filter((tool) => tool.class !== 'read' || reads.has(tool.name));
}

/**
 * The line for the run's prompt when the plan leaves out part of the
 * shortcut's data plan (CHAT-08 item 7): which reads, and the plan that has
 * them, so the answer says so in one line with the plan's name and goes on
 * with what the plan includes. Null when the plan has it all. A platform
 * the plan doesn't track is each read's own `not_on_plan` (engine rules).
 */
export function playbookPlanNote(
  playbook: Pick<ShortcutPlaybook, 'reads'>,
  refused: readonly { tool: ChatTool; denial: ToolDenial }[],
  planName: string,
): string | null {
  const reads = new Set(playbook.reads);
  const byPlan = new Map<PlanId, string[]>();
  for (const { tool, denial } of refused) {
    if (!reads.has(tool.name) || denial.code !== 'plan_locked') continue;
    const name = Object.hasOwn(messages.chatTools, tool.labelKey)
      ? toolT(`${tool.labelKey}.name` as never)
      : tool.labelKey;
    byPlan.set(denial.needs, [...(byPlan.get(denial.needs) ?? []), name]);
  }
  if (byPlan.size === 0) return null;
  const missing = [...byPlan]
    .map(([needs, names]) => `${names.join(', ')} (on ${PLANS[needs].name} and up)`)
    .join('; ');
  return `This shortcut's data plan includes what the ${planName} plan doesn't: ${missing}. Say so in one line, naming the ${planName} plan, then answer with what it includes.`;
}
