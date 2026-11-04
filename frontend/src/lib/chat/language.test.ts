import { describe, expect, it } from 'vitest';
import { asksForLanguage, detectLanguage, languageLine, rewriteLanguage } from './language';

/** The language of a Chat answer: the question's (language.ts). */

describe('detectLanguage', () => {
  it('reads the languages Chat sees most, from a question or an answer', () => {
    expect(detectLanguage("Bu hafta Perplexity'de neden düştük?")).toBe('tr');
    expect(detectLanguage('Why did our visibility on Perplexity fall this week?')).toBe('en');
    expect(
      detectLanguage('Warum ist unsere Sichtbarkeit auf Perplexity diese Woche gefallen?'),
    ).toBe('de');
    expect(detectLanguage('Pourquoi notre visibilité est-elle en baisse sur Perplexity ?')).toBe(
      'fr',
    );
    expect(detectLanguage('¿Por qué cayó nuestra visibilidad en Perplexity esta semana?')).toBe(
      'es',
    );
  });

  it('says nothing when a text is too short or unclear', () => {
    expect(detectLanguage('Perplexity?')).toBeNull();
    expect(detectLanguage('hi')).toBeNull();
    expect(detectLanguage('```\nconst a = 1;\n``` https://example.com')).toBeNull();
  });
});

describe('asksForLanguage', () => {
  it('hears the person ask for an answer in a language, in English or Turkish', () => {
    for (const asked of [
      "Bu hafta Perplexity'de neden düştük? Answer in English.",
      'Bu hafta neden düştük? İngilizce cevap ver.',
      'İngilizce bir blog yazısı yaz: neden AI görünürlüğü önemli?',
      'Schreib es auf Deutsch, bitte.',
      'Can you write the summary for my team in Spanish?',
      'Translate the last answer into German.',
      'Neden düştük? In English please.',
      'In German: why did we drop on Perplexity this week?',
      'Summarize this week for my boss in French.',
      'Can you explain this in Turkish?',
      'Answer in German only.',
      'Neden düştük? In English.',
      'FRANSIZCA cevap ver.',
      'Bunu İngilizce anlat.',
      'İngilizce yazar mısın?',
      'Almanca çevir.',
      'Give me a German version of this page.',
      'Show the numbers in Spanish, please.',
    ]) {
      expect(asksForLanguage(asked), asked).toBe(true);
    }
  });

  it('hears no ask in a language named in passing', () => {
    for (const question of [
      'Why do Turkish users search less on Perplexity?',
      "Bu hafta Perplexity'de neden düştük?",
      'Türkçe sorular neden daha az görünür?',
      'How visible are we in German prompts on ChatGPT?',
      'Why did we drop in Spanish answers this week?',
      'Explain why we dropped in German answers this week.',
      'Why did we drop in Spanish?',
      'Can you tell me why we dropped in Spanish?',
      'Explain why we dropped in German.',
      'Tell me why we dropped in German and French prompts.',
      'Give me the visibility in German for CRM prompts.',
      'Explain how we rank in Spanish this week',
      'How many German only prompts do we track?',
      'Show the prompts we track in German.',
      'İngilizce yazılmış promptlarda neden düştük?',
      'İngilizce promptlar için yanıt oranımız ne?',
      'Almanca sayfamız ChatGPT cevaplarında görünüyor mu?',
      'İspanyolca promptlarda rakipler ne yazıyor?',
      'Almanca olarak kaç promptumuz var?',
      'İngilizce promptlarda neden düştüğümüzü yaz.',
      'Do we have a German version of the site?',
      'Is the Spanish version of our page cited?',
      'Our mentions in Spanish, please break them down.',
    ]) {
      expect(asksForLanguage(question), question).toBe(false);
    }
  });
});

describe('languageLine', () => {
  it("names the question's language for the writer, or nothing when unclear", () => {
    expect(languageLine("Bu hafta Perplexity'de neden düştük?")).toBe(
      'The person wrote in Turkish: answer in Turkish, whatever the language of the data, unless they ask for another language.',
    );
    expect(languageLine('Perplexity?')).toBeNull();
    expect(languageLine("Bu hafta Perplexity'de neden düştük? Answer in English.")).toBe(
      'The person asked for the answer in English: answer in English.',
    );
    expect(languageLine('İngilizce bir blog yazısı yaz: neden AI görünürlüğü önemli?')).toBe(
      'The person asked for the answer in English: answer in English.',
    );
    expect(languageLine('FRANSIZCA cevap ver.')).toBe(
      'The person asked for the answer in French: answer in French.',
    );
    expect(languageLine('Schreib es auf Deutsch, bitte.')).toBe(
      'The person asked for the answer in German: answer in German.',
    );
  });
});

describe('rewriteLanguage', () => {
  const TURKISH = "Bu hafta Perplexity'de neden düştük?";
  const ENGLISH =
    'Perplexity visibility fell this week, and the biggest drop is in the CRM prompts.';

  it('rewrites an English answer to a question in another language', () => {
    expect(rewriteLanguage(TURKISH, ENGLISH)).toBe('tr');
  });

  it('leaves an answer in the question’s language, an English question, or an unclear one', () => {
    expect(
      rewriteLanguage(
        TURKISH,
        'Perplexity görünürlüğü bu hafta düştü ve en büyük düşüş CRM sorularında.',
      ),
    ).toBeNull();
    expect(rewriteLanguage('Why did we fall this week?', ENGLISH)).toBeNull();
    expect(rewriteLanguage('Perplexity?', ENGLISH)).toBeNull();
  });

  it('leaves an answer in a language the person asked for', () => {
    expect(
      rewriteLanguage('İngilizce bir blog yazısı yaz: neden AI görünürlüğü önemli?', ENGLISH),
    ).toBeNull();
    expect(rewriteLanguage('Bu sayfayı in English yaz, lütfen ve hemen', ENGLISH)).toBeNull();
    expect(rewriteLanguage(`${TURKISH} Answer in English.`, ENGLISH)).toBeNull();
  });

  it('still rewrites when a language is only named in the question', () => {
    expect(
      rewriteLanguage("İngilizce sorularda bu hafta Perplexity'de neden düştük?", ENGLISH),
    ).toBe('tr');
  });
});

describe('a language the person set (Settings › Chat)', () => {
  const ENGLISH =
    'Perplexity visibility fell this week, and the biggest drop is in the CRM prompts.';
  const TURKISH = 'Perplexity görünürlüğü bu hafta düştü ve en büyük düşüş CRM sorularında.';

  it('names it for the writer over the question’s, and a language asked for in the message over it', () => {
    expect(languageLine('Why did citations fall this week?', 'tr')).toBe(
      'The person set Chat to answer in Turkish: answer in Turkish, whatever the language of their message or the data, unless they ask for another language.',
    );
    expect(languageLine("Bu hafta Perplexity'de neden düştük? Answer in English.", 'tr')).toBe(
      'The person asked for the answer in English: answer in English.',
    );
  });

  it('rewrites an answer into it across English, and leaves one already in it', () => {
    expect(rewriteLanguage('Why did citations fall this week?', ENGLISH, 'tr')).toBe('tr');
    expect(rewriteLanguage("Bu hafta Perplexity'de neden düştük?", TURKISH, 'en')).toBe('en');
    expect(rewriteLanguage('Why did citations fall this week?', TURKISH, 'tr')).toBeNull();
    // Asked for in the message: never rewritten away.
    expect(
      rewriteLanguage("Bu hafta Perplexity'de neden düştük? Answer in English.", ENGLISH, 'tr'),
    ).toBeNull();
  });
});
