#!/usr/bin/env tsx
// biome-ignore lint/correctness/noUnusedImports: classic JSX transform needs React
import React from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "@takumi-rs/image-response";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadFont(path: string): ArrayBuffer {
	const buf = readFileSync(require.resolve(path));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const fonts = [
	{
		name: "Titan One",
		data: loadFont(
			"@fontsource/titan-one/files/titan-one-latin-400-normal.woff2",
		),
		style: "normal" as const,
		weight: 400 as const,
	},
	{
		name: "Geist Sans",
		data: loadFont(
			"@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2",
		),
		style: "normal" as const,
		weight: 500 as const,
	},
	{
		name: "Geist Sans",
		data: loadFont(
			"@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2",
		),
		style: "normal" as const,
		weight: 600 as const,
	},
	{
		name: "Geist Sans",
		data: loadFont(
			"@fontsource/geist-sans/files/geist-sans-latin-700-normal.woff2",
		),
		style: "normal" as const,
		weight: 700 as const,
	},
	{
		name: "Geist Mono",
		data: loadFont(
			"@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2",
		),
		style: "normal" as const,
		weight: 500 as const,
	},
];

const BRAND_BLUE = "#2563eb";
const ZINC_50 = "#fafafa";
const ZINC_200 = "#e4e4e7";
const ZINC_400 = "#a1a1aa";
const ZINC_500 = "#71717a";
const ZINC_600 = "#52525b";
const ZINC_700 = "#3f3f46";
const ZINC_950 = "#09090b";

// ---------------------------------------------------------------------------
// Page variant — Mux poster on the homepage hero. Branding is already on the
// surrounding page, so the poster is reduced to a single "watch this"
// message at a size that survives the player's actual render width.
// ---------------------------------------------------------------------------

function PagePoster() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				padding: 64,
				backgroundColor: "#ffffff",
				position: "relative",
			}}
		>
			{/* faint dot grid — mirrors the hero section background */}
			<div
				style={{
					display: "flex",
					position: "absolute",
					inset: 0,
					backgroundImage:
						"radial-gradient(rgba(0,0,0,0.07) 1.4px, transparent 1.4px)",
					backgroundSize: "44px 44px",
				}}
			/>
			{/* soft brand-blue wash in the upper-right corner */}
			<div
				style={{
					display: "flex",
					position: "absolute",
					inset: 0,
					backgroundImage:
						"radial-gradient(ellipse 80% 70% at 85% 10%, rgba(37,99,235,0.14) 0%, transparent 65%)",
				}}
			/>
			{/* ghost "e" — same watermark device the OG image uses, blue at low
			    opacity so it reads as a brand mark, not a letter */}
			<div
				style={{
					display: "flex",
					position: "absolute",
					fontFamily: "Titan One",
					fontSize: 900,
					color: "rgba(37,99,235,0.07)",
					lineHeight: 1,
					right: -120,
					top: -180,
				}}
			>
				e
			</div>

			{/* top: category tag, flush-left with the headline below */}
			<div
				style={{
					display: "flex",
					fontFamily: "Geist Mono",
					fontWeight: 500,
					fontSize: 40,
					color: ZINC_600,
					letterSpacing: 4,
					textTransform: "uppercase",
					position: "relative",
				}}
			>
				Walkthrough
			</div>

			{/* bottom: single-line headline, anchored below the play button */}
			<div
				style={{
					display: "flex",
					alignItems: "baseline",
					gap: 32,
					position: "relative",
				}}
			>
				<div
					style={{
						display: "flex",
						fontFamily: "Geist Sans",
						fontWeight: 600,
						fontSize: 140,
						color: ZINC_950,
						lineHeight: 0.95,
						letterSpacing: -5,
					}}
				>
					See it
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Geist Sans",
						fontWeight: 600,
						fontSize: 140,
						color: BRAND_BLUE,
						lineHeight: 0.95,
						letterSpacing: -5,
					}}
				>
					in action.
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// YouTube variant — white field, brand-blue wordmark, "Open-source AEO" as
// the dominant headline. Echoes the hero section: white background, faint
// dot grid, Geist semibold, sparing blue accent.
// ---------------------------------------------------------------------------

function YouTubeThumbnail() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				padding: 80,
				backgroundColor: "#ffffff",
				position: "relative",
			}}
		>
			<div
				style={{
					display: "flex",
					position: "absolute",
					inset: 0,
					backgroundImage:
						"radial-gradient(rgba(0,0,0,0.11) 1.8px, transparent 1.8px)",
					backgroundSize: "34px 34px",
				}}
			/>
			<div
				style={{
					display: "flex",
					position: "absolute",
					inset: 0,
					backgroundImage:
						"radial-gradient(ellipse 70% 60% at 100% 100%, rgba(37,99,235,0.18) 0%, transparent 60%)",
				}}
			/>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					position: "relative",
				}}
			>
				<div
					style={{
						display: "flex",
						fontFamily: "Titan One",
						fontSize: 88,
						color: BRAND_BLUE,
						lineHeight: 1,
					}}
				>
					Getcito
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						padding: "10px 18px",
						borderRadius: 999,
						border: `1.5px solid ${ZINC_200}`,
						backgroundColor: "#ffffff",
					}}
				>
					<div
						style={{
							display: "flex",
							width: 10,
							height: 10,
							borderRadius: 999,
							backgroundColor: BRAND_BLUE,
						}}
					/>
					<div
						style={{
							display: "flex",
							fontFamily: "Geist Mono",
							fontWeight: 500,
							fontSize: 22,
							color: ZINC_600,
							letterSpacing: 2,
							textTransform: "uppercase",
						}}
					>
						Product demo
					</div>
				</div>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 28,
					position: "relative",
				}}
			>
				<div
					style={{
						display: "flex",
						fontFamily: "Geist Sans",
						fontWeight: 700,
						fontSize: 168,
						color: ZINC_950,
						lineHeight: 1.0,
						letterSpacing: -6,
					}}
				>
					Open Source
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Geist Sans",
						fontWeight: 700,
						fontSize: 168,
						color: BRAND_BLUE,
						lineHeight: 1.0,
						letterSpacing: -6,
					}}
				>
					AEO
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					position: "relative",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 14,
					}}
				>
					<div
						style={{
							display: "flex",
							width: 6,
							height: 32,
							backgroundColor: BRAND_BLUE,
							borderRadius: 2,
						}}
					/>
					<div
						style={{
							display: "flex",
							fontFamily: "Geist Sans",
							fontWeight: 500,
							fontSize: 32,
							color: ZINC_700,
						}}
					>
						Track your brand across every AI model.
					</div>
				</div>
				<div
					style={{
						display: "flex",
						fontFamily: "Geist Mono",
						fontWeight: 500,
						fontSize: 24,
						color: ZINC_500,
						letterSpacing: 1,
					}}
				>
					Getcito.com
				</div>
			</div>
		</div>
	);
}

async function render(
	element: React.ReactElement,
	out: string,
): Promise<void> {
	const response = new ImageResponse(element, {
		width: 1280,
		height: 720,
		fonts,
	});
	writeFileSync(out, Buffer.from(await response.arrayBuffer()));
	console.log(`Wrote ${out}`);
}

async function main() {
	// Page poster ships with the site as a static asset so MuxPlayer can use
	// it as the `poster` while the video metadata loads.
	await render(
		<PagePoster />,
		resolve(__dirname, "../public/demo-poster.png"),
	);
	// YouTube variant is hand-uploaded; keep it out of the repo.
	await render(
		<YouTubeThumbnail />,
		resolve(__dirname, "../../../.context/demo-poster-youtube.png"),
	);
}

main();
