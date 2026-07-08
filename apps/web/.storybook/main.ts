import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.resolve(__dirname, "../src/stories/_mocks");

const config: StorybookConfig = {
	framework: {
		name: "@storybook/react-vite",
		// Use a plugin-light vite config dedicated to Storybook; the app's main
		// vite.config.ts pulls in TanStack Start + Nitro plugins that conflict
		// with Storybook's multi-iframe bundling.
		options: {
			builder: {
				viteConfigPath: ".storybook/vite.config.ts",
			},
		},
	},
	stories: ["../src/stories/**/*.stories.{ts,tsx}"],
	addons: ["@storybook/addon-vitest"],
	core: {
		disableTelemetry: true,
	},
	async viteFinal(config) {
		const { mergeConfig } = await import("vite");
		const pkg = await import("../package.json", { with: { type: "json" } });

		return mergeConfig(config, {
			define: {
				__APP_VERSION__: JSON.stringify(pkg.version),
			},
			resolve: {
				tsconfigPaths: true,
				alias: [
					{ find: /^@\/hooks\/use-brands(\.tsx)?$/, replacement: path.resolve(mocksDir, "use-brands.tsx") },
					{ find: /^@\/hooks\/use-auth(\.tsx)?$/, replacement: path.resolve(mocksDir, "use-auth.tsx") },
					{
						find: /^@\/hooks\/use-chart-download(\.tsx)?$/,
						replacement: path.resolve(mocksDir, "use-chart-download.tsx"),
					},
					{ find: /^@\/hooks\/use-chart-export(\.tsx)?$/, replacement: path.resolve(mocksDir, "use-chart-export.tsx") },
					{
						find: /^@\/contexts\/chart-data-context(\.tsx)?$/,
						replacement: path.resolve(mocksDir, "chart-data-context.tsx"),
					},
					{ find: /^@\/lib\/config\/client(\.ts)?$/, replacement: path.resolve(mocksDir, "config-client.ts") },
					{ find: /^@\/server\/onboarding(\.ts)?$/, replacement: path.resolve(mocksDir, "server-onboarding.ts") },
					{ find: /^@\/server\/brands(\.ts)?$/, replacement: path.resolve(mocksDir, "server-brands.ts") },
					{ find: /^@\/server\/prompts(\.ts)?$/, replacement: path.resolve(mocksDir, "server-prompts.ts") },
					{ find: /^@\/server\/citations(\.ts)?$/, replacement: path.resolve(mocksDir, "server-citations.ts") },
					{ find: /^@\/server\/dashboard(\.ts)?$/, replacement: path.resolve(mocksDir, "server-dashboard.ts") },
					{ find: /^@\/server\/analysis(\.ts)?$/, replacement: path.resolve(mocksDir, "server-analysis.ts") },
					{ find: /^@\/server\/opportunities(\.ts)?$/, replacement: path.resolve(mocksDir, "server-opportunities.ts") },
					{ find: /^@tanstack\/react-router$/, replacement: path.resolve(mocksDir, "tanstack-router.tsx") },
					{ find: /^@tanstack\/react-start\/server$/, replacement: path.resolve(mocksDir, "tanstack-start.ts") },
					{ find: /^@tanstack\/react-start$/, replacement: path.resolve(mocksDir, "tanstack-start.ts") },
					{ find: /^@\//, replacement: path.resolve(__dirname, "../src") + "/" },
				],
			},
		});
	},
};

export default config;
