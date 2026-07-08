import { useState, type ReactNode } from "react";
import { ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import type { ActionResponse, PageFeedback, BlockFeedback } from "./schema";

interface FeedbackProps {
	onSendAction: (feedback: PageFeedback) => Promise<ActionResponse>;
}

export function Feedback({ onSendAction }: FeedbackProps) {
	const [opinion, setOpinion] = useState<"good" | "bad" | null>(null);
	const [message, setMessage] = useState("");
	const [submitted, setSubmitted] = useState(false);

	async function handleSubmit() {
		if (!opinion) return;
		await onSendAction({
			opinion,
			message,
			url: typeof window !== "undefined" ? window.location.pathname : "",
		});
		setSubmitted(true);
	}

	if (submitted) {
		return (
			<div className="mt-8 rounded-lg border bg-muted/50 p-4 text-center text-sm text-muted-foreground">
				Thanks for your feedback!
			</div>
		);
	}

	return (
		<div className="mt-8 rounded-lg border p-4">
			<p className="text-sm font-medium text-foreground">
				Was this page helpful?
			</p>
			<div className="mt-3 flex items-center gap-2">
				<Button
					variant={opinion === "good" ? "default" : "outline"}
					size="sm"
					onClick={() => setOpinion("good")}
					className="gap-1.5"
				>
					<ThumbsUp className="size-3.5" />
					Yes
				</Button>
				<Button
					variant={opinion === "bad" ? "default" : "outline"}
					size="sm"
					onClick={() => setOpinion("bad")}
					className="gap-1.5"
				>
					<ThumbsDown className="size-3.5" />
					No
				</Button>
			</div>
			{opinion && (
				<div className="mt-3 space-y-2">
					<textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="Any additional feedback? (optional)"
						className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						rows={3}
					/>
					<Button size="sm" onClick={handleSubmit}>
						Submit Feedback
					</Button>
				</div>
			)}
		</div>
	);
}

interface FeedbackBlockProps {
	id: string;
	body?: string;
	children: ReactNode;
	onSendAction: (feedback: BlockFeedback) => Promise<ActionResponse>;
}

export function FeedbackBlock({
	id,
	body,
	children,
	onSendAction,
}: FeedbackBlockProps) {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [submitted, setSubmitted] = useState(false);

	async function handleSubmit() {
		await onSendAction({
			blockId: id,
			blockBody: body,
			message,
			url: typeof window !== "undefined" ? window.location.pathname : "",
		});
		setSubmitted(true);
		setTimeout(() => setOpen(false), 1500);
	}

	return (
		<div className="group/feedback relative">
			{children}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="absolute -right-8 top-0 hidden size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/feedback:flex group-hover/feedback:opacity-100"
						aria-label="Send feedback about this section"
					>
						<MessageSquare className="size-3.5" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-72 p-3">
					{submitted ? (
						<p className="text-center text-sm text-muted-foreground">
							Thanks for your feedback!
						</p>
					) : (
						<div className="space-y-2">
							<p className="text-sm font-medium">
								Feedback on this section
							</p>
							<textarea
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								placeholder="What could be improved?"
								className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								rows={3}
								autoFocus
							/>
							<Button
								size="sm"
								onClick={handleSubmit}
								disabled={message.trim().length === 0}
								className="w-full"
							>
								Send Feedback
							</Button>
						</div>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
