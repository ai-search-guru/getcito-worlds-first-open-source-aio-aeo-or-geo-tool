/**
 * C08 — Earn Presence on Competitor-Winning Sources.
 *
 * Signal: Sources that competitors win across several prompts, with no brand
 * presence.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'earn_competitor_source_presence',
  code: 'C08',
  version: 1,
  category: 'compete',
  name: 'Earn Presence on Competitor-Winning Sources',
  signalKinds: ['competitor_winning_source'],
  requires: ['tracking', 'competitors'],
  optional: [],
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
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'sources');
  },
};
