// ---------------------------------------------------------------------------
// Homepage feature graphics
//
// Each graphic is an abstract, schematic illustration of the feature it sits
// next to. Style is consistent across the seven: zinc + blue palette, dotted
// grid backdrop, mono labels, geometric SVG, sharp corners.
// ---------------------------------------------------------------------------

function Grid() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,rgb(0_0_0/0.06)_1px,transparent_1px)] [background-size:18px_18px]"
		/>
	);
}

function Frame({
	children,
	aspect = "aspect-[5/3]",
	className = "",
}: {
	children: React.ReactNode;
	aspect?: string;
	className?: string;
}) {
	return (
		<div
			className={`relative w-full overflow-hidden rounded-md border border-zinc-200 bg-white ${aspect} ${className}`}
		>
			<Grid />
			<div className="relative z-10 size-full">{children}</div>
		</div>
	);
}

function Mono({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<span
			className={`font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 ${className}`}
		>
			{children}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Screenshot helper — used by feature graphics that show real product UI
// ---------------------------------------------------------------------------

// Screenshot column renders at ~640px max (max-w-6xl × 7/12). Use 750/1200/1920
// from the Vercel image sizes list to cover 1x/2x/3x DPR.
const SCREENSHOT_WIDTHS = [750, 1200, 1920];

function optimizedSrc(src: string, width: number, quality = 75) {
	const params = new URLSearchParams({
		url: src,
		w: String(width),
		q: String(quality),
	});
	return `/_vercel/image?${params.toString()}`;
}

function Screenshot({
	src,
	alt,
	aspect = "aspect-[5/3]",
	objectPosition = "object-left-top",
}: {
	src: string;
	alt: string;
	aspect?: string;
	objectPosition?: string;
}) {
	const useOptimized = import.meta.env.PROD;
	const srcSet = useOptimized
		? SCREENSHOT_WIDTHS.map((w) => `${optimizedSrc(src, w)} ${w}w`).join(", ")
		: undefined;
	return (
		<Frame aspect={aspect}>
			<img
				src={useOptimized ? optimizedSrc(src, 1200) : src}
				srcSet={srcSet}
				sizes="(min-width: 1024px) 640px, 100vw"
				alt={alt}
				loading="lazy"
				decoding="async"
				className={`size-full object-cover ${objectPosition}`}
			/>
		</Frame>
	);
}

// ---------------------------------------------------------------------------
// 01 — Dashboard
// ---------------------------------------------------------------------------

export function OverviewPageGraphic({
	wide = false,
}: { wide?: boolean } = {}) {
	return (
		<Screenshot
			src="/screenshots/overview.png"
			alt="Getcito dashboard overview showing AI visibility score, trends, and citation breakdown"
			aspect={wide ? "aspect-[12/5]" : "aspect-[5/3]"}
		/>
	);
}

// ---------------------------------------------------------------------------
// 02 — Visibility
// ---------------------------------------------------------------------------

export function VisibilityPageGraphic() {
	return (
		<Screenshot
			src="/screenshots/visibility.png"
			alt="Per-prompt visibility tracking with brand and competitor trend lines across multiple AI models"
		/>
	);
}

// ---------------------------------------------------------------------------
// 03 — Citations
// ---------------------------------------------------------------------------

export function CitationsPageGraphic() {
	return (
		<Screenshot
			src="/screenshots/citations.png"
			alt="Citation analysis showing brand share, unique domains, total citations, and breakdown by domain type"
		/>
	);
}

// ---------------------------------------------------------------------------
// 04 — Prompts
// ---------------------------------------------------------------------------

export function PromptSearchGraphic() {
	return (
		<Screenshot
			src="/screenshots/prompts.png"
			alt="Prompt filtering with the Tags dropdown open showing Basketball and Kids selected"
		/>
	);
}

// ---------------------------------------------------------------------------
// 05 — Competition: brand vs competitors stack-rank
// ---------------------------------------------------------------------------

export function CompetitorGraphic() {
	const lanes = [
		{ name: "Nike", initial: "N", pct: 78, isYou: true },
		{ name: "Adidas", initial: "A", pct: 64 },
		{ name: "New Balance", initial: "N", pct: 56 },
		{ name: "Asics", initial: "A", pct: 48 },
		{ name: "Hoka", initial: "H", pct: 42 },
		{ name: "Puma", initial: "P", pct: 35 },
		{ name: "Saucony", initial: "S", pct: 28 },
		{ name: "Brooks", initial: "B", pct: 21 },
		{ name: "Reebok", initial: "R", pct: 14 },
	];

	return (
		<Frame>
			<ul
				role="list"
				className="flex size-full flex-col justify-center gap-2 p-5 md:p-6"
			>
				{lanes.map((l) => (
					<li
						key={l.name}
						className="grid grid-cols-[1.5rem_7rem_1fr_2.5rem] items-center gap-3"
					>
						<span
							className={`flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-medium ${
								l.isYou
									? "bg-blue-600 text-white"
									: "bg-zinc-100 text-zinc-600"
							}`}
						>
							{l.initial}
						</span>
						<span
							className={`truncate text-[13px] ${
								l.isYou ? "font-medium text-blue-700" : "text-zinc-700"
							}`}
						>
							{l.name}
						</span>
						<div className="relative h-2.5 overflow-hidden rounded-sm bg-zinc-100">
							<div
								className={`h-full rounded-sm ${
									l.isYou
										? "bg-blue-600"
										: "bg-linear-to-r from-zinc-300 to-zinc-400"
								}`}
								style={{ width: `${l.pct}%` }}
							/>
						</div>
						<span
							className={`text-right text-[13px] tabular-nums ${
								l.isYou ? "font-medium text-blue-700" : "text-zinc-700"
							}`}
						>
							{l.pct}%
						</span>
					</li>
				))}
			</ul>
		</Frame>
	);
}

// ---------------------------------------------------------------------------
// 06 — Deep Dive
// ---------------------------------------------------------------------------

export function PromptDetailGraphic() {
	return (
		<Screenshot
			src="/screenshots/prompt-detail.png"
			alt="Prompt history showing brand mention rates broken down by individual brand competitors"
		/>
	);
}

// ---------------------------------------------------------------------------
// 07 — Trends: 12-month area chart
// ---------------------------------------------------------------------------

export function VisibilityTrendGraphic() {
	const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
	const brand = [40, 44, 48, 52, 50, 56, 60, 64, 62, 68, 71, 72];
	const comp = [55, 52, 50, 48, 51, 49, 47, 44, 46, 43, 42, 40];
	const w = 240;
	const h = 100;

	function path(data: number[]) {
		const pts = data.map((v, i) => {
			const x = (i / (data.length - 1)) * w;
			const y = h - ((v - 30) / 50) * h;
			return { x, y };
		});
		const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
		const area = `${line} L${w},${h} L0,${h} Z`;
		return { line, area, pts };
	}

	const b = path(brand);
	const c = path(comp);
	const last = b.pts[b.pts.length - 1];

	return (
		<Frame>
			<div className="flex size-full flex-col gap-3 p-5 md:p-6">
				<div className="flex items-center justify-between">
					<div className="flex flex-col gap-0.5">
						<Mono>BRAND VISIBILITY · 12M</Mono>
						<div className="flex items-baseline gap-2">
							<span className="text-3xl font-medium tracking-tight text-zinc-950 tabular-nums">
								72%
							</span>
							<span className="font-mono text-[10px] tabular-nums text-emerald-600">
								↑ 32 PT YoY
							</span>
						</div>
					</div>
					<div className="flex flex-col items-end gap-1 font-mono text-[9px] uppercase tracking-[0.15em]">
						<span className="inline-flex items-center gap-1 text-blue-700">
							<span className="inline-block h-0.5 w-3 rounded-full bg-blue-600" />
							YOUR BRAND
						</span>
						<span className="inline-flex items-center gap-1 text-zinc-500">
							<span className="inline-block h-px w-3 border-t border-dashed border-zinc-400" />
							COMPETITOR
						</span>
					</div>
				</div>

				<div className="relative flex-1">
					<svg
						viewBox={`0 0 ${w} ${h}`}
						className="size-full overflow-visible"
						preserveAspectRatio="none"
					>
						<defs>
							<linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
								<stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
							</linearGradient>
						</defs>
						{[0, 1, 2, 3].map((i) => (
							<line
								key={i}
								x1="0"
								y1={(i * h) / 3}
								x2={w}
								y2={(i * h) / 3}
								stroke="rgb(228 228 231)"
								strokeWidth="0.5"
								vectorEffect="non-scaling-stroke"
							/>
						))}
						<path d={b.area} fill="url(#trend-fill)" />
						<path
							d={c.line}
							fill="none"
							stroke="rgb(161 161 170)"
							strokeWidth="1.25"
							strokeDasharray="3 3"
							strokeLinecap="round"
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={b.line}
							fill="none"
							stroke="#2563eb"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
						/>
						<line
							x1={last.x}
							y1={last.y}
							x2={last.x}
							y2={h}
							stroke="#2563eb"
							strokeWidth="0.75"
							strokeDasharray="2 2"
							opacity="0.5"
							vectorEffect="non-scaling-stroke"
						/>
						<circle
							cx={last.x}
							cy={last.y}
							r="3.5"
							fill="#2563eb"
							stroke="white"
							strokeWidth="1.5"
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				</div>

				<div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.15em] text-zinc-400 tabular-nums">
					{months.map((m) => (
						<span key={m}>{m}</span>
					))}
				</div>
			</div>
		</Frame>
	);
}
