import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENV_REGISTRY } from "./env-registry";

// These tests keep the three env var declaration sites in sync. The registry
// is the source of truth; turbo.json and apps/web/src/env.d.ts must match it.

const turboJsonPath = fileURLToPath(new URL("../../../turbo.json", import.meta.url));
const envDtsPath = fileURLToPath(new URL("../../../apps/web/src/env.d.ts", import.meta.url));

describe("ENV_REGISTRY", () => {
	it("has no duplicate names", () => {
		const names = ENV_REGISTRY.map((spec) => spec.name);
		expect(names).toEqual([...new Set(names)]);
	});

	it("uses the VITE_ prefix exactly for client vars", () => {
		const misScoped = ENV_REGISTRY.filter((spec) => (spec.scope === "client") !== spec.name.startsWith("VITE_"));
		expect(
			misScoped.map((spec) => spec.name),
			"client vars must be VITE_-prefixed and VITE_ vars must be client-scoped",
		).toEqual([]);
	});

	it("never requires www-only vars in the product", () => {
		const wrong = ENV_REGISTRY.filter((spec) => spec.wwwOnly && spec.requiredBy !== "optional");
		expect(wrong.map((spec) => spec.name)).toEqual([]);
	});

	it("declares a provider id exactly on dynamic-scrape-targets entries", () => {
		const wrong = ENV_REGISTRY.filter(
			(spec) => (spec.requiredBy === "dynamic-scrape-targets") !== (spec.provider !== undefined),
		);
		expect(wrong.map((spec) => spec.name)).toEqual([]);
	});

	it("matches turbo.json globalEnv", () => {
		const turbo = JSON.parse(readFileSync(turboJsonPath, "utf8")) as { globalEnv: string[] };
		const turboVars = new Set(turbo.globalEnv);
		const registryVars = new Set(ENV_REGISTRY.map((spec) => spec.name));

		const missingFromTurbo = [...registryVars].filter((name) => !turboVars.has(name));
		const missingFromRegistry = [...turboVars].filter((name) => !registryVars.has(name));

		expect(missingFromTurbo, "add these vars to turbo.json globalEnv").toEqual([]);
		expect(missingFromRegistry, "add these vars to packages/config/src/env-registry.ts").toEqual([]);
	});

	it("is fully declared in apps/web/src/env.d.ts", () => {
		const envDts = readFileSync(envDtsPath, "utf8");
		// Neither interface body contains braces, so a non-greedy match to the
		// first "}" captures the whole block.
		const importMetaEnv = envDts.match(/interface ImportMetaEnv \{([^}]*)\}/)?.[1];
		const processEnv = envDts.match(/interface ProcessEnv \{([^}]*)\}/)?.[1];
		expect(importMetaEnv, "could not find ImportMetaEnv in env.d.ts").toBeDefined();
		expect(processEnv, "could not find NodeJS.ProcessEnv in env.d.ts").toBeDefined();

		const undeclared = ENV_REGISTRY.filter((spec) => {
			if (spec.wwwOnly) return false;
			const block = spec.scope === "client" ? importMetaEnv! : processEnv!;
			return !new RegExp(`readonly ${spec.name}\\??:`).test(block);
		});

		expect(
			undeclared.map((spec) => `${spec.name} (${spec.scope === "client" ? "ImportMetaEnv" : "NodeJS.ProcessEnv"})`),
			"declare these vars in apps/web/src/env.d.ts",
		).toEqual([]);
	});
});
