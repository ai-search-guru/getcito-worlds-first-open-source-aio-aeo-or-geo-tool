/**
 * R04 — Recover Lost Mentions.
 *
 * Signal: The brand disappearing from prompts where it was mentioned.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_lost_mentions',
  code: 'R04',
  version: 1,
  category: 'recover',
  name: 'Recover Lost Mentions',
  signalKinds: ['lost_mentions'],
  requires: ['tracking'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_mention_context',
    'analyze_ai_responses',
    'analyze_competitor_visibility',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['strengthen_entity_content'], ['optimize_content']] },
    'validate_mentions',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
