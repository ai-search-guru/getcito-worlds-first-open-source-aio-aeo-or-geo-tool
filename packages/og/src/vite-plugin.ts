import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const EMBEDDED_BINARIES: Record<string, string> = {
	"virtual:takumi-wasm":
		"@takumi-rs/wasm/takumi_wasm_bg.wasm",
	"virtual:font/titan-one-400":
		"@fontsource/titan-one/files/titan-one-latin-400-normal.woff2",
	"virtual:font/geist-sans-400":
		"@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2",
	"virtual:font/geist-sans-500":
		"@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2",
};

export function embedBinaries(): Plugin {
	const require = createRequire(import.meta.url);
	return {
		name: "embed-binaries",
		resolveId(id) {
			if (id in EMBEDDED_BINARIES) return `\0${id}`;
		},
		load(id) {
			const key = id.startsWith("\0") ? id.slice(1) : id;
			const spec = EMBEDDED_BINARIES[key];
			if (!spec) return;
			const filePath = require.resolve(spec);
			const base64 = readFileSync(filePath).toString("base64");
			return `export default Buffer.from(${JSON.stringify(base64)}, "base64");`;
		},
	};
}
