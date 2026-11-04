import type { CategoryPage } from '@/lib/catalogClient';
import type { DraftStatus } from './drafts';
import { SCORE_WEIGHTS } from './plan';
import type { DraftShopping } from './shoppingCheck';
import { wordsOf } from './sources';
import { round } from '@/lib/priorityCore';

/**
 * Plan › Shopping opportunities (shopping path, part 7; the mockup's
 * "Content Plan · Shopping opportunities"): pages that lead readers, and AI
 * answers, to a shop's category pages and products. Only for a shop with a
 * catalog that has categories.
 *
 *  - A buying guide for a catalog category with products in stock that no
 *    page of the brand's guides shoppers to yet: no draft's shopping path
 *    holds it and no draft's title names it. A draft still being written
 *    for it makes the row its draft's, to open; a published one ends it.
 *  - A published post to fix: the last check after a catalog sync (00352)
 *    found it links a product that no longer sells, or not each of its
 *    path's category pages.
 *
 * Scored on the Plan's scale (SCORE_WEIGHTS, planPriorityLevel): a guide as
 * a new page, its opportunity the tracked prompts that ask about the
 * category and the products in stock; a post by how bad its links are.
 */

/** A category needs this many products in stock for a guide. */
export const MIN_IN_STOCK = 3;
/** The guides listed, the best first. */
export const MAX_GUIDES = 10;
/** Prompts about a category that count in full for its opportunity, and products in stock. */
const FULL_PROMPTS = 3;
const FULL_IN_STOCK = 20;
/** As the Plan's rows: a new page's severity, no page value known yet, no opportunity behind a fix. */
const NEW_PAGE_SEVERITY = 0.5;
const NEUTRAL_PAGE_VALUE = 0.5;
const NO_OPPORTUNITY = 0.4;
/** A post linking none of its category pages, and nothing worse. */
const UNLINKED_SEVERITY = 0.45;
/** Links to products that no longer sell that make it as bad as it gets. */
const FULL_BAD = 4;

/** A draft as the section reads it (lib/actions/shoppingPlan.ts). */
export interface ShoppingPlanDraft {
  id: string;
  title: string;
  status: DraftStatus;
  /** Its shopping path's categories, by name. */
  categories: string[];
  shopping: DraftShopping;
}

export interface ShoppingPlanPrompt {
  id: string;
  text: string;
}

export type ShoppingRow =
  | {
      kind: 'guide';
      key: string;
      category: CategoryPage;
      /** The category's own name: "Hiking Boots" of "Shoes > Hiking Boots". */
      leaf: string;
      /** Tracked prompts that ask about it, and the first of them, for the draft. */
      prompts: number;
      promptId: string | null;
      /** A draft being written for it. */
      draft: { id: string; title: string } | null;
      score: number;
    }
  | {
      kind: 'fix';
      key: string;
      draft: { id: string; title: string };
      /** Its path's first category, as the catalog counts it now (null when it's gone). */
      category: CategoryPage | null;
      categoryName: string | null;
      /** Linked products that no longer sell, and whether every one is sold out. */
      bad: number;
      soldOut: boolean;
      categories: number;
      categoriesLinked: number;
      score: number;
    };

/** A category's own name: the last step of "Shoes > Hiking Boots". */
export function categoryLeaf(name: string): string {
  const steps = name
    .split(/\s*[>›/|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return steps.at(-1) ?? name.trim();
}

/** Whether a text names a category: every word of its own name is in it. */
function names(textWords: Set<string>, leafWords: string[]): boolean {
  return leafWords.length > 0 && leafWords.every((w) => textWords.has(w));
}

const round1 = (n: number) => round(n, 1);

/** A new guide's score: a new page's, its opportunity the prompts asking and the products in stock. */
export function guideScore(prompts: number, inStock: number): number {
  const opportunity =
    0.5 * Math.min(1, prompts / FULL_PROMPTS) + 0.5 * Math.min(1, inStock / FULL_IN_STOCK);
  return round1(
    SCORE_WEIGHTS.severity * NEW_PAGE_SEVERITY +
      SCORE_WEIGHTS.opportunity * opportunity +
      SCORE_WEIGHTS.pageValue * NEUTRAL_PAGE_VALUE,
  );
}

/** A post's score: by the products it links that no longer sell, else the category pages it misses. */
export function fixScore(bad: number): number {
  const severity = bad > 0 ? 0.6 + 0.4 * Math.min(1, bad / FULL_BAD) : UNLINKED_SEVERITY;
  return round1(
    SCORE_WEIGHTS.severity * severity +
      SCORE_WEIGHTS.opportunity * NO_OPPORTUNITY +
      SCORE_WEIGHTS.pageValue * NEUTRAL_PAGE_VALUE,
  );
}

/** The section's rows, the highest score first. */
export function shoppingOpportunities({
  categories,
  drafts,
  prompts,
}: {
  categories: readonly CategoryPage[];
  drafts: readonly ShoppingPlanDraft[];
  prompts: readonly ShoppingPlanPrompt[];
}): ShoppingRow[] {
  const byName = new Map(categories.map((c) => [c.name, c]));
  const promptWords = prompts.map((p) => ({ id: p.id, words: new Set(wordsOf(p.text)) }));
  const draftWords = drafts.map((d) => ({ draft: d, words: new Set(wordsOf(d.title)) }));

  const guides: ShoppingRow[] = [];
  for (const category of categories) {
    if (category.inStock < MIN_IN_STOCK) continue;
    const leaf = categoryLeaf(category.name);
    const leafWords = [...new Set(wordsOf(leaf))];
    const covering = draftWords
      .filter(
        ({ draft, words }) => draft.categories.includes(category.name) || names(words, leafWords),
      )
      .map(({ draft }) => draft);
    // A published page already guides shoppers there: its links are the fix rows'.
    if (covering.some((d) => d.status === 'published')) continue;
    const asking = promptWords.filter((p) => names(p.words, leafWords));
    const draft = covering[0];
    guides.push({
      kind: 'guide',
      key: `guide:${category.name}`,
      category,
      leaf,
      prompts: asking.length,
      promptId: asking[0]?.id ?? null,
      draft: draft ? { id: draft.id, title: draft.title } : null,
      score: guideScore(asking.length, category.inStock),
    });
  }

  const fixes: ShoppingRow[] = [];
  for (const draft of drafts) {
    if (draft.status !== 'published') continue;
    const check = draft.shopping;
    if (check.state !== 'attention' && check.state !== 'ok') continue;
    const unlinked = check.categoriesLinked < check.categories;
    if (!check.bad.length && !unlinked) continue;
    const categoryName = draft.categories[0] ?? null;
    fixes.push({
      kind: 'fix',
      key: `fix:${draft.id}`,
      draft: { id: draft.id, title: draft.title },
      category: categoryName ? (byName.get(categoryName) ?? null) : null,
      categoryName,
      bad: check.bad.length,
      soldOut: check.bad.length > 0 && check.bad.every((b) => b.state === 'sold_out'),
      categories: check.categories,
      categoriesLinked: check.categoriesLinked,
      score: fixScore(check.bad.length),
    });
  }

  const byScore = (a: ShoppingRow, b: ShoppingRow) => b.score - a.score;
  return [...guides.sort(byScore).slice(0, MAX_GUIDES), ...fixes].sort(byScore);
}
