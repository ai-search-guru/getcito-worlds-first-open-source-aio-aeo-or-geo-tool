import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	definedTermSetJsonLd,
} from "@/lib/seo";
import { glossaryTerms, GLOSSARY_GROUPS } from "@/data/glossary";

const title = "AI Search & AEO Glossary · Getcito";
const description =
	"A plain-English glossary of AI search and answer engine optimization terms: AEO, GEO, LLMO, AI Overviews, citations, share of voice, RAG, and more.";

export const Route = createFileRoute("/glossary/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/glossary" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/glossary") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Glossary", path: "/glossary" },
			]),
			definedTermSetJsonLd({
				name: "AI Search & AEO Glossary",
				description,
				path: "/glossary",
				terms: glossaryTerms.map((t) => ({
					term: t.term,
					definition: t.short,
					url: `/glossary/${t.slug}`,
				})),
			}),
		],
	}),
	component: GlossaryIndex,
});

function GlossaryIndex() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<section className="border-b border-zinc-200 bg-white py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ Glossary
						</p>
						<h1 className="font-heading mt-2 text-4xl text-balance text-zinc-950 md:text-5xl">
							The AI search glossary
						</h1>
						<p className="mt-4 max-w-3xl text-lg text-balance text-zinc-600">
							The vocabulary of AI search and answer engine optimization, defined
							in plain English and cross-linked. Start anywhere.
						</p>
					</div>
				</section>

				{GLOSSARY_GROUPS.map((group) => {
					const terms = glossaryTerms.filter((t) => t.group === group);
					if (terms.length === 0) return null;
					return (
						<section
							key={group}
							className="border-b border-zinc-200 bg-white py-10"
						>
							<div className="mx-auto max-w-6xl px-4 md:px-6">
								<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
									{group}
								</h2>
								<dl className="mt-5 grid gap-5 md:grid-cols-2">
									{terms.map((t) => (
										<div
											key={t.slug}
											className="rounded-md border border-zinc-200 bg-white p-5"
										>
											<dt>
												<a
													href={`/glossary/${t.slug}`}
													className="font-semibold text-zinc-950 hover:text-blue-700"
												>
													{t.term}
												</a>
												{t.aka && t.aka.length > 0 && (
													<span className="ml-2 text-sm text-zinc-400">
														{t.aka.join(", ")}
													</span>
												)}
											</dt>
											<dd className="mt-1.5 text-sm leading-relaxed text-zinc-600">
												{t.short}
											</dd>
										</div>
									))}
								</dl>
							</div>
						</section>
					);
				})}
			</main>
			<Footer />
		</div>
	);
}
