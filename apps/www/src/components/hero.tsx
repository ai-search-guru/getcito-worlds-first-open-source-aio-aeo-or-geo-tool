import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import MuxPlayer from "@mux/mux-player-react";
import { CustomerLogosInline } from "./customer-logos";
import { QuickstartBlock } from "./quickstart-block";
import { externalRel } from "@/lib/external-link";

function PrimaryCTA({
	to,
	href,
	external,
	children,
	className = "",
}: {
	to?: string;
	href?: string;
	external?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	const cls = `inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700 ${className}`;
	if (to) {
		return (
			<Link to={to} className={cls}>
				{children}
			</Link>
		);
	}
	if (href) {
		return (
			<a
				href={href}
				className={cls}
				{...(external ? { target: "_blank", rel: externalRel(href) } : {})}
			>
				{children}
			</a>
		);
	}
	return null;
}

function GhostCTA({
	to,
	href,
	external,
	children,
	className = "",
}: {
	to?: string;
	href?: string;
	external?: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	const cls = `inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 ${className}`;
	if (to) {
		return (
			<Link to={to} className={cls}>
				{children}
			</Link>
		);
	}
	if (href) {
		return (
			<a
				href={href}
				className={cls}
				{...(external ? { target: "_blank", rel: externalRel(href) } : {})}
			>
				{children}
			</a>
		);
	}
	return null;
}

// Cast a brand-blue glow under Mux Player's default center play button so it
// echoes the wrapper's outer blue shadow. Drop-shadow follows the circle's
// shape, unlike box-shadow which would paint a square.
const MUX_PLAYER_STYLES = `
	mux-player::part(center play button) {
		filter: drop-shadow(0 8px 24px rgba(37, 99, 235, 0.35));
	}
`;

function DemoVideo() {
	return (
		<div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg shadow-blue-600/10">
			<style dangerouslySetInnerHTML={{ __html: MUX_PLAYER_STYLES }} />
			<MuxPlayer
				playbackId="PYV9FNIG008vlkchyQf9KMTxDt028zQdshaM4VLC6lS1Q"
				streamType="on-demand"
				accentColor="#2563eb"
				poster="/demo-poster.png"
				metadata={{
					video_id: "KGvs37kE02Z6mnTpcrnLJCtiS01V023aJEHK3MZlmaULPA",
					video_title: "Getcito demo",
				}}
				style={{
					aspectRatio: "16 / 9",
					display: "block",
					width: "100%",
					cursor: "pointer",
				}}
			/>
		</div>
	);
}

export function Hero() {
	return (
		<section className="relative border-b border-zinc-200 bg-white">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
			/>
			<div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 md:px-6 lg:pb-24 lg:pt-24">
				<div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
					<div className="lg:col-span-7">
						<div className="flex flex-wrap items-center gap-2">
							<span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] text-zinc-700">
								<span className="size-1.5 rounded-full bg-emerald-500" />
								v0.2.6
							</span>
							<a
								href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
								target="_blank"
								rel="noopener noreferrer"
								className="group inline-flex items-center gap-1 font-mono text-[11px] text-zinc-600 hover:text-zinc-950"
							>
								Star on GitHub
								<ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
							</a>
						</div>
						<h1 className="mt-7 max-w-[18ch] text-5xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 sm:text-6xl lg:text-[4.25rem] lg:leading-[1.0]">
							Know How AI Talks About Your Brand
						</h1>
						<p className="mt-6 max-w-[58ch] text-pretty text-base text-zinc-600 md:text-lg">
							Track your brand's visibility across any AI model. Monitor
							mentions, analyze citations, and benchmark competitors. Open
							source and self-hosted, so your data stays yours and you'll never
							get locked in.
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-2">
							<PrimaryCTA to="/docs">
								Get Started
								<ArrowRight className="size-3.5" />
							</PrimaryCTA>
							<GhostCTA href="https://demo.Getcito.com" external>
								Live demo
								<ArrowUpRight className="size-3.5" />
							</GhostCTA>
						</div>
						<CustomerLogosInline />
					</div>
					<aside className="flex flex-col gap-4 lg:col-span-5">
						<QuickstartBlock />
						<DemoVideo />
					</aside>
				</div>
			</div>
		</section>
	);
}
