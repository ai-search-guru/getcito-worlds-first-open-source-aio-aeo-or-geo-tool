/**
 * G19 — Earn Third-Party Citations.
 *
 * Signal: Sources used when answers discuss the brand, which could reference
 * the brand’s own pages.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'earn_third_party_citations',
  code: 'G19',
  version: 1,
  category: 'growth',
  name: 'Earn Third-Party Citations',
  signalKinds: ['third_party_citation_gap'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_citations',
    'analyze_third_party_sources',
    'analyze_competitor_citations',
    'identify_target_sources',
    'identify_inclusion_path',
    'strengthen_reference_asset',
    'prepare_outreach',
    'execute_outreach',
    'track_third_party_status',
    'validate_third_party_citation',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'sources');
  },
};
