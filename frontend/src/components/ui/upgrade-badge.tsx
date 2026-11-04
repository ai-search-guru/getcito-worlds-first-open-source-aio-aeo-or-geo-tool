'use client';

import { useFeatureGate } from '@/hooks/useFeatureGate';
import type { Feature } from '@/config/plans';
import { Badge } from '@/components/ui/badge';
import { Crown } from 'lucide-react';

interface UpgradeBadgeProps {
  feature: Feature;
  className?: string;
}

export function UpgradeBadge({ feature, className }: UpgradeBadgeProps) {
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();

  if (!isCloud || canUse(feature)) return null;

  return (
    <Badge variant="outline" className={className}>
      <Crown className="mr-1 h-3 w-3" />
      {requiredPlanFor(feature)}
    </Badge>
  );
}

interface FeatureGateProps {
  feature: Feature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { canUse } = useFeatureGate();

  if (canUse(feature)) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : null;
}
