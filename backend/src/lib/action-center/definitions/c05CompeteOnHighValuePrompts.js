/**
 * C05 — Compete on High-Value Prompts.
 *
 * Signal: A competitor present on high-demand prompts where the brand is
 * absent.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'compete_on_high_value_prompts',
  code: 'C05',
  version: 1,
  category: 'compete',
  name: 'Compete on High-Value Prompts',
  signalKinds: ['competitor_high_value_lead'],
  requires: ['tracking', 'competitors', 'volumes'],
  optional: [],
  enabled: true,
  tasks: [
    'prioritize_targets',
    'analyze_competitor_visibility',
    'analyze_ai_responses',
    'analyze_competitor_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
