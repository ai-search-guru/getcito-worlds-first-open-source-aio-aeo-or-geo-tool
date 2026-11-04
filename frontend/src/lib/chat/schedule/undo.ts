import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from '../activity';
import type { UndoRule, WriteRecord } from '../undo';
import { DAY_MS, asObject, textOf } from '../undoParts';

/**
 * A scheduled job's record in the Activity log, and its Undo (CHAT-20 §9
 * row 78: "delete job; past results stay"): the job goes, its runs with it;
 * its chat and what it filed stay. Gone already: nothing to undo. Server only.
 */
export const scheduleUndo: UndoRule = {
  targetType: 'chat_schedule',
  windowMs: 30 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const made = asObject(output);
    const id = textOf(made.schedule_id);
    return {
      target: { type: 'chat_schedule', id },
      summaryParams: {
        title: summaryValue(textOf(made.title) ?? textOf(asObject(input).title)),
        when: summaryValue(textOf(made.when)),
      },
      undo: id ? { after: { id } } : null,
    };
  },
  async inverse({ id }) {
    const { data, error } = await supabaseAdmin
      .from('chat_schedules')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw new Error(`Could not delete the scheduled job: ${error.message}`);
    return (data ?? []).length > 0 ? 'ok' : 'gone';
  },
  href: () => '/dashboard/chat',
};
