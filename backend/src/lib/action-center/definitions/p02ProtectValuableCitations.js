/**
 * P02 — Protect Valuable Citations.
 *
 * Signal: Citations thinning on prompts where they were steady.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_valuable_citations',
  code: 'P02',
  version: 1,
  category: 'protect',
  name: 'Protect Valuable Citations',
  signalKinds: ['citation_at_risk'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_citations',
    'identify_citation_gaps',
    'identify_target_pages',
    'refresh_content',
    'strengthen_reference_asset',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
