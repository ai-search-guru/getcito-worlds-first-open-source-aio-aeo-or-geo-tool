import { useMemo, useState } from "react";

const PAGER_BUTTON_CLASS =
	"text-xs text-muted-foreground hover:text-foreground cursor-pointer px-2.5 py-1 rounded-md border border-border hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

interface ListPaginationProps {
	/** Zero-based current page. */
	page: number;
	pageSize: number;
	totalItems: number;
	onPageChange: (page: number) => void;
}

/** Page-based pagination footer ("1–10 of 42" + Previous/Next). Controlled,
 *  so the same props work whether the caller paginates client-side over
 *  fetched data (v1, via `usePagedList`) or drives page/total from the
 *  server later. Renders nothing when everything fits on one page. */
export function ListPagination({ page, pageSize, totalItems, onPageChange }: ListPaginationProps) {
	const totalPages = Math.ceil(totalItems / pageSize);
	if (totalPages <= 1) return null;
	const start = page * pageSize + 1;
	const end = Math.min((page + 1) * pageSize, totalItems);
	return (
		<div className="mt-3 flex items-center justify-between">
			<span className="text-[11px] text-muted-foreground tabular-nums">
				{start.toLocaleString()}–{end.toLocaleString()} of {totalItems.toLocaleString()}
			</span>
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={() => onPageChange(Math.max(0, page - 1))}
					disabled={page === 0}
					className={PAGER_BUTTON_CLASS}
				>
					Previous
				</button>
				<button
					type="button"
					onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
					disabled={page >= totalPages - 1}
					className={PAGER_BUTTON_CLASS}
				>
					Next
				</button>
			</div>
		</div>
	);
}

/** Client-side page state over already-fetched items. The page is clamped
 *  when the list shrinks (e.g. a filter change) so we never show an
 *  out-of-range empty page; callers that want a hard reset to page 0 on
 *  filter change can still call `setPage(0)` in their filter handler. */
export function usePagedList<T>(items: readonly T[], pageSize: number) {
	const [rawPage, setPage] = useState(0);
	const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
	const page = Math.min(rawPage, maxPage);
	const pageItems = useMemo(
		() => items.slice(page * pageSize, (page + 1) * pageSize),
		[items, page, pageSize],
	);
	return { page, setPage, pageItems, pageSize, totalItems: items.length };
}
