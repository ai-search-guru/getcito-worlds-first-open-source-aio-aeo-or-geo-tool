#!/usr/bin/env tsx
/**
 * Integration test for scraping provider targets.
 * Exercises the same code paths as the worker against real provider APIs.
 * Validates text content, citations, and rawOutput round-trip re-extraction.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online"
 *   pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online,gemini:olostep:online"
 *   pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online" --output-json result.json
 */

import {
	parseScrapeTargets,
	getProvider,
	getModelMeta,
	type ScrapeResult,
} from "@workspace/lib/providers";
import { extractTextContent, extractCitations } from "@workspace/lib/text-extraction";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";

const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
};

function log(message: string, color?: string) {
	console.log(`${color || ""}${message}${colors.reset}`);
}

interface ParsedArgs {
	target: string;
	outputJson?: string;
	dump?: string;
}

function parseArgs(): ParsedArgs {
	const argv = process.argv.slice(2);
	let target: string | undefined;
	let outputJson: string | undefined;
	let dump: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--target" && argv[i + 1]) { target = argv[++i]; continue; }
		if (argv[i] === "--output-json" && argv[i + 1]) { outputJson = argv[++i]; continue; }
		if (argv[i] === "--dump" && argv[i + 1]) { dump = argv[++i]; continue; }
		if (argv[i] === "--help" || argv[i] === "-h") {
			console.log(`
Usage: pnpm tsx --env-file=.env scripts/test-provider.ts --target <scrape-targets> [--output-json <path>] [--dump <path>]

  <scrape-targets>  Comma-separated SCRAPE_TARGETS entries, e.g. "chatgpt:olostep:online,gemini:olostep:online"
                    When multiple targets are provided, they are all tested in parallel.
  --output-json     Write results as JSON to the given path (for CI artifact collection)
  --dump            Write full raw output for each target to the given directory

Examples:
  pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online"
  pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online,gemini:olostep:online"
  pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:olostep:online" --output-json result.json
  pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:brightdata:online" --dump ./dumps
  pnpm tsx --env-file=.env scripts/test-provider.ts --target "chatgpt:oxylabs:online"
`);
			process.exit(0);
		}
	}
	if (!target) {
		console.error("Error: --target is required. Run with --help for usage.");
		process.exit(1);
	}
	return { target, outputJson, dump };
}

function formatLatency(ms: number): string {
	if (ms < 10_000) return `${(ms / 1000).toFixed(3)}s`;
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

const TEST_PROMPTS = [
	"What is a well-reviewed speaker that was released last month?",
	"What were the biggest tech news stories this week?",
	"What is the current price of Bitcoin today?",
	"Who won the most recent Formula 1 race?",
];
const MIN_TEXT_LENGTH = 50;

// Provider/model combos where web queries aren't reported even though web search happens
function hasRealWebQueries(queries: string[]): boolean {
	return queries.length > 0 && !queries.every((q) => q === "unavailable");
}

interface ValidationIssue {
	field: string;
	message: string;
	severity: "error" | "warning";
}

export interface TargetResult {
	target: string;
	status: "pass" | "fail";
	latency: number;
	retries: number;
	error?: string;
	textLength: number;
	rawOutputBytes: number;
	citations: number;
	webQueries: number;
	webSearch: boolean;
	sampleOutput: string;
	issues: ValidationIssue[];
	timestamp: string;
}

function validateResult(result: ScrapeResult, providerId: string, webSearch: boolean): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (!result.textContent || result.textContent.length < MIN_TEXT_LENGTH) {
		issues.push({
			field: "textContent",
			message: `Text too short (${result.textContent?.length ?? 0} chars, need ${MIN_TEXT_LENGTH}+)`,
			severity: "error",
		});
	}

	if (result.textContent?.startsWith("No text content") || result.textContent?.startsWith("Error extracting")) {
		issues.push({
			field: "textContent",
			message: `Extraction returned placeholder: "${result.textContent.slice(0, 60)}"`,
			severity: "error",
		});
	}

	if (result.rawOutput == null) {
		issues.push({ field: "rawOutput", message: "rawOutput is null", severity: "error" });
	}

	if (result.rawOutput != null) {
		const reExtracted = extractTextContent(result.rawOutput, providerId);
		if (reExtracted.startsWith("No text content") || reExtracted.startsWith("Unknown") || reExtracted.startsWith("Error")) {
			issues.push({
				field: "rawOutput re-extraction",
				message: `extractTextContent(rawOutput, "${providerId}") returned: "${reExtracted.slice(0, 80)}"`,
				severity: "error",
			});
		}

		const reExtractedCitations = extractCitations(result.rawOutput, providerId);
		if (result.citations.length > 0 && reExtractedCitations.length === 0) {
			issues.push({
				field: "rawOutput citation re-extraction",
				message: `Provider returned ${result.citations.length} citations but extractCitations(rawOutput, "${providerId}") found 0`,
				severity: "warning",
			});
		}
	}

	if (result.citations.length === 0) {
		issues.push({
			field: "citations",
			message: webSearch
				? "No citations returned (expected when online)"
				: "No citations returned (may be expected for some engines/prompts)",
			severity: webSearch ? "error" : "warning",
		});
	}

	if (webSearch && !hasRealWebQueries(result.webQueries)) {
		const isUnavailable = result.webQueries.some((q) => q === "unavailable");
		issues.push({
			field: "webQueries",
			message: isUnavailable
				? "Web queries unavailable (not exposed by this provider)"
				: "No web queries returned (expected when online)",
			severity: isUnavailable ? "warning" : "error",
		});
	}

	for (const [i, cit] of result.citations.entries()) {
		if (!cit.url || !cit.url.startsWith("http")) {
			issues.push({ field: `citations[${i}].url`, message: `Invalid URL: "${cit.url}"`, severity: "error" });
		}
		if (!cit.domain) {
			issues.push({ field: `citations[${i}].domain`, message: "Missing domain", severity: "error" });
		}
	}

	return issues;
}

async function runTarget(target: string, dumpDir?: string): Promise<{ result: TargetResult; logs: string }> {
	const buffered: string[] = [];
	const tlog = (message: string, color?: string) => {
		buffered.push(`${color || ""}${message}${colors.reset}`);
	};

	const [config] = parseScrapeTargets(target);
	const providerId = config.provider;
	const provider = getProvider(providerId);
	const meta = getModelMeta(config.model);
	const versionStr = config.version ? ` (${config.version})` : "";

	tlog(`\nTesting: ${meta.label} via ${providerId}${versionStr}`, colors.bright);
	tlog(`Web search: ${config.webSearch ? "enabled" : "disabled"}`, colors.dim);
	tlog(`Test prompt: "${TEST_PROMPTS[0]}"`, colors.dim);
	tlog(`Validating: text content (${MIN_TEXT_LENGTH}+ chars), citations, rawOutput re-extraction\n`, colors.dim);

	let attemptStart = Date.now();
	let result: ScrapeResult;
	let retries = 0;
	try {
		result = await provider.run(config.model, TEST_PROMPTS[0], {
			webSearch: config.webSearch,
			version: config.version,
		});
	} catch (error) {
		const latency = Date.now() - attemptStart;
		const errorMsg = error instanceof Error ? error.message : String(error);
		tlog(`FAIL (${formatLatency(latency)})`, colors.red);
		tlog(`  Error: ${errorMsg}`, colors.red);
		return {
			result: {
				target,
				status: "fail",
				latency,
				retries: 0,
				error: errorMsg,
				textLength: 0,
				rawOutputBytes: 0,
				citations: 0,
				webQueries: 0,
				webSearch: config.webSearch,
				sampleOutput: "",
				issues: [],
				timestamp: new Date().toISOString(),
			},
			logs: buffered.join("\n"),
		};
	}

	// Retry with different prompts if web search was expected but no citations/queries came back
	if (config.webSearch && result.citations.length === 0 && !hasRealWebQueries(result.webQueries)) {
		for (let i = 1; i < TEST_PROMPTS.length; i++) {
			tlog(`No citations or web queries — retrying with prompt ${i + 1}/${TEST_PROMPTS.length}: "${TEST_PROMPTS[i]}"`, colors.yellow);
			retries++;
			try {
				attemptStart = Date.now();
				const retry = await provider.run(config.model, TEST_PROMPTS[i], {
					webSearch: config.webSearch,
					version: config.version,
				});
				if (retry.citations.length > 0 || hasRealWebQueries(retry.webQueries)) {
					result = retry;
					break;
				}
			} catch { /* keep previous result */ }
		}
	}

	const latency = Date.now() - attemptStart;
	const rawJson = JSON.stringify(result.rawOutput ?? null, null, 2);
	const rawOutputBytes = Buffer.byteLength(rawJson);
	const issues = validateResult(result, providerId, config.webSearch);
	const hasErrors = issues.some((i) => i.severity === "error");

	if (dumpDir) {
		mkdirSync(dumpDir, { recursive: true });
		const filename = `${dumpDir}/${target.replace(/[/:]/g, "-")}.json`;
		writeFileSync(filename, rawJson);
		tlog(`Dumped raw output to ${filename}`, colors.dim);
	}

	tlog(`Latency:      ${formatLatency(latency)}`, colors.dim);
	tlog(`Text:         ${result.textContent?.length ?? 0} chars`, colors.dim);
	tlog(`Raw output:   ${(rawOutputBytes / 1024).toFixed(1)} KB`, colors.dim);
	tlog(`Citations:    ${result.citations.length}`, colors.blue);
	tlog(`Web queries:  ${result.webQueries.length}`, colors.dim);

	if (result.textContent) {
		tlog("\nSample output:", colors.dim);
		tlog(`  ${result.textContent.slice(0, 300).replace(/\n/g, "\n  ")}`, colors.dim);
	}

	if (issues.length > 0) {
		tlog("\nIssues:", colors.bright);
		for (const issue of issues) {
			const color = issue.severity === "error" ? colors.red : colors.yellow;
			const prefix = issue.severity === "error" ? "ERROR" : "WARN";
			tlog(`  ${prefix}: [${issue.field}] ${issue.message}`, color);
		}
	}

	tlog("");

	if (hasErrors) {
		tlog("FAIL", colors.red);
	} else {
		tlog("PASS", colors.green);
	}

	return {
		result: {
			target,
			status: hasErrors ? "fail" : "pass",
			latency,
			retries,
			textLength: result.textContent?.length ?? 0,
			rawOutputBytes,
			citations: result.citations.length,
			webQueries: result.webQueries.length,
			webSearch: config.webSearch,
			sampleOutput: result.textContent?.slice(0, 500) ?? "",
			issues,
			timestamp: new Date().toISOString(),
		},
		logs: buffered.join("\n"),
	};
}

function writeGitHubSummary(results: TargetResult[]) {
	if (!process.env.GITHUB_STEP_SUMMARY) return;

	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;
	const total = results.length;
	const overallStatus = failed > 0 ? `:x: ${failed} failed` : `:white_check_mark: All passed`;

	const lines: string[] = [
		`## Provider Test Results — ${overallStatus} (${passed}/${total})`,
		"",
		"| Status | Target | Latency | Error | Text | Raw Output | Citations | Web Queries | Web Search | Sample Output |",
		"|--------|--------|---------|-------|------|------------|-----------|-------------|------------|---------------|",
	];

	for (const r of results) {
		const status = r.status === "pass" ? ":white_check_mark:" : ":x:";
		const error = r.error ? r.error.slice(0, 100).replace(/\|/g, "\\|") : "";
		const rawKB = (r.rawOutputBytes / 1024).toFixed(1) + " KB";
		const sample = r.sampleOutput
			? `<details><summary>Show</summary><pre>${r.sampleOutput.replace(/\|/g, "\\|").replace(/\n/g, "<br>")}</pre></details>`
			: "";
		lines.push(
			`| ${status} | \`${r.target}\` | ${formatLatency(r.latency)} | ${error} | ${r.textLength} | ${rawKB} | ${r.citations} | ${r.webQueries} | ${r.webSearch ? "enabled" : "disabled"} | ${sample} |`,
		);
	}

	const allIssues = results.flatMap((r) =>
		r.issues.map((i) => ({ target: r.target, ...i })),
	);

	if (allIssues.length > 0) {
		lines.push("", "### Validation Issues", "");
		lines.push("| Severity | Target | Field | Issue |");
		lines.push("|----------|--------|-------|-------|");
		for (const i of allIssues) {
			const icon = i.severity === "error" ? ":x:" : ":warning:";
			lines.push(`| ${icon} | \`${i.target}\` | \`${i.field}\` | ${i.message} |`);
		}
	}

	lines.push("");
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

async function main() {
	const { target: targetArg, outputJson, dump } = parseArgs();
	const targets = targetArg.split(",").map((t) => t.trim()).filter(Boolean);

	// Run all targets in parallel. Each is almost entirely waiting on an external
	// HTTP call, so there's no benefit to throttling. Logs are buffered per target
	// and flushed as a coherent block when that target finishes, so output from
	// concurrent targets doesn't interleave.
	const pending = targets.map(async (target) => {
		const { result, logs } = await runTarget(target, dump);
		process.stdout.write(`${logs}\n`);
		return result;
	});
	const results = await Promise.all(pending);

	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;

	if (targets.length > 1) {
		log(`\n${"=".repeat(40)}`, colors.bright);
		log(`Results: ${passed} passed, ${failed} failed out of ${targets.length} targets`, failed > 0 ? colors.red : colors.green);
	}

	if (outputJson) {
		writeFileSync(outputJson, JSON.stringify(results, null, 2));
	}
	writeGitHubSummary(results);

	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
