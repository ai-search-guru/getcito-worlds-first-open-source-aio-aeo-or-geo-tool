/**
 * The search intent of the demo's fan-out searches (demo-site), written
 * ahead into the shared cache Query Fan-out reads (fanout_query_intents,
 * #333), so its intent badges never wait on a model for the demo.
 *
 * The cache is keyed by the search itself, as routes/prompts.js keeps it
 * (normalizeIntentQuery), not by brand: a search's intent is the same for
 * every brand. A row already there is left as it is (ignoreDuplicates), so
 * the demo never overwrites a classification a live brand's read made, and
 * it is never cleared with the demo brand.
 */

import supabaseAdmin from '../../config/supabase.js';
import { normalizeIntentQuery } from '../intentExtraction.js';
import { PROMPTS } from './brewline.js';

/** Each search the demo's answers ran (brewline.js PROMPTS[].searches), by intent. */
export const FANOUT_INTENTS = {
  'best coffee subscription 2026': 'best-top',
  'coffee subscription reviews': 'vs-review',
  'fresh roasted coffee subscription': 'recommendation',
  'coffee subscription pause anytime': 'recommendation',
  'flexible coffee delivery plan': 'recommendation',
  'coffee subscription gift ideas': 'recommendation',
  'prepaid coffee subscription gift': 'recommendation',
  'is a coffee subscription worth it': 'vs-review',
  'coffee subscription cost per cup': 'what-is',
  'best espresso beans for home': 'best-top',
  'whole bean espresso roast': 'recommendation',
  'buy fresh roasted coffee beans online': 'recommendation',
  'coffee roaster ships same day': 'recommendation',
  'low acid coffee beans': 'recommendation',
  'coffee for sensitive stomach': 'problem-solving',
  'single origin vs blend coffee': 'comparison',
  'best single origin coffee beans': 'best-top',
  'organic fair trade coffee roasters': 'recommendation',
  'direct trade coffee beans': 'what-is',
  'best tasting decaf coffee beans': 'best-top',
  'water process decaf coffee': 'what-is',
  'how long do coffee beans stay fresh': 'what-is',
  'coffee roast date explained': 'what-is',
  'brewline coffee vs northbound roasters': 'vs-review',
  'northbound roasters subscription review': 'vs-review',
};

/** The cache rows: one per distinct search the demo's prompts list. */
export function fanoutIntentRows() {
  const searches = [...new Set(PROMPTS.flatMap((p) => p.searches ?? []).map(normalizeIntentQuery))];
  return searches.map((query) => {
    const intent = FANOUT_INTENTS[query];
    if (!intent) throw new Error(`demo fan-out search without an intent: ${query}`);
    return { query, intent };
  });
}

/**
 * The fan-out intent module: no brand-scoped table of its own (the cache is
 * shared, and kept across rebuilds), only rows added where missing.
 */
export const fanoutIntents = {
  name: 'fanout-intents',
  tables: [],

  /** @param {{ db?: object }} ctx */
  async build({ db = supabaseAdmin } = {}) {
    const rows = fanoutIntentRows();
    const { error } = await db
      .from('fanout_query_intents')
      .upsert(rows, { onConflict: 'query', ignoreDuplicates: true });
    if (error) throw new Error(`demo fanout_query_intents write: ${error.message}`);
    return { intents: rows.length };
  },
};
