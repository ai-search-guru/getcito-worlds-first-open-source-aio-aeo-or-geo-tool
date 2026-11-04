import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';

/**
 * The Content Agent at work (v1.1 CE-035): its dots, after "Content Agent is
 * working" — never a spinning ring. Still with reduced motion.
 */
export function WorkingDots({ className }: { className?: string }) {
  return <LoadingDots className={cn('ml-1.5', className)} />;
}
