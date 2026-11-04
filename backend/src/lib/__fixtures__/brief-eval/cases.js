/**
 * The brief eval's cases (CE-EVAL-001): 30 pages to plan, ten per site type
 * (B2B, B2C, e-commerce), in English, Turkish and German, over the page
 * types each site type has, new pages and live ones. Each is what Rebuild
 * outline is given: the brand, the draft, the prompts and the Sources tab's
 * fan-outs, Search Console queries, cited pages, the live page's headings
 * and the length its rules ask for; a few, with the brief rules (2026),
 * the brand's competitors and the pages it may link to. Made-up brands and
 * pages only: no customer's.
 *
 * `node src/scripts/evalBrief.js` writes each one's brief and the judge's
 * scores beside them (recorded.json).
 */

const BRANDS = {
  b2b: {
    en: {
      name: 'Ledgerly',
      industry: 'Finance software',
      description: 'Cash forecasting for small finance teams.',
    },
    tr: {
      name: 'Faturam',
      industry: 'Muhasebe yazılımı',
      description: 'KOBİ’ler için e-fatura ve tahsilat takibi.',
    },
    de: {
      name: 'Lagerwerk',
      industry: 'Lagerverwaltung',
      description: 'Lagersoftware für kleine Händler und Manufakturen.',
    },
  },
  b2c: {
    en: {
      name: 'Trailhead Tours',
      industry: 'Travel',
      description: 'Small-group hiking trips in Europe.',
    },
    tr: {
      name: 'Kapadokya Rotaları',
      industry: 'Seyahat',
      description: 'Kapadokya’da küçük gruplarla yürüyüş ve balon turları.',
    },
    de: {
      name: 'Bergzeit Reisen',
      industry: 'Reisen',
      description: 'Wanderreisen in den Alpen für kleine Gruppen.',
    },
  },
  ecommerce: {
    en: {
      name: 'Velo Studio',
      industry: 'Bicycles',
      description: 'City and gravel bikes, built to order.',
    },
    tr: {
      name: 'Atölye Seramik',
      industry: 'Ev ve yaşam',
      description: 'El yapımı seramik kupa, tabak ve vazolar.',
    },
    de: {
      name: 'Laufwerk',
      industry: 'Schuhe',
      description: 'Laufschuhe für Straße und Trail.',
    },
  },
};

const LENGTHS = { short: 3500, medium: 6000, long: 9000 };

/** A case as Rebuild outline gets it: the brand with its language and site type. */
function kase(siteType, language, pageType, page) {
  const brand = { ...BRANDS[siteType][language], language, site_type: siteType };
  return {
    id: `${siteType}-${language}-${pageType}`,
    siteType,
    language,
    brand,
    draft: {
      title: page.title,
      page_type: pageType,
      method: page.live ? 'optimize' : 'create',
      source_url: page.live ?? null,
    },
    prompts: page.prompts,
    sources: {
      promptIds: [],
      fanouts: page.fanouts.map(([query, ...platforms]) => ({ query, platforms })),
      pages: (page.cited ?? []).map(([url, kind]) => ({ url, kind })),
      queries: page.queries ?? [],
      headings: page.headings ?? [],
      length: LENGTHS[page.length ?? 'medium'],
    },
    competitors: page.competitors ?? [],
    targets: {
      own: (page.own ?? []).map(([url, title]) => ({ url, title })),
      sources: (page.cited ?? []).map(([url]) => ({ url, title: '' })),
    },
  };
}

export const CASES = [
  // B2B, English.
  kase('b2b', 'en', 'feature_page', {
    title: 'Rolling cash forecasts',
    prompts: ['How do I build a rolling 13-week cash forecast?', 'Best cash forecasting software'],
    fanouts: [
      ['13 week cash flow forecast template', 'chatgpt', 'perplexity-web'],
      ['rolling cash forecast vs static budget', 'copilot-web'],
      ['cash forecasting software small business', 'chatgpt'],
      ['how accurate are cash forecasts', 'perplexity-web'],
    ],
    queries: ['rolling cash forecast', '13 week cash flow model'],
    cited: [
      ['https://www.reddit.com/r/FPandA/comments/abc', 'forum'],
      ['https://www.example-finance-blog.com/13-week-cash-flow', 'blog'],
    ],
  }),
  kase('b2b', 'en', 'comparison', {
    title: 'Ledgerly vs spreadsheets for cash forecasting',
    prompts: ['Is cash forecasting software better than Excel?'],
    fanouts: [
      ['excel cash flow forecast limitations', 'chatgpt'],
      ['cash forecasting tool vs spreadsheet', 'perplexity-web', 'copilot-web'],
      ['when to stop using spreadsheets for finance', 'chatgpt'],
    ],
    queries: ['cash forecasting excel vs software'],
    cited: [['https://www.g2.com/categories/cash-flow-management', 'review']],
    competitors: ['Cashwise', 'Forecastly'],
    own: [
      ['https://ledgerly.example/features/rolling-forecasts', 'Rolling cash forecasts'],
      ['https://ledgerly.example/pricing', 'Ledgerly pricing'],
    ],
  }),
  kase('b2b', 'en', 'guide', {
    title: 'How to reconcile a cash forecast with the bank',
    live: 'https://ledgerly.example/guides/reconcile-forecast',
    headings: ['Why reconcile', 'Step 1: Export the bank feed', 'Step 2: Match payments'],
    prompts: ['How do I compare my cash forecast to actuals?'],
    fanouts: [
      ['forecast vs actual cash variance analysis', 'chatgpt', 'perplexity-web'],
      ['bank reconciliation for cash forecasting', 'copilot-web'],
      ['cash forecast variance threshold', 'chatgpt'],
    ],
    queries: ['cash forecast variance', 'forecast to actual reconciliation'],
    length: 'long',
  }),
  kase('b2b', 'en', 'pricing', {
    title: 'Ledgerly pricing',
    live: 'https://ledgerly.example/pricing',
    headings: ['Plans', 'FAQ'],
    prompts: ['How much does cash forecasting software cost?'],
    fanouts: [
      ['cash forecasting software pricing', 'chatgpt'],
      ['ledgerly pricing per user', 'perplexity-web'],
      ['free cash flow forecasting tool', 'copilot-web'],
    ],
    length: 'short',
  }),
  // B2B, Turkish.
  kase('b2b', 'tr', 'definition', {
    title: 'E-fatura nedir?',
    prompts: ['E-fatura nedir, kimler kullanmak zorunda?', 'E-fatura ile e-arşiv farkı ne?'],
    fanouts: [
      ['e-fatura zorunluluğu kimleri kapsar', 'chatgpt', 'perplexity-web'],
      ['e-fatura e-arşiv farkı', 'chatgpt'],
      ['e-fatura nasıl kesilir', 'copilot-web'],
      ['e-fatura entegratörü nedir', 'perplexity-web'],
    ],
    queries: ['e-fatura nedir', 'e-fatura zorunluluğu'],
    cited: [['https://www.ornek-muhasebe-blogu.com/e-fatura-rehberi', 'blog']],
  }),
  kase('b2b', 'tr', 'integration', {
    title: 'Faturam ve pazaryeri entegrasyonu',
    prompts: ['Pazaryeri siparişlerini otomatik faturalamak mümkün mü?'],
    fanouts: [
      ['pazaryeri e-fatura entegrasyonu', 'chatgpt'],
      ['sipariş geldiğinde otomatik fatura kesme', 'perplexity-web', 'chatgpt'],
      ['e-fatura api entegrasyonu', 'copilot-web'],
    ],
    queries: ['pazaryeri fatura entegrasyonu'],
  }),
  kase('b2b', 'tr', 'docs_faq', {
    title: 'Tahsilat takibi: sık sorulanlar',
    live: 'https://faturam.example/yardim/tahsilat',
    headings: ['Hatırlatma nasıl gönderilir?', 'Kısmi ödeme'],
    prompts: ['Geciken ödemeler için otomatik hatırlatma nasıl kurulur?'],
    fanouts: [
      ['geciken ödeme hatırlatma e-postası', 'chatgpt'],
      ['tahsilat takibi nasıl yapılır', 'perplexity-web'],
      ['kısmi ödeme nasıl kaydedilir', 'copilot-web'],
    ],
    length: 'short',
  }),
  // B2B, German.
  kase('b2b', 'de', 'solution_page', {
    title: 'Lagersoftware für Manufakturen',
    prompts: ['Welche Lagersoftware eignet sich für kleine Manufakturen?'],
    fanouts: [
      ['lagerverwaltung kleine manufaktur', 'chatgpt', 'perplexity-web'],
      ['chargenverfolgung lagersoftware', 'copilot-web'],
      ['lagersoftware mit shopify anbindung', 'chatgpt'],
    ],
    queries: ['lagersoftware manufaktur'],
    cited: [['https://www.beispiel-handel-forum.de/thread/123', 'forum']],
  }),
  kase('b2b', 'de', 'alternatives', {
    title: 'Alternativen zur Lagerverwaltung in Excel',
    prompts: ['Was ist besser als Excel für die Lagerverwaltung?'],
    fanouts: [
      ['excel lagerverwaltung grenzen', 'chatgpt'],
      ['einfache lagersoftware alternative', 'perplexity-web', 'copilot-web'],
      ['kostenlose lagerverwaltung', 'chatgpt'],
    ],
  }),
  kase('b2b', 'de', 'blog_post', {
    title: 'Inventur im Kleinbetrieb: so geht es schneller',
    live: 'https://lagerwerk.example/blog/inventur',
    headings: ['Stichtagsinventur', 'Permanente Inventur'],
    prompts: ['Wie mache ich eine Inventur im kleinen Betrieb?'],
    fanouts: [
      ['stichtagsinventur oder permanente inventur', 'chatgpt', 'perplexity-web'],
      ['inventur mit barcode scanner', 'copilot-web'],
      ['inventur checkliste', 'chatgpt'],
    ],
    queries: ['inventur kleinbetrieb', 'inventur checkliste'],
    length: 'long',
  }),
  // B2C, English.
  kase('b2c', 'en', 'destination_page', {
    title: 'Hiking in the Dolomites',
    prompts: [
      'When is the best time to hike in the Dolomites?',
      'Best Dolomites hikes for beginners',
    ],
    fanouts: [
      ['best time to hike dolomites', 'chatgpt', 'perplexity-web'],
      ['dolomites hut to hut beginners', 'chatgpt'],
      ['where to stay dolomites hiking', 'copilot-web'],
      ['dolomites hiking without a car', 'perplexity-web'],
    ],
    queries: ['dolomites hiking', 'dolomites best time'],
    cited: [['https://www.reddit.com/r/Dolomites/comments/xyz', 'forum']],
  }),
  kase('b2c', 'en', 'itinerary', {
    title: 'Seven days on the Tour du Mont Blanc',
    prompts: ['Can you do the Tour du Mont Blanc in a week?'],
    fanouts: [
      ['tour du mont blanc 7 day itinerary', 'chatgpt'],
      ['tmb stages for beginners', 'perplexity-web', 'copilot-web'],
      ['tmb huts booking', 'chatgpt'],
    ],
    queries: ['tmb itinerary 7 days'],
    length: 'long',
  }),
  kase('b2c', 'en', 'help_faq', {
    title: 'Before your trip: questions we get',
    live: 'https://trailhead.example/help/before-your-trip',
    headings: ['What to pack', 'Cancellations'],
    prompts: ['What fitness level do guided hiking trips need?'],
    fanouts: [
      ['guided hiking trip fitness level', 'chatgpt'],
      ['hiking tour cancellation policy', 'perplexity-web'],
      ['what to pack for hut to hut hiking', 'copilot-web', 'chatgpt'],
    ],
    length: 'short',
  }),
  kase('b2c', 'en', 'best_of', {
    title: 'The best small-group hiking trips in Europe',
    prompts: ['Which small-group hiking tours in Europe are worth it?'],
    fanouts: [
      ['best guided hiking tours europe', 'chatgpt', 'perplexity-web'],
      ['small group hiking holidays', 'copilot-web'],
      ['self guided vs guided hiking tour', 'chatgpt'],
    ],
    queries: ['small group hiking tours europe'],
    cited: [['https://www.example-travel-mag.com/best-hiking-tours', 'blog']],
    competitors: ['Summit Circle', 'Wanderwise'],
    own: [
      ['https://trailhead.example/trips/dolomites', 'Dolomites Hut Trek'],
      ['https://trailhead.example/trips/picos', 'Picos de Europa Traverse'],
    ],
  }),
  // B2C, Turkish.
  kase('b2c', 'tr', 'guide', {
    title: 'Kapadokya’da balon turu nasıl seçilir?',
    prompts: ['Kapadokya balon turu için en iyi zaman ne?', 'Balon turu güvenli mi?'],
    fanouts: [
      ['kapadokya balon turu en iyi ay', 'chatgpt', 'perplexity-web'],
      ['balon turu iptal olursa ne olur', 'chatgpt'],
      ['kapadokya balon turu fiyatları', 'copilot-web'],
    ],
    queries: ['kapadokya balon turu', 'balon turu ne zaman'],
  }),
  kase('b2c', 'tr', 'help_faq', {
    title: 'İptal ve iade: sık sorulanlar',
    live: 'https://kapadokyarotalari.example/iptal-iade',
    headings: ['İptal', 'İade'],
    prompts: ['Tur iptal edilirse ücret iade edilir mi?'],
    fanouts: [
      ['tur iptali ücret iadesi', 'chatgpt'],
      ['hava koşulları nedeniyle iptal edilen tur', 'perplexity-web'],
    ],
    length: 'short',
  }),
  kase('b2c', 'tr', 'blog_post', {
    title: 'Kapadokya’da üç günlük yürüyüş rotası',
    prompts: ['Kapadokya’da hangi vadiler yürünür?'],
    fanouts: [
      ['güvercinlik vadisi yürüyüşü', 'chatgpt'],
      ['kızılçukur vadisi gün batımı', 'perplexity-web', 'copilot-web'],
      ['ıhlara vadisi kaç saat', 'chatgpt'],
    ],
    queries: ['kapadokya yürüyüş rotaları'],
    length: 'long',
  }),
  // B2C, German.
  kase('b2c', 'de', 'destination_page', {
    title: 'Wandern im Allgäu',
    prompts: ['Wo kann man im Allgäu am schönsten wandern?'],
    fanouts: [
      ['allgäu wanderungen leicht', 'chatgpt', 'perplexity-web'],
      ['allgäu hüttenwanderung mehrtägig', 'copilot-web'],
      ['beste reisezeit allgäu wandern', 'chatgpt'],
    ],
    queries: ['wandern allgäu'],
  }),
  kase('b2c', 'de', 'comparison', {
    title: 'Geführte oder selbst geführte Wanderreise?',
    prompts: ['Lohnt sich eine geführte Wanderreise?'],
    fanouts: [
      ['geführte wanderreise vorteile', 'chatgpt'],
      ['individuelle wanderreise mit gepäcktransport', 'perplexity-web', 'copilot-web'],
      ['wanderreise kosten vergleich', 'chatgpt'],
    ],
  }),
  kase('b2c', 'de', 'help_faq', {
    title: 'Häufige Fragen zu unseren Hüttentouren',
    live: 'https://bergzeit.example/faq/huettentouren',
    headings: ['Kondition', 'Gepäck'],
    prompts: ['Wie fit muss man für eine Hüttentour sein?'],
    fanouts: [
      ['hüttentour kondition anfänger', 'chatgpt'],
      ['hüttentour packliste', 'perplexity-web'],
      ['hüttenschlafsack pflicht', 'copilot-web'],
    ],
    length: 'short',
  }),
  // E-commerce, English.
  kase('ecommerce', 'en', 'product_page', {
    title: 'Gravel One',
    live: 'https://velo.example/bikes/gravel-one',
    headings: ['Specs', 'Sizing'],
    prompts: ['What is a good gravel bike for commuting?'],
    fanouts: [
      ['gravel bike for commuting', 'chatgpt', 'perplexity-web'],
      ['gravel bike tire clearance', 'copilot-web'],
      ['steel vs aluminum gravel bike', 'chatgpt'],
    ],
    queries: ['gravel bike commuting'],
  }),
  kase('ecommerce', 'en', 'buying_guide', {
    title: 'How to choose a city bike',
    prompts: ['How do I choose a city bike?', 'Do I need gears on a city bike?'],
    fanouts: [
      ['city bike buying guide', 'chatgpt'],
      ['internal gear hub vs derailleur city bike', 'perplexity-web', 'copilot-web'],
      ['city bike frame size chart', 'chatgpt'],
      ['belt drive city bike pros and cons', 'perplexity-web'],
    ],
    queries: ['how to choose a city bike'],
    cited: [['https://www.reddit.com/r/bikecommuting/comments/def', 'forum']],
    length: 'long',
    competitors: ['Urban Pedal Co'],
    own: [
      ['https://velo.example/bikes/city-eight', 'City Eight'],
      ['https://velo.example/size-guide', 'Bike size guide'],
    ],
  }),
  kase('ecommerce', 'en', 'sizing_guide', {
    title: 'Bike size guide',
    prompts: ['What size bike do I need for my height?'],
    fanouts: [
      ['bike size chart by height', 'chatgpt', 'perplexity-web'],
      ['between two bike sizes', 'copilot-web'],
      ['inseam measurement for bike size', 'chatgpt'],
    ],
    length: 'short',
  }),
  kase('ecommerce', 'en', 'category_page', {
    title: 'Gravel bikes',
    live: 'https://velo.example/bikes/gravel',
    headings: ['All gravel bikes'],
    prompts: ['Best gravel bikes built to order'],
    fanouts: [
      ['custom gravel bike', 'chatgpt'],
      ['gravel bike with fenders and racks', 'perplexity-web'],
      ['gravel bike frame materials', 'copilot-web', 'chatgpt'],
    ],
    queries: ['custom gravel bike'],
  }),
  // E-commerce, Turkish.
  kase('ecommerce', 'tr', 'collection_page', {
    title: 'El yapımı kupalar',
    prompts: ['El yapımı seramik kupa nereden alınır?'],
    fanouts: [
      ['el yapımı seramik kupa', 'chatgpt', 'perplexity-web'],
      ['seramik kupa bulaşık makinesine girer mi', 'chatgpt'],
      ['hediye seramik kupa', 'copilot-web'],
    ],
    queries: ['el yapımı kupa'],
  }),
  kase('ecommerce', 'tr', 'help_faq', {
    title: 'Seramik bakımı: sık sorulanlar',
    live: 'https://atolyeseramik.example/bakim',
    headings: ['Bulaşık makinesi', 'Mikrodalga'],
    prompts: ['El yapımı seramik mikrodalgada kullanılır mı?'],
    fanouts: [
      ['seramik tabak mikrodalga', 'chatgpt'],
      ['el yapımı seramik bakımı', 'perplexity-web'],
      ['sırlı seramik gıdaya uygun mu', 'copilot-web'],
    ],
    length: 'short',
  }),
  kase('ecommerce', 'tr', 'best_of', {
    title: 'Sofra için en iyi seramik tabak setleri',
    prompts: ['Günlük kullanım için hangi seramik tabak seti alınmalı?'],
    fanouts: [
      ['seramik tabak seti önerisi', 'chatgpt', 'perplexity-web'],
      ['porselen mi seramik mi', 'chatgpt'],
      ['kırılmaya dayanıklı tabak', 'copilot-web'],
    ],
    queries: ['seramik tabak seti'],
  }),
  // E-commerce, German.
  kase('ecommerce', 'de', 'product_page', {
    title: 'Trail Pro 2',
    live: 'https://laufwerk.example/schuhe/trail-pro-2',
    headings: ['Technische Daten', 'Passform'],
    prompts: ['Welcher Trailschuh ist gut für matschige Wege?'],
    fanouts: [
      ['trailschuh matsch grip', 'chatgpt', 'perplexity-web'],
      ['trailschuh sprengung', 'copilot-web'],
      ['trailschuh wasserdicht oder nicht', 'chatgpt'],
    ],
  }),
  kase('ecommerce', 'de', 'buying_guide', {
    title: 'Den richtigen Laufschuh finden',
    prompts: ['Wie finde ich den richtigen Laufschuh?'],
    fanouts: [
      ['laufschuh kaufberatung', 'chatgpt'],
      ['pronation laufschuh', 'perplexity-web', 'copilot-web'],
      ['laufschuh größe zu klein', 'chatgpt'],
      ['wie oft laufschuhe wechseln', 'perplexity-web'],
    ],
    queries: ['laufschuh kaufberatung'],
    length: 'long',
  }),
  kase('ecommerce', 'de', 'policy', {
    title: 'Versand und Rückgabe',
    live: 'https://laufwerk.example/versand-rueckgabe',
    headings: ['Versand', 'Rückgabe'],
    prompts: ['Kann ich gelaufene Schuhe zurückgeben?'],
    fanouts: [
      ['laufschuhe zurückgeben getragen', 'chatgpt'],
      ['rückgabe laufschuhe frist', 'perplexity-web'],
    ],
    length: 'short',
  }),
];
