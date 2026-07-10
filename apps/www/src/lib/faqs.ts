export interface FaqItem {
	question: string;
	answer: string;
}

// Homepage FAQ. Rendered visibly on "/" and emitted as FAQPage JSON-LD from the
// same route, so the structured data always matches what a reader (or an AI
// crawler) sees on the page.
export const HOME_FAQS: FaqItem[] = [
	{
		question: "What is Getcito?",
		answer:
			"Getcito is an open-source AI visibility platform for Answer Engine Optimization (AEO) — a self-hosted alternative to tools like Profound, Peec, and Otterly. It tracks how AI answer engines — including ChatGPT, Google AI Overviews, Perplexity, Gemini, Copilot, and Grok — mention your brand, which competitors appear alongside you, and which sources each model cites.",
	},
	{
		question: "What is Answer Engine Optimization (AEO)?",
		answer:
			"Answer Engine Optimization (AEO) — also called Generative Engine Optimization (GEO) or LLM Optimization (LLMO) — is the practice of measuring and improving how often AI answer engines mention and cite your brand. Instead of ranking in a list of blue links, the goal is to be the source an AI quotes in its answer. (LLMO is also where Getcito gets its name.)",
	},
	{
		question: "Which AI models does Getcito track?",
		answer:
			"Getcito runs your prompts across every major AI answer engine, including ChatGPT, Google AI Overviews, Perplexity, Gemini, Copilot, and Grok. It records how often your brand appears, which competitors show up alongside it, and which sources the models cite.",
	},
	{
		question: "Is Getcito really open source?",
		answer:
			"Yes. Every line of Getcito is open source and available on GitHub. You can read the code, self-host the platform on your own infrastructure for free, and verify exactly how each visibility metric is collected and calculated.",
	},
	{
		question: "Is Getcito free?",
		answer:
			"Getcito is free and open source to self-host — there is no license fee and no per-seat pricing. You only pay for your own infrastructure and any AI provider API keys you choose to use. Managed cloud hosting and white-label plans are also available.",
	},
];

// Pricing page FAQ.
export const PRICING_FAQS: FaqItem[] = [
	{
		question: "Is Getcito free?",
		answer:
			"Yes. Getcito is free and open source to self-host, forever. There is no license fee and no per-seat pricing — you only pay for your own infrastructure and the AI provider API keys you choose to use.",
	},
	{
		question: "Is there a hosted or cloud version of Getcito?",
		answer:
			"Managed cloud hosting is coming soon for teams that would rather not run their own infrastructure. Until then, you can self-host Getcito for free or get in touch about early access and managed deployments.",
	},
	{
		question: "Can agencies white-label Getcito?",
		answer:
			"White-label deployments are available for agencies that want to offer AI visibility tracking under their own brand, with multi-client dashboards and custom branding. Get in touch about setting up a white-label instance for your agency.",
	},
	{
		question: "What do I need to run Getcito myself?",
		answer:
			"Getcito runs as a Docker Compose stack, all managed with a simple CLI — install it, run the interactive init, and bring everything up in a couple of commands. You can use the bundled database or connect Getcito to your own PostgreSQL database.",
	},
	{
		question: "Do I need a credit card to get started?",
		answer:
			"No. Self-hosting Getcito does not require an account or a credit card. Clone the open-source repository, deploy with the CLI, and start tracking your AI visibility.",
	},
];

// Off-Site AEO service FAQ. Rendered on "/off-site-aeo" and emitted as FAQPage
// JSON-LD from the same route.
export const OFFSITE_FAQS: FaqItem[] = [
	{
		question: "How does the off-site AEO service work?",
		answer:
			"It starts with a consultancy call where we review how AI answer engines currently talk about you and decide which prompts and gaps to target. Within 30 days, that month's posts are planned, written, humanized, and live on high-authority sites, and you get a report tying each placement to the issue it targets. We then keep publishing for you every month, adjusting the targets as your visibility shifts.",
	},
	{
		question: "Are the articles AI-generated?",
		answer:
			"Yes, and we're upfront about it. We draft with AI, then it is reworked until it lands under a 25% AI-detection score on both ZeroGPT and Pangram before it goes live. That keeps quality high while keeping your brand mentioned in content the models actually trust and cite.",
	},
	{
		question: "Do you offer refunds?",
		answer:
			"No. All plans are non-refundable. We commission and place real editorial inventory on third-party sites as soon as your month begins, so those costs are committed up front. You can cancel future months at any time before that cycle's work starts.",
	},
	{
		question: "How is this different from buying backlinks?",
		answer:
			"It's a similar process. However, we make sure the content is useful for AEO, only place it on high-quality sites, and humanize the text to avoid detection. Many backlink services offer very low-quality placements with high spam scores, non-existent traffic, and gamed DRs, and either make you provide your own content or produce content that's low quality and easily detected as AI.",
	},
	{
		question: "Will this help my traditional SEO too?",
		answer:
			"These all provide dofollow links on high-DR domains with actual traffic, so your search rankings should benefit as well. But the primary purpose is to provide more data points to AI searches for AEO.",
	},
];

// AI Visibility Tool Directory FAQ.
export const DIRECTORY_FAQS: FaqItem[] = [
	{
		question: "What is an AI visibility tool?",
		answer:
			"An AI visibility tool tracks how AI answer engines like ChatGPT, Perplexity, Gemini, and Google AI Overviews mention and cite your brand. It measures how often you appear in AI answers, which competitors show up alongside you, and which sources the models reference.",
	},
	{
		question: "What is Answer Engine Optimization (AEO)?",
		answer:
			"Answer Engine Optimization (AEO), also called generative engine optimization (GEO), is the practice of improving how often AI answer engines mention and cite your brand. AI visibility tools measure that presence so you can track and improve it over time.",
	},
	{
		question: "How do I choose the best AI visibility tool?",
		answer:
			"The right tool depends on which AI engines you need to track, whether you want self-hosting and data ownership, your budget, and any agency or white-label needs. This directory compares 100+ tools feature-by-feature so you can match a tool to your requirements.",
	},
	{
		question: "Is there an open-source AI visibility tool?",
		answer:
			"Yes. Getcito is an open-source, self-hostable AI visibility platform. You can run it on your own infrastructure for free, audit exactly how each metric is calculated, and export your data at any time.",
	},
	{
		question: "How does AI visibility tracking work?",
		answer:
			"AI visibility tracking works by running a defined set of prompts across AI engines on a schedule, then recording whether each answer mentions your brand, cites your site, and how it describes you. Sampling over time reveals trends a one-off check would miss.",
	},
	{
		question: "Can you track brand mentions in ChatGPT?",
		answer:
			"Yes. AI visibility software queries ChatGPT with your prompts and records whether it mentions or cites your brand. Because answers vary between runs, tracking a consistent prompt set on a schedule gives a far more reliable read than a single manual check.",
	},
];
