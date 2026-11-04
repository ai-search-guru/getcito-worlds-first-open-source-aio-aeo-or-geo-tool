/**
 * F10 — Fix Internal Content Connectivity.
 *
 * Signal: Audited pages failing the internal-linking check.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_internal_connectivity',
  code: 'F10',
  version: 1,
  category: 'fix',
  name: 'Fix Internal Content Connectivity',
  signalKinds: ['weak_internal_links'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_internal_links',
    'identify_target_pages',
    'prioritize_targets',
    'add_internal_links',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
