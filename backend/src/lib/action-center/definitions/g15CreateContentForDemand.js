/**
 * G15 — Create Content for Uncovered Demand.
 *
 * Signal: High-demand prompts with no owned page that covers them.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'create_content_for_demand',
  code: 'G15',
  version: 1,
  category: 'growth',
  name: 'Create Content for Uncovered Demand',
  signalKinds: ['uncovered_demand'],
  requires: ['tracking', 'volumes'],
  optional: ['search_console'],
  enabled: true,
  tasks: [
    'cluster_prompts',
    'prioritize_targets',
    'identify_new_content_need',
    'create_content_brief',
    'create_content_draft',
    'strengthen_reference_asset',
    'add_internal_links',
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
