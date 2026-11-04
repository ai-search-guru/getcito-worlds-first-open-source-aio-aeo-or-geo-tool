'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { cn } from '@/lib/utils';

// ─── Pure helpers — exported so tests import the real implementations ─────────

/**
 * Derives up to two initials from a brand name.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Returns the primary domain string from a domains array, or undefined.
 */
export function getPrimaryDomain(
  domains: { domain: string; isPrimary: boolean }[] | undefined,
): string | undefined {
  return domains?.find((d) => d.isPrimary)?.domain;
}

export type Stage = 'manual' | 'local' | 'fallback';

/**
 * Resolves the initial fallback stage from the available props.
 * logo_url should be null/undefined for new brands — derived favicon URLs
 * must not be stored, so this function sees an empty field for most brands.
 */
export function resolveInitialStage(
  logoUrl: string | undefined,
  primaryDomain: string | undefined,
): Stage {
  if (logoUrl) return 'manual';
  if (primaryDomain) return 'local';
  return 'fallback';
}

/**
 * Returns the image src for a given stage.
 */
export function resolveUrl(
  stage: Stage,
  logoUrl: string | undefined,
  primaryDomain: string | undefined,
): string | undefined {
  if (stage === 'manual') return logoUrl;
  if (stage === 'local') return primaryDomain ? getSiteIconUrl(primaryDomain) : undefined;
  return undefined;
}

/**
 * Moves to the next stage in the fallback chain.
 *
 * Chain: manually selected logo → local icon → initials
 */
export function advance(current: Stage, primaryDomain: string | undefined): Stage {
  if (current === 'manual') return primaryDomain ? 'local' : 'fallback';
  return 'fallback';
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Fallback chain:
 *   1. manual logoUrl  (if set by user)
 *   2. Bundled demo logo or inline letter mark
 *   3. Initials        (AvatarFallback — always available)
 *
 * Uses Base UI's onLoadingStatusChange (not onError on the <img>) because
 * AvatarImage preloads with new Image() and unmounts the <img> on error,
 * so the two handlers would race on the same request.
 */

interface BrandIdentityProps {
  logoUrl?: string;
  name: string;
  domains?: { domain: string; isPrimary: boolean }[];
  primaryDomain?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

function BrandIdentityInner({
  logoUrl,
  name,
  primaryDomain,
  initialStage,
  className,
  imageClassName,
  fallbackClassName,
}: {
  logoUrl?: string;
  name: string;
  primaryDomain?: string;
  initialStage: Stage;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const [stage, setStage] = useState<Stage>(initialStage);

  const src = resolveUrl(stage, logoUrl, primaryDomain);

  function handleAdvance() {
    setStage((current) => advance(current, primaryDomain));
  }

  /**
   * Base UI fires onLoadingStatusChange with status values:
   *   'loading' | 'loaded' | 'error'
   *
   * When status === 'error', advance immediately.
   */
  function handleLoadingStatusChange(status: string) {
    if (status === 'error') {
      handleAdvance();
    }
  }

  const initials = getInitials(name);

  return (
    <Avatar className={className}>
      {src && (
        <AvatarImage
          key={src}
          src={src}
          referrerPolicy="no-referrer"
          alt={name}
          onLoadingStatusChange={handleLoadingStatusChange}
          className={cn('object-contain p-0.5', imageClassName)}
        />
      )}
      <AvatarFallback
        className={cn(
          'rounded-md bg-primary text-primary-foreground text-xs font-semibold',
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export function BrandIdentity({
  logoUrl,
  name,
  domains,
  primaryDomain: primaryDomainProp,
  className,
  imageClassName,
  fallbackClassName,
}: BrandIdentityProps) {
  const primaryDomain = primaryDomainProp ?? getPrimaryDomain(domains);
  const initialStage = resolveInitialStage(logoUrl, primaryDomain);
  const resetKey = `${logoUrl ?? ''}|${primaryDomain ?? ''}`;

  return (
    <BrandIdentityInner
      key={resetKey}
      logoUrl={logoUrl}
      name={name}
      primaryDomain={primaryDomain}
      initialStage={initialStage}
      className={className}
      imageClassName={imageClassName}
      fallbackClassName={fallbackClassName}
    />
  );
}
