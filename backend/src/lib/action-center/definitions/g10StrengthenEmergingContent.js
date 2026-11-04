/**
 * G10 — Strengthen Emerging Content.
 *
 * Signal: Visibility improving on prompts, but not yet at its potential.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'strengthen_emerging_content',
  code: 'G10',
  version: 2,
  category: 'growth',
  name: 'Strengthen Emerging Content',
  signalKinds: ['prompt_gain'],
  requires: ['tracking'],
  optional: ['analytics', 'search_console'],
  enabled: true,
  tasks: [
    'identify_target_pages',
    'analyze_visibility_change',
    'analyze_citations',
    // Learning C4: what its winning pages have that the brand's others don't.
    'analyze_winning_pages',
    'identify_content_gaps',
    'optimize_content',
    'add_internal_links',
    'publish_content',
    'validate_ai_visibility',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
