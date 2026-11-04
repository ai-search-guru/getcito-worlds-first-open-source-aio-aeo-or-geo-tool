/**
 * P06 — Protect High-Performing Content.
 *
 * Signal: Owned pages that were cited often, now cited less.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_high_performing_content',
  code: 'P06',
  version: 1,
  category: 'protect',
  name: 'Protect High-Performing Content',
  signalKinds: ['page_citation_slipping'],
  requires: ['tracking'],
  optional: ['site_audits'],
  enabled: true,
  tasks: [
    'identify_target_pages',
    'analyze_visibility_change',
    'analyze_citations',
    'analyze_site_audit',
    'identify_content_gaps',
    { branch: [['refresh_content'], ['optimize_content']] },
    'validate_ai_visibility',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
