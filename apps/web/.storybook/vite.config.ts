/**
 * Minimal Vite config used by Storybook (and by the Vitest storybook project).
 *
 * The app's main `vite.config.ts` loads the full TanStack Start + Nitro + Sentry
 * plugin chain. Those plugins assume a single SSR entrypoint and conflict with
 * Storybook's multi-iframe bundling. This file gives the Storybook builder a
 * dedicated, plugin-light Vite config so stories can render in isolation.
 */
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), viteReact()],
});
