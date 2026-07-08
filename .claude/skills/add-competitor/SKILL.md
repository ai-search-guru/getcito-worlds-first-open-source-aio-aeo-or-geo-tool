---
name: add-competitor
description: Add a new competitor to the AI Visibility Tool Directory — researches the tool, generates data, takes a screenshot, and inserts into the codebase
argument-hint: <url>
---

Add a new competitor to the AI visibility tool directory at `apps/www/src/lib/competitors/data.ts`.

The user will provide a URL. Follow these steps:

**Important: Write objective, factual descriptions.** Do not use marketing language, exaggerations, or the competitor's own promotional claims at face value. Describe what the tool does and how it works in neutral terms. Avoid superlatives like "industry-leading", "best-in-class", "revolutionary", etc. Stick to verifiable facts — features offered, platforms tracked, pricing tiers. Highlights should be factual differentiators, not praise.

## 1. Research the competitor

Use WebFetch to read the competitor's website at `$ARGUMENTS`. Gather:
- Product name
- Domain
- What the tool does (tagline + longer description)
- Which category it fits: `tracking`, `content`, `api-developer`, `ecommerce`, `seo-traditional`, `open-source`, or `other`
- Pricing info (free tier? starting price? enterprise?)
- Status: `active`, `shutting-down`, `acquired`, or `beta`
- 3 highlights (short bullet points about what makes it notable)

## 2. Determine feature flags

Read the feature definitions in `apps/www/src/lib/competitors/types.ts` (the `FEATURE_CATEGORIES` constant). Based on your research, determine which features the competitor supports. Set each to `true` or omit it (defaults to `false`). The features are:

- `multiLlmTracking` — tracks across multiple AI platforms (ChatGPT, Claude, Gemini, etc.)
- `visibilityScore` — provides an aggregate AI visibility score
- `citationAnalytics` — tracks citation sources in AI responses
- `competitorBenchmarking` — compare visibility against competitors
- `brandMentionTracking` — monitor brand mentions in AI responses
- `promptVolumeEstimates` — estimated search/prompt volumes
- `sentimentAnalysis` — brand sentiment in AI responses
- `crawlerAnalytics` — track AI bot visits to your site
- `geographicTracking` — visibility by region/country
- `socialMediaTracking` — Reddit and social platform monitoring
- `shoppingTracking` — product visibility in AI shopping
- `multiLanguage` — multi-language support
- `actionRecommendations` — prioritized action items
- `contentGapAnalysis` — detect content gaps vs competitors
- `siteAudits` — AI site readiness audits
- `keywordResearch` — AI keyword/prompt discovery
- `emailAlerts` — automated alerts
- `dataExportApi` — CSV export or API access
- `biConnectors` — Looker Studio, NinjaCat, etc.
- `whiteLabelAgency` — white-label or agency features
- `openSource` — source code available
- `contentGeneration` — AI content creation

Be conservative — only mark features as `true` if you can confirm them from the website.

## 3. Fetch domain metrics

Extract the domain from the URL (e.g. `https://www.example.com/foo` → `example.com`). Then run:
```bash
cd apps/www && node scripts/fetch-domain-metrics.mjs "<domain>"
```

This returns JSON with `ahrefsDR` and `ahrefsTraffic`. Use these values in the competitor entry.

## 4. Generate the slug

Create a URL-friendly slug from the product name (lowercase, hyphens, no special chars). For example: "Otterly.ai" → "otterly", "SE Ranking" → "se-ranking".

## 5. Take the screenshot and upload

Run the screenshot script:
```bash
cd apps/www && node scripts/screenshot-competitor.mjs "<slug>" "<url>"
```

This requires `SCREENSHOT_ONE_ACCESS_KEY` and `BLOB_READ_WRITE_TOKEN` in `apps/www/.env`.

If the script fails, inform the user and continue with the data entry — the screenshot can be added later.

## 6. Insert into data.ts

Read `apps/www/src/lib/competitors/data.ts` and insert the new `Competitor` object into the `competitors` array (position in this array doesn't matter for display order).

Use the same code style as the existing entries. Example entry:

```typescript
{
    slug: "example-tool",
    name: "Example Tool",
    domain: "example.com",
    url: "https://example.com",
    tagline: "Short one-line description of what they do",
    description:
        "Longer 2-3 sentence description of the tool, its approach, and what makes it notable.",
    category: "tracking",
    ahrefsDR: 55,
    ahrefsTraffic: 1234,
    status: "active",
    features: {
        multiLlmTracking: true,
        visibilityScore: true,
        citationAnalytics: true,
    },
    pricing: { hasFree: true, startingPrice: "$49/mo", hasEnterprise: false },
    highlights: [
        "First highlight",
        "Second highlight",
        "Third highlight",
    ],
},
```

## 7. Add to AEO popularity ranking

In the same file (`data.ts`), find the `aeoPopularityRanking` array. This is a hardcoded list of slugs ordered from most popular to least popular **as an AEO tool specifically**. It determines both the display order in the directory and the A–F popularity grade.

Insert the new tool's slug at the appropriate position based on these criteria (in priority order):

1. **Is AI visibility / AEO the tool's PRIMARY product?** Pure AEO trackers rank above SEO suites or content platforms that bolted on AEO features.
2. **Market traction as an AEO tool** — funding rounds, notable enterprise customers, press coverage (Fortune, WSJ, TechCrunch, etc.), user counts, industry recognition (G2, Gartner, etc.).
3. **Feature depth in core AEO capabilities** — multi-LLM tracking, visibility scores, citation analytics, competitor benchmarking, brand mention tracking.
4. **General web authority (DR/traffic) is a minor tiebreaker only** — a DR 90 SEO suite with a small AEO add-on should NOT outrank a DR 50 dedicated AEO tracker.

The tiers in the ranking are:
- **Tier A** (top ~8%): Well-known, established AEO-focused tools with real traction
- **Tier B** (next ~13%): Known/growing AEO tools
- **Tier C** (next ~22%): Niche/emerging AEO tools with some traction
- **Tier D** (next ~27%): Early/small AEO tools
- **Tier F** (rest): Very new or minimal traction

If the tool is a large platform where AI visibility is NOT the primary product (e.g., a traditional SEO suite, analytics platform, or content tool that added AEO as a secondary feature), do NOT add it to `aeoPopularityRanking`. Instead, add its slug to the `aeoNotApplicable` set. These tools get an "N/A" grade and sort to the bottom of the directory.

Look at the tools already in each tier to calibrate where the new tool belongs. Insert the slug with a short comment explaining the placement.

## 8. Verify

Run TypeScript type checking to make sure the entry compiles:
```bash
pnpm exec tsc --noEmit
```

## 9. Summary

After completing all steps, tell the user:
- The competitor name and slug
- The category, ahrefsDR, and ahrefsTraffic
- Which features you marked as true
- Whether the screenshot uploaded successfully
- The URL where the comparison page will be: `/ai-visibility-tools/elmo-vs-<slug>`
