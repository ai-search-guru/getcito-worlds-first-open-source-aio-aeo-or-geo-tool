#!/usr/bin/env node

/**
 * Fetches Ahrefs DR and traffic for a domain via the RapidAPI Domain Metrics Check API.
 *
 * Usage: node scripts/fetch-domain-metrics.mjs <domain>
 *
 * Output: JSON with ahrefsDR and ahrefsTraffic fields.
 *
 * Required env vars (loaded from apps/www/.env):
 *   RAPIDAPI_KEY
 */

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

const domain = process.argv[2];

if (!domain) {
	console.error("Usage: node scripts/fetch-domain-metrics.mjs <domain>");
	process.exit(1);
}

const apiKey = process.env.RAPIDAPI_KEY;
if (!apiKey) {
	console.error("Missing RAPIDAPI_KEY env var");
	process.exit(1);
}

const url = `https://domain-metrics-check.p.rapidapi.com/domain-metrics/${domain}/`;

const res = await fetch(url, {
	method: "GET",
	headers: {
		"Content-Type": "application/json",
		"x-rapidapi-host": "domain-metrics-check.p.rapidapi.com",
		"x-rapidapi-key": apiKey,
	},
});

if (!res.ok) {
	const body = await res.text();
	console.error(`API error ${res.status}: ${body}`);
	process.exit(1);
}

const data = await res.json();

const result = {
	domain: data.domain || domain,
	ahrefsDR: data.ahrefsDR ?? 0,
	ahrefsTraffic: Math.round(data.ahrefsTraffic ?? 0),
};

console.log(JSON.stringify(result));
