/**
 * A stored answer's mentions, counted again by today's response parser: the
 * backfills that fix how answers were counted (backfillMentionCounts.js)
 * rewrite what it derives.
 *
 *   - mention_count, visibility_score, mention_position, mentioned_entity_count
 *   - mention_count, visibility_score and mention_position of each existing
 *     competitor_mentions entry whose competitor still exists
 *   - with `cleanMarkup`, the answer text itself without ChatGPT's
 *     `<Entity …/>` tags (entityMarkup.js), as new answers are saved
 *
 * Sentiment is not re-analysed: an answer that now counts as mentioning the
 * brand keeps the 'neutral' it was stored with, because re-running the model
 * over thousands of answers is a separate decision. One that no longer
 * mentions it is 'neutral', as an answer is saved (cloroResultHandler.js):
 * a brand named only in an entity tag's disambig had its sentiment read.
 */
import { stripEntityMarkup } from './entityMarkup.js';
import { parseResponse } from './responseParser.js';

/** The row's new values, or null when nothing changes. */
export function recountRow(row, brandInfo, competitors, { cleanMarkup = false } = {}) {
  const response = cleanMarkup ? stripEntityMarkup(row.response ?? '') : (row.response ?? '');
  const answer = { text: response, citations: Array.isArray(row.citations) ? row.citations : [] };
  let sentiment = row.sentiment ?? 'neutral';
  let metrics = parseResponse(answer, brandInfo, sentiment, competitors);
  if (metrics.mentionCount === 0 && sentiment !== 'neutral') {
    sentiment = 'neutral';
    metrics = parseResponse(answer, brandInfo, sentiment, competitors);
  }
  const fresh = new Map(metrics.competitorMentions.map((m) => [m.competitor_id, m]));
  const entries = Array.isArray(row.competitor_mentions) ? row.competitor_mentions : [];
  const competitorMentions = entries.map((entry) => {
    const m = fresh.get(entry.competitor_id);
    if (!m) return entry;
    return {
      ...entry,
      mention_count: m.mention_count,
      visibility_score: m.visibility_score,
      mention_position: m.mention_position,
    };
  });

  const next = {
    mention_count: metrics.mentionCount,
    visibility_score: metrics.visibilityScore,
    mention_position: metrics.mentionPosition,
    mentioned_entity_count: metrics.mentionedEntityCount,
    competitor_mentions: competitorMentions,
  };
  // Only a text the tags came out of, and a sentiment that moved, are written back.
  if (cleanMarkup && response !== (row.response ?? '')) next.response = response;
  if (sentiment !== (row.sentiment ?? 'neutral')) next.sentiment = sentiment;
  const unchanged =
    next.response === undefined &&
    next.sentiment === undefined &&
    next.mention_count === row.mention_count &&
    next.visibility_score === row.visibility_score &&
    next.mention_position === row.mention_position &&
    next.mentioned_entity_count === row.mentioned_entity_count &&
    JSON.stringify(competitorMentions) === JSON.stringify(entries);
  return unchanged ? null : next;
}
