/**
 * F08 — Fix Brand Information Inconsistency.
 *
 * Signal: Stored AI answers contradicting each other on brand attributes.
 *
 * Disabled. Needs deterministic attribute extraction from stored answers,
 * which does not exist yet; the specification rules out an LLM judging what is
 * true. Registered; no detector feeds it.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_brand_inconsistency',
  code: 'F08',
  version: 1,
  category: 'fix',
  name: 'Fix Brand Information Inconsistency',
  signalKinds: ['brand_inconsistency'],
  requires: ['tracking'],
  optional: [],
  enabled: false,
  disabledReason:
    'Needs deterministic attribute extraction from stored answers, which does not exist yet; the specification rules out an LLM judging what is true. Registered; no detector feeds it.',
  tasks: [
    'analyze_mention_context',
    'analyze_entity_signals',
    'identify_target_pages',
    'strengthen_entity_content',
    'optimize_content',
    'publish_content',
    'validate_mentions',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
