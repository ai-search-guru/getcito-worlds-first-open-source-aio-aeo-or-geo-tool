/**
 * Server-side deployment accessor for the TanStack Start app.
 *
 * Thin wrapper around @workspace/deployment's getDeployment().
 * All auth is handled by better-auth — the Deployment is pure config.
 */
import { getDeployment as getDeploymentBase } from "@workspace/deployment";
import type { Deployment } from "@workspace/config/types";

export type { Deployment };

export function getDeployment(env: Record<string, string | undefined> = process.env): Deployment {
	return getDeploymentBase({ env });
}
