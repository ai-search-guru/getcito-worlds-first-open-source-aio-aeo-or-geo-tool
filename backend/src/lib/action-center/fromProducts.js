/**
 * Actions from Product Visibility (ECOM-013): a product, or a category of
 * the brand's catalog, sent to the Action Center with the work that gets it
 * on the AI shelf. The person picks the work types, each for themselves
 * ("Me") or the agent ("Agent"):
 *
 *   - optimize_page: rewrite its page for what AI asked for (optimize_content);
 *   - create_content: a comparison, a buying guide or descriptions
 *     (create_content_brief, then create_content_draft);
 *   - get_listed: the review sites and "best X" lists AI quotes
 *     (prepare_outreach, then execute_outreach, which a person sends);
 *   - technical: GTIN, feed fields and structured data (fix_structured_data,
 *     which a person does).
 *
 * The action is measured afterwards on the shopping questions sent with it
 * and the product's page (basketMetrics.js). One stays open per product or
 * category: sending it again returns it. Work none of whose tasks can be
 * planned for the brand opens nothing (422): an action without tasks.
 */

import supabaseAdmin from '../../config/supabase.js';
import { priorityOnCreate } from './priorityData.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';
import { getTask } from './tasks/registry.js';

export const PRODUCT_ACTION_KIND = 'shopping_product';
export const CATEGORY_ACTION_KIND = 'shopping_category';
export const PRODUCT_WORK_TYPES = ['optimize_page', 'create_content', 'get_listed', 'technical'];

/** The library tasks each work type plans, in order. */
const WORK_TASKS = {
  optimize_page: ['optimize_content'],
  create_content: ['create_content_brief', 'create_content_draft'],
  get_listed: ['prepare_outreach', 'execute_outreach'],
  technical: ['fix_structured_data'],
};

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['ai_visibility', 'mentions'];
/** Questions an action lists by id; it's measured on them. */
export const MAX_PROMPTS = 50;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** One open action per product or category. */
export function productActionDedupKey(target) {
  return `${target.type === 'category' ? CATEGORY_ACTION_KIND : PRODUCT_ACTION_KIND}:${target.id}`;
}

/**
 * A task's mode for who does it: the agent where the task can be an agent's,
 * else a person; "Me" is always a person.
 */
export function modeFor(taskKey, who) {
  const mode = getTask(taskKey)?.mode ?? 'human';
  if (who !== 'agent') return 'human';
  return mode === 'human' ? 'human' : 'agent';
}

/**
 * The action's tasks: each picked work type's, in its order, the person's
 * line on it ("Rewrite the page for women's fit and weight") as the task's
 * why, and the product's page where it's done on the page.
 */
export function productTasks(work, { sources, payload }) {
  const keys = work.flatMap((item) => WORK_TASKS[item.type] ?? []);
  const plan = planTasks(
    { id: PRODUCT_ACTION_KIND, tasks: keys.map((id) => ({ id })) },
    { sources, payload },
  );
  return plan.map((item) => {
    const from = work.find((w) => WORK_TASKS[w.type]?.includes(item.taskKey));
    return {
      ...item,
      mode: modeFor(item.taskKey, from?.who),
      details: {
        ...(item.details ?? {}),
        ...(from?.why ? { why: from.why } : {}),
        workType: from?.type ?? null,
      },
    };
  });
}

/**
 * Creates the action, or returns the open one for the same product or
 * category.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{
 *   target: { type: 'product'|'category', id: string },
 *   work: { type: string, who: 'me'|'agent', why?: string }[],
 *   promptIds: string[],
 *   userId: string,
 * }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 * @throws a 404 for a product or category not the brand's, a 422 for work
 *   with no task to plan
 */
export async function sendProductActions(brandId, { target, work, promptIds, userId }) {
  const isCategory = target.type === 'category';
  const { data: subject, error: subjectErr } = isCategory
    ? await supabaseAdmin
        .from('catalog_categories')
        .select('id, name')
        .eq('id', target.id)
        .eq('brand_id', brandId)
        .maybeSingle()
    : await supabaseAdmin
        .from('catalog_products')
        .select('id, title, url')
        .eq('id', target.id)
        .eq('brand_id', brandId)
        .is('removed_at', null)
        .maybeSingle();
  if (subjectErr) throw new Error(subjectErr.message);
  if (!subject) throw httpError(isCategory ? 'Category not found' : 'Product not found', 404);

  const kind = isCategory ? CATEGORY_ACTION_KIND : PRODUCT_ACTION_KIND;
  const dedupKey = productActionDedupKey(target);
  const openAction = async () => {
    const { data } = await supabaseAdmin
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', dedupKey)
      .in('status', ACTIVE)
      .maybeSingle();
    return data;
  };
  const open = await openAction();
  if (open) return { actionId: open.id, actionNo: Number(open.action_no), created: false };

  // Only the brand's own questions are kept.
  const ids = [...new Set(promptIds)].slice(0, MAX_PROMPTS);
  const { data: prompts, error: promptsErr } = ids.length
    ? await supabaseAdmin
        .from('prompts')
        .select('id, text, prompt_sets!inner(brand_id)')
        .in('id', ids)
        .eq('prompt_sets.brand_id', brandId)
    : { data: [], error: null };
  if (promptsErr) throw new Error(promptsErr.message);

  const name = isCategory ? subject.name.split('>').at(-1).trim() : subject.title;
  const payload = {
    source: 'shopping',
    target: { type: target.type, id: subject.id, name },
    title: name,
    workTypes: [...new Set(work.map((w) => w.type))],
    // Measured on the product's page once done (basketMetrics.js).
    pages: !isCategory && subject.url ? [subject.url] : [],
    promptIds: (prompts ?? []).map((p) => p.id),
    targetEntity: 'prompts',
    targetCount: (prompts ?? []).length,
    targets: (prompts ?? []).map((p) => ({ id: p.id, label: p.text })),
  };

  // Planned before the action opens: one without a task isn't opened.
  const sources = await resolveBrandSources(brandId);
  const plan = productTasks(work, { sources, payload });
  if (!plan.length) {
    throw httpError('None of the work picked has a task to plan for this brand.', 422);
  }

  // A product gets onto the shelf (Growth); a category is won from rivals (Compete).
  const category = isCategory ? 'compete' : 'growth';
  const impact = 'medium';
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: {},
      dedup_key: dedupKey,
      ...(await priorityOnCreate({ kind, category, impact, payload })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two sends at once: the other one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') {
      const winner = await openAction();
      if (winner) {
        return { actionId: winner.id, actionNo: Number(winner.action_no), created: false };
      }
    }
    throw new Error(error.message);
  }

  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: action.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
      status: 'todo',
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: { source: 'shopping', target: payload.target, taskCount: plan.length },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
