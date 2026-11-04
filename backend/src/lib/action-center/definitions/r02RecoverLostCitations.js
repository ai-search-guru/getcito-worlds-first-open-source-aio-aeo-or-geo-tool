/**
 * R02 — Recover Lost Citations.
 *
 * Signal: Citations the brand held consistently, now gone.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_lost_citations',
  code: 'R02',
  version: 1,
  category: 'recover',
  name: 'Recover Lost Citations',
  signalKinds: ['lost_citations'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_citations',
    'identify_citation_gaps',
    'identify_target_pages',
    'strengthen_reference_asset',
    'refresh_content',
    'prepare_outreach',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
