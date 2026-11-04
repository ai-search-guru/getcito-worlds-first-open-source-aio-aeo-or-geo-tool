/**
 * C07 — Respond to Competitor Momentum.
 *
 * Signal: A competitor’s mentions growing fast.
 */

import { competitorNames, targetPayload } from './_helpers.js';

export default {
  id: 'respond_to_competitor_momentum',
  code: 'C07',
  version: 1,
  category: 'compete',
  name: 'Respond to Competitor Momentum',
  signalKinds: ['competitor_momentum'],
  requires: ['tracking', 'competitors'],
  optional: ['search_console', 'analytics'],
  enabled: true,
  tasks: [
    'analyze_competitor_visibility',
    'analyze_competitor_citations',
    'analyze_competitor_content',
    'analyze_gsc_demand',
    'analyze_ga4_outcomes',
    'prioritize_targets',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return { ...targetPayload(byKind, 'competitors'), competitorNames: competitorNames(byKind) };
  },
};
