import { docs } from "collections/server";
import { loader, type LoaderPlugin } from "fumadocs-core/source";
import { openapiPlugin, openapiSource } from "fumadocs-openapi/server";
import { openapi } from "@/lib/openapi";

// Default-open the tag folders (Prompts/Snapshots/Reports) under `/docs/api`
// so the full operation list shows as soon as the user expands "API".
function apiTagFoldersOpenByDefault(): LoaderPlugin {
	return {
		name: "Getcito:api-tag-folders-open",
		transformPageTree: {
			folder(node, folderPath) {
				if (folderPath.startsWith("api/")) {
					node.defaultOpen = true;
				}
				return node;
			},
		},
	};
}

export const source = loader(
	{
		docs: docs.toFumadocsSource(),
		openapi: await openapiSource(openapi, {
			baseDir: "api",
			groupBy: "tag",
		}),
	},
	{
		baseUrl: "/docs",
		plugins: [openapiPlugin(), apiTagFoldersOpenByDefault()],
	},
);
