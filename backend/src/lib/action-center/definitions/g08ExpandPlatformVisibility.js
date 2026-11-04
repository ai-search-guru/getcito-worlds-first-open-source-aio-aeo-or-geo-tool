/**
 * G08 — Expand Platform Visibility.
 *
 * Signal: Strong on some AI platforms, weak on others.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'expand_platform_visibility',
  code: 'G08',
  version: 2,
  category: 'growth',
  name: 'Expand Platform Visibility',
  signalKinds: ['platform_gap'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_platform_gap',
    'analyze_ai_responses',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_platform_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const gap = first(byKind, 'platform_gap');
    return {
      ...targetPayload(byKind, 'platforms'),
      platform: gap?.payload?.platform,
      bestPlatform: gap?.payload?.bestPlatform,
      dropFrom: gap?.previous_value,
      dropTo: gap?.current_value,
    };
  },
};
