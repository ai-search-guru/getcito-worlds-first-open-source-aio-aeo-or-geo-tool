#!/usr/bin/env node

/**
 * Takes a screenshot of a competitor's homepage via ScreenshotOne
 * and uploads it to Vercel Blob Storage.
 *
 * Usage: node scripts/screenshot-competitor.mjs <slug> <url>
 *
 * Required env vars (loaded from apps/www/.env):
 *   SCREENSHOT_ONE_ACCESS_KEY
 *   BLOB_READ_WRITE_TOKEN
 */

import { put } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file
const envPath = resolve(__dirname, "../.env");
try {
	const envContent = readFileSync(envPath, "utf-8");
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
		if (!process.env[key]) process.env[key] = value;
	}
} catch {
	// .env is optional if vars are already set
}

const slug = process.argv[2];
const url = process.argv[3];

if (!slug || !url) {
	console.error("Usage: node scripts/screenshot-competitor.mjs <slug> <url>");
	process.exit(1);
}

const accessKey = process.env.SCREENSHOT_ONE_ACCESS_KEY;
if (!accessKey) {
	console.error("Missing SCREENSHOT_ONE_ACCESS_KEY env var");
	process.exit(1);
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
	console.error("Missing BLOB_READ_WRITE_TOKEN env var");
	process.exit(1);
}

const screenshotUrl = new URL("https://api.screenshotone.com/take");
screenshotUrl.searchParams.set("access_key", accessKey);
screenshotUrl.searchParams.set("url", url);
screenshotUrl.searchParams.set("format", "jpg");
screenshotUrl.searchParams.set("image_quality", "80");
screenshotUrl.searchParams.set("viewport_width", "1280");
screenshotUrl.searchParams.set("viewport_height", "800");
screenshotUrl.searchParams.set("block_ads", "true");
screenshotUrl.searchParams.set("block_cookie_banners", "true");
screenshotUrl.searchParams.set("full_page", "false");

console.log(`Taking screenshot of ${url}...`);

const screenshotRes = await fetch(screenshotUrl.toString());
if (!screenshotRes.ok) {
	const body = await screenshotRes.text();
	console.error(`ScreenshotOne API error ${screenshotRes.status}: ${body}`);
	process.exit(1);
}

const imageBuffer = await screenshotRes.arrayBuffer();
console.log(`Screenshot captured (${Math.round(imageBuffer.byteLength / 1024)} KB)`);

console.log(`Uploading to Vercel Blob as screenshots/${slug}.jpg...`);

const blob = await put(`screenshots/${slug}.jpg`, Buffer.from(imageBuffer), {
	access: "public",
	contentType: "image/jpeg",
	addRandomSuffix: false,
});

console.log(`Uploaded: ${blob.url}`);
