/**
 * R05 — Recover Topic Visibility.
 *
 * Signal: Coverage of a topic falling significantly.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'recover_topic_visibility',
  code: 'R05',
  version: 1,
  category: 'recover',
  name: 'Recover Topic Visibility',
  signalKinds: ['topic_drop'],
  requires: ['tracking', 'topics'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_topic_gap',
    'analyze_competitor_visibility',
    'analyze_citations',
    'cluster_prompts',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_topic_sov',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'topic_drop');
    return { ...targetPayload(byKind, 'topics'), topicName: lead?.payload?.topicName };
  },
};
