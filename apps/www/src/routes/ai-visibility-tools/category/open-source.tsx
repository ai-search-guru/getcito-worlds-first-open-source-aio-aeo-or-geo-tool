import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { ToolGrid } from "@/components/tool-list";
import {
	DirectoryBackLink,
	DirectoryHero,
	DirectorySection,
	GetcitoCta,
} from "@/components/directory-shell";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	faqJsonLd,
	itemListJsonLd,
} from "@/lib/seo";
import type { FaqItem } from "@/lib/faqs";
import { openSourceTools } from "@/lib/competitors";

const title = "Open-Source AI Visibility Tools · Getcito";
const description =
	"The open-source AI visibility tools you can self-host, the DIY alternatives, and how they stack up against managed tools. An honest look at a small, early space.";
const path = "/ai-visibility-tools/category/open-source";

const lead =
	"Open-source AI visibility tools let you self-host your brand tracking and read the exact code behind every metric. It is a small, early space: Getcito is the most complete option, with a handful of smaller projects alongside it. If none fit, you can also script your own checks against the AI model APIs.";

const FAQS: FaqItem[] = [
	{
		question: "Is there an open-source AI visibility tracker?",
		answer:
			"Yes. Getcito is an open-source AI visibility platform released under the MIT license, and you can self-host it for free. A few smaller open-source projects exist too, though the space is still early. For anything they don't cover, you can script your own checks against the AI model APIs.",
	},
	{
		question: "Can I build my own AI visibility tool?",
		answer:
			"You can. The core loop is straightforward: send your prompts to the model APIs, directly or through a router like OpenRouter, parse each answer for brand mentions and citations, and log the results over time. The work is in maintaining it, covering enough engines, and running it at scale, which is what a finished tool handles for you.",
	},
	{
		question: "What is the best DIY way to track AI mentions?",
		answer:
			"Define a small set of the questions your buyers ask, run them across the engines you care about on a schedule, and record whether each answer mentions or cites you. You can do this by hand for a quick read or script it against the provider APIs. Self-hosting Getcito gives you the same loop without building it yourself.",
	},
	{
		question: "Is Getcito really open source?",
		answer:
			"Yes. Every line of Getcito is open source under the MIT license and available on GitHub. You can read exactly how each metric is collected and computed, self-host it on your own infrastructure for free, and export your data at any time.",
	},
];

const TRADEOFFS: { dimension: string; oss: string; managed: string }[] = [
	{
		dimension: "Cost",
		oss: "No license fee. You pay for infrastructure and AI provider API usage.",
		managed: "A subscription, often metered by prompt or seat.",
	},
	{
		dimension: "Setup",
		oss: "You deploy and maintain it yourself.",
		managed: "Sign up and start tracking.",
	},
	{
		dimension: "Transparency",
		oss: "Read the code and verify how every metric is built.",
		managed: "The scoring is usually a black box.",
	},
	{
		dimension: "Data ownership",
		oss: "Prompts and history stay on your infrastructure.",
		managed: "Your data lives in the vendor's dashboard.",
	},
	{
		dimension: "Coverage and upkeep",
		oss: "On you, or the project's maintainers.",
		managed: "The vendor handles engine coverage and updates.",
	},
];

export const Route = createFileRoute(
	"/ai-visibility-tools/category/open-source",
)({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path }),
		],
		links: [{ rel: "canonical", href: canonicalUrl(path) }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
				{ name: "Open-source AI visibility tools", path },
			]),
			faqJsonLd(FAQS),
			itemListJsonLd(
				openSourceTools().map((c) => ({
					name: c.name,
					url: c.url,
					description: c.tagline,
				})),
			),
		],
	}),
	component: OpenSourcePage,
});

function OpenSourcePage() {
	const tools = openSourceTools();
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Open source"
					title="Open-source AI visibility tools"
					lead={lead}
				/>

				<DirectorySection title="Why open source matters here">
					<div className="max-w-3xl space-y-5 leading-relaxed text-zinc-600">
						<p>
							Most AI visibility tools are closed and hosted. You send them your
							prompts, and you trust the score they hand back. Open source changes
							both halves of that deal. You can read how a metric is built, and
							you can run the whole thing on your own infrastructure, so your
							prompts and history never leave your environment.
						</p>
						<p>
							For a number that might land in a board report or shape a content
							budget, being able to audit it matters. So does owning your data
							outright, with no vendor holding your visibility history and nothing
							to migrate off if you decide to leave.
						</p>
					</div>
				</DirectorySection>

				<DirectorySection title="The open-source options">
					<p className="mb-6 max-w-3xl leading-relaxed text-zinc-600">
						The honest picture is that this is a thin, early space. Getcito is the
						most complete open-source option, released under the MIT license with
						broad engine coverage. The other open-source projects we track are
						below. They are smaller and earlier, but they are real and worth
						knowing about.
					</p>
					{tools.length > 0 ? (
						<ToolGrid competitors={tools} />
					) : (
						<p className="text-sm text-zinc-500">
							No other open-source trackers currently meet our bar.
						</p>
					)}
				</DirectorySection>

				<DirectorySection title="Build it yourself: scripting AI visibility checks">
					<div className="max-w-3xl space-y-5 leading-relaxed text-zinc-600">
						<p>
							If no existing tool fits, the underlying job is not complicated to
							script. Send your prompts to the model APIs, directly or through a
							router like OpenRouter, then parse each response for your brand name
							and any links back to your site. Store the results and repeat on a
							schedule, because a single run is a snapshot and answers shift over
							time.
						</p>
						<p>
							The catch is everything around that loop. You have to cover enough
							engines, handle the ones without clean APIs, keep it running, and
							build some way to actually read the output. That upkeep is most of
							what you pay for when you buy a tool, or skip by self-hosting one
							that already does it.
						</p>
					</div>
				</DirectorySection>

				<DirectorySection title="Open source vs managed: the real tradeoffs">
					<p className="mb-6 max-w-3xl leading-relaxed text-zinc-600">
						Neither path is free of cost. Self-hosting trades a subscription for
						your own setup and infrastructure. A managed tool trades transparency
						and control for someone else doing the work.
					</p>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-200">
									<th className="py-3 pr-4 text-left font-semibold text-zinc-950">
										&nbsp;
									</th>
									<th className="px-4 py-3 text-left font-semibold text-zinc-950">
										Open source, self-hosted
									</th>
									<th className="px-4 py-3 text-left font-semibold text-zinc-950">
										Managed, paid
									</th>
								</tr>
							</thead>
							<tbody>
								{TRADEOFFS.map((row) => (
									<tr
										key={row.dimension}
										className="border-b border-dashed border-zinc-200 last:border-solid align-top"
									>
										<td className="py-3 pr-4 font-medium text-zinc-700">
											{row.dimension}
										</td>
										<td className="px-4 py-3 text-zinc-600">{row.oss}</td>
										<td className="px-4 py-3 text-zinc-600">{row.managed}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</DirectorySection>

				<Faq items={FAQS} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
