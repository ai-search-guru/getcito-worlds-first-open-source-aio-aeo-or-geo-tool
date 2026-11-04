import { z } from 'zod';
import { isTimeZone } from '@/lib/timeZone';
import { formatRecurringRule, nextRecurringFire, parseRecurringRule } from './schedule/rule';

/**
 * An agent's Schedule trigger (CHAT-21 §E item 22): once at a time, or
 * recurring by an RRULE in a time zone. Its next fire time is worked out
 * here, so the agent's detail can show it and the trigger runner (W2-16)
 * can fire it. Pure: no database, no clock but the one passed in.
 *
 * The RRULE subset itself (FREQ DAILY, WEEKLY or MONTHLY, at most once a
 * day, on a zone's clock) is schedule/rule.ts's, shared with Chat's
 * scheduled jobs (CHAT-12, Wave 3), and is exported from here as before.
 */

export {
  RRULE_DAYS,
  formatRecurringRule,
  nextRecurringFire,
  parseRecurringRule,
  type RecurringRule,
  type RruleDay,
} from './schedule/rule';

/** How far ahead a one-off schedule may be set. */
export const ONCE_MAX_AHEAD_MS = 366 * 86_400_000;

/** A Schedule trigger's settings (chat_agent_triggers.config_json). */
export const scheduleConfigSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('once'),
    /** An ISO date-time with its offset: when it fires. */
    at: z.iso.datetime({ offset: true }).transform((at) => new Date(at).toISOString()),
  }),
  z
    .strictObject({
      type: z.literal('recurring'),
      rrule: z.string().max(200),
      /** An IANA zone ("Europe/Istanbul"): the clock the rule reads. */
      timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone'),
    })
    .transform((config, ctx) => {
      const rule = parseRecurringRule(config.rrule);
      if (!rule) {
        ctx.addIssue({ code: 'custom', message: 'Unsupported RRULE', path: ['rrule'] });
        return z.NEVER;
      }
      return { ...config, rrule: formatRecurringRule(rule) };
    }),
]);
export type ScheduleConfig = z.output<typeof scheduleConfigSchema>;

/**
 * When a Schedule trigger fires next, after `now`; null once a one-off has
 * fired, or for settings that don't read as a schedule.
 */
export function nextScheduleFire(config: unknown, now: Date): string | null {
  const parsed = scheduleConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  if (parsed.data.type === 'once') {
    return Date.parse(parsed.data.at) > now.getTime() ? parsed.data.at : null;
  }
  const rule = parseRecurringRule(parsed.data.rrule);
  return rule ? nextRecurringFire(rule, parsed.data.timezone, now) : null;
}
