#!/usr/bin/env tsx
/**
 * Generates static Getcito brand icon assets served from /icons/*.
 *
 * Output directory: apps/web/public/icons/
 *
 * SVG (vector, used by modern browsers as `<link rel="icon">`):
 *   - getcito-icon.svg           Standard "e" icon (transparent background)
 *   - getcito-icon-maskable.svg  Maskable variant with extra padding for safe-zone
 *
 * PNG (raster, required by the PWA manifest + iOS touch icon):
 *   - getcito-icon-96.png               Standard, 96×96 (desktop PNG favicon)
 *   - getcito-icon-192.png              Standard, 192×192 (PWA manifest)
 *   - getcito-icon-512.png              Standard, 512×512 (PWA manifest)
 *   - getcito-icon-maskable-192.png     Maskable, 192×192 (PWA manifest)
 *   - getcito-icon-maskable-512.png     Maskable, 512×512 (PWA manifest)
 *   - apple-touch-icon.png           iOS home-screen icon, 180×180, opaque bg
 *
 * ICO (classic Windows favicon, referenced as `/icons/favicon.ico`):
 *   - favicon.ico   Multi-resolution (16, 32, 48) PNG-in-ICO
 *
 * SVGs embed the Titan One WOFF2 font as base64 so they render without any
 * external fetches. PNGs are rasterized with Takumi (same pipeline used by
 * the brand-kit generator) so the glyph matches across formats.
 *
 * Usage:
 *   npx tsx apps/web/scripts/generate-brand-icons.tsx
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "@takumi-rs/image-response";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BRAND_COLOR = "#2563eb";
const OUTPUT_DIR = resolve(__dirname, "../public/icons");

// ---------------------------------------------------------------------------
// SVG icons — hand-built strings with Titan One embedded as base64
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

/**
 * Standard icon — "e" filling nearly the entire 128×128 viewBox, transparent bg.
 *
 * Titan One's lowercase "e" x-height is ~62% of the em size.
 * At font-size 190 the glyph is ~118px tall — nearly filling the 128 box.
 * The y baseline is set so the glyph is vertically centered.
 */
function buildStandardSvg(fontBase64: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <style>${fontFaceRule(fontBase64)}</style>
  <text x="50%" y="93.5%" font-family="'Titan One', sans-serif" font-size="190" font-weight="400" fill="${BRAND_COLOR}" text-anchor="middle">e</text>
</svg>`;
}

/**
 * Maskable icon — "e" inside the safe-zone (inner ~80%) of a 128×128 box.
 * White background so adaptive icon contexts have a clean fill.
 * The glyph is sized to nearly fill the safe area.
 */
function buildMaskableSvg(fontBase64: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <style>${fontFaceRule(fontBase64)}</style>
  <rect width="128" height="128" fill="#ffffff"/>
  <text x="50%" y="78%" font-family="'Titan One', sans-serif" font-size="120" font-weight="400" fill="${BRAND_COLOR}" text-anchor="middle">e</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// PNG icons — rendered via Takumi (JSX → image), matches brand-kit sizing
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

mkdirSync(OUTPUT_DIR, { recursive: true });

const fontBase64 = loadFontBase64();

const svgIcons = [
	{ name: "getcito-icon.svg", build: buildStandardSvg },
	{ name: "getcito-icon-maskable.svg", build: buildMaskableSvg },
];

for (const { name, build } of svgIcons) {
	writeFileSync(resolve(OUTPUT_DIR, name), build(fontBase64), "utf-8");
	console.log(`  ✓ ${name}`);
}

const pngIcons = [
	{ name: "getcito-icon-96.png", element: <StandardIcon size={96} />, size: 96 },
	{ name: "getcito-icon-192.png", element: <StandardIcon size={192} />, size: 192 },
	{ name: "getcito-icon-512.png", element: <StandardIcon size={512} />, size: 512 },
	{ name: "getcito-icon-maskable-192.png", element: <MaskableIcon size={192} />, size: 192 },
	{ name: "getcito-icon-maskable-512.png", element: <MaskableIcon size={512} />, size: 512 },
	// Apple touch icons must be opaque — iOS otherwise adds its own background.
	{ name: "apple-touch-icon.png", element: <StandardIcon bg="#ffffff" size={180} />, size: 180 },
];

for (const { name, element, size } of pngIcons) {
	const buffer = await renderPng(element, size);
	writeFileSync(resolve(OUTPUT_DIR, name), buffer);
	console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
// ICO — multi-resolution PNG-in-ICO built from Takumi-rendered PNGs.
// Kept at /icons/favicon.ico (not /favicon.ico at the root) so whitelabel
// deployments don't end up serving Getcito's ICO for default browser requests.
// ---------------------------------------------------------------------------

// Transparent background — browsers rasterize this onto the tab strip, which
// is often dark-themed. apple-touch-icon above keeps its white bg because iOS
// would otherwise composite it onto its own (usually dark) background.
const icoPngs: Buffer[] = [];
for (const size of [16, 32, 48]) {
	icoPngs.push(await renderPng(<StandardIcon size={size} />, size));
}
writeFileSync(resolve(OUTPUT_DIR, "favicon.ico"), await pngToIco(icoPngs));
console.log("  ✓ favicon.ico");

console.log(`\nIcons written to ${OUTPUT_DIR}`);
