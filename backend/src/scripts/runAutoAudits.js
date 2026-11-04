/**
 * Run the auto-audit sweep now (SA-006), as the daily job does after the
 * Google Analytics sync: every organization whose run is due audits its
 * share of the quota. A run is claimed once per org, billing period and run
 * day, so running this twice on one day starts nothing the second time.
 *
 * Run: `node src/scripts/runAutoAudits.js`
 *
 * Options via env:
 *   - AUTO_AUDIT_ORG   limit the sweep to one organization id
 *   - AUTO_AUDIT_NOW   take this time (ISO) as now, to try another run day
 *
 * Waits for the runs' audits to finish before it exits.
 */

import 'dotenv/config';
import { readOpportunityInbox, startAutoAudits } from '../routes/audits.js';
import { sweepAutoAudits } from '../lib/audit/autoAuditSweep.js';

const ONLY_ORG = process.env.AUTO_AUDIT_ORG || null;
const NOW = process.env.AUTO_AUDIT_NOW ? new Date(process.env.AUTO_AUDIT_NOW) : new Date();

if (Number.isNaN(NOW.getTime())) {
  console.error(`AUTO_AUDIT_NOW isn't a date: ${process.env.AUTO_AUDIT_NOW}`);
  process.exit(1);
}

const { runs } = await sweepAutoAudits({
  readInbox: readOpportunityInbox,
  startAudits: startAutoAudits,
  now: NOW,
  orgIds: ONLY_ORG ? [ONLY_ORG] : undefined,
});
console.log(`Auto-audit: ${runs} run(s) done.`);
process.exit(0);
