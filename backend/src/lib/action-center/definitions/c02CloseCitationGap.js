/**
 * C02 — Close Citation Gap.
 *
 * Signal: A competitor cited a multiple of the brand’s count.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { competitorNames, first, targetPayload } from './_helpers.js';

export default {
  id: 'close_citation_gap',
  code: 'C02',
  version: 2,
  category: 'compete',
  name: 'Close Citation Gap',
  signalKinds: ['competitor_citation_gap'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_citations',
    'analyze_competitor_citations',
    'identify_citation_gaps',
    'identify_target_sources',
    'strengthen_reference_asset',
    'prepare_outreach',
    'validate_citations',
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const gap = first(byKind, 'competitor_citation_gap');
    return {
      ...targetPayload(byKind, 'competitors'),
      competitorNames: competitorNames(byKind),
      citationCount: gap?.current_value,
      competitorCitations: gap?.payload?.competitorCitations,
    };
  },
};
