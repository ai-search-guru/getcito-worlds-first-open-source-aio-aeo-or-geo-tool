/**
 * F12 — Improve High-Impression Low-CTR AI-Relevant Pages.
 *
 * Signal: Queries tied to tracked prompts earning far fewer clicks than their
 * position usually does.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'improve_low_ctr_pages',
  code: 'F12',
  version: 1,
  category: 'fix',
  name: 'Improve High-Impression Low-CTR AI-Relevant Pages',
  signalKinds: ['gsc_low_ctr'],
  requires: ['tracking', 'search_console'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_gsc_ctr',
    'analyze_gsc_demand',
    'map_queries_to_prompts',
    'identify_target_pages',
    'identify_content_gaps',
    'optimize_content',
    'publish_content',
    'validate_gsc',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
