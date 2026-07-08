import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Home } from "lucide-react";
import { Navbar } from "./navbar";
import { Footer } from "./footer";

const suggestedLinks = [
	{ label: "Documentation", href: "/docs", description: "Get started and learn the API" },
	{ label: "Features", href: "/features", description: "What Getcito can do for your brand" },
	{ label: "Pricing", href: "/pricing", description: "Plans for every team size" },
	{ label: "Roadmap", href: "/roadmap", description: "What we're building next" },
];

export function NotFound() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<section className="relative border-b border-zinc-200 bg-white">
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
					/>
					<div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 lg:py-28">
						<div className="mx-auto max-w-2xl text-center">
							<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 tabular-nums">
								404 — <span className="text-zinc-500">PAGE NOT FOUND</span>
							</p>
							<h1 className="font-heading mt-5 text-balance text-5xl leading-[1.05] tracking-tight text-zinc-950 sm:text-6xl lg:text-[4.25rem] lg:leading-[1.0]">
								This page doesn't exist
							</h1>
							<p className="mx-auto mt-6 max-w-[58ch] text-pretty text-base text-zinc-600 md:text-lg">
								The page you're looking for may have moved, been renamed, or
								never existed.
							</p>
							<div className="mt-8 flex flex-wrap items-center justify-center gap-2">
								<Link
									to="/"
									className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
								>
									<Home className="size-3.5" />
									Back to home
								</Link>
								<Link
									to="/docs"
									className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
								>
									Read the docs
									<ArrowRight className="size-3.5" />
								</Link>
							</div>
						</div>
					</div>
				</section>

				<section className="border-b border-zinc-200 bg-zinc-50 py-12 lg:py-16">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ POPULAR DESTINATIONS
						</p>
						<ul role="list" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{suggestedLinks.map((link) => (
								<li key={link.href}>
									<a
										href={link.href}
										className="group flex h-full flex-col rounded-md border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
									>
										<span className="flex items-center justify-between text-sm font-semibold text-zinc-950">
											{link.label}
											<ArrowUpRight className="size-3.5 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-700" />
										</span>
										<span className="mt-1 text-sm text-zinc-600">
											{link.description}
										</span>
									</a>
								</li>
							))}
						</ul>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
