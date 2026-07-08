import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	itemListJsonLd,
} from "@/lib/seo";
import { aeoVerticals } from "@/data/aeo-verticals";

const title = "Answer Engine Optimization by Industry · Getcito";
const description =
	"How answer engine optimization applies to your world: AEO for agencies, SaaS, e-commerce, B2B, startups, enterprise, healthcare, and financial services.";

export const Route = createFileRoute("/aeo-for/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/aeo-for" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/aeo-for") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AEO by industry", path: "/aeo-for" },
			]),
			itemListJsonLd(
				aeoVerticals.map((v) => ({
					name: `AEO for ${v.audience}`,
					path: `/aeo-for/${v.slug}`,
				})),
			),
		],
	}),
	component: AeoForIndex,
});

function AeoForIndex() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<section className="border-b border-zinc-200 bg-white py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ AEO by industry
						</p>
						<h1 className="font-heading mt-2 text-4xl text-balance text-zinc-950 md:text-5xl">
							Answer engine optimization, by industry
						</h1>
						<p className="mt-4 max-w-3xl text-lg text-balance text-zinc-600">
							The fundamentals of AEO are the same everywhere, but the prompts
							that matter and the stakes are not. Pick your world.
						</p>
					</div>
				</section>

				<section className="bg-white py-10">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
							{aeoVerticals.map((v) => (
								<a
									key={v.slug}
									href={`/aeo-for/${v.slug}`}
									className="flex flex-col rounded-md border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
								>
									<h2 className="font-semibold text-zinc-950">
										AEO for {v.audience}
									</h2>
									<p className="mt-2 text-sm leading-relaxed text-zinc-600">
										{v.short}
									</p>
								</a>
							))}
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
