import * as cheerio from 'cheerio';
import { editLines } from './contentPeople.js';
import { dropEdits, editHtml, marksIn, sentenceSpans } from './contentResearch.js';
import { sourceWords } from './contentSources.js';

/**
 * Health claims (owner's safety rule, 2026-11-03): nothing that puts a life
 * at risk, and no "it treats …" for a health or supplement brand. The
 * Content Agent never writes a health benefit, a treatment, a prevention or
 * a dose the brand didn't give, nor asks to have one looked up ({{find: …}},
 * contentResearch.js), and keeps each safety line ("talk to your doctor",
 * "not intended to diagnose, treat, cure or prevent any disease"). Every
 * prompt says so (HEALTH_RULE). On a health brand's page (isHealthBrand) the
 * guards make sure, against what the brand gave in its own words (the page,
 * its description, Your input, the brand's and the writer's rules): a
 * suggestion that adds a claim is dropped (keepSuggestions), and a page
 * written or rewritten whole loses the sentence. Both before the facts are
 * looked up, so a {{find: …}} for one is never searched, and after.
 *
 * What a claim is comes from the Content Editor's quality test
 * (editorEval.test.js, VitaRoot: "Magnesium glycinate may help some people
 * sleep"), in English and Turkish: a question a buyer asks ("Does it help
 * you sleep") and a disclaimer ("does not help", "not intended to … cure",
 * "… amacıyla kullanılmaz") claim nothing. Only on a health brand's page: a
 * SaaS page's "helps you focus" is no claim to drop.
 */

/** What every Content Agent prompt says about health (owner's safety rule, 2026-11-03). */
export const HEALTH_RULE = `- Health: never write a health benefit, a treatment, a prevention or a dose that the brand, the page or Your input doesn't give in its own words (that something helps sleep, eases stress or pain, supports immunity, treats, cures or prevents a condition, or how much of it to take), and never write {{find: …}} for one: none is looked up. Keep each safety line as it is ("talk to your doctor", "not intended to diagnose, treat, cure or prevent any disease").`;

/** The industry Brand settings lists for one (siteTypeDetect.js INDUSTRIES). */
const HEALTH_INDUSTRY = 'healthcare';

/**
 * The words that make a brand a health one, in its industry (a person's own
 * past the list: "Dietary supplements"), name or description, English and
 * Turkish. A site's, an account's or a team's health ("site health", "a health
 * check", "pipeline health") isn't one, nor hospitality.
 */
const HEALTH_BRAND = new RegExp(
  [
    String.raw`(?<!(?:site|website|seo|brand|account|system|server|data|code|app|network|business|customer|financial|portfolio|credit|link|domain|pipeline|team|revenue|sales|inbox|email|store|deliverability|product|codebase|project|campaign|funnel)\s)health(?!\s+(?:checks?|scores?|reports?|monitor))\p{L}*`,
    String.raw`supplements?|vitamins?|probiotics?|nutraceuticals?|nutrition\p{L}*|dietary|pharma\p{L}*|medic\p{L}*|clinic\p{L}*|hospitals?|wellness|herbal|homeopath\p{L}*|ayurved\p{L}*|naturopath\p{L}*|therap(?:y|ies|ists?|eutic\p{L}*)|dental|dentists?`,
    String.raw`sağlı\p{L}*|takviye\p{L}*|eczane\p{L}*|ilaç\p{L}*|klinik\p{L}*|hastane\p{L}*|bitkisel|probiyotik\p{L}*|vitamin\p{L}*|tıbbi|terapi\p{L}*`,
  ]
    .map((part) => `(?<!\\p{L})(?:${part})(?!\\p{L})`)
    .join('|'),
  'iu',
);

/** Whether a brand is a health one: Healthcare, or its industry, name or description says so. */
export function isHealthBrand(brand) {
  if (!brand) return false;
  if (
    String(brand.industry ?? '')
      .trim()
      .toLowerCase() === HEALTH_INDUSTRY
  ) {
    return true;
  }
  return HEALTH_BRAND.test(
    `${brand.industry ?? ''}\n${brand.name ?? ''}\n${brand.description ?? ''}`,
  );
}

// ─── What a claim is ────────────────────────────────────────────────────────

/** What a claim is about, in English: the body, the mind, a condition. */
const BODY_EN = String.raw`(?:sleep\p{L}*|insomnia|relax\p{L}*|calm\p{L}*|stress\p{L}*|anxi\p{L}*|depress\p{L}*|moods?|pain\p{L}*|aches?|cramps?|inflammation|swelling|blood|cholesterol|glucose|diabet\p{L}*|migraines?|headaches?|fatigue|tiredness|energy|immun\p{L}*|colds?|flu|infections?|symptoms?|diseases?|illness\p{L}*|cancers?|hearts?|cardio\p{L}*|digest\p{L}*|gut|bloating|constipation|weight|metabolism|skin|acne|joints?|arthritis|muscles?|muscular|bones?|nerves?|nervous|brain|memory|focus(?!\s+on\b)|concentration|cognit\p{L}*|recovery|libido|fertility|menopaus\p{L}*|hormon\p{L}*|liver|kidneys?|allerg\p{L}*|asthma|health|well-?being)`;

/** A verb that claims an effect, as a page writes it: "supports", "reduced", "easing". */
const VERB_EN = String.raw`(?:improv|reduc|lower(?!\s+back)|eas|reliev|fight|prevent|treat|cur|heal|sooth|boost|support|promot|regulat|balanc|strengthen|enhanc|protect|restor|increas|aid|combat|alleviat|clear|detox|nourish|benefit|calm|relax)(?:es|e|s|ed|ing)?`;

/**
 * Up to `n` words between a claim's verb and what it's about, within one
 * phrase: "reduces the risk of heart disease", never "reduce churn and focus".
 */
const GAP = (n) =>
  String.raw`(?:(?!(?:and|or|but|while|so|then|that|which|ve|veya|ama|fakat)\s)[\p{L}\p{N}'’-]+\s+){0,${n}}?`;

/** What a claim is about, in Turkish, with its case endings. */
const BODY_TR = String.raw`(?:uyku\p{L}*|uyuma\p{L}*|uykusuzluk\p{L}*|stres\p{L}*|kaygı\p{L}*|endişe\p{L}*|anksiyete\p{L}*|depresyon\p{L}*|ruh\s+hal\p{L}*|ağrı\p{L}*|kramp\p{L}*|iltihap\p{L}*|ödem(?!e)\p{L}*|tansiyon\p{L}*|kan\s+basınc\p{L}*|kolesterol\p{L}*|kan\s+şeker\p{L}*|diyabet\p{L}*|migren\p{L}*|yorgunluk\p{L}*|halsizli\p{L}*|enerji\p{L}*|bağışıklı\p{L}*|grip\p{L}*|soğuk\s+algınlı\p{L}*|enfeksiyon\p{L}*|semptom\p{L}*|belirti\p{L}*|hastalı\p{L}*|kanser\p{L}*|kalp\p{L}*|kalb\p{L}*|sindirim\p{L}*|bağırsa\p{L}*|şişkinli\p{L}*|kabızlı\p{L}*|kilo\p{L}*|metabolizma\p{L}*|cilt\p{L}*|sivilce\p{L}*|saç\s+dökülme\p{L}*|eklem\p{L}*|kas(?:lar\p{L}*|ı|ın\p{L}*|a)?|kemik\p{L}*|sinir\p{L}*|beyin\p{L}*|hafıza\p{L}*|odak\p{L}*|konsantrasyon\p{L}*|toparlan\p{L}*|libido\p{L}*|doğurganlı\p{L}*|menopoz\p{L}*|hormon\p{L}*|karaciğer\p{L}*|böbre\p{L}*|alerji\p{L}*|astım\p{L}*|sağlı\p{L}*)`;

/** A Turkish verb that claims an effect, after what it's about: "uykuya yardımcı olur". */
const VERB_TR = String.raw`(?:yardımcı(?:\s+ol\p{L}*)?|destekl\p{L}*|iyileştir\p{L}*|azalt\p{L}*|düşür\p{L}*|önle\p{L}*|gider(?:ir|ici|me)\p{L}*|hafiflet\p{L}*|güçlendir\p{L}*|art(?:t)?ır\p{L}*|dengel\p{L}*|rahatlat\p{L}*|tedavi\s+e[dt]\p{L}*|koru\p{L}*|iyi\s+gel\p{L}*|faydal\p{L}*|yararl\p{L}*|katkı\s+sağla\p{L}*|şifa\p{L}*)`;

/** A dose's unit, English and Turkish. */
const DOSE_UNIT = String.raw`(?:mg|mcg|µg|μg|g|iu|ml|capsules?|tablets?|softgels?|pills?|drops?|gummies|scoops?|kapsül\p{L}*|tablet\p{L}*|damla\p{L}*|ölçek\p{L}*|saşe\p{L}*|şase\p{L}*)`;
const AMOUNT = String.raw`\d+(?:[.,]\d+)?(?:\s?(?:-|–|to|or|ila|veya)\s?\d+(?:[.,]\d+)?)?\s?`;

/**
 * A health claim a text makes, English and Turkish: a benefit ("helps you
 * sleep", "supports immune health", "reduces cramps", "better sleep",
 * "clinically proven"), a treatment or a prevention ("cures insomnia",
 * "prevents colds"), a dose ("take 2 capsules", "400 mg daily"), and their
 * Turkish ("uykuya yardımcı olur", "stresi azaltır", "günde 2 kapsül").
 */
const HEALTH_CLAIM = new RegExp(
  [
    String.raw`\bhelp(?:s|ed|ing)?\s+${GAP(3)}(?:(?:fall\s+)?asleep|sleep\p{L}*|relax\p{L}*|calm\p{L}*|unwind|recover\p{L}*|heal\p{L}*|concentrate|focus(?!\s+on\b)|lose\s+weight|${VERB_EN}\s+${GAP(3)}${BODY_EN})`,
    String.raw`\b${VERB_EN}\s+${GAP(3)}${BODY_EN}`,
    String.raw`\b(?:better|deeper|restful|sounder)\s+sleep`,
    String.raw`\bgood\s+for\s+(?:your\s+|the\s+)?${BODY_EN}`,
    String.raw`\b(?:clinically|scientifically|medically)\s+(?:proven|shown)`,
    String.raw`\banti-?(?:inflammatory|anxiety|stress|aging|ageing|bacterial|viral)`,
    String.raw`\b(?:take|takes|taking|use|dose\s+of|dosage\s+of)\s+${GAP(2)}${AMOUNT}${DOSE_UNIT}`,
    String.raw`\b${AMOUNT}${DOSE_UNIT}\s+(?:(?:a|per|each|every)\s+day|daily|at\s+night|before\s+bed)`,
    String.raw`(?<!\p{L})${BODY_TR}\s+${GAP(2)}${VERB_TR}`,
    String.raw`(?<!\p{L})(?:daha\s+iyi|derin|kaliteli|deliksiz|rahat)\s+(?:bir\s+)?uyku\p{L}*`,
    String.raw`(?<!\p{L})(?:klinik|bilimsel)\s+olarak\s+kanıtlan\p{L}*`,
    String.raw`(?<!\p{L})(?:rahatlatır|iyi\s+gelir|şifa\s+verir)`,
    String.raw`(?<!\p{L})günde\s+(?:\p{L}+\s+)?${AMOUNT}${DOSE_UNIT}`,
    String.raw`(?<!\p{L})${AMOUNT}${DOSE_UNIT}\s+(?:günde|her\s+gün|günlük|yatmadan)`,
  ]
    .map((part) => `(?:${part})(?!\\p{L})`)
    .join('|'),
  'giu',
);

/**
 * An English disclaimer before a claim: "does not help", "not intended to
 * diagnose, treat, cure or prevent", within its clause ("…, but it helps"
 * is a claim again). A comma ends the clause unless a list of claim verbs
 * goes on past it ("treat, cure, or prevent"): "If you can't sleep, it helps
 * you relax" is a claim.
 */
const NEGATED_BEFORE = new RegExp(
  String.raw`\b(?:not intended to|not meant to|does not|do not|did not|is not|are not|doesn['’]t|don['’]t|didn['’]t|isn['’]t|aren['’]t|won['’]t|can['’]t|cannot|never|not(?!\s+only))\b(?:(?!\b(?:but|however|although|though|yet|while|whereas)\b)(?:[^.!?\n:;—–,]|,\s*(?=(?:(?:and|or|nor)\s+)?(?:diagnos\p{L}*|${VERB_EN})(?!\p{L})))){0,40}$`,
  'iu',
);
/** A Turkish claim's verb said in the negative: "yardımcı olmaz", "azaltmaz", "önlemediği". */
const NEGATED_VERB_TR = /(?:m[ae]z|m[ae]m[ıiuü]ş|m[ae]y[ae]n|m[ae]d[ıiuü])\p{L}*$/iu;
/** A Turkish disclaimer after a claim: "… amacıyla kullanılmaz", "… yerine geçmez". */
const NEGATED_AFTER_TR =
  /^[^.!?\n]{0,60}?(?<!\p{L})(?:değil\p{L}*|amaçlanmamış\p{L}*|kullanılmaz|yerine\s+geçmez|iddia\s+etmez|garanti\s+etmez|amacı\s+taşımaz)/iu;

/**
 * A question a buyer asks, with or without its "?": "Does it help you sleep",
 * "uykuya yardımcı olur mu". A verb or an adverb after the modal makes it a
 * list item's claim instead: "May also help", "Is clinically proven"; an -ly
 * or -ed word counts only before a verb or "to": "Can elderly people take".
 */
const QUESTION_START = new RegExp(
  String.raw`^\s*["“'‘(]*(?:(?:how|what|why|when|which|who|where)\s+)?(?:does|do|did|can|could|is|are|was|were|will|would|should|may|might|has|have)\s+(?!(?:help|be|been|${VERB_EN}|also|even|still|further|often|actually|naturally|gently|proven|shown|known|made|(?!(?:daily|family|early|only|weekly|monthly)\b)\p{L}{3,}ly\s+(?:help|be|been|${VERB_EN}|proven|shown|known|made|\p{L}{3,}ed)|\p{L}{3,}ed\s+(?:to|by|for|with|in))\b)`,
  'iu',
);
/** Turkish asks with its particle after a word: "olur mu", "güvenli midir" (never "5 mi", miles). */
const QUESTION_TR = /(?<=\p{L}\s)m[ıiuü](?:s[ıiuü]n(?:[ıiuü]z)?|y[ıiuü][mz]|d[ıiuü]r)?(?!\p{L})/iu;
const isQuestion = (sentence) =>
  /[?？]["”’»)]*\s*$/u.test(sentence) ||
  QUESTION_START.test(sentence) ||
  QUESTION_TR.test(sentence);

/** The private-use marks a looked-up fact's link sits in until it is HTML (contentResearch.js). */
const LINK_MARKS = /[-]/gu;
/** Any {{…}}: its words are no claim the page makes (a {{find: …}} is read on its own). */
const MARK = /\{\{[^{}\n]*\}\}/gu;

/** Whether a claim found in a sentence is a disclaimer: negated before it, or after it in Turkish. */
function negated(sentence, m) {
  const before = sentence.slice(Math.max(0, m.index - 60), m.index);
  if (NEGATED_BEFORE.test(`${before}${m[0].split(/\s+/)[0]}`)) return true;
  if (NEGATED_VERB_TR.test(m[0].trim().split(/\s+/).at(-1))) return true;
  return NEGATED_AFTER_TR.test(sentence.slice(m.index + m[0].length));
}

/** The health claims a text makes, each as written: none in a question or a disclaimer. */
export function healthClaimsIn(text) {
  const s = String(text ?? '')
    .replace(LINK_MARKS, '')
    .replace(MARK, (m) => ' '.repeat(m.length));
  const claims = [];
  for (const { start, end } of sentenceSpans(s)) {
    const sentence = s.slice(start, end);
    if (isQuestion(sentence)) continue;
    for (const m of sentence.matchAll(HEALTH_CLAIM)) {
      if (!negated(sentence, m)) claims.push(m[0]);
    }
  }
  return claims;
}

/** What a {{find: …}} asks that is a health effect or a dose: none of it is looked up. */
const HEALTH_FIND = new RegExp(
  String.raw`(?<!\p{L})(?:${BODY_EN}|${BODY_TR}|side\s+effects?|clinical\p{L}*|benefits?|dose|dosage|doses|intake|servings?|absor\p{L}*|bioavailab\p{L}*|pregnan\p{L}*|safe|safety|deficien\p{L}*|overdose|yan\s+etki\p{L}*|doz\p{L}*|fayda\p{L}*|klinik\p{L}*|hamile\p{L}*|gebe\p{L}*|emilim\p{L}*|eksikli\p{L}*|güvenli\p{L}*)(?!\p{L})`,
  'iu',
);

/** The {{find: …}} a text has that ask for a health effect or a dose. */
export function healthFindsIn(text) {
  return marksIn(text).filter(
    (m) => /^\{\{\s*find\s*:/iu.test(m) && HEALTH_FIND.test(m.replace(/^\{\{\s*find\s*:/iu, '')),
  );
}

// ─── What the brand gave ────────────────────────────────────────────────────

/** A claim's words as two claims compare: stems of four letters, digits whole, no filler. */
const FILLER = new Set(
  'you your yours the a an some many most people adults it its them us our may might can could to of and or also more ol olur olabilir olabilmek olması bir ve ile'.split(
    ' ',
  ),
);
function claimWords(claim) {
  return claim
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (/\d/.test(w) ? w : w.slice(0, 4)));
}

/** HTML's lines as text, each block and line break apart (as contentAgent.js htmlLines). */
function linesOf(html) {
  const lines = [];
  editLines(cheerio.load(html || '', null, false), (text) => {
    lines.push(text);
    return [];
  });
  return lines;
}

/**
 * The health guard for a brand's page, or null when the brand isn't a
 * health one (isHealthBrand). It holds the claims the brand made in its
 * own words: the page (`html`), `texts` (the brand's name and description,
 * its rules, the writer's rules, its products' names) and Brief › Your
 * input among the numbered sources (its experience, its data, the quotes it
 * gave; never GetCito data's prompt, a buyer's words). A claim it makes in
 * a question or a disclaimer isn't one it made.
 */
export function healthGuard(brand, { html = '', texts = [], numbered = [] } = {}) {
  if (!isHealthBrand(brand)) return null;
  const given = [
    ...linesOf(html),
    ...texts,
    ...numbered
      .filter((s) => s.kind === 'input' && !String(s.ref).startsWith('getcito:'))
      .map(sourceWords),
  ];
  return { own: given.flatMap((text) => healthClaimsIn(String(text ?? ''))).map(claimWords) };
}

/**
 * Whether a claim is one the brand made: all of one of its claims' words in
 * it ("may help some people sleep" for "helps you sleep"), and no figure it
 * didn't give ("take 4 capsules" for "take 2 capsules").
 */
function brandMade(claim, guard) {
  const words = claimWords(claim);
  const digits = words.filter((w) => /\d/.test(w));
  return guard.own.some(
    (own) =>
      own.length > 0 && own.every((w) => words.includes(w)) && digits.every((d) => own.includes(d)),
  );
}

/** The health claims a text adds: each one the brand didn't make. [] without a guard. */
export function addedHealthClaims(text, guard) {
  if (!guard) return [];
  return [...new Set(healthClaimsIn(text).filter((claim) => !brandMade(claim, guard)))];
}

/**
 * Whether a text (a line, a passage as a replace leaves it) adds a health
 * claim the brand didn't make, or asks for one ({{find: …}}). False without
 * a guard.
 */
export function addsHealthClaim(text, guard) {
  if (!guard) return false;
  return addedHealthClaims(text, guard).length > 0 || healthFindsIn(text).length > 0;
}

/**
 * The suggestions without the ones that ask for a health claim to be looked
 * up ({{find: …}}), before the facts pass: none is searched. The claims
 * they make are read once they're placed (keepSuggestions), in their
 * passage's words.
 */
export function withoutHealthFinds(suggestions, guard) {
  if (!guard) return suggestions;
  return suggestions.filter((s) => healthFindsIn(String(s.after ?? '')).length === 0);
}

// ─── Taking one out of a page ───────────────────────────────────────────────

/**
 * The edits that take out of a page's text each sentence with a health
 * claim the brand didn't make, or a {{find: …}} for one, as the facts pass
 * takes out a sentence that says nothing without its fact; a heading, one
 * line, goes whole. Counted in `stats.health`.
 */
export function healthEdits(guard, stats = null) {
  return (text, heading) => {
    if (!guard) return [];
    const s = String(text ?? '');
    const spans = sentenceSpans(s);
    const drop = new Set();
    spans.forEach((span, i) => {
      if (addsHealthClaim(s.slice(span.start, span.end), guard)) drop.add(i);
    });
    if (!drop.size) return [];
    if (stats) stats.health = (stats.health ?? 0) + drop.size;
    return heading ? [{ start: 0, end: s.length, text: '' }] : dropEdits(spans, drop);
  };
}

/**
 * A page written whole (contentWriter.js pageSchema) without its health
 * claims, through `editPage` (contentWriter.js): a section left with no
 * words under its heading goes, and one whose heading went goes with it
 * (renderPage); an FAQ answer gone takes its question (renderPage).
 */
export function healthPage(page, guard, editPage, stats = null) {
  if (!guard) return page;
  const words = (section) =>
    [...section.paragraphs, ...section.bullets].some((t) => String(t ?? '').trim());
  const edited = editPage(page, healthEdits(guard, stats));
  return {
    ...edited,
    sections: edited.sections.filter((section, i) => !words(page.sections[i]) || words(section)),
  };
}

const HEADING_TAGS = 'h1, h2, h3, h4, h5, h6';
const levelOf = (el) => Number(el.name.slice(1));

/** Whether a heading has words under it, before the next heading at its level or above. */
function wordsUnder($, el) {
  for (const next of $(el).nextAll().get()) {
    if (/^h[1-6]$/.test(next.name) && levelOf(next) <= levelOf(el)) return false;
    if ($(next).text().trim() || $(next).find('img, table, iframe, video').length) return true;
  }
  return false;
}

/**
 * A page's HTML without its health claims (editHtml): a paragraph or a
 * list left empty goes (editHtml), a heading emptied goes, so a page left
 * with no H1 takes its own back (contentRewrite.js cleanPageHtml), and a
 * section heading (an FAQ question) whose words all went goes with them.
 */
export function healthHtml(html, guard, stats = null) {
  if (!guard) return html;
  // Each section heading with words under it, marked before the edits.
  const before = cheerio.load(html || '', null, false);
  before(HEADING_TAGS).each((_, el) => {
    if (el.name !== 'h1' && wordsUnder(before, el)) before(el).attr('data-health-words', '');
  });
  const marked = before.html();
  const edited = editHtml(marked, healthEdits(guard, stats));
  if (edited === marked) return html;
  const $ = cheerio.load(edited, null, false);
  // Last first: a question that goes leaves its section's heading with nothing under it.
  for (const el of $(HEADING_TAGS).get().reverse()) {
    const had = $(el).is('[data-health-words]');
    $(el).removeAttr('data-health-words');
    if (!$(el).text().trim() || (had && !wordsUnder($, el))) $(el).remove();
  }
  return $.html();
}
