'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LocationPicker } from '@/components/dashboard/LocationPicker';
import {
  bulkUpdatePromptLocations,
  getLocationQuota,
  type LocationQuota,
} from '@/lib/actions/prompt';
import { planBulkLocationChange } from '@/lib/promptLocations';
import { CITY_PLATFORMS } from '@/config/cities';
import { parseLocation, regionFlag, regionLabel } from '@/lib/region';
import { cn } from '@/lib/utils';
import type { Prompt } from '@/types';
import { PromptLimitActions } from './_PromptLimitActions';

type Scope = 'one' | 'selected' | 'topic' | 'all';
type Mode = 'add' | 'remove';

export interface AddLocationsPreset {
  /** Add (the default) or stop tracking. */
  mode?: Mode;
  /** One prompt, from a Locations view cell's + Track or Stop tracking here. */
  promptId?: string;
  locations?: string[];
}

/** Each location the prompts track, the most tracked first, with how many track it. */
function trackedLocations(prompts: readonly Prompt[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    for (const code of new Set(p.regions)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ code, count }));
}

/**
 * Track in more locations (PROMPT-015c), or stop tracking in some: the
 * locations (to add, or among those the prompts track), the prompts (one,
 * the selected, a topic, or all shown), and what it does to the plan's
 * tracked locations before anything is saved. Adding past the limit says
 * what the choice needs and what is left, with the plan's way out, and saves
 * nothing. Removing never leaves a prompt without a location: those it would
 * are left alone and counted. The preview and the save run the same
 * arithmetic (planBulkLocationChange), and the save checks the limit again.
 * Past results stay: a removed location is only asked no more.
 */
export function AddLocationsDialog({
  open,
  onOpenChange,
  brandId,
  prompts,
  selectedIds,
  preset,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  /** The rows the table shows. */
  prompts: Prompt[];
  selectedIds: ReadonlySet<string>;
  preset: AddLocationsPreset | null;
  onDone: () => void;
}) {
  const t = useTranslations('prompts.addLocations');
  const [mode, setMode] = useState<Mode>('add');
  const [locations, setLocations] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>('all');
  const [topic, setTopic] = useState('');
  const [quota, setQuota] = useState<LocationQuota | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topics = useMemo(
    () => [...new Set(prompts.map((p) => p.category?.trim()).filter(Boolean))].sort() as string[],
    [prompts],
  );
  const selected = prompts.filter((p) => selectedIds.has(p.id));
  const one = preset?.promptId ? prompts.find((p) => p.id === preset.promptId) : undefined;

  // Each opening starts from what opened it.
  useEffect(() => {
    if (!open) return;
    setMode(preset?.mode ?? 'add');
    setLocations(preset?.locations ?? []);
    setScope(preset?.promptId ? 'one' : selectedIds.size ? 'selected' : 'all');
    setTopic('');
    setError(null);
    let cancelled = false;
    getLocationQuota(brandId)
      .then((q) => {
        if (!cancelled) setQuota(q);
      })
      .catch((err) => console.error('Failed to read the plan usage:', err));
    return () => {
      cancelled = true;
    };
    // Read when it opens; the preset and selection are what opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brandId]);

  const chosenTopic = topic || topics[0] || '';
  // A cell's prompt the rows no longer show is no prompt, never every prompt.
  const targets =
    scope === 'one'
      ? one
        ? [one]
        : []
      : scope === 'selected'
        ? selected
        : scope === 'topic'
          ? prompts.filter((p) => p.category?.trim() === chosenTopic)
          : prompts;
  const removing = mode === 'remove';
  // What can be stopped: the locations the chosen prompts track, with how
  // many of them track each, and any picked already, so choosing other
  // prompts never hides a pick.
  const tracked = trackedLocations(targets);
  const trackedHere = [
    ...tracked,
    ...locations
      .filter((code) => !tracked.some((l) => l.code === code))
      .map((code) => ({ code, count: 0 })),
  ];
  const change = planBulkLocationChange(
    targets.map((p) => ({ id: p.id, regions: p.regions, isActive: p.isActive })),
    mode,
    locations,
  );
  // Tracked locations it takes off, paused prompts' too; and what the plan gets back.
  const removed = change.changes.reduce((n, c) => n - c.delta, 0);
  // A city is asked only by Google's engines and the API models (PROMPT-015d).
  const askingCity = !removing && locations.some((code) => parseLocation(code)?.city);
  const asksFromCity = (p: Prompt) =>
    (p.platforms ?? []).some((id) => CITY_PLATFORMS.has(id)) || (p.models?.length ?? 0) > 0;
  const noCityEngine = askingCity ? targets.filter((p) => !asksFromCity(p)).length : 0;
  const cityBlocked = askingCity && targets.length > 0 && noCityEngine === targets.length;
  const unlimited = quota === null || quota.maxPrompts === -1;
  const after = (quota?.used ?? 0) + change.delta;
  const over = !removing && !unlimited && quota !== null && after > quota.maxPrompts;
  const left = quota ? Math.max(0, quota.maxPrompts - quota.used) : 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    // A refused write (a plan no longer active) still rejects, for the
    // dashboard's upgrade dialog; the button never stays spinning.
    try {
      const result = await bulkUpdatePromptLocations(
        targets.map((p) => p.id),
        mode,
        locations,
      );
      if ('error' in result) {
        setError(result.error);
        return;
      }
      toast.success(t(removing ? 'removed' : 'done', { count: result.updated }));
      onOpenChange(false);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const scopes: { id: Scope; label: string; count: number }[] = [
    ...(one ? [{ id: 'one' as const, label: one.text, count: 1 }] : []),
    ...(selected.length
      ? [
          {
            id: 'selected' as const,
            label: t('selected', { count: selected.length }),
            count: selected.length,
          },
        ]
      : []),
    ...(topics.length
      ? [
          {
            id: 'topic' as const,
            label: t('topic'),
            count: prompts.filter((p) => p.category?.trim() === chosenTopic).length,
          },
        ]
      : []),
    { id: 'all', label: t('allShown', { count: prompts.length }), count: prompts.length },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(removing ? 'removeTitle' : 'title')}</DialogTitle>
          <DialogDescription>{t(removing ? 'removeLead' : 'lead')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            role="group"
            aria-label={t('modes')}
            className="inline-flex gap-0.5 rounded-full border bg-background p-0.5"
          >
            {(['add', 'remove'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  if (m === mode) return;
                  setMode(m);
                  setLocations([]);
                  setError(null);
                }}
                className={cn(
                  'h-7 rounded-full px-3 text-xs transition-colors',
                  mode === m
                    ? 'bg-foreground font-medium text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(m === 'add' ? 'modeAdd' : 'modeRemove')}
              </button>
            ))}
          </div>

          {removing ? (
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('removeLocations')}
              </legend>
              {trackedHere.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('removeNoLocations')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {trackedHere.map(({ code, count }) => {
                    const on = locations.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        aria-label={t('removeChip', { location: regionLabel(code), count })}
                        onClick={() =>
                          setLocations((prev) =>
                            on ? prev.filter((c) => c !== code) : [...prev, code],
                          )
                        }
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                          on
                            ? 'border-foreground bg-foreground text-background'
                            : 'text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                        )}
                      >
                        {`${regionFlag(code)} ${regionLabel(code)}`.trim()}
                        <span className="tabular-nums opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          ) : (
            <LocationPicker
              value={locations}
              onChange={setLocations}
              maxSelectable={null}
              label={t('locations')}
              countNoun={t('picked')}
              allowEmpty
            />
          )}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">
              {t(removing ? 'removeScope' : 'scope')}
            </legend>
            {scopes.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                  scope === s.id && 'border-foreground',
                )}
              >
                <input
                  type="radio"
                  name="add-locations-scope"
                  checked={scope === s.id}
                  onChange={() => setScope(s.id)}
                />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.id === 'topic' && (
                  <select
                    aria-label={t('topic')}
                    value={chosenTopic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      setScope('topic');
                    }}
                    className="h-7 max-w-[160px] rounded-md border bg-background px-1.5 text-xs"
                  >
                    {topics.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('promptsCount', { count: s.count })}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{t('usage')}</span>
              <span className="tabular-nums">
                {quota === null
                  ? '…'
                  : unlimited
                    ? t('unlimited', { used: quota.used, after })
                    : t('usageLine', { used: quota.used, after, max: quota.maxPrompts })}
              </span>
            </div>
            {!unlimited && quota && (
              <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="bg-foreground"
                  style={{ width: `${Math.min(100, (quota.used / quota.maxPrompts) * 100)}%` }}
                />
                <span
                  className={over ? 'bg-amber-500' : 'bg-foreground/40'}
                  style={{
                    width: `${Math.max(0, Math.min(100 - (quota.used / quota.maxPrompts) * 100, (change.delta / quota.maxPrompts) * 100))}%`,
                  }}
                />
              </div>
            )}
            {removing && change.changes.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('removePreview', {
                  removed,
                  count: change.changes.length,
                  freed: -change.delta,
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('usageHint')}</p>
            )}
          </div>

          {over && quota && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="font-medium">
                {t('over', { adding: change.delta, left, plan: quota.planName })}
              </p>
              <p className="text-xs">{t('overHint', { plan: quota.planId })}</p>
              <div className="flex flex-wrap gap-2">
                <PromptLimitActions planId={quota.planId} />
              </div>
            </div>
          )}
          {removing && change.blocked > 0 && (
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t('removeBlocked', { count: change.blocked })}
            </p>
          )}
          {removing && change.changes.length > 0 && (
            <p className="text-xs font-medium">{t('removePast')}</p>
          )}
          {noCityEngine > 0 && (
            <p
              role={cityBlocked ? 'alert' : undefined}
              className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground"
            >
              {cityBlocked ? t('cityBlocked') : t('cityPartly', { count: noCityEngine })}
            </p>
          )}
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(removing ? 'removeNoPrompts' : 'noPrompts')}
            </p>
          ) : (
            locations.length > 0 &&
            change.changes.length === 0 &&
            change.blocked === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(removing ? 'removeNothing' : 'nothing')}
              </p>
            )
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              saving || over || cityBlocked || targets.length === 0 || change.changes.length === 0
            }
          >
            {saving && <Loader2 className="animate-spin" />}
            {t(removing ? 'removeSubmit' : 'submit', { count: locations.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
