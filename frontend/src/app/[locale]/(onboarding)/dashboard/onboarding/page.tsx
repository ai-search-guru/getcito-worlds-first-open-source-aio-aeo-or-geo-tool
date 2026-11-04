'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { createBrand, markBrandAsEcommerce } from '@/lib/actions/brand';
import { EcommerceNote } from '@/components/onboarding/EcommerceNote';
import { createTopics, getTopics } from '@/lib/actions/topic';
import { getPromptCapacity, getTrackedPromptCount, savePromptSet } from '@/lib/actions/prompt';
import { triggerTrackingCheck } from '@/lib/actions/tracking';
import { bootstrapBrandVolumes } from '@/lib/actions/volumes';
import { addCompetitor, getCompetitors } from '@/lib/actions/competitor';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { insertOrganization } from '@/lib/organizationInsert';
import { addCompetitorChoice, mergeCompetitorSuggestions } from '@/lib/competitorList';
import { useBrandStore } from '@/state/useBrandStore';
import {
  REGIONS,
  US_STATES,
  LANGUAGES,
  REGION_ITEMS,
  US_STATE_ITEMS,
  LANGUAGE_ITEMS,
} from '@/config/promptOptions';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';
import {
  firstMonthOfferOn,
  isCloud,
  SUBSCRIBABLE_PLANS,
  getPlan,
  toPlanId,
  type PlanId,
} from '@/config/plans';
import { choicePeriod, type CheckoutMode } from '@/lib/billing/planPurchase';
import {
  PlanDetailsToggle,
  PlanStart,
  PlanStartCard,
  StartChoicePicker,
  useFirstMonthOffer,
  useStartChoice,
  useStartCheckout,
} from '@/components/billing/PlanStart';

/** "What do you work on?" (menu access): once the brand is set up, before the plan. */
const WORK_AREAS_STEP = 6;
/** Choose a plan (cloud only): the last step. */
const PLAN_STEP = 7;

import type { Brand } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BRAND_SETUP_LIMITS,
  detectSiteType,
  suggestTopics,
  generatePromptsFromTopics,
  suggestCompetitors,
  suggestFailure,
  type SuggestFailure,
} from '@/lib/aiBrandSetup';
import { DashboardPreview } from '@/components/onboarding/DashboardPreview';
import { ExploreDemoCard } from '@/components/onboarding/ExploreDemoCard';
import { usePreloadDemo } from '@/hooks/useExploreDemo';
import { wantsDemoAhead } from '@/lib/demo/demoAhead';
import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame';
import { WorkAreasStep } from '@/components/onboarding/WorkAreasStep';
import { DASHBOARD_HOME } from '@/config/home';

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i + 1 === current
              ? 'w-6 bg-foreground'
              : i + 1 < current
                ? 'w-1.5 bg-foreground'
                : 'w-1.5 bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}

// ── Brand header (Steps 2-4) ───────────────────────────────────────────────────

function BrandHeader({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-8">
      {domain && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={getSiteIconUrl(domain, 32)} alt="" className="h-6 w-6 rounded" />
      )}
      <span className="text-sm font-medium">{name}</span>
      {domain && <span className="text-sm text-muted-foreground">{domain}</span>}
    </div>
  );
}

// ── Topic Prompt Accordion ─────────────────────────────────────────────────────

interface TopicPromptsData {
  topic: string;
  prompts: string[];
}

function TopicAccordion({
  data,
  defaultOpen = false,
  onRemoveTopic,
  onAddPrompt,
  onRemovePrompt,
}: {
  data: TopicPromptsData;
  defaultOpen?: boolean;
  onRemoveTopic: () => void;
  onAddPrompt: (prompt: string) => void;
  onRemovePrompt: (index: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [newPrompt, setNewPrompt] = useState('');

  const handleAdd = () => {
    const trimmed = newPrompt.trim();
    if (trimmed.length >= 10) {
      onAddPrompt(trimmed);
      setNewPrompt('');
    }
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 text-left text-sm"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium">{data.topic}</span>
          <span className="text-xs text-muted-foreground">{data.prompts.length} prompts</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 rounded hover:bg-muted text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onRemoveTopic}
            >
              Remove topic
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="pl-7 pb-3 space-y-1.5">
          {data.prompts.map((p, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 group rounded-md border bg-muted/30 px-3 py-2"
            >
              <span className="text-sm flex-1">{p}</span>
              <button
                onClick={() => onRemovePrompt(idx)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-2">
            <Input
              placeholder="Enter new prompt..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="text-sm h-9"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAdd}
              disabled={newPrompt.trim().length < 10}
              className="h-9 px-2"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewPrompt('')} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

// The state picker's own "no state" choice, ahead of the states themselves.
const STATE_ITEMS = [{ value: 'nationwide', label: 'Nationwide (no state)' }, ...US_STATE_ITEMS];

// Card width per step, matched to each step's content column; unlisted steps are forms.
const STEP_FRAME_WIDTH: Record<number, 'medium' | 'wide'> = {
  3: 'wide',
  4: 'wide',
  [WORK_AREAS_STEP]: 'wide',
  [PLAN_STEP]: 'medium',
};

const TOPIC_LOADING_MESSAGES = [
  'Researching topics for your brand...',
  'Analyzing your industry landscape...',
  'Identifying key themes and trends...',
  'Finding what your audience cares about...',
  'Evaluating competitive topics...',
  'Almost there, finalizing suggestions...',
];

const COMPETITOR_LOADING_MESSAGES = [
  'Searching for competitors...',
  'Analyzing your market...',
  'Identifying key players...',
  'Verifying company details...',
  'Finalizing recommendations...',
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const tWizard = useTranslations('brands.wizard');
  const tOffer = useTranslations('planOffer');
  const tPlans = useTranslations('readOnly.plans');
  const tWelcome = useTranslations('welcome');
  const { addBrand, setActiveBrand, updateBrand: updateBrandInStore } = useBrandStore();

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Step 1
  const [brandName, setBrandName] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');

  // Step 2
  const [region, setRegion] = useState('US');
  const [usState, setUsState] = useState('');
  const [language, setLanguage] = useState('en');

  // Intermediate state
  const [createdBrand, setCreatedBrand] = useState<Brand | null>(null);

  // Step 3
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [customTopic, setCustomTopic] = useState('');
  const [loadingTopics, setLoadingTopics] = useState(false);
  // #379 — suggestions can fail even after the server's retries; each step
  // then shows an inline "add your own" fallback instead of a bare toast.
  // 'dailyLimit': the day's setup suggestions are used up (429), so it says
  // to try tomorrow, and offers no Try again.
  const [topicSuggestError, setTopicSuggestError] = useState<SuggestFailure | null>(null);
  const [topicLoadingMsg, setTopicLoadingMsg] = useState('');
  const topicMsgIdx = useRef(0);

  useEffect(() => {
    if (!loadingTopics) {
      topicMsgIdx.current = 0;
      return;
    }
    setTopicLoadingMsg(TOPIC_LOADING_MESSAGES[0]);
    topicMsgIdx.current = 0;

    const interval = setInterval(() => {
      topicMsgIdx.current = (topicMsgIdx.current + 1) % TOPIC_LOADING_MESSAGES.length;
      setTopicLoadingMsg(TOPIC_LOADING_MESSAGES[topicMsgIdx.current]);
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingTopics]);

  // Step 4
  const [topicPrompts, setTopicPrompts] = useState<TopicPromptsData[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [promptGenError, setPromptGenError] = useState<SuggestFailure | null>(null);
  const [topicSaveError, setTopicSaveError] = useState(false);
  const [promptCapacity, setPromptCapacity] = useState<{
    maxPrompts: number;
    used: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Step 5
  interface CompetitorItem {
    name: string;
    domain: string;
    selected: boolean;
  }
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<CompetitorItem[]>([]);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);
  const [competitorSuggestError, setCompetitorSuggestError] = useState<SuggestFailure | null>(null);
  const [ecommerceDetected, setEcommerceDetected] = useState(false);
  const ecommerceSetup = useRef<Promise<void> | null>(null);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorDomain, setCompetitorDomain] = useState('');
  const [savingCompetitors, setSavingCompetitors] = useState(false);
  const [competitorLoadingMsg, setCompetitorLoadingMsg] = useState('');
  const competitorMsgIdx = useRef(0);

  // Plan step (cloud only)
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  // Trial length when the plan step is reached; null once the organization has
  // had a subscription, which then only buys now (Checkout refuses its trial).
  const [trialDays, setTrialDays] = useState<number | null>(14);
  // How the plan starts, as on the plan dialog: one choice above the cards,
  // the first-month offer shown from the first frame (the person setting up
  // the workspace is its admin), its code checked once the step is reached.
  const [offer, setOffer] = useFirstMonthOffer(firstMonthOfferOn(), step === PLAN_STEP);
  const [choice, setChoice] = useStartChoice(trialDays != null);
  // The plans' details (what each is for and includes), in the cards.
  const [planDetails, setPlanDetails] = useState(false);
  const { checkout, failed, start } = useStartCheckout({
    organizationId,
    period: choicePeriod(choice),
    // A canceled Checkout comes back to this step.
    returnTo: null,
    // Stripe turned the code down since it was checked: the plain prices.
    onCodeRefused: (code) => {
      setOffer(null);
      toast.error(tPlans('promo.invalid', { code: code.toUpperCase() }));
    },
    // Its trial is used after all: buying now is the way.
    onTrialUsed: () => setTrialDays(null),
  });

  useEffect(() => {
    if (step !== PLAN_STEP) return;
    let cancelled = false;
    fetch('/api/stripe/trial')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { trialAvailable: boolean; trialDays: number } | null) => {
        if (cancelled || !body) return;
        setTrialDays(body.trialAvailable ? body.trialDays : null);
      })
      // Keeps the default copy; checkout itself decides whether there is a trial.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step]);
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>('starter');

  // Whether the organization has no demo brand yet: then the plan step starts
  // its setup ahead, so "Explore the demo" waits less.
  const [demoMissing, setDemoMissing] = useState(false);
  useEffect(() => {
    if (step !== PLAN_STEP || !organizationId) return;
    let cancelled = false;
    createClient()
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', true)
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setDemoMissing(!data?.length);
      });
    return () => {
      cancelled = true;
    };
  }, [step, organizationId]);

  // A new workspace's demo brand is built as soon as the organization exists,
  // while its admin sets up their own brand: the first build takes a few
  // seconds, and "Explore the demo" on the plan step then opens at once.
  const [demoAhead, setDemoAhead] = useState(false);
  useEffect(() => {
    if (!isCloud() || !organizationId) return;
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth
      .getUser()
      .then(({ data: { user } }) =>
        user ? wantsDemoAhead(supabase, { organizationId, userId: user.id }) : false,
      )
      .catch(() => false)
      .then((wanted) => {
        if (!cancelled) setDemoAhead(wanted);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);
  usePreloadDemo(demoAhead);

  // What the dashboard preview shows when the plan step is reached by resuming
  // (a cancelled checkout, a lapsed trial) rather than by walking the steps, so
  // the wizard state it normally reads is empty. Kept apart from that state:
  // filling the real competitor list here would have Back → Finish save them again.
  const [resumedPreview, setResumedPreview] = useState<{
    brandName: string;
    domain: string;
    topics: string[];
    competitors: { name: string; domain: string }[];
  } | null>(null);
  // The own brand the plan step was resumed on (no wizard state then).
  const [resumedBrandId, setResumedBrandId] = useState<string | null>(null);

  // What the plan step's "Ready to track" says: the own brand's real setup,
  // read when the step is reached. Nothing is said until it is read.
  const planBrandId = createdBrand?.id ?? resumedBrandId;
  const [readyCounts, setReadyCounts] = useState<{
    prompts: number;
    topics: number;
    competitors: number;
  } | null>(null);
  useEffect(() => {
    if (step !== PLAN_STEP || !planBrandId) return;
    let cancelled = false;
    Promise.all([
      getTrackedPromptCount(planBrandId),
      getTopics(planBrandId),
      getCompetitors(planBrandId),
    ])
      .then(([prompts, topics, competitors]) => {
        if (!cancelled) {
          setReadyCounts({ prompts, topics: topics.length, competitors: competitors.length });
        }
      })
      // No line rather than a guessed one.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step, planBrandId]);

  // Self-host has no plan step, and asks "What do you work on?" on the
  // dashboard's first visit instead (/dashboard/welcome).
  const totalSteps = isCloud() ? PLAN_STEP : 5;

  // Determine which scrapers/models are available based on the plan
  const currentPlan = getPlan(currentPlanId);
  const allowedScraperIds = currentPlan.limits.allowedScrapers;
  const activeScrapers = allowedScraperIds
    ? ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id))
    : ALL_SCRAPERS;
  const allowedModelIds = currentPlan.limits.allowedModels;
  const activeModels = allowedModelIds
    ? ALL_MODELS.filter((m) => allowedModelIds.includes(m.id))
    : ALL_MODELS;

  useEffect(() => {
    if (!loadingCompetitors) {
      competitorMsgIdx.current = 0;
      return;
    }
    setCompetitorLoadingMsg(COMPETITOR_LOADING_MESSAGES[0]);
    competitorMsgIdx.current = 0;

    const interval = setInterval(() => {
      competitorMsgIdx.current =
        (competitorMsgIdx.current + 1) % COMPETITOR_LOADING_MESSAGES.length;
      setCompetitorLoadingMsg(COMPETITOR_LOADING_MESSAGES[competitorMsgIdx.current]);
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingCompetitors]);

  // Auto-fetch competitor suggestions when arriving at step 5 with none loaded
  useEffect(() => {
    if (
      step === 5 &&
      !initialLoading &&
      !loadingCompetitors &&
      suggestedCompetitors.length === 0 &&
      createdBrand
    ) {
      fetchCompetitorSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, initialLoading]);

  // Know the plan's prompt cap while reviewing, so the step can warn and
  // disable Continue instead of failing the save afterwards.
  useEffect(() => {
    if (step === 4 && createdBrand && !promptCapacity) {
      getPromptCapacity(createdBrand.id)
        .then(setPromptCapacity)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, createdBrand]);

  // Resume logic: check existing state on mount
  useEffect(() => {
    async function checkResume() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id, onboarding_completed, work_areas_asked_at')
          .eq('id', user.id)
          .single();

        if (profile?.onboarding_completed) {
          if (isCloud() && profile.organization_id) {
            // Check subscription status — if not active/trialing, show plan selection
            const { data: org } = await supabase
              .from('organizations')
              .select('subscription_status, plan')
              .eq('id', profile.organization_id)
              .single();
            if (org?.plan) setCurrentPlanId(toPlanId(org.plan));
            const subStatus = org?.subscription_status;
            if (subStatus !== 'active' && subStatus !== 'trialing') {
              setOrganizationId(profile.organization_id);
              void loadResumedPreview(profile.organization_id);
              setStep(profile.work_areas_asked_at ? PLAN_STEP : WORK_AREAS_STEP);
              setInitialLoading(false);
              return;
            }
          }
          router.push('/dashboard');
          router.refresh();
          return;
        }

        if (profile?.organization_id) {
          setOrganizationId(profile.organization_id);
          // The person's own brand: the demo brand may be built already (demo ahead).
          const { data: brands } = await supabase
            .from('brands')
            .select('*, brand_domains(*)')
            .eq('organization_id', profile.organization_id)
            .eq('is_demo', false)
            .limit(1);

          if (brands?.length) {
            const b = brands[0];
            const mapped: Brand = {
              id: b.id,
              organizationId: b.organization_id,
              name: b.name,
              slug: b.slug,
              logoUrl: b.logo_url ?? undefined,
              industry: b.industry ?? undefined,
              description: b.description ?? undefined,
              region: b.region ?? undefined,
              state: b.state ?? undefined,
              language: b.language ?? undefined,
              shoppingModeEnabled: !!b.shopping_mode_enabled,
              isActive: (b as { is_active?: boolean }).is_active ?? true,
              domains: (b.brand_domains || []).map((d: Record<string, unknown>) => ({
                id: d.id as string,
                brandId: d.brand_id as string,
                domain: d.domain as string,
                country: (d.country as string) ?? undefined,
                isPrimary: d.is_primary as boolean,
              })),
              createdAt: b.created_at,
              updatedAt: b.updated_at,
            };
            setCreatedBrand(mapped);
            addBrand(mapped);
            setActiveBrand(mapped.id);
            setBrandName(mapped.name);
            setWebsite(mapped.domains[0]?.domain || '');
            setDescription(mapped.description || '');
            setRegion(mapped.region || 'US');
            setUsState(mapped.state || '');
            setLanguage(mapped.language || 'en');

            const topics = await getTopics(mapped.id);
            if (topics.length > 0) {
              const { data: promptSets } = await supabase
                .from('prompt_sets')
                .select('id')
                .eq('brand_id', mapped.id);

              if (promptSets?.length) {
                // Prompts exist — go to step 5 (competitors)
                const existingCompetitors = await getCompetitors(mapped.id);
                if (existingCompetitors.length > 0) {
                  setSuggestedCompetitors(
                    existingCompetitors.map((c) => ({
                      name: c.name,
                      domain: c.domain,
                      selected: true,
                    })),
                  );
                }
                setStep(5);
              } else {
                setStep(3);
                setSuggestedTopics(topics.map((t) => t.name));
                setSelectedTopics(new Set(topics.map((t) => t.name)));
              }
            } else {
              setStep(3);
            }
          }
        }
      } catch (err) {
        console.error('Resume check failed:', err);
      } finally {
        setInitialLoading(false);
      }
    }
    checkResume();
  }, [router, addBrand, setActiveBrand]);

  const domain = website
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();

  // ── Step 2 → Step 3 transition: create org + brand ──

  const handleCreateOrgAndBrand = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if org already exists (resume case)
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      let orgId = profile?.organization_id;

      if (!orgId) {
        const newOrgId = await insertOrganization(supabase, brandName);

        const { error: profileError } = await supabase
          .from('profiles')
          .update({ organization_id: newOrgId })
          .eq('id', user.id);

        if (profileError) throw new Error(profileError.message);
        orgId = newOrgId;
      }

      setOrganizationId(orgId);

      // Create brand if not already created
      if (!createdBrand) {
        // logo_url starts null — BrandIdentity derives the favicon at render time.
        const result = await createBrand({
          organizationId: orgId,
          name: brandName.trim(),
          description: description.trim() || undefined,
          region,
          state: region === 'US' ? usState || undefined : undefined,
          language,
          domains: domain ? [{ domain, isPrimary: true }] : [],
        });
        if ('error' in result) {
          toast.error(result.error);
          return;
        }
        const { brand } = result;

        setCreatedBrand(brand);
        addBrand(brand);
        setActiveBrand(brand.id);
        void detectBrandType(brand.id);
      }

      setStep(3);

      // Auto-suggest topics
      if (suggestedTopics.length === 0) {
        fetchTopicSuggestions();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create brand');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Topic suggestion ──

  const fetchTopicSuggestions = async () => {
    setLoadingTopics(true);
    setTopicSuggestError(null);
    try {
      const { topics } = await suggestTopics({
        brandName: brandName.trim(),
        description: description.trim(),
        website: domain,
        language,
      });
      setSuggestedTopics(topics);
      setSelectedTopics(new Set(topics.slice(0, 7)));
    } catch (err) {
      console.error('Topic suggestion error:', err);
      setTopicSuggestError(suggestFailure(err));
    } finally {
      setLoadingTopics(false);
    }
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else if (next.size < 10) {
        next.add(topic);
      }
      return next;
    });
  };

  const addCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed && !suggestedTopics.includes(trimmed)) {
      setSuggestedTopics((prev) => [...prev, trimmed]);
      setSelectedTopics((prev) => {
        if (prev.size < 10) {
          const next = new Set(prev);
          next.add(trimmed);
          return next;
        }
        return prev;
      });
      setCustomTopic('');
    }
  };

  // ── Step 3 → Step 4: generate prompts from topics ──

  const handleGeneratePrompts = async () => {
    if (!createdBrand) return;
    setLoadingPrompts(true);
    setTopicSaveError(false);
    setPromptGenError(null);
    const topicNames = Array.from(selectedTopics);

    // Save topics to DB first, with its own error handling. createTopics
    // deletes the brand's existing topics before inserting the new ones, so
    // a failure here must keep the user on this step to retry rather than
    // falling through to the prompt-generation catch below — otherwise the
    // brand is left with zero topics while the wizard blames prompt
    // generation and advances anyway.
    try {
      await createTopics(createdBrand.id, topicNames);
    } catch (err) {
      console.error('Topic save error:', err);
      setTopicSaveError(true);
      setLoadingPrompts(false);
      return;
    }

    try {
      const { topicPrompts: generated } = await generatePromptsFromTopics(
        {
          brandName: brandName.trim(),
          description: description.trim(),
          website: domain,
          language,
        },
        topicNames,
      );
      setTopicPrompts(generated);
      setStep(4);
    } catch (err) {
      console.error('Prompt generation error:', err);
      // #379 — don't strand the user on the topics step behind a bare toast:
      // advance with empty per-topic groups so the manual add inputs are
      // usable, and explain inline. Continue stays disabled until they add
      // at least one prompt.
      setPromptGenError(suggestFailure(err));
      setTopicPrompts(topicNames.map((topic) => ({ topic, prompts: [] })));
      setStep(4);
    } finally {
      setLoadingPrompts(false);
    }
  };

  // ── Step 4 → Step 5: save prompts + fetch competitors ──

  const handleSavePromptsAndContinue = async () => {
    if (!createdBrand) return;
    setIsLoading(true);
    setSaveError(null);
    try {
      const allPrompts = topicPrompts.flatMap((tp) =>
        tp.prompts.map((text) => ({
          text,
          category: tp.topic,
          platforms: activeScrapers.map((s) => s.id),
          models: activeModels.map((m) => m.id),
          isActive: true,
        })),
      );

      if (allPrompts.length === 0) {
        setSaveError('Add at least one prompt before continuing.');
        setIsLoading(false);
        return;
      }

      const result = await savePromptSet({
        brandId: createdBrand.id,
        name: 'Onboarding Prompts',
        prompts: allPrompts,
      });
      if ('error' in result) {
        // No technical toasts on this step: actionable failures (plan limit)
        // show verbatim inline, anything else gets a friendly retry message.
        setSaveError(
          result.code === 'plan_limit'
            ? result.error
            : "We couldn't save your prompts — please try again.",
        );
        return;
      }

      setStep(5);
      fetchCompetitorSuggestions();
    } catch {
      setSaveError("We couldn't save your prompts — please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Competitor suggestion ──

  const fetchCompetitorSuggestions = async () => {
    setLoadingCompetitors(true);
    setCompetitorSuggestError(null);
    try {
      const { competitors, isEcommerce } = await suggestCompetitors({
        brandName: brandName.trim(),
        description: description.trim(),
        website: domain,
        language,
        region,
      });
      setSuggestedCompetitors((prev) => mergeCompetitorSuggestions(prev, competitors));
      // Kept, so Finish waits for it: it updates the prompts one by one.
      if (isEcommerce) ecommerceSetup.current = turnOnProductVisibility();
    } catch (err) {
      console.error('Competitor suggestion error:', err);
      setCompetitorSuggestError(suggestFailure(err));
    } finally {
      setLoadingCompetitors(false);
    }
  };

  // The brand's kind of site, from its home page (Step 0): in the
  // background, best effort; the app goes on guessing when it can't tell.
  const detectBrandType = async (brandId: string) => {
    try {
      const { siteType, industry } = await detectSiteType(brandId);
      if (!siteType) return;
      const updates = {
        siteType,
        siteTypeSource: 'auto' as const,
        ...(industry ? { industry } : {}),
      };
      setCreatedBrand((b) => (b?.id === brandId ? { ...b, ...updates } : b));
      updateBrandInStore(brandId, updates);
    } catch (err) {
      console.error('Site type detection error:', err);
    }
  };

  // The research found an online store: Shopping mode goes on, so Product
  // Visibility shows in the menu. Best effort: it can be turned on in the
  // brand's settings too.
  const turnOnProductVisibility = async () => {
    if (!createdBrand || createdBrand.shoppingModeEnabled) return;
    try {
      const { industry, siteType } = await markBrandAsEcommerce(createdBrand.id);
      const updates = {
        industry: industry ?? undefined,
        shoppingModeEnabled: true,
        ...(siteType ? { siteType, siteTypeSource: 'auto' as const } : {}),
      };
      setCreatedBrand({ ...createdBrand, ...updates });
      updateBrandInStore(createdBrand.id, updates);
      setEcommerceDetected(true);
    } catch (err) {
      console.error('E-commerce setup error:', err);
    }
  };

  const toggleCompetitor = (index: number) => {
    setSuggestedCompetitors((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c)),
    );
  };

  const removeCompetitor = (index: number) => {
    setSuggestedCompetitors((prev) => prev.filter((_, i) => i !== index));
  };

  const addManualCompetitor = () => {
    const { list, duplicate } = addCompetitorChoice(
      suggestedCompetitors,
      competitorName,
      competitorDomain,
    );
    if (list === suggestedCompetitors) return;
    if (duplicate) toast.info(`${duplicate.name} is already in the list`);
    setSuggestedCompetitors(list);
    setCompetitorName('');
    setCompetitorDomain('');
  };

  /**
   * The list to save: a competitor still sitting in the manual fields — typed
   * but never added with "+" — is one the user meant to track, so Finish
   * takes it along instead of dropping it.
   */
  const takePendingCompetitor = () => {
    const { list } = addCompetitorChoice(suggestedCompetitors, competitorName, competitorDomain);
    if (list !== suggestedCompetitors) {
      setSuggestedCompetitors(list);
      setCompetitorName('');
      setCompetitorDomain('');
    }
    return list;
  };

  // ── Step 5: final save ──

  const handleFinish = async () => {
    if (!createdBrand) return;
    const selected = takePendingCompetitor().filter((c) => c.selected);
    if (selected.length === 0) {
      toast.error('Add at least one competitor to continue.');
      return;
    }

    setSavingCompetitors(true);
    try {
      // Shopping mode first, if it is still going on: the first run should
      // track ChatGPT Shopping on every prompt, not some of them.
      await ecommerceSetup.current;
      // Save selected competitors
      await Promise.all(
        selected.map((c) => addCompetitor(createdBrand.id, { name: c.name, domain: c.domain })),
      );

      // Mark onboarding as complete
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
      }

      // Cloud mode → what they work on, then the subscription step (tracking
      // triggered after payment)
      if (isCloud()) {
        setSavingCompetitors(false);
        setStep(WORK_AREAS_STEP);
        return;
      }

      // Self-hosted: trigger tracking immediately
      try {
        const { jobId } = await triggerTrackingCheck(createdBrand.id);
        localStorage.setItem(
          'aeo:tracking-job',
          JSON.stringify({
            jobId,
            brandId: createdBrand.id,
            startedAt: Date.now(),
          }),
        );
      } catch {
        // Non-critical — tracking will run on schedule
      }

      // Volumes run alongside the scrape rather than waiting for someone to
      // find the Analyze button. The cloud flow returns above and gets this
      // from the Stripe success route once the plan is confirmed.
      await bootstrapBrandVolumes(createdBrand.id);

      toast.success('Setup complete! Your first tracking is starting.');

      // Full page navigation bypasses Next.js router cache, ensuring
      // the server-side layout reads the fresh onboarding_completed flag.
      window.location.href = DASHBOARD_HOME;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save competitors');
      setSavingCompetitors(false);
    }
  };

  // ── Plan step: Stripe checkout ──

  // The choice made above the cards: the free trial, or bought now (monthly
  // with the first-month offer while it's on, or a year); a card either way.
  const handleCheckout = (planId: PlanId, mode: CheckoutMode) => {
    if (!organizationId || checkout) return;
    void start(planId, mode, mode === 'buy' && choice === 'month' ? offer?.code : undefined);
  };

  // ── Topic prompt editing helpers ──

  const removeTopic = (index: number) => {
    setTopicPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const addPromptToTopic = (topicIndex: number, prompt: string) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) => (i === topicIndex ? { ...tp, prompts: [...tp.prompts, prompt] } : tp)),
    );
  };

  const removePromptFromTopic = (topicIndex: number, promptIndex: number) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) =>
        i === topicIndex
          ? { ...tp, prompts: tp.prompts.filter((_, pi) => pi !== promptIndex) }
          : tp,
      ),
    );
  };

  const totalPrompts = topicPrompts.reduce((sum, tp) => sum + tp.prompts.length, 0);
  // Prompts this brand may save before hitting the org's plan cap (null =
  // unknown or unlimited); over that, Continue is disabled with an inline hint.
  const promptLimit =
    promptCapacity && promptCapacity.maxPrompts !== -1
      ? Math.max(0, promptCapacity.maxPrompts - promptCapacity.used)
      : null;
  const excessPrompts = promptLimit !== null ? Math.max(0, totalPrompts - promptLimit) : 0;

  async function loadResumedPreview(orgId: string) {
    try {
      const supabase = createClient();
      // The person's own brand, not the demo brand they may have explored.
      const { data: brands } = await supabase
        .from('brands')
        .select('id, name, brand_domains(domain, is_primary)')
        .eq('organization_id', orgId)
        .eq('is_demo', false)
        .limit(1);
      const b = brands?.[0];
      if (!b) return;
      setResumedBrandId(b.id);
      const domains = (b.brand_domains ?? []) as { domain: string; is_primary: boolean }[];
      const [topics, competitors] = await Promise.all([getTopics(b.id), getCompetitors(b.id)]);
      setResumedPreview({
        brandName: b.name,
        domain: (domains.find((d) => d.is_primary) ?? domains[0])?.domain ?? '',
        topics: topics.map((t) => t.name),
        competitors: competitors.map((c) => ({ name: c.name, domain: c.domain })),
      });
    } catch {
      // Decoration only — the plan step works the same with an empty preview.
    }
  }

  const renderStep = () => {
    // ── Loading state ──

    if (initialLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // ── Step 1: Brand Info ──

    if (step === 1) {
      return (
        <div className="flex flex-col items-center justify-center gap-6 p-6 md:p-10">
          <div className="flex w-full max-w-md flex-col gap-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Globe className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Set up your brand</h1>
              <p className="text-sm text-muted-foreground">
                See how AI platforms talk about you. Add your first brand to get started.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandName">Brand name</Label>
                <Input
                  id="brandName"
                  placeholder="e.g. Acme Corp"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <div className="flex">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                    https://
                  </span>
                  <Input
                    id="website"
                    placeholder="example.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="rounded-l-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">
                  Describe your brand <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="A brief description helps us generate better suggestions."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
                <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
                  <li>What industry are you in?</li>
                  <li>Who is your target audience?</li>
                </ul>
              </div>

              <Button
                className="w-full"
                disabled={!brandName.trim() || !website.trim()}
                onClick={() => {
                  setStep(2);
                }}
              >
                Continue
              </Button>
            </div>
          </div>

          <StepDots current={1} total={totalSteps} />
        </div>
      );
    }

    // ── Step 2: Region & Language ──

    if (step === 2) {
      return (
        <div className="flex flex-col items-center justify-center gap-6 p-6 md:p-10">
          <div className="flex w-full max-w-md flex-col gap-6">
            <BrandHeader name={brandName} domain={domain} />

            <div>
              <h1 className="text-2xl font-bold tracking-tight">Select your target market</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Pick the region and language your audience uses. This helps us deliver more accurate
                AI visibility data.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Region</Label>
                <Select
                  items={REGION_ITEMS}
                  value={region}
                  onValueChange={(v) => {
                    if (!v) return;
                    setRegion(v);
                    if (v !== 'US') setUsState('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.code} value={r.code}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {region === 'US' && (
                <div className="space-y-2">
                  <Label>State (optional)</Label>
                  <Select
                    items={STATE_ITEMS}
                    value={usState || 'nationwide'}
                    onValueChange={(v) => setUsState(!v || v === 'nationwide' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nationwide">Nationwide (no state)</SelectItem>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Localizes AI answers to this state. Leave empty for nationwide results.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Language</Label>
                <Select
                  items={LANGUAGE_ITEMS}
                  value={language}
                  onValueChange={(v) => v && setLanguage(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button className="w-full" onClick={handleCreateOrgAndBrand} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </div>

          <div className="flex w-full max-w-md items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <StepDots current={2} total={totalSteps} />
            <div className="w-12" />
          </div>
        </div>
      );
    }

    // ── Step 3: Topic Selection ──

    if (step === 3) {
      return (
        <div className="flex flex-col p-6 md:p-10">
          <div className="mx-auto w-full max-w-4xl flex-1">
            <BrandHeader name={brandName} domain={domain} />

            <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
              <div className="lg:col-span-3 space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Choose topics to monitor</h1>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-sm text-muted-foreground">Select up to 10 topics</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${(selectedTopics.size / 10) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {loadingTopics ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                    <Sparkles className="h-5 w-5 animate-pulse" />
                    <span key={topicLoadingMsg} className="text-sm animate-in fade-in duration-500">
                      {topicLoadingMsg}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {topicSuggestError && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                        <span>
                          {topicSuggestError === 'dailyLimit' ? (
                            tWizard('suggestionsUsedUp')
                          ) : (
                            <>
                              Couldn&apos;t fetch topic suggestions right now — add your own above.
                            </>
                          )}
                        </span>
                        {topicSuggestError !== 'dailyLimit' && (
                          <Button variant="outline" size="sm" onClick={fetchTopicSuggestions}>
                            Try again
                          </Button>
                        )}
                      </div>
                    )}
                    {suggestedTopics.map((topic) => {
                      const isSelected = selectedTopics.has(topic);
                      return (
                        <button
                          key={topic}
                          onClick={() => toggleTopic(topic)}
                          className={cn(
                            'flex items-center gap-3 w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                            isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-muted-foreground/30',
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/30',
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          {topic}
                        </button>
                      );
                    })}

                    <div className="flex items-center gap-2 pt-2">
                      <Input
                        placeholder="Add custom topic..."
                        maxLength={BRAND_SETUP_LIMITS.topic}
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addCustomTopic()}
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={addCustomTopic}
                        disabled={!customTopic.trim()}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {topicSaveError && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                    Couldn&apos;t save your topics — please try again.
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={selectedTopics.size === 0 || loadingPrompts || loadingTopics}
                  onClick={handleGeneratePrompts}
                >
                  {loadingPrompts ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating prompts...
                    </>
                  ) : (
                    'Looks good'
                  )}
                </Button>
              </div>

              <div className="lg:col-span-2">
                <div className="rounded-xl border bg-card p-5 sticky top-10">
                  <h3 className="text-sm font-semibold mb-4">Topic Selection Tips</h3>
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">5 prompts are created per topic</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          You can select up to 10 topics for a total of 50 prompts. More can be
                          added anytime from the dashboard.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Think like your customers</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Use terms your audience would search for when looking for products or
                          services like yours.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Keep it short</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Topics should be concise — we&apos;ll turn them into detailed prompts in
                          the next step.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <StepDots current={3} total={totalSteps} />
            <div className="w-12" />
          </div>
        </div>
      );
    }

    // ── Step 4: Prompt Review ──

    if (step === 4) {
      return (
        <div className="flex flex-col p-6 md:p-10">
          <div className="mx-auto w-full max-w-4xl flex-1">
            <BrandHeader name={brandName} domain={domain} />

            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Review your prompts</h1>
              <p className="text-sm text-muted-foreground mt-1">
                These prompts will be sent to AI platforms daily. Feel free to edit, add, or remove
                any before starting.
              </p>
            </div>

            {promptGenError && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                {promptGenError === 'dailyLimit' ? (
                  tWizard('promptSuggestionsUsedUp')
                ) : (
                  <>
                    Couldn&apos;t generate prompt suggestions right now — add your own to each topic
                    below to continue.
                  </>
                )}
              </div>
            )}

            {excessPrompts > 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                Your plan includes up to {promptLimit} prompts — remove {excessPrompts} to continue.
              </div>
            )}

            {saveError && excessPrompts === 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                {saveError}
              </div>
            )}

            <div className="mb-4">
              <p className="text-sm font-medium">Your Prompt List</p>
              <p className="text-xs text-muted-foreground">{totalPrompts} prompts total</p>
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                <span className="flex-1">Topic</span>
              </div>
              {topicPrompts.map((tp, idx) => (
                <TopicAccordion
                  key={`${tp.topic}-${idx}`}
                  data={tp}
                  defaultOpen={idx === 0}
                  onRemoveTopic={() => removeTopic(idx)}
                  onAddPrompt={(p) => addPromptToTopic(idx, p)}
                  onRemovePrompt={(pi) => removePromptFromTopic(idx, pi)}
                />
              ))}
              {topicPrompts.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No prompts generated yet.
                </div>
              )}
            </div>

            <Button
              className="mt-6 w-full"
              onClick={handleSavePromptsAndContinue}
              disabled={isLoading || totalPrompts === 0 || excessPrompts > 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving prompts...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </div>

          <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <StepDots current={4} total={totalSteps} />
            <div className="w-12" />
          </div>
        </div>
      );
    }

    // ── Step 5: Competitors ──

    if (step === 5) {
      // Counted over the list Finish will save, which takes along a competitor
      // still sitting in the manual fields — otherwise the button stays
      // disabled for someone who typed theirs and never pressed "+".
      const selectedCompetitorCount = addCompetitorChoice(
        suggestedCompetitors,
        competitorName,
        competitorDomain,
      ).list.filter((c) => c.selected).length;
      const hasSelectedCompetitors = selectedCompetitorCount > 0;

      return (
        <div className="flex flex-col p-6 md:p-10">
          <div className="mx-auto w-full max-w-lg flex-1">
            <BrandHeader name={brandName} domain={domain} />

            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Add your competitors</h1>
              <p className="text-sm text-muted-foreground mt-1">
                We&apos;ll track how often competitors appear alongside your brand in AI responses.
              </p>
            </div>

            {ecommerceDetected && <EcommerceNote brandName={brandName.trim()} />}

            {/* First, and outside the loading state: people arrive knowing their
                rivals and should not have to wait for, or scroll past, ours. */}
            <div className="mb-6 space-y-2">
              <p className="text-sm text-muted-foreground">Know your competitors? Add them here.</p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Company name"
                  value={competitorName}
                  onChange={(e) => setCompetitorName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addManualCompetitor()}
                  className="text-sm"
                />
                <Input
                  placeholder="domain.com"
                  value={competitorDomain}
                  onChange={(e) => setCompetitorDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addManualCompetitor()}
                  className="text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addManualCompetitor}
                  disabled={!competitorName.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {loadingCompetitors ? (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Sparkles className="h-5 w-5 animate-pulse" />
                <span
                  key={competitorLoadingMsg}
                  className="text-sm animate-in fade-in duration-500"
                >
                  {competitorLoadingMsg}
                </span>
              </div>
            ) : (
              <div className="space-y-4">
                {competitorSuggestError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                    <span>
                      {competitorSuggestError === 'dailyLimit' ? (
                        tWizard('suggestionsUsedUp')
                      ) : (
                        <>
                          Couldn&apos;t fetch competitor suggestions right now — add your own above.
                        </>
                      )}
                    </span>
                    {competitorSuggestError !== 'dailyLimit' && (
                      <Button variant="outline" size="sm" onClick={fetchCompetitorSuggestions}>
                        Try again
                      </Button>
                    )}
                  </div>
                )}
                {suggestedCompetitors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Competitors to track
                    </p>
                    {suggestedCompetitors.map((c, idx) => (
                      <div
                        key={`${c.domain}-${idx}`}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                          c.selected
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-border hover:bg-muted/50',
                        )}
                        onClick={() => toggleCompetitor(idx)}
                      >
                        <div
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                            c.selected
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/30',
                          )}
                        >
                          {c.selected && <Check className="h-3 w-3" />}
                        </div>
                        {c.domain && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={getSiteIconUrl(c.domain)}
                            alt=""
                            className="h-5 w-5 rounded-sm"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          {c.domain && (
                            <p className="text-xs text-muted-foreground truncate">{c.domain}</p>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCompetitor(idx);
                          }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleFinish}
                  disabled={savingCompetitors || !hasSelectedCompetitors}
                >
                  {savingCompetitors ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Finishing setup...
                    </>
                  ) : hasSelectedCompetitors ? (
                    `Start tracking with ${selectedCompetitorCount} competitor${selectedCompetitorCount !== 1 ? 's' : ''}`
                  ) : (
                    'Add a competitor to continue'
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="flex mx-auto w-full max-w-lg items-center justify-between mt-8">
            <button
              onClick={() => setStep(4)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <StepDots current={5} total={totalSteps} />
            <div className="w-12" />
          </div>
        </div>
      );
    }

    // ── What do you work on? (menu access) ──

    if (step === WORK_AREAS_STEP) {
      return (
        <WorkAreasStep
          title={tWelcome('title')}
          lede={tWelcome('lede')}
          onDone={() => {
            toast.success('Almost done! Choose a plan to get started.');
            setStep(PLAN_STEP);
          }}
          footer={
            <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
              <button
                onClick={() => setStep(5)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <StepDots current={WORK_AREAS_STEP} total={totalSteps} />
              <div className="w-12" />
            </div>
          }
        />
      );
    }

    // ── Choose Plan (cloud only) ──

    if (step !== PLAN_STEP) return null;

    const trialOffered = trialDays != null;
    const planBrandName = createdBrand?.name ?? resumedPreview?.brandName ?? (brandName || null);

    // Laid out to fit a laptop screen whole (1024×768 and up): the plans'
    // details open inside their cards.
    return (
      <div className="flex flex-col p-6 md:px-8">
        <div className="mx-auto w-full max-w-2xl flex-1">
          <div className="mb-4 text-center">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {trialOffered ? tOffer('chooseHowToStart') : tOffer('choosePlan')}
            </h1>
            {/* Its line's room is kept while the counts are read: nothing moves. */}
            <div className="mt-2 min-h-5">
              {readyCounts && planBrandName && (
                <p
                  data-slot="ready-to-track"
                  className="inline-flex items-start gap-1.5 text-sm text-muted-foreground"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  <span>
                    {tOffer.rich('readyToTrack', {
                      brand: planBrandName,
                      ...readyCounts,
                      b: (chunks) => (
                        <strong className="font-medium text-foreground">{chunks}</strong>
                      ),
                    })}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* How the plan starts: the trial, monthly with the offer, or a year */}
          <div className="mb-5 flex">
            <StartChoicePicker
              choice={choice}
              onChange={setChoice}
              trialOffered={trialOffered}
              offer={offer}
              centered
            />
          </div>

          {/* Plan cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {SUBSCRIBABLE_PLANS.map((planId) => (
              <PlanStartCard
                key={planId}
                planId={planId}
                choice={choice}
                offer={offer}
                details={planDetails}
              >
                <PlanStart
                  planId={planId}
                  choice={choice}
                  offer={offer}
                  trialOffered={trialOffered}
                  opening={checkout?.planId === planId ? checkout.mode : null}
                  disabled={!organizationId || checkout != null}
                  error={failed?.planId === planId ? failed.message : null}
                  onStart={(mode) => handleCheckout(planId, mode)}
                />
              </PlanStartCard>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span data-slot="card-note">
              {tOffer('cardNote', { both: trialOffered ? 'yes' : 'no' })}
            </span>
            <PlanDetailsToggle
              open={planDetails}
              onToggle={() => setPlanDetails((open) => !open)}
            />
          </div>

          <ExploreDemoCard brandName={planBrandName} preload={demoMissing} />
        </div>

        <div className="flex mx-auto w-full max-w-2xl items-center justify-between mt-5">
          <button
            onClick={() => setStep(WORK_AREAS_STEP)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <StepDots current={PLAN_STEP} total={totalSteps} />
          <div className="w-12" />
        </div>
      </div>
    );
  };

  const previewTopics = step >= 4 ? topicPrompts.map((tp) => tp.topic) : Array.from(selectedTopics);

  return (
    <OnboardingFrame
      width={initialLoading ? 'narrow' : (STEP_FRAME_WIDTH[step] ?? 'narrow')}
      preview={
        resumedPreview && !brandName ? (
          <DashboardPreview {...resumedPreview} promptCount={0} />
        ) : (
          <DashboardPreview
            brandName={brandName}
            // The website field is typed live on step 1; waiting until it is
            // submitted keeps the favicon lookup from firing on every keystroke.
            domain={step >= 2 ? domain : ''}
            topics={previewTopics}
            promptCount={step >= 4 ? totalPrompts : 0}
            competitors={suggestedCompetitors.filter((c) => c.selected)}
          />
        )
      }
    >
      {renderStep()}
    </OnboardingFrame>
  );
}
