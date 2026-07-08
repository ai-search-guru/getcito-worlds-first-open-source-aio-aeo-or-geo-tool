#!/usr/bin/env tsx
/**
 * Multi-provider comparison harness for the brand-analysis (onboarding)
 * pipeline. Builds the production analysis context once (same prompt, same
 * schema, same website excerpt that `analyzeBrand` would use) and runs every
 * configured direct-API provider in parallel against it. Reports elapsed
 * time, model, branded-prompt count, and tag vocabulary so you can compare
 * providers without prompt drift.
 *
 * Providers compared (each must have its API key in env to participate):
 *   - openai-api:    OpenAI Responses API + native web_search tool
 *   - openrouter:    OpenRouter chat/completions + plugins:[{web,native}]
 *   - anthropic-api: Anthropic Messages API + web_search_20250305 tool
 *   - mistral-api:   Mistral Conversations API + web_search tool
 *
 * Usage:
 *   pnpm --filter @workspace/lib compare:onboarding nike.com
 *   pnpm --filter @workspace/lib compare:onboarding nike.com --max-prompts 30 --max-competitors 12
 *   pnpm --filter @workspace/lib compare:onboarding nike.com --only anthropic-api,openrouter
 *   pnpm --filter @workspace/lib compare:onboarding nike.com --skip mistral-api
 *   pnpm --filter @workspace/lib compare:onboarding nike.com --env-file ~/code/Getcito/apps/web/.env
 *
 * Reads `<repo>/apps/web/.env` and `<repo>/.env` automatically; --env-file
 * PATH overrides. Real env vars always win over .env entries.
 */
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getProvider } from "../src/providers";
import { RESEARCH_PROVIDER_PREFERENCE, type ResearchProviderId } from "../src/onboarding/llm";
import {
	buildAnalysisContext,
	normalizeAnalysisResult,
	type AnalysisContext,
	type OnboardingSuggestion,
} from "../src/onboarding/analyze";
import { isPromptBranded } from "../src/tag-utils";

type ProviderId = ResearchProviderId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveHomePath(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return resolve(p);
}

/**
 * Race a promise against a timeout and reject with a clear message if it
 * didn't resolve in time. Note: the underlying LLM call keeps running and
 * billing tokens — providers that accept an AbortSignal would need plumbing
 * through StructuredResearchOptions to actually stop.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${(timeoutMs / 1000).toFixed(0)}s`)),
			timeoutMs,
		);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function loadDotEnv(path: string): Promise<void> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch {
		return;
	}
	for (const line of contents.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

// ---------------------------------------------------------------------------
// Per-provider runner
// ---------------------------------------------------------------------------

interface RunResult {
	providerId: ProviderId;
	model: string;
	elapsedMs: number;
	suggestion: OnboardingSuggestion;
	/** Number of suggestedPrompts production would classify as "branded". */
	brandedCount: number;
}

interface RunFailure {
	providerId: ProviderId;
	error: string;
	elapsedMs: number;
}

async function runProvider(providerId: ProviderId, ctx: AnalysisContext, timeoutMs: number): Promise<RunResult> {
	const provider = getProvider(providerId);
	if (!provider.isConfigured()) throw new Error(`${providerId}: not configured (missing API key in env)`);
	if (!provider.runStructuredResearch) throw new Error(`${providerId}: provider doesn't implement structured research`);

	const start = Date.now();
	const result = await withTimeout(
		provider.runStructuredResearch({ prompt: ctx.prompt, schema: ctx.schema }),
		timeoutMs,
		`${providerId} engine`,
	);
	const elapsedMs = Date.now() - start;
	const suggestion = normalizeAnalysisResult(result.object, ctx);
	const brandedCount = suggestion.suggestedPrompts.filter((p) =>
		isPromptBranded(p.prompt, suggestion.brandName, suggestion.website),
	).length;
	return {
		providerId,
		model: result.modelVersion ?? "(unknown)",
		elapsedMs,
		suggestion,
		brandedCount,
	};
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(2)}s`;
}

function tagVocabOf(s: OnboardingSuggestion): string[] {
	const set = new Set<string>();
	for (const p of s.suggestedPrompts) for (const t of p.tags) set.add(t);
	return [...set].sort();
}

function summary(r: RunResult): string {
	const tags = tagVocabOf(r.suggestion);
	return [
		`  provider:  ${r.providerId}`,
		`  model:     ${r.model}`,
		`  elapsed:   ${formatMs(r.elapsedMs)}`,
		`  brand:     ${r.suggestion.brandName}`,
		`  domains:   ${r.suggestion.additionalDomains.length}`,
		`  aliases:   ${r.suggestion.aliases.length}`,
		`  competit:  ${r.suggestion.competitors.length}`,
		`  prompts:   ${r.suggestion.suggestedPrompts.length} (${r.brandedCount} branded by name)`,
		`  tag vocab: ${tags.length} distinct — ${tags.join(", ") || "(none)"}`,
	].join("\n");
}

/** RFC 4180-style CSV escaping: wrap in quotes if needed, double internal quotes. */
function csvEscape(value: string | number | undefined | null): string {
	if (value === undefined || value === null) return "";
	const s = String(value);
	if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

const CSV_HEADERS = [
	"provider",
	"status",
	"model",
	"elapsed_s",
	"brand",
	"domains",
	"aliases",
	"competitors",
	"prompts",
	"branded_by_name",
	"tag_vocab_size",
	"tags",
	"error",
] as const;

function rowFromResult(r: RunResult): string {
	const tags = tagVocabOf(r.suggestion);
	const cells = [
		r.providerId,
		"ok",
		r.model,
		(r.elapsedMs / 1000).toFixed(2),
		r.suggestion.brandName,
		r.suggestion.additionalDomains.length,
		r.suggestion.aliases.length,
		r.suggestion.competitors.length,
		r.suggestion.suggestedPrompts.length,
		r.brandedCount,
		tags.length,
		tags.join(","),
		"",
	];
	return cells.map(csvEscape).join(",");
}

function rowFromFailure(f: RunFailure): string {
	// Header has 13 columns: provider, status, model, elapsed_s, then 8 empty
	// metric/output cells, then error.
	const cells: (string | number)[] = [
		f.providerId,
		"failed",
		"", // model
		(f.elapsedMs / 1000).toFixed(2),
		...Array(8).fill(""),
		f.error.split("\n")[0],
	];
	return cells.map(csvEscape).join(",");
}

const PROMPT_CSV_HEADERS = ["provider", "prompt_index", "prompt", "tags"] as const;

function promptRowsFromResult(r: RunResult): string[] {
	return r.suggestion.suggestedPrompts.map((p, i) => {
		const cells = [r.providerId, i + 1, p.prompt, p.tags.join(",")];
		return cells.map(csvEscape).join(",");
	});
}

function tabulatedComparison(results: RunResult[]): string {
	if (results.length === 0) return "";
	const sorted = [...results].sort((a, b) => a.elapsedMs - b.elapsedMs);
	const lines = ["", "----- COMPARISON (sorted by elapsed time, fastest first) -----", ""];
	const colName = "provider";
	const nameWidth = Math.max(colName.length, ...sorted.map((r) => r.providerId.length));
	lines.push(
		`  ${colName.padEnd(nameWidth)}  ${"time".padStart(8)}  ${"branded".padStart(8)}  ${"competit".padStart(8)}  ${"tag vocab".padStart(10)}`,
	);
	for (const r of sorted) {
		const tags = tagVocabOf(r.suggestion);
		lines.push(
			`  ${r.providerId.padEnd(nameWidth)}  ${formatMs(r.elapsedMs).padStart(8)}  ${String(r.brandedCount).padStart(8)}  ${String(r.suggestion.competitors.length).padStart(8)}  ${String(tags.length).padStart(10)}`,
		);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function isProviderId(id: string): id is ProviderId {
	return (RESEARCH_PROVIDER_PREFERENCE as readonly string[]).includes(id);
}

async function main() {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"max-prompts": { type: "string" },
			"max-competitors": { type: "string" },
			only: { type: "string" },
			skip: { type: "string" },
			"env-file": { type: "string" },
			timeout: { type: "string", default: "180" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help || positionals.length === 0) {
		console.error("Usage: tsx compare-onboarding.ts <website> [options]");
		console.error("");
		console.error("Options:");
		console.error("  --max-prompts N       Pass through to analyzeBrand (default: production default)");
		console.error("  --max-competitors N   Pass through to analyzeBrand (default: production default)");
		console.error(`  --only IDS            Comma-separated provider IDs (default all of: ${RESEARCH_PROVIDER_PREFERENCE.join(",")})`);
		console.error("  --skip IDS            Comma-separated provider IDs to skip");
		console.error("  --env-file PATH       Load API keys from this .env before defaults");
		console.error("  --timeout SECONDS     Hard timeout per provider (default 180)");
		console.error("");
		console.error("Each provider needs its own API key in env to participate;");
		console.error("missing-key providers are silently skipped, not treated as failures.");
		console.error("");
		console.error("Example:");
		console.error("  pnpm --filter @workspace/lib compare:onboarding nike.com");
		console.error("  pnpm --filter @workspace/lib compare:onboarding nike.com --only anthropic-api,openrouter");
		console.error("  pnpm --filter @workspace/lib compare:onboarding nike.com --env-file ~/code/Getcito/apps/web/.env");
		process.exit(values.help ? 0 : 1);
	}

	const website = positionals[0];
	const maxPrompts = values["max-prompts"] !== undefined ? Number(values["max-prompts"]) : undefined;
	const maxCompetitors = values["max-competitors"] !== undefined ? Number(values["max-competitors"]) : undefined;
	const timeoutMs = Number(values.timeout) * 1000;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
		console.error("--timeout must be a positive number of seconds (>=1)");
		process.exit(1);
	}

	if (values["env-file"]) {
		const explicit = resolveHomePath(values["env-file"]);
		try {
			await readFile(explicit, "utf8");
		} catch (err) {
			console.error(`--env-file ${explicit} could not be read: ${err instanceof Error ? err.message : err}`);
			process.exit(1);
		}
		await loadDotEnv(explicit);
	}
	const repoRoot = join(import.meta.dirname ?? __dirname, "..", "..", "..");
	await loadDotEnv(join(repoRoot, "apps", "web", ".env"));
	await loadDotEnv(join(repoRoot, ".env"));

	// Determine which providers to run.
	const onlyList = parseList(values.only);
	const skipList = parseList(values.skip);
	for (const id of [...onlyList, ...skipList]) {
		if (!isProviderId(id)) {
			console.error(`Unknown provider id: "${id}". Valid: ${RESEARCH_PROVIDER_PREFERENCE.join(", ")}`);
			process.exit(1);
		}
	}
	const targets = (onlyList.length > 0 ? onlyList : [...RESEARCH_PROVIDER_PREFERENCE]).filter(
		(id): id is ProviderId => isProviderId(id) && !skipList.includes(id),
	);
	if (targets.length === 0) {
		console.error("No providers to run after applying --only / --skip filters.");
		process.exit(1);
	}

	// Build the same analysis context production would build — once. Every
	// provider gets identical prompt + schema + excerpt.
	const ctx = await buildAnalysisContext({
		website,
		...(maxCompetitors !== undefined ? { maxCompetitors } : {}),
		...(maxPrompts !== undefined ? { maxPrompts } : {}),
	});

	const results: RunResult[] = [];
	const failures: RunFailure[] = [];

	const runs = targets.map(async (providerId): Promise<void> => {
		const provider = getProvider(providerId);
		if (!provider.isConfigured()) {
			console.error(`○ ${providerId}: skipped (no API key configured)`);
			return;
		}
		console.error(`→ ${providerId}: starting`);
		const start = Date.now();
		try {
			const result = await runProvider(providerId, ctx, timeoutMs);
			console.error(`✓ ${providerId}: done in ${formatMs(result.elapsedMs)}`);
			results.push(result);
		} catch (err) {
			const elapsedMs = Date.now() - start;
			const message = err instanceof Error ? err.message : String(err);
			console.error(`✗ ${providerId}: failed after ${formatMs(elapsedMs)} — ${message.split("\n")[0]}`);
			failures.push({ providerId, error: message, elapsedMs });
		}
	});
	await Promise.all(runs);

	// Print full per-provider summary blocks + tabulated comparison to stderr
	// (human-readable). Stdout gets just the CSV so `> results.csv` captures
	// clean parseable output.
	if (results.length > 0) {
		console.error("\n========== SUMMARY ==========");
		for (const r of results) {
			console.error(`\n[${r.providerId}]`);
			console.error(summary(r));
		}
	}
	for (const f of failures) {
		console.error(`\n[${f.providerId}] FAILED`);
		console.error(`  ${f.error.split("\n").join("\n  ")}`);
	}
	if (results.length >= 2) {
		console.error(tabulatedComparison(results));
	}

	// Two CSV blocks on stdout, separated by a blank line:
	//   1. Summary — one row per provider (success or failure)
	//   2. Prompts — one row per (provider, prompt) so you can compare the
	//      actual prompt text + tags side-by-side across providers
	// awk '/^$/{n++;next} {print > "out"n".csv"}' splits them; pandas can
	// read one section at a time with skiprows + nrows.
	console.log(CSV_HEADERS.join(","));
	for (const r of results) console.log(rowFromResult(r));
	for (const f of failures) console.log(rowFromFailure(f));

	console.log("");
	console.log(PROMPT_CSV_HEADERS.join(","));
	for (const r of results) for (const row of promptRowsFromResult(r)) console.log(row);

	if (results.length === 0) process.exit(1);
}

main().catch((err) => {
	console.error("Error:", err instanceof Error ? err.stack || err.message : err);
	process.exit(1);
});
