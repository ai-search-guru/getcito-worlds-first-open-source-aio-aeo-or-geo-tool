/**
 * What the engine puts right in an answer, whatever model wrote it. Chat's
 * model test set (W4-35) found each in real runs of GPT and Gemini models:
 *
 *   - a tool's raw name ("explain_change") becomes the words its Settings
 *     row uses, or goes when it has none (CHAT-03 item 22);
 *   - a tool call written out as text, as GPT sometimes does ("…opportunity.
 *     waswo to=functions.suggest_next_moves {…}"), goes, with the rest of
 *     that reply's text;
 *   - an answer whose data held instructions for AI assistants ends saying
 *     they weren't followed, when the model didn't say so itself (CHAT-05
 *     item 12).
 *
 * A fenced code block keeps its text, and so does a name the person wrote
 * in their own message. Pure.
 */

/** A tool call written as text: the marker, and the word glued before it. */
const CALL_AS_TEXT = /[^\s.!?…]*\s*\bto=functions\.[\w.-]*/;

/** Where a tool call written as text starts in `text`; null when none does. */
export function callAsTextAt(text: string): number | null {
  const found = CALL_AS_TEXT.exec(text);
  return found ? found.index : null;
}

/**
 * Where the trailing word starts, held back while it may still grow into a
 * tool's name, a code fence or a call written as text; null when the text
 * ends in a space.
 */
export function wordHold(text: string): number | null {
  const word = /\S+$/.exec(text);
  return word ? word.index : null;
}

/** Whether a text leaves a fenced code block open. */
export function fenceOpen(text: string): boolean {
  return (text.match(/```/g)?.length ?? 0) % 2 === 1;
}

/** The names an answer may not show, and the words each becomes (null: it goes). */
export interface ToolNames {
  words: ReadonlyMap<string, string | null>;
  pattern: RegExp;
}

export function toolNamesOf(entries: Iterable<readonly [string, string | null]>): ToolNames {
  const words = new Map(entries);
  // Longest first, so one name never stops at another inside it.
  const names = [...words.keys()]
    .filter((name) => /^[A-Za-z][\w]*$/.test(name))
    .sort((a, b) => b.length - a.length);
  const pattern = names.length > 0 ? new RegExp(`\`?\\b(${names.join('|')})\\b\`?`, 'g') : /(?!)/g;
  return { words, pattern };
}

/**
 * Text with each tool name outside a fenced code block as its words; in
 * backticks or not, the backticks go with it. A name with no words goes, and
 * an empty "()" it leaves with it. `inFence`: the text starts inside a code
 * block. `atSpace`: what was shown before it ends in a space, so a name gone
 * from its start leaves no second one. `keep`: the person's own message,
 * whose names stay.
 */
export function maskToolNames(
  text: string,
  names: ToolNames,
  {
    inFence = false,
    atSpace = false,
    keep = '',
  }: { inFence?: boolean; atSpace?: boolean; keep?: string } = {},
): string {
  return text
    .split('```')
    .map((part, i) => {
      if ((i % 2 === 1) !== inFence) return part;
      let removed = false;
      const masked = part.replace(names.pattern, (found: string, name: string) => {
        if (keep.includes(name)) return found;
        const words = names.words.get(name) ?? null;
        if (words === null) removed = true;
        return words ?? '';
      });
      if (!removed) return masked;
      const tidy = masked.replace(/\s*\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ');
      return i === 0 && atSpace ? tidy.replace(/^[ \t]+/, '') : tidy;
    })
    .join('```');
}

/** Naming the instructions: "instructions", "told me", "a line telling", "asked", "talimat". */
const NAMES_INSTRUCTIONS =
  /instruct|\btold\b|\btell(s|ing)?\b|\basked\b|\basking\b|\bcommand|talimat|yönerge/i;
/** Saying they weren't followed: "ignored", "won't follow", "weren't followed", "yok saydım". */
const NOT_FOLLOWED = new RegExp(
  [
    'ignor|disregard',
    String.raw`\b(did(n['’]?t| not)|won['’]?t|will not)\s+(follow|act on|obey|carry)`,
    String.raw`\b(were|was|are|is)(n['’]?t| not)\s+(followed|acted on|carried out)`,
    String.raw`\bnot (followed|acted on)\b`,
    'yok say|uygulamadım|uymadım|dikkate almadım',
  ].join('|'),
  'i',
);

/**
 * Whether an answer already says the data's instructions weren't followed,
 * in English or Turkish: both the instructions and the not following named,
 * so "ignoring the seasonal dip" isn't it.
 */
export function saysInstructionsIgnored(text: string): boolean {
  return NAMES_INSTRUCTIONS.test(text) && NOT_FOLLOWED.test(text);
}
