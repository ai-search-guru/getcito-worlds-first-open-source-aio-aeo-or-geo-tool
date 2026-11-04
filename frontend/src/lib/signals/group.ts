import type { Signal } from './map';
import type { SignalStatus } from './registry';
import { mergeWhere, type SignalWhere } from './where';

/**
 * Signals that read as one row (AC-002).
 *
 * A brand can track the same prompt text several times, in different topics
 * or with different locations, and the detectors write one signal per prompt.
 * On production one pass wrote ten identical "Citations lost for '…'" rows,
 * which looked like duplicates and inflated every count. Signals of one kind,
 * about one prompt text, found in one pass are therefore one group: one row
 * in the list, one in every count. Each signal stays its own row underneath,
 * with its own status.
 *
 * The rule has a twin in SQL, public.signal_group_key (00141), which the
 * summary cards and the tab badge count with. Change both together.
 */

/** A prompt text as the group compares it: case, spacing and the closing "?" ignored. */
export function promptTextKey(text: string): string {
  // ASCII whitespace only, exactly as the SQL twin's character class does.
  return text
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ | $/g, '')
    .replace(/[ ?.!]+$/, '')
    .toLowerCase();
}

export function signalGroupKey(
  signal: Pick<Signal, 'id' | 'kind' | 'detectedAt' | 'payload'>,
): string {
  const { promptId, promptText } = signal.payload ?? {};
  if (typeof promptId === 'string' && typeof promptText === 'string') {
    return `${signal.kind}|${promptTextKey(promptText)}|${Date.parse(signal.detectedAt)}`;
  }
  return signal.id;
}

export interface SignalGroup {
  key: string;
  /** In the order given (newest first); the first one leads the row. */
  signals: Signal[];
}

export function groupSignals(signals: Signal[]): SignalGroup[] {
  const groups = new Map<string, Signal[]>();
  for (const signal of signals) {
    const key = signalGroupKey(signal);
    const members = groups.get(key);
    if (members) members.push(signal);
    else groups.set(key, [signal]);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, signals: members }));
}

// Open before closed, so a group with one untriaged copy still asks for triage.
const STATUS_ORDER: readonly SignalStatus[] = ['new', 'acknowledged', 'resolved', 'dismissed'];

export function groupStatus(signals: Signal[]): SignalStatus {
  return STATUS_ORDER.find((status) => signals.some((s) => s.status === status)) ?? 'new';
}

export function groupWhere(signals: Signal[]): SignalWhere {
  return mergeWhere(signals.map((signal) => signal.where));
}

/**
 * The signal a group's row is titled from: its newest copy, with the
 * platforms every copy was lost on. A lost citation lost on one platform
 * names it in its title; a group must not name only its first copy's, nor
 * name any while a copy's platforms were never recorded.
 */
export function groupLead(signals: Signal[]): Signal {
  const lead = signals[0];
  const recorded = signals.map((s) =>
    Array.isArray(s.payload?.platforms)
      ? s.payload.platforms.filter((p): p is string => typeof p === 'string')
      : null,
  );
  if (recorded.every((platforms) => platforms === null)) return lead;
  if (recorded.some((platforms) => platforms === null)) {
    const payload = { ...lead.payload };
    delete payload.platforms;
    return { ...lead, payload };
  }
  return {
    ...lead,
    payload: { ...lead.payload, platforms: [...new Set(recorded.flat() as string[])] },
  };
}
