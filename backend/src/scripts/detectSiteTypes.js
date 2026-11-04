/**
 * Detects the kind of site for brands that have none yet (action plan by
 * business type, Step 0; 00379), as setup now does for a new brand: from
 * the brand's own home page, and one small model call only when the page
 * doesn't settle it. A brand with a type, chosen or detected, is never
 * touched; 00379 already made the brands in Shopping mode or with a catalog
 * shops. Only active brands of organizations with an active plan or trial
 * (any, self-hosted) are read.
 *
 * Writing a type changes what a brand that had none was guessed as (B2B for
 * most): its page types, and the editor's rules kept per site type, follow
 * the new one. Count with --dry-run first.
 *
 * Run from backend/:
 *   node src/scripts/detectSiteTypes.js [--limit 50] [--dry-run]
 *
 *   --limit    brands read this run (50; 500 at most), oldest first
 *   --dry-run  read the home pages and print what they settle, write nothing
 *              and ask no model (the rest are counted as needing it)
 *
 * Prints counts, and a failed brand's id with its error. A brand that
 * couldn't be placed is read again by the next run.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { isSubscriptionActive } from '../config/plans.js';
import { applySiteTypeDetection, detectSiteType } from '../lib/siteTypeDetect.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const limit = Number(option('--limit') ?? 50);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
  console.error('--limit takes a whole number from 1 to 500.');
  process.exit(1);
}
const dryRun = args.includes('--dry-run');

const { data: brands, error } = await supabaseAdmin
  .from('brands')
  .select('id, organization_id')
  .is('site_type', null)
  .eq('is_active', true)
  .order('created_at', { ascending: true })
  .limit(limit);
if (error) {
  console.error(`Couldn't read the brands: ${error.message}`);
  process.exit(1);
}

const orgIds = [...new Set((brands ?? []).map((b) => b.organization_id))];
const { data: orgs, error: orgError } = orgIds.length
  ? await supabaseAdmin.from('organizations').select('id, subscription_status').in('id', orgIds)
  : { data: [], error: null };
if (orgError) {
  console.error(`Couldn't read the organizations: ${orgError.message}`);
  process.exit(1);
}
const active = new Set(
  (orgs ?? []).filter((o) => isSubscriptionActive(o.subscription_status)).map((o) => o.id),
);

// A dry run settles from the page only: no model call, nothing written.
const pageOnly = (brand) => detectSiteType(brand, { classify: async () => null });

const counts = {
  b2b: 0,
  ecommerce: 0,
  b2c: 0,
  app: 0,
  page: 0,
  ai: 0,
  shopping_mode: 0,
  none: 0,
  skipped: 0,
  inactive: 0,
  failed: 0,
};
for (const { id, organization_id: orgId } of brands ?? []) {
  if (!active.has(orgId)) {
    counts.inactive += 1;
    continue;
  }
  try {
    const result = await applySiteTypeDetection(
      id,
      dryRun ? { write: false, detect: pageOnly } : {},
    );
    if (result.skipped) counts.skipped += 1;
    else if (!result.detected) counts.none += 1;
    else {
      counts[result.detected.siteType] += 1;
      counts[result.detected.via] += 1;
    }
  } catch (err) {
    counts.failed += 1;
    console.error(`Brand ${id}: ${err.message}`);
  }
}

console.log(
  `${dryRun ? 'Dry run: ' : ''}${brands?.length ?? 0} brands read. ` +
    `b2b ${counts.b2b}, ecommerce ${counts.ecommerce}, b2c ${counts.b2c}, app ${counts.app}; ` +
    `by page ${counts.page}, by model ${counts.ai}, by Shopping mode ${counts.shopping_mode}. ` +
    `${dryRun ? 'Would need the model' : 'Not told'} ${counts.none}, ` +
    `already typed ${counts.skipped}, plan inactive ${counts.inactive}, failed ${counts.failed}.`,
);
