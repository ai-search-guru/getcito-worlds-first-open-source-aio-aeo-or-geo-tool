import type { FailingKey } from './keyHealth';
import { CHAT_MODES, type ChatMode, type PrecedenceContext } from './precedence';

/**
 * The composer's setup from facts already read (W1-10): Chat's pages read
 * them for the person, and the dashboard's layout for the side panel on
 * every page, so both offer the same modes and pause at the AI limit the
 * same way. No React and no reads here.
 */

/** A skill in the / menu (CHAT-13 item 5): its /command and its title, nothing else. */
export interface ChatSkillItem {
  name: string;
  title: string;
}

/** What the composer opens with (W1-10): the person's default mode, and whether Full auto is open. */
export interface ChatComposerSetup {
  defaultMode: ChatMode;
  /**
   * Full auto runs for this person as the server decides it: the plan (plan
   * facts §7: Growth and up, paid) and, for anyone but an Admin, the Admin's
   * "Full auto for members" switch (CHAT-23).
   */
  fullAutoOpen: boolean;
  /** Closed by the Admin's switch, not the plan: the composer says so instead of "Needs Growth". */
  fullAutoOffByAdmin: boolean;
  /** The AI usage period whose 80% line the person already saw (CHAT-04 item 16). */
  usageNoticeSeen: string | null;
  /**
   * Chat runs on the workspace's own key (chatRunsOnOwnKey): its steps don't
   * draw on the AI budget, so a used-up allowance doesn't pause it.
   */
  onOwnKey: boolean;
  /**
   * That own key is marked failing (AGENT-OWN-KEY §5.2 item 5): the composer
   * says so, and sending stays on. Null otherwise.
   */
  keyFailure: FailingKey | null;
  /** The / menu's Skills group: the skills the person may use (skillMenuFor); none while the new Chat is off. */
  skills: ChatSkillItem[];
}

/** The modes part of the setup, from the person's saved mode and the precedence facts. */
export type ComposerModeSetup = Pick<
  ChatComposerSetup,
  'defaultMode' | 'fullAutoOpen' | 'fullAutoOffByAdmin'
>;

const CAREFUL_MODES: ComposerModeSetup = {
  defaultMode: 'auto',
  fullAutoOpen: false,
  fullAutoOffByAdmin: false,
};

export const CAREFUL_SETUP: ChatComposerSetup = {
  ...CAREFUL_MODES,
  usageNoticeSeen: null,
  onOwnKey: false,
  keyFailure: null,
  skills: [],
};

/**
 * The setup from the person's saved default mode and the facts the approval
 * precedence decides a run by (role, plan, Chat settings), so the composer
 * never offers a Full auto the server would turn into a card. A saved Full
 * auto that isn't open any more starts as Auto, ask before changes. No
 * facts, the careful setup.
 */
export function composerSetupOf(
  savedMode: unknown,
  ctx: Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
): ComposerModeSetup {
  if (!ctx) return CAREFUL_MODES;
  const forRole = ctx.role === 'admin' || ctx.settings.fullAutoForMembers;
  const fullAutoOpen = ctx.plan.fullAuto && forRole;
  const defaultMode = CHAT_MODES.find((m) => m === savedMode) ?? 'auto';
  return {
    defaultMode: defaultMode === 'full_auto' && !fullAutoOpen ? 'auto' : defaultMode,
    fullAutoOpen,
    fullAutoOffByAdmin: ctx.plan.fullAuto && !forRole,
  };
}
