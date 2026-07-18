import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { embedBinaries } from "@workspace/og/vite-plugin";
import pkg from "./package.json" with { type: "json" };

const tslibEsm = fileURLToPath(import.meta.resolve("tslib/tslib.es6.mjs"));
const require = createRequire(import.meta.url);
const takumiCorePkgPath = resolve(
	dirname(require.resolve("@takumi-rs/core")),
	"..",
	"package.json",
);
const takumiNativeBindings = Object.keys(
	(
		JSON.parse(readFileSync(takumiCorePkgPath, "utf8")) as {
			optionalDependencies?: Record<string, string>;
		}
	).optionalDependencies ?? {},
);

const sentryPlugins = await (async () => {
	if (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
		const { sentryTanstackStart } = await import("@sentry/tanstackstart-react/vite");
		return [
			sentryTanstackStart({
				org: process.env.SENTRY_ORG,
				project: process.env.SENTRY_PROJECT,
				authToken: process.env.SENTRY_AUTH_TOKEN,
			}),
		];
	}
	return [];
})();

export default defineConfig({
	build: {
		sourcemap: "hidden",
	},
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	resolve: {
		tsconfigPaths: true,
		alias: {
			"@/": new URL("./src/", import.meta.url).pathname,
			tslib: tslibEsm,
		},
	},
	plugins: [
		embedBinaries(),
		devtools(),
		tailwindcss(),
		tanstackStart(),
		nitro({
			sourcemap: true,
			alias: {
				tslib: tslibEsm,
			},
			noExternals: [
				"@opentelemetry/instrumentation",
				"@opentelemetry/api",
				"@prisma/instrumentation",
			],
			traceDeps: ["@takumi-rs/core", ...takumiNativeBindings],
			rollupConfig: {
				external: ["fsevents"],
			},
		}),
		viteReact(),
		...sentryPlugins,
	],
});
