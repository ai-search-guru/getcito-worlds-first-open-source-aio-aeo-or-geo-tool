import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Health claims (owner's safety rule, 2026-11-03): the Content Agent never
 * writes a health benefit, a treatment, a prevention or a dose the brand
 * didn't give, nor asks to have one looked up; on a health brand's page the
 * guards make sure, and keep its own claims and its safety lines. VitaRoot
 * is the quality test's supplement brand (editorEval.test.js), where the
 * agent wrote "may help some people sleep" in one run of two.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));

const {
  HEALTH_RULE,
  addedHealthClaims,
  healthClaimsIn,
  healthFindsIn,
  healthGuard,
  healthHtml,
  healthPage,
  isHealthBrand,
  withoutHealthFinds,
} = await import('./contentHealth.js');
const { SYSTEM_PROMPT, draftPassages, keepSuggestions } = await import('./contentAgent.js');
const { REWRITE_SYSTEM_PROMPT } = await import('./contentRewrite.js');
const {
  WRITE_SYSTEM_PROMPT,
  editPage,
  renderPage,
  rewriteSystemPrompt,
  suggestSystemPrompt,
  writeSystemPrompt,
} = await import('./contentWriter.js');

const VITAROOT = {
  name: 'VitaRoot',
  industry: 'Dietary supplements',
  description:
    'Makes magnesium and vitamin D supplements in capsules tested by an independent lab.',
};
const DISCLAIMER = 'This product is not intended to diagnose, treat, cure or prevent any disease.';
const DOCTOR =
  'Talk to your doctor before you start any supplement, especially if you are pregnant or take medication.';
/** The quality test's VitaRoot draft (editor-eval cases.js). */
const PAGE =
  '<h1>Magnesium glycinate: what to know before you buy</h1>' +
  '<p>VitaRoot Magnesium Glycinate comes in bottles of 60 capsules.</p>' +
  `<h2>Who is it for?</h2><p>Adults who want a magnesium supplement. ${DOCTOR}</p>` +
  `<h2>How should I take it?</h2><p>Follow the label: [serving size] with water. ${DISCLAIMER}</p>`;
const guard = (html = PAGE, texts = [VITAROOT.name, VITAROOT.description]) =>
  healthGuard(VITAROOT, { html, texts });

afterEach(() => vi.unstubAllEnvs());

describe('the health rule in the prompts', () => {
  it('is in every Content Agent prompt: write, suggest, rewrite and Fix open rules', () => {
    for (const prompt of [
      WRITE_SYSTEM_PROMPT,
      writeSystemPrompt(),
      suggestSystemPrompt(),
      rewriteSystemPrompt(),
      REWRITE_SYSTEM_PROMPT,
      SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain(HEALTH_RULE);
    }
    // With the brief rules (2026) on too.
    vi.stubEnv('CONTENT_BRIEF_RULES', 'true');
    for (const prompt of [writeSystemPrompt(), suggestSystemPrompt(), rewriteSystemPrompt()]) {
      expect(prompt).toContain(HEALTH_RULE);
    }
  });

  it('asks for no claim the brand didn’t give, no {{find: …}} for one, and keeps the safety lines', () => {
    expect(HEALTH_RULE).toContain(
      "never write a health benefit, a treatment, a prevention or a dose that the brand, the page or Your input doesn't give",
    );
    expect(HEALTH_RULE).toContain('never write {{find: …}} for one');
    expect(HEALTH_RULE).toContain('"talk to your doctor"');
    expect(HEALTH_RULE).toContain('"not intended to diagnose, treat, cure or prevent any disease"');
  });
});

describe('isHealthBrand', () => {
  it('reads the industry, then the industry, name or description’s words', () => {
    expect(isHealthBrand({ industry: 'Healthcare' })).toBe(true);
    expect(isHealthBrand(VITAROOT)).toBe(true);
    expect(
      isHealthBrand({
        name: 'VitaRoot',
        industry: 'Consumer Goods',
        description: 'Makes magnesium and vitamin D supplements.',
      }),
    ).toBe(true);
    expect(
      isHealthBrand({ industry: 'Other', description: 'Bitkisel takviye ve vitamin markası' }),
    ).toBe(true);
  });

  it('leaves out a brand that isn’t one: a site’s health, hospitality, coffee', () => {
    expect(
      isHealthBrand({
        industry: 'B2B Software (SaaS)',
        description: 'Monitor your site health and your brand health in AI answers.',
      }),
    ).toBe(false);
    expect(
      isHealthBrand({
        industry: 'B2B Software (SaaS)',
        description: 'Pipeline health and forecasting for revenue teams, with team health surveys.',
      }),
    ).toBe(false);
    expect(
      isHealthBrand({ industry: 'Travel & Hospitality', description: 'Boutique hotels' }),
    ).toBe(false);
    expect(isHealthBrand({ industry: 'Food & Beverage', description: 'Coffee roaster' })).toBe(
      false,
    );
    expect(isHealthBrand(null)).toBe(false);
    // A brand that isn't one has no guard: its page's "helps you focus" is no claim to drop.
    expect(healthGuard({ industry: 'Technology', description: 'A CRM' }, { html: PAGE })).toBe(
      null,
    );
  });
});

describe('healthClaimsIn', () => {
  it('reads the benefit the agent added to VitaRoot’s page, and a treatment, a prevention, a dose', () => {
    expect(
      healthClaimsIn(
        'Magnesium glycinate may help some people sleep. It may help some people relax.',
      ),
    ).toEqual(['help some people sleep', 'help some people relax']);
    expect(healthClaimsIn('It supports restful sleep, cures insomnia and prevents colds.')).toEqual(
      ['supports restful sleep', 'cures insomnia', 'prevents colds'],
    );
    expect(healthClaimsIn('Take 2 capsules daily with water.')).toEqual(['Take 2 capsules']);
    expect(healthClaimsIn('May help you relax after a long day.')).toEqual(['help you relax']);
    // A list item that starts with a modal and an adverb is no buyer's question.
    expect(healthClaimsIn('May also help reduce stress.')).toEqual(['help reduce stress']);
    expect(healthClaimsIn('Can naturally support restful sleep.')).toEqual([
      'support restful sleep',
    ]);
    expect(healthClaimsIn('Is clinically proven to reduce anxiety.')).toEqual([
      'clinically proven',
      'reduce anxiety',
    ]);
    expect(healthClaimsIn('Is specially formulated to support restful sleep.')).toEqual([
      'support restful sleep',
    ]);
  });

  it('reads no claim in a question a buyer asks, nor in a disclaimer or a safety line', () => {
    expect(healthClaimsIn('Does magnesium glycinate help you sleep')).toEqual([]);
    expect(healthClaimsIn('Can elderly people take magnesium to improve sleep')).toEqual([]);
    expect(healthClaimsIn('Can stressed adults use it to reduce anxiety')).toEqual([]);
    expect(healthClaimsIn('Can magnesium help you relax?')).toEqual([]);
    expect(healthClaimsIn('Talk to your doctor. It does not help you sleep.')).toEqual([]);
    expect(healthClaimsIn(DISCLAIMER)).toEqual([]);
    expect(healthClaimsIn(DOCTOR)).toEqual([]);
    // "…, but it helps" is a claim again.
    expect(healthClaimsIn('It is not a cure, but it helps you relax.')).toEqual([
      'helps you relax',
    ]);
    // A negation in a clause before the claim's doesn't make it a disclaimer.
    expect(healthClaimsIn('If you can’t sleep, magnesium glycinate helps you relax.')).toEqual([
      'helps you relax',
    ]);
    expect(
      healthClaimsIn('When you don’t get enough rest, our formula supports deeper sleep.'),
    ).toEqual(['supports deeper sleep']);
    expect(healthClaimsIn('It does not cure, treat or prevent insomnia.')).toEqual([]);
    expect(
      healthClaimsIn(
        'This product is not intended to diagnose, treat, cure, or prevent any disease.',
      ),
    ).toEqual([]);
    expect(healthClaimsIn('It does not cure, treat, and prevent insomnia.')).toEqual([]);
  });

  it('reads Turkish: a claim, a question and a disclaimer', () => {
    expect(healthClaimsIn('Magnezyum uykuya yardımcı olur ve stresi azaltır.')).toEqual([
      'uykuya yardımcı olur',
      'stresi azaltır',
    ]);
    expect(healthClaimsIn('Kas kramplarını azaltır. Günde 2 kapsül alın.')).toEqual([
      'Kas kramplarını azaltır',
      'Günde 2 kapsül',
    ]);
    expect(healthClaimsIn('Magnezyum uykuya yardımcı olur mu')).toEqual([]);
    expect(healthClaimsIn('Uykuya yardımcı olmaz.')).toEqual([]);
    expect(
      healthClaimsIn(
        'Takviye edici gıdalar ilaç değildir, hastalıkların önlenmesi veya tedavi edilmesi amacıyla kullanılmaz.',
      ),
    ).toEqual([]);
    expect(healthClaimsIn('Kullanmadan önce doktorunuza danışın.')).toEqual([]);
    // "ödeme" is a payment, not "ödem".
    expect(healthClaimsIn('Uyumlu ödeme seçeneklerini destekler.')).toEqual([]);
  });

  it('reads no claim in what any page says: a lab test, a price, a team that helps', () => {
    expect(healthClaimsIn('Every batch is tested by an independent lab before it ships.')).toEqual(
      [],
    );
    expect(healthClaimsIn('Each bottle has 60 capsules for $24.')).toEqual([]);
    expect(healthClaimsIn('It helps teams reduce churn and focus on what matters.')).toEqual([]);
    expect(healthClaimsIn('Lower back pain affects many adults.')).toEqual([]);
  });
});

describe('addedHealthClaims', () => {
  it('lets the brand’s own claim through, in other words too, never one it didn’t make', () => {
    const own = guard(
      '<p>VitaRoot helps you sleep.</p><p>It does not cure insomnia.</p><h2>Does it reduce stress?</h2>',
      ['Take 2 capsules daily.'],
    );
    expect(addedHealthClaims('It may help some people sleep.', own)).toEqual([]);
    expect(addedHealthClaims('Take 2 capsules daily.', own)).toEqual([]);
    // Said only in a disclaimer or a question: not the brand's claim.
    expect(addedHealthClaims('It cures insomnia.', own)).toEqual(['cures insomnia']);
    expect(addedHealthClaims('It reduces stress.', own)).toEqual(['reduces stress']);
    // A figure it didn't give.
    expect(addedHealthClaims('Take 2 to 4 capsules daily.', own)).toEqual(['Take 2 to 4 capsules']);
    expect(addedHealthClaims('Take 4 capsules daily.', own)).toEqual(['Take 4 capsules']);
  });

  it('reads Your input as the brand’s, never GetCito data’s prompt', () => {
    const own = healthGuard(VITAROOT, {
      numbered: [
        {
          id: 'S1',
          kind: 'input',
          ref: 'experience',
          label: 'Our customers',
          detail: 'Their experience, first-hand: Our customers say it helps them relax.',
        },
        {
          id: 'S2',
          kind: 'input',
          ref: 'getcito:p1',
          label: 'magnesium that supports deep sleep',
          detail: 'GetCito data: …',
        },
      ],
    });
    expect(addedHealthClaims('It helps you relax.', own)).toEqual([]);
    expect(addedHealthClaims('It supports deep sleep.', own)).toEqual(['supports deep sleep']);
  });
});

describe('healthFindsIn and withoutHealthFinds', () => {
  it('finds the {{find: …}} that asks for a health effect or a dose, never a price', () => {
    expect(
      healthFindsIn(
        'Research says {{find: what clinical research says about magnesium glycinate and sleep}}. A bottle costs {{find: VitaRoot bottle price}}. {{find: recommended daily magnesium intake}}. {{find: magnezyumun uykuya etkisi}}',
      ),
    ).toEqual([
      '{{find: what clinical research says about magnesium glycinate and sleep}}',
      '{{find: recommended daily magnesium intake}}',
      '{{find: magnezyumun uykuya etkisi}}',
    ]);
  });

  it('drops a suggestion that asks for one before the facts pass, only on a health brand', () => {
    const asks = {
      kind: 'insert',
      passage: 2,
      after: '<p>Studies show {{find: what clinical research says about magnesium and sleep}}.</p>',
    };
    const price = { kind: 'insert', passage: 2, after: '<p>It costs {{find: bottle price}}.</p>' };
    expect(withoutHealthFinds([asks, price], guard())).toEqual([price]);
    expect(withoutHealthFinds([asks, price], null)).toEqual([asks, price]);
  });
});

describe('keepSuggestions on a health brand’s page', () => {
  const passages = draftPassages(PAGE);
  const rules = new Set(['faq', 'h2Answer']);
  const keep = (suggestions, health = guard()) =>
    keepSuggestions(suggestions, passages, new Set(), rules, null, { health });
  const insert = (after, passage = 3) => ({
    kind: 'insert',
    passage,
    before: '',
    after,
    reason: 'answer the fan-out',
    rules: ['faq'],
    sources: [],
    marks: [],
  });

  it('drops a suggestion that adds a health claim the brand didn’t make', () => {
    const claim = insert(
      '<h3>Does magnesium glycinate help you sleep?</h3><p>Magnesium glycinate may help some people sleep.</p>',
    );
    const replace = {
      kind: 'replace',
      passage: 2,
      before: 'comes in bottles of 60 capsules',
      after: 'comes in bottles of 60 capsules and supports restful sleep',
      reason: 'add a benefit',
      rules: ['h2Answer'],
      sources: [],
      marks: [],
    };
    expect(keep([claim, replace])).toEqual([]);
    // A brand that isn't a health one has no guard: the same change is kept.
    expect(keep([claim], null)).toHaveLength(1);
  });

  it('keeps the brand’s own claim, a safety line and a question a buyer asks', () => {
    const own = guard(
      `${PAGE}<p>VitaRoot Magnesium Glycinate helps you relax after a long day.</p>`,
    );
    const kept = keepSuggestions(
      [
        insert(
          `<h3>Does magnesium glycinate help you sleep?</h3><p>Ask your pharmacist. ${DOCTOR}</p>`,
        ),
        insert(`<p>${DISCLAIMER}</p>`, 5),
        insert('<p>VitaRoot Magnesium Glycinate may help you relax after a long day.</p>', 2),
      ],
      passages,
      new Set(),
      rules,
      null,
      { health: own },
    );
    expect(kept.map((row) => row.after_text)).toEqual([
      `<h3>Does magnesium glycinate help you sleep?</h3><p>Ask your pharmacist. ${DOCTOR}</p>`,
      `<p>${DISCLAIMER}</p>`,
      '<p>VitaRoot Magnesium Glycinate may help you relax after a long day.</p>',
    ]);
  });

  it('reads a replace in its passage: a word changed in a question claims nothing', () => {
    const question = [{ tag: 'h2', text: 'Does magnesium help you sleep?' }];
    const kept = keepSuggestions(
      [
        {
          kind: 'replace',
          passage: 1,
          before: 'magnesium',
          after: 'magnesium glycinate',
          reason: 'use the fan-out’s words',
          rules: ['faq'],
          sources: [],
          marks: [],
        },
      ],
      question,
      new Set(),
      rules,
      null,
      { health: guard() },
    );
    expect(kept).toHaveLength(1);
  });

  it('drops a Turkish claim, and keeps the Turkish disclaimer', () => {
    const tr = draftPassages(
      '<h1>Magnezyum glisinat</h1><p>VitaRoot magnezyum glisinat 60 kapsüllük şişelerde gelir.</p>',
    );
    const own = healthGuard(
      { name: 'VitaRoot', industry: 'Healthcare', description: 'Magnezyum takviyesi' },
      { html: '<p>VitaRoot magnezyum glisinat 60 kapsüllük şişelerde gelir.</p>' },
    );
    const kept = keepSuggestions(
      [
        insert('<p>Magnezyum glisinat uykuya yardımcı olur ve stresi azaltır.</p>', 2),
        insert(
          '<p>Takviye edici gıdalar ilaç değildir, hastalıkların önlenmesi veya tedavi edilmesi amacıyla kullanılmaz.</p>',
          2,
        ),
      ],
      tr,
      new Set(),
      rules,
      null,
      { health: own },
    );
    expect(kept.map((row) => row.after_text)).toEqual([
      '<p>Takviye edici gıdalar ilaç değildir, hastalıkların önlenmesi veya tedavi edilmesi amacıyla kullanılmaz.</p>',
    ]);
  });
});

describe('a page written or rewritten whole', () => {
  const written = {
    title: 'Magnesium glycinate for better sleep',
    intro: [
      'VitaRoot Magnesium Glycinate comes in bottles of 60 capsules. Magnesium glycinate may help some people sleep.',
    ],
    sections: [
      {
        heading: 'Does magnesium glycinate help you sleep?',
        paragraphs: [
          'Research says {{find: what clinical research says about magnesium glycinate and sleep}}.',
        ],
        bullets: [],
      },
      { heading: 'Who is it for?', paragraphs: [`Adults. ${DOCTOR}`], bullets: [] },
    ],
    faqHeading: 'FAQ',
    faq: [
      { question: 'Does it reduce stress?', answer: 'It reduces stress and anxiety.' },
      { question: 'Is it a medicine?', answer: DISCLAIMER },
    ],
  };

  it('loses each sentence with a claim or a {{find: …}} for one, keeps the rest and the safety lines', () => {
    const stats = { health: 0 };
    const page = healthPage(written, guard(), editPage, stats);
    // The title is the claim: it goes (the run falls back to the draft's).
    expect(page.title).toBe('');
    expect(page.intro).toEqual(['VitaRoot Magnesium Glycinate comes in bottles of 60 capsules.']);
    // A section left with no words goes, its question with it.
    expect(page.sections.map((s) => s.heading)).toEqual(['Who is it for?']);
    expect(page.sections[0].paragraphs).toEqual([`Adults. ${DOCTOR}`]);
    expect(stats.health).toBe(4);
    const html = renderPage({ ...page, title: 'Magnesium glycinate' });
    expect(html).not.toMatch(/help some people|find:|reduces stress/);
    expect(html).toContain(`<h3>Is it a medicine?</h3><p>${DISCLAIMER}</p>`);
    expect(html).not.toContain('Does it reduce stress?');
    // Nothing to take out: the page as it was, and none on another brand's.
    expect(healthPage(written, null, editPage)).toBe(written);
  });

  it('takes them out of a rewrite’s HTML, with a question left with no answer', () => {
    const html =
      '<h1>Magnesium glycinate</h1><p>VitaRoot comes in bottles of 60 capsules. Magnesium glycinate may help some people sleep.</p>' +
      '<h2>Does it help you sleep?</h2><p>Research says {{find: what clinical research says about magnesium glycinate and sleep}}.</p>' +
      `<h2>Is it a medicine?</h2><p>${DISCLAIMER}</p><p>[[KEEP 1]]</p>`;
    expect(healthHtml(html, guard())).toBe(
      '<h1>Magnesium glycinate</h1><p>VitaRoot comes in bottles of 60 capsules.</p>' +
        `<h2>Is it a medicine?</h2><p>${DISCLAIMER}</p><p>[[KEEP 1]]</p>`,
    );
    expect(healthHtml(html, null)).toBe(html);
    // A heading that is the claim goes, so the page's own H1 comes back (cleanPageHtml).
    expect(healthHtml('<h1>Magnesium for better sleep</h1><p>Our capsules.</p>', guard())).toBe(
      '<p>Our capsules.</p>',
    );
  });
});
