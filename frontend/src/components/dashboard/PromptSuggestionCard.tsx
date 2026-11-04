'use client';

import { memo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { MODEL_GROUPS, ALL_MODELS, SCRAPER_GROUPS, ALL_SCRAPERS } from '@/config/promptOptions';
import { formatRegionDisplay } from '@/lib/region';
import { LocationPicker } from '@/components/dashboard/LocationPicker';

interface TopicOption {
  id: string;
  name: string;
}

interface PromptSuggestionCardProps {
  text: string;
  category: string;
  isActive: boolean;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDelete?: () => void;
  regions?: string[];
  models?: string[];
  platforms?: string[];
  topics?: TopicOption[];
  allowedScraperIds?: string[];
  allowedModelIds?: string[];
  onModelsChange?: (models: string[]) => void;
  onPlatformsChange?: (platforms: string[]) => void;
  onRegionsChange?: (regions: string[]) => void;
  /**
   * Most locations this prompt may hold under the org's plan (null =
   * unlimited). Only supplied where editing locations is offered.
   */
  maxLocations?: number | null;
  onCategoryChange?: (category: string) => void;
  mode?: 'review' | 'manage';
}

const TOPIC_COLOR_PALETTE = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
];

/** Order-insensitive comparison — reordering is not a location change. */
function sameLocations(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((code, i) => code === right[i]);
}

function getTopicColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TOPIC_COLOR_PALETTE[Math.abs(hash) % TOPIC_COLOR_PALETTE.length];
}

export const PromptSuggestionCard = memo(function PromptSuggestionCard({
  text,
  category,
  isActive,
  onToggle,
  onTextChange,
  onDelete,
  regions,
  models,
  platforms,
  topics,
  allowedScraperIds,
  allowedModelIds,
  onModelsChange,
  onPlatformsChange,
  onRegionsChange,
  maxLocations,
  onCategoryChange,
  mode = 'review',
}: PromptSuggestionCardProps) {
  const ts = useTranslations('prompts.suggestions');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [editCategory, setEditCategory] = useState(category);
  const [editModels, setEditModels] = useState<string[]>(models ?? []);
  const [editPlatforms, setEditPlatforms] = useState<string[]>(platforms ?? []);
  const [editRegions, setEditRegions] = useState<string[]>(regions ?? []);

  const visibleScrapers = allowedScraperIds
    ? ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id))
    : ALL_SCRAPERS;
  const visibleModels = allowedModelIds
    ? ALL_MODELS.filter((m) => allowedModelIds.includes(m.id))
    : ALL_MODELS;
  const hasAnySelection = editPlatforms.length > 0 || editModels.length > 0;

  const handleSave = () => {
    if (!editText.trim() || !hasAnySelection) return;
    onTextChange(editText.trim());
    if (onCategoryChange && editCategory !== category) onCategoryChange(editCategory);
    if (onModelsChange) onModelsChange(editModels);
    if (onPlatformsChange) onPlatformsChange(editPlatforms);
    // Locations meter against the plan, so only send a real change — an
    // untouched prompt must never spend a quota check on save.
    if (onRegionsChange && !sameLocations(editRegions, regions ?? [])) {
      onRegionsChange(editRegions);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(text);
    setEditCategory(category);
    setEditModels(models ?? []);
    setEditPlatforms(platforms ?? []);
    setEditRegions(regions ?? []);
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border p-3 transition-colors',
        isActive ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60',
      )}
    >
      {/* Toggle checkbox */}
      <button
        type="button"
        role="checkbox"
        aria-checked={isActive}
        aria-label={ts('include')}
        onClick={onToggle}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
          isActive
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40',
        )}
      >
        {isActive && <Check className="h-3 w-3" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={handleSave}
                disabled={!editText.trim() || !hasAnySelection}
                aria-label="Save changes"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={handleCancel}
                aria-label="Cancel edit"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {mode === 'manage' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {/* Topic */}
                {onCategoryChange && topics && topics.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      {ts('topic')}
                    </label>
                    <Select value={editCategory} onValueChange={(v) => v && setEditCategory(v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={ts('selectTopic')} />
                      </SelectTrigger>
                      <SelectContent>
                        {topics.map((t) => (
                          <SelectItem key={t.id} value={t.name}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Platform & Models — combined select */}
                {(onModelsChange || onPlatformsChange) && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      {ts('platformsAndModels')}
                    </label>
                    <Select
                      value="__placeholder__"
                      onValueChange={(v) => {
                        if (!v || v === '__placeholder__') return;
                        if (visibleModels.some((m) => m.id === v) && !editModels.includes(v)) {
                          setEditModels((prev) => [...prev, v]);
                        } else if (
                          visibleScrapers.some((s) => s.id === v) &&
                          !editPlatforms.includes(v)
                        ) {
                          setEditPlatforms((prev) => [...prev, v]);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <span className="truncate text-muted-foreground">
                          {editModels.length + editPlatforms.length > 0
                            ? ts('selectedCount', {
                                count: editModels.length + editPlatforms.length,
                              })
                            : ts('selectPlatformsAndModels')}
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
                                  disabled={editPlatforms.includes(s.id)}
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
                                  disabled={editModels.includes(m.id)}
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
                    {(editModels.length > 0 || editPlatforms.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {editPlatforms.map((id) => {
                          const s = ALL_SCRAPERS.find((as_) => as_.id === id);
                          return (
                            <Badge key={id} variant="outline" className="gap-1 text-xs">
                              {s?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setEditPlatforms((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                        {editModels.map((id) => {
                          const m = ALL_MODELS.find((am) => am.id === id);
                          return (
                            <Badge key={id} variant="secondary" className="gap-1 text-xs">
                              {m?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setEditModels((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {onRegionsChange && (
                  <LocationPicker
                    value={editRegions}
                    onChange={setEditRegions}
                    maxSelectable={maxLocations ?? null}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm leading-relaxed">{text}</p>
            <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setIsEditing(true)}
                aria-label="Edit prompt"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              {mode === 'manage' && onDelete && (
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label="Delete prompt"
                      />
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Delete Prompt</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to delete this prompt? This action cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground line-clamp-2">
                      {text}
                    </p>
                    <DialogFooter>
                      <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                      <DialogClose render={<Button variant="destructive" onClick={onDelete} />}>
                        Delete
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge
            variant="secondary"
            className={cn(
              'text-[10px] font-medium uppercase tracking-wider',
              getTopicColor(category),
            )}
          >
            {category}
          </Badge>
          {regions &&
            regions.length > 0 &&
            regions.map((r) => (
              <Badge key={r} variant="outline" className="text-[10px]">
                {formatRegionDisplay(r)}
              </Badge>
            ))}
          {models &&
            models.length > 0 &&
            models.map((m) => {
              const model = ALL_MODELS.find((am) => am.id === m);
              return (
                <Badge
                  key={m}
                  variant="outline"
                  className="text-[10px] border-primary/30 text-primary"
                >
                  {model?.label ?? m}
                </Badge>
              );
            })}
          {platforms &&
            platforms.length > 0 &&
            platforms.map((p) => {
              const scraper = ALL_SCRAPERS.find((as_) => as_.id === p);
              return (
                <Badge
                  key={p}
                  variant="outline"
                  className="text-[10px] border-primary/30 text-primary"
                >
                  {scraper?.label ?? p}
                </Badge>
              );
            })}
        </div>
      </div>
    </div>
  );
});
