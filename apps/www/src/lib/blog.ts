import { blog } from "collections/server";
import { loader } from "fumadocs-core/source";

// Second fumadocs source (alongside docs in @/lib/source) for the resources
// blog. Server-only — importing this pulls in fumadocs-core/source and the
// generated server collections, so only import it inside server functions and
// server route handlers, never from client components.
export const blogSource = loader({ blog: blog.toFumadocsSource() }, { baseUrl: "/blog" });
