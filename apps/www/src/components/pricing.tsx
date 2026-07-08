import { Check, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { WaitlistForm } from "./waitlist-form";
import { ContactForm } from "./contact-form";

interface Plan {
	id: string;
	tag: string;
	name: string;
	desc: string;
	price: string;
	priceLabel: string;
	features: string[];
	cta:
		| { type: "link"; text: string; href: string }
		| { type: "waitlist" }
		| { type: "contact" };
}

const plans: Plan[] = [
	{
		id: "self-hosted",
		tag: "01",
		name: "Self-Hosted",
		desc: "Run on your own infra with full access.",
		price: "$0",
		priceLabel: "",
		features: [
			"Unlimited prompts",
			"All AI models supported",
			"Citation analysis",
			"Competitor tracking",
			"Full source code access",
			"Community support",
		],
		cta: { type: "link", text: "Get started", href: "/docs" },
	},
	{
		id: "cloud",
		tag: "02",
		name: "Cloud",
		desc: "Managed hosting, no maintenance.",
		price: "Coming Soon",
		priceLabel: "",
		features: [
			"Everything in Self-Hosted",
			"Managed hosting",
			"Automatic updates",
			"Priority support",
			"Daily backups",
			"Usage analytics",
		],
		cta: { type: "waitlist" },
	},
	{
		id: "white-label",
		tag: "03",
		name: "White Label",
		desc: "Provide AEO for all of your customers.",
		price: "Custom",
		priceLabel: "",
		features: [
			"Everything in Cloud",
			"Custom branding",
			"Custom domain",
			"SSO",
			"Shared Slack channel",
			"Prioritized features",
		],
		cta: { type: "contact" },
	},
];

export function Pricing() {
	return (
		<section id="pricing" className="border-b border-zinc-200 bg-white">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<div>
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ PRICING
					</p>
					<h2 className="mt-4 max-w-[28ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
						Self-host it, run it in our cloud, or white-label it for your
						customers.
					</h2>
				</div>

				<div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-3">
					{plans.map((plan) => (
						<div
							key={plan.id}
							className="flex flex-col justify-between bg-white p-6 lg:p-8"
						>
							<div>
								<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 tabular-nums">
									{plan.tag}
								</span>
								<h3 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">
									{plan.name}
								</h3>
								<p className="mt-2 max-w-[36ch] text-pretty text-sm text-zinc-600">
									{plan.desc}
								</p>
								<div className="mt-6 flex items-baseline gap-2 border-y border-zinc-200 py-4">
									<span className="text-4xl font-semibold tracking-tight text-zinc-950 tabular-nums">
										{plan.price}
									</span>
									{plan.priceLabel && (
										<span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
											{plan.priceLabel}
										</span>
									)}
								</div>
								<ul role="list" className="mt-6 space-y-2.5 text-sm text-zinc-700">
									{plan.features.map((f) => (
										<li key={f} className="flex items-start gap-2">
											<Check
												className="mt-0.5 size-3.5 shrink-0 text-blue-600"
												strokeWidth={3}
											/>
											<span>{f}</span>
										</li>
									))}
								</ul>
							</div>
							<div className="mt-8 [&_button]:!h-8 [&_button]:w-full [&_button]:rounded-md [&_button]:bg-blue-600 [&_button]:!px-3 [&_button]:!py-0 [&_button]:!text-sm [&_button]:font-medium [&_button]:!leading-none [&_button]:text-white [&_button]:ring-1 [&_button]:ring-blue-600 [&_button]:hover:bg-blue-700">
								{plan.cta.type === "link" && (
									<Link
										to={plan.cta.href}
										className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
									>
										{plan.cta.text}
										<ArrowRight className="size-3.5" />
									</Link>
								)}
								{plan.cta.type === "waitlist" && (
									<WaitlistForm source="pricing" />
								)}
								{plan.cta.type === "contact" && (
									<ContactForm source="pricing" />
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
