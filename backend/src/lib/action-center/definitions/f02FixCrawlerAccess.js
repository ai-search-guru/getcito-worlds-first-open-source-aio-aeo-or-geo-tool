/**
 * F02 — Fix AI Crawler Accessibility.
 *
 * Signal: Pages AI crawlers are blocked from, as Site Audit finds them, and
 * cited pages no AI search bot read in 30 days, as the brand's own
 * Cloudflare or Vercel reports it (AT-013, spec §3.8).
 *
 * Only tracking, which every brand has, is required: the second signal
 * needs no Site Audit, and the tasks that read the audit
 * (analyze_site_audit, validate_technical_fix) require it themselves, so the
 * planner leaves them out for a brand without one.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_crawler_access',
  code: 'F02',
  version: 1,
  category: 'fix',
  name: 'Fix AI Crawler Accessibility',
  signalKinds: ['crawler_blocked', 'cited_page_uncrawled'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_site_audit',
    'identify_target_pages',
    'fix_crawler_access',
    'validate_technical_fix',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
