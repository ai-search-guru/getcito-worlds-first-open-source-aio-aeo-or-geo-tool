import type { AuditSignal } from '@/lib/actions/audits';

/**
 * The checks a page fails, as the Action Center's page check reads them
 * (learning D2; server action-center/fromAudit.js): a fail, and a warning
 * only for JSON-LD validity, whose warning is a broken block.
 */
export function failingChecks(signals: Pick<AuditSignal, 'key' | 'status'>[]): number {
  return signals.filter(
    (s) => s.status === 'fail' || (s.status === 'warn' && s.key === 'json-ld-validity'),
  ).length;
}
