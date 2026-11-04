/**
 * R10 — Recover Search Performance on AI-Relevant Pages.
 *
 * Signal: Search Console clicks falling on queries tied to tracked prompts.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_search_performance',
  code: 'R10',
  version: 1,
  category: 'recover',
  name: 'Recover Search Performance on AI-Relevant Pages',
  signalKinds: ['gsc_decline'],
  requires: ['tracking', 'search_console'],
  optional: ['site_audits'],
  enabled: true,
  tasks: [
    'analyze_gsc_demand',
    'analyze_gsc_ctr',
    'identify_target_pages',
    'map_queries_to_prompts',
    'analyze_visibility_change',
    'analyze_site_audit',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['fix_technical_issue']] },
    'validate_gsc',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
