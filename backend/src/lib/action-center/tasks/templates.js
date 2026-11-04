/**
 * How a library task is checked, and the page it is done on (AC-010):
 * written into its details when the task is planned, so a template's task
 * carries How we check as a written one does, and the exact page when it
 * changes a page and its action is about one. Its Done when is its
 * template's too, in the reader's language (web en.json
 * actionCenter.taskDoneWhen, by task key).
 *
 *  - `auto`: the page is fetched again (or a Site Audit runs), for a change
 *    made on the page;
 *  - `rerun`: the prompts are run again, for what AI answers say;
 *  - `manual`: the person confirms it, for work outside the page.
 *
 * Analysis GetCito does itself (analyze_, identify_, map_) has none: it
 * shows its findings, and the task writer drops it. A task measured from a
 * data window (GA4, Search Console) has Done when only: none of the three
 * checks fits it.
 */

/** How each task is checked, and whether it is done on the action's page. */
const TEMPLATES = Object.freeze({
  // Changes made on a page: a re-fetch, or a Site Audit, finds them.
  optimize_content: { check: 'auto', page: true },
  refresh_content: { check: 'auto', page: true },
  strengthen_reference_asset: { check: 'auto', page: true },
  strengthen_entity_content: { check: 'auto', page: true },
  // Its links go on other pages: the action's page is the one they point to.
  add_internal_links: { check: 'auto', page: false },
  publish_content: { check: 'auto', page: true },
  fix_crawler_access: { check: 'auto', page: true },
  fix_structured_data: { check: 'auto', page: true },
  fix_broken_target: { check: 'auto', page: true },
  fix_technical_issue: { check: 'auto', page: true },
  validate_technical_fix: { check: 'auto', page: true },
  // What AI answers say: the prompts run again.
  validate_ai_visibility: { check: 'rerun' },
  validate_mentions: { check: 'rerun' },
  validate_citations: { check: 'rerun' },
  validate_topic_sov: { check: 'rerun' },
  validate_platform_visibility: { check: 'rerun' },
  validate_country_visibility: { check: 'rerun' },
  validate_competitive_gap: { check: 'rerun' },
  validate_third_party_citation: { check: 'rerun' },
  measure_action_outcome: { check: 'rerun' },
  // A call to action rewritten: the person confirms it. A re-fetch can't
  // tell (#1565): a CTA band is often outside the page's content area, and
  // its words too few to read as the page changing.
  improve_cta_path: { check: 'manual', page: true },
  // Work outside the page: the person confirms it.
  create_content_brief: { check: 'manual' },
  create_content_draft: { check: 'manual' },
  prepare_outreach: { check: 'manual' },
  execute_outreach: { check: 'manual' },
  prepare_contribution: { check: 'manual' },
  track_third_party_status: { check: 'manual' },
  validate_third_party_presence: { check: 'manual' },
});

/** The task ids with a check, for the tests. */
export const TEMPLATED_TASKS = Object.freeze(Object.keys(TEMPLATES));

const PAGE_ADDRESS = /^(?:https?:\/\/\S+|\/\S*)$/i;
const isAddress = (value) => typeof value === 'string' && PAGE_ADDRESS.test(value);

/**
 * The one page an action is about, as its payload names it: its one page's
 * full URL when it keeps one (a sent action's, a traffic page's), else a page
 * target counted once (a full URL, or a path from the traffic signals; never
 * the whole site's sentinel, 'site'). Null for none or several, and for an
 * opportunity with a new page among its assets: its one existing page isn't
 * the new one's.
 */
export function onePage(payload = {}) {
  if (Array.isArray(payload.assets) && payload.assets.some((a) => a?.decision === 'create')) {
    return null;
  }
  const pages = Array.isArray(payload.pages) ? payload.pages.filter(Boolean) : [];
  if (pages.length === 1 && isAddress(pages[0])) return pages[0];
  if (pages.length > 1) return null;
  if (payload.targetEntity === 'pages' && Number(payload.targetCount) === 1) {
    const key = payload.targets?.[0]?.id ?? payload.targetIds?.[0];
    if (isAddress(key)) return key;
  }
  return null;
}

/**
 * A library task's details from its template: How we check, and for a
 * change on a page the action's one page. Marked `source: 'template'`: the
 * task writer reads a task with only these as untouched (isTouched), and an
 * edit in the drawer makes them the person's. Null without a template.
 */
export function templateDetails(taskKey, payload = {}) {
  const template = TEMPLATES[taskKey];
  if (!template) return null;
  const url = template.page ? onePage(payload) : null;
  return { check: template.check, ...(url ? { url } : {}), source: 'template' };
}
