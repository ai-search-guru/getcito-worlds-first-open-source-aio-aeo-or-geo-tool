'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import {
  getPromptSets,
  savePromptSet,
  addPromptToSet,
  setPromptActive,
  updatePrompt,
  updatePromptLocations,
  bulkUpdatePromptLocations,
  getLocationQuota,
  deletePrompt,
} from '@/lib/actions/prompt';
import { getBrandById } from '@/lib/actions/brand';
import { getTopics } from '@/lib/actions/topic';
import { generatePromptsFromTopics } from '@/lib/aiBrandSetup';
import { PromptSuggestionCard } from '@/components/dashboard/PromptSuggestionCard';
import { LocationPicker } from '@/components/dashboard/LocationPicker';
import { planBulkLocationChange } from '@/lib/promptLocations';
import { formatRegionDisplay } from '@/lib/region';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Sparkles, Save, X, Play, Search, Lock, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODEL_GROUPS, ALL_MODELS, SCRAPER_GROUPS, ALL_SCRAPERS } from '@/config/promptOptions';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  AddTopicLink,
  TopicFirstNotice,
  useTopicFirstDialog,
} from '@/components/prompts/TopicFirst';
import { isNoTopics } from '@/lib/topicsRequired';
import { PLANS } from '@/config/plans';
import { saveTrackingJob } from '@/lib/trackingJobStore';
import { useRouter } from '@/i18n/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import type { Brand, Prompt, PromptSet, Topic } from '@/types';
import { BROWSER_API_BASE_URL } from '@/config/api';

interface UnanalyzedPrompt {
  id: string;
  text: string;
  category: string;
}

const AEO_SERVER_URL = BROWSER_API_BASE_URL;

interface SuggestedPrompt {
  text: string;
  category: string;
  isActive: boolean;
}

export default function PromptsPage() {
  const params = useParams();
  const brandId = params.id as string;
  const router = useRouter();

  const [brand, setBrand] = useState<Brand | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [promptSets, setPromptSets] = useState<PromptSet[]>([]);
  // Org-wide location usage, so each card's picker can stop at the plan cap
  // with a reason instead of letting the save fail afterwards (#691).
  const [locationQuota, setLocationQuota] = useState<{
    maxPrompts: number;
    used: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [generateTopics, setGenerateTopics] = useState<string[] | null>(null);
  const { planId, allowedModelIds: planAllowedModelIds } = usePlanContext();
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): every write and run below opens
  // the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Prompts go under topics: with none, adding a prompt asks for a topic first,
  // on this brand's own Topics page (the active brand may be another).
  const addTopicHref = `/dashboard/brands/${brandId}/topics#add-topic`;
  const topicFirst = useTopicFirstDialog({ href: addTopicHref });
  const allowedScraperIds = useMemo(() => {
    const allowed = PLANS[planId].limits.allowedScrapers;
    const ids = allowed ? [...allowed] : ALL_SCRAPERS.map((s) => s.id);
    // Shopping tracking is opt-in per brand (#155): hide the engine entirely
    // when the pref is off. The write actions strip it server-side too.
    return brand?.shoppingModeEnabled ? ids : ids.filter((id) => id !== 'chatgpt-shopping');
  }, [planId, brand?.shoppingModeEnabled]);
  // From context, not PLANS[planId]: Enterprise orgs can have Claude switched
  // on per customer via plan_overrides, which only the layout can see.
  const allowedModelIds = useMemo(
    () => planAllowedModelIds ?? ALL_MODELS.map((m) => m.id),
    [planAllowedModelIds],
  );
  const visibleScrapers = useMemo(
    () => ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id)),
    [allowedScraperIds],
  );
  const visibleModels = useMemo(
    () => ALL_MODELS.filter((m) => allowedModelIds.includes(m.id)),
    [allowedModelIds],
  );
  const [manualModels, setManualModels] = useState<string[]>(allowedModelIds);
  const [manualScrapers, setManualScrapers] = useState<string[]>(allowedScraperIds);
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [unanalyzedPrompts, setUnanalyzedPrompts] = useState<UnanalyzedPrompt[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeDialogOpen, setAnalyzeDialogOpen] = useState(false);
  const [selectedAnalyzeIds, setSelectedAnalyzeIds] = useState<Set<string>>(new Set());

  // Bulk retargeting (#691). Adding a location to a selection multiplies
  // scraper spend, so the dialog prices the change before it is applied.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'add' | 'remove'>('add');
  const [bulkLocations, setBulkLocations] = useState<string[]>([]);
  const [bulkPromptIds, setBulkPromptIds] = useState<Set<string>>(new Set());
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [isLoadingUnanalyzed, setIsLoadingUnanalyzed] = useState(false);

  // Flatten all prompts from all sets, sorted newest first
  const allPrompts = useMemo(() => {
    return promptSets
      .flatMap((set) => set.prompts)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [promptSets]);

  const fetchUnanalyzed = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/unanalyzed/${brandId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUnanalyzedPrompts(data.prompts ?? []);
      }
    } catch {}
  }, [brandId]);

  const loadData = useCallback(
    async (isCancelled?: () => boolean) => {
      try {
        const [brandData, sets, topicsData, quota] = await Promise.all([
          getBrandById(brandId),
          getPromptSets(brandId),
          getTopics(brandId),
          getLocationQuota(brandId).catch(() => null),
        ]);
        if (isCancelled?.()) return;
        setBrand(brandData);
        setLocationQuota(quota);
        setTopics(topicsData);
        if (topicsData.length > 0 && !manualCategory) {
          setManualCategory(topicsData[0].name);
        }
        setGenerateTopics((prev) => (prev === null ? topicsData.map((t) => t.name) : prev));
        setPromptSets(sets);
      } catch {
        if (isCancelled?.()) return;
        toast.error('Failed to load data');
      } finally {
        if (!isCancelled?.()) setIsLoading(false);
      }
      fetchUnanalyzed();
    },
    [brandId, manualCategory, fetchUnanalyzed],
  );

  useEffect(() => {
    let cancelled = false;
    loadData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const handleGenerate = async () => {
    if (!brand) return;
    if (!generateTopics || generateTopics.length === 0) {
      toast.error('Select at least one topic to generate prompts');
      return;
    }

    setIsGenerating(true);
    setSuggestions([]);

    try {
      // Setup's helper cuts the brand to the lengths the API takes and asks
      // for the topics in batches it takes: every topic starts selected here.
      const { topicPrompts } = await generatePromptsFromTopics(
        {
          brandName: brand.name,
          industry: brand.industry,
          description: brand.description ?? '',
          website: brand.domains.find((d) => d.isPrimary)?.domain ?? '',
          language: brand.language || 'en',
        },
        generateTopics,
      );
      const allPrompts: SuggestedPrompt[] = [];
      for (const tp of topicPrompts) {
        for (const text of tp.prompts) {
          allPrompts.push({ text, category: tp.topic, isActive: true });
        }
      }
      setSuggestions(allPrompts);
      toast.success(`${allPrompts.length} prompt suggestions generated!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate suggestions');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveSuggestions = async () => {
    const activePrompts = suggestions.filter((s) => s.isActive);
    if (activePrompts.length === 0) {
      toast.error('Select at least one prompt to save');
      return;
    }

    setIsSaving(true);
    try {
      const defaultPlatforms = allowedScraperIds;
      const defaultModels = allowedModelIds;

      let targetSetId = promptSets[0]?.id;

      if (!targetSetId) {
        const result = await savePromptSet({
          brandId,
          name: 'Prompts',
          prompts: activePrompts.map((p) => ({
            text: p.text,
            category: p.category,
            platforms: defaultPlatforms,
            models: defaultModels,
          })),
        });
        if ('error' in result) {
          toast.error(result.error);
          return;
        }
        targetSetId = result.promptSet.id;
      } else {
        const results = await Promise.all(
          activePrompts.map((p) =>
            addPromptToSet({
              promptSetId: targetSetId,
              text: p.text,
              category: p.category,
              platforms: defaultPlatforms,
              models: defaultModels,
            }),
          ),
        );
        const failed = results.find((r) => 'error' in r);
        if (failed && 'error' in failed) {
          if (isNoTopics(failed)) topicFirst.show();
          else toast.error(failed.error);
          // Some prompts may have saved before the failure — refresh so the
          // list reflects what actually landed.
          await loadData();
          return;
        }
      }

      setSuggestions([]);
      toast.success(`Saved ${activePrompts.length} prompts`);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompts');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddManualPrompt = async () => {
    if (!manualText.trim()) return;
    if (topics.length === 0) {
      topicFirst.show();
      return;
    }

    setIsAddingManual(true);
    try {
      const existingSet = promptSets[0];

      const promptData = {
        text: manualText.trim(),
        category: manualCategory,
        platforms: manualScrapers,
        models: manualModels,
      };

      if (existingSet) {
        const result = await addPromptToSet({
          promptSetId: existingSet.id,
          ...promptData,
        });
        if ('error' in result) {
          if (isNoTopics(result)) topicFirst.show();
          else toast.error(result.error);
          return;
        }
      } else {
        const result = await savePromptSet({
          brandId,
          name: `Prompts`,
          prompts: [promptData],
        });
        if ('error' in result) {
          toast.error(result.error);
          return;
        }
      }

      setManualText('');
      setManualModels(allowedModelIds);
      setManualScrapers(allowedScraperIds);
      toast.success('Prompt added');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add prompt');
    } finally {
      setIsAddingManual(false);
    }
  };

  const updatePromptLocal = useCallback((promptId: string, patch: Partial<Prompt>) => {
    setPromptSets((prev) =>
      prev.map((set) => ({
        ...set,
        prompts: set.prompts.map((p) => (p.id === promptId ? { ...p, ...patch } : p)),
      })),
    );
  }, []);

  const removePromptLocal = useCallback((promptId: string) => {
    setPromptSets((prev) =>
      prev.map((set) => ({
        ...set,
        prompts: set.prompts.filter((p) => p.id !== promptId),
      })),
    );
  }, []);

  const handleTogglePrompt = useCallback(
    async (prompt: Prompt) => {
      updatePromptLocal(prompt.id, { isActive: !prompt.isActive });
      try {
        const result = await setPromptActive(prompt.id, !prompt.isActive);
        if ('error' in result) {
          updatePromptLocal(prompt.id, { isActive: prompt.isActive });
          // Resuming needs a free slot on the plan; the message says how many.
          toast.error(
            result.code === 'plan_limit' ? 'Not enough room to resume' : 'Failed to update prompt',
            result.code === 'plan_limit' ? { description: result.error } : undefined,
          );
          return;
        }
        // Pausing frees room and resuming takes it, so the location pickers
        // need the new usage figure. A failed refresh keeps the last one
        // rather than leaving the pickers uncapped.
        const quota = await getLocationQuota(brandId).catch(() => null);
        if (quota) setLocationQuota(quota);
      } catch {
        updatePromptLocal(prompt.id, { isActive: prompt.isActive });
        toast.error('Failed to update prompt');
      }
    },
    [brandId, updatePromptLocal],
  );

  const handleEditPrompt = useCallback(
    async (promptId: string, text: string) => {
      updatePromptLocal(promptId, { text });
      try {
        await updatePrompt(promptId, { text });
      } catch {
        toast.error('Failed to update prompt');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleCategoryChange = useCallback(
    async (promptId: string, category: string) => {
      updatePromptLocal(promptId, { category });
      try {
        await updatePrompt(promptId, { category });
      } catch {
        toast.error('Failed to update topic');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleModelsChange = useCallback(
    async (promptId: string, models: string[]) => {
      updatePromptLocal(promptId, { models });
      try {
        await updatePrompt(promptId, { models });
      } catch {
        toast.error('Failed to update models');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleRegionsChange = useCallback(
    async (promptId: string, regions: string[]) => {
      const result = await updatePromptLocations(promptId, regions);
      if ('error' in result) {
        toast.error(result.error);
        // The refusal means our usage figure was stale (a parallel edit, or
        // another tab): reload so the pickers bound themselves correctly.
        await loadData();
        return;
      }
      updatePromptLocal(promptId, { regions: result.prompt.regions });
      setLocationQuota(await getLocationQuota(brandId).catch(() => null));
    },
    [brandId, updatePromptLocal, loadData],
  );

  // The dialog prices the change with the same function the server action
  // enforces with, so the preview and the guard cannot disagree.
  const bulkPlan = useMemo(
    () =>
      planBulkLocationChange(
        allPrompts.filter((p) => bulkPromptIds.has(p.id)),
        bulkAction,
        bulkLocations,
      ),
    [allPrompts, bulkPromptIds, bulkAction, bulkLocations],
  );

  const openBulkDialog = useCallback(() => {
    setBulkAction('add');
    setBulkLocations([]);
    setBulkPromptIds(new Set(allPrompts.map((p) => p.id)));
    setBulkOpen(true);
  }, [allPrompts]);

  const handleBulkApply = useCallback(async () => {
    if (bulkPromptIds.size === 0 || bulkLocations.length === 0) return;
    setIsBulkSaving(true);
    try {
      const result = await bulkUpdatePromptLocations(
        Array.from(bulkPromptIds),
        bulkAction,
        bulkLocations,
      );
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      // Report what did NOT happen too: a silent "12 updated" hides the
      // single-location prompts a removal deliberately left alone.
      const parts = [
        `${result.updated} prompt${result.updated === 1 ? '' : 's'} updated`,
        result.unchanged > 0 ? `${result.unchanged} already matched` : null,
        result.blocked > 0 ? `${result.blocked} kept their only location` : null,
      ].filter(Boolean);
      toast.success(parts.join(' · '));
      setBulkOpen(false);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update locations');
    } finally {
      setIsBulkSaving(false);
    }
  }, [bulkPromptIds, bulkLocations, bulkAction, loadData]);

  const handlePlatformsChange = useCallback(
    async (promptId: string, platforms: string[]) => {
      updatePromptLocal(promptId, { platforms: platforms as Prompt['platforms'] });
      try {
        await updatePrompt(promptId, { platforms });
      } catch {
        toast.error('Failed to update platforms');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleDeletePrompt = useCallback(
    async (promptId: string) => {
      removePromptLocal(promptId);
      try {
        await deletePrompt(promptId);
      } catch {
        toast.error('Failed to delete prompt');
        await loadData();
      }
    },
    [removePromptLocal, loadData],
  );

  const openAnalyzeDialog = useCallback(async () => {
    setAnalyzeDialogOpen(true);
    setIsLoadingUnanalyzed(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/unanalyzed/${brandId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        const prompts: UnanalyzedPrompt[] = data.prompts ?? [];
        setUnanalyzedPrompts(prompts);
        setSelectedAnalyzeIds(new Set(prompts.map((p) => p.id)));
      }
    } catch {
      toast.error('Failed to load unanalyzed prompts');
    } finally {
      setIsLoadingUnanalyzed(false);
    }
  }, [brandId]);

  const handleAnalyzeSelected = async () => {
    if (isAnalyzing || selectedAnalyzeIds.size === 0) return;
    setIsAnalyzing(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/analyze-new`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
        body: JSON.stringify({ brandId, promptIds: Array.from(selectedAnalyzeIds) }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        toast.error(data.message || 'Failed to start analysis');
        return;
      }

      if (data.newCount === 0) {
        toast.info(data.message || 'All prompts already analyzed');
      } else {
        toast.success(data.message || `Analyzing ${data.newCount} new prompts`);
        setUnanalyzedPrompts([]);
        setAnalyzeDialogOpen(false);
        saveTrackingJob({ jobId: data.jobId, brandId, startedAt: Date.now() });
        router.push('/dashboard/insights');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Brand not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Read-only banner — non-admin / non-manager roles can't INSERT into
          prompts / prompt_sets at the DB layer (RLS). We hide the write
          controls below so they don't hit a generic "Failed to save"
          toast after the request gets rejected. */}
      {!canManage && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Read-only access</p>
            <p className="mt-1 text-muted-foreground">
              Your role can view tracked prompts but not add, edit, or delete them. Ask an admin or
              manager to make changes.
            </p>
          </div>
        </div>
      )}

      {/* Add Prompt + AI Generate */}
      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Manual Add */}
          <Card id="add-prompt" className="scroll-mt-24">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" />
                Add Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  placeholder="e.g. Best project management tools for startups"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualText.trim()) handleAddManualPrompt();
                  }}
                />

                <div className="space-y-3">
                  {/* Topic */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Topic
                    </label>
                    {topics.length > 0 ? (
                      <Select
                        value={manualCategory}
                        onValueChange={(v) => v && setManualCategory(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a topic" />
                        </SelectTrigger>
                        <SelectContent>
                          {topics.map((topic) => (
                            <SelectItem key={topic.id} value={topic.name}>
                              {topic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="space-y-2">
                        <TopicFirstNotice />
                        <AddTopicLink href={addTopicHref} />
                      </div>
                    )}
                  </div>

                  {/* Platform & Models — combined select */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Platform & Models
                    </label>
                    <Select
                      value="__placeholder__"
                      onValueChange={(v) => {
                        if (!v || v === '__placeholder__') return;
                        if (visibleModels.some((m) => m.id === v) && !manualModels.includes(v)) {
                          setManualModels((prev) => [...prev, v]);
                        } else if (
                          visibleScrapers.some((s) => s.id === v) &&
                          !manualScrapers.includes(v)
                        ) {
                          setManualScrapers((prev) => [...prev, v]);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <span className="truncate text-muted-foreground">
                          {manualModels.length + manualScrapers.length > 0
                            ? `${manualModels.length + manualScrapers.length} selected`
                            : 'Select platform & models'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {SCRAPER_GROUPS.map((group) => {
                          const scrapers = group.scrapers.filter((s) =>
                            visibleScrapers.some((vs) => vs.id === s.id),
                          );
                          if (scrapers.length === 0) return null;
                          return (
                            <div key={group.provider}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                {group.provider} (Scraper)
                              </div>
                              {scrapers.map((s) => (
                                <SelectItem
                                  key={s.id}
                                  value={s.id}
                                  disabled={manualScrapers.includes(s.id)}
                                >
                                  <div>
                                    <div>{s.label}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {s.id}
                                    </div>
                                  </div>
                                </SelectItem>
                              ))}
                            </div>
                          );
                        })}
                        {MODEL_GROUPS.map((group) => {
                          const groupModels = group.models.filter((m) =>
                            visibleModels.some((vm) => vm.id === m.id),
                          );
                          if (groupModels.length === 0) return null;
                          return (
                            <div key={group.provider}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                {group.provider} (API)
                              </div>
                              {groupModels.map((m) => (
                                <SelectItem
                                  key={m.id}
                                  value={m.id}
                                  disabled={manualModels.includes(m.id)}
                                >
                                  <div>
                                    <div>{m.label}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {m.id}
                                    </div>
                                  </div>
                                </SelectItem>
                              ))}
                            </div>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(manualModels.length > 0 || manualScrapers.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {manualScrapers.map((id) => {
                          const s = ALL_SCRAPERS.find((as_) => as_.id === id);
                          return (
                            <Badge key={id} variant="outline" className="gap-1 text-xs">
                              {s?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setManualScrapers((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                        {manualModels.map((id) => {
                          const m = ALL_MODELS.find((am) => am.id === id);
                          return (
                            <Badge key={id} variant="secondary" className="gap-1 text-xs">
                              {m?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setManualModels((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  onClick={guard(handleAddManualPrompt, { action: tActions('addPrompts') })}
                  disabled={
                    isAddingManual ||
                    !manualText.trim() ||
                    (manualScrapers.length === 0 && manualModels.length === 0)
                  }
                  className="w-full"
                >
                  {isAddingManual ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Prompt
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Generate */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                AI Generate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select topics and generate 5 optimized search prompts per topic using AI.
                </p>
                {topics.length > 0 ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Topics
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((topic) => {
                        const selected = generateTopics?.includes(topic.name) ?? false;
                        return (
                          <Badge
                            key={topic.id}
                            variant={selected ? 'default' : 'outline'}
                            className="cursor-pointer select-none"
                            onClick={() =>
                              setGenerateTopics((prev) =>
                                selected
                                  ? (prev ?? []).filter((t) => t !== topic.name)
                                  : [...(prev ?? []), topic.name],
                              )
                            }
                          >
                            {topic.name}
                          </Badge>
                        );
                      })}
                    </div>
                    {generateTopics && generateTopics.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {generateTopics.length} topic{generateTopics.length !== 1 ? 's' : ''}{' '}
                        selected — {generateTopics.length * 5} prompts will be generated
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <TopicFirstNotice />
                    <AddTopicLink href={addTopicHref} />
                  </div>
                )}
                <Button
                  onClick={guard(handleGenerate, { action: tActions('generatePrompts') })}
                  disabled={isGenerating || !generateTopics || generateTopics.length === 0}
                  className="w-full"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Prompts
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Suggestions Review (shown only when generated) */}
      {canManage && suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review AI Suggestions</CardTitle>
            <CardDescription>
              Toggle off prompts you don&apos;t want, edit text if needed, then save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <PromptSuggestionCard
                  key={i}
                  text={s.text}
                  category={s.category}
                  isActive={s.isActive}
                  onToggle={() =>
                    setSuggestions((prev) =>
                      prev.map((p, idx) => (idx === i ? { ...p, isActive: !p.isActive } : p)),
                    )
                  }
                  onTextChange={(text) =>
                    setSuggestions((prev) => prev.map((p, idx) => (idx === i ? { ...p, text } : p)))
                  }
                  mode="review"
                />
              ))}
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button
                onClick={guard(handleSaveSuggestions, { action: tActions('addPrompts') })}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Selected ({suggestions.filter((s) => s.isActive).length})
              </Button>
              <Button
                variant="outline"
                onClick={guard(handleGenerate, { action: tActions('generatePrompts') })}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Regenerate
              </Button>
              <Button variant="ghost" onClick={() => setSuggestions([])}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Prompts — flat list, newest first */}
      {allPrompts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">All Prompts ({allPrompts.length})</h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={guard(openBulkDialog, { action: tActions('changeLocations') })}
              >
                <Globe className="mr-2 h-3.5 w-3.5" />
                Locations
              </Button>
              <Button
                size="sm"
                variant={unanalyzedPrompts.length > 0 ? 'default' : 'outline'}
                onClick={guard(openAnalyzeDialog, { action: tActions('analyzePrompts') })}
              >
                <Search className="mr-2 h-3.5 w-3.5" />
                Analyze Prompts
                {unanalyzedPrompts.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    {unanalyzedPrompts.length} new
                  </Badge>
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {allPrompts.map((prompt) => (
              <PromptSuggestionCard
                key={prompt.id}
                text={prompt.text}
                category={prompt.category ?? ''}
                isActive={prompt.isActive}
                regions={prompt.regions}
                models={prompt.models}
                platforms={prompt.platforms}
                topics={topics}
                allowedScraperIds={allowedScraperIds}
                allowedModelIds={allowedModelIds}
                onToggle={guard(() => handleTogglePrompt(prompt), {
                  action: tActions(prompt.isActive ? 'pausePrompts' : 'resumePrompts'),
                })}
                onTextChange={guard((text: string) => handleEditPrompt(prompt.id, text), {
                  action: tActions('editPrompts'),
                })}
                onCategoryChange={guard(
                  (category: string) => handleCategoryChange(prompt.id, category),
                  { action: tActions('editPrompts') },
                )}
                onModelsChange={guard((models: string[]) => handleModelsChange(prompt.id, models), {
                  action: tActions('editPrompts'),
                })}
                onPlatformsChange={guard(
                  (platforms: string[]) => handlePlatformsChange(prompt.id, platforms),
                  { action: tActions('editPrompts') },
                )}
                onRegionsChange={guard(
                  (regions: string[]) => handleRegionsChange(prompt.id, regions),
                  { action: tActions('editPrompts') },
                )}
                maxLocations={
                  // A paused prompt's locations aren't in `used`; its cap is
                  // what it could take back when resumed.
                  locationQuota && locationQuota.maxPrompts !== -1
                    ? Math.max(
                        prompt.regions.length,
                        locationQuota.maxPrompts -
                          locationQuota.used +
                          (prompt.isActive ? prompt.regions.length : 0),
                      )
                    : null
                }
                onDelete={guard(() => handleDeletePrompt(prompt.id), {
                  action: tActions('deletePrompts'),
                })}
                mode="manage"
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {allPrompts.length === 0 && suggestions.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h3 className="mt-3 text-sm font-medium">No prompts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add prompts manually or generate them with AI above.
          </p>
        </div>
      )}

      {/* Analyze Prompts Dialog */}
      <Dialog open={analyzeDialogOpen} onOpenChange={setAnalyzeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Analyze Prompts</DialogTitle>
            <DialogDescription>
              {unanalyzedPrompts.length > 0
                ? 'Select which prompts to analyze with AI platforms.'
                : 'All prompts have already been analyzed.'}
            </DialogDescription>
          </DialogHeader>

          {isLoadingUnanalyzed ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : unanalyzedPrompts.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {selectedAnalyzeIds.size} of {unanalyzedPrompts.length} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedAnalyzeIds.size === unanalyzedPrompts.length) {
                      setSelectedAnalyzeIds(new Set());
                    } else {
                      setSelectedAnalyzeIds(new Set(unanalyzedPrompts.map((p) => p.id)));
                    }
                  }}
                >
                  {selectedAnalyzeIds.size === unanalyzedPrompts.length
                    ? 'Deselect All'
                    : 'Select All'}
                </Button>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {unanalyzedPrompts.map((prompt) => {
                  const checked = selectedAnalyzeIds.has(prompt.id);
                  return (
                    <label
                      key={prompt.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setSelectedAnalyzeIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(prompt.id);
                            else next.add(prompt.id);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{prompt.text}</p>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          {prompt.category}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center">
              <Play className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                All prompts have been analyzed. Add new prompts to analyze them.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAnalyzeDialogOpen(false)}>
              Cancel
            </Button>
            {unanalyzedPrompts.length > 0 && (
              <Button
                onClick={handleAnalyzeSelected}
                disabled={isAnalyzing || selectedAnalyzeIds.size === 0}
              >
                {isAnalyzing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Analyze ({selectedAnalyzeIds.size})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk locations dialog (#691) */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tracking locations</DialogTitle>
            <DialogDescription>
              Add a location to several prompts at once, or stop tracking one. Each prompt keeps the
              locations you don&apos;t touch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="inline-flex rounded-lg border p-1" role="tablist">
              {(['add', 'remove'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={bulkAction === mode}
                  onClick={() => setBulkAction(mode)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    bulkAction === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'add' ? 'Add' : 'Remove'}
                </button>
              ))}
            </div>

            <LocationPicker
              value={bulkLocations}
              onChange={setBulkLocations}
              maxSelectable={null}
              allowEmpty
              label={bulkAction === 'add' ? 'Locations to add' : 'Locations to remove'}
              countNoun="selected"
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {bulkPromptIds.size} of {allPrompts.length} prompts selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setBulkPromptIds(
                      bulkPromptIds.size === allPrompts.length
                        ? new Set()
                        : new Set(allPrompts.map((p) => p.id)),
                    )
                  }
                >
                  {bulkPromptIds.size === allPrompts.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {allPrompts.map((prompt) => {
                  const checked = bulkPromptIds.has(prompt.id);
                  return (
                    <label
                      key={prompt.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setBulkPromptIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(prompt.id);
                            else next.add(prompt.id);
                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{prompt.text}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {prompt.regions.map((r) => (
                            <span key={r} className="text-[10px] text-muted-foreground">
                              {formatRegionDisplay(r)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Priced before the click: every added location is another set of
                scraper and model calls, and another unit against the plan. */}
            {bulkLocations.length > 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                {bulkPlan.changes.length === 0 ? (
                  <span className="text-muted-foreground">
                    Nothing to change — the selected prompts already match.
                  </span>
                ) : (
                  <>
                    <span className="font-medium">
                      {bulkPlan.changes.length} prompt
                      {bulkPlan.changes.length === 1 ? '' : 's'} will change
                    </span>
                    <span className="text-muted-foreground">
                      {' · '}
                      {bulkPlan.delta >= 0 ? '+' : ''}
                      {bulkPlan.delta} location{Math.abs(bulkPlan.delta) === 1 ? '' : 's'}
                      {locationQuota && locationQuota.maxPrompts !== -1
                        ? ` (${locationQuota.used + bulkPlan.delta} of ${locationQuota.maxPrompts} used)`
                        : ''}
                    </span>
                    {bulkPlan.blocked > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        {bulkPlan.blocked} prompt{bulkPlan.blocked === 1 ? '' : 's'} would be left
                        with no location, so {bulkPlan.blocked === 1 ? 'it stays' : 'they stay'} as
                        {bulkPlan.blocked === 1 ? ' it is' : ' they are'}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={isBulkSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkApply}
              disabled={isBulkSaving || bulkPlan.changes.length === 0}
            >
              {isBulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {bulkAction === 'add' ? 'Add' : 'Remove'} ({bulkPlan.changes.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {topicFirst.dialog}
    </div>
  );
}
