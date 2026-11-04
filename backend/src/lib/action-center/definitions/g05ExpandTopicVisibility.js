/**
 * G05 — Expand Topic Visibility.
 *
 * Signal: Partial presence in a topic, with an uncovered prompt cluster.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'expand_topic_visibility',
  code: 'G05',
  version: 1,
  category: 'growth',
  name: 'Expand Topic Visibility',
  signalKinds: ['topic_gap'],
  requires: ['tracking', 'topics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_topic_gap',
    'cluster_prompts',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'publish_content',
    'validate_topic_sov',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'topic_gap');
    return { ...targetPayload(byKind, 'topics'), topicName: lead?.payload?.topicName };
  },
};
