"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { trackEvent, identifyByEmail } from "@/lib/posthog";

interface WaitlistFormProps {
	source: string;
}

export function WaitlistForm({ source }: WaitlistFormProps) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		const trimmed = email.trim();
		if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
			setError("Please enter a valid email address.");
			return;
		}

		identifyByEmail(trimmed);
		trackEvent("waitlist_signup", {
			email: trimmed,
			source,
			plan: "cloud",
		});

		setSubmitted(true);
	}

	function handleOpenChange(value: boolean) {
		setOpen(value);
		if (!value) {
			setSubmitted(false);
			setEmail("");
			setError("");
		}
	}

	return (
		<>
			<Button className="w-full" onClick={() => setOpen(true)}>
				Join Waitlist
				<ArrowRight className="size-3.5" />
			</Button>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="sm:max-w-md" aria-describedby={undefined}>
					<DialogTitle>Join the Cloud Waitlist</DialogTitle>
					{submitted ? (
						<div className="py-6 text-center">
							<p className="text-sm text-muted-foreground">
								You're on the list! We'll notify you when Cloud is ready.
							</p>
						</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-3">
							<div>
								<label htmlFor="waitlist-email" className="text-sm font-medium">
									Email <span className="text-destructive">*</span>
								</label>
								<input
									id="waitlist-email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="you@company.com"
									required
									className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							{error && <p className="text-xs text-destructive">{error}</p>}
							<Button type="submit" className="w-full">
								Join Waitlist
							</Button>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
