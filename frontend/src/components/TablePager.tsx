'use client';

/**
 * Client-side table pagination shared by the citations page and the prompt
 * detail Top Sources card: a fixed page size, a state hook that resets on
 * filter changes, and the Previous/Next footer row.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export const PAGE_SIZE = 100;

/**
 * Per-table pagination state.
 * resetKey — pass a JSON.stringify of the active filters so the pager
 * automatically jumps back to page 0 whenever any filter changes.
 */
export function usePagination(totalRows: number, resetKey: unknown, pageSize: number = PAGE_SIZE) {
  const [page, setPage] = useState(0);

  // Adjust-state-during-render pattern: jump back to page 0 when the key changes.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);

  return {
    page: clampedPage,
    setPage,
    totalPages,
    start: clampedPage * pageSize,
    end: Math.min((clampedPage + 1) * pageSize, totalRows),
  };
}

export function TablePager({
  page,
  totalPages,
  total,
  start,
  end,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <span className="text-xs text-muted-foreground tabular-nums">
        {start + 1}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
