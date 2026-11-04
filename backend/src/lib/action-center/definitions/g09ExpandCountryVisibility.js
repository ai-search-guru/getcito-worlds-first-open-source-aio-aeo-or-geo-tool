/**
 * G09 — Expand Country Visibility.
 *
 * Signal: Strong in one tracked country, weak in another.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'expand_country_visibility',
  code: 'G09',
  version: 1,
  category: 'growth',
  name: 'Expand Country Visibility',
  signalKinds: ['country_gap'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_country_gap',
    'analyze_prompt_gap',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'publish_content',
    'validate_country_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'country_gap');
    return { ...targetPayload(byKind, 'regions'), region: lead?.payload?.region };
  },
};
