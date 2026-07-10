import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Logo } from "@/components/logo";

interface FullPageCardProps {
	title?: string;
	subtitle?: string;
	children?: ReactNode;
	showBackButton?: boolean;
	backButtonHref?: string;
	backButtonText?: string;
	customBackButton?: ReactNode;
	className?: string;
}

export default function FullPageCard({
	title,
	subtitle,
	children = undefined,
	showBackButton = false,
	backButtonHref = "/app",
	backButtonText = "Go Back",
	customBackButton,
	className = "w-md",
}: FullPageCardProps) {
	return (
		<div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
			<div className={`mx-auto ${className}`}>
				<div className="flex items-center justify-center space-x-3">
					<Logo />
				</div>
				<Card className="my-8">
					{(title || subtitle) && (
						<CardHeader className={subtitle ? "text-center" : "text-center grid-rows-1 gap-0"}>
							{title && <CardTitle className="text-xl">{title}</CardTitle>}
							{subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
						</CardHeader>
					)}
					{children && (
						<>
							{(title || subtitle) && <Separator />}
							<CardContent className={title || subtitle ? "" : "flex flex-col items-center space-y-6 py-4 px-12"}>
								{children}
							</CardContent>
						</>
					)}
				</Card>
				{customBackButton ? (
					<div className="flex justify-center">{customBackButton}</div>
				) : showBackButton ? (
					<div className="flex justify-center">
						<Button variant="outline" size="sm" asChild>
							<Link to={backButtonHref}>{backButtonText}</Link>
						</Button>
					</div>
				) : null}
			</div>
		</div>
	);
}
