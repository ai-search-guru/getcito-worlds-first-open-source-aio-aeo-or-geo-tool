/**
 * Registry of implemented signal evaluators. Each category file exports its
 * own array; new signals are added there and surface here automatically.
 *
 * Faz 1 implements the 34 deterministic signals (Structure 13, Trust 7,
 * Authority 7, Content 4, E-E-A-T 3) of the 48-signal rubric. The remaining 14
 * need a target query, an LLM judge, or an external lookup (Wikidata / press)
 * and land in later phases. The scorer reports coverage (evaluated / total) so
 * partial implementation never penalizes a page for signals we haven't built.
 */

import { structureSignals } from './structure.js';
import { authoritySignals } from './authority.js';
import { contentSignals } from './content.js';
import { trustSignals } from './trust.js';
import { eeatSignals } from './eeat.js';

export const signalRegistry = [
  ...structureSignals,
  ...authoritySignals,
  ...contentSignals,
  ...trustSignals,
  ...eeatSignals,
];
