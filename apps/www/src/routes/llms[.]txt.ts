import { createFileRoute } from "@tanstack/react-router";

// Curated llms.txt for the marketing site, following the llmstxt.org convention:
// an H1, a one-paragraph summary, a short positioning blurb, then sections of
// annotated links. The full text of the documentation lives at /llms-full.txt.
const llmsTxt = `# Getcito

> Getcito is an open source, self-hosted AI visibility platform. Track how AI answer engines like ChatGPT, Google AI Overviews, Perplexity, Gemini, Copilot, and Grok talk about your brand — monitor mentions, analyze citations, and benchmark competitors. Because Getcito is open source and runs on your own infrastructure, your data stays yours and you're never locked in.

Getcito is Answer Engine Optimization (AEO), also called generative engine optimization (GEO), without the black box. On a schedule, it runs your prompts across every major AI answer engine, then measures how often your brand appears, which competitors show up alongside it, and which sources the models cite. The methodology is documented and every line of code is open, so each number is something you can independently verify. Getcito is built by Blue Whale Software, LLC — bootstrapped, transparent, and priced so AI visibility data is a commodity rather than a luxury. Self-host it for free, explore the live demo, or get in touch about managed cloud hosting and white-label deployments.

## Product

- [Getcito](https://www.Getcitohq.com/): Know how AI talks about your brand — track visibility across any AI model, monitor mentions, analyze citations, and benchmark competitors.
- [Features](https://www.Getcitohq.com/features): Visibility dashboard, per-prompt and per-model tracking, citation analysis, competitor intelligence, prompt management, response deep-dives, and long-term trends.
- [Pricing](https://www.Getcitohq.com/pricing): Free and open source to self-host, managed cloud hosting coming soon, and white-label available for agencies.
- [Live Demo](https://demo.Getcitohq.com): Explore a fully populated Getcito instance — no installation required.
- [Vision](https://www.Getcitohq.com/vision): Why we believe AI visibility monitoring should be affordable, transparent, and built to last.

## Documentation

- [Documentation](https://www.Getcitohq.com/docs.md): Introduction to Getcito, the open source AI visibility platform.
- [Quick Start](https://www.Getcitohq.com/docs/getting-started.md): Get Getcito running on your own infrastructure in under 5 minutes using the CLI.
- [User Guide](https://www.Getcitohq.com/docs/user-guide.md): A complete walkthrough, from first login to daily visibility tracking, prompts, citations, competitors, and reports.
- [Developer Guide](https://www.Getcitohq.com/docs/developer-guide.md): Run, configure, integrate with, and contribute to Getcito, including architecture and self-hosting setup.
- [API Reference](https://www.Getcitohq.com/docs/api.md): Complete REST API documentation for Getcito's administrative API.
- [llms-full.txt](https://www.Getcitohq.com/llms-full.txt): The full text of all Getcito documentation in a single file.

## Resources

- [AI Visibility Tool Directory](https://www.Getcitohq.com/ai-visibility-tools): Compare 100+ AI visibility and Answer Engine Optimization tools, with a feature matrix, pricing, and head-to-head comparisons with Getcito.
- [Changelog](https://www.Getcitohq.com/changelog): Recent releases, improvements, and bug fixes.
- [Roadmap](https://www.Getcitohq.com/roadmap): What's coming next, prioritized in the open on GitHub.
- [Provider Status](https://www.Getcitohq.com/status): Real-time status and performance monitoring for AI answer engine integrations.
- [Brand Assets](https://www.Getcitohq.com/brand): Download Getcito logos, icons, and brand guidelines.

## Open Source

- [GitHub Repository](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool): Source code for Getcito — self-host it, read every line, and contribute.
- [Issues](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues): Report bugs, request features, and help shape the roadmap.
- [Discord Community](https://discord.gg/s24nubCtKz): Get help and connect with the Getcito community.

## Optional

- [X / Twitter](https://x.com/tryGetcito): Product updates and AI visibility insights.
- [LinkedIn](https://linkedin.com/company/Getcitohq): Company updates from Getcito.
- [Blue Whale Software](https://bluewhale.dev?ref=Getcito): The team building Getcito.

---

If you find Getcito useful, please consider starring the repository on GitHub — it helps others discover the project: https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool
`;

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET() {
				return new Response(llmsTxt, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				});
			},
		},
	},
});
