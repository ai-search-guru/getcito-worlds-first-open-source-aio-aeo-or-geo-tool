/**
 * C09 — Create Content to Close Competitor Gaps.
 *
 * Signal: A competitor leading a topic the brand has no content for.
 */

import { first, targetPayload } from './_helpers.js';

export default {
  id: 'create_content_for_competitor_gaps',
  code: 'C09',
  version: 1,
  category: 'compete',
  name: 'Create Content to Close Competitor Gaps',
  signalKinds: ['competitor_uncovered_topic'],
  requires: ['tracking', 'competitors', 'topics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_competitor_visibility',
    'analyze_competitor_content',
    'analyze_topic_gap',
    'cluster_prompts',
    'identify_new_content_need',
    'create_content_brief',
    'create_content_draft',
    'add_internal_links',
    'publish_content',
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const lead = first(byKind, 'competitor_uncovered_topic');
    return { ...targetPayload(byKind, 'topics'), topicName: lead?.payload?.topicName };
  },
};
