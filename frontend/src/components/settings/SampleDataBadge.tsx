'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

/** "Sample data", beside a connected integration's badge on the demo brand. */
export function SampleDataBadge() {
  const t = useTranslations('settings.demoIntegrations');
  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      {t('sampleData')}
    </Badge>
  );
}
