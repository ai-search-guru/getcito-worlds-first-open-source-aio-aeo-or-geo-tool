import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { DirectoryHero, GetcitoCta } from "@/components/directory-shell";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import { getAeoVertical, aeoVerticals, type AeoVertical } from "@/data/aeo-verticals";

export const Route = createFileRoute("/aeo-for/$slug")({
	head: ({ params }) => {
		const v = getAeoVertical(params.slug);
		if (!v) return {};
		const title = `AEO for ${v.audience} · Getcito`;
		const description = v.short;
		const path = `/aeo-for/${v.slug}`;
		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				...ogMeta({ title, description, path }),
			],
			links: [{ rel: "canonical", href: canonicalUrl(path) }],
			scripts: [
				breadcrumbJsonLd([
					{ name: "Home", path: "/" },
					{ name: "AEO by industry", path: "/aeo-for" },
					{ name: `AEO for ${v.audience}`, path },
				]),
				faqJsonLd(v.faqs),
			],
		};
	},
	loader: ({ params }) => {
		const v = getAeoVertical(params.slug);
		if (!v) throw notFound();
		const others = aeoVerticals.filter((x) => x.slug !== v.slug);
		return { vertical: v, others };
	},
	component: VerticalPage,
});

function VerticalPage() {
	const { vertical, others } = Route.useLoaderData() as {
		vertical: AeoVertical;
		others: AeoVertical[];
	};
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<div className="mx-auto max-w-6xl px-4 pt-8 md:px-6">
					<a
						href="/aeo-for"
						className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-950"
					>
						<ArrowLeft className="h-3 w-3" />
						AEO by industry
					</a>
				</div>

				<DirectoryHero
					eyebrow="Use case"
					title={`AEO for ${vertical.audience}`}
					lead={vertical.short}
				/>

				<section className="border-b border-zinc-200 bg-white py-12">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
						<div className="space-y-5 text-lg leading-relaxed text-zinc-700">
							{vertical.intro.map((p) => (
								<p key={p.slice(0, 32)}>{p}</p>
							))}
						</div>

						<div className="mt-10 rounded-md border border-zinc-200 bg-zinc-50 p-6">
							<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								Prompts that matter here
							</h2>
							<ul className="mt-4 space-y-2">
								{vertical.examplePrompts.map((p) => (
									<li
										key={p}
										className="rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-700"
									>
										{p}
									</li>
								))}
							</ul>
						</div>

						<h2 className="font-heading mt-12 text-2xl text-zinc-950">
							What to do
						</h2>
						<ol className="mt-6 space-y-5">
							{vertical.plays.map((play, i) => (
								<li key={play.name} className="flex gap-4">
									<span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 font-mono text-xs text-white tabular-nums">
										{i + 1}
									</span>
									<div>
										<h3 className="font-semibold text-zinc-950">{play.name}</h3>
										<p className="mt-1 leading-relaxed text-zinc-600">
											{play.text}
										</p>
									</div>
								</li>
							))}
						</ol>

						<div className="mt-12 rounded-md border border-blue-200 bg-blue-50/40 p-6">
							<h2 className="font-heading text-xl text-zinc-950">
								Where Getcito fits
							</h2>
							<p className="mt-2 leading-relaxed text-zinc-600">
								{vertical.GetcitoFit}
							</p>
						</div>

						<div className="mt-10">
							<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								Other industries
							</h2>
							<div className="mt-3 flex flex-wrap gap-2">
								{others.map((o) => (
									<a
										key={o.slug}
										href={`/aeo-for/${o.slug}`}
										className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
									>
										{o.audience}
									</a>
								))}
							</div>
						</div>
						</div>
					</div>
				</section>

				<Faq items={vertical.faqs} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
