'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react';
import type { Brand, Competitor } from '@/types';
import { suggestCompetitors, type SuggestedCompetitor } from '@/lib/aiBrandSetup';
import {
  competitorSuggestionKey,
  filterNewCompetitorSuggestions,
} from '@/lib/competitorSuggestions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddSelectedResult {
  added: number;
  failed: number;
}

interface SuggestCompetitorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand: Brand;
  existingCompetitors: Competitor[];
  onAddSelected: (suggestions: SuggestedCompetitor[]) => Promise<AddSelectedResult>;
}

export function SuggestCompetitorsDialog({
  open,
  onOpenChange,
  brand,
  existingCompetitors,
  onAddSelected,
}: SuggestCompetitorsDialogProps) {
  const t = useTranslations('competitors');
  const [suggestions, setSuggestions] = useState<SuggestedCompetitor[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const website = useMemo(
    () =>
      brand.domains.find((domain) => domain.isPrimary)?.domain ?? brand.domains[0]?.domain ?? '',
    [brand.domains],
  );

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    if (!website.trim()) {
      setSuggestions([]);
      setSelectedKeys([]);
      setLoadError(true);
      toast.error(t('missingCompetitorWebsite'));
      setLoading(false);
      return;
    }

    try {
      const result = await suggestCompetitors({
        brandName: brand.name,
        website,
        description: brand.description ?? '',
        region: brand.region ?? '',
        language: brand.language ?? 'en',
      });
      setSuggestions(result.competitors);
      setSelectedKeys(result.competitors.map(competitorSuggestionKey));
    } catch (error) {
      console.error('Failed to suggest competitors:', error);
      setSuggestions([]);
      setSelectedKeys([]);
      setLoadError(true);
      toast.error(t('suggestCompetitorsError'));
    } finally {
      setLoading(false);
    }
  }, [brand.description, brand.language, brand.name, brand.region, t, website]);

  useEffect(() => {
    if (open) void loadSuggestions();
  }, [open, loadSuggestions]);

  const visibleSuggestions = useMemo(
    () => filterNewCompetitorSuggestions(suggestions, existingCompetitors),
    [suggestions, existingCompetitors],
  );
  const selectedSuggestions = visibleSuggestions.filter((suggestion) =>
    selectedKeys.includes(competitorSuggestionKey(suggestion)),
  );

  function toggleSelected(suggestion: SuggestedCompetitor, checked: boolean) {
    const key = competitorSuggestionKey(suggestion);
    setSelectedKeys((current) =>
      checked ? [...new Set([...current, key])] : current.filter((item) => item !== key),
    );
  }

  async function handleAddSelected() {
    if (selectedSuggestions.length === 0) return;
    setSaving(true);
    try {
      const { added, failed } = await onAddSelected(selectedSuggestions);
      if (added > 0) toast.success(t('suggestedCompetitorsAdded', { count: added }));
      if (failed > 0) {
        toast.error(t('suggestedCompetitorsPartialError', { count: failed }));
        return;
      }
      if (added === 0) {
        toast.error(t('suggestedCompetitorsAddError'));
        return;
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to add suggested competitors:', error);
      toast.error(t('suggestedCompetitorsAddError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('suggestCompetitors')}
          </DialogTitle>
          <DialogDescription>
            {t('suggestCompetitorsDescription', { brand: brand.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-28 py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('suggestCompetitorsLoading')}</p>
            </div>
          ) : loadError ? (
            <p className="py-8 text-center text-sm text-destructive" role="alert">
              {t('suggestCompetitorsError')}
            </p>
          ) : visibleSuggestions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {suggestions.length > 0
                ? t('noNewCompetitorSuggestions')
                : t('noCompetitorSuggestions')}
            </p>
          ) : (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {visibleSuggestions.map((suggestion) => {
                const key = competitorSuggestionKey(suggestion);
                const checked = selectedKeys.includes(key);
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={saving}
                      onCheckedChange={(value) => toggleSelected(suggestion, value === true)}
                      aria-label={suggestion.name}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">
                        {suggestion.name}
                      </span>
                      <span className="block break-all text-xs text-muted-foreground">
                        {suggestion.domain}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center text-xs text-muted-foreground">
            {t('selectedCompetitorCount', { count: selectedSuggestions.length })}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || saving}
              onClick={() => void loadSuggestions()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {loadError ? t('suggestCompetitorsRetry') : t('refreshCompetitorSuggestions')}
            </Button>
            <Button
              type="button"
              disabled={loading || saving || selectedSuggestions.length === 0}
              onClick={() => void handleAddSelected()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t('addSelectedCompetitors', { count: selectedSuggestions.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
