/**
 * C01 — Close Visibility Gap.
 *
 * Signal: A competitor mentioned well more often than the brand.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { competitorNames, targetPayload } from './_helpers.js';

export default {
  id: 'close_competitor_gap',
  code: 'C01',
  version: 2,
  category: 'compete',
  name: 'Close Visibility Gap',
  signalKinds: ['competitor_leads'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_competitor_visibility',
    'analyze_ai_responses',
    'analyze_competitor_content',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return { ...targetPayload(byKind, 'competitors'), competitorNames: competitorNames(byKind) };
  },
};
