import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { QuickstartBlock } from "./quickstart-block";

function PrimaryCTA({
	to,
	children,
}: {
	to: string;
	children: React.ReactNode;
}) {
	return (
		<Link
			to={to}
			className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
		>
			{children}
		</Link>
	);
}

function GhostCTA({
	href,
	external,
	children,
}: {
	href: string;
	external?: boolean;
	children: React.ReactNode;
}) {
	return (
		<a
			href={href}
			className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
		>
			{children}
		</a>
	);
}

export function CTA() {
	return (
		<section className="relative border-b border-zinc-200 bg-white">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_top,black,transparent_85%)]"
			/>
			<div className="relative mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<div className="grid items-center gap-10 lg:grid-cols-12">
					<div className="lg:col-span-7">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ DEPLOY
						</p>
						<h2 className="mt-4 max-w-[18ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
							Roll your own AEO in minutes.
						</h2>
						<p className="mt-5 max-w-[52ch] text-pretty text-zinc-600 md:text-lg">
							No vendor lock-in, just AEO on your own infra.
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-2">
							<PrimaryCTA to="/docs">
								Get Started
								<ArrowRight className="size-3.5" />
							</PrimaryCTA>
							<GhostCTA href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool" external>
								View source
							</GhostCTA>
						</div>
					</div>
					<div className="lg:col-span-5">
						<QuickstartBlock />
					</div>
				</div>
			</div>
		</section>
	);
}
