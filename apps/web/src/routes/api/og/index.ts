import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import ImageResponse from "@takumi-rs/image-response/wasm";
import takumiWasm from "virtual:takumi-wasm";
import titanOne400Data from "virtual:font/titan-one-400";
import geistSans400Data from "virtual:font/geist-sans-400";
import geistSans500Data from "virtual:font/geist-sans-500";
import { DEFAULT_APP_NAME } from "@workspace/config/constants";
import { renderOgImage } from "@workspace/og/render";
import { getDeployment } from "@/lib/config/server";

const publicDir = new URL("../../../../public/", import.meta.url);

async function fetchIconAsDataUri(
	iconPath: string,
	appUrl: string,
	requestUrl: string,
): Promise<string | undefined> {
	const readPublicIcon = (pathname: string): string | undefined => {
		try {
			const iconFile = new URL(`.${pathname}`, publicDir);
			const buffer = readFileSync(iconFile);
			const extension = extname(pathname).toLowerCase();
			const contentType =
				extension === ".svg"
					? "image/svg+xml"
					: extension === ".jpg" || extension === ".jpeg"
						? "image/jpeg"
						: extension === ".webp"
							? "image/webp"
							: "image/png";
			return `data:${contentType};base64,${buffer.toString("base64")}`;
		} catch {
			return undefined;
		}
	};

	if (iconPath.startsWith("/")) {
		return readPublicIcon(iconPath);
	}

	const url = iconPath.startsWith("http")
		? iconPath
		: `${appUrl.replace(/\/$/, "")}${iconPath}`;

	try {
		const iconUrl = new URL(url);
		const currentUrl = new URL(requestUrl);
		if (
			iconUrl.origin === currentUrl.origin &&
			iconUrl.pathname.startsWith("/")
		) {
			return readPublicIcon(iconUrl.pathname);
		}
	} catch {
		return undefined;
	}

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return undefined;
		const buf = await res.arrayBuffer();
		const contentType = res.headers.get("content-type") || "image/png";
		return `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
	} catch {
		return undefined;
	}
}

export const Route = createFileRoute("/api/og/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const forceDefault =
					url.searchParams.get("defaultBranding") === "true";
				const title = url.searchParams.get("title") ?? undefined;
				const description =
					url.searchParams.get("description") ?? undefined;

				const deployment = getDeployment();
				const { branding } = deployment;

				const appName = forceDefault ? DEFAULT_APP_NAME : branding.name;

				let iconDataUri: string | undefined;
				if (
					!forceDefault &&
					appName !== DEFAULT_APP_NAME &&
					branding.icon
				) {
					iconDataUri = await fetchIconAsDataUri(
						branding.icon,
						branding.url,
						request.url,
					);
				}

				const response = new ImageResponse(
					renderOgImage({
						appName,
						title,
						description,
						accentColors: forceDefault
							? undefined
							: branding.chartColors.slice(0, 4),
						iconDataUri,
					}),
					{
						width: 1200,
						height: 630,
						module: takumiWasm,
						fonts: [
							{
								name: "Titan One",
								data: titanOne400Data,
								style: "normal" as const,
								weight: 400 as const,
							},
							{
								name: "Geist Sans",
								data: geistSans400Data,
								style: "normal" as const,
								weight: 400 as const,
							},
							{
								name: "Geist Sans",
								data: geistSans500Data,
								style: "normal" as const,
								weight: 500 as const,
							},
						],
					},
				);

				return new Response(response.body, {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control":
							"public, max-age=86400, s-maxage=604800",
					},
				});
			},
		},
	},
});
