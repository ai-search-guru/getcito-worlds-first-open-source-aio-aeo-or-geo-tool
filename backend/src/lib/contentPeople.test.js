import { describe, expect, it, vi } from 'vitest';
import {
  NAME_PLACEHOLDER as NAME,
  QUOTE_PLACEHOLDER as QUOTE,
  authorWords,
  guardPeople,
  guardPeopleInHtml,
  knownPeople,
} from './contentPeople.js';

/**
 * No invented people or quotes (Quality spec §9, CE-044): a name or a quoted
 * sentence the agent was given stays; any other becomes a placeholder.
 */

const known = knownPeople(
  'Ada Lovelace writes about forecasting.',
  '“Forecasts are only as good as the deals in them,” Ada Lovelace says.',
  'Acme Coffee',
);
const guard = (text) => guardPeople(text, known).text;

describe('guardPeople', () => {
  it('puts a person it was not given as a placeholder, wherever a person is plainly meant', () => {
    expect(guard('Dr. Jane Doe tested twelve grinders.')).toBe(`${NAME} tested twelve grinders.`);
    expect(guard('CEO Tim Cook agreed; founder Jean-Luc Picard nodded.')).toBe(
      `CEO ${NAME} agreed; founder ${NAME} nodded.`,
    );
    expect(guard('Jane McDonald, our senior product manager, agrees.')).toBe(
      `${NAME}, our senior product manager, agrees.`,
    );
    expect(guard('Marco Rossi said the beans matter.')).toBe(`${NAME} said the beans matter.`);
    expect(guard('The beans matter, according to CEO Marco Rossi.')).toBe(
      `The beans matter, according to CEO ${NAME}.`,
    );
    expect(guard('Çağrı Işık said hello.')).toBe(`${NAME} said hello.`);
  });

  it('keeps a person it was given, and names that are no person', () => {
    expect(guard('According to Ada Lovelace, teams forecast weekly.')).toBe(
      'According to Ada Lovelace, teams forecast weekly.',
    );
    expect(guard('Dr. Ada Lovelace says so.')).toBe('Dr. Ada Lovelace says so.');
    expect(guard('The team said it works.')).toBe('The team said it works.');
    expect(guard('Clicks rose, according to Google Search Console data.')).toBe(
      'Clicks rose, according to Google Search Console data.',
    );
    expect(guard('Acme Coffee roasts on Mondays.')).toBe('Acme Coffee roasts on Mondays.');
  });

  it('puts a quoted sentence it was not given as a placeholder, and keeps one it was', () => {
    expect(guard('“Pour-over is the best way to taste a single origin,” said Marco Rossi.')).toBe(
      `${QUOTE} said ${NAME}.`,
    );
    expect(guard('She wrote "this changed how we brew every morning" last year.')).toBe(
      `She wrote ${QUOTE} last year.`,
    );
    expect(guard('As Ada Lovelace says, "forecasts are only as good as the deals in them."')).toBe(
      'As Ada Lovelace says, "forecasts are only as good as the deals in them."',
    );
    // A term in quotes is no quote.
    expect(guard('Use the “AI visibility” term with care.')).toBe(
      'Use the “AI visibility” term with care.',
    );
  });

  it('leaves placeholders alone, and says where it put its own', () => {
    expect(guard(`Read the ${QUOTE} here, from ${NAME}.`)).toBe(
      `Read the ${QUOTE} here, from ${NAME}.`,
    );
    const { edits } = guardPeople('Ask Dr. Jane Doe.', known);
    expect(edits).toEqual([{ start: 4, end: 16, text: NAME }]);
  });
});

describe('guardPeople: what the review found', () => {
  const people = knownPeople('Jane Doe writes about pipelines.', "Bob O'Neil");
  const fix = (text, options) => guardPeople(text, people, options).text;

  it('catches the ways a person is usually named', () => {
    expect(fix('Sarah Chen, a marketing strategist at Acme, notes that it works.')).toBe(
      `${NAME}, a marketing strategist at Acme, notes that it works.`,
    );
    expect(fix('SEO expert Sarah Chen agrees.')).toBe(`SEO expert ${NAME} agrees.`);
    expect(fix('Marco Rossi (CEO of Acme) recommends it.')).toBe(
      `${NAME} (CEO of Acme) recommends it.`,
    );
    expect(fix('Marco Rossi, Senior Product Manager at Acme, explains why.')).toBe(
      `${NAME}, Senior Product Manager at Acme, explains why.`,
    );
    expect(fix('Dr. Marco Rossi emphasizes speed.')).toBe(`${NAME} emphasizes speed.`);
    expect(fix('Sarah, our head of growth, says yes.')).toBe(
      `${NAME}, our head of growth, says yes.`,
    );
    expect(fix('This was said by Ursula von der Leyen.')).toBe(`This was said by ${NAME}.`);
    expect(fix('As J. K. Rowling said, write daily.')).toBe(`As ${NAME} said, write daily.`);
    expect(fix('Geschäftsführerin Anna Schmidt sagte, es funktioniert.')).toBe(
      `Geschäftsführerin ${NAME} sagte, es funktioniert.`,
    );
    expect(fix('Ayşe Yılmaz söyledi.')).toBe(`${NAME} söyledi.`);
    expect(fix("Mary O'Hara said so.")).toBe(`${NAME} said so.`);
  });

  it('takes a short quote someone is said to say, and one in single curly quotes', () => {
    expect(fix('“Absolutely game-changing,” said Marco Rossi.')).toBe(`${QUOTE} said ${NAME}.`);
    expect(fix('‘We tested it for weeks and it held up,’ she said.')).toBe(`${QUOTE} she said.`);
    // An apostrophe isn't a quote's end.
    expect(fix('She said it’s fine.')).toBe('She said it’s fine.');
  });

  it("keeps a known author's name with the words before it", () => {
    expect(fix('Recently Jane Doe said it.')).toBe('Recently Jane Doe said it.');
    expect(fix('Acme Founder Jane Doe said it best.')).toBe('Acme Founder Jane Doe said it best.');
    expect(fix("Bob O'Neil said so.")).toBe("Bob O'Neil said so.");
  });

  it('leaves headings, places, publications and inches alone', () => {
    for (const heading of [
      'Content Editor Best Practices',
      'Lead Scoring Best Practices for Small Teams',
      'How Chief Marketing Officers Use AEO',
      'Head of Sales Playbook Template',
    ]) {
      expect(fix(heading, { heading: true })).toBe(heading);
    }
    expect(fix('In Silicon Valley, the founder of Acme spoke.')).toBe(
      'In Silicon Valley, the founder of Acme spoke.',
    );
    expect(fix('Traffic fell, according to Search Engine Land.')).toBe(
      'Traffic fell, according to Search Engine Land.',
    );
    expect(fix('Our 27" monitor is the best of the "pro" line.')).toBe(
      'Our 27" monitor is the best of the "pro" line.',
    );
  });

  it('knows a name only as whole words of what it was given, not inside another word', () => {
    const page = knownPeople(
      'Our kitchen opens at six. Sleep well.',
      'Our fleet does next-day delivery.',
      'See the annual report.',
    );
    const check = (text) => guardPeople(text, page).text;
    expect(check('Dr. Sarah Chen runs the clinic.')).toBe(`${NAME} runs the clinic.`);
    expect(check('Mr. Lee runs the shop.')).toBe(`${NAME} runs the shop.`);
    expect(check('Dr. Mark Lee runs the shop.')).toBe(`${NAME} runs the shop.`);
    expect(check('Mr. Doe agreed.')).toBe(`${NAME} agreed.`);
    expect(check('Ann, our head of growth, set it.')).toBe(`${NAME}, our head of growth, set it.`);
    // A name it was given stays, whatever the punctuation around it.
    const given = knownPeople('Interview: Dr. Chen (Sarah Chen), and Mr. Lee.');
    expect(guardPeople('Dr. Sarah Chen runs the clinic.', given).text).toBe(
      'Dr. Sarah Chen runs the clinic.',
    );
    expect(guardPeople('Mr. Lee runs the shop.', given).text).toBe('Mr. Lee runs the shop.');
  });

  it('reads German and Turkish roles as people do write them', () => {
    // German nouns take a capital; a Turkish role its possessive, and a capital first.
    expect(fix('Geschäftsführerin Anna Schmidt hat das Team aufgebaut.')).toBe(
      `Geschäftsführerin ${NAME} hat das Team aufgebaut.`,
    );
    expect(fix('Laut Sprecher Max Müller steigt der Umsatz.')).toBe(
      `Laut Sprecher ${NAME} steigt der Umsatz.`,
    );
    expect(fix("Pazarlama müdürü Ayşe Yılmaz'a göre bu doğru.")).toBe(
      `Pazarlama müdürü ${NAME}'a göre bu doğru.`,
    );
    expect(fix('Kurucumuz Ali Kaya bunu yazdı.')).toBe(`Kurucumuz ${NAME} bunu yazdı.`);
    expect(fix('Bunu SEO uzmanımız Deniz Ak anlattı.')).toBe(`Bunu SEO uzmanımız ${NAME} anlattı.`);
    // A trade's "-(s)ı" before a verb said of people.
    expect(fix('Bunu SEO uzmanı Deniz Ak anlattı.')).toBe(`Bunu SEO uzmanı ${NAME} anlattı.`);
    expect(fix('Pazarlama müdürü Ayşe Yılmaz dedi ki işe yarıyor.')).toBe(
      `Pazarlama müdürü ${NAME} dedi ki işe yarıyor.`,
    );
    // "'a göre" in each of its forms, the curly apostrophe too, and "'ın söylediğine göre".
    expect(fix("SEO uzmanı Ali Kaya'ya göre işe yarıyor.")).toBe(
      `SEO uzmanı ${NAME}'ya göre işe yarıyor.`,
    );
    expect(fix('Pazarlama müdürü Ayşe Yılmaz’e göre doğru.')).toBe(
      `Pazarlama müdürü ${NAME}’e göre doğru.`,
    );
    expect(fix("Pazarlama müdürü Ayşe Yılmaz'ın söylediğine göre doğru.")).toBe(
      `Pazarlama müdürü ${NAME}'ın söylediğine göre doğru.`,
    );
    expect(fix('Müdürü Ayşe Yılmaz söyledi.')).toBe(`Müdürü ${NAME} söyledi.`);
    expect(fix('Ayşe Yılmaz, Pazarlama Müdürü, katıldı.')).toBe(
      `${NAME}, Pazarlama Müdürü, katıldı.`,
    );
    // A title's own words aren't the name's.
    expect(fix('Kurucu Ortak Ali Kaya bunu yazdı.')).toBe(`Kurucu Ortak ${NAME} bunu yazdı.`);
    expect(fix('Genel Müdür Yardımcısı Ali Kaya katıldı.')).toBe(
      `Genel Müdür Yardımcısı ${NAME} katıldı.`,
    );
    // In a heading only speech is read; the role still isn't the name.
    expect(fix('Müdürü Ayşe Yılmaz söyledi', { heading: true })).toBe(`Müdürü ${NAME} söyledi`);
  });

  it('reads no tool or title as a person after a trade or a German "Leiter"', () => {
    // "-(s)ı" may name a trade, not a person: a name after it is read only where it ends.
    for (const line of [
      'Bir pazarlama uzmanı Google Analytics raporlarını inceler.',
      'Hesap yöneticisi Google Ads kampanyasını açar.',
      // A tool takes case suffixes and sits in lists as a person does.
      "Bir pazarlama uzmanı Google Analytics'i her gün açar.",
      "Hesap yöneticisi Google Ads'te kampanyayı açar.",
      "Proje yöneticisi Microsoft Teams'te toplantı açar.",
      "Bir SEO uzmanı Screaming Frog'u kullanır.",
      'Bir SEO uzmanı Google Analytics, Search Console ve Ahrefs kullanır.',
      // A department or a feature after a capitalised role is no name.
      'Uzman Destek Ekibi ile çalışın.',
      'Yönetici Paneli Girişi için tıklayın.',
      'Danışman Hizmetleri Paketi ile başlayın.',
      'Als Direktor Vertrieb Europa verantwortet sie das Team.',
      'Geschäftsführer Technik Produkt ist ein neuer Posten.',
      // However many words the title goes on for.
      'Yönetici Paneli Giriş Sayfası açılır.',
      'Danışman Hizmetleri Fiyat Listesi burada.',
      'Als Direktor Vertrieb Europa Nord verantwortet sie das Team.',
      // Given up with the tools: a name before a comma after "-(s)ı".
      'Pazarlama müdürü Ayşe Yılmaz, kampanyayı yönetti.',
      'Danışmanlık Hizmetleri Ali Kaya ile başladı.',
      'Die Leiter Hailo ProfiStep steht im Keller.',
    ]) {
      expect(fix(line)).toBe(line);
    }
    expect(fix('Max Müller, Leiter Vertrieb Europa, sagte es.')).toBe(
      `${NAME}, Leiter Vertrieb Europa, sagte es.`,
    );
  });

  it('reads no name from "…\'a göre" alone, as from "according to": a tool goes with it too', () => {
    expect(fix("Ayşe Yılmaz'a göre bu doğru.")).toBe("Ayşe Yılmaz'a göre bu doğru.");
    expect(fix("Google Analytics'e göre trafik arttı.")).toBe(
      "Google Analytics'e göre trafik arttı.",
    );
  });

  it('reads a name with a bare verb only when the verb is said of people', () => {
    // Products and companies recommend, add and describe too.
    for (const line of [
      'Google Ads recommends a daily budget for new campaigns.',
      'Microsoft Teams adds a tab for each channel.',
      'Product Hunt describes it as a launch site.',
      'Clicks doubled, according to Google Analytics.',
      'Marco Rossi emphasizes speed.',
    ]) {
      expect(fix(line)).toBe(line);
    }
    // With an honorific or a role, any of them reads the name.
    expect(fix('Dr. Sarah Chen recommends a daily budget.')).toBe(
      `${NAME} recommends a daily budget.`,
    );
    expect(fix('CEO Marco Rossi adds a tab.')).toBe(`CEO ${NAME} adds a tab.`);
    for (const verb of [
      'said',
      'told',
      'explained',
      'recalled',
      'admitted',
      'insisted',
      'argued',
    ]) {
      expect(fix(`Marco Rossi ${verb} it twice.`)).toBe(`${NAME} ${verb} it twice.`);
    }
    expect(fix('It was explained by Marco Rossi.')).toBe(`It was explained by ${NAME}.`);
  });

  it('reads a long run of spaces quickly, after a quote mark too (review, #1544)', () => {
    // A character past Latin-1 (’, “): V8 skips no position then.
    const texts = (run) => [
      `Ürün’${run}sarah, our head of growth.`,
      `“Pour slowly”${run}says it.`,
      `"Pour slowly"${run}it says.`,
    ];
    texts(' ').forEach((text) => guardPeople(text, people));
    for (const space of [' ', '\u00a0', '\n']) {
      for (const text of texts(space.repeat(30_000))) {
        const started = Date.now();
        guardPeople(text, people);
        expect(Date.now() - started).toBeLessThan(150);
      }
    }
  });

  it('reads long text quickly, whatever its words', () => {
    const word = `A${'a'.repeat(400)}`;
    const long = `${word} ${word} ${word} said. `.repeat(10);
    const start = Date.now();
    guardPeople(long, people);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('guardPeople: what the no-fabrication test set found', () => {
  const fix = (text) => guardPeople(text, known).text;

  it('reads whoever says a quote, right next to it, with a verb only people use', () => {
    for (const [line, out] of [
      [
        '“Forecasting weekly turned our cash flow around,” says Priya Shah.',
        `${QUOTE} says ${NAME}.`,
      ],
      [
        '“Forecasting weekly turned our cash flow around,” Priya Shah says.',
        `${QUOTE} ${NAME} says.`,
      ],
      ['„Wöchentlich planen hat alles verändert“, sagt Priya Shah.', `${QUOTE}, sagt ${NAME}.`],
      ['»Wöchentlich planen hat alles verändert«, sagt Priya Shah.', `${QUOTE}, sagt ${NAME}.`],
      ['‚Wöchentlich planen hat alles verändert‘, sagt Priya Shah.', `${QUOTE}, sagt ${NAME}.`],
      ['“Haftalık tahmin her şeyi değiştirdi,” diyor Priya Shah.', `${QUOTE} diyor ${NAME}.`],
      ['This works for every team, says Tom Becker.', `This works for every team, says ${NAME}.`],
    ]) {
      expect(fix(line)).toBe(out);
    }
    // A known quote by a known person stays, a company after the name too.
    for (const line of [
      '“Forecasts are only as good as the deals in them,” says Ada Lovelace.',
      '„Forecasts are only as good as the deals in them“, sagt Ada Lovelace von Northwind.',
      // A company recommends too: its name isn't a person's.
      '“Forecasts are only as good as the deals in them,” recommends Northwind Finance.',
    ]) {
      expect(fix(line)).toBe(line);
    }
  });

  it('lets no invented name through on a known first word: only a known start before a particle', () => {
    for (const [given, line] of [
      [
        '“Grace Hopper wrote the first compiler,” the book says.',
        'Dr. Grace Kim recommends a medium grind.',
      ],
      ['Selin Kaya, Head of Finance', 'Dr. Selin Arslan recommends weekly forecasts.'],
      ['Sarah Chen (CEO)', 'Dr. Sarah Kim runs the clinic.'],
      ['Mark the date: it will rain in May or June.', 'Dr. Mark Wilson agrees.'],
      ['Mark the date: it will rain in May or June.', 'Prof. Will Carter agrees.'],
      ['Mark the date: it will rain in May or June.', 'Dr. May Chen agrees.'],
      ['Mark the date: it will rain in May or June.', 'Dr. June Park agrees.'],
      // A known last name alone, or a common word as one.
      ['Grace Hopper', 'Dr. Jane Hopper recommends it.'],
      ['Green tea', 'Dr. Sarah Green recommends it.'],
      ['Selin Kaya', 'Dr. Ayşe Kaya recommends it.'],
    ]) {
      expect(guardPeople(line, knownPeople(given)).text).toContain(NAME);
    }
    expect(guardPeople('Dr. Hopper recommends it.', knownPeople('Grace Hopper')).text).toBe(
      'Dr. Hopper recommends it.',
    );
    // A German noun after a known name, a word the page has: still the known name.
    const german = 'Wir rösten selbst, weil Gründerin Anna Schmidt Kaffee liebt.';
    expect(guardPeople(german, knownPeople('Anna Schmidt, Gründerin. Kaffee')).text).toBe(german);
    expect(guard('CEO Ada Lovelace Brown agrees.')).toBe(`CEO ${NAME} agrees.`);
    // A known name, a company after its particle: still known.
    expect(guard('CEO Ada Lovelace von Northwind agrees.')).toBe(
      'CEO Ada Lovelace von Northwind agrees.',
    );
  });

  it('reads a Turkish role’s name before a comma or "da" when the sentence ends saying so', () => {
    expect(
      fix('Fintrail genel müdürü Ayşe Demir, bunun her ekip için işe yaradığını söyledi.'),
    ).toBe(`Fintrail genel müdürü ${NAME}, bunun her ekip için işe yaradığını söyledi.`);
    expect(fix('Fintrail genel müdürü Ayşe Demir, bunun önemli olduğunu ifade etti.')).toBe(
      `Fintrail genel müdürü ${NAME}, bunun önemli olduğunu ifade etti.`,
    );
    expect(
      fix('Fintrail genel müdürü Tom Becker da alıcıların çoğunun aynı fikirde olduğunu ekliyor.'),
    ).toBe(`Fintrail genel müdürü ${NAME} da alıcıların çoğunun aynı fikirde olduğunu ekliyor.`);
    // A verb said only of people needs no reported speech; one that also
    // means added needs it, plural and with "da" or "sözlerine" too.
    for (const [line, out] of [
      [
        'Fintrail genel müdürü Ayşe Demir, “Bu her ekip için işe yarıyor” dedi.',
        `Fintrail genel müdürü ${NAME}, ${QUOTE} dedi.`,
      ],
      [
        'Fintrail genel müdürü Ayşe Demir, ürünün çok hızlı olduğunu da ekledi.',
        `Fintrail genel müdürü ${NAME}, ürünün çok hızlı olduğunu da ekledi.`,
      ],
      [
        'Fintrail genel müdürü Ayşe Demir, ekiplerin çok memnun olduklarını söyledi.',
        `Fintrail genel müdürü ${NAME}, ekiplerin çok memnun olduklarını söyledi.`,
      ],
      [
        'Fintrail genel müdürü Ayşe Demir, bunun doğru olduğunu sözlerine ekledi.',
        `Fintrail genel müdürü ${NAME}, bunun doğru olduğunu sözlerine ekledi.`,
      ],
      [
        'Kurucusu Ayşe Demir de bu yöntemi her ekibe anlatıyor.',
        `Kurucusu ${NAME} de bu yöntemi her ekibe anlatıyor.`,
      ],
    ]) {
      expect(fix(line)).toBe(out);
    }
    // A list of tools after a trade isn't a person, nor one "de dahil", nor
    // a name the sentence says nothing of.
    for (const line of [
      'Bir SEO uzmanı Google Analytics, Search Console ve Ahrefs kullanır.',
      'Bir e-ticaret uzmanı Shopify Plus, WooCommerce ve Magento arasındaki farkları açıklıyor.',
      'Bir SEO uzmanı Google Analytics, Ahrefs ve Semrush verilerini birlikte okuduğunu söylüyor.',
      'Pazarlama müdürü Google Analytics de dahil birçok aracı kullandığını söyledi.',
      'Pazarlama müdürü Ayşe Yılmaz, kampanyayı yönetti.',
      // "ekledi", "kaydetti", "aktardı" mean added, saved, transferred too:
      // read only after reported speech ("…olduğunu ekliyor").
      'Bir e-ticaret uzmanı Shopify Plus da kullanarak ürünleri mağazaya ekledi.',
      'Bir veri uzmanı Google Sheets da kullanıp tabloyu kaydetti.',
      'Proje yöneticisi Microsoft Teams da açık tutuyor ve dosyaları ekibe aktardı.',
      'Hesap yöneticisi Google Ads da yeni kampanyayı ekledi.',
    ]) {
      expect(fix(line)).toBe(line);
    }
  });

  it('reads guillemets around a quote, never the words between two quotes, French spaced ones too', () => {
    for (const line of [
      '«Hızlı» ve «güvenilir» kelimeleri her yerde kullanılıyor ama müşteriler hep «sade» diyor.',
      'Die Wörter »schnell« und »sicher« stehen überall, aber Kunden sagen »einfach«.',
    ]) {
      expect(fix(line)).toBe(line);
    }
    // French spaces its « … », with a normal, no-break or narrow no-break space.
    for (const line of [
      'Les clients disent « rapide » mais ils veulent surtout un service « fiable » au quotidien.',
      'On parle de « recherche générative » depuis deux ans, et le terme « AEO » se répand vite.',
      'Le format « question-réponse » aide beaucoup les moteurs, surtout avec un bloc « FAQ » clair.',
      'Les clients disent «\u00a0rapide\u00a0» mais ils veulent surtout un service «\u00a0fiable\u00a0» au quotidien.',
      'Les clients disent «\u202frapide\u202f» mais ils veulent surtout un service «\u202ffiable\u202f» au quotidien.',
    ]) {
      expect(fix(line)).toBe(line);
    }
    expect(fix('Sie sagte: »Wir haben die Kosten in einem Jahr halbiert.«')).toBe(
      `Sie sagte: ${QUOTE}`,
    );
    // A quote they do hold is still read, a guillemet before it on the line too.
    expect(fix('«Haftalık tahmin her şeyi değiştirdi», diyor Priya Shah.')).toBe(
      `${QUOTE}, diyor ${NAME}.`,
    );
    expect(fix('Ürünler » Analiz: «Haftalık tahmin her şeyi değiştirdi», diyor Priya Shah.')).toBe(
      `Ürünler » Analiz: ${QUOTE}, diyor ${NAME}.`,
    );
    expect(
      fix('«Schnell» und »Das hat unseren Umsatz wirklich verdoppelt«, sagt Anna Weber.'),
    ).toBe(`«Schnell» und ${QUOTE}, sagt ${NAME}.`);
  });

  it('takes a product that "says" for a person: the trade made for "…, says Tom Becker."', () => {
    expect(fix('Broad match finds new queries, says Google Ads.')).toBe(
      `Broad match finds new queries, says ${NAME}.`,
    );
  });

  it("reads a customer's story as a person's, and no customer in a product's name", () => {
    for (const [line, out] of [
      [
        'Last spring our customer Jana Novak finished in a week.',
        `Last spring our customer ${NAME} finished in a week.`,
      ],
      ['One client Jana Novak called it simple.', `One client ${NAME} called it simple.`],
      ['Müşterimiz Jana Novak işi erken bitirdi.', `Müşterimiz ${NAME} işi erken bitirdi.`],
      ['Unsere Kundin Jana Novak war früher fertig.', `Unsere Kundin ${NAME} war früher fertig.`],
      ['Ein Kunde Jonas Weber war früher fertig.', `Ein Kunde ${NAME} war früher fertig.`],
    ]) {
      expect(fix(line)).toBe(out);
    }
    for (const line of [
      'A Customer Data Platform joins the data.',
      'HubSpot, a customer relationship management platform, tracks deals.',
      'Microsoft Outlook, an email client, syncs mail.',
      'The email client Microsoft Outlook syncs mail.',
      'Track customer Lifetime Value monthly.',
      'Salesforce Service Cloud, müşteri desteği için bir platformdur.',
      'Müşteri Deneyimi Yönetimi önemlidir.',
    ]) {
      expect(fix(line)).toBe(line);
    }
  });

  it('reads German compound posts and "erzählte", and no ladder, conductor, product or newspaper', () => {
    for (const [line, out] of [
      [
        'Marco Rossi, Finanzchef bei Fintrail, sagte, dass es funktioniert.',
        `${NAME}, Finanzchef bei Fintrail, sagte, dass es funktioniert.`,
      ],
      [
        'Laut Vertriebsleiterin Anna Schmidt läuft es gut.',
        `Laut Vertriebsleiterin ${NAME} läuft es gut.`,
      ],
      ['Anna Schmidt erzählte uns davon.', `${NAME} erzählte uns davon.`],
    ]) {
      expect(fix(line)).toBe(out);
    }
    for (const line of [
      'Die Leiter Hailo ProfiStep steht im Keller.',
      'Die Teleskopleiter Hailo ProfiStep steht im Keller.',
      'Der Halbleiter Infineon Technologies liefert Chips.',
      'Der Schutzleiter Phoenix Contact ist grün-gelb.',
      'Bosch Rexroth, ein Hersteller für Halbleiter, wächst.',
      'Use Chef Infra Server to manage your fleet.',
      'Wie Der Spiegel berichtete, wächst der Markt.',
      'Die Süddeutsche Zeitung berichtete über das Tool.',
      'Microsoft Deutschland erklärte, dass Copilot kommt.',
    ]) {
      expect(fix(line)).toBe(line);
    }
  });

  it('reads the new cues quickly on long text', () => {
    const long =
      `Fintrail genel müdürü Ayşe Demir, ${'çok uzun bir açıklama yapıyor '.repeat(8)}`.repeat(400);
    const started = Date.now();
    guardPeople(`${long} “${'word '.repeat(50)}” says ${'Aa Bb, '.repeat(200)}`, known);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('guardPeopleInHtml', () => {
  it('reads the words only, and makes an unknown blockquote one placeholder', () => {
    const { html, count } = guardPeopleInHtml(
      '<blockquote><p>We doubled our sales in a <strong>single</strong> quarter.</p></blockquote>' +
        '<p>Marco Rossi said <a href="https://acme.com/">it</a> works.</p>' +
        '<pre>Jane Doe said "keep code as it is written here"</pre>',
      known,
    );
    expect(count).toBe(2);
    expect(html).toBe(
      `<blockquote><p>${QUOTE}</p></blockquote>` +
        `<p>${NAME} said <a href="https://acme.com/">it</a> works.</p>` +
        '<pre>Jane Doe said "keep code as it is written here"</pre>',
    );
  });

  it("keeps the page's own blockquote, and reads its cite for the name", () => {
    const page = knownPeople(
      'We doubled our pipeline in a month. Then we tripled it again.',
      'Ada Lovelace',
    );
    const own =
      '<blockquote><p>We doubled our pipeline in a month.</p><p>Then we tripled it again.</p>' +
      '<cite>Ada Lovelace</cite></blockquote>';
    expect(guardPeopleInHtml(own, page)).toEqual({ html: own, count: 0 });
    expect(
      guardPeopleInHtml(
        '<blockquote><p>We doubled our pipeline in a month.</p><cite>Mark Twain</cite></blockquote>',
        page,
      ).html,
    ).toBe(
      `<blockquote><p>We doubled our pipeline in a month.</p><cite>${NAME}</cite></blockquote>`,
    );
    expect(guardPeopleInHtml('<p>As she put it, <q>we never looked back</q>.</p>', page).html).toBe(
      `<p>As she put it, ${QUOTE}.</p>`,
    );
  });

  it('reads a quote across the bold and the links in it, and drops what it emptied', () => {
    expect(
      guardPeopleInHtml(
        '<p>“We <strong>doubled</strong> our pipeline in a month,” said Marco Rossi.</p>' +
          '<p>“Our <a href="https://x.example/">AEO tracker</a> doubled our pipeline,” she said.</p>',
        known,
      ).html,
    ).toBe(`<p>${QUOTE} said ${NAME}.</p><p>${QUOTE} she said.</p>`);
  });

  it('reads a heading for quotes and speech only', () => {
    expect(
      guardPeopleInHtml('<h2>Lead Scoring Best Practices</h2><p>CEO Tim Cook agrees.</p>', known)
        .html,
    ).toBe(`<h2>Lead Scoring Best Practices</h2><p>CEO ${NAME} agrees.</p>`);
  });

  it('returns the HTML as it was when there is nothing to put', () => {
    const html = '<p>Ada Lovelace&nbsp;writes.</p>';
    expect(guardPeopleInHtml(html, known)).toEqual({ html, count: 0 });
  });
});

describe('authorWords', () => {
  it("reads the workspace's authors: names, titles and bios", async () => {
    const calls = [];
    const db = {
      from: (table) => ({
        select: (cols) => ({
          eq: async (col, value) => {
            calls.push([table, cols, col, value]);
            return {
              data: [
                { name: 'Ada Lovelace', title: 'Head of Content', bio: null },
                { name: 'Bob Stone', title: null, bio: 'Roasts coffee.' },
              ],
              error: null,
            };
          },
        }),
      }),
    };
    expect(await authorWords(db, 'o1')).toEqual([
      'Ada Lovelace',
      'Head of Content',
      'Bob Stone',
      'Roasts coffee.',
    ]);
    expect(calls).toEqual([['content_authors', 'name, title, bio', 'organization_id', 'o1']]);
  });

  it('reads none, and fails no run, when the authors can’t be read', async () => {
    const log = { warn: vi.fn() };
    // content_authors not there yet (before its migration), or a failed read.
    const missing = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: null,
            error: { code: '42P01', message: 'relation "public.content_authors" does not exist' },
          }),
        }),
      }),
    };
    await expect(authorWords(missing, 'o1', log)).resolves.toEqual([]);
    const down = {
      from: () => {
        throw new Error('fetch failed');
      },
    };
    await expect(authorWords(down, 'o1', log)).resolves.toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0][0]).toMatchObject({ organizationId: 'o1' });
  });
});

describe('long input read quickly (#1544 review)', () => {
  const none = knownPeople('');
  const time = (read) => {
    const started = Date.now();
    read();
    return Date.now() - started;
  };

  it('reads letters joined by apostrophes, and an opening bracket with no closing one', () => {
    // A character past Latin-1 (Ü, ’) in each: V8 skips no position then.
    const texts = (n) => [
      `Ürün ${'Ab’'.repeat(n)} said it.`,
      `Ürün ${'A’'.repeat(n)} said it.`,
      `Ürün ${'a’Aa’A'.repeat(Math.ceil(n / 2))} said it.`,
      `Ürün ${"''A".repeat(n)} said it.`,
      `Ürün ${'[a '.repeat(n)}Marco Rossi said it.`,
    ];
    // Compiled once, apart from the timing.
    texts(2).forEach((text) => guardPeople(text, none));
    for (const text of texts(20_000)) {
      expect(
        time(() => guardPeople(text, none)),
        text.slice(0, 12),
      ).toBeLessThan(150);
    }
    // A name after an opening quote mark is still read, and an apostrophe's own name.
    expect(guardPeople("'Jane Doe said it twice.", none).text).toBe(`'${NAME} said it twice.`);
    expect(guardPeople("Bob O'Neil said it twice.", none).text).toBe(`${NAME} said it twice.`);
  });

  it('puts thousands of names on one line in time near its length', () => {
    // 20,000 names: checked against every edit kept, or rebuilt per edit,
    // they took over a second (main, 2026-10-26); read once, about 30 ms.
    const line = 'Marco Rossi said it. '.repeat(20_000);
    guardPeople('Marco Rossi said it.', none);
    let out;
    expect(time(() => (out = guardPeople(`Ürün: ${line}`, none)))).toBeLessThan(150);
    expect(out.edits).toHaveLength(20_000);
    let html;
    expect(
      time(() => (html = guardPeopleInHtml(`<p>Ürün: <b>x</b> ${line}</p>`, none))),
    ).toBeLessThan(300);
    expect(html.count).toBe(20_000);
    expect(html.html).toBe(`<p>Ürün: <b>x</b> ${`${NAME} said it. `.repeat(20_000)}</p>`);
  });
});
