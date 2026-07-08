/**
 * E2E Test Database Seeder
 *
 * Seeds the LOCAL test database with realistic fixture data for E2E testing.
 *
 * SAFETY: Database URL is hardcoded to localhost to prevent
 * accidentally running this against a production database (it DELETEs all data).
 *
 * Usage: tsx seed.ts
 */
import pg from "pg";

const DATABASE_URL = "postgres://postgres:postgres@localhost:5432/getcito";

// ---------------------------------------------------------------------------
// Fixed IDs for test fixtures (so tests can reference them directly)
// ---------------------------------------------------------------------------
export const TEST_USER = {
  email: "e2e@test.local",
  password: "e2e-test-password-123",
  name: "E2E Test User",
} as const;

export const TEST_BRAND_ID = "default";
export const TEST_BRAND_NAME = "Test Organization";
export const TEST_BRAND_WEBSITE = "https://example.com";

export const PROMPT_IDS = {
  branded1: "00000000-0000-0000-0000-000000000001",
  branded2: "00000000-0000-0000-0000-000000000002",
  unbranded1: "00000000-0000-0000-0000-000000000003",
  branded3: "00000000-0000-0000-0000-000000000004",
  unbranded2: "00000000-0000-0000-0000-000000000005",
} as const;

export const COMPETITOR_IDS = {
  competitorA: "00000000-0000-0000-0000-100000000001",
  competitorB: "00000000-0000-0000-0000-100000000002",
} as const;

// Prompt run IDs (for prompt detail page testing)
const RUN_IDS = [
  "00000000-0000-0000-0000-200000000001",
  "00000000-0000-0000-0000-200000000002",
  "00000000-0000-0000-0000-200000000003",
  "00000000-0000-0000-0000-200000000004",
  "00000000-0000-0000-0000-200000000005",
  "00000000-0000-0000-0000-200000000006",
  "00000000-0000-0000-0000-200000000007",
  "00000000-0000-0000-0000-200000000008",
];

async function seed() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    console.log("Seeding E2E test database...");

    // Clear existing data (in reverse FK order)
    await client.query("DELETE FROM citations");
    await client.query("DELETE FROM prompt_runs");
    await client.query("DELETE FROM prompts");
    await client.query("DELETE FROM competitors");
    await client.query("DELETE FROM reports");
    await client.query("DELETE FROM brands");

    // -----------------------------------------------------------------------
    // 1. Brand
    // -----------------------------------------------------------------------
    await client.query(
      `INSERT INTO brands (id, name, website, enabled, onboarded, created_at, updated_at)
       VALUES ($1, $2, $3, true, true, NOW(), NOW())`,
      [TEST_BRAND_ID, TEST_BRAND_NAME, TEST_BRAND_WEBSITE]
    );
    console.log("  Created brand:", TEST_BRAND_ID);

    // -----------------------------------------------------------------------
    // 2. Prompts
    // -----------------------------------------------------------------------
    const promptData = [
      {
        id: PROMPT_IDS.branded1,
        value: "What is the best AI monitoring tool for tracking brand visibility?",
        tags: ["monitoring"],
        systemTags: ["branded"],
      },
      {
        id: PROMPT_IDS.branded2,
        value: "Compare AI visibility platforms and their features",
        tags: ["comparison"],
        systemTags: ["branded"],
      },
      {
        id: PROMPT_IDS.unbranded1,
        value: "How do I optimize content for LLM citations?",
        tags: ["optimization"],
        systemTags: ["unbranded"],
      },
      {
        id: PROMPT_IDS.branded3,
        value: "What tools can track AI search results and brand mentions?",
        tags: ["monitoring", "tools"],
        systemTags: ["branded"],
      },
      {
        id: PROMPT_IDS.unbranded2,
        value: "Best practices for generative AI SEO and content strategy",
        tags: ["seo"],
        systemTags: ["unbranded"],
      },
    ];

    for (const p of promptData) {
      await client.query(
        `INSERT INTO prompts (id, brand_id, value, enabled, tags, system_tags, created_at, updated_at)
         VALUES ($1, $2, $3, true, $4, $5, NOW(), NOW())`,
        [p.id, TEST_BRAND_ID, p.value, p.tags, p.systemTags]
      );
    }
    console.log(`  Created ${promptData.length} prompts`);

    // -----------------------------------------------------------------------
    // 3. Competitors
    // -----------------------------------------------------------------------
    const competitorData = [
      { id: COMPETITOR_IDS.competitorA, name: "Competitor Alpha", domains: ["competitor-alpha.com"] },
      { id: COMPETITOR_IDS.competitorB, name: "Competitor Beta", domains: ["competitor-beta.com"] },
    ];

    for (const c of competitorData) {
      await client.query(
        `INSERT INTO competitors (id, brand_id, name, domains, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [c.id, TEST_BRAND_ID, c.name, c.domains]
      );
    }
    console.log(`  Created ${competitorData.length} competitors`);

    // -----------------------------------------------------------------------
    // 4. Prompt Runs (realistic data for prompt detail pages)
    //    Includes citation URLs for some runs to test citation analytics.
    // -----------------------------------------------------------------------
    const now = new Date();
    const promptRuns = [
      {
        id: RUN_IDS[0],
        promptId: PROMPT_IDS.branded1,
        model: "chatgpt",
        version: "gpt-4o",
        webSearchEnabled: false,
        rawOutput: {
          response:
            "Based on my analysis, Test Organization offers a comprehensive AI monitoring platform that tracks brand visibility across major LLMs. Their tool provides real-time insights into how AI models reference and cite your brand.",
        },
        textContent:
          "Based on my analysis, Test Organization offers a comprehensive AI monitoring platform that tracks brand visibility across major LLMs. Their tool provides real-time insights into how AI models reference and cite your brand.",
        webQueries: [] as string[],
        brandMentioned: true,
        competitorsMentioned: [] as string[],
        citations: [
          { url: "https://example.com/blog/ai-monitoring", domain: "example.com", title: "AI Monitoring Guide" },
          { url: "https://docs.example.com/api", domain: "docs.example.com", title: "API Documentation" },
        ],
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[1],
        promptId: PROMPT_IDS.branded1,
        model: "claude",
        version: "claude-sonnet-4-6",
        webSearchEnabled: false,
        rawOutput: {
          response:
            "There are several AI monitoring tools available. Competitor Alpha provides basic tracking, while Test Organization offers more advanced visibility metrics and citation analysis.",
        },
        textContent:
          "There are several AI monitoring tools available. Competitor Alpha provides basic tracking, while Test Organization offers more advanced visibility metrics and citation analysis.",
        webQueries: [] as string[],
        brandMentioned: true,
        competitorsMentioned: ["Competitor Alpha"],
        citations: [
          { url: "https://competitor-alpha.com/features", domain: "competitor-alpha.com", title: "Competitor Alpha Features" },
          { url: "https://example.com/comparison", domain: "example.com", title: "Tool Comparison" },
        ],
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[2],
        promptId: PROMPT_IDS.branded1,
        model: "google-ai-mode",
        version: "gemini-2.5-pro",
        webSearchEnabled: true,
        rawOutput: {
          response:
            "For AI monitoring, you might consider tools like Competitor Beta or Test Organization. Both offer features for tracking brand mentions in AI-generated content.",
        },
        textContent:
          "For AI monitoring, you might consider tools like Competitor Beta or Test Organization. Both offer features for tracking brand mentions in AI-generated content.",
        webQueries: ["best AI monitoring tools 2025", "brand visibility AI tracking"],
        brandMentioned: true,
        competitorsMentioned: ["Competitor Beta"],
        citations: [
          { url: "https://competitor-beta.com/pricing", domain: "competitor-beta.com", title: "Competitor Beta Pricing" },
          { url: "https://example.com/blog/ai-monitoring", domain: "example.com", title: "AI Monitoring Guide" },
          { url: "https://techblog.io/ai-tools-2025", domain: "techblog.io", title: "Best AI Tools 2025" },
        ],
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[3],
        promptId: PROMPT_IDS.branded1,
        model: "chatgpt",
        version: "gpt-4o",
        webSearchEnabled: true,
        rawOutput: {
          response:
            "I'd recommend looking into various AI monitoring platforms. Some popular options include dedicated brand tracking tools that monitor how LLMs reference your brand.",
        },
        textContent:
          "I'd recommend looking into various AI monitoring platforms. Some popular options include dedicated brand tracking tools that monitor how LLMs reference your brand.",
        webQueries: ["AI brand monitoring platforms"],
        brandMentioned: false,
        competitorsMentioned: [] as string[],
        citations: [] as { url: string; domain: string; title: string }[],
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[4],
        promptId: PROMPT_IDS.branded2,
        model: "chatgpt",
        version: "gpt-4o",
        webSearchEnabled: false,
        rawOutput: {
          response:
            "When comparing AI visibility platforms, Test Organization stands out with its comprehensive prompt tracking and multi-model analysis capabilities.",
        },
        textContent:
          "When comparing AI visibility platforms, Test Organization stands out with its comprehensive prompt tracking and multi-model analysis capabilities.",
        webQueries: [] as string[],
        brandMentioned: true,
        competitorsMentioned: [] as string[],
        citations: [
          { url: "https://example.com/features", domain: "example.com", title: "Test Organization Features" },
        ],
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[5],
        promptId: PROMPT_IDS.branded2,
        model: "claude",
        version: "claude-sonnet-4-6",
        webSearchEnabled: false,
        rawOutput: {
          response:
            "Several platforms offer AI visibility tracking. Competitor Alpha and Competitor Beta are well-known options, each with different strengths in citation tracking.",
        },
        textContent:
          "Several platforms offer AI visibility tracking. Competitor Alpha and Competitor Beta are well-known options, each with different strengths in citation tracking.",
        webQueries: [] as string[],
        brandMentioned: false,
        competitorsMentioned: ["Competitor Alpha", "Competitor Beta"],
        citations: [
          { url: "https://competitor-alpha.com/about", domain: "competitor-alpha.com", title: "About Competitor Alpha" },
          { url: "https://competitor-beta.com/features", domain: "competitor-beta.com", title: "Competitor Beta Features" },
        ],
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[6],
        promptId: PROMPT_IDS.unbranded1,
        model: "chatgpt",
        version: "gpt-4o-mini",
        webSearchEnabled: false,
        rawOutput: {
          response:
            "To optimize content for LLM citations, focus on creating authoritative, well-structured content with clear data points and references.",
        },
        textContent:
          "To optimize content for LLM citations, focus on creating authoritative, well-structured content with clear data points and references.",
        webQueries: [] as string[],
        brandMentioned: false,
        competitorsMentioned: [] as string[],
        citations: [
          { url: "https://searchenginejournal.com/llm-seo", domain: "searchenginejournal.com", title: "LLM SEO Guide" },
        ],
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      {
        id: RUN_IDS[7],
        promptId: PROMPT_IDS.unbranded1,
        model: "claude",
        version: "claude-sonnet-4-6",
        webSearchEnabled: true,
        rawOutput: {
          response:
            "Optimizing for LLM citations involves several strategies including structured data markup, authoritative backlinks, and consistent brand messaging across your digital presence.",
        },
        textContent:
          "Optimizing for LLM citations involves several strategies including structured data markup, authoritative backlinks, and consistent brand messaging across your digital presence.",
        webQueries: ["how to get cited by AI models", "LLM citation optimization"],
        brandMentioned: false,
        competitorsMentioned: [] as string[],
        citations: [
          { url: "https://searchenginejournal.com/llm-seo", domain: "searchenginejournal.com", title: "LLM SEO Guide" },
          { url: "https://moz.com/blog/ai-citations", domain: "moz.com", title: "AI Citation Strategies" },
        ],
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    ];

    for (const run of promptRuns) {
      await client.query(
        `INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output, web_queries, brand_mentioned, competitors_mentioned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          run.id,
          run.promptId,
          TEST_BRAND_ID,
          run.model,
          run.version,
          run.webSearchEnabled,
          JSON.stringify(run.rawOutput),
          run.webQueries,
          run.brandMentioned,
          run.competitorsMentioned,
          run.createdAt,
        ]
      );
    }
    console.log(`  Created ${promptRuns.length} prompt runs (Postgres)`);

    // -----------------------------------------------------------------------
    // 5. Insert citations into Postgres
    // -----------------------------------------------------------------------
    let citationCount = 0;
    for (const run of promptRuns) {
      for (let i = 0; i < run.citations.length; i++) {
        const c = run.citations[i];
        await client.query(
          `INSERT INTO citations (prompt_run_id, prompt_id, brand_id, model, url, domain, title, citation_index, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            run.id,
            run.promptId,
            TEST_BRAND_ID,
            run.model,
            c.url,
            c.domain,
            c.title,
            i,
            run.createdAt,
          ]
        );
        citationCount++;
      }
    }
    console.log(`  Created ${citationCount} citations (Postgres)`);

    console.log("\nE2E database seeding complete!");
    console.log(`  Brand: ${TEST_BRAND_ID} (${TEST_BRAND_NAME})`);
    console.log(`  Prompts: ${promptData.length}`);
    console.log(`  Competitors: ${competitorData.length}`);
    console.log(`  Prompt Runs: ${promptRuns.length}`);
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
