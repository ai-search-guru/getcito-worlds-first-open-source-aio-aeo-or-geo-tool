import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export function Logo({
	className,
	...props
}: ComponentPropsWithoutRef<"span">) {
	return (
		<span
			{...props}
			className={cn(
				"font-titan-one text-3xl font-normal lowercase text-blue-600",
				className,
			)}
		>
			Getcito
		</span>
	);
}
