/// <reference types="vite/client" />
import { useEffect, type ReactNode } from "react";
import {
	Outlet,
	createRootRoute,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { initPostHog } from "@/lib/posthog";
import {
	SITE_URL,
	SITE_NAME,
	SITE_DESCRIPTION,
	websiteJsonLd,
	organizationJsonLd,
} from "@/lib/seo";
import { getMarketingOgImage } from "@/lib/og";
import { getGitHubStars } from "@/lib/github-stars";
import { NotFound } from "@/components/not-found";
import appCss from "../styles.css?url";
// Preload the 400-weight files used everywhere above the fold so they download
// in parallel with the CSS instead of after it (the H1 LCP element was being
// held back by the HTML→CSS→font waterfall).
import geistSansFont from "@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2?url";
import geistMonoFont from "@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2?url";
import titanOneFont from "@fontsource/titan-one/files/titan-one-latin-400-normal.woff2?url";

const ROOT_TITLE = `${SITE_NAME} · Open Source AI Visibility`;
const ROOT_OG_IMAGE = `${SITE_URL}${getMarketingOgImage({ title: ROOT_TITLE, description: SITE_DESCRIPTION })}`;

export const Route = createRootRoute({
	notFoundComponent: NotFound,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ title: ROOT_TITLE },
			{ name: "description", content: SITE_DESCRIPTION },
			{ property: "og:site_name", content: SITE_NAME },
			{ property: "og:locale", content: "en_US" },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: SITE_URL },
			{ property: "og:title", content: ROOT_TITLE },
			{ property: "og:description", content: SITE_DESCRIPTION },
			{ property: "og:image", content: ROOT_OG_IMAGE },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:alt", content: ROOT_TITLE },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: ROOT_TITLE },
			{ name: "twitter:description", content: SITE_DESCRIPTION },
			{ name: "twitter:image", content: ROOT_OG_IMAGE },
			{ name: "theme-color", content: "#2563eb" },
			{ name: "apple-mobile-web-app-title", content: SITE_NAME },
		],
		links: [
			{
				rel: "preload",
				as: "font",
				type: "font/woff2",
				href: geistSansFont,
				crossOrigin: "anonymous",
			},
			{
				rel: "preload",
				as: "font",
				type: "font/woff2",
				href: geistMonoFont,
				crossOrigin: "anonymous",
			},
			{
				rel: "preload",
				as: "font",
				type: "font/woff2",
				href: titanOneFont,
				crossOrigin: "anonymous",
			},
			{ rel: "icon", type: "image/svg+xml", href: "/icons/getcito-icon.svg" },
			{ rel: "icon", type: "image/png", sizes: "96x96", href: "/icons/getcito-icon-96.png" },
			{ rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
			{ rel: "manifest", href: "/site.webmanifest" },
			{ rel: "stylesheet", href: appCss },
		],
		scripts: [
			websiteJsonLd(),
			organizationJsonLd(),
			{
				src: "/api/plausible/js/script",
				defer: true,
				"data-domain": "Getcito.com",
				"data-api": "/api/plausible/event",
			},
		],
	}),
	loader: async () => {
		const githubStars = await getGitHubStars();
		return { githubStars };
	},
	component: RootComponent,
});

function RootComponent() {
	useEffect(() => {
		initPostHog();
	}, []);

	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
