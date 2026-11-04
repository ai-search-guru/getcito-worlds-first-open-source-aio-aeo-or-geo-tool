'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { FormCardAssist, FormCardValues } from '@/components/agentic/FormCard';
import type { ChatConfirmForm } from '@/lib/chat/events';
import {
  MAX_MEMORY_LINE,
  memoryTextProblem,
  normalizeMemoryText,
  type MemoryTextProblem,
} from '@/lib/chat/memory/rules';
import { readWhen, whenHint, type WhenWords } from '@/lib/chat/schedule/when';

/**
 * The help an editable card gives as the person types, by what it makes:
 *
 *   - a schedule (W3-02): its When read on their zone's clock, with its next
 *     run or why it doesn't read (which keeps Create schedule off), and
 *     "Notify only if the answer changed" only on a recurring job;
 *   - a memory (W3-12a): the line's counter, why memory can't keep it (a
 *     secret, personal data, a rule change: Save stays off), and "Replaces"
 *     only while the line still goes to the replaced one's scope.
 *
 * The server checks the same again on Save: this only says it sooner.
 */
export function useFormAssist(
  form: ChatConfirmForm | undefined,
): ((values: FormCardValues) => FormCardAssist) | undefined {
  const t = useTranslations('chatSchedules.when') as unknown as WhenWords;
  const tMemory = useTranslations('chatMemory');
  const kind = form?.kind;
  const zone = form?.zone ?? 'UTC';
  const schedule = useCallback(
    (values: FormCardValues): FormCardAssist => {
      const when = typeof values.when === 'string' ? values.when : '';
      const at = new Date();
      const hint = whenHint(when, zone, at, t);
      const reading = readWhen(when, { now: at, timeZone: zone });
      const recurring = reading.ok && reading.when.kind === 'recurring';
      return {
        hints: { when: hint.ok ? hint.hint : undefined },
        problems: { when: hint.ok ? undefined : hint.hint },
        hidden: recurring ? [] : ['changeOnly'],
      };
    },
    [zone, t],
  );
  const firstScope = form?.fields.find((field) => field.name === 'scope')?.value;
  const memory = useCallback(
    (values: FormCardValues) =>
      memoryCardAssist(values, firstScope, {
        counter: (count, max) => tMemory('card.counter', { count, max }),
        problem: (code) => tMemory(`refusal.${code}`, { line: MAX_MEMORY_LINE }),
      }),
    [firstScope, tMemory],
  );
  if (kind === 'schedule') return schedule;
  return kind === 'memory' ? memory : undefined;
}

/** The refusal a line's problem is said with (memory/store.ts textRefusal's). */
const REFUSAL_OF: Record<Exclude<MemoryTextProblem, 'empty'>, string> = {
  too_long: 'too_long',
  hidden: 'blocked',
  secret: 'blocked',
  personal: 'blocked',
  rules: 'rules',
};

/**
 * A Remember card's live help (CHAT-14 items 7, 12, 19): "{n} of 300
 * characters" under the line, the refusal's words when memory can't keep
 * it, and "Replaces" hidden once another scope than the replaced line's is
 * picked. An empty line is the field's own required check.
 */
export function memoryCardAssist(
  values: FormCardValues,
  firstScope: string | boolean | undefined,
  say: { counter: (count: number, max: number) => string; problem: (code: string) => string },
): FormCardAssist {
  const text = typeof values.text === 'string' ? values.text : '';
  const problem = memoryTextProblem(text);
  return {
    hints: { text: say.counter(normalizeMemoryText(text).length, MAX_MEMORY_LINE) },
    problems: {
      text: problem && problem !== 'empty' ? say.problem(REFUSAL_OF[problem]) : undefined,
    },
    hidden: values.scope === firstScope ? [] : ['replace'],
  };
}
