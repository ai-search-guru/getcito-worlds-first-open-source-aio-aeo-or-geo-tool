/**
 * F05 — Fix Outdated Content.
 *
 * Signal: Audited pages failing freshness checks.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_outdated_content',
  code: 'F05',
  version: 1,
  category: 'fix',
  name: 'Fix Outdated Content',
  signalKinds: ['outdated_content'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'identify_target_pages',
    'analyze_ai_responses',
    'identify_content_gaps',
    'refresh_content',
    'publish_content',
    'validate_ai_visibility',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
