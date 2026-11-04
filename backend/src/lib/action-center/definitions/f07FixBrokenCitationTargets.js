/**
 * F07 — Fix Broken Citation Targets.
 *
 * Signal: Owned URLs AI answers cite that are unavailable.
 *
 * Detected from the AI visitors themselves (AT-012, AT-013): a page an AI
 * answer sent someone to that answered 404 or 410, as the tracking snippet
 * reports it. Each target carries the working page to redirect it to.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_broken_citation_targets',
  code: 'F07',
  version: 1,
  category: 'fix',
  name: 'Fix Broken Citation Targets',
  signalKinds: ['broken_citation_target'],
  requires: ['ai_traffic'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_citations',
    'identify_target_pages',
    'fix_broken_target',
    'validate_technical_fix',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
