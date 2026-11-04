/**
 * F06 — Fix Weak Entity Signals.
 *
 * Signal: Audited pages failing brand-entity and entity-coverage checks.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_entity_signals',
  code: 'F06',
  version: 1,
  category: 'fix',
  name: 'Fix Weak Entity Signals',
  signalKinds: ['weak_entity'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_entity_signals',
    'identify_target_pages',
    'strengthen_entity_content',
    'fix_structured_data',
    'validate_technical_fix',
    'validate_mentions',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
