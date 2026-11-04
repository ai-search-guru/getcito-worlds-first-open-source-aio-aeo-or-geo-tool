import { Separator } from '@/components/ui/separator';

/** A centred label between two rules, e.g. "Or continue with". */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <Separator className="flex-1" />
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  );
}
