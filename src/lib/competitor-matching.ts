// Core competitor matching logic for brand analytics
import fuzzysort from 'fuzzysort';

export interface Competitor {
  name: string;
  domain?: string;
  aliases?: string[];
}

export interface MatchResult {
  competitor: Competitor;
  matchType: 'name' | 'domain' | 'alias' | 'fuzzy';
  matchedValue: string;
  score?: number;
}

/**
 * Normalize a string for comparison (lowercase, trim, remove www)
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/^www\./, '').trim();
}

/**
 * Attempt to match competitors in a given text (query)
 * @param text The text to search for competitor mentions
 * @param competitors List of competitors
 * @param fuzzyThreshold Fuzzysort score threshold (lower is better)
 */
export function matchCompetitorsInText(
  text: string,
  competitors: Competitor[],
  fuzzyThreshold = -50
): MatchResult[] {
  const results: MatchResult[] = [];
  const normalizedText = normalize(text);

  for (const competitor of competitors) {
    // Direct name match
    if (normalizedText.includes(normalize(competitor.name))) {
      results.push({
        competitor,
        matchType: 'name',
        matchedValue: competitor.name,
      });
      continue;
    }
    // Domain match
    if (competitor.domain && normalizedText.includes(normalize(competitor.domain))) {
      results.push({
        competitor,
        matchType: 'domain',
        matchedValue: competitor.domain,
      });
      continue;
    }
    // Alias match
    if (competitor.aliases) {
      for (const alias of competitor.aliases) {
        if (normalizedText.includes(normalize(alias))) {
          results.push({
            competitor,
            matchType: 'alias',
            matchedValue: alias,
          });
          break;
        }
      }
    }
    // Fuzzy match (name and aliases)
    const candidates = [competitor.name, ...(competitor.aliases || [])];
    const fuzzy = fuzzysort.go(normalizedText, candidates, { threshold: fuzzyThreshold });
    if (fuzzy.total > 0) {
      for (const res of fuzzy) {
        results.push({
          competitor,
          matchType: 'fuzzy',
          matchedValue: res.target,
          score: res.score,
        });
      }
    }
  }
  return results;
}

// --- Example usage/test cases ---
if (require.main === module) {
  const competitors: Competitor[] = [
    { name: 'OpenAI', domain: 'openai.com', aliases: ['Open AI', 'OpenAI Inc.'] },
    { name: 'Anthropic', domain: 'anthropic.com', aliases: ['Claude', 'Anthropic AI'] },
    { name: 'Google', domain: 'google.com', aliases: ['Google AI', 'Alphabet'] },
  ];
  const queries = [
    'I prefer OpenAI for LLMs',
    'Claude is a great product by Anthropic',
    'I use openai.com and google.com for research',
    'Alphabet is the parent of Google',
    'I like Open AI and Anthropic AI',
    'OpeanAI is cool', // typo for fuzzy
  ];
  for (const q of queries) {
    const matches = matchCompetitorsInText(q, competitors);
    console.log(`Query: ${q}`);
    for (const m of matches) {
      console.log(`  Matched: ${m.competitor.name} via ${m.matchType} (${m.matchedValue})${m.score !== undefined ? ' [score: ' + m.score + ']' : ''}`);
    }
  }
} 