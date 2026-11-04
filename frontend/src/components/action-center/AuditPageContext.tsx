'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { pagePath } from '@/lib/content/overlap';

/**
 * The payload's failing checks, read defensively: each named by the label
 * Site Audit gave it when sent (server rubric), else by its key.
 */
function checksOf(raw: unknown): { key: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const c = (item ?? {}) as Record<string, unknown>;
    const key = typeof c.key === 'string' ? c.key : '';
    const label = typeof c.label === 'string' && c.label.trim() ? c.label.trim() : key;
    return label ? [{ key: key || label, label }] : [];
  });
}

/**
 * What a page sent from its Site Audit report carries (learning D2): the
 * report it came from, the page, and the checks it failed when sent. Copied
 * onto the action at send time, so it still reads after the page is audited
 * again.
 */
export function AuditPageContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.auditPage');
  const auditId = typeof payload.auditId === 'string' && payload.auditId ? payload.auditId : null;
  const page = typeof payload.url === 'string' && payload.url ? payload.url : null;
  const checks = checksOf(payload.checks);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue')}</span>
          {auditId && (
            <Link
              href={`/dashboard/audit/${auditId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('openReport')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      {page && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('page')}</p>
          <p className="mt-1 truncate" title={page}>
            {pagePath(page)}
          </p>
        </div>
      )}
      {checks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t('checks', { count: checks.length })}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {checks.map((check) => (
              <li key={check.key} className="break-words">
                {check.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
