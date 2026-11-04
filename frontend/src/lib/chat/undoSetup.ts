import { ORG_PLAN_COLUMNS, planFromOrgRow } from '@/lib/guards/planGuard';
import { activationDelta, getOrgLocationUsage, locationLimitMessage } from '@/lib/promptLocations';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { summaryValue } from './activity';
import { brandPromptSets, competitorWords, listWords, topicName } from './registry/targets';
import type { InverseResult, UndoRule, WriteRecord } from './undo';
import { DAY_MS, asObject, check, textOf, type Snapshot } from './undoParts';

/**
 * Undo for the brand's tracking setup (CHAT-20 §9 rows 20–32, §10b): the
 * prompts Chat added or paused, the topics it added or renamed, and the
 * competitors it added or removed. Each keeps what it changed and puts it
 * back only while it is as the change left it; anything changed since is the
 * person's to sort out by hand (`changed`). The inverses write with the
 * service role, as undo.ts's do, after Undo's own checks. Server only.
 */

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/** A brand's prompts among the ids, with what Undo checks and restores. */
async function readPrompts(brandId: string | null, promptIds: string[]) {
  if (promptIds.length === 0) return [];
  let read = supabaseAdmin
    .from('prompts')
    .select('id, text, is_active, regions')
    .in('id', promptIds);
  if (brandId) {
    const sets = await brandPromptSets(brandId);
    if (sets.length === 0) return [];
    read = read.in('prompt_set_id', sets);
  }
  const { data, error } = await read;
  check(error, 'the prompts');
  return (data ?? []) as {
    id: string;
    text: string;
    is_active: boolean;
    regions: string[] | null;
  }[];
}

/** Pauses the ones still active; how it went for the whole set. */
async function pauseStillActive(
  brandId: string | null,
  promptIds: string[],
): Promise<InverseResult> {
  const rows = await readPrompts(brandId, promptIds);
  if (rows.length === 0) return 'gone';
  const active = rows.filter((row) => row.is_active).map((row) => row.id);
  // Paused or deleted by someone since: nothing left that this change made active.
  if (active.length === 0) return 'changed';
  const { error } = await supabaseAdmin
    .from('prompts')
    .update({ is_active: false })
    .in('id', active)
    .eq('is_active', true);
  if (error) throw new Error(`Could not pause the prompts: ${error.message}`);
  return 'ok';
}

// ─── add_prompts: pause the prompts it added (§9: 7 days, "archive") ────────

const addPrompts: UndoRule = {
  targetType: 'topic',
  windowMs: 7 * DAY_MS,
  async before() {
    return null; // Nothing to read: the prompts are new.
  },
  async record(input, output): Promise<WriteRecord> {
    const { topic_id: topicId } = asObject(input);
    const result = asObject(output);
    const added = result.ok === true && Array.isArray(result.added) ? result.added : [];
    const addedIds = ids(added.map((item) => asObject(item).id));
    const texts = added.map((item) => textOf(asObject(item).text)).filter(Boolean) as string[];
    const topic = typeof topicId === 'string' ? await topicName(topicId).catch(() => null) : null;
    return {
      target: { type: 'topic', id: textOf(topicId) },
      summaryParams: {
        topic: summaryValue(topic),
        prompts: summaryValue(listWords(texts)),
      },
      undo: addedIds.length > 0 ? { after: { ids: addedIds } } : null,
    };
  },
  inverse: ({ brandId, data }) => pauseStillActive(brandId, ids(asObject(data.after).ids)),
  href: (id) => `/dashboard/prompts/topics/${id}`,
};

// ─── pause_prompts: resume the ones it paused (§9: 30 days, history kept) ────

const pausePrompts: UndoRule = {
  targetType: 'prompt',
  windowMs: 30 * DAY_MS,
  async before(input) {
    const { brand_id: brandId, prompt_ids: promptIds } = asObject(input);
    const rows = await readPrompts(textOf(brandId), ids(promptIds));
    // Only what was active is this change's to bring back.
    const active = rows.filter((row) => row.is_active);
    return { active: active.map((row) => ({ id: row.id, text: row.text })) as unknown as Json };
  },
  async record(_input, output, before): Promise<WriteRecord> {
    const result = asObject(output);
    const paused = new Set(result.ok === true ? ids(result.paused) : []);
    const wasActive = (Array.isArray(before?.active) ? before.active : [])
      .map((row) => asObject(row))
      .filter((row) => typeof row.id === 'string' && paused.has(row.id as string));
    const first = wasActive[0];
    return {
      target: { type: 'prompt', id: first ? (first.id as string) : null },
      summaryParams: {
        prompts: summaryValue(listWords(wasActive.map((row) => textOf(row.text) ?? ''))),
      },
      undo: first ? { before: { ids: wasActive.map((row) => row.id as string) } } : null,
    };
  },
  async inverse({ brandId, data }) {
    const rows = await readPrompts(brandId, ids(asObject(data.before).ids));
    if (rows.length === 0) return 'gone';
    const paused = rows.filter((row) => !row.is_active);
    // Resumed by someone since: nothing left to bring back.
    if (paused.length === 0) return 'changed';
    // Resuming is metered like adding (setPromptActive): the plan's room may be gone since.
    if (brandId) {
      const { data: brand, error } = await supabaseAdmin
        .from('brands')
        .select('organization_id')
        .eq('id', brandId)
        .maybeSingle();
      check(error, 'the brand');
      const orgId = brand?.organization_id as string | undefined;
      if (!orgId) return 'gone';
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select(ORG_PLAN_COLUMNS)
        .eq('id', orgId)
        .maybeSingle();
      check(orgError, 'the plan');
      if (!org) return 'gone';
      const usage = await getOrgLocationUsage(supabaseAdmin, orgId);
      const adding = activationDelta(
        paused.map((row) => ({ isActive: false, regions: row.regions })),
      );
      const full = locationLimitMessage(planFromOrgRow(org), usage.total, adding);
      if (full) return { refused: 'quota_exceeded', message: full };
    }
    const { error } = await supabaseAdmin
      .from('prompts')
      .update({ is_active: true })
      .in(
        'id',
        paused.map((row) => row.id),
      )
      .eq('is_active', false);
    if (error) throw new Error(`Could not resume the prompts: ${error.message}`);
    return 'ok';
  },
  href: () => '/dashboard/prompts',
};

// ─── add_topic: take the topic away while nothing uses it (§9: 7 days) ──────

async function readTopic(id: string, brandId: string | null) {
  let read = supabaseAdmin.from('topics').select('id, name, is_active').eq('id', id);
  if (brandId) read = read.eq('brand_id', brandId);
  const { data, error } = await read.maybeSingle();
  check(error, 'the topic');
  return data as { id: string; name: string; is_active: boolean | null } | null;
}

const addTopic: UndoRule = {
  targetType: 'topic',
  windowMs: 7 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const result = asObject(output);
    const topic = result.ok === true ? asObject(result.topic) : {};
    const id = textOf(topic.id);
    return {
      target: { type: 'topic', id },
      summaryParams: { name: summaryValue(topic.name ?? asObject(input).name) },
      undo: id ? { after: { name: textOf(topic.name) } } : null,
    };
  },
  async inverse({ id, brandId, data }) {
    const topic = await readTopic(id, brandId);
    if (!topic) return 'gone';
    if (topic.is_active === false || topic.name !== asObject(data.after).name) return 'changed';
    // Prompts tracked in it since: taking it away would leave them without their topic.
    // Paused ones don't hold it (an Undo of add_prompts pauses what it added).
    const { count, error } = await supabaseAdmin
      .from('prompts')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', id)
      .eq('is_active', true);
    check(error, "the topic's prompts");
    if ((count ?? 0) > 0) return 'changed';
    const { data: removed, error: deleteError } = await supabaseAdmin
      .from('topics')
      .delete()
      .eq('id', id)
      .eq('name', topic.name)
      .select('id');
    if (deleteError) throw new Error(`Could not remove the topic: ${deleteError.message}`);
    return (removed ?? []).length > 0 ? 'ok' : 'changed';
  },
  href: (id) => `/dashboard/prompts/topics/${id}`,
};

// ─── rename_topic: its name before (§9: 7 days) ─────────────────────────────

const renameTopic: UndoRule = {
  targetType: 'topic',
  windowMs: 7 * DAY_MS,
  async before(input) {
    const id = textOf(asObject(input).topic_id);
    const topic = id ? await readTopic(id, null) : null;
    return topic ? { name: topic.name } : null;
  },
  async record(input, output, before): Promise<WriteRecord> {
    const result = asObject(output);
    const after = result.ok === true ? textOf(asObject(result.topic).name) : null;
    const from = textOf(before?.name);
    return {
      target: { type: 'topic', id: textOf(asObject(input).topic_id) },
      summaryParams: { from: summaryValue(from), to: summaryValue(after) },
      undo:
        from && after && from !== after ? { before: { name: from }, after: { name: after } } : null,
    };
  },
  async inverse({ id, brandId, data }) {
    const topic = await readTopic(id, brandId);
    if (!topic) return 'gone';
    const after = asObject(data.after).name;
    if (topic.name !== after) return 'changed';
    const { data: restored, error } = await supabaseAdmin
      .from('topics')
      .update({ name: asObject(data.before).name })
      .eq('id', id)
      .eq('name', after as string)
      .select('id');
    if (error) throw new Error(`Could not rename the topic back: ${error.message}`);
    return (restored ?? []).length > 0 ? 'ok' : 'changed';
  },
  href: (id) => `/dashboard/prompts/topics/${id}`,
};

// ─── add_competitors: remove the ones it added (§9: 7 days) ─────────────────

type CompetitorSnapshot = { id: string; name: string; domain: string };

const asCompetitors = (value: unknown): CompetitorSnapshot[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => asObject(item))
    .filter((item) => typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      domain: textOf(item.domain) ?? '',
    }));

const addCompetitors: UndoRule = {
  targetType: 'competitor',
  windowMs: 7 * DAY_MS,
  async before() {
    return null;
  },
  async record(_input, output): Promise<WriteRecord> {
    const result = asObject(output);
    const added = asCompetitors(result.ok === true ? result.added : []);
    return {
      target: { type: 'competitor', id: added[0]?.id ?? null },
      summaryParams: { competitors: summaryValue(listWords(added.map(competitorWords))) },
      undo: added.length > 0 ? { after: { added: added as unknown as Json } } : null,
    };
  },
  async inverse({ brandId, data }) {
    const added = asCompetitors(asObject(data.after).added);
    let read = supabaseAdmin
      .from('competitors')
      .select('id, name, domain')
      .in(
        'id',
        added.map((c) => c.id),
      );
    if (brandId) read = read.eq('brand_id', brandId);
    const { data: rows, error } = await read;
    check(error, 'the competitors');
    if ((rows ?? []).length === 0) return 'gone';
    // Renamed or moved to another domain since: the person's now.
    const same = (rows ?? []).filter((row) =>
      added.some((c) => c.id === row.id && c.name === row.name && c.domain === row.domain),
    );
    if (same.length === 0) return 'changed';
    const { error: deleteError } = await supabaseAdmin
      .from('competitors')
      .delete()
      .in(
        'id',
        same.map((row) => row.id as string),
      );
    if (deleteError) throw new Error(`Could not remove the competitors: ${deleteError.message}`);
    return 'ok';
  },
  href: () => '/dashboard/competitors',
};

// ─── remove_competitor: bring it back as it was (§9: 7 days) ────────────────

const removeCompetitor: UndoRule = {
  targetType: 'competitor',
  windowMs: 7 * DAY_MS,
  async before(input) {
    const { brand_id: brandId, competitor_id: id } = asObject(input);
    if (typeof id !== 'string' || typeof brandId !== 'string') return null;
    const { data, error } = await supabaseAdmin
      .from('competitors')
      .select('id, brand_id, name, domain, created_at')
      .eq('id', id)
      .eq('brand_id', brandId)
      .maybeSingle();
    check(error, 'the competitor');
    return (data as Snapshot | null) ?? null;
  },
  async record(input, output, before): Promise<WriteRecord> {
    const removed = asObject(output).ok === true && before;
    return {
      target: { type: 'competitor', id: textOf(asObject(input).competitor_id) },
      summaryParams: {
        competitor: summaryValue(
          before
            ? competitorWords({ name: String(before.name), domain: textOf(before.domain) })
            : '',
        ),
      },
      undo: removed ? { before } : null,
    };
  },
  async inverse({ id, brandId, data }) {
    const row = asObject(data.before);
    const brand = brandId ?? textOf(row.brand_id);
    if (!brand) return 'gone';
    // Added again since (by hand, or the same domain or, without one, the same name): the person's now.
    const { data: now, error } = await supabaseAdmin
      .from('competitors')
      .select('id, name, domain')
      .eq('brand_id', brand);
    check(error, "the brand's competitors");
    const key = competitorKey({ name: textOf(row.name) ?? '', domain: textOf(row.domain) ?? '' });
    if (
      (now ?? []).some(
        (c) =>
          c.id === id ||
          competitorKey({ name: c.name as string, domain: (c.domain as string) ?? '' }) === key,
      )
    ) {
      return 'changed';
    }
    const { error: insertError } = await supabaseAdmin.from('competitors').insert({
      id,
      brand_id: brand,
      name: textOf(row.name) ?? '',
      domain: textOf(row.domain) ?? '',
      ...(textOf(row.created_at) ? { created_at: textOf(row.created_at)! } : {}),
    });
    if (insertError) throw new Error(`Could not bring the competitor back: ${insertError.message}`);
    await reopenActionLinks(brand, id, textOf(row.name));
    return 'ok';
  },
  href: () => '/dashboard/competitors',
};

/**
 * The brand's actions' links to the competitor, marked deleted as it went
 * (00244), open again. Its page events and timeline scans went with it and
 * don't come back. A failure here leaves the competitor back, links closed.
 */
async function reopenActionLinks(brandId: string, id: string, name: string | null) {
  try {
    const { data: actions, error } = await supabaseAdmin
      .from('actions')
      .select('id')
      .eq('brand_id', brandId);
    check(error, "the brand's actions");
    const actionIds = (actions ?? []).map((a) => a.id as string);
    if (actionIds.length === 0) return;
    const { error: reopenError } = await supabaseAdmin
      .from('action_entities')
      .update({ removed_at: null, removed_reason: null })
      .in('action_id', actionIds)
      .eq('entity_type', 'competitors')
      .eq('removed_reason', 'deleted')
      .in('entity_key', name ? [id, name] : [id]);
    if (reopenError) throw new Error(reopenError.message);
  } catch (err) {
    console.error('[chat/undo] could not open the competitor’s action links again:', err);
  }
}

/** A competitor as two are compared: its domain (scheme, www, case, slash aside), else its name. */
function competitorKey(c: { name: string; domain: string }): string {
  const domain = c.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
  return domain ? `d:${domain}` : `n:${c.name.trim().toLowerCase()}`;
}

/** The setup rows' Undo, by tool name (undo.ts UNDO_RULES). */
export const SETUP_UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  add_prompts: addPrompts,
  pause_prompts: pausePrompts,
  add_topic: addTopic,
  rename_topic: renameTopic,
  add_competitors: addCompetitors,
  remove_competitor: removeCompetitor,
};
