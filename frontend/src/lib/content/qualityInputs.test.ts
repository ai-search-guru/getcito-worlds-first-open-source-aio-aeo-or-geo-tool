import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentAuthor } from './authors';
import { factMismatches, type BrandFact } from './brandFacts';
import { checkDateOnPage } from './checkDate';
import { inputsUsed } from './draftInputs';
import { feedCheck } from './feedMatch';
import { confirmedFacts, introFacts } from './introFacts';
import { aiChecksOnPage, pageImages, proofsOnPage, type PageRead } from './pageRead';
import { firstImage, openingParagraph, pageOffer } from './pageSchema';
import { qualityPhase } from './quality';
import { eeat, shippingOnPage, squeeze, trust, trustBlocks } from './qualityChecks';
import { qualityState, type QualityReads } from './qualityInputs';
import {
  PROFILE_WEIGHTS,
  profileFor,
  waitsForSiteTrust,
  weighed,
  weighedTrust,
} from './qualityProfiles';
import { caseConfirmed } from './qualityTodos';
import { disclosureText } from './readyToPublish';
import { readability, sentencesOf, withTypeRules } from './readability';

/**
 * The Content Editor's scores moved into one shared function, for the
 * server's go-live gate too (AUTONOMOUS-GO-LIVE PR 2a). `legacy` below is
 * the editor's code as it was before the move (its useMemo bodies, in their
 * order, with the editor's names), so the move is shown to change nothing:
 * for each sample page, in each phase, both give the same scores and the
 * same values the editor shows.
 */

/** The editor's composition before PR 2a, its memos as plain consts. */
function legacy(r: QualityReads) {
  const pageHtml = r.html;
  const pageBlocks = r.blocks;
  const { language, brandName, pageType, brandFacts, pageRead } = r;
  const competitorDomains = r.competitorDomains ?? undefined;
  const brandDomains = r.brandDomains ?? undefined;
  const qualityOn = qualityPhase() >= 1;
  const sourcesOn = qualityPhase() >= 2;
  const inputs = r.inputs;
  const pageChanging = pageRead.changing;

  const used = inputs ? inputsUsed(pageBlocks.map((b) => b.text).join('\n'), inputs) : null;
  const factCheck = brandFacts
    ? factMismatches({
        sentences: pageBlocks.flatMap((b) => sentencesOf(b.text)),
        facts: brandFacts,
        brandName,
        competitorDomains: competitorDomains ?? [],
      })
    : null;
  const proofAsks = pageRead.read ? proofsOnPage(pageBlocks, pageRead.read.proofs) : [];
  const aiChecks = (() => {
    const checks =
      sourcesOn &&
      pageRead.read?.checks &&
      pageRead.read.checks.pageType === (pageType ?? null) &&
      !pageRead.paused &&
      !pageRead.limited
        ? aiChecksOnPage(pageBlocks, pageRead.read.checks, pageType, pageChanging)
        : null;
    const line = checks?.disclosure?.found === false ? disclosureText(language, brandName) : null;
    return line && squeeze(pageBlocks.map((b) => b.text).join('')).includes(squeeze(line))
      ? { ...checks!, disclosure: { found: true, show: line, added: true } }
      : checks;
  })();
  const profile = profileFor(pageType);
  const weights = PROFILE_WEIGHTS[profile];
  const checkDateRead =
    qualityOn && profile === 'comparison' ? checkDateOnPage(pageBlocks.map((b) => b.text)) : null;
  const shippingRead =
    qualityOn && profile === 'product' ? shippingOnPage(pageHtml, language) : null;
  const typeRules = r.typeRules;
  const readable = qualityOn
    ? weighed(
        withTypeRules(readability(pageHtml, language, aiChecks?.answerFirst ?? null), typeRules),
        weights.readability,
      )
    : null;
  const casesOn = sourcesOn && qualityPhase() >= 3;
  const { caseConfirms, introConfirms, casesRead } = r;
  const introOn = casesOn && profile === 'category';
  const intro = introOn ? introFacts(pageHtml, language) : [];
  const introConfirmed = confirmedFacts(introConfirms ?? []);
  const introAll = [...new Set(intro.flatMap((fact) => fact.facts))];
  const introRead = introOn && casesRead ? { facts: intro, confirmed: introConfirmed } : null;
  const caseCount = (() => {
    if (!casesOn) return null;
    const asks = proofAsks.filter((ask) => ask.kind === 'customer_case');
    const confirms = caseConfirms ?? new Set<string>();
    return {
      total: asks.length,
      confirmed: asks.filter((ask) => caseConfirmed(confirms, ask)).length,
    };
  })();
  const ownImages = r.ownImages;
  const images = sourcesOn ? pageImages(pageHtml) : [];
  const openSpots = r.openSpots;
  const visualImages = images.length;
  const visualOwn = ownImages ? images.filter((image) => ownImages.has(image.src)).length : 0;
  const visualRead = sourcesOn && pageRead.settled && ownImages !== null;
  const visual = visualRead ? { images: visualImages, own: visualOwn, openSpots } : null;
  const siteTrustRead = r.siteTrustRead;
  const siteTrust = r.siteTrust;
  const brandInfoRead = !waitsForSiteTrust(profile) || siteTrustRead;
  const authorsRead = r.authorsRead;
  const inputsPending = r.inputsPending;
  const eeatScore =
    qualityOn &&
    authorsRead &&
    !inputsPending &&
    (!sourcesOn || visualRead) &&
    brandInfoRead &&
    (!casesOn || casesRead)
      ? weighed(
          eeat({
            author: r.author,
            used,
            visual,
            how: aiChecks?.how ?? null,
            confirmed: r.authorConfirmed,
            siteTrust,
            checkDate: checkDateRead === null ? null : checkDateRead.found,
            cases: caseCount,
          }),
          weights.eeat,
        )
      : null;
  const productSchema = (() => {
    if (profile !== 'product') return null;
    const own = images
      .filter((image) => ownImages?.has(image.src) && /^https:\/\//i.test(image.src))
      .map((image) => image.src);
    const first = firstImage(pageHtml);
    return {
      description: openingParagraph(pageHtml),
      images: own.length ? own : first ? [first] : [],
      offer: pageOffer(pageBlocks.map((block) => block.text)),
    };
  })();
  const feedOn = profileFor(pageType) === 'product';
  const catalog = r.catalog;
  const feedRead =
    feedOn && catalog?.product && productSchema
      ? feedCheck({
          texts: pageBlocks.map((block) => block.text),
          offer: productSchema.offer,
          variants: catalog.product.variants,
        })
      : null;
  const sourceRead = sourcesOn
    ? {
        competitorDomains: competitorDomains ?? [],
        pageType,
        kept: new Set(r.keptSources),
        ai: r.aiKinds,
        trustedDomains: r.trustedDomains ?? [],
      }
    : null;
  const shipping = shippingRead;
  const trustScore =
    qualityOn && brandDomains && !inputsPending
      ? weighedTrust(
          trust({
            blocks: pageBlocks,
            links: r.linkChecks,
            brandDomains,
            siteTrust,
            quote: used ? used.quote : null,
            sources: sourceRead,
            claims: r.claimBlocks,
            brandFacts: factCheck,
            proofs: proofAsks,
            page: aiChecks,
            shipping,
            feed: feedRead,
            intro: introOn
              ? {
                  total: introAll.length,
                  confirmed: introAll.filter((fact) => introConfirmed.has(fact)).length,
                }
              : null,
            now: r.now,
          }),
          weights.trust,
        )
      : null;
  return {
    profile,
    weights,
    used,
    factCheck,
    proofAsks,
    aiChecks,
    checkDateRead,
    shippingRead,
    readable,
    casesOn,
    introOn,
    intro,
    introConfirmed,
    introAll,
    introRead,
    caseCount,
    images,
    visualRead,
    visual,
    brandInfoRead,
    eeatScore,
    productSchema,
    feedRead,
    sourceRead,
    trustScore,
  };
}

const NOW = Date.parse('2026-11-01T12:00:00Z');

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about coffee.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};

const fact = (over: Partial<BrandFact>): BrandFact => ({
  id: 'f1',
  kind: 'price',
  value: {
    plan: 'Pro',
    amount: 49,
    currency: 'USD',
    period: 'month',
    billed: 'monthly',
    per: null,
  },
  quote: 'Plans start at $49 a month.',
  sourceUrl: 'https://acme.com/pricing',
  sourceKind: 'pricing',
  status: 'approved',
  reviewedAt: null,
  firstSeenAt: '2026-10-01T00:00:00Z',
  gone: false,
  replaces: null,
  ...over,
});

const ARTICLE = `<h1>How to brew pour-over coffee</h1>
<p>Pour-over gives you control over every step. Plans start at $59 a month for our beans.</p>
<h2>What you need</h2>
<p>A dripper, a filter and fresh beans. According to the <a href="https://sca.coffee/research">SCA</a>, water at 93°C extracts best.</p>
<p>We tested 12 drippers over 3 weeks in our lab. Our customer Northwind Cafe doubled sales.</p>
<p><img src="https://acme.com/img/dripper.jpg" alt="Dripper"></p>
<h2>Steps</h2>
<ul><li>Rinse the filter.</li><li>Bloom for 30 seconds.</li><li>Pour slowly in circles.</li></ul>
<p>Read more on <a href="https://acme.com/guides">our guides</a>.</p>`;

const PRODUCT = `<h1>Acme Burr Grinder</h1>
<p>A conical burr grinder made of steel, with 40 grind settings for espresso to French press.</p>
<p>Price: $129. In stock. Free shipping over $50, and 30-day returns.</p>
<p><img src="https://acme.com/img/grinder.jpg" alt="Grinder"></p>`;

const CATEGORY = `<h1>Coffee grinders</h1>
<p>Browse 24 grinders from $29 to $499, from hand grinders to commercial ones.</p>
<ul><li><a href="https://acme.com/p/burr">Burr grinder</a></li><li><a href="https://acme.com/p/hand">Hand grinder</a></li></ul>`;

const COMPARISON = `<h1>Acme vs Rival: which grinder?</h1>
<p>Last checked on October 30, 2026. Acme costs $129; Rival costs $149.</p>
<p>Rival wins for travel. Acme is better at home.</p>`;

function readsFor(html: string, pageType: string, over: Partial<QualityReads> = {}): QualityReads {
  const blocks = qualityPhase() >= 1 ? trustBlocks(html) : [];
  const read: PageRead = {
    spots: [],
    proofs: [
      {
        kind: 'customer_case',
        claim: 'Our customer Northwind Cafe doubled sales.',
        block:
          'We tested 12 drippers over 3 weeks in our lab. Our customer Northwind Cafe doubled sales.',
      },
      {
        kind: 'research',
        claim: 'We tested 12 drippers over 3 weeks in our lab.',
        block:
          'We tested 12 drippers over 3 weeks in our lab. Our customer Northwind Cafe doubled sales.',
      },
    ],
    regulated: null,
    checks: {
      answerFirst: { answers: true, block: 'Pour-over gives you control over every step.' },
      recommends: null,
      disclosure: null,
      balance: null,
      how: {
        quote: 'We tested 12 drippers over 3 weeks in our lab.',
        block:
          'We tested 12 drippers over 3 weeks in our lab. Our customer Northwind Cafe doubled sales.',
      },
      cut: false,
      pageType,
    },
  };
  return {
    html,
    blocks,
    language: 'en',
    brandName: 'Acme',
    pageType,
    phase: qualityPhase(),
    authorsRead: true,
    author: ada,
    authorConfirmed: { real: true, profile: false },
    inputs: null,
    inputsPending: false,
    linkChecks: new Map([
      [
        'https://sca.coffee/research',
        {
          href: 'https://sca.coffee/research',
          status: 'ok',
          httpStatus: 200,
          date: '2026-09-01',
        },
      ],
    ]),
    brandDomains: ['acme.com'],
    competitorDomains: ['rival.com'],
    siteTrust: { score: 4 } as QualityReads['siteTrust'],
    siteTrustRead: true,
    brandFacts: [fact({})],
    keptSources: [],
    aiKinds: new Map() as unknown as QualityReads['aiKinds'],
    claimBlocks: null,
    pageRead: { read, paused: false, limited: false, settled: true, changing: false },
    typeRules: [{ name: 'One H1', met: true, detail: '' }],
    caseConfirms: new Set(['Northwind Cafe']),
    introConfirms: new Set(),
    casesRead: true,
    ownImages: new Set(['https://acme.com/img/dripper.jpg']),
    openSpots: 1,
    catalog: null,
    now: NOW,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const PAGES: [string, string, string][] = [
  ['an article', ARTICLE, 'blog_post'],
  ['a product page', PRODUCT, 'product_page'],
  ['a category page', CATEGORY, 'category_page'],
  ['a comparison', COMPARISON, 'comparison'],
];

describe('qualityState', () => {
  for (const phase of ['1', '2', '3']) {
    for (const [what, html, pageType] of PAGES) {
      it(`gives what the editor gave, for ${what} in phase ${phase}`, () => {
        vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', phase);
        const reads = readsFor(html, pageType);
        const now = qualityState(reads);
        expect(now).toEqual(legacy(reads));
        // The sample article is long enough to score in each phase.
        if (pageType === 'blog_post') {
          expect(now.readable?.score).toEqual(expect.any(Number));
          expect(now.trustScore?.score).toEqual(expect.any(Number));
        }
      });
    }
  }

  it('waits as the editor did, read by read', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '3');
    for (const over of [
      { authorsRead: false },
      { inputsPending: true },
      { brandDomains: null },
      { ownImages: null },
      { casesRead: false, caseConfirms: null },
      { pageRead: { read: null, paused: false, limited: false, settled: false, changing: true } },
      { siteTrustRead: false, siteTrust: null },
      { brandFacts: null, catalog: undefined },
    ] satisfies Partial<QualityReads>[]) {
      const reads = readsFor(ARTICLE, 'blog_post', over);
      expect(qualityState(reads), JSON.stringify(over)).toEqual(legacy(reads));
    }
    // A product page's feed read.
    const product = readsFor(PRODUCT, 'product_page', {
      catalog: {
        product: {
          id: 'p1',
          title: 'Acme Burr Grinder',
          url: 'https://acme.com/p/burr',
          via: 'url',
          variants: [{ price: 139, currency: 'USD', availability: 'out_of_stock', gtin: null }],
        },
      } as unknown as QualityReads['catalog'],
    });
    expect(qualityState(product)).toEqual(legacy(product));
  });

  it('gives no scores with Quality off', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    const reads = readsFor(ARTICLE, 'blog_post');
    expect(qualityState(reads)).toMatchObject({
      readable: null,
      eeatScore: null,
      trustScore: null,
    });
    expect(qualityState(reads)).toEqual(legacy(reads));
  });
});
