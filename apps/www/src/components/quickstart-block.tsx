"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

const COMMANDS = ["npm install -g @Getcito/cli", "Getcito init"];

export function QuickstartBlock() {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(COMMANDS.join(" && "));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard unavailable; ignore
		}
	}

	return (
		<div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 font-mono text-sm">
			<div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
				<div className="flex items-center gap-2 text-zinc-400">
					<Terminal className="size-3.5" />
					<span className="text-[11px] uppercase tracking-[0.15em]">
						Quickstart
					</span>
				</div>
				<button
					type="button"
					onClick={handleCopy}
					className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					aria-label="Copy command"
				>
					{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="space-y-1 px-4 py-4 text-zinc-100">
				<div className="flex gap-3">
					<span className="text-zinc-500 select-none">$</span>
					<span>
						npm install -g{" "}
						<span className="text-blue-400">@Getcito/cli</span>
					</span>
				</div>
				<div className="flex gap-3">
					<span className="text-zinc-500 select-none">$</span>
					<span>Getcito init</span>
				</div>
			</div>
		</div>
	);
}
