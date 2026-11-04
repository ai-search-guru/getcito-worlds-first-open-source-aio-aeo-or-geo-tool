/**
 * Chat's shortcuts (CHAT-08; Chat Wave 2 W2-09): a known job with a fixed
 * data plan, picked from the composer's / menu (or a Home chip) and sent
 * with the message as its `shortcutId`. Each is a hidden GetCito skill, a
 * playbook in the repo's /skills folder under the same name (`/analyze` is
 * skills/analyze/SKILL.md), that the engine loads for the run. "Complete
 * tasks" is the /tasks skill itself, and "Create a report on" is
 * /new-report, as /report is the Weekly report skill's (decided
 * 2026-11-02). What's new and Create image wait for their features. Pure,
 * for the browser and the server alike: the trigger words are the
 * composer's (chatComposer.slash.shortcuts in messages/en.json).
 */

/** The shortcuts in the / menu's order (CHAT-08's table): each id its playbook's name and /command. */
export const SHORTCUTS = [
  { id: 'start', key: 'start' },
  { id: 'analyze', key: 'analyze' },
  { id: 'new-report', key: 'newReport' },
  { id: 'create', key: 'create' },
  { id: 'optimize', key: 'optimize' },
  { id: 'opportunities', key: 'opportunities' },
  { id: 'audit', key: 'audit' },
] as const;
export type Shortcut = (typeof SHORTCUTS)[number];
export type ShortcutId = Shortcut['id'];

export const SHORTCUT_IDS: readonly ShortcutId[] = SHORTCUTS.map((s) => s.id);

export const isShortcutId = (value: unknown): value is ShortcutId =>
  typeof value === 'string' && (SHORTCUT_IDS as readonly string[]).includes(value);

/** A shortcut's /command, as the / menu shows it. */
export const shortcutCommand = (shortcut: Pick<Shortcut, 'id'>) => `/${shortcut.id}`;

/**
 * Whether a text still starts with a shortcut's trigger words, as the
 * picked shortcut put them: the words alone, or followed by a space or a
 * line. A text that rewrote them is the person's own request, and runs
 * without the shortcut's data plan (CHAT-08 item 4).
 */
export function keepsTrigger(text: string, trigger: string): boolean {
  const words = trigger.trim();
  const said = text.trim();
  if (!words || !said.startsWith(words)) return false;
  return said.length === words.length || /\s/.test(said[words.length]);
}
