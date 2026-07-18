/**
 * /api/manifest - Dynamic Web App Manifest
 *
 * Generates a manifest.json tailored to the current deployment mode:
 *   - Whitelabel: single 128×128 icon from the configured icon URL
 *   - Local/Demo (Getcito): static SVG icons committed to public/icons/
 *
 * Branding values (name, theme color, etc.) are read from server config
 * so they stay in sync with the rest of the app.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getDeployment } from "@/lib/config/server";
import {
	DEFAULT_APP_ICON,
	Getcito_THEME_COLOR,
	Getcito_BACKGROUND_COLOR,
} from "@workspace/config/constants";

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}

function buildManifest(): object {
	const deployment = getDeployment();
	const { branding } = deployment;
	const hasCustomIcon = branding.icon !== DEFAULT_APP_ICON;

	let icons: ManifestIcon[];

	if (hasCustomIcon) {
		icons = [
			{
				src: branding.icon,
				sizes: "128x128",
				type: "image/png",
			},
		];
	} else {
		// getcito-only assets — never reference these from the whitelabel branch.
		icons = [
			{
				src: "/icons/getcito-icon-512.png",
				sizes: "any",
				type: "image/svg+xml",
			},
			{
				src: "/icons/getcito-icon-maskable-512.png",
				sizes: "any",
				type: "image/svg+xml",
				purpose: "maskable",
			},
			// PWA installers on Android/Chrome require concrete PNG sizes.
			{
				src: "/icons/getcito-icon-192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/icons/getcito-icon-512.png",
				sizes: "512x512",
				type: "image/png",
			},
			{
				src: "/icons/getcito-icon-maskable-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "maskable",
			},
			{
				src: "/icons/getcito-icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		];
	}

	const themeColor = hasCustomIcon ? "#000000" : Getcito_THEME_COLOR;

	return {
		short_name: branding.name,
		name: `${branding.name} - AI Search Optimization`,
		icons,
		start_url: ".",
		display: "standalone",
		theme_color: themeColor,
		background_color: Getcito_BACKGROUND_COLOR,
	};
}

export const Route = createFileRoute("/api/manifest/")({
	server: {
		handlers: {
			GET: () => {
				const manifest = buildManifest();
				return new Response(JSON.stringify(manifest, null, 2), {
					headers: {
						"Content-Type": "application/manifest+json",
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
});

