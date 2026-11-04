/**
 * A light that passes over the step under way, again and again: the Content
 * Agent card's sweep, faint enough for a chip or a list row. Its parent is
 * `relative overflow-hidden`. Gone with reduced motion.
 */
export function StepSweep() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 animate-agent-sweep bg-[linear-gradient(110deg,transparent_30%,color-mix(in_oklab,var(--foreground)_9%,transparent)_50%,transparent_70%)] bg-[length:250%_100%] [animation-duration:2.2s] motion-reduce:hidden"
    />
  );
}
