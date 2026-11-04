import supabaseAdmin from '../../config/supabase.js';

/**
 * The issues a platform reports per item of a catalog source (#1270,
 * 00296), Google Merchant Center's today: a sync replaces the source's
 * rows with what it read. They feed the "Feed fields complete" check and
 * the readiness cards later; the Settings row counts them now.
 */

/** Rows written per insert. */
export const ISSUE_BATCH = 500;

/**
 * Replaces a source's issues and counts them: the items with at least one,
 * and the issues per severity.
 *
 * @param {{ id: string, brand_id: string }} source
 * @param {{ externalId: string, code: string, severity: string, attribute: string|null,
 *   reportingContext: string|null, description: string|null, detail: string|null,
 *   documentation: string|null, resolution: string|null, countries: string[] }[]} issues
 * @returns {Promise<{ items: number, disapproved: number, demoted: number, not_impacted: number }>}
 */
export async function saveItemIssues(
  source,
  issues,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const { error: cleared } = await db
    .from('catalog_item_issues')
    .delete()
    .eq('source_id', source.id);
  if (cleared) throw new Error(`catalog_item_issues delete: ${cleared.message}`);
  const createdAt = now.toISOString();
  const rows = issues.map((issue) => ({
    brand_id: source.brand_id,
    source_id: source.id,
    external_id: issue.externalId,
    code: issue.code,
    severity: issue.severity,
    attribute: issue.attribute,
    reporting_context: issue.reportingContext,
    description: issue.description,
    detail: issue.detail,
    documentation: issue.documentation,
    resolution: issue.resolution,
    countries: issue.countries,
    created_at: createdAt,
  }));
  for (let i = 0; i < rows.length; i += ISSUE_BATCH) {
    const { error } = await db.from('catalog_item_issues').insert(rows.slice(i, i + ISSUE_BATCH));
    if (error) throw new Error(`catalog_item_issues insert: ${error.message}`);
  }
  const counts = { items: 0, disapproved: 0, demoted: 0, not_impacted: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  counts.items = new Set(issues.map((issue) => issue.externalId)).size;
  return counts;
}
