/**
 * G02 — Convert Mentions into Citations.
 *
 * Signal: The brand appears in AI answers but its own domain is not cited.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { targetKeys } from '../../targetIds.js';
import { first, targetPayload } from './_helpers.js';

export default {
  id: 'convert_mentions',
  code: 'G02',
  version: 2,
  category: 'growth',
  name: 'Convert Mentions into Citations',
  signalKinds: ['uncited_mentions'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_mention_context',
    'analyze_citations',
    'identify_citation_gaps',
    'map_prompts_to_content',
    'strengthen_reference_asset',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const mentions = first(byKind, 'uncited_mentions');
    const promptCount = Number(mentions?.current_value ?? 0);
    // The uncited prompts themselves are the targets (AC-009): the count is
    // their list's, which the action keeps.
    const ids = targetKeys(
      Array.isArray(mentions?.payload?.promptIds) ? mentions.payload.promptIds : [],
    );
    if (ids.length > 0) {
      return {
        ...targetPayload(byKind, 'prompts'),
        targetIds: ids,
        targetCount: ids.length,
        promptCount,
      };
    }
    return { ...targetPayload(byKind, 'prompts'), targetCount: promptCount, promptCount };
  },
};
