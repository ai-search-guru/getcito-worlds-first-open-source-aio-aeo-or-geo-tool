#!/usr/bin/env tsx
/**
 * Generates favicon + PWA icon assets for the apps/www marketing site.
 *
 * Output directories:
 *   - apps/www/public/            favicon.ico, apple-touch-icon.png (root — so
 *                                 default browser probes for /favicon.ico and
 *                                 /apple-touch-icon.png resolve without needing
 *                                 explicit <link> tags). www is always getcito-
 *                                 branded, so there's no whitelabel concern
 *                                 about these being served from the root.
 *   - apps/www/public/icons/      getcito-icon.svg, getcito-icon-maskable.svg,
 *                                 getcito-icon-96.png, getcito-icon-192.png,
 *                                 getcito-icon-512.png, getcito-icon-maskable-192.png,
 *                                 getcito-icon-maskable-512.png
 *
 * Mirrors apps/web/scripts/generate-brand-icons.tsx — SVG built by embedding the
 * Titan One WOFF2 as base64, PNGs rasterized via Takumi, ICO packaged by
 * png-to-ico.
 *
 * Usage:
 *   pnpm -F @workspace/www generate-icons
 */
// biome-ignore lint/correctness/noUnusedImports: classic JSX transform needs React in scope
import React from "react";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "@takumi-rs/image-response";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BRAND_COLOR = "#2563eb";
const PUBLIC_DIR = resolve(__dirname, "../public");
const ICONS_DIR = resolve(PUBLIC_DIR, "icons");

// ---------------------------------------------------------------------------
// SVG icons — hand-built with Titan One embedded as base64
// ---------------------------------------------------------------------------

function loadFontBase64(): string {
	const fontPath = require.resolve(
		"@fontsource/titan-one/files/titan-one-latin-400-normal.woff2",
	);
	return readFileSync(fontPath).toString("base64");
}

function fontFaceRule(base64: string): string {
	return `@font-face { font-family: 'Titan One'; src: url(data:font/woff2;base64,${base64}) format('woff2'); }`;
}

function buildStandardSvg(fontBase64: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <style>${fontFaceRule(fontBase64)}</style>
  <text x="50%" y="93.5%" font-family="'Titan One', sans-serif" font-size="190" font-weight="400" fill="${BRAND_COLOR}" text-anchor="middle">e</text>
</svg>`;
}

function buildMaskableSvg(fontBase64: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <style>${fontFaceRule(fontBase64)}</style>
  <rect width="128" height="128" fill="#ffffff"/>
  <text x="50%" y="78%" font-family="'Titan One', sans-serif" font-size="120" font-weight="400" fill="${BRAND_COLOR}" text-anchor="middle">e</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// PNG icons — rendered via Takumi (JSX → image)
// ---------------------------------------------------------------------------

function loadFont(path: string): ArrayBuffer {
	const buf = readFileSync(require.resolve(path));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const takumiFonts = [
	{
		name: "Titan One",
		data: loadFont("@fontsource/titan-one/files/titan-one-latin-400-normal.woff2"),
		style: "normal" as const,
		weight: 400 as const,
	},
];

async function renderPng(element: React.ReactElement, size: number): Promise<Buffer> {
	const response = new ImageResponse(element, {
		width: size,
		height: size,
		fonts: takumiFonts,
	});
	return Buffer.from(await response.arrayBuffer());
}

function StandardIcon({ bg, size }: { bg?: string; size: number }) {
	return (
		<div
			tw="flex items-center justify-center w-full h-full"
			style={{ backgroundColor: bg || "transparent" }}
		>
			<div
				style={{
					fontFamily: "Titan One",
					fontSize: size,
					color: BRAND_COLOR,
					lineHeight: 1,
					transform: "scale(1.4)",
					marginTop: -Math.round(size * 0.28),
				}}
			>
				e
			</div>
		</div>
	);
}

function MaskableIcon({ size }: { size: number }) {
	return (
		<div tw="flex items-center justify-center w-full h-full bg-white">
			<div
				style={{
					fontFamily: "Titan One",
					fontSize: Math.round(size * 0.94),
					color: BRAND_COLOR,
					lineHeight: 1,
					marginTop: -Math.round(size * 0.18),
				}}
			>
				e
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(ICONS_DIR, { recursive: true });

const fontBase64 = loadFontBase64();

const svgIcons = [
	{ name: "getcito-icon.svg", build: buildStandardSvg },
	{ name: "getcito-icon-maskable.svg", build: buildMaskableSvg },
];

for (const { name, build } of svgIcons) {
	writeFileSync(resolve(ICONS_DIR, name), build(fontBase64), "utf-8");
	console.log(`  ✓ icons/${name}`);
}

const iconPngs = [
	{ name: "getcito-icon-96.png", element: <StandardIcon size={96} />, size: 96 },
	{ name: "getcito-icon-192.png", element: <StandardIcon size={192} />, size: 192 },
	{ name: "getcito-icon-512.png", element: <StandardIcon size={512} />, size: 512 },
	{ name: "getcito-icon-maskable-192.png", element: <MaskableIcon size={192} />, size: 192 },
	{ name: "getcito-icon-maskable-512.png", element: <MaskableIcon size={512} />, size: 512 },
];

for (const { name, element, size } of iconPngs) {
	const buffer = await renderPng(element, size);
	writeFileSync(resolve(ICONS_DIR, name), buffer);
	console.log(`  ✓ icons/${name}`);
}

// Root-level assets — served at conventional paths so browser defaults pick
// them up without relying on <link> tags.
// Apple touch icons must be opaque — iOS otherwise adds its own background.
const appleTouch = await renderPng(<StandardIcon bg="#ffffff" size={180} />, 180);
writeFileSync(resolve(PUBLIC_DIR, "apple-touch-icon.png"), appleTouch);
console.log("  ✓ apple-touch-icon.png");

// Transparent background — browsers rasterize this onto the tab strip, which
// is often dark-themed. apple-touch-icon above keeps its white bg because iOS
// would otherwise composite it onto its own (usually dark) background.
const icoPngs: Buffer[] = [];
for (const size of [16, 32, 48]) {
	icoPngs.push(await renderPng(<StandardIcon size={size} />, size));
}
writeFileSync(resolve(PUBLIC_DIR, "favicon.ico"), await pngToIco(icoPngs));
console.log("  ✓ favicon.ico");

console.log(`\nIcons written to ${PUBLIC_DIR}`);
