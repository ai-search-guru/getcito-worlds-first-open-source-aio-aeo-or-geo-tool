import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const FULL_CHANGELOG_RE =
	/\*\*Full Changelog\*\*:\s*(https:\/\/github\.com\/[^\s]+\/compare\/[^\s]+)/i;

export function extractCompareUrl(body: string | null): {
	cleaned: string;
	compareUrl: string | null;
} {
	if (!body) return { cleaned: "", compareUrl: null };
	const match = body.match(FULL_CHANGELOG_RE);
	if (!match) return { cleaned: body, compareUrl: null };
	const cleaned = body.replace(FULL_CHANGELOG_RE, "").trimEnd();
	return { cleaned, compareUrl: match[1] };
}

const components: Components = {
	h1: ({ children }) => (
		<h3 className="mt-5 text-lg font-semibold tracking-tight text-zinc-950">
			{children}
		</h3>
	),
	h2: ({ children }) => (
		<h3 className="mt-5 text-base font-semibold tracking-tight text-zinc-950">
			{children}
		</h3>
	),
	h3: ({ children }) => (
		<h4 className="mt-4 text-sm font-semibold tracking-tight text-zinc-950">
			{children}
		</h4>
	),
	p: ({ children }) => (
		<p className="text-[14px] leading-relaxed text-zinc-700">{children}</p>
	),
	a: ({ children, href }) => (
		<a
			href={href ?? "#"}
			target="_blank"
			rel="noopener noreferrer"
			className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700"
		>
			{children}
		</a>
	),
	ul: ({ children }) => (
		<ul
			role="list"
			className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-400"
		>
			{children}
		</ul>
	),
	ol: ({ children }) => (
		<ol className="my-2 list-decimal space-y-1 pl-5 marker:text-zinc-400">
			{children}
		</ol>
	),
	li: ({ children }) => (
		<li className="text-[14px] leading-relaxed text-zinc-700">{children}</li>
	),
	strong: ({ children }) => (
		<strong className="font-semibold text-zinc-950">{children}</strong>
	),
	code: ({ children }) => (
		<code className="rounded-sm bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800">
			{children}
		</code>
	),
	pre: ({ children }) => (
		<pre className="my-3 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[12.5px] leading-relaxed text-zinc-800">
			{children}
		</pre>
	),
	hr: () => <hr className="my-4 border-zinc-200" />,
	blockquote: ({ children }) => (
		<blockquote className="my-3 border-l-2 border-zinc-300 pl-3 text-zinc-600 italic">
			{children}
		</blockquote>
	),
};

export function ReleaseMarkdown({ body }: { body: string }) {
	return (
		<div className="space-y-2">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{body}
			</ReactMarkdown>
		</div>
	);
}
