#!/usr/bin/env tsx
/**
 * Generates the Getcito brand kit as a zip of PNGs using Takumi (JSX → Image).
 *
 * Output: apps/web/getcito-brand-kit.zip
 *
 *   Icons (square, "e" glyph):
 *     getcito-icon-{size}.png              Transparent background
 *     getcito-icon-white-{size}.png        White background
 *     getcito-icon-dark-{size}.png         Dark background
 *     getcito-icon-maskable-{size}.png     Maskable/PWA (white bg, safe-zone padding)
 *
 *   Logos ("Getcito" wordmark, sm/md/lg × 3 backgrounds):
 *     getcito-logo[-white|-dark]-{sm|md|lg}.png
 *
 *   OG images (1200×630):
 *     og-default.png                    Default Open Graph image
 *
 *   Social banners:
 *     twitter-banner.png                3000×1000 (Twitter/X header)
 *     linkedin-banner.png               3384×573 (LinkedIn personal)
 *
 * Usage:
 *   pnpm --filter @workspace/web generate-brand-kit
 */
import { readFileSync, createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "@takumi-rs/image-response";
import { ZipArchive } from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BRAND_COLOR = "#2563eb";
const ACCENT_COLORS = ["#2563eb", "#f4d35e", "#ee964b", "#f95738"];
const TAGLINE = "AI Search Optimization";
const DESCRIPTION = "Track and optimize your brand's visibility across AI models.";
const OUTPUT_ZIP = resolve(__dirname, "../getcito-brand-kit.zip");

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

function loadFont(path: string): ArrayBuffer {
	const buf = readFileSync(require.resolve(path));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const fonts = [
	{
		name: "Titan One",
		data: loadFont("@fontsource/titan-one/files/titan-one-latin-400-normal.woff2"),
		style: "normal" as const,
		weight: 400 as const,
	},
	{
		name: "Geist Sans",
		data: loadFont("@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2"),
		style: "normal" as const,
		weight: 400 as const,
	},
	{
		name: "Geist Sans",
		data: loadFont("@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2"),
		style: "normal" as const,
		weight: 500 as const,
	},
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function render(
	element: React.ReactElement,
	width: number,
	height: number,
): Promise<Buffer> {
	const response = new ImageResponse(element, {
		width,
		height,
		fonts,
	});
	return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Icon — "e" glyph scaled to fill the canvas
// ---------------------------------------------------------------------------

function Icon({ fill, bg, size }: { fill: string; bg?: string; size: number }) {
	return (
		<div
			tw="flex items-center justify-center w-full h-full"
			style={{ backgroundColor: bg || "transparent" }}
		>
			<div
				style={{
					fontFamily: "Titan One",
					fontSize: size,
					color: fill,
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
// Logo — "Getcito" wordmark with equal padding on all sides
// ---------------------------------------------------------------------------

function Logo({ bg, fontSize }: { bg?: string; fontSize: number }) {
	return (
		<div
			tw="flex items-center justify-center w-full h-full"
			style={{ backgroundColor: bg || "transparent" }}
		>
			<div
				style={{
					fontFamily: "Titan One",
					fontSize,
					color: BRAND_COLOR,
					lineHeight: 1,
				}}
			>
				Getcito
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// PatternBanner — repeating "Getcito" wordmark at an angle, wrapping-paper style.
// ---------------------------------------------------------------------------

function PatternBanner({
	width,
	height,
	bg,
	colors,
	angle,
	fontScale,
}: {
	width: number;
	height: number;
	bg: string;
	colors: readonly string[];
	angle: number;
	fontScale: number;
}) {
	const fontSize = Math.round(height * fontScale);
	const wordWidth = Math.round(fontSize * 3.2);
	const gap = Math.round(fontSize * 0.5);
	const cellWidth = wordWidth + gap;
	const rowHeight = Math.round(fontSize * 1.5);

	const diagonal = Math.ceil(Math.sqrt(width * width + height * height));
	const gridSize = Math.round(diagonal * 1.5);

	const cols = Math.ceil(gridSize / cellWidth) + 2;
	const rows = Math.ceil(gridSize / rowHeight) + 2;

	const offsetX = -Math.round((gridSize - width) / 2);
	const offsetY = -Math.round((gridSize - height) / 2);

	const rowElements: React.ReactElement[] = [];
	for (let r = 0; r < rows; r++) {
		const cells: React.ReactElement[] = [];
		const brickOffset = r % 2 === 0 ? 0 : Math.round(cellWidth * 0.5);
		for (let c = 0; c < cols; c++) {
			const colorIdx = (r * 3 + c) % colors.length;
			cells.push(
				<div
					style={{
						fontFamily: "Titan One",
						fontSize,
						color: colors[colorIdx],
						lineHeight: 1,
						marginRight: gap,
					}}
				>
					Getcito
				</div>,
			);
		}
		rowElements.push(
			<div
				style={{
					display: "flex",
					marginLeft: brickOffset,
					height: rowHeight,
					alignItems: "center",
				}}
			>
				{cells}
			</div>,
		);
	}

	return (
		<div
			tw="flex w-full h-full relative overflow-hidden"
			style={{ backgroundColor: bg, opacity: 0.99 }}
		>
			<div
				style={{
					position: "absolute",
					display: "flex",
					flexDirection: "column",
					transform: `rotate(${angle}deg)`,
					left: offsetX,
					top: offsetY,
					width: gridSize,
					height: gridSize,
				}}
			>
				{rowElements}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// OG image
// ---------------------------------------------------------------------------

function OgImage({ title }: { title: string }) {
	return (
		<div
			tw="flex w-full h-full relative overflow-hidden"
			style={{ backgroundColor: "#ffffff" }}
		>
			<div
				style={{
					position: "absolute",
					fontFamily: "Titan One",
					fontSize: 700,
					color: "rgba(37,99,235,0.04)",
					lineHeight: 1,
					right: -60,
					top: -60,
				}}
			>
				e
			</div>

			<div tw="flex flex-col justify-center h-full" style={{ paddingLeft: 80, paddingRight: 80 }}>
				<div
					style={{
						fontFamily: "Titan One",
						fontSize: 80,
						color: BRAND_COLOR,
						lineHeight: 1,
						marginBottom: 28,
					}}
				>
					Getcito
				</div>
			<div
				style={{
					fontFamily: "Geist Sans",
					fontSize: 44,
					fontWeight: 500,
					color: "#1e293b",
					marginBottom: 16,
				}}
			>
				{title}
			</div>
			<div style={{ fontFamily: "Geist Sans", fontSize: 24, color: "#64748b" }}>
				{DESCRIPTION}
			</div>
			</div>

			<div
				style={{
					display: "flex",
					position: "absolute",
					bottom: 0,
					left: 0,
					width: "100%",
					height: 6,
					backgroundImage: `linear-gradient(to right, ${ACCENT_COLORS.join(", ")})`,
				}}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Generate all assets
// ---------------------------------------------------------------------------

const files: { name: string; data: Buffer }[] = [];

async function addFile(name: string, data: Buffer | Promise<Buffer>) {
	const resolved = await data;
	files.push({ name, data: resolved });
	console.log(`  ✓ ${name}`);
}

console.log("Generating brand kit…\n");

// Icons — always brand blue, bg varies
const iconVariants = [
	{ suffix: "", bg: undefined },
	{ suffix: "-white", bg: "#ffffff" },
	{ suffix: "-dark", bg: "#111827" },
];
const iconSizes = [16, 32, 64, 128, 256, 512];

console.log("Icons:");
for (const v of iconVariants) {
	for (const size of iconSizes) {
		await addFile(
			`icons/getcito-icon${v.suffix}-${size}.png`,
			render(<Icon fill={BRAND_COLOR} bg={v.bg} size={size} />, size, size),
		);
	}
}

console.log("\nIcons — Maskable (PWA):");
for (const size of [64, 128, 256, 512]) {
	await addFile(
		`icons/getcito-icon-maskable-${size}.png`,
		render(<MaskableIcon size={size} />, size, size),
	);
}

// Logos — always brand blue text
console.log("\nLogos:");
const logoBgs = [
	{ suffix: "", bg: undefined },
	{ suffix: "-white", bg: "#ffffff" },
	{ suffix: "-dark", bg: "#111827" },
];
const logoSizes = [
	{ label: "sm", fontSize: 64, w: 190, h: 90 },
	{ label: "md", fontSize: 100, w: 290, h: 140 },
	{ label: "lg", fontSize: 160, w: 470, h: 220 },
	{ label: "xl", fontSize: 240, w: 700, h: 330 },
	{ label: "2xl", fontSize: 360, w: 1050, h: 500 },
];
for (const bg of logoBgs) {
	for (const sz of logoSizes) {
		await addFile(
			`logos/getcito-logo${bg.suffix}-${sz.label}.png`,
			render(<Logo bg={bg.bg} fontSize={sz.fontSize} />, sz.w, sz.h),
		);
	}
}

// OG
console.log("\nOG Images:");
const ogData = await render(<OgImage title={TAGLINE} />, 1200, 630);
files.push({ name: "og/og-default.png", data: ogData });
console.log("  ✓ og/og-default.png  (1200×630)");

// Banners — wrapping-paper style, wildly different per platform
console.log("\nSocial Banners:");

const sharedBannerStyle = {
	bg: "#ffffff",
	colors: ["#2563eb", "#f4d35e", "#ee964b", "#f95738", "#93c5fd", "#fbbf24"],
	angle: 15,
} as const;

await addFile(
	"banners/twitter-banner.png",
	render(
		<PatternBanner width={3000} height={1000} {...sharedBannerStyle} fontScale={0.105} />,
		3000,
		1000,
	),
);

await addFile(
	"banners/linkedin-banner.png",
	render(
		<PatternBanner width={3384} height={573} {...sharedBannerStyle} fontScale={0.18} />,
		3384,
		573,
	),
);

// Write zip
console.log("\nPacking zip…");

const output = createWriteStream(OUTPUT_ZIP);
const archive = new ZipArchive({ zlib: { level: 9 } });

const done = new Promise<void>((res, rej) => {
	output.on("close", res);
	archive.on("error", rej);
});

archive.pipe(output);

for (const file of files) {
	archive.append(file.data, { name: file.name });
}

await archive.finalize();
await done;

const zipSize = readFileSync(OUTPUT_ZIP).length;
const kb = (zipSize / 1024).toFixed(1);
console.log(
	`\n✅ getcito-brand-kit.zip (${kb} KB, ${files.length} files) → ${OUTPUT_ZIP}`,
);
