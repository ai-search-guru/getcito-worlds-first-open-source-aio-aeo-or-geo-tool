'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface TableProps extends React.ComponentProps<'table'> {
  /** Pin the header row while the rows scroll underneath it. */
  stickyHeader?: boolean;
  /** Pin the first column while the table scrolls sideways. */
  stickyFirstColumn?: boolean;
}

/**
 * Container and table classes for the sticky options. A sticky cell pins to its
 * nearest scrolling ancestor, so a sticky table scrolls inside its own
 * height-capped container: that keeps both the header (vertical) and the first
 * column (horizontal) pinned. Sticky cells need an opaque background so rows
 * don't show through, and the first column repaints the row hover tint itself.
 */
export function stickyTableClasses({
  stickyHeader = false,
  stickyFirstColumn = false,
}: Pick<TableProps, 'stickyHeader' | 'stickyFirstColumn'>) {
  const sticky = stickyHeader || stickyFirstColumn;
  return {
    sticky,
    container: sticky ? 'max-h-[calc(100dvh-12rem)] overflow-auto' : 'overflow-x-auto',
    table: cn(
      stickyHeader &&
        '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)] data-[scrolled-y]:[&_thead_th]:shadow-[inset_0_-1px_0_var(--border),0_2px_4px_-2px_rgb(0_0_0/0.12)]',
      stickyFirstColumn &&
        '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-[5] [&_tr>*:first-child]:bg-card [&_tbody_tr:hover>*:first-child]:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] data-[scrolled-x]:[&_tbody_tr>*:first-child]:shadow-[inset_-1px_0_0_var(--border)]',
      stickyHeader && stickyFirstColumn && '[&_thead_th:first-child]:z-20',
    ),
  };
}

function Table({ className, stickyHeader, stickyFirstColumn, ...props }: TableProps) {
  const classes = stickyTableClasses({ stickyHeader, stickyFirstColumn });
  // Only shows the edge shadows once the table has actually scrolled.
  const [scrolled, setScrolled] = React.useState({ y: false, x: false });

  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full', classes.container)}
      onScroll={
        classes.sticky
          ? (e) => {
              const y = e.currentTarget.scrollTop > 0;
              const x = e.currentTarget.scrollLeft > 0;
              setScrolled((s) => (s.y === y && s.x === x ? s : { y, x }));
            }
          : undefined
      }
    >
      <table
        data-slot="table"
        data-scrolled-y={scrolled.y || undefined}
        data-scrolled-x={scrolled.x || undefined}
        className={cn('w-full caption-bottom text-sm', classes.table, className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
