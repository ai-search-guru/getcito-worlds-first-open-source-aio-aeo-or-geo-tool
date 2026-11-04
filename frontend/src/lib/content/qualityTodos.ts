import type { ContentAuthor } from './authors';
import { MAX_PROOF_TODOS, type PageProof, type ProofKind } from './pageRead';
import {
  authorProfile,
  scoreGain,
  sentenceGain,
  type EeatCheckId,
  type Score,
  type TrustCheckId,
  type TrustRead,
  squeeze,
} from './qualityChecks';

/**
 * Your to-dos (Content Editor Quality spec §4, CE-040): what only the person
 * can do for the page, read from the check results (nothing entered by
 * hand). Everything else is a suggestion the agent can fix. Phase 1's are
 * the placeholders the agent left where it had no real name, quote or
 * number (CE-044), and the author's: the Content Agent can't add, pick or
 * edit authors. Phase 2 adds what only the person can give (Brief › Your
 * input, CE-048): their experience, their data and an expert's quote; and
 * the brand's facts read from its site, to approve (CE-047).
 */

export type QualityTodoId =
  | 'placeholders'
  | 'byline'
  | 'authorProfile'
  | 'experience'
  | 'originalData'
  | 'visualProof'
  | 'whoHowWhy'
  | 'expertQuote'
  | 'proof'
  | 'reviewer'
  | 'brandFacts'
  | 'shippingReturns'
  | 'checkDate'
  | 'introFacts';

/**
 * A to-do's one button: Show (the first placeholder, selected to type over),
 * the header's author menu, Settings › Authors, Brief › Your input, or
 * Brand settings › Brand facts.
 */
export type QualityTodoAction =
  | 'showPlaceholder'
  | 'pickAuthor'
  | 'addAuthor'
  | 'editAuthor'
  | 'addInput'
  | 'addProof'
  | 'confirmImage'
  | 'addImage'
  | 'pickReviewer'
  | 'reviewBrandFacts'
  | 'addCheckDate'
  | 'confirmCase'
  | 'confirmIntro';

export interface QualityTodo {
  id: QualityTodoId;
  done: boolean;
  /** What its score gains once it is done; 0 when done, or when no score counts it. */
  gain: number;
  /** The score it raises: E-E-A-T, or Trust for an expert's quote. */
  score: 'eeat' | 'trust';
  /** None while it waits on the one before it. */
  action: QualityTodoAction | null;
  /** Given in Brief › Your input, though the page doesn't use it yet (CE-048). */
  given?: boolean;
  /** Its own key when it has more than one row (each proof's). */
  key?: string;
  /** The claim a proof to-do asks proof for (CE-049). */
  proof?: { claim: string; block: string; kind: ProofKind; sentence: string };
  /** How many it is about (placeholders, brand facts to approve). */
  count?: number;
  /** What a regulated page advises on: its reviewer's field (CE-049). */
  topic?: 'health' | 'finance' | 'legal';
  /**
   * With no author picked: the person's own word for the author their site
   * names (00271), a tick box beside the to-do, and whether it's ticked.
   */
  confirm?: { what: 'real' | 'profile'; on: boolean };
  /**
   * A customer case's Trust share while it isn't linked (CE-052): its
   * sentence is an unsourced claim until it is, confirmed or not.
   */
  trustGain?: number;
  /** A category intro's sentences with a fact not confirmed yet (CE-054). */
  facts?: string[];
  /** A check date the page has, over a year old: Add line's own line (it replaces it), or the person's words. */
  old?: 'line' | 'text';
}

/**
 * The page's to-dos, in the order to do them: fill the placeholders (an
 * export never ships one), pick its author (or add one when the workspace
 * has none), then complete their profile, listed from the start so the
 * count holds. Done ones stay on the list, checked; placeholders are listed
 * once the page has had some (`had`, this session), the brand facts to
 * approve likewise, last (Phase 2: the brand's, worth no points of the
 * page's). The proof of the page's own claims comes after the person's
 * input (Phase 2, CE-049). The author's wait for E-E-A-T to be read.
 */
export function qualityTodos({
  eeat,
  author,
  hasAuthors,
  placeholders = { count: 0, had: false },
  canEdit = false,
  used = null,
  given = null,
  trust = null,
  brandFacts = null,
  proofs = null,
  visual = null,
  reviewer = null,
  confirmed = null,
  shipping = null,
  checkDate = null,
  cases = null,
  intro = null,
  off = NONE_OFF,
}: {
  eeat: Score<EeatCheckId> | null;
  author: ContentAuthor | null;
  hasAuthors: boolean;
  placeholders?: { count: number; had: boolean };
  /**
   * Whether the member may edit the page's author (whoever added them, the
   * author themself or an admin): only they get Edit author; anyone else is
   * told who can.
   */
  canEdit?: boolean;
  /** Phase 2 (CE-048): what the page uses of Brief › Your input; left out before. */
  used?: { experience: boolean; data: boolean; quote: boolean } | null;
  /** What the person gave there (inputsGiven), used or not. */
  given?: { experience: boolean; data: boolean; quote: boolean } | null;
  /** Trust, for an expert quote's gain and a proof's (its unsourced sentences). */
  trust?: (Score<TrustCheckId> & Partial<Pick<TrustRead, 'unsourced' | 'figures'>>) | null;
  /**
   * Phase 2 (CE-047): the brand's facts read from its site that no one has
   * approved or rejected yet, and whether there were some this session.
   */
  brandFacts?: { pending: number; had: boolean } | null;
  /**
   * Phase 2 (CE-049): the page's own claims that need the brand's proof, as
   * the page is now (proofsOnPage), and the keys of the ones asked for this
   * session: done ones stay listed, checked.
   */
  proofs?: { asks: readonly PageProof[]; had: ReadonlySet<string> } | null;
  /**
   * Phase 2 (CE-049): the page's images, how many are confirmed the
   * person's own, and the visual proof spots open (as eeat takes them).
   */
  visual?: { images: number; own: number; openSpots: number } | null;
  /**
   * Phase 2 (CE-049): a page that advises consumers on health, finance or
   * law (the page read's `regulated`) asks for a qualified reviewer, from
   * Authors; null otherwise.
   */
  reviewer?: { topic: 'health' | 'finance' | 'legal'; picked: boolean } | null;
  /** What the person confirmed of the author their site names (00271), or null where they can't. */
  confirmed?: { real: boolean; profile: boolean } | null;
  /**
   * Phase 3 (CE-052): whether a product page says how shipping and returns
   * work (Trust's read): only the person knows them.
   */
  shipping?: { shipping: boolean; returns: boolean } | null;
  /**
   * Phase 3 (CE-052): whether a comparison shows when it was last checked,
   * and the line Add line puts in (null for a language without one).
   */
  checkDate?: { found: boolean; old?: 'line' | 'text' | null; line: string | null } | null;
  /**
   * Phase 3 (CE-052): the customer cases the person confirmed may be
   * published, by their proof to-do's key: a case's to-do is that confirm,
   * not a link (only the person knows they may name the customer). Null
   * before Phase 3, or before they're read.
   */
  cases?: ReadonlySet<string> | null;
  /**
   * Phase 3 (CE-054): a category page's intro facts (introFacts) and the
   * facts the person confirmed (confirmedFacts); null elsewhere, or before
   * the confirms are read.
   */
  intro?: {
    facts: readonly { sentence: string; facts: readonly string[] }[];
    confirmed: ReadonlySet<string>;
  } | null;
  /**
   * Phase 3 (CE-052): the checks the page's type leaves out (checksOff): no
   * to-do asks for them (a product page has the brand's byline, no author).
   */
  off?: ReadonlySet<string>;
}): QualityTodo[] {
  const fill: QualityTodo[] =
    placeholders.count || placeholders.had
      ? [
          {
            id: 'placeholders',
            done: placeholders.count === 0,
            gain: 0,
            score: 'eeat',
            action: 'showPlaceholder',
            count: placeholders.count,
          },
        ]
      : [];
  // The brand's, not the page's, and worth no points itself: last.
  const facts: QualityTodo[] =
    brandFacts && (brandFacts.pending || brandFacts.had)
      ? [
          {
            id: 'brandFacts',
            done: brandFacts.pending === 0,
            gain: 0,
            score: 'trust',
            action: 'reviewBrandFacts',
            count: brandFacts.pending,
          },
        ]
      : [];
  // The page's own claims, in its order: open while its paragraph has no
  // link, checked once it has; MAX_PROOF_TODOS open at once.
  let open = 0;
  // A customer case's share of E-E-A-T's customer cases, each confirm alike.
  const caseAsks = cases ? (proofs?.asks ?? []).filter((a) => a.kind === 'customer_case') : [];
  const unconfirmed = caseAsks.filter((a) => !caseConfirmed(cases!, a)).length;
  const caseGain =
    eeat && eeat.score !== null && unconfirmed > 0
      ? Math.round(scoreGain(eeat, ['customerCase']) / unconfirmed)
      : 0;
  const proofTodos: QualityTodo[] = (proofs?.asks ?? []).flatMap((ask) => {
    const confirm = !!cases && ask.kind === 'customer_case';
    const key = confirm ? caseKey(ask) : proofKey(ask);
    const done = confirm ? caseConfirmed(cases!, ask) : ask.linked;
    // Linking the published case still raises Trust: said beside the confirm.
    const linkGain = confirm && !ask.linked ? sentenceGain(trust, ask.sentence) : 0;
    if (done && !proofs?.had.has(key)) return [];
    if (!done && (open += 1) > MAX_PROOF_TODOS) return [];
    return [
      {
        id: 'proof',
        key,
        done,
        gain: done ? 0 : confirm ? caseGain : sentenceGain(trust, ask.sentence),
        score: confirm ? 'eeat' : 'trust',
        action: confirm ? 'confirmCase' : 'addProof',
        proof: { claim: ask.claim, block: ask.block, kind: ask.kind, sentence: ask.sentence },
        ...(linkGain > 0 ? { trustGain: linkGain } : {}),
      } satisfies QualityTodo,
    ];
  });
  const ships: QualityTodo[] = shipping
    ? [
        {
          id: 'shippingReturns',
          done: shipping.shipping && shipping.returns,
          gain:
            trust && trust.score !== null && !(shipping.shipping && shipping.returns)
              ? scoreGain(trust, ['shippingReturns'])
              : 0,
          score: 'trust',
          action: null,
        },
      ]
    : [];
  // Only the person knows the category's counts and prices are right: one
  // confirm for them all. A sentence is open while a fact in it is.
  const unconfirmedFacts = intro
    ? intro.facts.filter((fact) => fact.facts.some((f) => !intro.confirmed.has(f)))
    : [];
  const introTodo: QualityTodo[] =
    intro && intro.facts.length
      ? [
          {
            id: 'introFacts',
            done: unconfirmedFacts.length === 0,
            gain:
              unconfirmedFacts.length && trust && trust.score !== null
                ? scoreGain(trust, ['introFacts'])
                : 0,
            score: 'trust',
            action: unconfirmedFacts.length ? 'confirmIntro' : null,
            count: unconfirmedFacts.length,
            facts: unconfirmedFacts.map((fact) => fact.sentence),
          },
        ]
      : [];
  const review: QualityTodo[] = reviewer
    ? [
        {
          id: 'reviewer',
          done: reviewer.picked,
          gain: 0,
          score: 'eeat',
          action: reviewer.picked ? null : hasAuthors ? 'pickReviewer' : 'addAuthor',
          topic: reviewer.topic,
        },
      ]
    : [];
  if (!eeat || eeat.score === null) {
    return [...fill, ...proofTodos, ...ships, ...introTodo, ...review, ...facts].filter(
      (todo) => !off.has(todo.id),
    );
  }
  // No author picked: the one the site names may be confirmed instead, the
  // profile once the author is.
  const byConfirm = !author && !!confirmed;
  const byline: QualityTodo = {
    id: 'byline',
    done: !!author || (byConfirm && confirmed.real),
    gain: scoreGain(eeat, ['byline']),
    score: 'eeat',
    action: author || hasAuthors ? 'pickAuthor' : 'addAuthor',
    ...(byConfirm ? { confirm: { what: 'real' as const, on: confirmed.real } } : {}),
  };
  const { bio, links } = authorProfile(author);
  const wanted = (todo: QualityTodo) => !off.has(CHECK_OF[todo.id] ?? todo.id);
  const todos: QualityTodo[] = [
    ...fill,
    byline,
    {
      id: 'authorProfile',
      done: (!!author && bio && links) || (byConfirm && confirmed.real && confirmed.profile),
      gain: scoreGain(eeat, ['authorBio']),
      score: 'eeat',
      action: author && canEdit ? 'editAuthor' : null,
      ...(byConfirm && confirmed.real
        ? { confirm: { what: 'profile' as const, on: confirmed.profile } }
        : {}),
    },
    ...(used
      ? ([
          {
            id: 'experience',
            done: used.experience,
            given: !used.experience && !!given?.experience,
            gain: scoreGain(eeat, ['experience']),
            score: 'eeat',
            action: 'addInput',
          },
          {
            id: 'originalData',
            done: used.data,
            given: !used.data && !!given?.data,
            gain: scoreGain(eeat, ['originalData']),
            score: 'eeat',
            action: 'addInput',
          },
        ] satisfies QualityTodo[])
      : []),
    // Not Your input's (read from the page): listed in their place when
    // that can't be read too.
    ...visualTodo(eeat, visual),
    ...howTodo(eeat),
    ...(checkDate
      ? [
          {
            id: 'checkDate',
            done: checkDate.found,
            gain: scoreGain(eeat, ['checkDate']),
            score: 'eeat',
            // Only the person knows when they checked: Add line says this month's.
            action: checkDate.found || !checkDate.line ? null : 'addCheckDate',
            ...(!checkDate.found && checkDate.old ? { old: checkDate.old } : {}),
          } satisfies QualityTodo,
        ]
      : []),
    ...(used
      ? ([
          {
            id: 'expertQuote',
            done: used.quote,
            given: !used.quote && !!given?.quote,
            gain:
              !used.quote && trust && trust.score !== null ? scoreGain(trust, ['expertQuote']) : 0,
            score: 'trust',
            action: 'addInput',
          },
        ] satisfies QualityTodo[])
      : []),
    ...proofTodos,
    ...ships,
    ...introTodo,
    ...review,
    ...facts,
  ];
  return todos.filter(wanted);
}

const NONE_OFF: ReadonlySet<string> = new Set();
/** The check each to-do raises, where its id isn't the check's. */
const CHECK_OF: Partial<Record<string, string>> = { authorProfile: 'authorBio' };

/** A text's 32-bit FNV-1a hash, in base 36: a short, stable name for it. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A proof to-do's key: its claim in its block, both by their words without
 * spaces, the block by a short hash (the nudge keeps the keys it showed). A
 * link put on the claim adds a space at its edge, and the API's next answer
 * carries the claim and its block as the page has them then: the key stays.
 */
export const proofKey = (ask: { claim: string; block: string }) =>
  `proof:${squeeze(ask.claim)}:${shortHash(squeeze(ask.block))}`;

/**
 * A customer case's confirmation key (CE-052, 00280): its claim alone, by
 * its words without spaces, so a typo fixed in its paragraph keeps the
 * confirm.
 */
export const caseKey = (ask: { claim: string }) =>
  `case:${squeeze(ask.claim).toLowerCase()}`.slice(0, 400);

/** The fewest letters a confirm's words match a case's sentence by: a name alone isn't its case. */
const CASE_WORDS = 12;

/**
 * Whether a customer case is confirmed (CE-052): by its own key, or by a
 * confirm's words, as the page read picks its claim's words again after a
 * save ("Acme cut its close time" one time, "Acme cut its close time by
 * 40%" the next): a confirmed claim's words in its sentence, or its claim's
 * in a confirmed one's.
 */
export function caseConfirmed(
  confirms: ReadonlySet<string>,
  ask: { claim: string; sentence: string },
): boolean {
  const key = caseKey(ask);
  if (confirms.has(key)) return true;
  const claim = key.slice('case:'.length);
  const sentence = squeeze(ask.sentence).toLowerCase();
  for (const confirmed of confirms) {
    if (!confirmed.startsWith('case:')) continue;
    const words = confirmed.slice('case:'.length);
    if (words.length >= CASE_WORDS && sentence.includes(words)) return true;
    if (claim.length >= CASE_WORDS && words.includes(claim)) return true;
  }
  return false;
}

/**
 * Who / how / why (CE-050): the page says how it was made (how it was
 * tested, how the picks were chosen, by whom). Only the person knows: Brief
 * › Your input. Listed where the check counts (the page read's, on pages a
 * reader trusts more for it).
 */
function howTodo(eeat: Score<EeatCheckId>): QualityTodo[] {
  const check = eeat.checks.find((c) => c.id === 'whoHowWhy');
  if (!check) return [];
  return [
    {
      id: 'whoHowWhy',
      done: check.points >= check.max,
      gain: scoreGain(eeat, ['whoHowWhy']),
      score: 'eeat',
      action: 'addInput',
    },
  ];
}

/**
 * Visual proof (CE-049): an image the person took themself. Images on the
 * page none of them confirmed: Confirm (only the person can tell their own
 * from stock); none, with a spot open: Add image there. Checked once one
 * is confirmed; none when the page has neither.
 */
function visualTodo(
  eeat: Score<EeatCheckId>,
  visual: { images: number; own: number; openSpots: number } | null,
): QualityTodo[] {
  if (!visual || (visual.images === 0 && visual.openSpots === 0)) return [];
  const done = visual.own > 0;
  return [
    {
      id: 'visualProof',
      done,
      gain: scoreGain(eeat, ['visualProof']),
      score: 'eeat',
      action: done ? null : visual.images > 0 ? 'confirmImage' : 'addImage',
      count: visual.images - visual.own,
    },
  ];
}
