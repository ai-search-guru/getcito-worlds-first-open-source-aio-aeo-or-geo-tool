/**
 * R08 — Recover Previously Cited Pages.
 *
 * Signal: Owned pages that were cited, now cited nowhere.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_cited_pages',
  code: 'R08',
  version: 1,
  category: 'recover',
  name: 'Recover Previously Cited Pages',
  signalKinds: ['owned_page_citation_lost'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_citations',
    'identify_target_pages',
    'identify_citation_gaps',
    'refresh_content',
    'strengthen_reference_asset',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
