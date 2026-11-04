/**
 * P07 — Protect Platform Visibility.
 *
 * Signal: Visibility on one AI platform beginning to decline.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'protect_platform_visibility',
  code: 'P07',
  version: 1,
  category: 'protect',
  name: 'Protect Platform Visibility',
  signalKinds: ['platform_slipping'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_platform_gap',
    'analyze_ai_responses',
    'analyze_citations',
    'identify_content_gaps',
    'optimize_content',
    'validate_platform_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'platform_slipping');
    return { ...targetPayload(byKind, 'platforms'), platform: lead?.payload?.platform };
  },
};
