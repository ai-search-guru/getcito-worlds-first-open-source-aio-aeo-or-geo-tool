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

interface ContactFormProps {
	source: string;
}

export function ContactForm({ source }: ContactFormProps) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [company, setCompany] = useState("");
	const [message, setMessage] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		const trimmedEmail = email.trim();
		if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
			setError("Please enter a valid email address.");
			return;
		}

		identifyByEmail(trimmedEmail);
		trackEvent("whitelabel_contact", {
			email: trimmedEmail,
			name: name.trim() || undefined,
			company: company.trim() || undefined,
			message: message.trim() || undefined,
			source,
		});

		setSubmitted(true);
	}

	function handleOpenChange(value: boolean) {
		setOpen(value);
		if (!value) {
			setSubmitted(false);
			setEmail("");
			setName("");
			setCompany("");
			setMessage("");
			setError("");
		}
	}

	return (
		<>
			<Button className="w-full" onClick={() => setOpen(true)}>
				Contact Us
				<ArrowRight className="size-3.5" />
			</Button>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="sm:max-w-md" aria-describedby={undefined}>
					<DialogTitle>White Label Inquiry</DialogTitle>
					{submitted ? (
						<div className="py-6 text-center">
							<p className="text-sm text-muted-foreground">
								Thanks! We'll be in touch shortly.
							</p>
						</div>
					) : (
						<form onSubmit={handleSubmit} className="space-y-3">
							<div>
								<label htmlFor="contact-name" className="text-sm font-medium">
									Name
								</label>
								<input
									id="contact-name"
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Jane Smith"
									className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							<div>
								<label htmlFor="contact-email" className="text-sm font-medium">
									Work email <span className="text-destructive">*</span>
								</label>
								<input
									id="contact-email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="jane@agency.com"
									required
									className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							<div>
								<label htmlFor="contact-company" className="text-sm font-medium">
									Company
								</label>
								<input
									id="contact-company"
									type="text"
									value={company}
									onChange={(e) => setCompany(e.target.value)}
									placeholder="Acme Agency"
									className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							<div>
								<label htmlFor="contact-message" className="text-sm font-medium">
									Tell us about your use case
								</label>
								<textarea
									id="contact-message"
									value={message}
									onChange={(e) => setMessage(e.target.value)}
									placeholder="How many clients, expected volume, timeline..."
									rows={3}
									className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							{error && <p className="text-xs text-destructive">{error}</p>}
							<Button type="submit" className="w-full">
								Send Inquiry
							</Button>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
