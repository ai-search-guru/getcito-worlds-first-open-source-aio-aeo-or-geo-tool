import { Link, useLoaderData } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
} from "@workspace/ui/components/navigation-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { formatStarCount } from "@/lib/github-stars";
import { Logo } from "./logo";

const navigationLinks = [
	{ href: "/changelog", label: "Changelog" },
	{ href: "/roadmap", label: "Roadmap" },
	{ href: "/vision", label: "Vision" },
	{ href: "/docs", label: "Docs" },
];

// Off-Site AEO gets a standout button in the desktop action cluster, so it's
// kept out of the inline nav above and surfaced here for the mobile menu only.
const mobileLinks = [
	{ href: "/off-site-aeo", label: "Off-Site AEO" },
	...navigationLinks,
];

export function Navbar() {
	const rootData = useLoaderData({ from: "__root__" });
	const stars = rootData?.githubStars ?? 0;

	return (
		<header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
				<div className="flex items-center gap-3 md:gap-8">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								className="group size-8 md:hidden"
								variant="ghost"
								size="icon"
								aria-label="Open menu"
							>
								<svg
									className="pointer-events-none"
									width={16}
									height={16}
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M4 12L20 12"
										className="origin-center -translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-x-0 group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[315deg]"
									/>
									<path
										d="M4 12H20"
										className="origin-center transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.8)] group-aria-expanded:rotate-45"
									/>
									<path
										d="M4 12H20"
										className="origin-center translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[135deg]"
									/>
								</svg>
							</Button>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-44 p-1 md:hidden">
							<NavigationMenu className="max-w-none *:w-full">
								<NavigationMenuList className="flex-col items-start gap-0">
									{mobileLinks.map((link) => (
										<NavigationMenuItem key={link.href} className="w-full">
											<NavigationMenuLink href={link.href} className="py-1.5">
												{link.label}
											</NavigationMenuLink>
										</NavigationMenuItem>
									))}
								</NavigationMenuList>
							</NavigationMenu>
						</PopoverContent>
					</Popover>
					<Link to="/" aria-label="Homepage" className="flex items-center">
						<Logo className="text-2xl" />
					</Link>
					<NavigationMenu className="mx-auto max-md:hidden">
						<NavigationMenuList className="gap-1">
							{navigationLinks.map((link) => (
								<NavigationMenuItem key={link.href}>
									<NavigationMenuLink
										href={link.href}
										className="py-1.5 font-medium text-zinc-600 hover:text-zinc-950"
									>
										{link.label}
									</NavigationMenuLink>
								</NavigationMenuItem>
							))}
						</NavigationMenuList>
					</NavigationMenu>
				</div>
				<div className="flex items-center gap-2">
					<a
						href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
						target="_blank"
						rel="noopener noreferrer"
						className="group/star hidden h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 sm:inline-flex"
						aria-label={`Star Getcito on GitHub${stars ? ` (${stars} stars)` : ""}`}
					>
						<span className="relative inline-block size-3.5">
							<svg
								viewBox="0 0 24 24"
								className="absolute inset-0 size-full fill-current transition-opacity duration-150 group-hover/star:opacity-0"
							>
								<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
							</svg>
							<svg
								viewBox="0 0 24 24"
								className="absolute inset-0 size-full fill-transparent stroke-zinc-700 [stroke-width:2] opacity-0 transition-all duration-150 group-hover/star:scale-110 group-hover/star:opacity-100 group-hover/star:fill-amber-400 group-hover/star:stroke-amber-500 group-hover/star:[transition-delay:120ms]"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12 2.5l2.95 6 6.6.96-4.78 4.65 1.13 6.59L12 17.6l-5.9 3.1 1.13-6.59L2.45 9.46l6.6-.96L12 2.5z"
								/>
							</svg>
						</span>
						{stars > 0 && (
							<span className="tabular-nums transition-colors duration-150 group-hover/star:text-amber-600">
								{formatStarCount(stars)}
							</span>
						)}
					</a>
					<Link
						to="/off-site-aeo"
						className="hidden h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-950 hover:ring-zinc-300 md:inline-flex"
					>
						<Sparkles className="size-3.5 text-blue-600" />
						Off-Site AEO
					</Link>
					<Link
						to="/docs"
						className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
					>
						Get Started
						<ArrowRight className="size-3.5" />
					</Link>
				</div>
			</div>
		</header>
	);
}
