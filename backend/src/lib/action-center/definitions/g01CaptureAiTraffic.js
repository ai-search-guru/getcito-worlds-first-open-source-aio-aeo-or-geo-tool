/**
 * G01 — Capture AI Traffic.
 *
 * Signal: High AI visibility or citations, but AI referral traffic below
 * potential.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'capture_ai_traffic',
  code: 'G01',
  version: 2,
  category: 'growth',
  name: 'Capture AI Traffic',
  signalKinds: ['page_opportunity'],
  requires: ['analytics'],
  optional: ['site_audits'],
  enabled: true,
  tasks: [
    'identify_target_pages',
    'analyze_ai_traffic',
    'analyze_citations',
    'analyze_prompt_gap',
    'identify_content_gaps',
    'optimize_content',
    'improve_cta_path',
    'validate_ai_traffic',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const base = targetPayload(byKind, 'pages');
    return { ...base, pageCount: base.targetCount };
  },
};
