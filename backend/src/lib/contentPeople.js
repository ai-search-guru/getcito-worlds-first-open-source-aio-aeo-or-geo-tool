import * as cheerio from 'cheerio';
import { editSpans } from './editSpans.js';
import { logger } from './logger.js';

/**
 * No invented people or quotes (Content Editor Quality spec §9, CE-044).
 * Every person's name and quoted sentence the Content Agent writes must be
 * in what it was given: the page, the brand, the brief, the rules, the
 * person's data (Sources) or Settings › Authors. One that isn't is taken
 * out and a placeholder stands in its place, for the person to fill (a
 * to-do in Quality). As the number guard (contentSources.js), it reads the
 * words, never the model's say-so.
 *
 * A name is read where a person is plainly meant: after Dr./Prof./Mr./Ms.,
 * next to a role ("CEO Jane Doe", "Jane Doe, head of sales", "Jane Doe
 * (CEO)", "Geschäftsführerin Anna Schmidt", "pazarlama müdürü Ayşe
 * Yılmaz"), or with a verb only people do ("Jane Doe said", "told Jane
 * Doe"); a product or a company recommends, adds or describes too ("Google
 * Ads recommends"), and "according to" / "…'a göre" go with a tool as well
 * ("Google Analytics'e göre"). A name or a quote is known when
 * what the agent was given has it as whole words ("Chen" isn't in
 * "kitchen"). A quoted sentence is two words or more in
 * quotation marks next to speech, four or more anywhere, or a blockquote or
 * <q>; a term in quotes ("AI visibility") is no quote. Headings are read
 * for quotes and speech only: their capitals aren't names.
 */

export const NAME_PLACEHOLDER = '[name of a real person]';
export const QUOTE_PLACEHOLDER = '[quote from a real person, with its source]';

/** A quote this short is a term in quotes, unless someone is said to say it. */
const MIN_QUOTE_WORDS = 4;

/**
 * Words as compared, whole: lowercased, with what isn't a letter, a mark or
 * a digit (quotes, apostrophes, punctuation, spaces) as one space ("O'Neil"
 * → "o neil", the same on both sides).
 */
const wordsOf = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

/** What the agent was given, read as one text names and quotes are looked up in. */
export function knownPeople(...texts) {
  return { words: ` ${wordsOf(texts.filter(Boolean).join('\n'))} ` };
}

/** Whether what the agent was given has these words, whole: "Chen" isn't in "kitchen". */
export const isKnown = (words, known) => {
  const needle = wordsOf(words);
  return needle.length > 0 && known.words.includes(` ${needle} `);
};

const wordCount = (text) => (String(text).match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length;

// A capitalised word of a name ("Ada", "McDonald", "O'Neil", "Jean-Luc"): one
// way to read it only (the lookahead checks it has a small letter, reading
// only what the word can hold), so a long word can't make the reading slow;
// an apostrophe only before a capital ("O'Neil", not "Yılmaz'a" or
// "Doe's"). Initials ("J. K. Rowling"), and particles between the words
// ("Ursula von der Leyen").
const WORD = String.raw`\p{Lu}(?=(?:\p{L}|['’](?=\p{Lu}))*?\p{Ll})(?:\p{L}|['’](?=\p{Lu}))+(?:-\p{L}+)?`;
const PARTICLE = String.raw`(?:von|van|der|den|de|del|della|di|da|du|la|le|al|bin|ibn|ten|ter)`;
const STARTS_PARTICLE = new RegExp(`^${PARTICLE}$`);
// Never started inside a word, an apostrophe's either: a run of letters
// joined by apostrophes ("Ab’Ab’Ab’…") would be tried at each capital in it,
// and read in time growing with its square (#1544 review).
export const NAME = String.raw`(?<!\p{L}|\p{L}['’])(?:(?:\p{Lu}\.\s?){1,3}\s?${WORD}|${WORD}(?:\s+(?:${PARTICLE}\s+){0,3}(?:\p{Lu}\.\s+)?${WORD}){1,2})(?!\p{L})`;

const ROLE_WORDS = [
  'ceo',
  'cto',
  'cfo',
  'coo',
  'cmo',
  'vp',
  'founder',
  'co-founder',
  'cofounder',
  'president',
  'chairman',
  'chairwoman',
  'director',
  'professor',
  'analyst',
  'researcher',
  'editor',
  'economist',
  'scientist',
  'consultant',
  'journalist',
  'spokesperson',
  'spokesman',
  'spokeswoman',
  'expert',
  'specialist',
  'strategist',
  'marketer',
  'engineer',
  'author',
  'advisor',
  'adviser',
  'coach',
  'designer',
  'developer',
  'writer',
  'owner',
  'officer',
  'executive',
  'manager',
  'lead',
  'chief',
  'head of',
  'vice president',
  'doctor',
  'physician',
  'lawyer',
  'attorney',
  'therapist',
  'nutritionist',
  'dietitian',
  'trainer',
  'chef',
  'barista',
];
/** German roles: nouns, so written with a capital ("Geschäftsführerin Anna Schmidt"). */
const ROLE_WORDS_DE = [
  'gründer',
  'gründerin',
  'geschäftsführer',
  'geschäftsführerin',
  'leiter',
  'leiterin',
  'experte',
  'expertin',
  'inhaber',
  'inhaberin',
  'direktor',
  'direktorin',
  'sprecher',
  'sprecherin',
];
/**
 * German compound roles, one word: any "-chef" ("Finanzchef",
 * "Küchenchefin"), and the "-leiter" ones that are posts ("Vertriebsleiter",
 * "Werkstattleiterin"). Other "-leiter" words are ladders and conductors
 * ("Teleskopleiter", "Halbleiter", "Schutzleiter"), and a bare "Chef" is a
 * product too ("Chef Infra Server").
 */
const LEITER_POSTS = [
  'vertriebs',
  'abteilungs',
  'projekt',
  'team',
  'filial',
  'werkstatt',
  'bereichs',
  'marketing',
  'produkt',
  'personal',
  'presse',
  'gruppen',
  'niederlassungs',
  'labor',
  'studien',
  'einkaufs',
  'entwicklungs',
  'kommunikations',
  'redaktions',
  'betriebs',
];
/**
 * Not read before a name: "Leiter" is a ladder too, and a title follows it
 * ("Leiter Vertrieb Europa"). After a name, and with a verb, it still is.
 */
const NOT_BEFORE_NAME = new Set(['leiter', 'leiterin']);
/** A German compound role, as LEITER_POSTS says (eitherCase below). */
const roleCompoundsDe = () =>
  String.raw`(?:\p{Lu}\p{Ll}+chef(?:in)?|(?:${LEITER_POSTS.map(eitherCase).join('|')})leiter(?:in)?)`;
/** Turkish roles ("pazarlama müdürü", "kurucumuz"), with a capital at a sentence's start. */
const ROLE_WORDS_TR = ['kurucu', 'uzman', 'müdür', 'direktör', 'yönetici', 'danışman'];
/** Words of a Turkish title around a role, not of the name ("Kurucu Ortak", "Müdür Yardımcısı"). */
const TITLE_WORDS_TR = ['ortak', 'ortağ', 'yardımcı'];
/**
 * Departments and features that follow a role in a title or a product name,
 * not a person's name ("Uzman Destek Ekibi", "Direktor Vertrieb Europa"):
 * no name is read right after a role when one comes next, and one is
 * skipped as a role is. A business right after a role ("Inhaberin Café
 * Sonnenschein") still reads as a person: German puts "des" or "vom"
 * between them, so it is rare.
 */
const TITLE_NOUNS = new Set(
  (
    'destek ekip ekibi panel paneli hizmet hizmeti hizmetleri satış pazarlama finans teknik ürün müşteri ' +
    'vertrieb marketing technik finanzen produkt personal einkauf entwicklung forschung kommunikation'
  ).split(' '),
);
/**
 * A Turkish role's possessive. "-(ı)mız" is the speaker's own ("kurucumuz
 * Ali Kaya"): a person. Bare "-(s)ı" may name a trade ("bir pazarlama
 * uzmanı Google Analytics'i açar"), so a name after it is read only before
 * "'a göre", a verb said of people or a sentence's end.
 */
const TR_OURS = String.raw`(?:[ıiuü]?m[ıiuü]z)?`;
const TR_ITS = String.raw`(?:[ıiuü]|s[ıiuü])`;
const TR_ANY = String.raw`(?:${TR_ITS}|[ıiuü]?m[ıiuü]z)?`;
const ABBREVIATIONS = new Set(['ceo', 'cto', 'cfo', 'coo', 'cmo', 'vp']);
const spaced = (role) => role.replace(/ /g, String.raw`\s+`);
/** A role with its first letter in either case. */
const eitherCase = (role) =>
  `[${role[0].toLocaleUpperCase('tr')}${role[0].toUpperCase()}${role[0]}]${spaced(role.slice(1))}`;
/**
 * A role as written before a name: English lowercase, or an abbreviation
 * ("CEO"), so a product called "Director Pro" isn't one; German and Turkish
 * in either case, a Turkish one bare or with "-(ı)mız".
 */
const ROLE_LOWER = `(?:${[
  ...ROLE_WORDS.map((r) => (ABBREVIATIONS.has(r) ? r.toUpperCase() : spaced(r))),
  ...ROLE_WORDS_DE.filter((r) => !NOT_BEFORE_NAME.has(r)).map(eitherCase),
  ...ROLE_WORDS_TR.map((r) => eitherCase(r) + TR_OURS),
  roleCompoundsDe(),
].join('|')})`;
/**
 * A Turkish role with "-(s)ı" ("müdürü"): a name after it is read only
 * before "'a göre", a verb said of people or a sentence's end.
 */
const ROLE_TR_ITS = `(?:${ROLE_WORDS_TR.map((r) => eitherCase(r) + TR_ITS).join('|')})`;
/** A role in either case, after a name ("Head of Sales", "pazarlama müdürü"). */
const ROLE_ANY = `(?:${[
  ...ROLE_WORDS.map((r) => (ABBREVIATIONS.has(r) ? r.toUpperCase() : eitherCase(r))),
  ...ROLE_WORDS_DE.map(eitherCase),
  ...ROLE_WORDS_TR.map((r) => eitherCase(r) + TR_ANY),
  roleCompoundsDe(),
].join('|')})`;
/** Role and title words, to tell them from the name after them ("Founder Jane Doe", "Müdürü Ayşe"). */
const ROLE_SET = new Set([...ROLE_WORDS, ...ROLE_WORDS_DE].filter((r) => !r.includes(' ')));
const ROLE_TR = new RegExp(
  `^(?:${[...ROLE_WORDS_TR, ...TITLE_WORDS_TR].join('|')})${TR_ANY}$`,
  'u',
);
export const isRole = (lower) =>
  ROLE_SET.has(lower) || ROLE_TR.test(lower) || TITLE_NOUNS.has(lower);
/** No title word next, as the first word after a role ("Yönetici Paneli Giriş Sayfası"). */
const NOT_TITLE_NEXT = `(?!(?:${[...TITLE_NOUNS].map(eitherCase).join('|')})(?!\\p{L}))`;

/** Speech, read with a quote: whoever or whatever says it, it is a quote. */
export const SPEECH = String.raw`(?:says|said|told|tells|explains|explained|notes|noted|writes|wrote|recalls|recalled|adds|added|argues|argued|believes|warns|warned|states|stated|puts it|put it|emphasi[sz]es|emphasi[sz]ed|suggests|suggested|recommends|recommended|advises|advised|points out|pointed out|shares|shared|observes|observed|insists|insisted|admits|admitted|comments|commented|agrees|agreed|claims|claimed|predicts|predicted|describes|described|sagt|sagte|meint|erklärt|dit|explique|dice|explica|afirma|söyledi|diyor|belirtti|açıkladı|dedi|anlattı)`;
/**
 * Verbs said of people only, read with a name that has no honorific or role
 * ("Marco Rossi said"): the rest of SPEECH a product or a company does too
 * ("Google Ads recommends", "Microsoft Teams adds", "Product Hunt
 * describes"), so those read a name only with an honorific or a role.
 */
const PERSON_SPEECH = String.raw`(?:said|told|explained|recalled|admitted|insisted|argued|sagte|erzählte|söyledi|dedi|anlattı)`;
/**
 * Saying a quote, as only a person does, right next to it ("“…,” says Jane
 * Doe", "“…,” Jane Doe says"): a company or a product recommends, adds and
 * notes too ("“…,” recommends Northwind Finance").
 */
const QUOTE_SAYS = String.raw`(?:says|said|told|sagt|sagte|meint|erzählte|diyor|dedi|söyledi|söylüyor|anlattı)`;
/** A quote's closing mark: curly, straight, angle, German and single. */
const QUOTE_END = String.raw`[”“"»«’‘]`;
/**
 * Turkish verbs said of people, at a sentence's end after a role's name and
 * a comma or "da/de" ("genel müdürü Ayşe Demir, … söyledi"): not when the
 * name is the first of a list ("uzmanı Shopify Plus, WooCommerce ve Magento
 * … açıklıyor"), nor with "de dahil" ("Google Analytics de dahil").
 */
const TR_SAYS = String.raw`(?:söyledi|söylüyor|dedi|diyor|anlattı|anlatıyor|belirtti|belirtiyor|açıkladı|açıklıyor|vurguladı|vurguluyor|ifade\s+etti)`;
/**
 * Verbs that also mean added, saved, transferred and shared, said of a
 * tool as well ("Shopify Plus da kullanarak ürünleri ekledi"): read only
 * after reported speech ("…olduğunu ekliyor", "…olduklarını da ekledi",
 * "…geleceğini sözlerine ekledi").
 */
const TR_SAYS_ALSO = String.raw`(?:ekledi|ekliyor|aktardı|aktarıyor|paylaştı|paylaşıyor|kaydetti)`;
const TR_REPORTED = String.raw`(?:[dt][ıiuü](?:ğ|kl[ae]r)[ıiuü]n[ıiuü]|[ae]c[ae](?:ğ|kl[ae]r)[ıiuü]n[ıiuü])`;
const TR_SAID = String.raw`(?:(?<!\p{L})${TR_SAYS}|${TR_REPORTED}(?:\s+(?:da|de|sözlerine))?\s+${TR_SAYS_ALSO})`;

/**
 * Where a name plainly means a person: the name is the group "name", with
 * how many words it needs; `role` cues aren't read in headings.
 */
const NAME_CUES = [
  // "Dr. Jane Doe", "Dr. Doe": the honorific goes with the name.
  {
    re: new RegExp(
      String.raw`(?<!\p{L})(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.\s*(?<name>${WORD}(?:\s+${WORD}){0,2})(?!\p{L})`,
      'gu',
    ),
    words: 1,
    honorific: true,
  },
  {
    re: new RegExp(String.raw`(?<!\p{L})(?:Dr|Prof|Mr|Mrs|Ms|Mx)\s+(?<name>${NAME})`, 'gu'),
    words: 2,
    honorific: true,
  },
  // "CEO Jane Doe", "SEO expert Sarah Chen".
  {
    re: new RegExp(String.raw`(?<!\p{L})${ROLE_LOWER}\s+${NOT_TITLE_NEXT}(?<name>${NAME})`, 'gu'),
    words: 2,
    role: true,
  },
  // "pazarlama müdürü Ayşe Yılmaz'a göre", "uzmanı Deniz Ak anlattı.": a
  // trade's "-(s)ı" names a person only before "'a göre" ("'ın söylediğine
  // göre"), a verb said of people or a sentence's end. A tool takes the
  // other case suffixes and sits in lists as a person does ("uzmanı Google
  // Analytics'i açar"); a name before a comma is given up with them.
  {
    re: new RegExp(
      String.raw`(?<!\p{L})${ROLE_TR_ITS}\s+${NOT_TITLE_NEXT}(?<name>${NAME})(?=\s*[.!?)]|['’](?:a|e|ya|ye|na|ne|n?[ıiuü]n\s+(?:söylediğine|dediğine|belirttiğine|anlattığına))\s+göre(?!\p{L})|\s+${PERSON_SPEECH}(?!\p{L})|(?:,(?!\s*${WORD}(?:\s+${WORD}){0,2}\s*(?:,|\s+(?:ve|veya|ile)(?!\p{L})))|\s+d[ae](?!\s+dahil)(?!\p{L}))[^.!?]{0,160}?${TR_SAID}\s*[.!?])`,
      'gu',
    ),
    words: 2,
    role: true,
  },
  // "Jane Doe, head of sales", "Sarah Chen, a marketing strategist at Acme".
  {
    re: new RegExp(String.raw`(?<name>${NAME}),\s+(?:[\p{L}-]+\s+){0,3}${ROLE_ANY}(?!\p{L})`, 'gu'),
    words: 2,
    role: true,
  },
  // "Jane Doe (CEO of Acme)".
  {
    re: new RegExp(
      String.raw`(?<name>${NAME})\s*\(\s*(?:[\p{L}-]+\s+){0,2}${ROLE_ANY}(?!\p{L})`,
      'gu',
    ),
    words: 2,
    role: true,
  },
  // "Sarah, our head of growth", at a sentence's start: a single name. A
  // capital first, so the lookbehind (ending in spaces) isn't tried in a
  // run of them: tried at each, a long run reads in time growing with its square.
  {
    re: new RegExp(
      String.raw`(?=\p{Lu})(?<=^|[.!?]\s+|[“"]\s*)(?<name>${WORD}),\s+(?:our|the|a|an|their|its)\s+(?:[\p{L}-]+\s+){0,3}${ROLE_ANY}(?!\p{L})`,
      'gu',
    ),
    words: 1,
    role: true,
  },
  // Whoever says a quote, right next to it: "“…,” says Jane Doe", "„…“,
  // sagt Anna Schmidt", "“…” diyor Ayşe Demir", "“…,” Jane Doe says". The
  // spaces read one way only (a mark between, or none), so a quote mark
  // before a long run of them reads in time growing with the run, not its square.
  {
    re: new RegExp(
      String.raw`${QUOTE_END}\s*(?:[,.!?]\s*)?${QUOTE_SAYS}(?!\p{L})\s+(?<name>${NAME})`,
      'gu',
    ),
    words: 2,
  },
  {
    re: new RegExp(
      String.raw`${QUOTE_END}\s*(?:[,.!?]\s*)?(?<name>${NAME})\s+${QUOTE_SAYS}(?!\p{L})`,
      'gu',
    ),
    words: 2,
  },
  // "This works for every team, says Tom Becker." — after a comma, with the
  // sentence stopping at the name. A product "says" too ("…, says Google
  // Ads."), and gets the placeholder: a trade made for the person's case,
  // which is the likelier one.
  {
    re: new RegExp(
      String.raw`,\s*(?:says|sagt|diyor)\s+(?<name>${NAME})(?=\s*(?:[.,;:!?)]|$))`,
      'gu',
    ),
    words: 2,
  },
  // A customer's story is a person's (or a business's, made up all the
  // same): "our customer Jana Novak", "müşterimiz Jana Novak", "unsere
  // Kundin Jana Novak". Not a bare "client" ("the email client Microsoft
  // Outlook") nor "customer" in a name ("Customer Data Platform").
  {
    re: new RegExp(
      String.raw`(?<!\p{L})(?:(?:[Oo]ur|[Aa]|[Oo]ne|[Tt]heir)\s+(?:customer|client)|[Mm]üşteri(?:miz|lerimizden(?:\s+biri)?)|(?:[Uu]nser(?:e|er)?|[Ee]ine?r?)\s+(?:Kundin|Kunde))\s+(?<name>${NAME})`,
      'gu',
    ),
    words: 2,
    role: true,
  },
  // "Jane Doe said", "Anna Schmidt sagte".
  { re: new RegExp(String.raw`(?<name>${NAME})\s+${PERSON_SPEECH}(?!\p{L})`, 'gu'), words: 2 },
  // "said Jane Doe.", "told by Jane Doe," — a name the sentence stops at.
  // "According to" isn't read: it goes with a tool as well ("according to
  // Google Analytics"), and with a role a name is read all the same.
  {
    re: new RegExp(
      String.raw`(?<!\p{L})${PERSON_SPEECH}(?:\s+by)?\s+(?<name>${NAME})(?=\s*(?:[.,;:!?)]|$))`,
      'gu',
    ),
    words: 2,
  },
  // "…'a göre" isn't read, as "according to" isn't: a tool goes with it too
  // ("Google Analytics'e göre"), and with a role a name is read all the same.
];

/** Capitalised words that start a sentence, not a name ("The team said", "As Ada says"). */
export const NOT_NAMES = new Set(
  (
    'the this that these those our your their his her its a an every each some most many one we they it ' +
    'as when if but and so then while because after before like unlike for in on at by with from to of ' +
    'also yet still now here there what why how who where which ' +
    // German articles and the words a sentence starts with before a name.
    'der die das dem den des ein eine einer wie laut'
  ).split(' '),
);
/** A name after these is a place ("In Silicon Valley, the founder…"). */
const PLACE_BEFORE = new Set(
  'in at on from across near around throughout within inside outside into'.split(' '),
);
/** A name ending so is a publication or a body, not a person ("Search Engine Land"). */
const NOT_PEOPLE = new Set(
  (
    'research review journal land institute university times post news magazine report group inc ' +
    'labs media press daily weekly today central console insights foundation association council ' +
    'agency bureau center centre school academy college team blog ' +
    'zeitung online allgemeine corp gmbh ltd llc ag'
  ).split(' '),
);

/**
 * A name as matched, without the sentence words, adverbs and roles before
 * it: its start in the match and its words, or null when what is left
 * isn't a person's name, or all or a part of it is known.
 */
function personIn(name, minWords, known) {
  const words = name.split(/\s+/);
  let start = 0;
  while (words.length) {
    const lower = words[0].toLowerCase();
    if (PLACE_BEFORE.has(lower)) return null;
    if (!NOT_NAMES.has(lower) && !isRole(lower) && !/^\p{L}+ly$/u.test(lower)) break;
    start = name.indexOf(words[1] ?? '', start + words[0].length);
    words.shift();
  }
  if (words.length < minWords) return null;
  if (NOT_PEOPLE.has(words.at(-1).toLowerCase())) return null;
  // The person's own name may be all of it, or its end of two words at
  // least ("Recently Jane Doe"), or its start of two words at least before
  // a particle (a company after it: "Ada Lovelace von Northwind") or before
  // words the agent was given each (German capitalises nouns: "weil
  // Gründerin Anna Schmidt Kaffee liebt"). A known first or last name alone
  // ("Dr. Grace Kim" beside Grace Hopper, "Dr. Jane Hopper"), or a common
  // word ("Dr. Mark Wilson"), lets no invented name through. The trade: a
  // known name before a word the page has ("Ada Lovelace Brown" on a page
  // that says "brown") is read as the known one.
  for (let i = 0; words.length - i >= (i === 0 ? minWords : Math.max(2, minWords)); i++) {
    if (isKnown(words.slice(i).join(' '), known)) return null;
  }
  for (let j = words.length - 1; j >= Math.max(2, minWords); j--) {
    const after = STARTS_PARTICLE.test(words[j]) || words.slice(j).every((w) => isKnown(w, known));
    if (after && isKnown(words.slice(0, j).join(' '), known)) return null;
  }
  return { start, name: name.slice(start) };
}

/**
 * A quoted sentence: in curly, low-high, angle or straight quotation marks
 * (a straight one not after a number: 27" is inches), or in curly single
 * ones around words (not an apostrophe's).
 */
const QUOTES = [
  // »…« (German, Danish) hugs its words: French never opens with », and
  // spaces its own « … », so a span with a space inside its marks is the
  // words between two French quotes.
  /»(?=\S)([^»«]{1,800})(?<=\S)«/g,
  /‚([^‚‘’]{1,800})[‘’]/g,
  /“([^“”]{1,800})”/g,
  /„([^„“”]{1,800})[“”]/g,
  /«([^«»]{1,800})»/g,
  /(?<![\p{L}\p{N}])"([^"\n]{1,800})"(?![\p{L}\p{N}])/gu,
  /(?<!\p{L})‘([^‘]{1,800}?)’(?!\p{L})/gu,
];
/** Speech right after a quote ("…,” said Jane Doe") or right before it ("Jane Doe said: “…"). */
const SPOKEN_AFTER = new RegExp(
  String.raw`^[,.!?]?\s*(?:${SPEECH}(?!\p{L})|${NAME}\s+${SPEECH}(?!\p{L}))`,
  'u',
);
const SPOKEN_BEFORE = new RegExp(String.raw`${SPEECH}[,:]?\s*$`, 'u');

/**
 * A placeholder the agent left, or one put in: never read again. Never one
 * with another "[" in it, so an opening bracket with no closing one isn't
 * read to the text's end from each "[" after it.
 */
const BRACKETS = /\[[^[\]]*\]/g;

/**
 * Whether guillemets enclose the words between two quotes («A» ve «B»,
 * German »A« und »B«): their marks hug the words outside them, a letter
 * right before the first and right after the last. A quote's marks hug
 * the words inside it (»Das …«, «Haftalık …»), or are spaced (« Bonjour »).
 */
const betweenQuotes = (text, start, end) =>
  /\p{L}/u.test(text[start - 1] ?? '') && /\p{L}/u.test(text[end] ?? '');

/**
 * The names and quoted sentences in a text that what the agent was given
 * doesn't have, as edits { start, end, text } (the placeholder), in order
 * and apart. A heading's role cues aren't read: its capitals aren't names.
 */
export function peopleEdits(text, known, { heading = false } = {}) {
  const s = String(text ?? '');
  // Placeholders aren't read: blanked out, with their places kept.
  const read = s.replace(BRACKETS, (m) => ' '.repeat(m.length));
  const { spans: edits, free, add } = editSpans();

  for (const pattern of QUOTES) {
    for (const m of read.matchAll(pattern)) {
      const end = m.index + m[0].length;
      // Guillemets between two quotes, not around one.
      if ((m[0][0] === '«' || m[0][0] === '»') && betweenQuotes(read, m.index, end)) continue;
      // The words as written, a placeholder in them too.
      const inner = s.slice(m.index + 1, end - 1);
      const words = wordCount(inner);
      if (words < 2) continue;
      const spoken =
        SPOKEN_AFTER.test(read.slice(end, end + 80)) ||
        SPOKEN_BEFORE.test(read.slice(Math.max(0, m.index - 40), m.index));
      if ((words < MIN_QUOTE_WORDS && !spoken) || isKnown(inner, known)) continue;
      if (free(m.index, end)) add({ start: m.index, end, text: QUOTE_PLACEHOLDER });
    }
  }
  for (const cue of NAME_CUES) {
    if (heading && cue.role) continue;
    for (const m of read.matchAll(cue.re)) {
      const at = m.index + m[0].indexOf(m.groups.name);
      const person = personIn(m.groups.name, cue.words, known);
      if (!person) continue;
      const start = cue.honorific ? m.index : at + person.start;
      const end = at + person.start + person.name.length;
      if (free(start, end)) add({ start, end, text: NAME_PLACEHOLDER });
    }
  }
  return edits;
}

/** A text with each unknown name and quote put as a placeholder, and the edits made. */
export function guardPeople(text, known, options) {
  const s = String(text ?? '');
  const edits = peopleEdits(s, known, options);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += s.slice(at, e.start) + e.text;
    at = e.end;
  }
  return { text: out + s.slice(at), edits };
}

/** Tags whose text a page's placeholders never touch: code and what isn't words. */
const KEPT_AS_IS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'textarea',
  'code',
  'pre',
]);
/** Tags that hold a line of their own: the text in one is read together. */
const BLOCKS = new Set(
  (
    'p li ul ol dl dd dt h1 h2 h3 h4 h5 h6 blockquote figure figcaption table thead tbody tfoot tr ' +
    'td th caption div section article aside header footer main details summary'
  ).split(' '),
);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** The text nodes under a node, in order: its words as htmlText reads them. */
function textNodes($, el) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') out.push(node);
      else if (node.type === 'tag' && !KEPT_AS_IS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($(el).contents().get());
  return out;
}

/**
 * An HTML page or insert with each unknown name and quote put as a
 * placeholder, in its words only. A blockquote or <q> is a quote whatever
 * its marks: one whose words aren't known becomes one placeholder, and an
 * unknown name in its cite one too. Each line's text is read together,
 * across the bold and the links in it. Returns the HTML (as it was when
 * nothing is put) and how many were put in.
 */
export function guardPeopleInHtml(html, known) {
  const $ = cheerio.load(html || '', null, false);
  let count = 0;
  $('blockquote, q').each((_, el) => {
    // Its words, without the cite that says whose they are.
    const words = textNodes($, el)
      .filter((n) => !$(n).closest('cite, footer').length)
      .map((n) => n.data)
      .join(' ');
    if (wordCount(words) >= 2 && !isKnown(words, known)) {
      if (el.name === 'q') $(el).replaceWith(QUOTE_PLACEHOLDER);
      else $(el).html(`<p>${QUOTE_PLACEHOLDER}</p>`);
      count += 1;
      return;
    }
    $(el)
      .find('cite, footer')
      .each((__, by) => {
        const name = textNodes($, by)
          .map((n) => n.data)
          .join(' ');
        const words = wordCount(name);
        if (words && words <= 6 && !isKnown(name, known)) {
          $(by).text(NAME_PLACEHOLDER);
          count += 1;
        }
      });
  });

  count += editLines($, (text, heading) => peopleEdits(text, known, { heading }));
  if (!count) return { html, count };
  return { html: $.html(), count };
}

/**
 * Edits a loaded HTML's words line by line: each line's text, its own text
 * nodes and its inline tags' (bold, links) in order, read as one, so a name
 * or a phrase across a link is read whole and an entity is read as its
 * character ("AT&T", never "AT&amp;T"). `editsFor(text, heading)` gives a
 * line's edits, { start, end, text }, apart and in order; each goes in the
 * text node it starts in, the rest of its words cut. A link or a bold whose
 * words all went goes too. Code and what isn't words are left alone.
 * Returns how many edits were made.
 */
export function editLines($, editsFor) {
  let count = 0;
  const BREAK = Symbol('line end');
  // A line: its own text nodes and its inline tags', in order, read as one.
  const line = (nodes, heading) => {
    if (!nodes.length) return;
    const joined = nodes.map((n) => n.data).join('');
    const edits = editsFor(joined, heading);
    if (!edits.length) return;
    count += edits.length;
    const starts = [];
    let at = 0;
    for (const n of nodes) {
      starts.push(at);
      at += n.data.length;
    }
    // Each node's text built once from its pieces between the edits (in
    // order and apart): the placeholder goes in the node the edit starts in;
    // the rest of its words are cut. Rebuilt per edit, a line with thousands
    // would take their count times its length (#1544 review).
    let first = 0;
    nodes.forEach((n, i) => {
      const from = starts[i];
      const to = from + n.data.length;
      while (first < edits.length && edits[first].end <= from) first++;
      let out = '';
      let at = 0;
      let touched = false;
      for (let j = first; j < edits.length && edits[j].start < to; j++) {
        const e = edits[j];
        touched = true;
        out += n.data.slice(at, Math.max(at, e.start - from)) + (e.start >= from ? e.text : '');
        at = Math.min(n.data.length, e.end - from);
      }
      if (touched) n.data = out + n.data.slice(at);
    });
  };
  // An inline tag's text, with any line inside it read on its own: a line
  // break or a block in a bold or a link ends the line there too (BREAK).
  const inlineText = (el) => {
    const out = [];
    for (const node of $(el).contents().get()) {
      if (node.type === 'text') out.push(node);
      else if (node.type !== 'tag' || KEPT_AS_IS.has(node.name)) continue;
      else if (node.name === 'br') out.push(BREAK);
      else if (BLOCKS.has(node.name)) {
        out.push(BREAK);
        walk(node, HEADINGS.has(node.name));
      } else out.push(...inlineText(node));
    }
    return out;
  };
  const walk = (el, heading) => {
    let run = [];
    for (const node of $(el).contents().get()) {
      if (node.type === 'text') run.push(node);
      else if (node.type !== 'tag' || KEPT_AS_IS.has(node.name)) continue;
      // A line break ends a line: "Gartner<br>The plan" is two.
      else if (node.name === 'br') {
        line(run, heading);
        run = [];
      } else if (BLOCKS.has(node.name)) {
        line(run, heading);
        run = [];
        walk(node, HEADINGS.has(node.name));
      } else {
        for (const piece of inlineText(node)) {
          if (piece !== BREAK) run.push(piece);
          else {
            line(run, heading);
            run = [];
          }
        }
      }
    }
    line(run, heading);
  };
  walk($.root(), false);
  if (count) {
    // A link or a bold whose words all went with an edit goes too.
    $('a, strong, em, b, i, u, s, span, mark, small, sup, sub').each((_, el) => {
      if (!$(el).text() && !$(el).find('img, br').length) $(el).remove();
    });
  }
  return count;
}

/**
 * The words of the workspace's authors (Settings › Authors): names, titles
 * and bios a page may name them by. One that can't be read (content_authors
 * not there yet, a failed read) is logged and reads as none: the run goes
 * on, and an author's name it writes becomes a placeholder like any other.
 */
export async function authorWords(db, organizationId, log = logger) {
  try {
    const { data, error } = await db
      .from('content_authors')
      .select('name, title, bio')
      .eq('organization_id', organizationId);
    if (error) throw error;
    return (data ?? []).flatMap((a) => [a.name, a.title, a.bio]).filter(Boolean);
  } catch (err) {
    log.warn({ err, organizationId }, '[content-people] authors not read');
    return [];
  }
}
