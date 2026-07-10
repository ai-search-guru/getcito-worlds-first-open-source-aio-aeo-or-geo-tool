import type { ComponentPropsWithoutRef } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { cn } from "@workspace/ui/lib/utils";
import { DEFAULT_APP_ICON, DEFAULT_APP_NAME } from "@workspace/config/constants";
import type { ClientConfig } from "@workspace/config/types";

interface LogoProps extends ComponentPropsWithoutRef<"div"> {
	iconClassName?: string;
	textClassName?: string;
}

export function Logo({
	className,
	iconClassName,
	textClassName,
	...props
}: LogoProps) {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;
	const hasCustomBranding =
		Boolean(branding?.icon && branding?.name) &&
		(branding?.icon !== DEFAULT_APP_ICON || branding?.name !== DEFAULT_APP_NAME);

	if (!hasCustomBranding) {
		return (
			<div {...props} className={cn("flex items-center gap-2", className)}>
				<span
					className={cn(
						"font-titan-one text-3xl font-normal lowercase text-blue-600",
						textClassName,
					)}
				>
					Getcito
				</span>
			</div>
		);
	}

	return (
		<div {...props} className={cn("flex items-center gap-2", className)}>
			{branding?.icon && (
				<img
					src={branding.icon}
					alt={`${branding.name} logo`}
					className={cn("size-5", iconClassName)}
					fetchPriority="low"
				/>
			)}
			<span className={cn("text-base font-semibold", textClassName)}>
				{branding?.name}
			</span>
		</div>
	);
}
