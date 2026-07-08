export interface AiSearchEngine {
	slug: string;
	name: string;
	vendor: string;
	/** One-sentence summary, used on the index, in meta, and in JSON-LD. */
	short: string;
	/** What it is and how it chooses sources, one entry per paragraph. */
	intro: string[];
	/** Steps to improve your odds of appearing. Emitted as HowTo JSON-LD. */
	steps: { name: string; text: string }[];
	/** How Getcito tracks this engine. */
	tracking: string;
	related?: string[];
}

export const aiSearchEngines: AiSearchEngine[] = [
	{
		slug: "chatgpt",
		name: "ChatGPT",
		vendor: "OpenAI",
		short:
			"Get your brand mentioned and cited in ChatGPT, across both its base model and its live web search.",
		intro: [
			"ChatGPT answers from two places: what it learned during training, and what it fetches from the web when it browses. The base model reflects how your brand was described across the internet up to its training cutoff. ChatGPT Search, the browsing path, pulls in current pages and cites them.",
			"That split is the key to working with it. A brand can be missing from the base model yet show up once ChatGPT searches, and the fixes for each are different. Earning durable mentions on trusted sources shapes the trained view, while clear, current, well-structured pages help you get retrieved and cited live.",
		],
		steps: [
			{
				name: "Be a clear source on your topic",
				text: "Publish content that answers the questions in your category directly and in plain language, so a model can lift a clean, correct statement about you.",
			},
			{
				name: "Earn mentions on sources ChatGPT trusts",
				text: "Coverage, reviews, and references on reputable third-party sites shape how the trained model describes your brand. Independent corroboration matters more than your own claims.",
			},
			{
				name: "Structure pages for extraction",
				text: "Use descriptive headings, short direct answers near the top, and schema markup so the key facts are easy to parse and quote.",
			},
			{
				name: "Keep important pages current",
				text: "Browsing favors fresh, accurate pages. Stale prices, dates, or feature lists invite wrong answers, so keep your core pages up to date.",
			},
			{
				name: "Track both modes over time",
				text: "Check how ChatGPT describes you with and without browsing, on a consistent set of prompts, because answers vary between runs.",
			},
		],
		tracking:
			"Getcito runs your prompts through ChatGPT on a schedule and records whether it mentions your brand, cites your site, and how it frames you. Tracking the same prompts repeatedly turns noisy one-off answers into a trend you can act on.",
		related: ["perplexity", "google-ai-overviews", "claude"],
	},
	{
		slug: "perplexity",
		name: "Perplexity",
		vendor: "Perplexity AI",
		short:
			"Become a cited source in Perplexity, the AI search engine that shows its citations on every answer.",
		intro: [
			"Perplexity is a retrieval-augmented engine: it searches the web for each query, then writes an answer grounded in what it found and links the sources. Because it shows its citations openly, it is the clearest testbed for measuring whether your AEO work is paying off.",
			"It selects sources on a few factors: relevance to the exact question, how easy the answer is to extract from your page, how trustworthy the domain looks, and how current the content is. Win on those and you become one of the cited links.",
		],
		steps: [
			{
				name: "Answer the specific question",
				text: "Perplexity rewards pages that address a precise query head-on. Match the questions your buyers ask and answer them in the first paragraph.",
			},
			{
				name: "Make the answer easy to extract",
				text: "Lead with the direct answer, then expand. Clear headings, short paragraphs, and lists give the engine a clean span to quote.",
			},
			{
				name: "Build domain trust",
				text: "Citations skew toward sources the engine considers authoritative. Depth on your topic and references from respected sites both help.",
			},
			{
				name: "Keep content fresh",
				text: "Perplexity leans current. Updating cornerstone pages and publishing on live topics improves your odds of being pulled in.",
			},
			{
				name: "Measure which prompts cite you",
				text: "Track a consistent prompt set and watch which queries cite you and which cite a competitor. The gaps are your roadmap.",
			},
		],
		tracking:
			"Getcito queries Perplexity with your prompts and logs every citation and mention, so you can see exactly which pages get pulled into answers and where rivals are winning the citation instead.",
		related: ["chatgpt", "claude", "google-ai-overviews"],
	},
	{
		slug: "google-ai-overviews",
		name: "Google AI Overviews",
		vendor: "Google",
		short:
			"Appear in the AI-generated summaries Google shows above its search results for many queries.",
		intro: [
			"AI Overviews are Google's AI summaries, built on its Gemini models, shown at the top of the results page for a growing share of queries. They answer directly and link to a few sources. Their reach is the story: they sit on the surface most people search first.",
			"They affect traffic in two directions. They lift zero-click answers, but a citation in an Overview can still send qualified visitors. The way in is the same set of fundamentals that drive the rest of AI search, applied to the page Google already crawls.",
		],
		steps: [
			{
				name: "Answer the query directly",
				text: "Put a clear, self-contained answer near the top of the page. Overviews favor content that resolves the question without hedging.",
			},
			{
				name: "Earn topical authority",
				text: "Google still leans on its existing signals. Depth across a topic and a trusted domain make you a likelier source for the summary.",
			},
			{
				name: "Add structured data",
				text: "Schema for FAQs, articles, products, and your organization helps Google extract and trust the facts on your page.",
			},
			{
				name: "Keep technical SEO sound",
				text: "If Google cannot crawl, render, or index a page well, it cannot summarize it. The basics still gate everything.",
			},
			{
				name: "Refresh on a cadence",
				text: "Overviews favor current information. Revisit cornerstone pages so prices, dates, and claims stay accurate.",
			},
		],
		tracking:
			"Getcito tracks whether your brand appears in Google AI Overviews for your prompts, which sources are cited alongside or instead of you, and how that changes over time.",
		related: ["gemini", "chatgpt", "perplexity"],
	},
	{
		slug: "gemini",
		name: "Google Gemini",
		vendor: "Google",
		short:
			"Show up in Google's Gemini app and AI Mode, the conversational surfaces powered by its Gemini models.",
		intro: [
			"Gemini is both a model family and a set of products. The Gemini app and Google's AI Mode are conversational search surfaces that handle follow-up questions and longer reasoning, while AI Overviews are the summary surface on the results page. All three run on Gemini, and they behave a little differently.",
			"Because these are Google surfaces, your existing search footprint carries weight. Strong fundamentals, clear answers, and topical authority all transfer. Google's AI features also change often, so treat the specifics as current and evolving.",
		],
		steps: [
			{
				name: "Get the SEO foundation right",
				text: "Crawlable, well-structured pages with clear topical focus are the base. Gemini surfaces lean on the signals Google already understands.",
			},
			{
				name: "Provide direct, quotable answers",
				text: "Lead each page with a concise answer to the question it targets, then add the supporting depth beneath it.",
			},
			{
				name: "Demonstrate authority and depth",
				text: "Cover your topic thoroughly and earn references from trusted sources, so the model is confident citing you.",
			},
			{
				name: "Keep content current",
				text: "Conversational surfaces pull in fresh information. Maintain your cornerstone pages so answers about you stay accurate.",
			},
			{
				name: "Track across surfaces",
				text: "Monitor the Gemini app, AI Mode, and AI Overviews separately, since the same query can return different answers on each.",
			},
		],
		tracking:
			"Getcito runs your prompts through Google's Gemini-powered surfaces and records how your brand is mentioned and cited, so you can tell where you appear and where you are missing.",
		related: ["google-ai-overviews", "chatgpt"],
	},
	{
		slug: "claude",
		name: "Claude",
		vendor: "Anthropic",
		short:
			"Track how Claude describes and cites your brand, including when it searches the web for an answer.",
		intro: [
			"Claude, from Anthropic, answers from training and can also search the web and cite sources when a question calls for current information. It is widely used directly and inside other products, which makes how it describes your brand worth watching.",
			"Claude tends to favor careful, well-sourced content and is cautious about unsupported claims. Clear, accurate, well-structured pages give it something solid to ground an answer in, both when it relies on training and when it browses.",
		],
		steps: [
			{
				name: "Publish accurate, specific content",
				text: "Claude leans toward well-supported statements. Precise, correct pages about your brand and category give it a reliable basis to quote.",
			},
			{
				name: "Structure for clean extraction",
				text: "Descriptive headings, direct answers, and schema make the important facts easy to lift without ambiguity.",
			},
			{
				name: "Earn trusted third-party mentions",
				text: "Corroboration on reputable sources shapes how Claude characterizes you, the same way it does with other models.",
			},
			{
				name: "Keep key pages current",
				text: "When Claude searches, fresh and accurate pages are likelier to be used and cited. Avoid stale facts on cornerstone pages.",
			},
			{
				name: "Monitor how it frames you",
				text: "Track Claude on a consistent prompt set to catch inaccurate or out-of-date descriptions before buyers see them.",
			},
		],
		tracking:
			"Getcito queries Claude with your prompts and records its mentions, citations, and framing of your brand, so an inaccurate or stale description does not go unnoticed.",
		related: ["chatgpt", "perplexity"],
	},
	{
		slug: "copilot",
		name: "Microsoft Copilot",
		vendor: "Microsoft",
		short:
			"Appear in Microsoft Copilot, which pairs OpenAI models with Bing's web index to answer and cite.",
		intro: [
			"Copilot is Microsoft's assistant, built on OpenAI models and grounded in Bing's search index. When it answers a question that needs live information, it retrieves from Bing and cites sources, so your presence in Bing's index feeds directly into Copilot.",
			"That makes Bing fundamentals unusually relevant here. The general AEO playbook applies, but making sure Bing can crawl, index, and trust your pages is the specific lever that pays off in Copilot.",
		],
		steps: [
			{
				name: "Make sure Bing indexes you well",
				text: "Verify your site in Bing Webmaster Tools and confirm your important pages are crawled and indexed, since Copilot retrieves from Bing.",
			},
			{
				name: "Answer questions directly",
				text: "Lead with a clear answer to the query, then add support. Copilot favors extractable, self-contained responses.",
			},
			{
				name: "Add structured data",
				text: "Schema markup helps Bing and Copilot parse and trust the facts on your page.",
			},
			{
				name: "Build authority and freshness",
				text: "Depth on your topic and current content improve both your Bing ranking and your odds of being cited in Copilot.",
			},
			{
				name: "Track Copilot answers",
				text: "Monitor how Copilot mentions and cites your brand on a consistent set of prompts to spot gaps.",
			},
		],
		tracking:
			"Getcito tracks how Microsoft Copilot mentions and cites your brand across your prompts, so you can see the payoff from Bing-side improvements over time.",
		related: ["chatgpt", "google-ai-overviews"],
	},
	{
		slug: "grok",
		name: "Grok",
		vendor: "xAI",
		short:
			"Track your brand in Grok, xAI's assistant integrated with X and tuned for real-time information.",
		intro: [
			"Grok is xAI's assistant, built into X and oriented toward real-time answers. It draws on the open web and leans heavily on activity from X itself, which gives social presence more weight here than on most other engines.",
			"The core AEO fundamentals still apply: clear, trustworthy, well-structured content that engines can retrieve and cite. The wrinkle with Grok is that what people say about you on X can meaningfully shape its answers.",
		],
		steps: [
			{
				name: "Maintain an active, accurate presence on X",
				text: "Because Grok leans on X, an up-to-date profile and accurate conversation about your brand there feed directly into its answers.",
			},
			{
				name: "Publish clear, current web content",
				text: "Grok favors real-time information. Keep your cornerstone pages accurate and lead with direct answers.",
			},
			{
				name: "Earn trusted mentions",
				text: "References on reputable sources and credible discussion shape how Grok characterizes your brand.",
			},
			{
				name: "Structure for extraction",
				text: "Headings, concise answers, and schema make your facts easy to quote correctly.",
			},
			{
				name: "Monitor for accuracy",
				text: "Real-time engines can amplify whatever is loudest. Track Grok so you can correct an inaccurate take quickly.",
			},
		],
		tracking:
			"Getcito runs your prompts through Grok and records its mentions, citations, and framing, so you can monitor a fast-moving, social-driven surface alongside the rest.",
		related: ["chatgpt", "perplexity"],
	},
];

export function getAiSearchEngine(slug: string): AiSearchEngine | undefined {
	return aiSearchEngines.find((e) => e.slug === slug);
}
