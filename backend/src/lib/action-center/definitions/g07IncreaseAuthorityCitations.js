/**
 * G07 — Increase Authority Citations.
 *
 * Signal: High-traffic sources the brand rarely appears beside.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'increase_authority_citations',
  code: 'G07',
  version: 1,
  category: 'growth',
  name: 'Increase Authority Citations',
  signalKinds: ['authority_citation_gap'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_citations',
    'analyze_competitor_citations',
    'identify_citation_gaps',
    'identify_target_sources',
    'strengthen_reference_asset',
    'prepare_outreach',
    'execute_outreach',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'sources');
  },
};
