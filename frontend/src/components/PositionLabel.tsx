import { cn } from '@/lib/utils';
import { positionTone } from '@/lib/positionTone';

/**
 * "Early · #2 of 7": where an entry sits in its list. Without a known total
 * there is no third to place it in, so it reads just "#2".
 */
export function PositionLabel({ rank, total }: { rank: number; total: number | null }) {
  if (!total) return <span className="text-xs tabular-nums whitespace-nowrap">#{rank}</span>;
  const tone = positionTone(rank, total);
  return (
    <span className="text-xs tabular-nums whitespace-nowrap">
      <span
        className={cn(
          'font-medium',
          tone === 'Early' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'Late' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {tone}
      </span>
      <span className="text-muted-foreground">
        {' '}
        · #{rank} of {total}
      </span>
    </span>
  );
}
