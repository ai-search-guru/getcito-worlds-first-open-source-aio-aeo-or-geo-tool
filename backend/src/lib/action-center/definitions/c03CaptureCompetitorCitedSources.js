/**
 * C03 — Capture Competitor-Cited Sources.
 *
 * Signal: Sources cited where competitors appear and the brand does not.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'capture_competitor_cited_sources',
  code: 'C03',
  version: 1,
  category: 'compete',
  name: 'Capture Competitor-Cited Sources',
  signalKinds: ['competitor_cited_source'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_competitor_citations',
    'analyze_third_party_sources',
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
