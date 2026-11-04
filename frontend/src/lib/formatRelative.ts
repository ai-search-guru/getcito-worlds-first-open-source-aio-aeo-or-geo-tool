/**
 * formatRelative.ts
 *
 * Single canonical implementation of the relative-time helper (issue #767).
 *
 * Rules (Topics copy is the source of truth):
 *   - null / undefined  → '—'
 *   - < 1 min           → t('common.relative.justNow')
 *   - < 60 min          → t('common.relative.minutesAgo', { m })   (Math.floor)
 *   - < 24 h            → t('common.relative.hoursAgo',   { h })   (Math.floor)
 *   - < 30 d            → t('common.relative.daysAgo',    { d })   (Math.floor)
 *   - ≥ 30 d            → formatDate(), e.g. "Sep 10, 2026": English like
 *                         the rest of the UI, not the browser's language
 *
 * Signature: accepts an ISO string (or null/undefined) plus the next-intl
 * translator scoped to 'common'. Call sites that previously received a Date
 * (insights/page.tsx) should call .toISOString() before passing in.
 */

import type { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';

type Translator = ReturnType<typeof useTranslations<'common'>>;

export function formatRelative(iso: string | null | undefined, t: Translator): string {
  if (!iso) return '—';

  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);

  if (m < 1) return t('relative.justNow');
  if (m < 60) return t('relative.minutesAgo', { m });

  const h = Math.floor(m / 60);
  if (h < 24) return t('relative.hoursAgo', { h });

  const d = Math.floor(h / 24);
  if (d < 30) return t('relative.daysAgo', { d });

  return formatDate(iso);
}
