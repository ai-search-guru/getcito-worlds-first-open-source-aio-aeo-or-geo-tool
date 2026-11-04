import { cn } from '@/lib/utils';

// Competition level → active bar colour. Green (easy) → dark red (contested).
const ACTIVE_BY_LEVEL: Record<number, string> = {
  1: 'bg-green-500',
  2: 'bg-orange-300',
  3: 'bg-orange-500',
  4: 'bg-red-500',
  5: 'bg-red-700',
};

/**
 * Ahrefs/SEMrush-style 5-bar competition meter. `index` is the 0–100 Google Ads
 * competition index; `label` (LOW/MEDIUM/HIGH) is shown in the tooltip. Renders
 * an em dash when the index is unknown.
 */
export function CompetitionBars({ index, label }: { index: number | null; label?: string | null }) {
  if (index === null || index === undefined) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const level = Math.max(1, Math.min(5, Math.ceil(index / 20)));
  const active = ACTIVE_BY_LEVEL[level];

  return (
    <div
      className="inline-flex items-center gap-0.5"
      title={label ? `${label} (${index}/100)` : `${index}/100`}
      aria-label={`Competition ${index} of 100`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={cn('h-4 w-1 rounded-sm', i < level ? active : 'bg-muted')} />
      ))}
    </div>
  );
}
