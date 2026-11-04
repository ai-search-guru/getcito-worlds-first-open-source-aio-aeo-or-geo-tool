/**
 * R06 — Recover Platform Visibility.
 *
 * Signal: Visibility on one AI platform falling significantly.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'recover_platform_visibility',
  code: 'R06',
  version: 1,
  category: 'recover',
  name: 'Recover Platform Visibility',
  signalKinds: ['platform_drop'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_platform_gap',
    'analyze_ai_responses',
    'analyze_citations',
    'analyze_competitor_visibility',
    'identify_content_gaps',
    'optimize_content',
    'validate_platform_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'platform_drop');
    return { ...targetPayload(byKind, 'platforms'), platform: lead?.payload?.platform };
  },
};
