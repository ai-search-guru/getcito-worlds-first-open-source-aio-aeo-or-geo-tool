import { createStart } from "@tanstack/react-start";

// Global TanStack Start configuration. Markdown content negotiation for docs
// pages — the `.md`/`.mdx` URL suffix and the `Accept: text/markdown` header —
// is handled in server.ts, where a request can be rewritten to the markdown
// route at the *same* URL. Request middleware here can only redirect, not
// rewrite, so it isn't the right place for that.
export const startInstance = createStart(() => {
	return {};
});
