/**
 * R01 — Recover Lost Visibility.
 *
 * Signal: A meaningful fall in AI visibility.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'recover_visibility',
  code: 'R01',
  version: 2,
  category: 'recover',
  name: 'Recover Lost Visibility',
  signalKinds: ['sharp_drop'],
  requires: ['tracking'],
  optional: ['analytics'],
  enabled: true,
  tasks: [
    'analyze_visibility_change',
    'analyze_ai_responses',
    'analyze_competitor_visibility',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const drop = first(byKind, 'sharp_drop');
    return {
      ...targetPayload(byKind, 'prompts'),
      dropFrom: drop?.previous_value,
      dropTo: drop?.current_value,
    };
  },
};
