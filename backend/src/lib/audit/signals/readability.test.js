import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import {
  pageProse,
  readingBand,
  readingBlocks,
  readingEvidence,
  readingFinding,
  readingLevel,
  sentencesOf,
  syllablesOf,
} from './readability.js';

/**
 * Site Audit's readability reads a page as the Content Editor's Quality
 * does (frontend/src/lib/content/readability.ts): the same blocks, sentences,
 * syllables, formula by language and band. The page both read alike is in
 * audit.test.js; the texts in each language, below.
 */

// Shared with frontend/src/lib/content/readability.test.ts: the same formula and score in both.
const SAMPLES = {
  en: `<h1>Our Cappadocia trip</h1><p>Last spring we toured Cappadocia in three days. We planned the trip two months ahead. We bought our plane tickets early and stayed in a small stone hotel. On the first morning we got up early. We climbed a hill to watch the balloons. The sky filled with hundreds of colorful balloons. We were very happy at that moment.</p><p>In the afternoon we toured the Göreme Open Air Museum. We looked at the old paintings in the rock churches. Our guide told us the history of the region.</p>`,
  tr: `<h1>Kapadokya gezimiz</h1><p>Geçen bahar Kapadokya'yı üç günde gezdik. Yolculuğu iki ay önceden planladık. Uçak biletlerini erken aldık ve küçük bir taş otelde kaldık. İlk sabah erkenden kalktık. Balonları izlemek için tepeye çıktık. Gökyüzü yüzlerce renkli balonla doldu. O an çok mutlu olduk.</p><p>Öğleden sonra Göreme Açık Hava Müzesi'ni gezdik. Kaya kiliselerindeki eski resimlere baktık. Rehberimiz bize bölgenin tarihini anlattı. Akşam yemeğinde testi kebabı denedik.</p>`,
  de: `<h1>Unsere Reise nach Kappadokien</h1><p>Im letzten Frühling haben wir Kappadokien in drei Tagen besucht. Wir haben die Reise zwei Monate vorher geplant. Wir haben die Flugtickets früh gekauft und in einem kleinen Steinhotel gewohnt. Am ersten Morgen sind wir früh aufgestanden. Wir sind auf einen Hügel gestiegen, um die Ballons zu sehen. Der Himmel war voller bunter Ballons. In diesem Moment waren wir sehr glücklich.</p>`,
  fr: `<h1>Notre voyage en Cappadoce</h1><p>Au printemps dernier, nous avons visité la Cappadoce en trois jours. Nous avons préparé le voyage deux mois à l'avance. Nous avons acheté nos billets d'avion tôt et nous avons dormi dans un petit hôtel en pierre. Le premier matin, nous nous sommes levés tôt. Nous sommes montés sur une colline pour voir les ballons. Le ciel était plein de ballons colorés. Nous étions très heureux.</p>`,
  es: `<h1>Nuestro viaje a Capadocia</h1><p>La primavera pasada visitamos Capadocia en tres días. Planeamos el viaje con dos meses de antelación. Compramos los billetes de avión pronto y nos alojamos en un pequeño hotel de piedra. La primera mañana nos levantamos temprano. Subimos a una colina para ver los globos. El cielo se llenó de cientos de globos de colores. En ese momento fuimos muy felices.</p>`,
  it: `<h1>Il nostro viaggio in Cappadocia</h1><p>La scorsa primavera abbiamo visitato la Cappadocia in tre giorni. Abbiamo programmato il viaggio con due mesi di anticipo. Abbiamo comprato presto i biglietti aereo e abbiamo dormito in un piccolo albergo di pietra. La prima mattina ci siamo alzati presto. Siamo saliti su una collina per vedere le mongolfiere. Il cielo era pieno di palloni colorati. In quel momento eravamo molto felici.</p>`,
};

describe('readability in the page’s language, as the editor reads it', () => {
  it('scores each language by its formula, as the editor does', () => {
    const read = (lang) => {
      const level = readingLevel(readingBlocks(SAMPLES[lang]), lang);
      const { formula, readingScore, lettersPerWord } = readingEvidence(level);
      return { formula, readingScore, lettersPerWord, status: readingBand(level).status };
    };
    // The editor's readingLevel check: the same formula and value, full points
    // where these pass, half where they warn.
    expect(read('en')).toMatchObject({ formula: 'flesch', readingScore: 88, status: 'warn' });
    expect(read('tr')).toMatchObject({ formula: 'atesman', readingScore: 84, status: 'pass' });
    expect(read('de')).toMatchObject({ formula: 'amstad', readingScore: 73, status: 'pass' });
    expect(read('fr')).toMatchObject({ formula: 'kandelMoles', readingScore: 87, status: 'pass' });
    expect(read('es')).toMatchObject({
      formula: 'fernandezHuerta',
      readingScore: 80,
      status: 'pass',
    });
    // No formula for Italian yet: sentence and word length, both short.
    expect(read('it')).toMatchObject({
      formula: null,
      readingScore: null,
      lettersPerWord: 5.1,
      status: 'pass',
    });
  });

  it('scores a plain Turkish text as easy, as its English version reads', () => {
    // Read with English's syllables and formula, as every page once was, it fails.
    const tr = readingLevel(readingBlocks(SAMPLES.tr), 'en');
    expect(Math.round(tr.score)).toBe(29);
    expect(readingBand(tr).status).toBe('fail');
    expect(readingBand(readingLevel(readingBlocks(SAMPLES.tr), 'tr')).status).toBe('pass');
  });

  it('shows the score in parts: sentences, words and paragraphs, on a phone too', () => {
    const level = readingLevel(readingBlocks(SAMPLES.tr), 'tr');
    expect(readingEvidence(level)).toEqual({
      language: 'tr',
      formula: 'atesman',
      readingScore: 84,
      wordsPerSentence: 5.6,
      syllablesPerWord: 2.5,
      lettersPerWord: 5.9,
      wordsPerParagraph: 31,
      mobileLinesPerParagraph: 6,
    });
    expect(readingFinding(readingEvidence(level))).toBe(
      'Ateşman 84 (language tr; aim for 50 or more)',
    );
  });

  it('has no score under 30 words, nor for headings alone', () => {
    expect(readingLevel(readingBlocks('<p>Too short.</p>'))).toBeNull();
    expect(readingLevel(readingBlocks(`<h2>${'Word '.repeat(40)}</h2>`))).toBeNull();
  });

  it('reads each prose block on its own: list items yes, headings and cells no', () => {
    expect(
      readingBlocks(
        '<h2>Steps</h2><ul><li>Rinse it.<ul><li>Nested.</li></ul></li></ul><blockquote><p>Taste it.</p></blockquote><table><tr><td><p>Cell.</p></td></tr></table><script>x()</script>',
      ),
    ).toEqual([
      { tag: 'h2', text: 'Steps' },
      { tag: 'li', text: 'Rinse it.' },
      { tag: 'li', text: 'Nested.' },
      { tag: 'blockquote', text: 'Taste it.' },
    ]);
  });

  it('splits sentences as the editor does', () => {
    expect(sentencesOf('Use a ratio, e.g. 1:16. Then brew.')).toEqual([
      'Use a ratio, e.g. 1:16.',
      'Then brew.',
    ]);
    expect(sentencesOf('Say no. Then see No. 5 below.')).toEqual([
      'Say no.',
      'Then see No. 5 below.',
    ]);
    expect(sentencesOf('He said "stop." Then he left. (It was late.) Nobody spoke.')).toEqual([
      'He said "stop."',
      'Then he left.',
      '(It was late.)',
      'Nobody spoke.',
    ]);
    // A lower-case word goes on the sentence.
    expect(sentencesOf('Prices rose 3 pct. in May. Then they fell… and rose.')).toEqual([
      'Prices rose 3 pct. in May.',
      'Then they fell… and rose.',
    ]);
  });

  it('splits a language’s sentences by its own abbreviations and ordinals', () => {
    expect(sentencesOf('Toplantı 3. katta. Sonra eve gittik.', 'tr')).toEqual([
      'Toplantı 3. katta.',
      'Sonra eve gittik.',
    ]);
    expect(
      sentencesOf('Wir kommen am 3. Oktober, z. B. mit dem Zug. Dann essen wir.', 'de'),
    ).toEqual(['Wir kommen am 3. Oktober, z. B. mit dem Zug.', 'Dann essen wir.']);
  });

  it('counts syllables as the editor does', () => {
    // Each Turkish vowel is a syllable.
    expect(syllablesOf('Kapadokya', 'tr')).toBe(4);
    expect(syllablesOf('İstanbul', 'tr')).toBe(3);
    expect(syllablesOf('the')).toBe(1);
    expect(syllablesOf('readable')).toBe(3);
    expect(syllablesOf('quickly')).toBe(2);
    // "-ted" and "-ded" keep their syllable; a silent final e doesn't count.
    expect(syllablesOf('wanted')).toBe(2);
    expect(syllablesOf('makes')).toBe(1);
  });

  it('reads text left loose in a div, a caption or a definition list as a paragraph', () => {
    expect(
      readingBlocks(
        '<div>Loose <b>words</b> here.<div>Inner words.</div><p>A paragraph.</p></div><figure><figcaption>A caption.</figcaption></figure><dl><dt>Term</dt><dd>Its meaning.</dd></dl><ul><li><div>Item words.</div></li></ul>',
      ),
    ).toEqual([
      { tag: 'p', text: 'Loose words here.' },
      { tag: 'p', text: 'Inner words.' },
      { tag: 'p', text: 'A paragraph.' },
      { tag: 'p', text: 'A caption.' },
      { tag: 'p', text: 'Term' },
      { tag: 'p', text: 'Its meaning.' },
      { tag: 'li', text: 'Item words.' },
    ]);
  });

  it('passes English 50–70, warns from 30 and over 70, and fails under 30, as the score shows', () => {
    const flesch = (score) => readingBand({ formula: 'flesch', score, target: 50 });
    expect(flesch(50)).toEqual({ status: 'pass', score: 1 });
    expect(flesch(70)).toEqual({ status: 'pass', score: 1 });
    expect(flesch(45)).toEqual({ status: 'warn', score: 0.5 });
    expect(flesch(75)).toEqual({ status: 'warn', score: 0.5 });
    // A plain page reads easily: never a fail.
    expect(flesch(86)).toEqual({ status: 'warn', score: 0.5 });
    expect(flesch(110)).toEqual({ status: 'warn', score: 0.5 });
    expect(flesch(29)).toEqual({ status: 'fail', score: 0 });
    // Rounded, as it shows: 70.4 reads 70, 49.6 reads 50.
    expect(flesch(70.4)).toEqual({ status: 'pass', score: 1 });
    expect(flesch(49.6)).toEqual({ status: 'pass', score: 1 });
  });

  it('passes another formula from its target up, and fails 30 under it', () => {
    const atesman = (score) => readingBand({ formula: 'atesman', score, target: 50 });
    expect(atesman(50)).toEqual({ status: 'pass', score: 1 });
    expect(atesman(95)).toEqual({ status: 'pass', score: 1 });
    expect(atesman(49)).toEqual({ status: 'warn', score: 0.5 });
    expect(atesman(21)).toEqual({ status: 'warn', score: 0.5 });
    expect(atesman(20)).toEqual({ status: 'fail', score: 0 });
  });

  it('reads a language without a formula by sentence and word length', () => {
    const band = (wordsPerSentence, lettersPerWord) =>
      readingBand({ formula: null, score: null, target: null, wordsPerSentence, lettersPerWord })
        .status;
    expect(band(18, 5)).toBe('pass');
    expect(band(24, 5)).toBe('warn');
    expect(band(18, 7)).toBe('warn');
    expect(band(24, 7)).toBe('fail');
  });

  it('reads a page in its <html lang>, else in the language its words are in', () => {
    const ctx = (html) => ({ url: 'https://example.com/', html, $: cheerio.load(html), text: '' });
    const page = (attr, body) =>
      `<html${attr}><body><main><article>${body}</article></main></body></html>`;
    expect(pageProse(ctx(page(' lang="tr-TR"', SAMPLES.en))).language).toBe('tr');
    expect(pageProse(ctx(page('', SAMPLES.tr))).language).toBe('tr');
    expect(pageProse(ctx(page(' lang="x-default"', SAMPLES.de))).language).toBe('de');
    // Read once for every signal that reads it.
    const one = ctx(page('', SAMPLES.fr));
    expect(pageProse(one)).toBe(pageProse(one));
  });

  it('reads a page of tens of thousands of paragraphs in one pass, not a minute', () => {
    const html = '<p>One short line here.</p>'.repeat(40_000);
    const started = Date.now();
    expect(readingBlocks(html)).toHaveLength(40_000);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
