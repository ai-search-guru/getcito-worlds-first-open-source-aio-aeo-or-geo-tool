/**
 * Content opportunity generation processor.
 * Moves the LLM-based generation out of the HTTP request path.
 */

import logger from '../lib/logger.js';
import { generateContentOpportunities } from '../lib/opportunityGenerator.js';
import { refreshPromptClusters } from '../lib/promptClusters.js';

/**
 * The "+ New" button (CONTENT-003) runs the same per-cluster generation as
 * the nightly run. Clusters are refreshed first: a brand whose prompts changed since its
 * last tracking cycle, or that has never been clustered, would otherwise get
 * nothing or work from stale groups. The button adds to the existing list
 * (#63); a cluster that already has an opportunity is skipped.
 *
 * @param {{ brandId: string, model?: string, job: { progress: function }, request?: object | null }} opts
 */
export async function processContentJob({ brandId, model, job, request = null }) {
  // An alternative (CONTENT-006) is asked for one known cluster; regrouping
  // first could replace that cluster before it's read.
  if (!request?.alternativeOf) {
    job.progress({ phase: 'collecting_data', message: 'Grouping prompts into clusters...' });
    try {
      await refreshPromptClusters(brandId);
    } catch (err) {
      logger.error({ err, brandId }, 'prompt cluster refresh failed before generation');
    }
  }

  // A "+ New" request (CONTENT-003) carries its count, focus and idea, and
  // marks what it creates as manual; the nightly path passes none of it.
  const result = await generateContentOpportunities(brandId, {
    model,
    onProgress: (p) => job.progress(p),
    ...(request
      ? {
          count: request.count,
          topicId: request.topicId ?? null,
          promptId: request.promptId ?? null,
          idea: request.idea ?? null,
          alternativeOf: request.alternativeOf ?? null,
          explicit: !!request.explicit,
          pagePath: request.pagePath ?? null,
          // "+ New" and "Another angle" are manual; "Suggest content" from
          // the prompts table is tagged prompt.
          source: request.source === 'prompt' ? 'prompt' : 'manual',
        }
      : {}),
  });
  logger.info({ brandId, ...result }, 'content opportunities generated');
  return result;
}
