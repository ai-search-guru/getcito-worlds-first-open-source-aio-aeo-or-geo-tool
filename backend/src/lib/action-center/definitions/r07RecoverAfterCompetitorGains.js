/**
 * R07 — Recover After Competitor Gains.
 *
 * Signal: The brand losing ground as a competitor passes it.
 */

import { competitorNames, targetPayload } from './_helpers.js';

export default {
  id: 'recover_after_competitor_gains',
  code: 'R07',
  version: 1,
  category: 'recover',
  name: 'Recover After Competitor Gains',
  signalKinds: ['competitor_crossed'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_visibility_change',
    'analyze_competitor_visibility',
    'analyze_competitor_citations',
    'analyze_competitor_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return { ...targetPayload(byKind, 'competitors'), competitorNames: competitorNames(byKind) };
  },
};
