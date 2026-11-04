/**
 * ECOM-018: what a done Products action did, 7 days on. An action sent from
 * Product Visibility (a product to get on the AI shelf, a category to win)
 * names the shopping questions it's measured on; once someone completes it,
 * the shelves of those questions in the 7 days after are set beside the 7
 * days before: how many the product (or, for a category, any product of the
 * category) was on. Read from the cards already kept, when the page opens:
 * no job, nothing stored.
 */

export const RECHECK_DAYS = 7;
/** Targets re-checked in one read at most. */
export const RECHECK_TARGETS = 500;
const DAY_MS = 86_400_000;

/** A card as the re-check reads it: its shelf (question × channel), when, and the catalog product it shows. */
export interface RecheckCard {
  promptId: string;
  platform: string;
  at: string;
  productId: string | null;
}

/** A done action from Products, as the re-check reads it. */
export interface RecheckAction {
  id: string;
  actionNo: number;
  target: { type: 'product' | 'category'; id: string };
  completedAt: string;
  /** The shopping questions it's measured on. */
  promptIds: string[];
  /** A category's products: one of them on a shelf counts. */
  products?: readonly string[];
}

/** Shelves read in a window, and how many the brand was on. */
export interface ShelfPresence {
  shelves: number;
  on: number;
}

export interface ActionResult {
  actionId: string;
  actionNo: number;
  completedAt: string;
  /** When the 7 days after end: the result shows from then. */
  readyAt: string;
  before: ShelfPresence;
  /** Null until the 7 days after have passed. */
  after: ShelfPresence | null;
  /**
   * True when its questions had more answers than a read takes: the oldest
   * weren't read, so the two weeks aren't compared.
   */
  partial?: boolean;
}

/**
 * The action's shelves read in [from, to), and how many had its product on
 * them: the product, or for a category one of its products, not any of the
 * brand's.
 */
export function shelfPresence(
  cards: readonly RecheckCard[],
  action: Pick<RecheckAction, 'target' | 'promptIds' | 'products'>,
  from: number,
  to: number,
): ShelfPresence {
  const prompts = new Set(action.promptIds);
  const products = new Set(
    action.target.type === 'product' ? [action.target.id] : (action.products ?? []),
  );
  const shelves = new Map<string, boolean>();
  for (const card of cards) {
    const at = Date.parse(card.at);
    if (!(at >= from && at < to) || !prompts.has(card.promptId)) continue;
    const key = `${card.promptId}:${card.platform}`;
    const ours = card.productId !== null && products.has(card.productId);
    shelves.set(key, (shelves.get(key) ?? false) || ours);
  }
  return { shelves: shelves.size, on: [...shelves.values()].filter(Boolean).length };
}

/** The action's result: the week before it was done beside the week after, once that has passed. */
export function actionResult(
  action: RecheckAction,
  cards: readonly RecheckCard[],
  now: number = Date.now(),
): ActionResult {
  const done = Date.parse(action.completedAt);
  const ready = done + RECHECK_DAYS * DAY_MS;
  return {
    actionId: action.id,
    actionNo: action.actionNo,
    completedAt: action.completedAt,
    readyAt: new Date(ready).toISOString(),
    before: shelfPresence(cards, action, done - RECHECK_DAYS * DAY_MS, done),
    after: now >= ready ? shelfPresence(cards, action, done, ready) : null,
  };
}

/**
 * Which way it went: the share of shelves it was on, after beside before;
 * 'new' when no shelf was read in the week before, so nothing to compare.
 * Null while the week after runs, when no answer was read in it, or when
 * not every answer could be read (partial): a week missing in the read
 * would read as 'new' or 'better'.
 */
export function resultTrend(result: ActionResult): 'better' | 'worse' | 'same' | 'new' | null {
  const { before, after } = result;
  if (result.partial || !after?.shelves) return null;
  if (!before.shelves) return 'new';
  const share = (p: ShelfPresence) => (p.shelves ? p.on / p.shelves : 0);
  const change = share(after) - share(before);
  return change > 0 ? 'better' : change < 0 ? 'worse' : 'same';
}

/** A target's key in the results: "product:<id>" or "category:<id>". */
export const resultKey = (target: RecheckAction['target']) => `${target.type}:${target.id}`;
