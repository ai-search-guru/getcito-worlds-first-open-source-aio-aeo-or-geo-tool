import { describe, it, expect } from 'vitest';
import {
  brandMentionRanges,
  computeMentionPosition,
  countBrandMentions,
  parseResponse,
  mentionExcerpt,
} from './responseParser.js';

describe('response-parser', () => {
  describe('countBrandMentions', () => {
    it('should count occurrences of brand name and its domains case-insensitively', () => {
      const brand = {
        brandName: 'Acme',
        domains: ['acme.com', 'acme-corp.com'],
      };
      const text =
        'Acme is great. You can visit acme.com or email contact@acme-corp.com. ACME is case-insensitive.';
      // Brand Name: Acme (1) + ACME (1) = 2
      // Domains: acme.com (1) + acme-corp.com (1) = 2
      // In addition, the brand name "Acme" also matches the "acme" part of "acme.com" and "acme-corp.com" due to word boundaries.
      // So brand name matches = 4, domains match = 2. Total = 6.
      expect(countBrandMentions(text, brand)).toBe(6);
    });

    it('should strip URLs to prevent double-counting domains in markdown link URLs or bare URLs', () => {
      const brand = {
        brandName: 'Acme',
        domains: ['acme.com'],
      };
      // Markdown link: [Acme](https://acme.com/about)
      // If stripped, it becomes: Acme (which has 1 mention of brandName). The domain acme.com in the URL is stripped and NOT counted.
      const text =
        'Check [Acme](https://acme.com/about) or go to bare URL https://acme.com/home directly.';
      // Stripped text should be: "Check Acme or go to bare URL  directly."
      // Mentions: "Acme" (1 mention). "acme.com" should not appear in the stripped text.
      expect(countBrandMentions(text, brand)).toBe(1);
    });

    it('should return 0 if there are no brand mentions or domains in the text', () => {
      const brand = {
        brandName: 'Acme',
        domains: ['acme.com'],
      };
      const text = 'Some other text about Globex and globex.com.';
      expect(countBrandMentions(text, brand)).toBe(0);
    });
  });

  describe('parseResponse', () => {
    const brand = {
      brandName: 'Acme',
      domains: ['acme.com', 'acme-corp.com'],
    };

    describe('brand mention count', () => {
      it('should count brand mentions in response object, stripping URLs first', () => {
        const response = {
          text: 'We recommend [Acme](https://acme.com). Acme rules!',
          citations: [{ url: 'https://acme.com', title: 'Acme Inc' }],
        };
        const result = parseResponse(response, brand, 'neutral');
        // Stripped: "We recommend Acme. Acme rules!"
        // Mentions: "Acme" (2)
        expect(result.mentionCount).toBe(2);
      });
    });

    describe('citation count', () => {
      it('should count case-insensitive hostname matches against citations[].url', () => {
        const response = {
          text: 'Acme is featured in these links.',
          citations: [
            { url: 'https://ACME.com/page1', title: 'Page 1' },
            { url: 'https://www.acme-corp.com/info', title: 'Page 2' },
          ],
        };
        const result = parseResponse(response, brand, 'neutral');
        // acme.com matches ACME.com/page1; acme-corp.com matches the www variant.
        expect(result.citationCount).toBe(2);
      });

      it('should count subdomains of a brand domain', () => {
        const response = {
          text: 'Acme docs.',
          citations: [{ url: 'https://docs.acme.com/setup', title: 'Docs' }],
        };
        const result = parseResponse(response, brand, 'neutral');
        expect(result.citationCount).toBe(1);
      });

      it('should NOT count a brand domain appearing in another site path or query', () => {
        const response = {
          text: 'Acme is referenced.',
          citations: [
            { url: 'https://other.com/acme-corp.com/info', title: 'Path lookalike' },
            { url: 'https://other.com/?ref=acme.com', title: 'Query lookalike' },
          ],
        };
        const result = parseResponse(response, brand, 'neutral');
        // The hostname is other.com in both — matches the Citations page's
        // classification, which the stored count must agree with.
        expect(result.citationCount).toBe(0);
      });

      it('should count a citation once even if multiple brand domains match it', () => {
        const response = {
          text: 'Acme link.',
          citations: [{ url: 'https://acme.com/acme-corp.com', title: 'Double match' }],
        };
        const result = parseResponse(response, brand, 'neutral');
        // Only one citation exists, so citationCount should be at most 1
        expect(result.citationCount).toBe(1);
      });
    });

    describe('visibility score calculation', () => {
      // Visibility Score rules:
      // Mention component: Math.min(mentionCount * 10, 40)
      // Citation component: Math.min(citationCount * 15, 30)
      // Citation ratio bonus: Math.round((citationCount / totalCitations) * 15)
      // Sentiment bonus:
      //   positive -> +15
      //   neutral and mentionCount > 0 -> +7
      //   else -> 0
      // Max score = 100

      it('should compute score with positive sentiment and mention/citation counts', () => {
        const response = {
          text: 'Acme Acme Acme Acme', // 4 mentions -> 40 points
          citations: [
            { url: 'https://acme.com', title: 'Link 1' }, // 1 citation -> 15 points
            { url: 'https://other.com', title: 'Link 2' },
          ],
        };
        // totalCitations = 2, citationCount = 1
        // citation ratio = 1/2 * 15 = 7.5 -> Math.round(7.5) = 8 points
        // sentiment = positive -> 15 points
        // Expected score = 40 + 15 + 8 + 15 = 78
        const result = parseResponse(response, brand, 'positive');
        expect(result.visibilityScore).toBe(78);
      });

      it('should compute score with neutral sentiment and mentionCount > 0', () => {
        const response = {
          text: 'Acme Acme', // 2 mentions -> 20 points
          citations: [
            { url: 'https://acme.com', title: 'Link 1' }, // 1 citation -> 15 points
          ],
        };
        // totalCitations = 1, citationCount = 1
        // citation ratio = 1/1 * 15 = 15 points
        // sentiment = neutral, mentionCount > 0 -> 7 points
        // Expected score = 20 + 15 + 15 + 7 = 57
        const result = parseResponse(response, brand, 'neutral');
        expect(result.visibilityScore).toBe(57);
      });

      it('should compute score with negative sentiment', () => {
        const response = {
          text: 'Acme Acme', // 2 mentions -> 20 points
          citations: [
            { url: 'https://acme.com', title: 'Link 1' }, // 1 citation -> 15 points
          ],
        };
        // totalCitations = 1, citationCount = 1
        // citation ratio = 1/1 * 15 = 15 points
        // sentiment = negative -> 0 points
        // Expected score = 20 + 15 + 15 + 0 = 50
        const result = parseResponse(response, brand, 'negative');
        expect(result.visibilityScore).toBe(50);
      });

      it('should cap the visibility score at 100', () => {
        const response = {
          text: 'Acme Acme Acme Acme Acme Acme', // 6 mentions -> capped at 40
          citations: [
            { url: 'https://acme.com', title: 'Link 1' }, // 2 citations -> capped at 30
            { url: 'https://acme-corp.com', title: 'Link 2' },
          ],
        };
        // totalCitations = 2, citationCount = 2
        // citation ratio = 2/2 * 15 = 15 points
        // sentiment = positive -> 15 points
        // Total before cap: 40 + 30 + 15 + 15 = 100
        const result = parseResponse(response, brand, 'positive');
        expect(result.visibilityScore).toBe(100);
      });
    });

    describe('competitor mentions', () => {
      const competitors = [
        { id: '1', name: 'Globex', domain: 'globex.com' },
        { id: '2', name: 'Initech', domain: '' }, // missing domain
      ];

      it('should compute metrics for each competitor', () => {
        const response = {
          text: 'Globex is alright, but Initech is better. Check globex.com or initech.org.',
          citations: [
            { url: 'https://globex.com/about', title: 'Globex Inc' },
            { url: 'https://initech.org/info', title: 'Initech Inc' },
          ],
        };
        const result = parseResponse(response, brand, 'neutral', competitors);

        // Competitor 1 (Globex):
        // Name: Globex (1 mention + 1 matching inside globex.com due to word boundaries = 2 mentions)
        // Domain: globex.com (1 mention)
        // Total = 3 mentions
        // Citations: globex.com matches 1 citation -> total 1 citation
        // score logic for competitor:
        //   mention component: Math.min(3 * 10, 40) = 30
        //   citation component: Math.min(1 * 15, 30) = 15
        //   citation ratio bonus: Math.round((1 / 2) * 15) = 8
        //   sentiment is always neutral, mentions = 3 > 0 -> 7
        //   expected score = 30 + 15 + 8 + 7 = 60
        const globexResult = result.competitorMentions.find((c) => c.competitor_id === '1');
        expect(globexResult).toBeDefined();
        expect(globexResult.name).toBe('Globex');
        expect(globexResult.domain).toBe('globex.com');
        expect(globexResult.mention_count).toBe(3);
        expect(globexResult.citation_count).toBe(1);
        expect(globexResult.visibility_score).toBe(60);

        // Competitor 2 (Initech):
        // Name: Initech (1 mention + 1 matching inside initech.org due to word boundaries = 2 mentions)
        // Domain: "" (ignored)
        // Citations: domain is empty -> total 0 citations
        // score logic for competitor:
        //   mention component: Math.min(2 * 10, 40) = 20
        //   citation component: Math.min(0 * 15, 30) = 0
        //   citation ratio bonus: 0
        //   sentiment is always neutral, mentions = 2 > 0 -> 7
        //   expected score = 20 + 0 + 0 + 7 = 27
        const initechResult = result.competitorMentions.find((c) => c.competitor_id === '2');
        expect(initechResult).toBeDefined();
        expect(initechResult.name).toBe('Initech');
        expect(initechResult.domain).toBe('');
        expect(initechResult.mention_count).toBe(2);
        expect(initechResult.citation_count).toBe(0);
        expect(initechResult.visibility_score).toBe(27);
      });
    });

    describe('edge cases', () => {
      it('should handle empty text and citations gracefully', () => {
        const response = {
          text: '',
          citations: [],
        };
        const result = parseResponse(response, brand, 'neutral');
        expect(result.mentionCount).toBe(0);
        expect(result.citationCount).toBe(0);
        expect(result.visibilityScore).toBe(0);
        expect(result.competitorMentions).toEqual([]);
      });

      it('should handle zero mentions and zero citations with non-zero total citations', () => {
        const response = {
          text: 'Completely unrelated text about other things.',
          citations: [{ url: 'https://unrelated.com', title: 'Unrelated' }],
        };
        const result = parseResponse(response, brand, 'neutral');
        expect(result.mentionCount).toBe(0);
        expect(result.citationCount).toBe(0);
        expect(result.visibilityScore).toBe(0);
      });
    });
  });

  describe('computeMentionPosition', () => {
    const brand = { brandName: 'Acme', domains: ['acme.com'] };
    const competitors = [
      { id: 'c1', name: 'Globex', domain: 'globex.com' },
      { id: 'c2', name: 'Initech', domain: 'initech.com' },
      { id: 'c3', name: 'Umbrella', domain: 'umbrella.com' },
    ];

    it('ranks the brand first when it is named before every competitor', () => {
      const text = 'Acme leads the market, ahead of Globex and Initech.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: 1,
        mentionedEntityCount: 3,
      });
    });

    it('ranks the brand by how many competitors are named before it', () => {
      const text = 'Top picks: Globex, Initech, and also Acme as a budget option.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: 3,
        mentionedEntityCount: 3,
      });
    });

    it('returns a null position when the brand is not mentioned', () => {
      const text = 'Globex and Umbrella dominate this space.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: null,
        mentionedEntityCount: 2,
      });
    });

    it('counts a domain occurrence as a brand mention for positioning', () => {
      const text = 'Globex is popular, but acme.com has the best docs.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: 2,
        mentionedEntityCount: 2,
      });
    });

    it('ignores names that only appear inside URLs', () => {
      const text = 'Initech is the leader. See [comparison](https://acme.com/vs) for details.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: null,
        mentionedEntityCount: 1,
      });
    });

    it('reports zero entities for an answer that names nobody', () => {
      expect(computeMentionPosition('Nothing relevant here.', brand, competitors)).toMatchObject({
        mentionPosition: null,
        mentionedEntityCount: 0,
      });
    });

    it("uses each entity's earliest occurrence, not its last", () => {
      const text = 'Globex... later Acme appears. Globex again at the end.';
      expect(computeMentionPosition(text, brand, competitors)).toMatchObject({
        mentionPosition: 2,
        mentionedEntityCount: 2,
      });
    });

    it('ranks each mentioned competitor among all mentioned entities', () => {
      const text = 'Globex leads, then Acme, with Umbrella as a distant third.';
      const result = computeMentionPosition(text, brand, competitors);
      expect(result.mentionPosition).toBe(2);
      expect(result.competitorPositions.get('c1')).toBe(1); // Globex
      expect(result.competitorPositions.get('c3')).toBe(3); // Umbrella
      expect(result.competitorPositions.has('c2')).toBe(false); // Initech absent
    });

    it('ranks competitors even when the brand is not mentioned', () => {
      const text = 'Initech and Globex dominate here.';
      const result = computeMentionPosition(text, brand, competitors);
      expect(result.mentionPosition).toBeNull();
      expect(result.competitorPositions.get('c2')).toBe(1); // Initech
      expect(result.competitorPositions.get('c1')).toBe(2); // Globex
    });
  });

  describe('competitor mention positions in parseResponse', () => {
    it('embeds each competitor rank into competitor_mentions entries', () => {
      const brand = { brandName: 'Acme', domains: ['acme.com'] };
      const competitors = [
        { id: 'c1', name: 'Globex', domain: 'globex.com' },
        { id: 'c2', name: 'Initech', domain: 'initech.com' },
      ];
      const response = {
        text: 'Globex is first here, Acme second, and nobody mentions the rest.',
        citations: [],
      };
      const result = parseResponse(response, brand, 'neutral', competitors);
      const byId = new Map(result.competitorMentions.map((c) => [c.competitor_id, c]));
      expect(byId.get('c1').mention_position).toBe(1);
      expect(byId.get('c2').mention_position).toBeNull();
      expect(result.mentionPosition).toBe(2);
    });
  });

  describe('names outside ASCII word characters (#871)', () => {
    const count = (text, brandName) => countBrandMentions(text, { brandName, domains: [] });

    it('matches names that start or end with an accented letter', () => {
      expect(count('I like Émile Studio. Émile Studio is great.', 'Émile Studio')).toBe(2);
      expect(count('Ümit ve Eda, Ümit en çok bilinen.', 'Ümit')).toBe(2);
      expect(count('Çınar Bankası ve Çınar Bankası şubeleri', 'Çınar Bankası')).toBe(2);
    });

    it('matches names that start or end with punctuation', () => {
      expect(count('I like Acme!. Acme! is great.', 'Acme!')).toBe(2);
      expect(count('I like C++. C++ is great.', 'C++')).toBe(2);
      expect(count('Acme, Inc. and Acme, Inc. again', 'Acme, Inc.')).toBe(2);
    });

    it('still ignores a name inside a longer word, in any Latin script', () => {
      expect(count('Acmegroup and SuperAcme are different.', 'Acme')).toBe(0);
      expect(count('Ümitler and Tümit are different.', 'Ümit')).toBe(0);
      expect(count('Acmeé is not Acme.', 'Acme')).toBe(1);
    });

    it('matches names in scripts written without spaces between words', () => {
      expect(count('我推荐星云科技，星云科技的服务很好。', '星云科技')).toBe(2);
      expect(count('하늘랩은 좋은 회사입니다. 하늘랩의 제품', '하늘랩')).toBe(2);
    });

    it('keeps the plain ASCII behaviour', () => {
      expect(count('I like Acme. Acme is great.', 'Acme')).toBe(2);
      expect(count("Acme's pricing beats acme-lite.", 'Acme')).toBe(2);
    });

    it('positions a non-ASCII name among its competitors', () => {
      const text = 'Eda öne çıkıyor, ardından Ümit ve İpek geliyor.';
      const result = computeMentionPosition(text, { brandName: 'Ümit', domains: [] }, [
        { id: 'c1', name: 'Eda', domain: null },
        { id: 'c2', name: 'İpek', domain: null },
      ]);
      expect(result.mentionPosition).toBe(2);
      expect(result.mentionedEntityCount).toBe(3);
      expect(result.competitorPositions.get('c2')).toBe(3);
    });

    it('counts non-ASCII competitor names in parseResponse', () => {
      const result = parseResponse(
        { text: 'İpek ve Eda, İpek daha ucuz.', citations: [] },
        { brandName: 'Acme', domains: [] },
        'neutral',
        [{ id: 'c1', name: 'İpek', domain: null }],
      );
      expect(result.competitorMentions[0].mention_count).toBe(2);
      expect(result.competitorMentions[0].mention_position).toBe(1);
    });
  });

  describe('ChatGPT entity markup', () => {
    const text = [
      '1. <Entity category="software" value="Tesseract" disambig="Adlift AI search optimization platform"/> — tracks answers.',
      '2. <Entity category="software" value="GetCito" /> — open source.',
      '3. Adlift — agency platform.',
    ].join('\n');
    const brand = { brandName: 'GetCito', domains: ['getcito.com'] };
    const competitors = [
      { id: 'tesseract', name: 'Tesseract', domain: null },
      { id: 'adlift', name: 'Adlift', domain: null },
      { id: 'software', name: 'Software', domain: null },
    ];

    it('counts only the names the answer reads, not the tag attributes', () => {
      const result = parseResponse({ text, citations: [] }, brand, 'neutral', competitors);
      const byId = new Map(result.competitorMentions.map((c) => [c.competitor_id, c]));
      expect(result.mentionCount).toBe(1);
      expect(byId.get('tesseract').mention_count).toBe(1);
      // Named in Tesseract's disambig and once in the answer itself.
      expect(byId.get('adlift').mention_count).toBe(1);
      // Only ever the tag's category.
      expect(byId.get('software').mention_count).toBe(0);
    });

    it('ranks entities by where the answer names them', () => {
      const result = computeMentionPosition(text, brand, competitors);
      expect(result.mentionPosition).toBe(2);
      expect(result.mentionedEntityCount).toBe(3);
      expect(result.competitorPositions.get('tesseract')).toBe(1);
      expect(result.competitorPositions.get('adlift')).toBe(3);
      expect(result.competitorPositions.has('software')).toBe(false);
    });

    it('counts a brand named only inside a tag', () => {
      expect(countBrandMentions('Try <Entity category="software" value="GetCito"/>.', brand)).toBe(
        1,
      );
    });
  });
});

describe('brandMentionRanges', () => {
  it('finds the name and the domains as whole words, in order', () => {
    const text = 'Acme leads. See acme.com. Acmeville is a town. ACME again.';

    expect(brandMentionRanges(text, { brandName: 'Acme', domains: ['acme.com'] })).toEqual([
      [0, 4],
      [16, 20],
      [16, 24],
      [47, 51],
    ]);
  });
});

describe('mentionExcerpt', () => {
  const brand = { brandName: 'Acme Coffee', domains: ['acme-coffee.example.com'] };

  it('quotes the answer around the first mention, without links or markdown marks', () => {
    const text = `${'Intro words. '.repeat(20)}Our pick is **Acme Coffee** ([site](https://x.example)) for offices.`;
    expect(mentionExcerpt(text, brand, 20)).toBe(
      '…words. Our pick is Acme Coffee (site) for offices.',
    );
    // A cut inside a word moves to the next whole word.
    expect(mentionExcerpt(text, brand, 22)).toBe(
      '…words. Our pick is Acme Coffee (site) for offices.',
    );
    expect(mentionExcerpt(`Acme Coffee is a pick for remote offices`, brand, 5)).toBe(
      'Acme Coffee is a…',
    );
  });

  it('drops markdown marks but keeps a # or > inside a sentence', () => {
    expect(mentionExcerpt('## Picks\n> Acme Coffee is the #1 pick, and A > B.', brand)).toBe(
      'Picks Acme Coffee is the #1 pick, and A > B.',
    );
  });

  it('finds the brand by its domain, and says nothing when it is not named', () => {
    expect(mentionExcerpt('See acme-coffee.example.com today.', brand)).toBe(
      'See acme-coffee.example.com today.',
    );
    expect(mentionExcerpt('No brand here.', brand)).toBeNull();
    expect(mentionExcerpt(null, brand)).toBeNull();
  });
});
