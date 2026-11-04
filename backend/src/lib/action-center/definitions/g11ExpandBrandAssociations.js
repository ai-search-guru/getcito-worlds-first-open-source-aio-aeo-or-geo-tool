/**
 * G11 — Expand Brand Associations.
 *
 * Signal: The brand is under-associated with strategic topics or attributes.
 *
 * Disabled. Needs association extraction from mention contexts, which the
 * product does not do yet. Registered so the slot exists; no detector feeds
 * it.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'expand_brand_associations',
  code: 'G11',
  version: 1,
  category: 'growth',
  name: 'Expand Brand Associations',
  signalKinds: ['brand_association_gap'],
  requires: ['tracking'],
  optional: [],
  enabled: false,
  disabledReason:
    'Needs association extraction from mention contexts, which the product does not do yet. Registered so the slot exists; no detector feeds it.',
  tasks: [
    'analyze_mention_context',
    'analyze_entity_signals',
    'identify_content_gaps',
    'map_prompts_to_content',
    'strengthen_entity_content',
    'optimize_content',
    'validate_mentions',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
