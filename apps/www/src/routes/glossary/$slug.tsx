import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import {
	getGlossaryTerm,
	glossaryTerms,
	type GlossaryTerm,
} from "@/data/glossary";

export const Route = createFileRoute("/glossary/$slug")({
	head: ({ params }) => {
		const t = getGlossaryTerm(params.slug);
		if (!t) return {};
		const title = `What is ${t.term}? · Getcito`;
		const description = t.short;
		const path = `/glossary/${t.slug}`;
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
					{ name: "Glossary", path: "/glossary" },
					{ name: t.term, path },
				]),
				faqJsonLd([
					{
						question: `What is ${t.term}?`,
						answer: `${t.short} ${t.body[0]}`,
					},
				]),
			],
		};
	},
	loader: ({ params }) => {
		const t = getGlossaryTerm(params.slug);
		if (!t) throw notFound();
		const related = (t.related ?? [])
			.map((slug) => glossaryTerms.find((x) => x.slug === slug))
			.filter((x): x is GlossaryTerm => Boolean(x));
		return { term: t, related };
	},
	component: GlossaryTermPage,
});

function GlossaryTermPage() {
	const { term, related } = Route.useLoaderData() as {
		term: GlossaryTerm;
		related: GlossaryTerm[];
	};
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<div className="mx-auto max-w-6xl px-4 pt-8 md:px-6">
					<a
						href="/glossary"
						className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-950"
					>
						<ArrowLeft className="h-3 w-3" />
						AI search glossary
					</a>
				</div>

				<article className="mx-auto max-w-6xl px-4 py-10 md:px-6">
					<div className="max-w-3xl">
					<h1 className="font-heading text-4xl text-balance text-zinc-950 md:text-5xl">
						{term.term}
					</h1>
					{term.aka && term.aka.length > 0 && (
						<p className="mt-2 text-sm text-zinc-500">
							Also known as {term.aka.join(", ")}
						</p>
					)}
					<p className="mt-5 text-lg leading-relaxed text-balance text-zinc-700">
						{term.short}
					</p>
					<div className="mt-6 space-y-5 leading-relaxed text-zinc-600">
						{term.body.map((p) => (
							<p key={p.slice(0, 32)}>{p}</p>
						))}
					</div>

					{term.seeAlso && term.seeAlso.length > 0 && (
						<div className="mt-8 rounded-md border border-zinc-200 bg-zinc-50 p-5">
							<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								Go deeper
							</h2>
							<ul className="mt-3 space-y-2">
								{term.seeAlso.map((link) => (
									<li key={link.href}>
										<a
											href={link.href}
											className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
										>
											{link.label}
											<ArrowRight className="h-3.5 w-3.5" />
										</a>
									</li>
								))}
							</ul>
						</div>
					)}

					{related.length > 0 && (
						<div className="mt-8">
							<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								Related terms
							</h2>
							<div className="mt-3 flex flex-wrap gap-2">
								{related.map((r) => (
									<a
										key={r.slug}
										href={`/glossary/${r.slug}`}
										className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
									>
										{r.term}
									</a>
								))}
							</div>
						</div>
					)}
					</div>
				</article>

				<section className="border-t border-zinc-200 bg-zinc-50 py-12">
					<div className="mx-auto max-w-3xl px-4 text-center md:px-6">
						<h2 className="font-heading text-2xl text-zinc-950">
							See it in your own data
						</h2>
						<p className="mx-auto mt-3 max-w-xl text-zinc-600">
							Getcito is an open-source AI visibility platform. Self-host it for free
							and track how AI answer engines mention and cite your brand.
						</p>
						<div className="mt-6 flex flex-wrap justify-center gap-3">
							<Link
								to="/docs"
								className="inline-flex h-9 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
							>
								Get started
							</Link>
							<a
								href="/ai-visibility-tools"
								className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:text-zinc-950"
							>
								Compare tools
							</a>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
