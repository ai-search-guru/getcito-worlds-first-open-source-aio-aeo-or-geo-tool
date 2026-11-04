import { CMS_NAMES } from '@/lib/content/cmsNames';
import type { CmsTarget } from '@/lib/content/cmsSendClient';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from './activity';
import { draftTitle, listWords } from './registry/targets';
import type { UndoRule, WriteRecord } from './undo';
import { DAY_MS, asObject, check, textOf } from './undoParts';

/**
 * What Chat's output rows record, and Undo where §9 gives one: a report it
 * made goes from Reports (30 days); a page it sent to a CMS and audits it
 * started have no Undo (window 0): the CMS keeps its draft item, and an
 * audit's results stay with its quota used. Their rows record what they did
 * all the same, and the card says it can't be undone. Server only.
 */

/** No Undo (§9): the row records the change, Undo finds nothing to put back. */
const NO_UNDO = {
  windowMs: 0,
  async before() {
    return null;
  },
  async inverse() {
    return 'gone' as const;
  },
};

// ─── build_report: take it out of Reports (§9: 30 days) ─────────────────────

const buildReport: UndoRule = {
  targetType: 'report',
  windowMs: 30 * DAY_MS,
  async before() {
    return null;
  },
  async record(_input, output): Promise<WriteRecord> {
    const id = textOf(asObject(output).id);
    let title: string | null = null;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('reports')
        .select('title')
        .eq('id', id)
        .maybeSingle();
      check(error, 'the report');
      title = (data?.title as string | undefined) ?? null;
    }
    return {
      target: { type: 'report', id },
      summaryParams: { title: summaryValue(title) },
      undo: id ? { after: { id } } : null,
    };
  },
  async inverse({ id, brandId }) {
    let remove = supabaseAdmin.from('reports').delete().eq('id', id);
    if (brandId) remove = remove.eq('brand_id', brandId);
    const { data, error } = await remove.select('id');
    if (error) throw new Error(`Could not remove the report: ${error.message}`);
    return (data ?? []).length > 0 ? 'ok' : 'gone';
  },
  href: () => '/dashboard/reports',
};

// ─── push_cms_draft: recorded, no Undo (the CMS keeps its draft item) ───────

/** A CMS as the app names it ("Webflow"), never its key. */
const cmsName = (key: string | null) =>
  key && Object.hasOwn(CMS_NAMES, key) ? CMS_NAMES[key as CmsTarget] : null;

const pushCmsDraft: UndoRule = {
  ...NO_UNDO,
  targetType: 'content_draft',
  async record(input, output): Promise<WriteRecord> {
    const { draft_id: id, destination } = asObject(input);
    const title = typeof id === 'string' ? await draftTitle(id).catch(() => null) : null;
    return {
      target: { type: 'content_draft', id: textOf(id) },
      summaryParams: {
        title: summaryValue(title),
        cms: summaryValue(cmsName(textOf(asObject(output).target) ?? textOf(destination))),
      },
      undo: null,
    };
  },
  href: (id) => `/dashboard/content/editor/${id}`,
};

// ─── run_site_audit: recorded, no Undo (results stay, quota used) ───────────

const runSiteAudit: UndoRule = {
  ...NO_UNDO,
  targetType: 'site_audit',
  async record(input, output): Promise<WriteRecord> {
    const audits = asObject(output).audits;
    const first = Array.isArray(audits) ? textOf(asObject(audits[0]).id) : null;
    const urls = asObject(input).urls;
    return {
      target: { type: 'site_audit', id: first },
      summaryParams: {
        pages: summaryValue(listWords(Array.isArray(urls) ? (urls as string[]) : [])),
      },
      undo: null,
    };
  },
  href: () => '/dashboard/audit',
};

/** The output rows' records and Undo, by tool name (undo.ts UNDO_RULES). */
export const OUTPUT_UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  build_report: buildReport,
  push_cms_draft: pushCmsDraft,
  // A page put live (AUTONOMOUS-GO-LIVE PR 9): recorded the same way; Take down is its own click.
  publish_cms: pushCmsDraft,
  // A page taken down (PR 10): recorded the same way, its CMS from the output; publish it again to undo.
  unpublish_cms: pushCmsDraft,
  run_site_audit: runSiteAudit,
};
