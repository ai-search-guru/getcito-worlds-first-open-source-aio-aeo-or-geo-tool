/**
 * Client-safe exports for deployment integration.
 *
 * IMPORTANT: This module must NEVER import server-only code (auth providers,
 * auth0, @tanstack/react-start/server, etc.). It is imported by client
 * components and route files that are bundled for the browser.
 */
import type { ClientConfig, OptimizeButtonProps } from "@workspace/config/types";
import { OptimizeButton as LocalOptimizeButton } from "@workspace/local/components/optimize-button";
import {
	OptimizeButton as WhitelabelOptimizeButton,
} from "@workspace/whitelabel/components/optimize-button";

export type { OptimizeButtonProps, WebQueryResult } from "@workspace/config/types";

type OptimizeButtonComponent = (props: OptimizeButtonProps) => ReturnType<typeof WhitelabelOptimizeButton>;

const OPTIMIZE_BUTTON_BY_MODE: Record<ClientConfig["mode"], OptimizeButtonComponent> = {
	local: LocalOptimizeButton,
	demo: LocalOptimizeButton,
	whitelabel: (props) =>
		WhitelabelOptimizeButton({
			...props,
			parentName: props.parentName ?? "",
			optimizationUrlTemplate: props.optimizationUrlTemplate ?? "",
		}),
	cloud: LocalOptimizeButton,
};

/**
 * Select the correct OptimizeButton component for the current deployment mode.
 */
export function getOptimizeButtonForMode(
	mode: ClientConfig["mode"],
): OptimizeButtonComponent {
	return OPTIMIZE_BUTTON_BY_MODE[mode];
}
