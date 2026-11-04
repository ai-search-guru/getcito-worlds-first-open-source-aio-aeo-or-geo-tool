/**
 * P01 — Protect High-Visibility Prompts.
 *
 * Signal: A real visibility position losing ground before it collapses.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'protect_visibility',
  code: 'P01',
  version: 2,
  category: 'protect',
  name: 'Protect High-Visibility Prompts',
  signalKinds: ['visibility_slipping'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_visibility_change',
    'analyze_ai_responses',
    'analyze_citations',
    'analyze_competitor_visibility',
    'identify_content_gaps',
    'optimize_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const slip = first(byKind, 'visibility_slipping');
    return {
      ...targetPayload(byKind, 'prompts'),
      dropFrom: slip?.previous_value,
      dropTo: slip?.current_value,
    };
  },
};
