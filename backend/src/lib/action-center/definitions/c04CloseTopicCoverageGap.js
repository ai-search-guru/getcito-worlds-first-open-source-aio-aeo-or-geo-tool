/**
 * C04 — Close Topic Coverage Gap.
 *
 * Signal: A competitor holding a topic the brand has pages for but no presence
 * in.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'close_topic_coverage_gap',
  code: 'C04',
  version: 1,
  category: 'compete',
  name: 'Close Topic Coverage Gap',
  signalKinds: ['competitor_topic_lead'],
  requires: ['tracking', 'competitors', 'topics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_topic_gap',
    'analyze_competitor_visibility',
    'analyze_competitor_content',
    'cluster_prompts',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_topic_sov',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'competitor_topic_lead');
    return { ...targetPayload(byKind, 'topics'), topicName: lead?.payload?.topicName };
  },
};
