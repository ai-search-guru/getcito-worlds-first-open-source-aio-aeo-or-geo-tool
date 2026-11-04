import { cn } from '@/lib/utils';

/**
 * Onboarding's page shell: the wizard step sits in a card over a blurred
 * preview of the dashboard it is setting up. Below md the preview is dropped
 * and the step fills the screen as a plain page — a blurred sidebar has no
 * room to read as a dashboard on a phone.
 */
export function OnboardingFrame({
  preview,
  width,
  children,
}: {
  preview: React.ReactNode;
  /** Sized to the step's own content column, so no step floats in empty card. */
  width: 'narrow' | 'medium' | 'wide';
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-svh">
      <div
        aria-hidden
        inert
        className="pointer-events-none fixed inset-0 hidden select-none overflow-hidden md:block"
      >
        <div className="h-full w-full scale-[1.02] blur-[3px]">{preview}</div>
        <div className="absolute inset-0 bg-background/50" />
      </div>

      <div className="relative flex min-h-svh flex-col md:p-8">
        <div
          className={cn(
            'm-auto w-full bg-background md:rounded-2xl md:border md:shadow-2xl',
            width === 'wide' && 'md:max-w-5xl',
            width === 'medium' && 'md:max-w-3xl',
            width === 'narrow' && 'md:max-w-xl',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
