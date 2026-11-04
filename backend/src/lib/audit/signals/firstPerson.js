/**
 * Sentences told in the first person ("we toured", "I made", "gezdik",
 * "düşünüyoruz"): the experience E-E-A-T's first-person signal looks for.
 * English by its pronouns, Turkish by its verb endings and pronouns, as a
 * Turkish sentence drops its subject. A quotation is someone else's words,
 * and a site's stock phrases ("Contact us", "We use cookies") no one's
 * experience: neither counts.
 */

/** Languages first person is read in. */
export const FIRST_PERSON_LANGUAGES = new Set(['en', 'tr']);

/** Quoted words, in double quotes of any kind: a single quote is also Turkish's apostrophe ("Kapadokya'yı"). */
const QUOTED = /"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»/g;

/** A sentence shorter than this is a label or a button, not one told by anyone. */
const MIN_WORDS = 3;

/** English's first-person words; "I" in capitals only, and none written in capitals ("US", "ME"). */
const EN_PRONOUN =
  /(?<![\p{L}'’])(?:I|[Ww]e|[Mm]e|[Uu]s|[Mm]y|[Oo]ur|[Mm]ine|[Oo]urs|[Mm]yself|[Oo]urselves)(?:['’](?:m|ve|d|ll|re))?(?![\p{L}'’])/u;
/** "Part I of", "World War I and": a numeral, not a person. */
const EN_NUMERAL_I = /(?<![\p{L}'’])I\s+(?:of|and|or|to|in|on|at|for|from|by|the|a|an)\b/u;
/** A site's stock phrases in English. */
const EN_STOCK =
  /\b(?:(?:contact|about|follow|join|email|e-mail|call|write to|talk to|chat with|reach|find|visit|message|text) us|let us know|why us|(?:sign up|subscribe) (?:to|for) our (?:newsletter|emails?|mailing list)|our (?:newsletter|privacy policy|cookie policy|terms(?: of (?:service|use))?)|we use cookies|all rights reserved)\b/gi;

/** Turkish's first-person pronouns, in their cases. */
const TR_PRONOUN = /^(?:biz(?:im|e|i|de|den|imle|ce)?|ben(?:im|i|de|den|imle|ce)?|bana)$/;
/** A voiceless consonant: the past tense's d turns t after one ("yaptık", "gittim"). */
const VOICELESS = 'çfhkpsşt';
/** Past tense, I or we: "gezdik", "kalktık", "yaptım", "durdum". */
const TR_PAST = /\p{L}([dt])[ıiuü][km]$/u;
/** Present, future and aorist, I or we, and "we are" ("düşünüyoruz", "unutmayacağız", "öneririz", "mutluyuz"). */
const TR_ENDINGS = [
  /[ıiuü]yor(?:um|uz)$/u,
  /[ae]c[ae][ğk][ıi][mz]$/u,
  /[ıiuüae]r[ıiuü]z$/u,
  /y[ıiuü]z$/u,
];
/** The aorist's "I" on a longer word only: "öneririm", not "durum" or "tarım". */
const TR_AORIST_I = /[ıiuüae]r[ıiuü]m$/u;
/** "Our", and the word it is on: "odamız", "rehberimizle", "otelimizde". */
const TR_OUR =
  /^(.*[aeıioöuü]m[ıiuü]z)(?:[ıiuü]n?|[ae]|[dt][ae]n?|l[ae]|[ıiuü]n[dt][ae]n?|[dt][ae]ki)?$/u;
/** Words that end like a first-person verb and aren't one. */
const TR_NOT = new Set([
  ...['fıstık', 'yastık', 'taktik', 'optik', 'yardım', 'adım', 'kadim', 'edim'],
  ...['tasarım', 'aktarım', 'onarım', 'temiz', 'domuz', 'omuz', 'semiz'],
]);
/** Loanwords on -stik: "plastik", "mistik", "akustik" (but "kestik" is "we cut"). */
const TR_LOAN = /[aiu]stik$/u;

/** Whether a Turkish word is in the first person. */
function turkishFirstPerson(word) {
  const w = word.toLocaleLowerCase('tr');
  if (TR_PRONOUN.test(w)) return true;
  if (TR_NOT.has(w) || TR_LOAN.test(w) || w.length < 4) return false;
  const past = TR_PAST.exec(w);
  if (past) {
    // A d after a voiced sound, a t after a voiceless one: "gezdik", "kalktık"; not "artık", "estetik".
    const before = w[w.length - 4];
    if ((past[1] === 't') === VOICELESS.includes(before)) return true;
  }
  if (TR_ENDINGS.some((re) => re.test(w))) return true;
  if (w.length >= 6 && TR_AORIST_I.test(w)) return true;
  // "temizle" is "clean", not "our": its word is one of those that only end like it.
  const our = TR_OUR.exec(w);
  return !!our && !TR_NOT.has(our[1]);
}

/** Whether a sentence is told in the first person, in English or Turkish. */
export function speaksFirstPerson(sentence, language) {
  const own = sentence.replace(QUOTED, ' ');
  const words = own.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu) ?? [];
  if (words.length < MIN_WORDS) return false;
  if (language === 'tr') return words.some(turkishFirstPerson);
  const told = own.replace(EN_STOCK, ' ').replace(EN_NUMERAL_I, ' ');
  return EN_PRONOUN.test(told);
}
