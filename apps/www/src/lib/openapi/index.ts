import { createOpenAPI } from "fumadocs-openapi/server";
import type { OpenAPIV3_2 } from "fumadocs-openapi";
import spec from "@workspace/api-spec";

export const openapi = createOpenAPI({
	// fumadocs-openapi v11 replaced the `() => SchemaMap` factory with a record
	// of `name -> string | Document | (() => Awaitable<...>)`.
	input: { "getcito-api": spec as OpenAPIV3_2.Document },
});
