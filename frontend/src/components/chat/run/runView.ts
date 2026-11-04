import type { ChatStep } from '@/lib/chat/events';

/**
 * What a run's answer shows of its steps (CHAT-03 items 12b–12d, 13–14),
 * from the steps alone: the status line's words, the ✓ chips of the steps
 * done, and the "Data used" chips.
 */

const READ = /^Read\s+/;

/**
 * "Read Citations" → "Citations": what a read step read. A read whose words
 * aren't "Read …" ("Opened a page", "Worked on a step") read no source: null.
 */
export const readSource = (label: string): string | null =>
  READ.test(label) ? label.replace(READ, '') : null;

/** "Opened getcito.com/pricing" → "getcito.com/pricing": the page a step opened. */
export const openedPage = (label: string) => label.replace(/^Opened\s+/, '');

/**
 * The status line's message, as its i18n key and values (item 12c): the
 * running step's own words in the present ("Reading Citations…"); without
 * one, "Writing the answer…" while text streams, else "Thinking…".
 */
export function statusLine(
  steps: readonly ChatStep[],
  streaming: boolean,
): { key: string; values?: Record<string, string> } {
  const running = [...steps].sort((a, b) => b.n - a.n).find((s) => s.status === 'running');
  if (!running || running.kind === 'thinking') {
    return { key: streaming ? 'writing' : 'thinking' };
  }
  const source = running.kind === 'read' ? readSource(running.label) : null;
  if (source !== null) return { key: 'read', values: { source } };
  if (running.kind === 'open_page') {
    return { key: 'openPage', values: { page: openedPage(running.label) } };
  }
  if (running.kind === 'check') return { key: 'check' };
  return { key: 'other', values: { label: running.label } };
}

/**
 * The ✓ chips above the answer (item 12d): each step done, thinking left
 * out, and questions too: an answered one has its own line (CHAT-07 §A item 10).
 */
export const doneSteps = (steps: readonly ChatStep[]) =>
  [...steps]
    .sort((a, b) => a.n - b.n)
    .filter((s) => s.status === 'done' && s.kind !== 'thinking' && s.kind !== 'ask');

export interface DataUsedChip {
  /** "Citations", or a page's address. */
  label: string;
  /** Rows read, when the step counted them. */
  rows?: number;
  /** What `rows` counts when it isn't rows: saved notes ("Memory · 3 items"). */
  unit?: 'items';
}

/**
 * "Data used" (items 13–14): one chip per source a read step read, and per
 * page a step opened, in the order first read; a source read twice is one
 * chip, with its largest count. Skills, thinking and checks are no source,
 * nor a read whose words aren't "Read …" (a page of the app it went to);
 * memory is ("Used memory": "Memory · 3 items", CHAT-14 item 17).
 */
export function dataUsed(steps: readonly ChatStep[]): DataUsedChip[] {
  const chips = new Map<string, DataUsedChip>();
  for (const step of [...steps].sort((a, b) => a.n - b.n)) {
    if (step.status !== 'done') continue;
    if (step.kind === 'open_page') {
      const page = openedPage(step.label);
      if (!chips.has(`page:${page}`)) chips.set(`page:${page}`, { label: page });
      continue;
    }
    if (step.kind !== 'read') continue;
    if (step.scope?.unit === 'items' && step.scope.subject) {
      const key = `items:${step.scope.subject}`;
      chips.set(key, {
        label: step.scope.subject,
        ...(step.rowCount === undefined ? {} : { rows: step.rowCount }),
        unit: 'items',
      });
      continue;
    }
    const source = readSource(step.label);
    if (source === null) continue;
    const key = `read:${source}`;
    const seen = chips.get(key);
    const rows =
      step.rowCount === undefined ? seen?.rows : Math.max(step.rowCount, seen?.rows ?? 0);
    chips.set(key, { label: source, ...(rows === undefined ? {} : { rows }) });
  }
  return [...chips.values()];
}
