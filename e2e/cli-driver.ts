/**
 * CLI Driver for E2E Tests
 *
 * Drives `getcito init --dev` through a real PTY by wrapping the CLI in
 * script(1). script(1) is preinstalled on Ubuntu (util-linux) and macOS
 * (BSD), so we avoid native addons / node-gyp / prebuild-binary forks.
 *
 * The driver pattern-matches on prompt substrings and writes keystrokes
 * to the child's stdin, so we exercise the same interactive wizard a
 * human user would see.
 *
 * The CLI writes config to `~/.getcito`. To redirect that to a test-local
 * directory without polluting the runner's real home, we set HOME on the
 * child process so `os.homedir()` resolves to the parent of <config-dir>.
 * The supplied <config-dir> must therefore end in `.getcito`.
 *
 * Usage: tsx cli-driver.ts <config-dir> <repo-root>
 */
import { spawn } from "node:child_process";
import path from "node:path";

const configDir = process.argv[2];
const repoRoot = process.argv[3];

if (!configDir || !repoRoot) {
	console.error("Usage: tsx cli-driver.ts <config-dir> <repo-root>");
	process.exit(1);
}

if (path.basename(configDir) !== ".getcito") {
	console.error(`config-dir must end in ".getcito" (got ${configDir})`);
	process.exit(1);
}

const cliHome = path.dirname(configDir);
const cliPath = path.join(repoRoot, "apps/cli/dist/index.js");
const nodeBin = process.execPath;

console.error(`  [driver] config-dir: ${configDir}`);
console.error(`  [driver] cli-home:   ${cliHome}`);
console.error(`  [driver] repo-root:  ${repoRoot}`);
console.error(`  [driver] cli-path:   ${cliPath}`);

const ENTER = "\r";
const ARROW_LEFT = "\x1b[D";
const ARROW_DOWN = "\x1b[B";

// Strip ANSI CSI + OSC sequences so we can substring-match clack's rendered output.
function stripAnsi(s: string): string {
	return s
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

function shEscape(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Wrap the CLI in script(1). BSD (macOS) and util-linux (Ubuntu) script
// take different args for running a command, so split on platform.
function spawnViaScript() {
	const env = {
		...process.env,
		HOME: cliHome,
		FORCE_COLOR: "0",
		NO_COLOR: "1",
		TERM: "xterm-256color",
	};
	const cliArgs = [nodeBin, cliPath, "init", "--dev"];

	if (process.platform === "darwin") {
		// BSD script: `script [-q] file command...` — propagates child exit code.
		return spawn("script", ["-q", "/dev/null", ...cliArgs], {
			cwd: repoRoot,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}
	// util-linux script: `script -q -e -f -c "cmd" file`
	//   -e returns the child's exit status, -f flushes output on each write.
	// When script's own stdout is a pipe the PTY gets sized 0x0, which makes
	// clack wrap every char — `stty rows/cols` inside the PTY fixes that.
	const cmd = `stty rows 40 cols 120; exec ${cliArgs.map(shEscape).join(" ")}`;
	return spawn(
		"script",
		["-q", "-e", "-f", "-c", cmd, "/dev/null"],
		{ cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] },
	);
}

const child = spawnViaScript();
let buffer = "";
let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;

child.stdout?.on("data", (data: Buffer) => {
	process.stderr.write(data);
	buffer += stripAnsi(data.toString("utf8"));
	if (buffer.length > 32_000) buffer = buffer.slice(-16_000);
});
child.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
child.on("exit", (code, signal) => {
	exited = { code, signal };
});
child.on("error", (err) => {
	console.error(`\n  [driver] spawn error: ${err.message}`);
	process.exit(1);
});

async function waitFor(pattern: string, timeoutMs = 60_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (exited) {
			throw new Error(
				`CLI exited (code=${exited.code}) before prompt: "${pattern}"`,
			);
		}
		const idx = buffer.indexOf(pattern);
		if (idx !== -1) {
			buffer = buffer.slice(idx + pattern.length);
			return;
		}
		await new Promise((r) => setTimeout(r, 40));
	}
	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for prompt: "${pattern}"\n` +
			`-- recent output --\n${buffer.slice(-2000)}`,
	);
}

async function send(s: string, settleMs = 120): Promise<void> {
	child.stdin?.write(s);
	await new Promise((r) => setTimeout(r, settleMs));
}

async function waitForExit(timeoutMs = 30_000): Promise<number> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (exited) return exited.code ?? 0;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("CLI did not exit within timeout");
}

async function main(): Promise<void> {
	// Dev mode → docker dir prompt (default "docker")
	await waitFor("Path to docker directory");
	await send(ENTER);

	// Postgres mode select — default "Run Postgres in Docker"
	await waitFor("PostgreSQL connection");
	await send(ENTER);

	// Setup mode select — default is "Recommended"; arrow-down to "Custom" so
	// we exercise the multi-provider path with placeholder keys.
	await waitFor("Setup mode");
	await send(ARROW_DOWN);
	await send(ENTER);

	// ── Step 1: Direct LLM APIs (loops until at least one is configured) ──
	// The loop asks providers in the same order as the auto-pick preference:
	// OpenRouter → Anthropic → OpenAI → Mistral. We say Yes to Anthropic and
	// OpenAI to keep the resulting .env close to the pre-refactor shape.

	// OpenRouter confirm (default No) → No
	await waitFor("Configure OpenRouter?");
	await send(ENTER);

	// Anthropic confirm (default No) → Yes
	await waitFor("Configure Anthropic API?");
	await send(ARROW_LEFT);
	await send(ENTER);
	await waitFor("Anthropic API key");
	await send(`sk-ant-placeholder-not-used${ENTER}`);
	await waitFor("Claude model");
	await send(ENTER); // accept default slug
	await waitFor("Enable web search?");
	await send(ARROW_LEFT);
	await send(ENTER); // No — target becomes claude:anthropic-api:<slug> without :online

	// OpenAI confirm (default No) → Yes
	await waitFor("Configure OpenAI API?");
	await send(ARROW_LEFT);
	await send(ENTER);
	await waitFor("OpenAI API key");
	await send(`sk-placeholder-not-used${ENTER}`);
	await waitFor("OpenAI model");
	await send(ENTER); // accept default gpt-5-mini
	await waitFor("Enable web search?");
	await send(ENTER); // Yes — chatgpt:openai-api:gpt-5-mini:online

	// Mistral confirm (default No) → No
	await waitFor("Configure Mistral API?");
	await send(ENTER);

	// ── Step 2: Scrapers + DataForSEO (optional) ──────────────────────────

	// BrightData confirm (default Yes) → No
	await waitFor("Configure BrightData?");
	await send(ARROW_LEFT);
	await send(ENTER);

	// Oxylabs confirm (default No) → No
	await waitFor("Configure Oxylabs?");
	await send(ENTER);

	// Olostep confirm (default No) → No
	await waitFor("Configure Olostep?");
	await send(ENTER);

	// DataForSEO confirm (default No) → Yes (placeholder creds, no extra target)
	await waitFor("Configure DataForSEO?");
	await send(ARROW_LEFT);
	await send(ENTER);
	await waitFor("DataForSEO login");
	await send(`placeholder@e2e.test${ENTER}`);
	await waitFor("DataForSEO password");
	await send(`placeholder-not-used${ENTER}`);
	// DataForSEO engine multiselect (google-ai-mode pre-selected). Toggle it off
	// and submit an empty selection to keep this run's targets unchanged.
	await waitFor("LLM Providers to track via DataForSEO");
	await send(" "); // deselect the pre-selected google-ai-mode
	await send(ENTER); // submit with nothing selected → no DataForSEO target

	// SCRAPE_TARGETS edit confirm (default No)
	await waitFor("Edit SCRAPE_TARGETS before saving?");
	await send(ENTER);

	// Telemetry opt-in (default Yes) → No
	await waitFor("Share telemetry?");
	await send(ARROW_LEFT);
	await send(ENTER);

	// Product updates email (optional)
	await waitFor("email to receive product updates");
	await send(ENTER);

	// Web app port (default 1515) → accept default
	await waitFor("Web app port");
	await send(ENTER);

	// Start the stack now? (default Yes) → No
	await waitFor("Start the stack now?");
	await send(ARROW_LEFT);
	await send(ENTER);

	const code = await waitForExit();
	if (code !== 0) {
		throw new Error(`CLI exited with code ${code}`);
	}
	console.error("\n  [driver] CLI completed successfully");
}

const overallTimeout = setTimeout(() => {
	console.error("\n  [driver] TIMEOUT: wizard did not complete within 120s");
	try {
		child.kill("SIGTERM");
	} catch {}
	process.exit(1);
}, 120_000);
overallTimeout.unref();

main().catch((err) => {
	console.error(
		`\n  [driver] ERROR: ${err instanceof Error ? err.message : err}`,
	);
	try {
		child.kill("SIGTERM");
	} catch {}
	process.exit(1);
});
