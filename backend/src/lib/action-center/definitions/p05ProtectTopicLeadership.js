/**
 * P05 — Protect Topic Leadership.
 *
 * Signal: Strong coverage of a topic beginning to decline.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'protect_topic_leadership',
  code: 'P05',
  version: 1,
  category: 'protect',
  name: 'Protect Topic Leadership',
  signalKinds: ['topic_slipping'],
  requires: ['tracking', 'topics'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_topic_gap',
    'analyze_competitor_visibility',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_topic_sov',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'topic_slipping');
    return { ...targetPayload(byKind, 'topics'), topicName: lead?.payload?.topicName };
  },
};
