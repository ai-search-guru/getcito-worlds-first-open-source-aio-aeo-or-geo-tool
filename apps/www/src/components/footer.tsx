import { Link } from "@tanstack/react-router";
import { Logo } from "./logo";
import { externalRel } from "@/lib/external-link";

// Our parent company. externalRel keeps the Referer (bluewhale.dev is owned);
// the ?ref=Getcito param is a belt-and-suspenders fallback.
const BLUEWHALE_URL = "https://bluewhale.dev?ref=Getcito";

const cols = [
	{
		heading: "Product",
		links: [
			{ label: "Features", href: "/features" },
			{ label: "Pricing", href: "/pricing" },
			{ label: "Changelog", href: "/changelog" },
			{ label: "Roadmap", href: "/roadmap" },
		],
	},
	{
		heading: "Resources",
		links: [
			{ label: "Blog", href: "/blog" },
			{ label: "Documentation", href: "/docs" },
			{ label: "API Reference", href: "/docs/api" },
			{ label: "Provider Status", href: "/status" },
			{
				label: "Issues",
				href: "https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues",
				external: true,
			},
		],
	},
	{
		heading: "Learn",
		links: [
			{ label: "AEO Glossary", href: "/glossary" },
			{ label: "AI Search Guides", href: "/ai-search" },
			{ label: "AEO by Industry", href: "/aeo-for" },
			{ label: "Tool Directory", href: "/ai-visibility-tools" },
			{ label: "Compare Tools", href: "/ai-visibility-tools/compare" },
		],
	},
	{
		heading: "Company",
		links: [
			{ label: "Vision", href: "/vision" },
			{ label: "Brand Assets", href: "/brand" },
			{ label: "llms.txt", href: "/llms.txt" },
		],
	},
];

export function Footer() {
	return (
		<footer className="bg-white">
			<div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
				<div className="grid gap-10 md:grid-cols-12">
					<div className="md:col-span-3">
						<Link to="/" aria-label="Homepage">
							<Logo className="text-3xl" />
						</Link>
						<p className="mt-5 max-w-[36ch] text-pretty text-sm text-zinc-600">
							Open source AI visibility tracking and optimization.
						</p>
						<div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] text-zinc-700">
							<span className="size-1.5 rounded-full bg-emerald-500" />
							v0.2.6
						</div>
					</div>
					<div className="grid grid-cols-2 gap-10 md:col-span-9 md:grid-cols-4">
						{cols.map((col) => (
							<div key={col.heading}>
								<h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
									{col.heading}
								</h3>
								<ul
									role="list"
									className="mt-4 space-y-2.5 text-sm text-zinc-700"
								>
									{col.links.map((link) =>
										"external" in link && link.external ? (
											<li key={link.href}>
												<a
													href={link.href}
													target="_blank"
													rel={externalRel(link.href)}
													className="hover:text-zinc-950 hover:underline"
												>
													{link.label}
												</a>
											</li>
										) : link.href.startsWith("/") ? (
											<li key={link.href}>
												<a
													href={link.href}
													className="hover:text-zinc-950 hover:underline"
												>
													{link.label}
												</a>
											</li>
										) : (
											<li key={link.href}>
												<a
													href={link.href}
													className="hover:text-zinc-950 hover:underline"
												>
													{link.label}
												</a>
											</li>
										),
									)}
								</ul>
							</div>
						))}
					</div>
				</div>

				<div className="mt-12 flex flex-col items-start gap-4 border-t border-zinc-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
					<p className="font-mono text-[11px] text-zinc-500">
						&copy; {new Date().getFullYear()}{" "}
						<a
							href={BLUEWHALE_URL}
							target="_blank"
							rel={externalRel(BLUEWHALE_URL)}
							className="hover:text-zinc-900 hover:underline"
						>
							Blue Whale Software, LLC
						</a>
					</p>
					<div className="flex items-center gap-3 text-zinc-600">
						<a
							href="https://x.com/Getcito"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Twitter / X"
							className="hover:text-zinc-900"
						>
							<svg viewBox="0 0 24 24" className="size-4 fill-current">
								<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
							</svg>
						</a>
						<a
							href="https://linkedin.com/company/Getcito"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="LinkedIn"
							className="hover:text-zinc-900"
						>
							<svg viewBox="0 0 24 24" className="size-4 fill-current">
								<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
							</svg>
						</a>
						<a
							href="https://discord.gg/s24nubCtKz"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Discord"
							className="hover:text-zinc-900"
						>
							<svg viewBox="0 0 24 24" className="size-4 fill-current">
								<path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
							</svg>
						</a>
						<a
							href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="GitHub"
							className="hover:text-zinc-900"
						>
							<svg viewBox="0 0 24 24" className="size-4 fill-current">
								<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
							</svg>
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
