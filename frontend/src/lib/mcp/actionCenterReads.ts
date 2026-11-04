import type { McpAuthContext } from '@/lib/mcpAuth';
import { getKpiSnapshots } from '@/lib/actions/kpis';
import { getGettingStarted } from '@/lib/actions/gettingStarted';
import { getTrackingWindow } from '@/lib/actions/tracking';
import { brandAllowed } from './data';
import { asService, newestOf } from './chatFacts';

/**
 * Chat's Action Center reads (CHAT-20 §9 rows 41 and 47): the KPIs page's
 * snapshots and Getting started's steps, read by the pages' own loaders
 * with the service role once the brand is the caller's. Null for a brand
 * outside the organization.
 */

export async function getActionCenterKpisFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const [snapshots, window] = await asService(() =>
    Promise.all([getKpiSnapshots(params.brandId), getTrackingWindow(params.brandId)]),
  );
  return {
    configured: snapshots.configured,
    kpis: snapshots.kpis.map((kpi) => ({
      key: kpi.key,
      category: kpi.category,
      unit: kpi.unit,
      direction: kpi.direction,
      timeframe: kpi.timeframe,
      value: kpi.value,
      change: kpi.change,
      change_kind: kpi.changeKind,
      target: kpi.target,
      progress: kpi.progress,
      status: kpi.status,
    })),
    // The KPIs read the brand's tracked answers: as of its last completed run.
    data_as_of: window.lastRunAt ?? null,
  };
}

export async function getOnboardingProgressFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const status = await asService(() => getGettingStarted(params.brandId));
  if (!status) return null;
  return {
    active: status.active,
    skipped: status.skipped,
    done: status.done,
    total: status.total,
    steps: status.steps.map((step) => ({
      key: step.key,
      stage: step.stage,
      state: step.state,
      progress: step.progress,
    })),
    data_as_of: newestOf(status.steps.map((step) => step.updatedAt)),
  };
}
