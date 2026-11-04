'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanSwitcher } from '@/components/settings/PlanSwitcher';
import { InvoiceList } from '@/components/settings/InvoiceList';
import { AiUsageCard } from '@/components/settings/AiUsageCard';
import { PLAN_STARTED_EVENT } from '@/lib/billing/planStarted';
import { AddOnsCard } from '@/components/settings/AddOnsCard';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useDemoBrand } from '@/components/context/DemoBrandProvider';
import { createClient } from '@/lib/supabase/client';
import { PLANS, type PlanId } from '@/config/plans';
import { subscriptionEnded } from '@/lib/billing/planPurchase';

interface SubscriptionData {
  planId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceAmount: number | null;
  interval: string | null;
}

function statusVariant(status: string) {
  switch (status) {
    case 'active':
      return 'default' as const;
    case 'trialing':
      return 'secondary' as const;
    case 'past_due':
      return 'destructive' as const;
    case 'canceled':
      return 'destructive' as const;
    default:
      return 'outline' as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    case 'past_due':
      return 'Past Due';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
}

export function BillingSection() {
  const t = useTranslations('settings');
  const tOffer = useTranslations('planOffer');
  // Whether the workspace ever had a Stripe subscription, from the layout.
  const { neverSubscribed } = useDemoBrand();
  // The organization's own plan: the demo brand's Growth is only how it is shown.
  const { ownPlanId: contextPlanId } = usePlanContext();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  // For a new subscription's Checkout, once the old one has ended.
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Plan changes made on this page: each has the AI usage card read again,
  // since a trial bought starts a new period with its usage at 0.
  const [planChanges, setPlanChanges] = useState(0);

  useEffect(() => {
    async function loadSubscription() {
      try {
        // First: load org data directly from Supabase (reliable, no API route auth issues)
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();

        if (!profile?.organization_id) return;
        setOrganizationId(profile.organization_id);

        const { data: org } = await supabase
          .from('organizations')
          .select('plan, subscription_status, subscription_ends_at')
          .eq('id', profile.organization_id)
          .single();

        if (!org) return;

        const plan = PLANS[(org.plan as PlanId) ?? 'starter'] ?? PLANS.starter;

        setSubscription({
          planId: org.plan ?? 'starter',
          status: (org.subscription_status as string) ?? 'active',
          currentPeriodEnd: (org.subscription_ends_at as string) ?? null,
          cancelAtPeriodEnd: false,
          priceAmount: plan.pricing?.monthly ?? null,
          interval: 'month',
        });

        // Then: try to enrich with live Stripe data (cancel status etc.)
        const res = await fetch('/api/stripe/subscription');
        if (res.ok) {
          const stripeData = await res.json();
          if (stripeData && !stripeData.error) {
            setSubscription(stripeData);
          }
        }
      } catch {
        // If everything fails, use context planId as last resort
        const plan = PLANS[contextPlanId] ?? PLANS.starter;
        setSubscription({
          planId: contextPlanId,
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          priceAmount: plan.pricing?.monthly ?? null,
          interval: 'month',
        });
      } finally {
        setLoading(false);
      }
    }

    loadSubscription();
  }, [contextPlanId]);

  // A trial's plan started from the AI usage band or card (Start my plan
  // now): the plan card shows it, and the AI usage card reads it again.
  useEffect(() => {
    const onStarted = (event: Event) => {
      const started = (event as CustomEvent<SubscriptionData>).detail;
      if (started?.planId) setSubscription(started);
      setPlanChanges((n) => n + 1);
    };
    window.addEventListener(PLAN_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(PLAN_STARTED_EVENT, onStarted);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('billing')}</CardTitle>
          <CardDescription>{t('billingDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('noSubscription')}</p>
        </CardContent>
      </Card>
    );
  }

  const plan = PLANS[subscription.planId as PlanId] ?? PLANS.starter;
  const ended = subscriptionEnded(subscription.status);
  // No plan was ever started: no plan to name, and the cards offer the free
  // trial beside Buy now. (An Enterprise plan set up without Stripe is active.)
  const noPlanYet = ended && neverSubscribed;

  // Choosing a plan, or changing it.
  const planCard = (
    <Card>
      <CardHeader>
        <CardTitle>
          {noPlanYet ? tOffer('chooseHowToStart') : ended ? t('choosePlanTitle') : t('changePlan')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <PlanSwitcher
          subscription={subscription}
          onUpdate={(data) => {
            setSubscription({ ...subscription, ...data });
            setPlanChanges((n) => n + 1);
          }}
          organizationId={organizationId}
          trialOffered={noPlanYet}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* With no plan active, choosing one comes first, all in view. */}
      {ended && planCard}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle>{t('currentPlan')}</CardTitle>
          <CardDescription>{t('billingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {noPlanYet ? (
            <div className="space-y-1">
              <p className="text-lg font-semibold">{t('noPlanYet')}</p>
              <p className="text-sm text-muted-foreground">{t('noPlanYetHint')}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold">{plan.name}</span>
              <Badge variant={statusVariant(subscription.status)}>
                {statusLabel(subscription.status)}
              </Badge>
            </div>
          )}

          {subscription.priceAmount != null && !noPlanYet && (
            <p className="text-sm text-muted-foreground">
              ${subscription.priceAmount}/
              {subscription.interval === 'year' ? t('year') : t('month')}
            </p>
          )}

          {subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && !ended && (
            <p className="text-sm text-muted-foreground">
              {t(subscription.status === 'trialing' ? 'trialEndsOn' : 'renewsOn', {
                date: new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <AiUsageCard key={planChanges} />

      {/* AI credit and storage packs (CHAT-18): nothing while Chat is off. */}
      <AddOnsCard />

      {/* Plan Switcher */}
      {!ended && planCard}

      <Separator />

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>{t('invoices')}</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceList />
        </CardContent>
      </Card>
    </div>
  );
}
