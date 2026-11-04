'use server';

import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { taskText } from '@/lib/action-center/display';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  MAX_REFERENCES,
  pageLabel,
  pickReferences,
  referenceQuery,
  type ChatReference,
} from '@/lib/chat/references';

/**
 * The composer's @ search (CHAT-02 item 16), behind CHAT_AGENTIC: the
 * brand's tracked prompts, its pages and its open Action Center tasks that
 * match, up to MAX_REFERENCES, by name. Read with the person's own session
 * (RLS); the pages' table isn't in the generated types, so it is read with
 * the service role, for a brand the session can read only. Never throws
 * (#1777): a refusal or a failed read is a value.
 */

export type ReferencesResult =
  | { ok: true; references: ChatReference[] }
  | { ok: false; failure: 'session' | 'chat_off' | 'not_found' | 'failed' };

/** Open: an action or a task that isn't done, skipped or dismissed. */
const OPEN_ACTIONS = ['new', 'in_progress', 'on_hold'];
const OPEN_TASKS = ['todo', 'in_progress', 'waiting_approval'];
/** Tasks read to find the matches: their titles are written from keys, so matched here. */
const TASKS_READ = 100;

const taskT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTasks' });

export async function searchChatReferences(brandId: string, q: string): Promise<ReferencesResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, failure: 'session' };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!chatAgenticEnabled(profile?.organization_id)) return { ok: false, failure: 'chat_off' };
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand) return { ok: false, failure: 'not_found' };

    const query = referenceQuery(q);
    const pattern = `%${query}%`;

    // A prompt reaches its brand through its prompt set; prompts has no brand_id.
    let prompts = supabase
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(MAX_REFERENCES);
    if (query) prompts = prompts.ilike('text', pattern);

    let pages = supabaseAdmin
      .from('site_pages')
      .select('url, title')
      .eq('brand_id', brandId)
      .order('ai_citations', { ascending: false })
      .limit(MAX_REFERENCES);
    if (query) pages = pages.or(`url.ilike.${pattern},title.ilike.${pattern}`);

    const tasks = supabase
      .from('action_tasks')
      .select('id, task_key, title, title_params, actions!inner(brand_id, status)')
      .eq('actions.brand_id', brandId)
      .in('actions.status', OPEN_ACTIONS)
      .in('status', OPEN_TASKS)
      .order('updated_at', { ascending: false })
      .limit(TASKS_READ);

    const [promptRows, pageRows, taskRows] = await Promise.all([prompts, pages, tasks]);
    if (promptRows.error || pageRows.error || taskRows.error)
      return { ok: false, failure: 'failed' };

    const words = query.toLowerCase();
    const taskRefs = (taskRows.data ?? [])
      .map((task) => ({
        type: 'task' as const,
        id: task.id,
        label: taskText(
          {
            taskKey: task.task_key,
            title: task.title,
            titleParams: (task.title_params ?? {}) as Record<string, string | number>,
          },
          taskT as (key: string, values?: Record<string, string | number>) => string,
        ),
      }))
      .filter((ref) => ref.label && (!words || ref.label.toLowerCase().includes(words)));

    return {
      ok: true,
      references: pickReferences([
        (promptRows.data ?? []).map((p) => ({ type: 'prompt' as const, id: p.id, label: p.text })),
        ((pageRows.data ?? []) as { url: string; title: string | null }[]).map((p) => ({
          type: 'page' as const,
          id: p.url,
          label: pageLabel(p.url),
        })),
        taskRefs,
      ]),
    };
  } catch (error) {
    console.error('[chat-references] search failed:', error);
    return { ok: false, failure: 'failed' };
  }
}
