'use client';

import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { CONTACT_SALES_URL } from '@/config/plans';
import type { LocationQuota } from '@/lib/actions/prompt';

/**
 * Where to go when the limit is reached. Starter can upgrade to Growth in
 * billing; Growth and Enterprise (custom limits) are raised by GetCito.
 */
export function PromptLimitActions({ planId }: { planId: LocationQuota['planId'] }) {
  const contact = (
    <a
      href={CONTACT_SALES_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonVariants({
        variant: planId === 'starter' ? 'outline' : 'default',
        size: 'sm',
      })}
    >
      Contact us
      <ExternalLink />
    </a>
  );
  if (planId !== 'starter') return contact;
  return (
    <>
      <Link href="/dashboard/settings?tab=billing" className={buttonVariants({ size: 'sm' })}>
        Upgrade plan
      </Link>
      {contact}
    </>
  );
}
