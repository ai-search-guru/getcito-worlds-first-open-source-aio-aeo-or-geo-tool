/**
 * G14 — Scale Proven AI Landing Pages.
 *
 * Signal: AI-referred landing pages converting well above the site rate.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'scale_ai_landing_pages',
  code: 'G14',
  version: 2,
  category: 'growth',
  name: 'Scale Proven AI Landing Pages',
  signalKinds: ['ai_landing_page_winner'],
  requires: ['analytics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    // Learning C4: what its winning pages have that the brand's others don't.
    'analyze_winning_pages',
    'analyze_prompt_gap',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'add_internal_links',
    'validate_ai_traffic',
    'validate_ga4',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
