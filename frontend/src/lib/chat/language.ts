/**
 * The language of a Chat answer (CHAT-05 item 2; owner decision 2026-10-31:
 * the question's language). The writer reads the person's question first
 * and then pages of English data, and a small model answers in the data's
 * language: Claude Haiku 5.5 answered a Turkish question in English in Chat's
 * model test set (W4-35, 2026-11-03). So the engine names the question's
 * language as the turn's last line, and, when an answer still comes out in
 * English for a question in another language, has it rewritten once.
 *
 * Read from common words and letters, for the languages Chat's people write
 * in most; null when a text is too short or unclear, and then nothing is
 * said or rewritten. Pure.
 */

export const LANGUAGES = {
  en: 'English',
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
} as const;

export type Language = keyof typeof LANGUAGES;

/** Each language's most common short words: what tells it apart in a sentence or two. */
const WORDS: Record<Language, readonly string[]> = {
  en: [
    'the',
    'and',
    'is',
    'are',
    'to',
    'of',
    'what',
    'why',
    'how',
    'did',
    'we',
    'our',
    'this',
    'that',
    'for',
    'with',
    'you',
    'it',
    'was',
    'do',
    'can',
    'my',
  ],
  tr: [
    've',
    'bir',
    'bu',
    'ne',
    'neden',
    'nasıl',
    'için',
    'mi',
    'mı',
    'mu',
    'mü',
    'ile',
    'çok',
    'daha',
    'gibi',
    'biz',
    'bizim',
    'hafta',
    'nedir',
    'var',
    'yok',
    'şu',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'ist',
    'nicht',
    'wie',
    'warum',
    'wir',
    'unser',
    'mit',
    'für',
    'auf',
    'ein',
    'eine',
    'zu',
    'im',
    'den',
    'von',
    'es',
    'sind',
    'diese',
  ],
  fr: [
    'le',
    'les',
    'et',
    'est',
    'pourquoi',
    'comment',
    'nous',
    'notre',
    'avec',
    'pour',
    'sur',
    'une',
    'des',
    'du',
    'que',
    'ce',
    'pas',
    'cette',
    'sont',
    'dans',
  ],
  es: [
    'el',
    'los',
    'las',
    'y',
    'es',
    'por',
    'qué',
    'cómo',
    'nuestro',
    'nuestra',
    'con',
    'para',
    'una',
    'del',
    'que',
    'se',
    'esta',
    'este',
    'hemos',
    'son',
  ],
  it: [
    'il',
    'gli',
    'è',
    'perché',
    'nostro',
    'nostra',
    'per',
    'che',
    'non',
    'di',
    'questa',
    'questo',
    'sono',
    'siamo',
  ],
  pt: [
    'os',
    'é',
    'nosso',
    'nossa',
    'com',
    'uma',
    'do',
    'não',
    'são',
    'caiu',
    'nós',
    'você',
    'isso',
  ],
  nl: [
    'het',
    'en',
    'waarom',
    'hoe',
    'wij',
    'ons',
    'onze',
    'met',
    'voor',
    'op',
    'een',
    'van',
    'dat',
    'niet',
    'zijn',
    'deze',
    'ik',
  ],
};

/** Letters only one of them uses, each a strong sign. */
const LETTERS: Partial<Record<Language, RegExp>> = {
  tr: /[ğşıİĞŞ]/g,
  de: /[ß]/g,
  es: /[ñ¿¡]/g,
  pt: /[ãõ]/g,
};

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    // Code, links and Markdown tell nothing about the language.
    .replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|\[[^\]]*\]\([^)]*\)/g, ' ')
    .split(/[^\p{L}']+/u)
    .map((word) => word.replace(/'.*$/, ''))
    .filter(Boolean);

/**
 * A text's language: the one whose common words and letters it has most,
 * with at least 2 signs and well ahead of the next; null when unsure.
 */
export function detectLanguage(text: string): Language | null {
  const words = wordsOf(text);
  const scores = (Object.keys(WORDS) as Language[]).map((language) => {
    const common = new Set(WORDS[language]);
    const hits = words.filter((word) => common.has(word)).length;
    const letters = text.match(LETTERS[language] ?? /(?!)/g)?.length ?? 0;
    return { language, score: hits + 2 * Math.min(letters, 3) };
  });
  scores.sort((a, b) => b.score - a.score);
  const [best, next] = scores;
  if (best.score < 2 || best.score < 1.5 * next.score) return null;
  return best.language;
}

/** Each language's names, in the languages Chat reads and in Turkish. */
const NAMES: Record<Language, readonly string[]> = {
  en: [
    'english',
    'englisch',
    'anglais',
    'inglés',
    'ingles',
    'inglese',
    'inglês',
    'engels',
    'ingilizce',
  ],
  tr: ['turkish', 'türkçe'],
  de: ['german', 'deutsch', 'almanca'],
  fr: ['french', 'français', 'fransızca'],
  es: ['spanish', 'español', 'ispanyolca'],
  it: ['italian', 'italiano', 'italyanca'],
  pt: ['portuguese', 'português', 'portekizce'],
  nl: ['dutch', 'nederlands', 'felemenkçe'],
};

/** Turkish's dotless ı is I in capitals ("FRANSIZCA"), which a case-blind match and toLowerCase both miss. */
const fold = (name: string) => name.toLowerCase().replace(/ı/g, 'i');
const NAMED = new Map(
  (Object.keys(NAMES) as Language[]).flatMap((language) =>
    NAMES[language].map((name) => [fold(name), language] as const),
  ),
);
const L = `(${(Object.values(NAMES) as string[][])
  .flat()
  .map((name) => name.replace(/ı/g, '[ıi]'))
  .join('|')})`;
/**
 * After an answer verb's "in <language>": the end, a mark, or a word that
 * only shapes the ask. "the", "for", "and" and the like go on to make the
 * language a qualifier ("in German for CRM prompts", "in German and French
 * prompts", "in Spanish this week").
 */
const ENDS = String.raw`(?=\s*(?:$|[.;:!?)]|,\s*(?:please|thanks|thank)\b|(?:please|only|instead|too|rather)\b))`;
/**
 * The words between an answer verb and "in <language>": the answer's object
 * ("the summary for my team"), never a clause of its own ("me why we
 * dropped", "how we rank"), which the language then belongs to.
 */
const OBJECT = String.raw`(?:\s+(?!(?:why|how|what|where|when|which|who|whom|whose|whether|if|we|they|i|you|he|she|our|their|us|them|do|does|did|is|are|was|were|has|have|had|can|could|will|would)\b)\S+){0,6}?`;

/**
 * The person asks for the answer in a language they name ("answer in
 * English", "İngilizce cevap ver", "İngilizce bir blog yazısı yaz", "auf
 * Deutsch"): that language, whatever they wrote in (owner, 2026-11-03).
 * Naming one in passing ("why do Turkish users search less?", "how visible
 * are we in German prompts?", "can you tell me why we dropped in Spanish?",
 * "how many German only prompts do we track?") isn't asking: "in <language>"
 * asks only after an answer verb and its object, before "please" or
 * "instead", or on its own at the start or end of the message.
 */
const ASKS_FOR_LANGUAGE = [
  new RegExp(
    String.raw`\b(?:answer|answers|respond|response|reply|write|rewrite|translate|say|explain|summari[sz]e|summary|tell|describe|draft|put)\b${OBJECT}\s+(?:in|into)\s+${L}${ENDS}`,
    'i',
  ),
  new RegExp(String.raw`\b(?:in|into)\s+${L}\s*,?\s+(?:please|instead)\s*[.!]*\s*$`, 'i'),
  new RegExp(String.raw`^\s*in\s+${L}\s*[,:]`, 'i'),
  new RegExp(String.raw`(?:^|[.!?:;,]\s*)in\s+${L}\s*[.!]*\s*$`, 'i'),
  new RegExp(String.raw`\b(?:auf|en)\s+${L}`, 'i'),
  // Turkish: the language, then (after at most three words, none of them a
  // place or owner: "İngilizce promptlarda", "Almanca sayfamızın") a request
  // verb as a whole word: "İngilizce cevap ver", "İngilizce bir blog yazısı
  // yaz". "yazılmış", "cevaplarında", "yanıt oranı" are no request.
  new RegExp(
    String.raw`${L}(?:\s+(?!\S*(?:da|de|ta|te|daki|deki|ın|in|un|ün|nın|nin|nun|nün)(?=$|[\s.,!?;:]))\S+){0,3}?\s+(?:cevap\s+ver|cevapla|yanıt\s+ver|yanıtla|yaz|anlat|çevir)(?:ır|ir|ar|er|ın|in|un|ün)?(?:\s+mı(?:sın|sınız)|\s+mi(?:sin|siniz))?(?=$|[\s.,!?;:])`,
    'i',
  ),
  // "give me a German version", "write a Spanish translation": asking for one.
  new RegExp(
    String.raw`\b(?:give|send|make|write|create|want|need)\b${OBJECT}\s+(?:a|an|the)\s+${L}\s+(?:version|translation)\b`,
    'i',
  ),
  new RegExp(String.raw`${L}\s*,?\s+please\s*[.!]*\s*$`, 'i'),
];

/** The language a question asks the answer to be in, by name; null when it asks for none. Turkish's İ folds to i. */
export function askedLanguage(question: string): Language | null {
  const text = question.replace(/İ/g, 'i');
  for (const pattern of ASKS_FOR_LANGUAGE) {
    const name = pattern.exec(text)?.[1];
    const language = name ? NAMED.get(fold(name)) : undefined;
    if (language) return language;
  }
  return null;
}

/** Whether a question asks for the answer in a language it names. */
export function asksForLanguage(question: string): boolean {
  return askedLanguage(question) !== null;
}

/**
 * The turn's last line for the writer: the language the person asked for in
 * their message, else the one they set (Settings › Chat, `preferred`), else
 * the question's, named, so pages of English data don't set it. Null when
 * none is set and the question's is unclear.
 */
export function languageLine(question: string, preferred: Language | null = null): string | null {
  const asked = askedLanguage(question);
  if (asked) {
    const name = LANGUAGES[asked];
    return `The person asked for the answer in ${name}: answer in ${name}.`;
  }
  if (preferred) {
    const name = LANGUAGES[preferred];
    return `The person set Chat to answer in ${name}: answer in ${name}, whatever the language of their message or the data, unless they ask for another language.`;
  }
  const language = detectLanguage(question);
  if (!language) return null;
  const name = LANGUAGES[language];
  return `The person wrote in ${name}: answer in ${name}, whatever the language of the data, unless they ask for another language.`;
}

/**
 * The language an answer is rewritten in, once: the person's set language
 * (`preferred`) when the answer came out in another, one of the two being
 * English; with none set, the question's when the answer came out in English
 * for a question in another language. Null otherwise: the same language, one
 * of them unclear, or a question that asks for a language (an English blog
 * post asked for in Turkish is English on purpose).
 */
export function rewriteLanguage(
  question: string,
  answer: string,
  preferred: Language | null = null,
): Language | null {
  if (asksForLanguage(question)) return null;
  if (preferred) {
    // The person's set language: rewritten into it across English, where reading is sure.
    const written = detectLanguage(answer);
    return written && written !== preferred && (written === 'en' || preferred === 'en')
      ? preferred
      : null;
  }
  const asked = detectLanguage(question);
  if (!asked || asked === 'en') return null;
  return detectLanguage(answer) === 'en' ? asked : null;
}
