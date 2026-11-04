/**
 * A brand's facts (Content Editor Quality spec §10, CE-047): its prices and
 * plans, its trial, when it was founded and the claims it makes of itself,
 * read from its own pricing, About and product pages by the API
 * (brandFacts.js), each with its words on the page. A person approves each
 * one in Brand settings › Brand facts; Trust compares a page with the
 * approved ones that are still on the site.
 */

export const FACT_KINDS = ['price', 'trial', 'founded', 'claim'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_SOURCES = ['pricing', 'about', 'product'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export type FactStatus = 'pending' | 'approved' | 'rejected';
export type FactPageStatus = 'ok' | 'blocked' | 'not_found' | 'failed' | 'missed';

/** A price as the API reads it from its words. */
export interface PriceValue {
  plan: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | 'once' | null;
  billed: 'monthly' | 'annually' | null;
  per: 'seat' | null;
}

export type FactValue = PriceValue | { days: number } | { year: number } | Record<string, never>;

export interface BrandFact {
  id: string;
  kind: FactKind;
  value: FactValue;
  /** The page's own words, which hold it. */
  quote: string;
  sourceUrl: string;
  sourceKind: FactSource;
  status: FactStatus;
  reviewedAt: string | null;
  firstSeenAt: string;
  /** No longer on the site: left out of the check. */
  gone: boolean;
  /** The approved fact a pending one would replace ("Was $49"). */
  replaces: { id: string; value: FactValue } | null;
}

export interface BrandFactsRead {
  facts: BrandFact[];
  pages: { kind: FactSource; url: string | null; status: FactPageStatus; checkedAt: string }[];
  checkedAt: string | null;
  /** When the site may be read again. */
  recheckAt: string | null;
  /** The workspace's AI budget is spent: pages not read wait. */
  paused: boolean;
  /** The brand has no domain to read. */
  noDomain: boolean;
}

/** Where a brand's facts are approved: Brand settings › Brand facts. */
export const brandFactsPath = (brandId: string) =>
  `/dashboard/brands/${brandId}/settings?tab=facts`;

export const isPrice = (
  fact: Pick<BrandFact, 'kind' | 'value'>,
): fact is BrandFact & {
  value: PriceValue;
} => fact.kind === 'price';

/**
 * A fact's value as a person reads it: "$49", "€49.99", "14 days", "2015";
 * a claim is its words. Amounts in the currency's own format, the app's
 * English otherwise.
 */
export function factValueText(kind: FactKind, value: FactValue, quote = ''): string {
  if (kind === 'price') {
    const price = value as PriceValue;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
      }).format(price.amount);
    } catch {
      return `${price.amount} ${price.currency}`;
    }
  }
  if (kind === 'trial') return String((value as { days: number }).days);
  if (kind === 'founded') return String((value as { year: number }).year);
  return quote;
}

/** Currency marks, the longest first ("US$" before "$"), as the API reads them. */
const CURRENCY_MARKS: [string, string][] = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['R$', 'BRL'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₺', 'TRY'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
];
const ISO = [
  'USD',
  'EUR',
  'GBP',
  'TRY',
  'JPY',
  'INR',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'BRL',
  'MXN',
  'SGD',
  'HKD',
  'ZAR',
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = `(?:${CURRENCY_MARKS.map(([m]) => escape(m)).join('|')})`;
const CODE = `(?<![\\p{L}])(?:${ISO.join('|')}|TL)(?![\\p{L}])`;
/** Thousands by a comma or a point, or by a space when the currency comes after ("1 299 €"). */
const amount = (groups: string) =>
  String.raw`(?<![\d.,'’])(?:\d{1,3}(?:${groups}\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d]|[.,'’]\d)`;
/** A currency after an amount, not one written onto the next ("Ridge 28 $129": $129, not 28 $). */
const PRICE = new RegExp(
  `(?<before>${MARK}|${CODE})\\s?(?<a>${amount("[.,'’]")})|(?<b>${amount("[.,'’\\s]")})\\s?(?<after>${MARK}|${CODE}|zł)(?!\\d)`,
  'gu',
);
/** "$129.00 CAD": the code after a sign says whose dollar it is. */
const CODE_AFTER = new RegExp(`^\\s?(?<code>${ISO.join('|')})(?![\\p{L}])`, 'u');
/** "CAD $129", "MX$1,299": a code before a dollar sign says whose too. */
const CODE_BEFORE = /(?<!\p{L})(USD|CAD|AUD|NZD|SGD|HKD|MXN|MX|HK)\s?$/u;
const DOLLAR_OF: Record<string, string> = { MX: 'MXN', HK: 'HKD' };
const MAGNITUDE =
  /^\s*(?:[kmb](?!\p{L})|bn\b|mn\b|thousand|million|billion|milyon|milyar|mio\b|mrd\b)/iu;
/** "$10–$20", "between $10 and $20": a range, its two ends (a number before the word or dash). */
const RANGE_AFTER =
  /^\s?(?:[–—-]|to\b|bis\b|ile\b|ila\b|and\b|und\b|et\b|ve\b|à(?=\s)|a(?=\s)|y(?=\s))\s?\S{0,4}\d/iu;
const RANGE_BEFORE = /\d\s?(?:\S{1,3}\s)?(?:[–—-]|to|bis|ile|ila|and|und|et|ve|à|a|y)\s?\S{0,4}$/iu;
/**
 * A sentence whose amounts aren't a plan's price: an old price, a saving,
 * a discount, credits, tax added, or a team's bill ("A 5-person team pays
 * $245").
 */
const NOT_A_PRICE =
  /(?<!\p{L})(?:was|instead\s+of|regularly|originally|sav(?:e|es|ed|ing|ings)|off|discount|coupon|credits?|incl\.?|including\s+(?:vat|tax)|inkl\.?|kdv\s+dahil|statt|rabatt|indirim|tasarruf|économisez|ahorra|refund|money-back|extra|additional|add-ons?|ek\s+ücret|zusätzlich|setup|set-up|onboarding|implementation|installation|one-time|kurulum)(?!\p{L})|\d+[\s-]?(?:person|people|users?|seats?|members?|kişi(?:lik)?|kullanıcı)(?!\p{L})/iu;
const MONTH =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:mo|mth|month|ay|monat|mois|mes)\b|\b(?:per|a|each)\s+month\b|\bmonthly\b|\baylık\b|\bayda\b|\bmonatlich\b|\b(?:pro|im)\s+monat\b|\bpar\s+mois\b|\b(?:al|por)\s+mes\b)/iu;
const YEAR =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:yr|year|yıl|jahr|an|año)\b|\b(?:per|a|each)\s+year\b|\bannually\b|\byearly\b|\byıllık\b|\byılda\b|\bjährlich\b|\b(?:pro|im)\s+jahr\b|\bpar\s+an\b|\b(?:al|por)\s+año\b)/iu;
/** How a sentence says a price is billed: "billed annually", "with annual billing". */
const BILLED_YEAR =
  /billed\s+(?:annually|yearly)|(?:annual|yearly)\s+(?:billing|plan)|paid\s+(?:annually|yearly)|yıllık\s+ödeme|jährliche\s+zahlung/iu;
const BILLED_MONTH =
  /billed\s+monthly|monthly\s+billing|paid\s+monthly|aylık\s+ödeme|monatliche\s+zahlung/iu;
const FROM =
  /\b(?:from|start(?:s|ing)?\s+(?:at|from)|as\s+low\s+as|(?:begins?|starts?)\s+at|ab|[àa]\s+partire?\s+d[ae]|desde|vanaf)(?:\s+(?:just|only|nur|seulement|solo|slechts))?\s*$/iu;
/** "₺499'dan başlayan", "1.299 TL'den başlıyor": Turkish says it after the price. */
const FROM_AFTER = /^['’]?(?:den|dan|ten|tan)\s+(?:başlayan|başlıyor|itibaren)/iu;

const currencyOf = (mark: string) =>
  mark === 'TL'
    ? 'TRY'
    : mark === 'zł'
      ? 'PLN'
      : (CURRENCY_MARKS.find(([m]) => m === mark)?.[1] ?? (ISO.includes(mark) ? mark : null));

/** An amount as written: a separator before exactly three digits groups thousands. */
const amountOf = (token: string) => {
  const value = Number(
    token
      .replace(/['’]/g, '')
      .replace(/[.,\s](?=\d{3}(?!\d))/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(value) ? value : null;
};

/** A price a page's sentence gives: as written, its amount, currency and period, where, and whether it is "from". */
export interface PagePrice {
  text: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | null;
  from: boolean;
  at: number;
  /**
   * Its digits or its sign may be another number's: a space between digits
   * ("PlayStation 5 549,99 €" reads 5 549,99), or a sign after a whole
   * amount with a number next ("Ridge 28 € 129").
   */
  loose: boolean;
}

/**
 * The prices a sentence gives, the way the API reads a brand's: a scale
 * ("$2M"), a range ("$10–$20") and "$10 off" are none. With `rangeEnds`, a
 * range's ends are read too, for a reader that takes its ranges apart
 * (priceRanges): "Ridge 28 – $129" is a price after all.
 */
export function pagePrices(sentence: string, { rangeEnds = false } = {}): PagePrice[] {
  const out: PagePrice[] = [];
  for (const m of sentence.matchAll(PRICE)) {
    const g = m.groups!;
    const end = m.index + m[0].length;
    const before = sentence.slice(Math.max(0, m.index - 24), m.index);
    const after = sentence.slice(end, end + 40);
    if (MAGNITUDE.test(after) || /^\s*off(?!\p{L})/iu.test(after)) continue;
    if (!rangeEnds && (RANGE_AFTER.test(after) || RANGE_BEFORE.test(before))) continue;
    const code = g.before && !ISO.includes(g.before) ? CODE_AFTER.exec(after) : null;
    const codeBefore = g.before === '$' ? CODE_BEFORE.exec(before) : null;
    const dollar = codeBefore && (DOLLAR_OF[codeBefore[1]] ?? codeBefore[1]);
    const currency = code ? code.groups!.code : (dollar ?? currencyOf(g.before ?? g.after));
    const value = amountOf(g.a ?? g.b);
    if (!currency || value === null) continue;
    out.push({
      text: code ? `${m[0].trim()}${code[0]}` : m[0].trim(),
      amount: value,
      currency,
      period: MONTH.test(after) ? 'month' : YEAR.test(after) ? 'year' : null,
      from: FROM.test(before) || FROM_AFTER.test(after),
      at: m.index,
      // Cents tie a sign to its amount: "129,00 € 2 Jahre Garantie" is 129 €.
      loose:
        /\s/u.test(g.b ?? '') ||
        (!!g.after && /^\s\d/u.test(after) && !/[.,]\d{1,2}$/u.test(g.b ?? '')),
    });
  }
  return out;
}

/** A range's end: an amount with its currency before or after it, or neither ("$119–139"). */
const rangeEnd = (name: string) =>
  `(?:(?<${name}Before>${MARK}|${CODE})\\s?)?(?<${name}>${amount("[.,'’]")})(?:\\s?(?<${name}After>${MARK}|${CODE}|zł)(?!\\d))?`;
const PRICE_RANGE = new RegExp(
  `${rangeEnd('low')}(?<join>\\s?(?:[–—-]|(?<=\\s)(?:to|bis|à|a|ila|ile|and|und|et|y)(?=\\s))\\s?)${rangeEnd('high')}`,
  'giu',
);

/** A range a sentence gives ("$119–$139", "119–139 €", "€20 to €30"): its two ends, in one currency. */
export interface PriceRange {
  text: string;
  low: number;
  high: number;
  currency: string;
  at: number;
  /**
   * Written as ranges are: both ends with their currency, or one and a
   * dash with no space ("$119–139"). Else ("$119 – 139", "119 bis 139 €")
   * it may be one, or a price beside a number.
   */
  sure: boolean;
}

/**
 * The price ranges a sentence gives (the ones pagePrices leaves out): the
 * same currency on both ends, the low end first, and whether it's sure
 * (PriceRange). A number before a price ("Ridge 28 – $129") or one after
 * it with a word ("$129 – 150 reviews", "$19 - 100% cotton", "$25-30-day
 * returns") is no range.
 */
export function priceRanges(sentence: string): PriceRange[] {
  const out: PriceRange[] = [];
  for (const m of sentence.matchAll(PRICE_RANGE)) {
    const g = m.groups!;
    const marks = [g.lowBefore, g.lowAfter, g.highBefore, g.highAfter].filter(Boolean);
    const currencies = new Set(marks.map((mark) => currencyOf(mark)));
    const low = amountOf(g.low);
    const high = amountOf(g.high);
    const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const lowMarked = !!(g.lowBefore || g.lowAfter);
    const highMarked = !!(g.highBefore || g.highAfter);
    if (currencies.size !== 1 || currencies.has(null) || MAGNITUDE.test(after)) continue;
    if (low === null || high === null || !(low < high)) continue;
    if (!lowMarked && g.highBefore) continue;
    // "$19 - 100% cotton", "$25-30-day returns", "€20 – 30 Tage Rückgaberecht".
    if (!highMarked && /^(?:%|-\p{L})/u.test(after)) continue;
    if (!highMarked && /\s/u.test(g.join) && /^\s+\p{L}/u.test(after)) continue;
    const sure =
      (lowMarked && highMarked) || (/^[–—-]$/u.test(g.join) && !/^(?:%|-?\p{L})/u.test(after));
    out.push({ text: m[0], low, high, currency: [...currencies][0]!, at: m.index, sure });
  }
  return out;
}

/** A page's fact that differs from an approved one: Trust's suggestion names both. */
export interface FactMismatch {
  kind: 'price' | 'trial' | 'founded';
  /** The page's value, as written ("$39"). */
  page: string;
  /** The approved value ("$49"). */
  fact: string;
  /** The page the approved one was read from. */
  source: FactSource;
  /** The sentence it is in: Show goes there. */
  sentence: string;
}

/**
 * Plan names that are everyday words ("Pro tip", "our team", "a free
 * consultation"): named only beside "plan" or "tier", or in a sentence
 * that names the brand.
 */
const COMMON_PLANS = new Set([
  'free',
  'pro',
  'plus',
  'team',
  'teams',
  'business',
  'basic',
  'starter',
  'growth',
  'standard',
  'premium',
  'enterprise',
  'personal',
  'professional',
  'essential',
  'essentials',
  'advanced',
  'ultimate',
  'lite',
  'max',
  'scale',
  'startup',
  'agency',
  'solo',
  'individual',
  'small business',
]);
const PLAN_WORD = /^\s*(?:plan|tier|package|edition|paket|planı|tarif)(?!\p{L})/iu;
/** "Ledgerly" as a word, the brand's name as written. */
const named = (sentence: string, name: string) =>
  name.trim().length > 2 &&
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'u').test(sentence);
/** Where a plan is named in a sentence, as the page writes it (its case too); -1 when it isn't. */
function planAt(sentence: string, plan: string, brandNamed: boolean): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(plan)}(?![\\p{L}\\p{N}])`, 'gu');
  for (const m of sentence.matchAll(re)) {
    const common = COMMON_PLANS.has(plan.toLowerCase());
    if (!common || brandNamed || PLAN_WORD.test(sentence.slice(m.index + m[0].length))) {
      return m.index;
    }
  }
  return -1;
}
/**
 * The brand's own price, said of it right after its name ("Ledgerly costs
 * $29 a month", "Ledgerly's pricing starts at $19"): a pricing verb right
 * after the name, or after its plan or pricing ("Ledgerly setup costs" is
 * another bill), then the price, no other amount between.
 */
const PRICED_AFTER_NAME =
  /^['’]?s?\s+(?:(?:monthly|annual|yearly|base|basic)\s+)?(?:(?:plans?|pricing|price|subscriptions?|licen[cs]es?|membership)\s+)?(?:(?:now|currently|only|just)\s+)?(?:costs?|charges?|is\s+priced\s+at|priced\s+at|starts?\s+(?:at|from)|starting\s+at|kostet|coûte|cuesta)\s+(?:(?:just|only|from|ab|desde)\s+)?$/iu;
/**
 * A named plan's own price, said right after its name ("Ledgerly Pro costs
 * $59", "The Pro plan is $39/mo", "…and the Pro plan $49/month", "Pro:
 * $49", "Pro ($49/month)"): its "plan" or "tier" word, then nothing, "is",
 * a colon, a dash, "(" or a pricing verb, and "just", "only" or "from" ("Pro
 * plan users invoice $12,000", "the Pro plan adds $30" are other amounts).
 */
const PRICED_AFTER_PLAN =
  /^(?:\s+(?:plan|tier|package|edition|paket|planı|tarif)(?!\p{L}))?(?:['’]s)?\s*(?:(?:is|:|[–—-]|\()\s*)?(?:(?:now|currently)\s+)?(?:(?:costs?|charges?|is\s+priced\s+at|priced\s+at|starts?\s+(?:at|from)|starting\s+at|kostet|coûte|cuesta)\s+)?(?:(?:just|only|from|ab|desde)\s+)?$/iu;
/** Words that compare a price with another ("$30 more than Starter", "$20 less per month than…"). */
const COMPARING = new Set([
  'more',
  'less',
  'cheaper',
  'pricier',
  'than',
  'mehr',
  'weniger',
  'günstiger',
  'teurer',
  'als',
  'daha',
  'moins',
  'más',
  'menos',
]);
/** A price compared with another, within a few words after it: no plan's price. */
const comparedAfter = (sentence: string, price: PagePrice) =>
  sentence
    .slice(price.at + price.text.length)
    .split(/\s+/)
    .slice(0, 5)
    .some((word) => COMPARING.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')));
/** Where a name is in a sentence, as whole words: each start. */
const namedAt = (sentence: string, name: string) =>
  name.trim().length > 2
    ? [
        ...sentence.matchAll(
          new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'gu'),
        ),
      ].map((m) => ({ at: m.index, end: m.index + m[0].length }))
    : [];
const TRIAL_DAYS = [
  /(?<!\d)(\d{1,3})[\s-]?days?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,3})\s+days?(?!\p{L})/iu,
  /(?<!\d)(\d{1,3})\s+günlük\s+(?:ücretsiz\s+)?deneme/iu,
  /(?<!\d)(\d{1,3})[\s-]?(?:tage|tägige)\s+(?:kostenlose\s+)?(?:testphase|testversion)/iu,
];
const TRIAL_WEEKS = [
  /(?<!\d)(\d{1,2})[\s-]?weeks?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,2})\s+weeks?(?!\p{L})/iu,
];
/**
 * "Free for 14 days": a trial only in a sentence that says "trial", or
 * after "try" or "use" and the brand ("Ledgerly keeps your files free for
 * 30 days", "priority support free for 30 days" are no trial).
 */
const FREE_FOR: [RegExp, number][] = [
  [/free\s+for\s+(\d{1,3})\s+days?(?!\p{L})/iu, 1],
  [/free\s+for\s+(\d{1,2})\s+weeks?(?!\p{L})/iu, 7],
];
const SAYS_TRIAL = /trial|deneme|testphase|testversion/iu;
/** A trial said of the brand's plans: "your free trial", "every plan". */
const OWN_TRIAL =
  /\b(?:your|our)\s+(?:free\s+)?trial\b|\b(?:every|all|each)\s+plans?\b|\bher\s+plan|\btüm\s+planlar/iu;
/** A trial length a text gives, in days, and where it is. */
interface TrialLength {
  days: number;
  at: number;
}
/** Every trial length a text gives; "free for N days" where `tried` says it's a trial there. */
const trialLengths = (text: string, tried: (before: string) => boolean): TrialLength[] => [
  ...TRIAL_DAYS.flatMap((re) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))].map((m) => ({
      days: Number(m[1]),
      at: m.index,
    })),
  ),
  ...TRIAL_WEEKS.flatMap((re) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))].map((m) => ({
      days: Number(m[1]) * 7,
      at: m.index,
    })),
  ),
  ...FREE_FOR.flatMap(([re, unit]) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))]
      .filter((m) => tried(text.slice(0, m.index)))
      .map((m) => ({ days: Number(m[1]) * unit, at: m.index })),
  ),
];
/**
 * A length said of someone's own: "…; Ledgerly's runs for 14 days" (a trial
 * named before it), "Ledgerly's trial runs for 30 days".
 */
const OWNED_LENGTH =
  /(?:['’]s|\b(?:its|theirs|ours|yours))\s+(?:[\p{L}-]+\s+)?(?:runs?|lasts?|is|are)\s+(?:for\s+)?(?:(?:just|only)\s+)?(\d{1,3})[\s-]?(days?|weeks?)(?!\p{L})/giu;
/**
 * Where a sentence turns to another subject ("Acme offers a 15-day trial;
 * Ledgerly's is longer"): a trial is the brand's only in a part that names
 * it, or says "your trial", "every plan".
 */
const TURN =
  /[;:–—]|,\s*(?:and|but|while|whereas|which|whose|who)\b|\b(?:but|while|whereas|unlike|than|compared\s+(?:to|with))\b/iu;
/**
 * The brand's own founding year, said right after who, who at the start of
 * its clause: "Ledgerly was founded in 2015", "we were…" ("the agency that
 * built Ledgerly was founded" is the agency's). "We" only outside quoted
 * speech, which may be anyone's.
 */
const foundedOf = (brandName: string, we: boolean) => {
  const name = brandName.trim().length > 2 ? escape(brandName.trim()) : null;
  const nameStart = `(?:^|[,;:(–—]\\s*|(?<![\\p{L}\\p{N}])(?:and|since|when|after|as|ve)\\s+)`;
  // "We" only at the sentence's start or after since/when/after/and: after
  // a colon it may be someone quoted without quote marks ("Acme's CEO told
  // us: we were founded in 2018").
  const weStart = `(?:^|(?<![\\p{L}\\p{N}])(?:and|since|when|after|ve)\\s+)`;
  const forms: [string[], string][] = [
    [
      ['we', 'our\\s+company'],
      `\\s+(?:was|were)\\s+(?:founded|established)\\s+(?:in\\s+)?((?:18|19|20)\\d{2})(?!\\d)`,
    ],
    [
      ['biz', 'şirketimiz'],
      `\\s+((?:18|19|20)\\d{2})['’]?(?:de|da|te|ta)?\\s+(?:yılında\\s+)?kurul(?:du|muştur|duk)`,
    ],
    [['wir'], `\\s+(?:wurde|wurden)\\s+(?:im\\s+jahr\\s+)?((?:18|19|20)\\d{2})\\s+gegründet`],
  ];
  return forms.flatMap(([ours, said]) => {
    const who = [
      ...(name ? [`${nameStart}(?:${name})`] : []),
      ...(we ? [`${weStart}(?:${ours.join('|')})`] : []),
    ];
    return who.length ? [new RegExp(`(?:${who.join('|')})${said}`, 'iu')] : [];
  });
};
/** Quoted speech in a sentence. */
const QUOTED = /["“”«»„]/u;

/**
 * The page's prices, trial and founding year against the brand's approved
 * facts still on its site (Trust's "consistent with brand facts", CE-047),
 * read so as never to cry wolf (a wrong warning on a right page is worse
 * than none):
 *
 *   * a price is compared with the plan named nearest it in the sentence
 *     (the closest pairs first, no other price between, none read unless
 *     the sentence has as many prices as plans named), its name as the page
 *     writes it, a name that is an everyday word ("Pro", "Team", "Free")
 *     only beside "plan" or "tier" or with the brand named; with no plan
 *     named, only right after the brand's name and what it costs
 *     ("Ledgerly costs $29 a month");
 *   * in its currency only; with a period or a billing ("billed
 *     annually") only against prices of that period or billing; it
 *     matches when it is any of them (a plan's monthly and annual prices
 *     both count), "from $19" too; free ($0) is never compared;
 *   * a sentence with an old price, a saving, a discount, credits, tax,
 *     an add-on, a setup fee or a team's bill ("was $49", "5 users pay")
 *     isn't read for prices, nor one naming a competitor;
 *   * a trial in days in the part of the sentence that says it is the
 *     brand's ("your free trial", "every plan", the brand's name), its days
 *     right beside the trial, and none with two trial lengths in the
 *     sentence; a founding year right after "the brand was founded" ("we
 *     were founded" too, outside quoted speech), who at the start of its
 *     clause.
 *
 * Each sentence once. `compared` is how many were compared: the check's
 * points are the share that matched.
 */
export function factMismatches({
  sentences,
  facts,
  brandName,
  competitorDomains,
}: {
  /** The page's sentences (its Trust blocks', sentencesOf). */
  sentences: string[];
  facts: BrandFact[];
  brandName: string;
  competitorDomains: string[];
}): { compared: number; mismatches: FactMismatch[] } {
  const approved = facts.filter((f) => f.status === 'approved' && !f.gone);
  const prices = approved.filter(isPrice).filter((p) => p.value.amount > 0);
  const trials = approved.filter((f) => f.kind === 'trial');
  const years = approved.filter((f) => f.kind === 'founded');
  if (!prices.length && !trials.length && !years.length) return { compared: 0, mismatches: [] };
  const rivals = competitorDomains
    .map(
      (d) =>
        d
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0],
    )
    .flatMap((d) => [d, d.split('.')[0]])
    .filter((d) => d.length >= 3);
  const plans = [...new Set(prices.map((p) => p.value.plan))].filter((p) => p.trim().length > 1);
  const founded = foundedOf(brandName, true);
  const foundedNamed = foundedOf(brandName, false);
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const shown = (f: BrandFact) => factValueText(f.kind, f.value, f.quote);

  let compared = 0;
  const mismatches: FactMismatch[] = [];
  for (const sentence of new Set(sentences)) {
    const lower = sentence.toLowerCase();
    if (rivals.some((r) => named(lower, r))) continue;
    const brand = named(sentence, brandName);

    if (prices.length && !NOT_A_PRICE.test(sentence)) {
      const places = plans
        .map((plan) => ({ plan, at: planAt(sentence, plan, brand) }))
        .filter((p) => p.at !== -1);
      const billed = BILLED_YEAR.test(sentence)
        ? 'annually'
        : BILLED_MONTH.test(sentence)
          ? 'monthly'
          : null;
      const found = pagePrices(sentence).filter((price) => price.amount > 0);
      // Each named plan with the one price nearest it, the closest pairs
      // first, none other between. As many prices as plans named (one with
      // none named), else which is whose isn't sure ("Pro is $49/month or
      // $39/month billed annually", "…, and Business is $199" with only Pro
      // found, "Pro, unlike the Starter plan, costs $49"): none is read.
      const sure = found.length === Math.max(places.length, 1);
      const planOf = new Map<number, (typeof places)[number]>();
      const pairs = places
        .flatMap((place) => found.map((price) => ({ place, price })))
        .sort((a, b) => Math.abs(a.price.at - a.place.at) - Math.abs(b.price.at - b.place.at));
      const paired = new Set<string>();
      for (const { place, price } of pairs) {
        if (planOf.has(price.at) || paired.has(place.plan)) continue;
        const [from, to] = [Math.min(place.at, price.at), Math.max(place.at, price.at)];
        if (found.some((other) => other !== price && other.at > from && other.at < to)) continue;
        planOf.set(price.at, place);
        paired.add(place.plan);
      }
      const names = namedAt(sentence, brandName);
      // What is said between a name and its price, its currency mark aside.
      const between = (end: number, price: PagePrice) =>
        sentence.slice(end, price.at).replace(/[$€£¥₹₺]\s*$/u, '');
      for (const price of sure ? found : []) {
        const nearest = places.length ? (planOf.get(price.at) ?? null) : null;
        if (places.length && !nearest) continue;
        // A named plan's price: right after its name, as the brand's is.
        if (
          nearest &&
          !(
            nearest.at < price.at &&
            PRICED_AFTER_PLAN.test(between(nearest.at + nearest.plan.length, price))
          )
        ) {
          continue;
        }
        // No plan named: only a price said right after the brand's name.
        if (
          !nearest &&
          !names.some((n) => n.end <= price.at && PRICED_AFTER_NAME.test(between(n.end, price)))
        ) {
          continue;
        }
        if (comparedAfter(sentence, price)) continue;
        let pool = prices.filter(
          (p) => p.value.currency === price.currency && (!nearest || p.value.plan === nearest.plan),
        );
        if (price.period)
          pool = pool.filter((p) => !p.value.period || p.value.period === price.period);
        if (billed) pool = pool.filter((p) => !p.value.billed || p.value.billed === billed);
        if (!pool.length) continue;
        compared += 1;
        if (!pool.some((p) => same(p.value.amount, price.amount))) {
          mismatches.push({
            kind: 'price',
            page: price.text,
            fact: shown(pool[0]),
            source: pool[0].sourceKind,
            sentence,
          });
        }
      }
    }

    if (trials.length && (brand || OWN_TRIAL.test(sentence))) {
      // Two different trial lengths in the sentence (another brand's beside
      // the brand's, "…; Ledgerly's runs for 14 days") say nothing sure.
      const owned = (text: string, trial: boolean): TrialLength[] =>
        [...text.matchAll(OWNED_LENGTH)]
          .filter((m) => !trial || /trial/iu.test(m[0]))
          .map((m) => ({ days: Number(m[1]) * (/^week/i.test(m[2]) ? 7 : 1), at: m.index }));
      // "Free for N days" is a trial in a sentence that says so, or after "try Ledgerly".
      const tryBrand =
        brandName.trim().length > 2
          ? new RegExp(`(?:try|use)\\s+${escape(brandName.trim())}\\s+$`, 'iu')
          : null;
      const tried = (before: string) => SAYS_TRIAL.test(sentence) || !!tryBrand?.test(before);
      const lengths = new Set(
        [...trialLengths(sentence, tried), ...owned(sentence, false)].map((l) => l.days),
      );
      // In a part that is the brand's, only a length after its name or "your
      // trial", "every plan" ("Unlike Acme's 30-day trial, Ledgerly's needs no
      // card" is Acme's).
      const own = new Set(
        sentence.split(TURN).flatMap((part) => {
          const anchors = [
            ...namedAt(part, brandName).map((n) => n.at),
            ...[...part.matchAll(new RegExp(OWN_TRIAL.source, 'giu'))].map((m) => m.index),
          ];
          if (!anchors.length) return [];
          const from = Math.min(...anchors);
          return [...trialLengths(part, tried), ...owned(part, true)]
            .filter((l) => l.at >= from)
            .map((l) => l.days);
        }),
      );
      const days = lengths.size === 1 && own.size === 1 ? [...own][0] : null;
      if (days) {
        compared += 1;
        const fact = trials.find((f) => (f.value as { days: number }).days === days);
        if (!fact) {
          mismatches.push({
            kind: 'trial',
            page: `${days}-day`,
            fact: `${(trials[0].value as { days: number }).days}-day`,
            source: trials[0].sourceKind,
            sentence,
          });
        }
      }
    }

    if (years.length) {
      // Only the brand's (or "we", "our company") right before "was founded".
      const m = (QUOTED.test(sentence) ? foundedNamed : founded)
        .map((re) => sentence.match(re))
        .find(Boolean);
      const year = m ? m[1] : null;
      if (year) {
        compared += 1;
        if (!years.some((f) => (f.value as { year: number }).year === Number(year))) {
          mismatches.push({
            kind: 'founded',
            page: year,
            fact: shown(years[0]),
            source: years[0].sourceKind,
            sentence,
          });
        }
      }
    }
  }
  return { compared, mismatches };
}
