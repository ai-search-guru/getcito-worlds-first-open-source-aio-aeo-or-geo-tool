import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentListItem, AgentTriggerView } from '@/lib/chat/agents';
import {
  nextRunOf,
  outcomeCounts,
  triggerSummary,
  whenParts,
  type TriggerSummary,
} from '@/lib/chat/agentView';

/**
 * The words Agent Center puts around an agent (CHAT-21 §B item 6, §C):
 * times ("Today 09:14", "Mon 07:00"), triggers in short ("Every Mon 09:00 ·
 * New Recover signal"), the next run, the scope ("Brand A", "3 brands"),
 * connections and the 30-day outcomes. One place for the list and the
 * detail. A schedule's times are on its own clock, as its rule reads
 * ("Every Mon 07:00" runs next "Mon 07:00"); other times on the viewer's.
 * `now` and `timeZone` are fixed in tests; the browser's otherwise.
 */
export function useAgentWords(now: Date, timeZone?: string) {
  const t = useTranslations('chatAgents');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tKpis = useTranslations('actionCenter.registry');

  return useMemo(() => {
    /**
     * An instant: past ones as a day, future ones with their time too. On
     * `zone`'s clock when given (a schedule's own), else the viewer's.
     */
    const when = (iso: string, zone?: string | null) => {
      const at = whenParts(iso, now, zone ?? timeZone);
      if (at.kind === 'date') {
        return Date.parse(iso) > now.getTime()
          ? t('when.dateTime', { date: at.date, time: at.time })
          : t('when.date', { date: at.date });
      }
      return t(`when.${at.kind}`, { time: at.time, weekday: at.weekday });
    };

    const schedule = (summary: Extract<TriggerSummary, { kind: 'schedule' }>) => {
      switch (summary.repeat) {
        case 'daily':
          return t('trigger.daily', { time: summary.time });
        case 'weekdays':
          return t('trigger.weekdays', { time: summary.time });
        case 'days':
          return t('trigger.days', {
            days: summary.days.map((day) => t(`days.${day}`)).join(', '),
            time: summary.time,
          });
        case 'monthly':
          return summary.monthDay === -1
            ? t('trigger.monthlyLast', { time: summary.time })
            : t('trigger.monthly', { day: summary.monthDay, time: summary.time });
        case 'once':
          return t('trigger.once', { when: when(summary.at) });
        case 'unknown':
          return t('trigger.schedule');
      }
    };

    /** A trigger's title: "Every Mon 09:00", "New Recover signal", "Citations −10% in a week". */
    const trigger = (view: Pick<AgentTriggerView, 'kind' | 'config'>) => {
      const summary = triggerSummary(view);
      switch (summary.kind) {
        case 'schedule':
          return schedule(summary);
        case 'signal':
          return summary.category && tCategories.has(summary.category)
            ? t('trigger.signal', { category: tCategories(summary.category) })
            : t('trigger.signalAny');
        case 'kpi': {
          if (!summary.kpi || !tKpis.has(`${summary.kpi}.name`)) return t('trigger.kpiAny');
          const sign = summary.direction === 'up' ? '+' : summary.direction === 'down' ? '−' : '±';
          const amount = `${summary.threshold.toLocaleString('en-US')}${summary.unit === 'percent' ? '%' : ''}`;
          return t('trigger.kpi', {
            kpi: tKpis(`${summary.kpi}.name`),
            sign,
            amount,
            period: summary.period,
          });
        }
        case 'watch_rule':
          return t('trigger.watchRule');
      }
    };

    /** The switched-on triggers in short (§B item 6), two at most then "+n"; "Manual only" for none. */
    const triggersShort = (triggers: readonly AgentTriggerView[]) => {
      const on = triggers.filter((view) => view.enabled);
      if (on.length === 0) return t('trigger.manualOnly');
      const shown = on.slice(0, 2).map(trigger);
      if (on.length > 2) shown.push(t('trigger.more', { count: on.length - 2 }));
      return shown.join(' · ');
    };

    /** When it runs next: a time, on a trigger, or only on Run now. */
    const nextRun = (triggers: readonly AgentTriggerView[]) => {
      const next = nextRunOf(triggers);
      if (next.kind === 'at') {
        const at = when(next.at, next.zone);
        return { short: at, line: t('line.nextRun', { when: at }) };
      }
      if (next.kind === 'event') return { short: t('line.event'), line: t('line.event') };
      return { short: t('line.manual'), line: t('line.manual') };
    };

    /** "Brand A", "3 brands", "All brands". */
    const scope = (value: AgentListItem['scope']) => {
      if (value.allBrands) return t('scope.all');
      if (value.brands.length === 0) return t('scope.none');
      if (value.brands.length === 1) return value.brands[0];
      return t('scope.count', { count: value.brands.length });
    };

    /** A connection's name: known ones by their product's name, others from their key. */
    const connection = (key: string) =>
      t.has(`connections.names.${key}`)
        ? t(`connections.names.${key}`)
        : key
            .split('_')
            .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
            .join(' ');

    /** "4 improved · 2 pending", or null when no run had an outcome. */
    const outcomes = (counts: AgentListItem['outcomes30d']) => {
      const shown = outcomeCounts(counts);
      if (shown.length === 0) return null;
      return shown.map(({ outcome, count }) => t(`outcomeCount.${outcome}`, { count })).join(' · ');
    };

    /** "Auto", or the picked model's own name. */
    const model = (id: string | null | undefined) =>
      !id || id === 'auto' ? t('model.auto') : (id.split('/').pop() ?? id);

    return { when, trigger, triggersShort, nextRun, scope, connection, outcomes, model };
  }, [t, tCategories, tKpis, now, timeZone]);
}

export type AgentWords = ReturnType<typeof useAgentWords>;
