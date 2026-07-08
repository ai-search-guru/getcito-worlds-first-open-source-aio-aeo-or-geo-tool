import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { embedBinaries } from "@workspace/og/vite-plugin";
import * as MdxConfig from "./source.config";

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

export default defineConfig({
	server: {
		port: 3001,
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
		mdx(MdxConfig),
		tailwindcss(),
		tanstackStart(),
		nitro({
			alias: {
				tslib: tslibEsm,
			},
			traceDeps: ["@takumi-rs/core", ...takumiNativeBindings],
			vercel: {
				config: {
					version: 3,
					images: {
						sizes: [640, 750, 828, 1080, 1200, 1920, 2048],
						domains: [],
						minimumCacheTTL: 31536000,
						formats: ["image/webp"],
					},
				},
			},
		}),
		viteReact(),
	],
});
