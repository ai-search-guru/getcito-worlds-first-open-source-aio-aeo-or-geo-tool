/**
 * G18 — Earn Third-Party Brand Presence.
 *
 * Signal: Sources AI answers cite where the brand never appears.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'earn_third_party_presence',
  code: 'G18',
  version: 1,
  category: 'growth',
  name: 'Earn Third-Party Brand Presence',
  signalKinds: ['third_party_presence_gap'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_third_party_sources',
    'analyze_competitor_content',
    'identify_target_sources',
    'identify_inclusion_path',
    'prepare_contribution',
    'prepare_outreach',
    'execute_outreach',
    'track_third_party_status',
    'validate_third_party_presence',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'sources');
  },
};
