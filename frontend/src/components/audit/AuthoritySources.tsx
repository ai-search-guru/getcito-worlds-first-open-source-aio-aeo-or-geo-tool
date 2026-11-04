'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AuditSignal } from '@/lib/actions/audits';

/** The signal whose sources this explains. */
export const AUTHORITY_SIGNAL = 'outbound-authority-links';

/** What a counted site is (server audit/authoritySources.js), as the report names it. */
const KINDS = ['official', 'international', 'research', 'news', 'trusted'] as const;
type AuthorityKind = (typeof KINDS)[number];
/** The shared list's kinds, as What counts lists them; the brand's own come after. */
const SHARED = KINDS.filter((kind) => kind !== 'trusted');
const isKind = (value: unknown): value is AuthorityKind => KINDS.includes(value as AuthorityKind);

/** How many sites the signal needs to pass. */
const TO_PASS = 2;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Outbound authority links, opened in the report (customer priorities item
 * 6): the sites that counted and what each is, others the page links to
 * that don't, and what counts, the brand's trusted sources (00449) last,
 * with the way to Settings › Content. An audit from before names only the
 * sites that counted.
 */
export function AuthoritySources({ signal }: { signal: AuditSignal }) {
  const t = useTranslations('audit.authority');
  const found = strings(signal.evidence.authorityHosts);
  const others = strings(signal.evidence.otherHosts);
  const kinds = (signal.evidence.authorityKinds ?? {}) as Record<string, unknown>;
  // The brand's trusted sources this audit counted; an audit from before has none to name.
  const trusted = strings(signal.evidence.trustedSources);

  return (
    <div data-slot="authority-sources" className="space-y-2">
      <p>
        <span className="font-medium text-foreground">{t('found')}: </span>
        {found.length === 0 ? (
          t('none', { count: TO_PASS })
        ) : (
          <>
            {found.map((host) => {
              const kind = kinds[host];
              return (
                <span
                  key={host}
                  title={isKind(kind) ? t(`kinds.${kind}`) : undefined}
                  className="mr-1 inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
                >
                  {host}
                </span>
              );
            })}
            {found.length < TO_PASS && t('oneMore')}
          </>
        )}
      </p>
      {others.length > 0 && <p>{t('others', { sites: others.join(', ') })}</p>}
      <div className="space-y-1.5 rounded-lg border px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">{t('whatCounts')}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          {SHARED.map((kind) => (
            <li key={kind}>{t(`counts.${kind}`)}</li>
          ))}
          <li>
            {t('counts.trusted')}{' '}
            {trusted.map((site) => (
              <span
                key={site}
                className="mr-1 inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
              >
                {site}
              </span>
            ))}
            <Link
              href="/dashboard/settings/content"
              className="text-foreground underline-offset-2 hover:underline"
            >
              {t(trusted.length > 0 ? 'editTrusted' : 'addTrusted')}
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
