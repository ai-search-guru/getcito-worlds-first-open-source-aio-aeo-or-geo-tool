import type { FaqItem } from "@/lib/faqs";

/**
 * Renders an FAQ as a semantic definition list. Pair it with `faqJsonLd(items)`
 * in the route head, passing the same `items`, so the visible Q&A and the
 * FAQPage structured data stay in sync.
 */
export function Faq({
	items,
	title = "Frequently Asked Questions",
	eyebrow,
}: {
	items: FaqItem[];
	title?: string;
	eyebrow?: string;
}) {
	if (items.length === 0) return null;

	return (
		<section className="border-b border-zinc-200 bg-white py-12 lg:py-16">
			<div className="mx-auto max-w-6xl px-4 md:px-6">
				{eyebrow ? (
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						{eyebrow}
					</p>
				) : null}
				<h2 className="font-heading mt-2 text-2xl text-zinc-950 md:text-3xl">
					{title}
				</h2>
				<dl className="mt-8 divide-y divide-zinc-200 border-t border-zinc-200">
					{items.map((item) => (
						<div key={item.question} className="py-5">
							<dt className="text-base font-semibold text-zinc-950">
								{item.question}
							</dt>
							<dd className="mt-2 max-w-3xl leading-relaxed text-zinc-600">
								{item.answer}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}
