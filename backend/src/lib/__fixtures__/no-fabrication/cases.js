/**
 * The no-fabrication test set (Content Editor Quality spec §9, "A test set
 * of 50 drafts shows zero invented names, quotes or numbers"): 63 drafts,
 * three site types (B2B, B2C, e-commerce) in three languages (English,
 * Turkish, German), seven answers each. Each answer is the Content Agent's,
 * as recorded or written to try the guards: it names people nobody gave
 * it, quotes words nobody said, adds figures from nowhere, tells a
 * customer's story, and uses what the person did give (Authors, Brief ›
 * Your input, the Sources tab's data), alone or mixed in.
 *
 * Each case lists what must not survive the guards (`invented`) and what
 * must (`kept`), in the agent's suggestions (`fix`) and in a page it writes
 * whole (`page`): a suggestion that adds a figure with no source is dropped
 * whole, the person's words in it too. A suggestion's sources name the person's data by ref
 * ('@data:1', '@quote:1', '@getcito'): the test numbers them as the agent
 * reads them. `node src/scripts/evalNoFabrication.js` asks the model
 * itself for each draft and keeps its answers beside these (recorded.json).
 */

const PROMPT_ID = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';

/** Each site type's draft, in each language: the page, the brand and what the person gave. */
const DRAFTS = {
  b2b: {
    en: {
      brand: {
        name: 'Ledgerly',
        industry: 'Finance software',
        description: 'Cash forecasting for small finance teams.',
      },
      title: 'How small finance teams forecast cash',
      passages: [
        'Cash forecasting shows how much money a team will have each week.',
        'Start with the bills you know',
        'List the payments that are already agreed.',
        'Check it every Monday',
        'Compare the forecast with the bank balance.',
      ],
      author: { name: 'Selin Kaya', title: 'Head of Finance Content' },
      experience:
        'We tested weekly forecasts with twelve small finance teams for eight weeks and saw fewer late payments.',
      table: {
        name: 'Survey',
        rows: [
          ['Teams', 'Missed by'],
          ['1,250', '4%'],
        ],
      },
      getcito: { prompt: 'best cash forecasting tool', answers: 825, mentioned: 28 },
      quote: {
        name: 'Ada Lovelace',
        title: 'CFO, Northwind',
        text: 'Our weekly forecast cut late payments in half.',
        sourceUrl: 'https://northwind.example/talk',
      },
      prompt: 'How do small finance teams forecast cash?',
      fanout: 'weekly cash forecast template',
    },
    tr: {
      brand: {
        name: 'Ledgerly',
        industry: 'Finans yazılımı',
        description: 'Küçük finans ekipleri için nakit tahmini.',
      },
      title: 'Küçük finans ekipleri nakdi nasıl tahmin eder',
      passages: [
        'Nakit tahmini, ekibin her hafta ne kadar parası olacağını gösterir.',
        'Bildiğiniz faturalarla başlayın',
        'Kesinleşmiş ödemeleri listeleyin.',
        'Her pazartesi kontrol edin',
        'Tahmini banka bakiyesiyle karşılaştırın.',
      ],
      author: { name: 'Selin Kaya', title: 'Finans İçerik Sorumlusu' },
      experience:
        'Haftalık tahmini on iki küçük finans ekibiyle sekiz hafta denedik ve geciken ödemeler azaldı.',
      table: {
        name: 'Anket',
        rows: [
          ['Ekip', 'Sapma'],
          ['1.250', '%4'],
        ],
      },
      getcito: { prompt: 'en iyi nakit tahmin aracı', answers: 825, mentioned: 28 },
      quote: {
        name: 'Ada Lovelace',
        title: 'Finans Direktörü, Northwind',
        text: 'Haftalık tahminimiz geciken ödemeleri yarıya indirdi.',
        sourceUrl: 'https://northwind.example/konusma',
      },
      prompt: 'Küçük finans ekipleri nakdi nasıl tahmin eder?',
      fanout: 'haftalık nakit tahmini şablonu',
    },
    de: {
      brand: {
        name: 'Ledgerly',
        industry: 'Finanzsoftware',
        description: 'Liquiditätsplanung für kleine Finanzteams.',
      },
      title: 'Wie kleine Finanzteams ihre Liquidität planen',
      passages: [
        'Die Liquiditätsplanung zeigt, wie viel Geld ein Team jede Woche hat.',
        'Beginnen Sie mit den bekannten Rechnungen',
        'Listen Sie die Zahlungen auf, die bereits vereinbart sind.',
        'Prüfen Sie sie jeden Montag',
        'Vergleichen Sie die Planung mit dem Kontostand.',
      ],
      author: { name: 'Selin Kaya', title: 'Leiterin Finanzinhalte' },
      experience:
        'Wir haben die Wochenplanung acht Wochen lang mit zwölf kleinen Finanzteams getestet und weniger verspätete Zahlungen gesehen.',
      table: {
        name: 'Umfrage',
        rows: [
          ['Teams', 'Abweichung'],
          ['1.250', '4 %'],
        ],
      },
      getcito: { prompt: 'bestes Tool für Liquiditätsplanung', answers: 825, mentioned: 28 },
      quote: {
        name: 'Ada Lovelace',
        title: 'Finanzchefin, Northwind',
        text: 'Unsere Wochenplanung hat verspätete Zahlungen halbiert.',
        sourceUrl: 'https://northwind.example/vortrag',
      },
      prompt: 'Wie planen kleine Finanzteams ihre Liquidität?',
      fanout: 'Vorlage Liquiditätsplanung wöchentlich',
    },
  },
  b2c: {
    en: {
      brand: {
        name: 'Brewly',
        industry: 'Coffee subscriptions',
        description: 'Fresh beans delivered every two weeks.',
      },
      title: 'How to brew pour-over coffee at home',
      passages: [
        'Pour-over coffee needs a dripper, a filter and fresh beans.',
        'Grind just before you brew',
        'Use a medium grind for a clean cup.',
        'Pour in slow circles',
        'Let the coffee bloom before the main pour.',
      ],
      author: { name: 'Mert Aydın', title: 'Head Roaster' },
      experience:
        'We brewed three grinders side by side for six weeks in our roastery, and the burr grinder kept the grind steadiest.',
      table: {
        name: 'Tasting notes',
        rows: [
          ['Brews', 'Preferred'],
          ['2,400', '62%'],
        ],
      },
      getcito: { prompt: 'best coffee subscription', answers: 640, mentioned: 17 },
      quote: {
        name: 'Grace Hopper',
        title: 'Barista Trainer, Bean Lab',
        text: 'A steady grind matters more than an expensive kettle.',
        sourceUrl: 'https://beanlab.example/interview',
      },
      prompt: 'How do I brew pour-over coffee?',
      fanout: 'pour over coffee ratio',
    },
    tr: {
      brand: {
        name: 'Brewly',
        industry: 'Kahve aboneliği',
        description: 'İki haftada bir taze çekirdek.',
      },
      title: 'Evde demleme kahve nasıl yapılır',
      passages: [
        'Demleme kahve için bir demleyici, bir filtre ve taze çekirdek gerekir.',
        'Demlemeden hemen önce öğütün',
        'Temiz bir fincan için orta öğütüm kullanın.',
        'Yavaş daireler çizerek dökün',
        'Asıl dökmeden önce kahvenin kabarmasını bekleyin.',
      ],
      author: { name: 'Mert Aydın', title: 'Baş Kavurmacı' },
      experience:
        'Üç öğütücüyü kavurma atölyemizde altı hafta yan yana denedik ve çelik bıçaklı öğütücü en düzenli öğütümü verdi.',
      table: {
        name: 'Tadım notları',
        rows: [
          ['Demleme', 'Tercih'],
          ['2.400', '%62'],
        ],
      },
      getcito: { prompt: 'en iyi kahve aboneliği', answers: 640, mentioned: 17 },
      quote: {
        name: 'Grace Hopper',
        title: 'Barista Eğitmeni, Bean Lab',
        text: 'Düzenli bir öğütüm pahalı bir demlikten daha önemlidir.',
        sourceUrl: 'https://beanlab.example/roportaj',
      },
      prompt: 'Demleme kahve nasıl yapılır?',
      fanout: 'demleme kahve oranı',
    },
    de: {
      brand: {
        name: 'Brewly',
        industry: 'Kaffee-Abos',
        description: 'Frische Bohnen alle zwei Wochen.',
      },
      title: 'So gelingt Handfilterkaffee zu Hause',
      passages: [
        'Für Handfilterkaffee brauchen Sie einen Filterhalter, einen Filter und frische Bohnen.',
        'Mahlen Sie direkt vor dem Aufbrühen',
        'Ein mittlerer Mahlgrad ergibt eine klare Tasse.',
        'Gießen Sie in langsamen Kreisen',
        'Lassen Sie den Kaffee vor dem Hauptaufguss quellen.',
      ],
      author: { name: 'Mert Aydın', title: 'Leiter der Rösterei' },
      experience:
        'Wir haben drei Mühlen sechs Wochen lang in unserer Rösterei nebeneinander getestet, und die Kegelmühle mahlte am gleichmäßigsten.',
      table: {
        name: 'Verkostung',
        rows: [
          ['Aufgüsse', 'Bevorzugt'],
          ['2.400', '62 %'],
        ],
      },
      getcito: { prompt: 'bestes Kaffee-Abo', answers: 640, mentioned: 17 },
      quote: {
        name: 'Grace Hopper',
        title: 'Barista-Trainerin, Bean Lab',
        text: 'Ein gleichmäßiger Mahlgrad ist wichtiger als ein teurer Wasserkocher.',
        sourceUrl: 'https://beanlab.example/gespraech',
      },
      prompt: 'Wie brühe ich Handfilterkaffee?',
      fanout: 'Handfilter Kaffee Verhältnis',
    },
  },
  ecommerce: {
    en: {
      brand: {
        name: 'Pedalhaus',
        industry: 'Bike shop',
        description: 'City and touring bikes, fitted in store.',
      },
      title: 'How to choose a city bike',
      passages: [
        'A city bike should fit your height and the roads you ride.',
        'Pick the frame size first',
        'Stand over the bike with both feet flat on the ground.',
        'Choose gears for your hills',
        'A hub gear needs less care than a derailleur.',
      ],
      author: { name: 'Lena Fischer', title: 'Workshop Lead' },
      experience:
        'We fitted riders on four frame sizes in our store for a month, and most riders chose the size below their usual one.',
      table: {
        name: 'Returns',
        rows: [
          ['Bikes sold', 'Returned'],
          ['3,120', '2.5%'],
        ],
      },
      getcito: { prompt: 'best city bike shop', answers: 410, mentioned: 9 },
      quote: {
        name: 'Margaret Hamilton',
        title: 'Bike Fitter, Velo Studio',
        text: 'Most riders choose a frame that is one size too big.',
        sourceUrl: 'https://velostudio.example/guide',
      },
      prompt: 'How do I choose a city bike?',
      fanout: 'city bike frame size chart',
    },
    tr: {
      brand: {
        name: 'Pedalhaus',
        industry: 'Bisiklet mağazası',
        description: 'Şehir ve tur bisikletleri, mağazada ayar.',
      },
      title: 'Şehir bisikleti nasıl seçilir',
      passages: [
        'Şehir bisikleti boyunuza ve sürdüğünüz yollara uymalıdır.',
        'Önce kadro boyunu seçin',
        'İki ayağınız yere düz basarak bisikletin üzerinde durun.',
        'Yokuşlarınıza göre vites seçin',
        'Göbek vites, aktarıcıdan daha az bakım ister.',
      ],
      author: { name: 'Lena Fischer', title: 'Atölye Sorumlusu' },
      experience:
        'Bir ay boyunca mağazamızda dört kadro boyunda sürücü ölçtük ve sürücülerin çoğu alıştığından bir küçük boyu seçti.',
      table: {
        name: 'İadeler',
        rows: [
          ['Satılan', 'İade'],
          ['3.120', '%2,5'],
        ],
      },
      getcito: { prompt: 'en iyi şehir bisikleti mağazası', answers: 410, mentioned: 9 },
      quote: {
        name: 'Margaret Hamilton',
        title: 'Bisiklet Ayar Uzmanı, Velo Studio',
        text: 'Sürücülerin çoğu bir beden büyük kadro seçiyor.',
        sourceUrl: 'https://velostudio.example/rehber',
      },
      prompt: 'Şehir bisikleti nasıl seçilir?',
      fanout: 'şehir bisikleti kadro ölçü tablosu',
    },
    de: {
      brand: {
        name: 'Pedalhaus',
        industry: 'Fahrradladen',
        description: 'Stadt- und Tourenräder, im Laden angepasst.',
      },
      title: 'So wählen Sie ein Stadtrad',
      passages: [
        'Ein Stadtrad sollte zu Ihrer Größe und Ihren Wegen passen.',
        'Wählen Sie zuerst die Rahmengröße',
        'Stellen Sie sich mit beiden Füßen flach auf den Boden über das Rad.',
        'Wählen Sie die Gänge für Ihre Steigungen',
        'Eine Nabenschaltung braucht weniger Pflege als eine Kettenschaltung.',
      ],
      author: { name: 'Lena Fischer', title: 'Werkstattleiterin' },
      experience:
        'Wir haben einen Monat lang im Laden Fahrer auf vier Rahmengrößen vermessen, und die meisten wählten eine Größe kleiner als gewohnt.',
      table: {
        name: 'Rücksendungen',
        rows: [
          ['Verkauft', 'Zurück'],
          ['3.120', '2,5 %'],
        ],
      },
      getcito: { prompt: 'bester Fahrradladen für Stadträder', answers: 410, mentioned: 9 },
      quote: {
        name: 'Margaret Hamilton',
        title: 'Bikefitterin, Velo Studio',
        text: 'Die meisten Fahrer wählen einen Rahmen, der eine Nummer zu groß ist.',
        sourceUrl: 'https://velostudio.example/ratgeber',
      },
      prompt: 'Wie wähle ich ein Stadtrad?',
      fanout: 'Stadtrad Rahmengröße Tabelle',
    },
  },
};

/**
 * What the agent makes up, in each language: people with roles, a quote
 * and a testimonial nobody said, figures from nowhere, and a customer's
 * story with a name and a number.
 */
const INVENTED = {
  en: {
    person: 'Marco Rossi',
    personWithRole: (p) => `${p}, CEO of Fintrail`,
    quote: 'This tool changed how our whole team plans the month',
    testimonial: 'I would never go back to the old way of doing it',
    figure: '73%',
    money: '$12,000',
    story: 'Jana Novak',
    days: '19',
    other: 'Tom Becker',
    otherFigure: '64%',
  },
  tr: {
    person: 'Ayşe Demir',
    quote: 'Bu araç tüm ekibimizin ayı planlama biçimini değiştirdi',
    testimonial: 'Eski yönteme asla geri dönmem',
    figure: '%73',
    money: '12.000 TL',
    story: 'Jana Novak',
    days: '19',
    other: 'Tom Becker',
    otherFigure: '%64',
  },
  de: {
    person: 'Marco Rossi',
    quote: 'Dieses Tool hat verändert, wie unser ganzes Team den Monat plant',
    testimonial: 'Ich würde nie wieder zur alten Methode zurückkehren',
    figure: '73 %',
    money: '12.000 €',
    story: 'Jana Novak',
    days: '19',
    other: 'Tom Becker',
    otherFigure: '64 %',
  },
};

/**
 * One answer of each kind, in each language, from a draft (d) and what it
 * makes up (x). A figure with no source drops its whole suggestion, so a
 * made-up name and a made-up figure go in suggestions apart: each must
 * reach its own guard.
 */
const ANSWERS = {
  en: {
    invented_person: (d, x) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}, says ${x.person}, CEO of Fintrail.`,
        ),
      ],
      page: {
        intro: [`${x.person}, head of finance at Fintrail, said this works for every team.`],
      },
      invented: [x.person],
    }),
    invented_quote: (d, x) => ({
      fix: [
        insert(
          6,
          `<p>“${x.quote},” said one of our customers.</p><blockquote><p>“${x.testimonial}.”</p></blockquote>`,
        ),
      ],
      page: { intro: [`“${x.quote},” says Priya Shah.`] },
      invented: [x.quote, x.testimonial, 'Priya Shah'],
    }),
    invented_number: (d, x) => ({
      fix: [
        replace(
          6,
          d.passages[4],
          `${d.passages[4].slice(0, -1)}: ${x.figure} of teams who do this save time.`,
        ),
      ],
      page: {
        intro: [
          `Teams that follow these steps save ${x.money} a year and get ${x.figure} better results.`,
        ],
      },
      invented: [x.figure, x.money],
    }),
    invented_story: (d, x) => ({
      fix: [
        insert(4, `<p>Last spring our customer ${x.story} finished well ahead of plan.</p>`),
        insert(6, `<p>It took ${x.days} days instead of a month.</p>`),
      ],
      page: { intro: [`Our customer ${x.story} told us she finished ${x.days} days sooner.`] },
      invented: [x.story, `${x.days} days`],
    }),
    given_input: (d) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}: ${d.table.rows[1][0]} said so in our survey.`,
          ['@data:1'],
        ),
        insert(
          6,
          `<p>“${d.quote.text.slice(0, -1)},” says ${d.quote.name}, ${d.quote.title}.</p>`,
          ['@quote:1'],
        ),
      ],
      page: {
        intro: [
          `${d.brand.name} was named in ${d.getcito.mentioned} of ${d.getcito.answers} AI answers to this question (GetCito data, October 2026).`,
          `${d.author.name}, ${d.author.title}, explains each step. “${d.quote.text}” says ${d.quote.name}.`,
        ],
      },
      kept: {
        fix: [d.table.rows[1][0], d.quote.text.slice(0, -1), d.quote.name],
        page: [
          d.quote.text.slice(0, -1),
          d.quote.name,
          d.author.name,
          `${d.getcito.mentioned} of ${d.getcito.answers}`,
        ],
      },
    }),
    mixed: (d, x) => ({
      fix: [
        insert(
          4,
          `<p>${d.quote.name} says “${d.quote.text.slice(0, -1)},” and ${x.other}, CEO of Fintrail, agrees.</p>`,
          ['@quote:1'],
        ),
        insert(6, `<p>${x.otherFigure} of buyers agree.</p>`),
      ],
      page: {
        intro: [
          `${d.quote.name} says “${d.quote.text.slice(0, -1)},” and ${x.other}, CEO of Fintrail, adds that ${x.otherFigure} of buyers agree.`,
        ],
      },
      invented: [x.other, x.otherFigure],
      kept: {
        fix: [d.quote.name, d.quote.text.slice(0, -1)],
        page: [d.quote.name, d.quote.text.slice(0, -1)],
      },
    }),
    other_forms: (d, x) => ({
      fix: [insert(4, `<p>“${x.testimonial},” Priya Shah says.</p>`)],
      page: {
        intro: [`“${x.quote},” ${x.person} says.`, `This works for every team, says ${x.other}.`],
      },
      invented: [x.quote, x.person, x.other, x.testimonial, 'Priya Shah'],
    }),
  },
  tr: {
    invented_person: (d, x) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}, diyor pazarlama müdürü ${x.person}.`,
        ),
      ],
      page: {
        intro: [`Fintrail genel müdürü ${x.person}, bunun her ekip için işe yaradığını söyledi.`],
      },
      invented: [x.person],
    }),
    invented_quote: (d, x) => ({
      fix: [
        insert(
          6,
          `<p>“${x.quote},” dedi müşterilerimizden biri.</p><blockquote><p>“${x.testimonial}.”</p></blockquote>`,
        ),
      ],
      page: { intro: [`“${x.quote},” diyor Priya Shah.`] },
      invented: [x.quote, x.testimonial, 'Priya Shah'],
    }),
    invented_number: (d, x) => ({
      fix: [
        replace(
          6,
          d.passages[4],
          `${d.passages[4].slice(0, -1)}: bunu yapan ekiplerin ${x.figure} kadarı zaman kazanıyor.`,
        ),
      ],
      page: {
        intro: [
          `Bu adımları izleyen ekipler yılda ${x.money} tasarruf ediyor ve ${x.figure} daha iyi sonuç alıyor.`,
        ],
      },
      invented: [x.figure, x.money],
    }),
    invented_story: (d, x) => ({
      fix: [
        insert(4, `<p>Geçen bahar müşterimiz ${x.story} işi planlanandan çok önce bitirdi.</p>`),
        insert(6, `<p>İş bir ay yerine ${x.days} günde bitti.</p>`),
      ],
      page: { intro: [`Müşterimiz ${x.story}, işi ${x.days} gün erken bitirdiğini anlattı.`] },
      invented: [x.story, `${x.days} gün`],
    }),
    given_input: (d) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}: anketimizde ${d.table.rows[1][0]} ekip böyle yaptı.`,
          ['@data:1'],
        ),
        insert(
          6,
          `<p>“${d.quote.text.slice(0, -1)},” diyor ${d.quote.title} ${d.quote.name}.</p>`,
          ['@quote:1'],
        ),
      ],
      page: {
        intro: [
          `${d.brand.name}, son 30 günde bu soruya verilen ${d.getcito.answers} yapay zekâ yanıtının ${d.getcito.mentioned} tanesinde anıldı (%${commaShare(d)}; GetCito verisi, Ekim 2026).`,
          `${d.author.title} ${d.author.name} her adımı anlatıyor. “${d.quote.text}” diyor ${d.quote.name}.`,
        ],
      },
      kept: {
        fix: [d.table.rows[1][0], d.quote.text.slice(0, -1), d.quote.name],
        page: [
          d.quote.text.slice(0, -1),
          d.quote.name,
          d.author.name,
          `${d.getcito.answers} yapay zekâ yanıtının ${d.getcito.mentioned}`,
          // The share with a decimal comma, and the days the data covers.
          `%${commaShare(d)}`,
          'son 30 günde',
        ],
      },
    }),
    mixed: (d, x) => ({
      fix: [
        insert(
          4,
          `<p>${d.quote.name} “${d.quote.text.slice(0, -1)}” diyor; Fintrail genel müdürü ${x.other} da aynı fikirde olduğunu söylüyor.</p>`,
          ['@quote:1'],
        ),
        insert(6, `<p>Alıcıların ${x.otherFigure} kadarı aynı fikirde.</p>`),
      ],
      page: {
        intro: [
          `${d.quote.name} “${d.quote.text.slice(0, -1)}” diyor; Fintrail genel müdürü ${x.other} da alıcıların ${x.otherFigure} kadarının aynı fikirde olduğunu ekliyor.`,
        ],
      },
      invented: [x.other, x.otherFigure],
      kept: {
        fix: [d.quote.name, d.quote.text.slice(0, -1)],
        page: [d.quote.name, d.quote.text.slice(0, -1)],
      },
    }),
    other_forms: (d, x) => ({
      fix: [
        insert(4, `<p>Fintrail genel müdürü ${x.other} da bunun önemli olduğunu kaydetti.</p>`),
      ],
      page: {
        intro: [
          `Fintrail genel müdürü ${x.person}, bunun önemli olduğunu ifade etti.`,
          `Bu her ekip için işe yarıyor, diyor ${x.other}.`,
          // A figure it was given, as another claim: 28 is a count, "%28" a share.
          `Ekiplerin %${d.getcito.mentioned} kadarı zaman kazanıyor.`,
        ],
      },
      invented: [x.person, x.other, `%${d.getcito.mentioned}`],
    }),
  },
  de: {
    invented_person: (d, x) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}, sagt Geschäftsführer ${x.person}.`,
        ),
      ],
      page: {
        intro: [
          `${x.person}, Finanzchef bei Fintrail, sagte, dass dies für jedes Team funktioniert.`,
        ],
      },
      invented: [x.person],
    }),
    invented_quote: (d, x) => ({
      fix: [
        insert(
          6,
          `<p>„${x.quote}“, sagte eine unserer Kundinnen.</p><blockquote><p>„${x.testimonial}.“</p></blockquote>`,
        ),
      ],
      page: { intro: [`„${x.quote}“, sagt Priya Shah.`] },
      invented: [x.quote, x.testimonial, 'Priya Shah'],
    }),
    invented_number: (d, x) => ({
      fix: [
        replace(
          6,
          d.passages[4],
          `${d.passages[4].slice(0, -1)}: ${x.figure} der Teams, die das tun, sparen Zeit.`,
        ),
      ],
      page: {
        intro: [
          `Teams, die diesen Schritten folgen, sparen ${x.money} im Jahr und erzielen ${x.figure} bessere Ergebnisse.`,
        ],
      },
      invented: [x.figure, x.money],
    }),
    invented_story: (d, x) => ({
      fix: [
        insert(
          4,
          `<p>Im letzten Frühjahr war unsere Kundin ${x.story} lange vor dem Plan fertig.</p>`,
        ),
        insert(6, `<p>Es dauerte ${x.days} Tage statt eines Monats.</p>`),
      ],
      page: {
        intro: [
          `Unsere Kundin ${x.story} erzählte uns, dass sie ${x.days} Tage früher fertig war.`,
        ],
      },
      invented: [x.story, `${x.days} Tage`],
    }),
    given_input: (d) => ({
      fix: [
        replace(
          4,
          d.passages[2],
          `${d.passages[2].slice(0, -1)}: ${d.table.rows[1][0]} Teams haben das in unserer Umfrage gesagt.`,
          ['@data:1'],
        ),
        insert(
          6,
          `<p>„${d.quote.text.slice(0, -1)}“, sagt ${d.quote.name}, ${d.quote.title}.</p>`,
          ['@quote:1'],
        ),
      ],
      page: {
        intro: [
          `${d.brand.name} wurde in ${d.getcito.mentioned} von ${d.getcito.answers} KI-Antworten auf diese Frage genannt (${commaShare(d)} %; GetCito-Daten, Oktober 2026).`,
          `${d.author.name}, ${d.author.title}, erklärt jeden Schritt. „${d.quote.text}“ sagt ${d.quote.name}.`,
        ],
      },
      kept: {
        fix: [d.table.rows[1][0], d.quote.text.slice(0, -1), d.quote.name],
        page: [
          d.quote.text.slice(0, -1),
          d.quote.name,
          d.author.name,
          `${d.getcito.mentioned} von ${d.getcito.answers}`,
          `${commaShare(d)} %`,
        ],
      },
    }),
    mixed: (d, x) => ({
      fix: [
        insert(
          4,
          `<p>${d.quote.name} sagt „${d.quote.text.slice(0, -1)}“, und Geschäftsführer ${x.other} von Fintrail stimmt zu.</p>`,
          ['@quote:1'],
        ),
        insert(6, `<p>${x.otherFigure} der Käufer stimmen zu.</p>`),
      ],
      page: {
        intro: [
          `${d.quote.name} sagt „${d.quote.text.slice(0, -1)}“, und Geschäftsführer ${x.other} von Fintrail ergänzt, dass ${x.otherFigure} der Käufer zustimmen.`,
        ],
      },
      invented: [x.other, x.otherFigure],
      kept: {
        fix: [d.quote.name, d.quote.text.slice(0, -1)],
        page: [d.quote.name, d.quote.text.slice(0, -1)],
      },
    }),
    other_forms: (d, x) => ({
      fix: [insert(4, `<p>‚${x.testimonial}‘, sagt Priya Shah.</p>`)],
      page: {
        intro: [
          `»${x.quote}«, sagt ${x.person}.`,
          `Das funktioniert für jedes Team, sagt ${x.other}.`,
        ],
      },
      invented: [x.quote, x.person, x.other, x.testimonial, 'Priya Shah'],
    }),
  },
};

function replace(passage, before, after, sources = []) {
  return {
    kind: 'replace',
    passage,
    before,
    after,
    reason: 'apply the rule',
    rules: ['dated'],
    sources,
    marks: [],
  };
}

function insert(passage, after, sources = []) {
  return {
    kind: 'insert',
    passage,
    before: '',
    after,
    reason: 'apply the rule',
    rules: ['dated'],
    sources,
    marks: [],
  };
}

/** GetCito data's share as Turkish and German write it: "3,4" for the source's "3.4%". */
function commaShare(d) {
  return String(Math.round((d.getcito.mentioned / d.getcito.answers) * 1000) / 10).replace(
    '.',
    ',',
  );
}

/**
 * The page as the editor saves it: an H1, then headings and paragraphs. The
 * agent numbers its passages as draftPassages reads them: the H1 is 1, the
 * intro 2, the first heading 3 and its paragraph 4, the second heading 5
 * and its paragraph 6.
 */
function pageHtml(d) {
  const [intro, h2a, pa, h2b, pb] = d.passages;
  return `<h1>${d.title}</h1><p>${intro}</p><h2>${h2a}</h2><p>${pa}</p><h2>${h2b}</h2><p>${pb}</p>`;
}

/** The page the agent writes whole, its intro the answer's: the rest is the draft's. */
function writtenPage(d, intro) {
  const [first, h2a, pa, h2b, pb] = d.passages;
  return {
    title: d.title,
    intro,
    sections: [
      { heading: h2a, paragraphs: [pa], bullets: [] },
      { heading: h2b, paragraphs: [pb, first], bullets: [] },
    ],
    faqHeading: 'FAQ',
    faq: [],
  };
}

export const CASES = Object.entries(DRAFTS).flatMap(([siteType, languages]) =>
  Object.entries(languages).flatMap(([language, d]) =>
    Object.entries(ANSWERS[language]).map(([kind, answer]) => {
      const a = answer(d, INVENTED[language]);
      return {
        id: `${siteType}-${language}-${kind}`,
        siteType,
        language,
        brand: d.brand,
        title: d.title,
        html: pageHtml(d),
        authors: [d.author],
        prompts: [{ id: PROMPT_ID, text: d.prompt }],
        fanouts: [{ query: d.fanout, platforms: ['chatgpt'] }],
        inputs: {
          experience: d.experience,
          data: [d.table],
          getcito_data: [{ promptId: PROMPT_ID, ...d.getcito, asOf: '2026-10-03', days: 30 }],
          quotes: [d.quote],
        },
        fix: a.fix,
        page: writtenPage(d, a.page.intro),
        invented: a.invented ?? [],
        kept: a.kept ?? { fix: [], page: [] },
      };
    }),
  ),
);
