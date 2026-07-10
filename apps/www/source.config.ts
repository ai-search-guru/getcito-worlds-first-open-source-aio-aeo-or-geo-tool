import { remarkFeedbackBlock } from "fumadocs-core/mdx-plugins/remark-feedback-block";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { z } from "zod";

export const docs = defineDocs({
	dir: "../../packages/docs/content/docs",
	docs: {
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

// Resources blog. `author` is either a key in src/data/authors.ts (a real
// team member) or the reserved value "ai" for AI-generated posts — the byline
// renders differently for each. See src/components/author-byline.tsx.
export const blog = defineDocs({
	dir: "../../packages/docs/content/blog",
	docs: {
		schema: pageSchema.extend({
			// An unquoted date in YAML frontmatter (date: 2026-05-30) is parsed
			// into a Date, while a quoted one ("2026-05-30") stays a string.
			// Accept either and normalize to a YYYY-MM-DD string so downstream
			// code (byline, JSON-LD, RSS) only ever deals with a string.
			date: z
				.union([z.string(), z.date()])
				.transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)),
			author: z.string(),
			tags: z.array(z.string()).optional(),
			// Optional SEO <title> override. The post `title` is the on-page H1;
			// when these diverge (e.g. a tighter, click-worthy ≤60-char title)
			// set this. Falls back to `${title} · Getcito` when omitted.
			metaTitle: z.string().optional(),
			// FAQ pairs rendered at the foot of the post AND emitted as FAQPage
			// JSON-LD — one source of truth for the markup an answer engine lifts.
			faq: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
			// Emits ItemList JSON-LD for roundup/listicle posts. `url` may be an
			// absolute vendor URL or a site-relative path.
			itemList: z
				.array(z.object({ name: z.string(), url: z.string().optional(), description: z.string().optional() }))
				.optional(),
			// Emits DefinedTermSet JSON-LD for the glossary. `href` is an optional
			// "see also" link for the term.
			definedTerms: z
				.array(z.object({ term: z.string(), definition: z.string(), href: z.string().optional() }))
				.optional(),
			// Emits HowTo JSON-LD for step-by-step guides.
			howTo: z
				.object({
					name: z.string().optional(),
					description: z.string().optional(),
					steps: z.array(z.object({ name: z.string(), text: z.string() })),
				})
				.optional(),
		}),
	},
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: [[remarkFeedbackBlock]],
	},
});
