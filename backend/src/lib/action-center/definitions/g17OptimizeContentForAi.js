/**
 * G17 — Optimize Content for AI Visibility.
 *
 * Signal: A page exists for these prompts, and the brand is still not visible
 * on them.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'optimize_content_for_ai',
  code: 'G17',
  version: 1,
  category: 'growth',
  name: 'Optimize Content for AI Visibility',
  signalKinds: ['content_underperforming'],
  requires: ['tracking'],
  optional: ['search_console', 'analytics'],
  enabled: true,
  tasks: [
    'analyze_ai_responses',
    'analyze_prompt_gap',
    'analyze_citations',
    'analyze_gsc_demand',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'identify_content_gaps',
    'optimize_content',
    'add_internal_links',
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
