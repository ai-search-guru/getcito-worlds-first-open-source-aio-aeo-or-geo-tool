/**
 * One-off manual test for the AI Traffic weekly digest (AT-013).
 *
 *   node src/scripts/testTrafficDigest.js <brandId> [out.html]
 *
 * Reads the brand's last whole week and writes the e-mail it would get to
 * out.html (default traffic-digest.html) without sending or recording it.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import supabaseAdmin from '../config/supabase.js';
import { digestWeek } from '../lib/traffic-digest/summary.js';
import { digestContent, readDigestData } from '../lib/traffic-digest/engine.js';
import { renderTrafficDigestEmail } from '../lib/traffic-digest/email.js';

const [brandId, out = 'traffic-digest.html'] = process.argv.slice(2);
if (!brandId) {
  console.error('Usage: node src/scripts/testTrafficDigest.js <brandId> [out.html]');
  process.exit(1);
}

const { data: brand } = await supabaseAdmin
  .from('brands')
  .select('name')
  .eq('id', brandId)
  .single();
const week = digestWeek(new Date());
const content = digestContent(await readDigestData(brandId, week), week);
const { subject, html } = renderTrafficDigestEmail({
  brandName: brand?.name ?? brandId,
  week,
  ...content,
  trafficUrl: 'http://localhost:3000/dashboard/traffic',
  settingsUrl: 'http://localhost:3000/dashboard/settings?tab=notifications',
});
writeFileSync(out, html);
console.log(JSON.stringify({ week, subject, ...content }, null, 2));
process.exit(0);
