import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { speaksFirstPerson } from './firstPerson.js';
import { firstPerson } from './eeat.js';
import { sentencesOf } from './readability.js';

// A plain travel text and its English version (CUSTOMER-PRIORITIES §7: the
// old phrase list found none of their first-person sentences).
const TR = [
  "Geçen bahar Kapadokya'yı üç günde gezdik. Yolculuğu iki ay önceden planladık. Uçak biletlerini erken aldık ve küçük bir taş otelde kaldık. İlk sabah erkenden kalktık. Balonları izlemek için tepeye çıktık. Gökyüzü yüzlerce renkli balonla doldu. O an çok mutlu olduk.",
  "Kapadokya'ya varmadan önce Kayseri havalimanına indik. Oradan otele bir servisle gittik. Yol bir saatten biraz uzun sürdü. Otelin sahibi bizi kapıda karşıladı ve odamızı gösterdi. Odamız mağaranın içindeydi ve serindi. Akşam terasta oturduk, kasabanın ışıklarını seyrettik.",
  "Öğleden sonra Göreme Açık Hava Müzesi'ni gezdik. Kaya kiliselerindeki eski resimlere baktık. Rehberimiz bize bölgenin tarihini anlattı. Akşam yemeğinde testi kebabı denedik. Lezzetini hiç unutmayacağız.",
  "İkinci gün Ihlara Vadisi'nde yürüdük. Yol yaklaşık on dört kilometre sürdü. Nehrin kenarında mola verdik ve köy kahvaltısı yaptık. Ayaklarımız yoruldu ama manzara buna değdi. Dönüşte Derinkuyu yeraltı şehrini gördük. Dar tünellerde eğilerek yürüdük.",
  "Son gün Avanos'ta bir çömlek atölyesine gittik. Usta bize çark kullanmayı gösterdi. Ben küçük bir kase yaptım. Eşim ise bir vazo denedi. Hediyelik eşyaları da orada aldık.",
  "Bu gezide çok şey öğrendik. Kapadokya'yı ilkbaharda ya da sonbaharda gezmenizi öneririz. Otelinizi erken ayırtın. Rahat ayakkabı giyin. Balon turu için hava durumunu her sabah kontrol edin. Bir dahaki sefere kışın gitmeyi düşünüyoruz.",
];
const EN = [
  'Last spring we toured Cappadocia in three days. We planned the trip two months ahead. We bought our plane tickets early and stayed in a small stone hotel. On the first morning we got up early. We climbed a hill to watch the balloons. The sky filled with hundreds of colorful balloons. We were very happy at that moment.',
  'Before reaching Cappadocia we landed at Kayseri airport. From there we took a shuttle to the hotel. The ride took a little over an hour. The hotel owner met us at the door and showed us our room. Our room was inside a cave and stayed cool. In the evening we sat on the terrace and watched the lights of the town.',
  'In the afternoon we toured the Göreme Open Air Museum. We looked at the old paintings in the rock churches. Our guide told us the history of the region. At dinner we tried the pottery kebab. We will never forget its taste.',
  'On the second day we walked in the Ihlara Valley. The trail was about fourteen kilometers long. We took a break by the river and had a village breakfast. Our feet got tired, but the view was worth it. On the way back we saw the Derinkuyu underground city. We walked bent over through narrow tunnels.',
  'On the last day we went to a pottery workshop in Avanos. The master showed us how to use the wheel. I made a small bowl. My wife tried a vase. We bought our souvenirs there too.',
  'We learned a lot on this trip. We recommend touring Cappadocia in spring or autumn. Book your hotel early. Wear comfortable shoes. Check the weather every morning for the balloon tour. Next time we are thinking of going in winter.',
];

const told = (paragraphs, lang) =>
  paragraphs.flatMap((p) => sentencesOf(p, lang)).filter((s) => speaksFirstPerson(s, lang));

describe('first person', () => {
  it('finds the first-person sentences of a plain Turkish text by their verb endings', () => {
    expect(TR.flatMap((p) => sentencesOf(p, 'tr'))).toHaveLength(35);
    const found = told(TR, 'tr');
    expect(found).toHaveLength(28);
    // Told by a verb ending alone: past, present, future, aorist, "our".
    for (const s of [
      "Geçen bahar Kapadokya'yı üç günde gezdik.",
      'İlk sabah erkenden kalktık.',
      'Bir dahaki sefere kışın gitmeyi düşünüyoruz.',
      'Lezzetini hiç unutmayacağız.',
      "Kapadokya'yı ilkbaharda ya da sonbaharda gezmenizi öneririz.",
      'Odamız mağaranın içindeydi ve serindi.',
    ]) {
      expect(found).toContain(s);
    }
    // Advice to the reader, and what the place did, aren't.
    expect(found).not.toContain('Otelinizi erken ayırtın.');
    expect(found).not.toContain('Yol bir saatten biraz uzun sürdü.');
  });

  it('finds the first-person sentences of its English version by their pronouns', () => {
    expect(EN.flatMap((p) => sentencesOf(p, 'en'))).toHaveLength(35);
    const found = told(EN, 'en');
    expect(found).toHaveLength(29);
    expect(found).toContain('I made a small bowl.');
    expect(found).toContain('The master showed us how to use the wheel.');
    expect(found).not.toContain('Book your hotel early.');
  });

  it('leaves out words that only end like a Turkish verb', () => {
    for (const s of [
      'Artık bu yol kapalı.',
      'Estetik bir tasarım seçin.',
      'Plastik şişe kullanmayın.',
      'Temiz bir oda istenir.',
      'Durum yorum gerektirir.',
      'Bu yardım herkese açık.',
    ]) {
      expect(speaksFirstPerson(s, 'tr')).toBe(false);
    }
    expect(speaksFirstPerson('Ekmeği ikiye kestik.', 'tr')).toBe(true);
    expect(speaksFirstPerson('Bize yazın, hemen dönelim.', 'tr')).toBe(true);
  });

  it('leaves out quotes, stock phrases, capitals and labels', () => {
    expect(speaksFirstPerson('"We loved it," says one guest.', 'en')).toBe(false);
    expect(speaksFirstPerson('“Biz çok beğendik” diyor bir misafir.', 'tr')).toBe(false);
    expect(speaksFirstPerson('Questions about the tour? Contact us any time.', 'en')).toBe(false);
    expect(speaksFirstPerson('We use cookies to improve this site.', 'en')).toBe(false);
    expect(speaksFirstPerson('Prices in the US rose last year.', 'en')).toBe(false);
    expect(speaksFirstPerson('Part I of the guide covers the valleys.', 'en')).toBe(false);
    expect(speaksFirstPerson('About us', 'en')).toBe(false);
    expect(speaksFirstPerson("I've stayed here twice.", 'en')).toBe(true);
  });
});

describe('the first-person signal', () => {
  const ctxOf = (html) => {
    const $ = cheerio.load(html);
    return { url: 'https://example.com/trip', html, $, text: $('body').text() };
  };
  const page = (lang, paragraphs, extra = '') =>
    `<html lang="${lang}"><body><main><article><h1>Trip</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}${extra}</article></main></body></html>`;

  it('passes a page told in the first person, in its language', () => {
    expect(firstPerson.evaluate(ctxOf(page('tr', TR)))).toEqual({
      status: 'pass',
      score: 1,
      evidence: { language: 'tr', firstPersonSentences: 28, sentences: 35 },
    });
    expect(firstPerson.evaluate(ctxOf(page('en', EN))).evidence).toEqual({
      language: 'en',
      firstPersonSentences: 29,
      sentences: 35,
    });
  });

  it('reads no quote, and warns on a single sentence', () => {
    const quoted = '<blockquote><p>We tested every kettle we could find.</p></blockquote>';
    const text = [
      'The kettle boils a litre in three minutes. Its handle stays cool. We tested it for a month.',
    ];
    expect(firstPerson.evaluate(ctxOf(page('en', text, quoted)))).toMatchObject({
      status: 'warn',
      evidence: { firstPersonSentences: 1 },
    });
  });

  it('has no score in a language it doesn’t read yet', () => {
    expect(
      firstPerson.evaluate(ctxOf(page('de', ['Wir haben die Reise zwei Monate vorher geplant.']))),
    ).toMatchObject({ status: 'na', score: null, evidence: { language: 'de' } });
  });
});
