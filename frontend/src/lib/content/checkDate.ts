import { languageCode } from './readability';

/**
 * A visible check date (Content Editor Quality spec §11, Phase 3, CE-052):
 * a comparison is trusted for saying when its products were last checked.
 * E-E-A-T counts one on the page; the to-do's Add line puts this month's in
 * the page's language, as the disclosure line goes in (CE-050). A language
 * not here gets none: the person writes it.
 */

// No full stop: a short line that isn't a sentence, which Answer first reads
// past as it does a byline or a date (isByline).
const LINES: Record<string, string> = {
  en: 'Last checked: {date}',
  tr: 'Son kontrol: {date}',
  de: 'Zuletzt geprüft: {date}',
  fr: 'Dernière vérification : {date}',
  es: 'Última revisión: {date}',
  pt: 'Última verificação: {date}',
  it: 'Ultimo controllo: {date}',
  nl: 'Laatst gecontroleerd: {date}',
  sv: 'Senast kontrollerad: {date}',
};

/** This month's check date line for a page in `language`, or null for a language not here. */
export function checkDateText(
  language: string | null | undefined,
  now = new Date(),
): string | null {
  const code = languageCode(language) ?? '';
  const line = LINES[code];
  if (!line) return null;
  const date = new Intl.DateTimeFormat(code, { month: 'long', year: 'numeric' }).format(now);
  return line.replace('{date}', () => date);
}

/**
 * Add line's own line, in any of the languages above: its label, then a
 * month and a year, and nothing else ("Last checked: May 2021", "Última
 * revisión: octubre de 2026"). Only this is replaced: a date in the
 * person's own words (a byline, the answer) is theirs.
 */
const CHECK_DATE_LINE = new RegExp(
  `^\\s*(?:${Object.values(LINES)
    .map((line) => line.replace(/\s*:\s*\{date\}$/u, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\s*:\\s*[\\p{L}.]+(?:\\s+de)?\\s+\\d{4}\\s*$`,
  'iu',
);

/** Whether a block is Add line's own check date line, at any date: Add line replaces it. */
export const isCheckDateLine = (text: string) =>
  CHECK_DATE_LINE.test(text) || CHECK_DATE_LINE.test(text.toLocaleLowerCase('tr'));

/**
 * Words (and their stems) that say a page was checked, tested, reviewed or
 * updated, the verb or the label ("Last update", "Son güncelleme",
 * "Letzte Aktualisierung", "Letzte Prüfung"), in the languages above; each
 * at a word's start ("untested", "areas of" aren't one), and in the forms
 * that mean checked ("verification", "updates", "kontrolü" aren't).
 */
const CHECKED =
  /(?<!\p{L})(?:checked|tested|reviewed|verified|updated|last update|last modified|as of|son kontrol|kontrol edil|güncelle|incele|test edil|doğrula|geprüft|überprüf|prüfung|getestet|aktualisier|stand:|vérifi|mise? à jour|actualisé|testé|révis|revis|actualiza|verificad[oa]|verificaç|verificat[oaie](?!\p{L})|probad|atualiza|testad|testato|controllat|controllo|aggiorna|gecontroleerd|getest|bijgewerkt|kontrollerad|uppdaterad|granskad)/giu;
const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
/** A block this short is a label ("Updated March 2026"): its date is the page's. */
const LABEL_WORDS = 12;
/** In a longer one, the year must be this near the word ("we tested each in March 2025"). */
const NEAR_CHARS = 40;

/** The years a block says it was checked in (any year), as written or lowercased the Turkish way. */
function checkedYears(text: string): number[] {
  const out: number[] = [];
  for (const form of [text, text.toLocaleLowerCase('tr')]) {
    const label = form.split(/\s+/).filter(Boolean).length <= LABEL_WORDS;
    for (const word of form.matchAll(CHECKED)) {
      const from = label ? 0 : Math.max(0, word.index - NEAR_CHARS);
      const to = label ? form.length : word.index + word[0].length + NEAR_CHARS;
      for (const year of form.slice(from, to).matchAll(YEAR)) out.push(Number(year[0]));
    }
  }
  return out;
}

/**
 * Whether the page says when it was last checked: a block with a "checked"
 * word and a year from the last two (a check date older than that tells the
 * reader the comparison is stale).
 */
export function pageCheckDate(texts: readonly string[], now = new Date()): boolean {
  const from = now.getFullYear() - 1;
  return texts.some((text) =>
    checkedYears(text).some((year) => year >= from && year <= now.getFullYear()),
  );
}

/**
 * What the page says of when it was checked: a recent date (found), else an
 * older one, in Add line's own line (it replaces it) or in the person's
 * words (they update it), or none.
 */
export function checkDateOnPage(
  texts: readonly string[],
  now = new Date(),
): { found: boolean; old: 'line' | 'text' | null } {
  if (pageCheckDate(texts, now)) return { found: true, old: null };
  if (texts.some(isCheckDateLine)) return { found: false, old: 'line' };
  return { found: false, old: texts.some((text) => checkedYears(text).length) ? 'text' : null };
}
