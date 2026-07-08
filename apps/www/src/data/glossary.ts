export interface GlossaryTerm {
	slug: string;
	term: string;
	/** Display synonyms, e.g. ["AEO"]. */
	aka?: string[];
	/** Thematic group for the index page. */
	group: GlossaryGroup;
	/** One-sentence definition. Used on the index, in meta, and in JSON-LD. */
	short: string;
	/** Expanded definition, one entry per paragraph. */
	body: string[];
	/** Slugs of related terms in this glossary. */
	related?: string[];
	/** External or on-site "see also" links (deep guides). */
	seeAlso?: { label: string; href: string }[];
}

export type GlossaryGroup =
	| "Core disciplines"
	| "Where AI answers appear"
	| "What to measure"
	| "How engines work";

export const GLOSSARY_GROUPS: GlossaryGroup[] = [
	"Core disciplines",
	"Where AI answers appear",
	"What to measure",
	"How engines work",
];

export const glossaryTerms: GlossaryTerm[] = [
	// --- Core disciplines ----------------------------------------------------
	{
		slug: "answer-engine-optimization",
		term: "Answer Engine Optimization",
		aka: ["AEO"],
		group: "Core disciplines",
		short:
			"The practice of measuring and improving how often AI answer engines mention and cite your brand.",
		body: [
			"Answer engine optimization is what SEO becomes when the result is a written answer instead of a list of links. The goal shifts from ranking a page to being the source an engine quotes when someone asks about your category.",
			"In practice that means publishing clear, well-structured content, earning mentions on sources the models already trust, and tracking the prompts that matter to your brand. You want to see where you show up, and where a competitor shows up instead.",
		],
		related: [
			"generative-engine-optimization",
			"llmo",
			"ai-visibility",
			"ai-citation",
		],
		seeAlso: [
			{ label: "Full AEO guide", href: "/blog/answer-engine-optimization" },
		],
	},
	{
		slug: "generative-engine-optimization",
		term: "Generative Engine Optimization",
		aka: ["GEO", "Generative SEO"],
		group: "Core disciplines",
		short:
			"Optimizing content to appear inside AI-generated answers. Largely a synonym for AEO.",
		body: [
			"GEO and AEO describe nearly the same work. Both aim to get your brand surfaced in answers from engines like ChatGPT, Perplexity, and Google AI Overviews. The difference is mostly emphasis: GEO tends to stress the generative side, meaning how a model assembles an answer from the sources it retrieves.",
			"You will also see LLMO and LLM SEO used for the same idea. None of these labels should change what you actually do, which is make your content easy to retrieve, quote, and trust.",
		],
		related: ["answer-engine-optimization", "llmo", "retrieval-augmented-generation"],
		seeAlso: [
			{ label: "What is generative SEO?", href: "/blog/what-is-generative-seo" },
		],
	},
	{
		slug: "llmo",
		term: "LLMO",
		aka: ["LLM Optimization", "LLM SEO"],
		group: "Core disciplines",
		short:
			"Large language model optimization: another name for the work of getting cited in AI answers.",
		body: [
			"LLMO puts the large language model at the center of the name, but the practice is the same one described by AEO and GEO. The terminology in this space is still settling, and the labels overlap more than they differ.",
			"Pick whichever term your team finds clearest and move on. What counts is whether the models that answer your buyers' questions know your brand and treat it as a trustworthy source.",
		],
		related: ["answer-engine-optimization", "generative-engine-optimization", "large-language-model"],
	},
	{
		slug: "ai-visibility",
		term: "AI visibility",
		group: "Core disciplines",
		short:
			"How present your brand is across AI answers: how often it is mentioned, cited, and described accurately.",
		body: [
			"AI visibility is the outcome AEO works toward. It is the share of relevant AI answers where your brand appears, the sources those answers cite, and whether the description of you is correct.",
			"Because answers vary between runs and shift over time, visibility is something you sample rather than check once. Tracking a consistent set of prompts on a schedule gives a far more reliable read than a single manual look.",
		],
		related: ["share-of-voice", "visibility-score", "brand-mention", "prompt-tracking"],
		seeAlso: [
			{ label: "AI visibility software", href: "/ai-visibility-tools" },
		],
	},

	// --- Where AI answers appear ---------------------------------------------
	{
		slug: "answer-engine",
		term: "Answer engine",
		group: "Where AI answers appear",
		short:
			"A system that responds to a question with a synthesized answer rather than a page of links.",
		body: [
			"An answer engine reads a question, gathers relevant sources, and writes a direct response. ChatGPT, Perplexity, Gemini, and Google's AI Overviews all work this way, even though they differ in how much they browse the live web.",
			"The shift matters because the unit of visibility changes. There is often no ranking to hold. There is one answer, and your brand is either named in it or it is not.",
		],
		related: ["ai-search-engine", "google-ai-overviews", "chatgpt-search"],
	},
	{
		slug: "ai-search-engine",
		term: "AI search engine",
		group: "Where AI answers appear",
		short:
			"A search product that returns AI-written answers with citations instead of a ranked list.",
		body: [
			"AI search engines pair a language model with live retrieval, then cite the sources they used. Perplexity is the clearest example, but ChatGPT Search and Google's AI Mode work along the same lines.",
			"For brands, the citation is the prize. Being named in the answer drives awareness, and being cited with a link drives the qualified clicks that remain.",
		],
		related: ["answer-engine", "ai-citation", "chatgpt-search"],
		seeAlso: [
			{ label: "AI search engines compared", href: "/blog/best-ai-search-engine" },
		],
	},
	{
		slug: "google-ai-overviews",
		term: "Google AI Overviews",
		group: "Where AI answers appear",
		short:
			"AI-generated summaries Google shows above traditional results for many queries, built on its Gemini models.",
		body: [
			"AI Overviews sit at the top of the results page and answer the query directly, linking to a handful of sources. They reach an enormous share of searches, which makes them the surface most people encounter first.",
			"Appearing in them comes down to the same fundamentals as the rest of AEO: a clear direct answer, solid structure, topical authority, and a technically sound page that Google can crawl and trust.",
		],
		related: ["google-ai-mode", "answer-engine", "ai-citation"],
		seeAlso: [
			{ label: "How to show up in AI Overviews", href: "/ai-search/google-ai-overviews" },
		],
	},
	{
		slug: "google-ai-mode",
		term: "Google AI Mode",
		group: "Where AI answers appear",
		short:
			"Google's full conversational search experience, a dedicated AI answer surface separate from AI Overviews.",
		body: [
			"AI Mode is a chat-style version of Google search that handles follow-up questions and longer reasoning. It runs on Gemini, as do AI Overviews and the standalone Gemini app, though each surface behaves a little differently.",
			"Treat the three as related but distinct places your brand can appear. The levers that get you into one tend to help with the others.",
		],
		related: ["google-ai-overviews", "answer-engine"],
		seeAlso: [
			{ label: "How to show up in Gemini", href: "/ai-search/gemini" },
		],
	},
	{
		slug: "chatgpt-search",
		term: "ChatGPT Search",
		group: "Where AI answers appear",
		short:
			"ChatGPT's web-browsing mode, which retrieves live pages and cites them in its answers.",
		body: [
			"ChatGPT draws on two things: what it learned in training, and what it can fetch from the web when it browses. ChatGPT Search is the browsing path, and it is where fresh content and live citations come into play.",
			"That split is why a brand can be absent from the base model yet appear once the model searches. Tracking both modes gives you the full picture.",
		],
		related: ["ai-search-engine", "ai-citation", "answer-engine"],
		seeAlso: [
			{ label: "How to appear in ChatGPT", href: "/ai-search/chatgpt" },
		],
	},

	// --- What to measure -----------------------------------------------------
	{
		slug: "ai-citation",
		term: "AI citation",
		group: "What to measure",
		short:
			"A source link an AI answer attributes information to. The clearest signal that your content shaped the answer.",
		body: [
			"A citation is the model pointing at a page as the basis for something it said. It is stronger than a passing mention, because it can send a reader to your site and it confirms the model leaned on your content.",
			"You cannot edit the answer or see the index, but you can be the most relevant, well-structured, current, and trusted option for the questions that matter to you. Those are the factors engines weigh when they decide what to cite.",
		],
		related: ["brand-mention", "ai-search-engine", "grounding"],
		seeAlso: [{ label: "How to earn AI citations", href: "/blog/ai-citations" }],
	},
	{
		slug: "brand-mention",
		term: "Brand mention",
		group: "What to measure",
		short:
			"Any time an AI answer names your brand, whether or not it links to you.",
		body: [
			"A mention is the model saying your name. It builds awareness even without a link, and in answer engines that awareness often matters more than a click, because many searches end without one.",
			"Mentions and citations are worth tracking separately. You can be named without being cited, and cited without being named, and the gap between the two tells you where to focus.",
		],
		related: ["ai-citation", "share-of-voice", "ai-brand-sentiment"],
	},
	{
		slug: "share-of-voice",
		term: "Share of voice",
		group: "What to measure",
		short:
			"How often AI engines mention your brand versus competitors across a set of prompts.",
		body: [
			"Share of voice is the comparative metric, which is what makes it useful. A raw mention count tells you that you appeared. Share of voice tells you whether you are winning or losing the answer against specific rivals.",
			"If an engine names a competitor in eight of ten category questions and you in three, the problem is concrete and you can prioritize it. This is usually the most actionable number in AI visibility.",
		],
		related: ["brand-mention", "ai-visibility", "visibility-score"],
		seeAlso: [{ label: "AI share of voice", href: "/blog/ai-share-of-voice" }],
	},
	{
		slug: "prompt-volume",
		term: "Prompt volume",
		group: "What to measure",
		short:
			"The number of prompts an engine is queried with when tracking visibility. Tools often meter usage by it.",
		body: [
			"Prompt volume is roughly the AI-era equivalent of search volume, though it is harder to pin down. Broader coverage gives a more reliable read of your visibility.",
			"Relevance beats raw volume, though. Fifty prompts that match real buyer questions are worth more than a thousand generic ones, and they cost less to run.",
		],
		related: ["prompt-tracking", "ai-visibility"],
	},
	{
		slug: "prompt-tracking",
		term: "Prompt tracking",
		aka: ["Prompt monitoring", "Prompt set"],
		group: "What to measure",
		short:
			"Running a fixed set of prompts across AI engines on a schedule to monitor how your brand appears over time.",
		body: [
			"A prompt set is the defined list of questions you track, ideally the ones your buyers actually ask. Running it repeatedly turns noisy, one-off answers into a trend you can act on.",
			"Good sets mix buyer-intent questions, competitor comparisons, and broad category prompts. The point is to measure the same things consistently so a real change stands out from normal variation.",
		],
		related: ["prompt-volume", "ai-visibility", "share-of-voice"],
		seeAlso: [{ label: "AI prompt tracking", href: "/blog/ai-prompt-tracking" }],
	},
	{
		slug: "visibility-score",
		term: "AI visibility score",
		group: "What to measure",
		short:
			"An aggregate metric rolling mentions, citations, and competitor presence into a single number.",
		body: [
			"A visibility score compresses several signals into one figure so you can track direction at a glance. The exact formula varies by tool, which is precisely why how it is calculated matters.",
			"A score you cannot inspect is hard to trust or reproduce. Open methodology lets you see what went into the number, rather than taking a vendor's word for it.",
		],
		related: ["ai-visibility", "share-of-voice"],
	},
	{
		slug: "ai-brand-sentiment",
		term: "AI brand sentiment",
		group: "What to measure",
		short:
			"How AI engines characterize your brand, not just whether they mention it.",
		body: [
			"Sentiment is the tone and framing of what the model says about you. An engine can mention your brand accurately, vaguely, or wrongly, and the difference shapes what a buyer takes away.",
			"Inaccuracies creep in through stale information, hallucinations, and skew when the loudest sources are not the most accurate. The result is a view of your brand you did not author, which is worth watching and correcting.",
		],
		related: ["brand-mention", "hallucination"],
		seeAlso: [{ label: "AI brand sentiment", href: "/blog/ai-brand-sentiment" }],
	},

	// --- How engines work ----------------------------------------------------
	{
		slug: "entity",
		term: "Entity",
		group: "How engines work",
		short:
			"A distinct thing a model recognizes, such as a company, product, or person, along with what it knows about it.",
		body: [
			"Models reason in terms of entities, not just keywords. Your brand is an entity, and the clearer and more consistent the information about it across the web, the more confidently a model can describe and recommend you.",
			"Clean, consistent naming, structured data, and corroborating mentions on trusted sources all help an engine resolve who you are and what you do.",
		],
		related: ["knowledge-graph", "structured-data", "grounding"],
	},
	{
		slug: "structured-data",
		term: "Structured data",
		aka: ["Schema markup"],
		group: "How engines work",
		short:
			"Machine-readable markup that labels what content is, helping engines extract and trust it.",
		body: [
			"Structured data, usually schema.org markup in JSON-LD, tells a machine that a block of text is an FAQ, a product, an article, or an organization. That makes your content easier to parse and quote.",
			"It does not guarantee a citation, but it removes ambiguity. When an engine can cleanly extract a fact, it is likelier to use it.",
		],
		related: ["entity", "llms-txt"],
		seeAlso: [
			{ label: "Structured data for AI search", href: "/blog/structured-data-for-ai-search" },
		],
	},
	{
		slug: "llms-txt",
		term: "llms.txt",
		group: "How engines work",
		short:
			"A proposed plain-text file that points AI crawlers to your most important content in Markdown.",
		body: [
			"The llms.txt convention is a simple file at your domain root that lists key pages, often with Markdown versions that are easy for models to read. Adoption is inconsistent and its impact is debated.",
			"The honest read is that the downside is low and the upside is uncertain. It is cheap to add, so most sites may as well, while keeping expectations modest.",
		],
		related: ["structured-data", "ai-crawler"],
		seeAlso: [
			{ label: "Do llms.txt files matter?", href: "/blog/do-llms-txt-files-matter-for-aeo" },
		],
	},
	{
		slug: "retrieval-augmented-generation",
		term: "Retrieval-augmented generation",
		aka: ["RAG"],
		group: "How engines work",
		short:
			"A method where a model fetches relevant documents at answer time and writes from them.",
		body: [
			"RAG is why a model can answer questions about events after its training cutoff, and why fresh, well-structured content can show up in answers quickly. The engine retrieves sources, then generates a response grounded in them.",
			"It also explains the leverage AEO has. If you are among the documents retrieved for a query, you can influence the answer, even though you never see the index.",
		],
		related: ["grounding", "ai-citation", "semantic-search"],
	},
	{
		slug: "grounding",
		term: "Grounding",
		group: "How engines work",
		short:
			"Tying a model's answer to specific sources so claims can be traced and checked.",
		body: [
			"A grounded answer is one backed by retrieved documents rather than the model's memory alone. Grounding is what makes citations possible and reduces, though does not eliminate, made-up details.",
			"For brands, grounding is the opening. Be a clear, trustworthy source on your topic and you become something the model can ground its answer in.",
		],
		related: ["retrieval-augmented-generation", "ai-citation", "hallucination"],
	},
	{
		slug: "hallucination",
		term: "Hallucination",
		group: "How engines work",
		short:
			"When a model states something false or invented with the same confidence as a fact.",
		body: [
			"Hallucinations happen because models predict plausible text, not verified truth. Applied to your brand, that can mean a wrong price, a feature you do not offer, or a confident claim with no basis.",
			"Grounding and good source material reduce the risk. Monitoring matters too, since the only way to catch a hallucination about your brand is to look for it.",
		],
		related: ["grounding", "ai-brand-sentiment"],
	},
	{
		slug: "ai-crawler",
		term: "AI crawler",
		group: "How engines work",
		short:
			"A bot that fetches web pages for AI training or live retrieval, such as GPTBot or PerplexityBot.",
		body: [
			"AI crawlers are how engines read your site, whether to train on it or to retrieve it at answer time. If your important pages are blocked or slow, you make yourself harder to cite.",
			"Some tools track these visits as a signal of AI interest in your content. At minimum, make sure your robots rules do not accidentally shut the door on engines you want to reach.",
		],
		related: ["llms-txt", "retrieval-augmented-generation"],
	},
	{
		slug: "zero-click-search",
		term: "Zero-click search",
		group: "How engines work",
		short:
			"A search that ends without a click because the answer appears directly on the results surface.",
		body: [
			"Zero-click searches were already common with featured snippets. AI Overviews and answer engines push the share higher by resolving the question in place.",
			"This is the strategic reason AEO matters. If buyers read an answer and never click, being named in that answer is the visibility that counts.",
		],
		related: ["google-ai-overviews", "brand-mention"],
	},
	{
		slug: "knowledge-graph",
		term: "Knowledge graph",
		group: "How engines work",
		short:
			"A structured map of entities and the relationships between them that engines use to ground answers.",
		body: [
			"A knowledge graph records that a company makes a product, is based somewhere, and competes with others, as connected facts rather than loose text. Engines lean on these maps to answer entity questions confidently.",
			"Consistent information about your brand across the web, plus clear structured data, helps engines place you correctly in their graph.",
		],
		related: ["entity", "structured-data"],
	},
	{
		slug: "semantic-search",
		term: "Semantic search",
		group: "How engines work",
		short:
			"Search that matches on meaning rather than exact keywords, usually via embeddings.",
		body: [
			"Semantic search compares the meaning of a query and a document, so a page can match a question even when it shares few of the same words. It is the retrieval style behind most AI answer engines.",
			"The practical takeaway is to write for the question, not the keyword. Cover the topic clearly and you become findable across the many ways people phrase the same intent.",
		],
		related: ["embedding", "retrieval-augmented-generation"],
	},
	{
		slug: "embedding",
		term: "Embedding",
		group: "How engines work",
		short:
			"A numeric representation of text that lets a model compare meaning and find related content.",
		body: [
			"An embedding turns a piece of text into a vector, a list of numbers, so that similar meanings sit close together. Engines use embeddings to retrieve the documents most relevant to a query.",
			"You do not optimize embeddings directly. You optimize the content behind them: clear, focused, well-organized text that captures a topic cleanly.",
		],
		related: ["semantic-search", "retrieval-augmented-generation"],
	},
	{
		slug: "large-language-model",
		term: "Large language model",
		aka: ["LLM"],
		group: "How engines work",
		short:
			"The kind of AI model behind answer engines, trained on large text corpora to predict and generate language.",
		body: [
			"A large language model generates text by predicting what comes next, one token at a time, based on patterns learned from training data. ChatGPT, Claude, Gemini, and Grok are all built on LLMs.",
			"On their own, LLMs answer from training and can go stale or invent details. Paired with retrieval, they can ground answers in current sources, which is the setup most answer engines now use.",
		],
		related: ["llmo", "retrieval-augmented-generation", "hallucination"],
	},
];

export function getGlossaryTerm(slug: string): GlossaryTerm | undefined {
	return glossaryTerms.find((t) => t.slug === slug);
}
