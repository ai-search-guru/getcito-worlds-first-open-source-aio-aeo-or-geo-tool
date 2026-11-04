import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * What the agent is doing, the same in Chat and Content Editor (Chat agentic
 * plan §2): idle, working, waiting for the person, done, or stopped on a
 * failed step (CHAT-03 items 16–21, the mockup's failed run).
 */
export type AgentAvatarState = 'idle' | 'working' | 'waiting' | 'done' | 'failed';

export const AGENT_AVATAR_STATES: readonly AgentAvatarState[] = [
  'idle',
  'working',
  'waiting',
  'done',
  'failed',
];

/**
 * live: Chat and Content Editor, where the agent at hand moves. muted: the
 * Agents list (CHAT-21), where many agents sit still side by side: an idle,
 * paused or stopped one is a grey tile and one waiting for the person wears
 * a fixed amber ring.
 */
export type AgentAvatarTone = 'live' | 'muted';

/** md: 30 px (answers, Agents list); sm: 26 px (runs tray, finder); xs: 22 px (card headers, menus). */
export type AgentAvatarSize = 'md' | 'sm' | 'xs';

const TILE: Record<AgentAvatarSize, string> = {
  md: 'size-[30px] rounded-[10px]',
  sm: 'size-[26px] rounded-[10px]',
  xs: 'size-[22px] rounded-[7px]',
};
const RING: Record<AgentAvatarSize, string> = {
  md: 'rounded-[13px]',
  sm: 'rounded-[13px]',
  xs: 'rounded-[10px]',
};
const ICON: Record<AgentAvatarSize, string> = {
  md: 'size-[17px]',
  sm: 'size-[17px]',
  xs: 'size-[13px]',
};

/** The tile's colours: dark, or soft green done, soft red failed (both themes). */
function tileTone(state: AgentAvatarState, tone: AgentAvatarTone): string {
  if (state === 'done') return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400';
  if (state === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400';
  if (tone === 'muted' && state === 'idle') return 'bg-foreground/10 text-foreground/70';
  return 'bg-foreground text-background';
}

/**
 * The robot: live, its eyes blink, or look from side to side while it works,
 * and a gold spark twinkles by its antenna; muted, it sits still, with no
 * spark (the Agents list in the governance mockup).
 */
function Robot({
  working,
  live,
  className,
}: {
  working: boolean;
  live: boolean;
  className: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn(
        'fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]',
        className,
      )}
    >
      <rect x="4" y="8" width="16" height="11" rx="3.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" className="fill-current" />
      <g
        className={cn(
          live && '[transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none',
          live && (working ? 'animate-agent-look' : 'animate-agent-blink'),
        )}
      >
        <path d="M9 13v1.5M15 13v1.5" className="[stroke-width:2.2]" />
      </g>
      <path d="M2 12.5v2M22 12.5v2" />
      {live && (
        <path
          d="M19 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"
          className="animate-agent-spark fill-agent-spark stroke-agent-spark [stroke-width:0.8] [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none"
        />
      )}
    </svg>
  );
}

/**
 * The agent (Chat v2 mockups): a dark tile with the robot. Working, it
 * breathes and bobs while a light sweeps over it; waiting for the person, an
 * amber ring grows out of it; done, it turns soft green; failed, soft red.
 * Never a spinning ring. In the Agents list (`tone="muted"`) it is still:
 * grey when idle, a fixed amber ring when waiting. It says its state to a
 * screen reader, unless the words beside it already do (`decorative`).
 */
export function AgentAvatar({
  state = 'idle',
  tone = 'live',
  size = 'md',
  decorative = false,
  className,
}: {
  state?: AgentAvatarState;
  tone?: AgentAvatarTone;
  size?: AgentAvatarSize;
  decorative?: boolean;
  className?: string;
}) {
  const t = useTranslations('agentic.avatar');
  const live = tone === 'live';
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(state) })}
      data-slot="agent-avatar"
      data-state={state}
      data-tone={tone}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        TILE[size],
        tileTone(state, tone),
        live && state === 'working' && 'animate-agent-work motion-reduce:animate-none',
        // The governance mockup's ring: 3 px soft amber, then a 1 px amber line.
        !live &&
          state === 'waiting' &&
          'ring-1 ring-amber-200 ring-offset-3 ring-offset-amber-100 dark:ring-amber-900 dark:ring-offset-amber-950',
        className,
      )}
    >
      {live && state === 'waiting' && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1 animate-agent-wait border-2 border-amber-600/50 motion-reduce:animate-none dark:border-amber-400/50',
            RING[size],
          )}
        />
      )}
      <Robot working={state === 'working'} live={live} className={ICON[size]} />
      {/* The light passes over the robot, as the mockup's ::after does. */}
      {live && state === 'working' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-agent-sweep rounded-[inherit] bg-[linear-gradient(115deg,transparent_30%,color-mix(in_oklab,var(--background)_25%,transparent)_50%,transparent_70%)] bg-[length:250%_100%] motion-reduce:animate-none"
        />
      )}
    </span>
  );
}
