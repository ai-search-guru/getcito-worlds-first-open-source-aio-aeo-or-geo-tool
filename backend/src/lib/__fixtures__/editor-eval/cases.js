/**
 * The Content Editor's quality test set (editorEval.test.js): three fixed
 * drafts, as the no-fabrication set shapes one (cases.js there), so its
 * guards read them the same way. Brewline Coffee, the demo brand's world,
 * in English and Turkish; and VitaRoot, a supplement brand, whose page must
 * never claim a health benefit nobody gave. Each draft carries a
 * [placeholder] the person fills, and what the person gave (Your input).
 * Made up, on `.example` domains. Tests only.
 */

const PROMPT_ID = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a30';

const DRAFTS = [
  {
    id: 'brewline-en',
    siteType: 'ecommerce',
    language: 'en',
    health: false,
    brand: {
      name: 'Brewline Coffee',
      industry: 'Food & Beverage',
      description:
        'Specialty coffee roaster selling freshly roasted whole beans by the bag and by subscription, shipped within a day of roasting.',
    },
    title: 'How to choose a coffee subscription',
    passages: [
      'A coffee subscription brings fresh beans to your door on a schedule you set.',
      'What does a subscription cost?',
      'Plans start at $16 per 12 oz bag, and shipping is free on subscriptions. Support is open [support hours].',
      'Can I pause or skip a delivery?',
      'Yes. You can pause, skip or cancel anytime online, with no fees.',
    ],
    author: { name: 'Maya Chen', title: 'Head Roaster, Brewline Coffee' },
    experience: 'We roast every bag to order and ship it within 1 day of roasting.',
    table: {
      name: 'Subscriptions',
      rows: [
        ['Plan', 'Bags a month'],
        ['Weekly', '4'],
        ['Monthly', '1'],
      ],
    },
    getcito: { prompt: 'best coffee subscription', answers: 412, mentioned: 31 },
    quote: {
      name: 'Maya Chen',
      title: 'Head Roaster, Brewline Coffee',
      text: 'We print the roast date on every bag.',
      sourceUrl: 'https://brewline.example/about',
    },
    prompt: 'What are the best coffee subscriptions in 2026?',
    fanout: 'coffee subscription cancel anytime',
  },
  {
    id: 'brewline-tr',
    siteType: 'ecommerce',
    language: 'tr',
    health: false,
    brand: {
      name: 'Brewline Coffee',
      industry: 'Yiyecek ve içecek',
      description:
        'Taze kavrulmuş çekirdek kahveyi paketle ve abonelikle satan, kavrulduktan sonraki bir gün içinde gönderen özel kahve kavurucusu.',
    },
    title: 'Kahve aboneliği nasıl seçilir?',
    passages: [
      'Kahve aboneliği, taze çekirdekleri belirlediğiniz takvimle kapınıza getirir.',
      'Abonelik ne kadar?',
      'Planlar 340 gramlık paket başına 16 dolardan başlar ve aboneliklerde kargo ücretsizdir. Destek [destek saatleri] arasında açıktır.',
      'Teslimatı durdurabilir miyim?',
      'Evet. Aboneliğinizi istediğiniz zaman çevrimiçi olarak durdurabilir, atlayabilir ya da ücretsiz iptal edebilirsiniz.',
    ],
    author: { name: 'Maya Chen', title: 'Baş kavurucu, Brewline Coffee' },
    experience:
      'Her paketi siparişe göre kavuruyor ve kavrulduktan sonra 1 gün içinde gönderiyoruz.',
    table: {
      name: 'Abonelikler',
      rows: [
        ['Plan', 'Aylık paket'],
        ['Haftalık', '4'],
        ['Aylık', '1'],
      ],
    },
    getcito: { prompt: 'en iyi kahve aboneliği', answers: 205, mentioned: 18 },
    quote: {
      name: 'Maya Chen',
      title: 'Baş kavurucu, Brewline Coffee',
      text: 'Her paketin üzerine kavrulma tarihini basıyoruz.',
      sourceUrl: 'https://brewline.example/about',
    },
    prompt: 'En iyi kahve abonelikleri hangileri?',
    fanout: 'kahve aboneliği iptal',
  },
  {
    id: 'vitaroot-en',
    siteType: 'ecommerce',
    language: 'en',
    health: true,
    brand: {
      name: 'VitaRoot',
      industry: 'Dietary supplements',
      description:
        'Makes magnesium and vitamin D supplements in capsules tested by an independent lab.',
    },
    title: 'Magnesium glycinate: what to know before you buy',
    passages: [
      'VitaRoot Magnesium Glycinate comes in bottles of 60 capsules.',
      'Who is it for?',
      'Adults who want a magnesium supplement. Talk to your doctor before you start any supplement, especially if you are pregnant or take medication.',
      'How should I take it?',
      'Follow the label: [serving size] with water. This product is not intended to diagnose, treat, cure or prevent any disease.',
    ],
    author: { name: 'Lena Ortiz', title: 'Pharmacist, VitaRoot' },
    experience: 'Every batch is tested by an independent lab before it ships.',
    table: {
      name: 'Bottle',
      rows: [
        ['Capsules per bottle', 'Price'],
        ['60', '$24'],
      ],
    },
    getcito: { prompt: 'best magnesium supplement for sleep', answers: 380, mentioned: 12 },
    quote: {
      name: 'Lena Ortiz',
      title: 'Pharmacist, VitaRoot',
      text: 'Read the label and ask your doctor before you combine supplements.',
      sourceUrl: 'https://vitaroot.example/team',
    },
    // What buyers ask: a question about sleep, never a claim the brand makes.
    prompt: 'What is the best magnesium supplement for sleep?',
    fanout: 'does magnesium glycinate help you sleep',
  },
];

/** The page as the editor saves it: an H1, then headings and paragraphs (as cases.js there). */
function pageHtml(d) {
  const [intro, h2a, pa, h2b, pb] = d.passages;
  return `<h1>${d.title}</h1><p>${intro}</p><h2>${h2a}</h2><p>${pa}</p><h2>${h2b}</h2><p>${pb}</p>`;
}

/** Each draft as the no-fabrication guards read one. */
export const EDITOR_CASES = DRAFTS.map((d) => ({
  id: d.id,
  siteType: d.siteType,
  language: d.language,
  health: d.health,
  brand: d.brand,
  title: d.title,
  html: pageHtml(d),
  authors: [d.author],
  prompts: [{ id: PROMPT_ID, text: d.prompt }],
  fanouts: [{ query: d.fanout, platforms: ['chatgpt'] }],
  inputs: {
    experience: d.experience,
    data: [d.table],
    getcito_data: [{ promptId: PROMPT_ID, ...d.getcito, asOf: '2026-10-30', days: 30 }],
    quotes: [d.quote],
  },
  // The claims the brand itself makes: a page may repeat them, never add one.
  given: [d.title, ...d.passages, d.brand.description, d.experience, d.quote.text].join('\n'),
}));
