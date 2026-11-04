import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type AIProviderKey =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'googleAio'
  | 'googleAiMode'
  | 'perplexity'
  | 'copilot'
  | 'xai'
  | 'meta';

/**
 * Each platform's mark lives in `/public/platforms/` as a one-colour SVG with
 * a square viewBox cut to the mark's own bounds, so every logo fills its box
 * the same way. Meta AI has no mark and keeps a letter badge.
 */
const AI_PROVIDER_META: Record<AIProviderKey, { label: string; shortLabel: string; icon: string }> =
  {
    openai: { label: 'ChatGPT', shortLabel: 'O', icon: '/platforms/chatgpt.svg' },
    anthropic: { label: 'Claude', shortLabel: 'A', icon: '/platforms/claude.svg' },
    google: { label: 'Gemini', shortLabel: 'G', icon: '/platforms/gemini.svg' },
    googleAio: { label: 'Google AI Overviews', shortLabel: 'G', icon: '/platforms/google.svg' },
    // AI Mode runs on Gemini, so it shows the Gemini mark.
    googleAiMode: { label: 'Google AI Mode', shortLabel: 'G', icon: '/platforms/gemini.svg' },
    perplexity: { label: 'Perplexity', shortLabel: 'P', icon: '/platforms/perplexity.svg' },
    copilot: { label: 'Microsoft Copilot', shortLabel: 'C', icon: '/platforms/copilot.svg' },
    xai: { label: 'Grok', shortLabel: 'X', icon: '/platforms/grok.svg' },
    meta: { label: 'Meta AI', shortLabel: 'M', icon: '' },
  };

export function resolveAIProvider(model: string, platform?: string): AIProviderKey {
  const key = platform || model;

  if (key === 'ChatGPT' || key === 'chatgpt' || key === 'chatgpt-web' || key.startsWith('gpt-')) {
    return 'openai';
  }
  if (key === 'Claude' || key === 'claude' || key.startsWith('claude-')) {
    return 'anthropic';
  }
  if (
    key === 'Perplexity' ||
    key === 'perplexity' ||
    key === 'perplexity-web' ||
    key.startsWith('sonar')
  ) {
    return 'perplexity';
  }
  if (
    key === 'Microsoft Copilot' ||
    key === 'Copilot' ||
    key === 'copilot' ||
    key === 'copilot-web'
  ) {
    return 'copilot';
  }
  if (key === 'Grok' || key === 'grok' || key === 'grok-web' || key.startsWith('grok-')) {
    return 'xai';
  }
  if (
    key === 'Google AI Overviews' ||
    key === 'Google AI Overview' ||
    key === 'google-aio' ||
    key === 'google-ai-overviews'
  ) {
    return 'googleAio';
  }
  if (
    key === 'Google AI Mode' ||
    key === 'google-ai-mode' ||
    key === 'google-aimode' ||
    key === 'ai-mode'
  ) {
    return 'googleAiMode';
  }
  if (
    key === 'Gemini' ||
    key === 'Google Gemini' ||
    key === 'gemini' ||
    key === 'gemini-web' ||
    key.startsWith('gemini-')
  ) {
    return 'google';
  }
  if (key === 'Meta AI' || key === 'meta-ai' || key.startsWith('llama-')) {
    return 'meta';
  }

  return platform ? resolveAIProvider(platform) : 'openai';
}

export function getAIProviderDisplayName(provider: AIProviderKey): string {
  return AI_PROVIDER_META[provider].label;
}

/**
 * The logo as a CSS mask over the text colour, so every mark is drawn in one
 * colour that follows the theme (black on light, white on dark).
 */
function logoMask(icon: string): CSSProperties {
  const image = `url(${icon})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  };
}

export function AIProviderAvatar({
  provider,
  className,
  plain = false,
}: {
  provider: AIProviderKey;
  /** Size and colour; the logo takes the text colour (`text-foreground` by default). */
  className?: string;
  /**
   * Just the logo, filling the box, for rows where it stands beside the
   * platform's name. Otherwise a round badge with the logo at 60% inside.
   */
  plain?: boolean;
}) {
  const meta = AI_PROVIDER_META[provider];

  if (!meta.icon) {
    return (
      <span
        title={meta.label}
        aria-label={meta.label}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-bold text-foreground',
          className,
        )}
      >
        {meta.shortLabel}
      </span>
    );
  }

  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center text-foreground',
        !plain && 'rounded-full border bg-background',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('block bg-current', plain ? 'h-full w-full' : 'h-3/5 w-3/5')}
        style={logoMask(meta.icon)}
      />
    </span>
  );
}
