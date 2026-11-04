'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  addDraftSource,
  getContentStartOptions,
  type AddedDraftSource,
} from '@/lib/actions/contentDrafts';
import { normalizeQuery, type DraftSourcesData } from '@/lib/content/sources';

const ADD_KINDS = ['prompt', 'cited_page', 'gsc_query'] as const;
type AddKind = (typeof ADD_KINDS)[number];

interface PickerItem {
  value: string;
  label: string;
  meta?: string;
}

/**
 * + Add source (CE-008): one of the brand's prompts (it joins the draft's
 * prompts), a page's address, or one of the brand's Search Console queries.
 * Files wait for workspace files (CHAT-06).
 */
export function AddSourceDialog({
  open,
  onOpenChange,
  draftId,
  brandId,
  gscQueries,
  listed,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  brandId: string;
  gscQueries: DraftSourcesData['gscQueries'];
  /** `kind:ref` of the sources listed already, left out of the pickers. */
  listed: string[];
  onAdded: () => void;
}) {
  const t = useTranslations('contentEditor.editor.sources.add');
  const [kind, setKind] = useState<AddKind>('prompt');
  const [prompts, setPrompts] = useState<PickerItem[] | null>(null);
  const [promptsFailed, setPromptsFailed] = useState(false);
  const [picked, setPicked] = useState<PickerItem | null>(null);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || prompts) return;
    let cancelled = false;
    getContentStartOptions(brandId)
      .then((options) => {
        // Every prompt, seen or not (New content lists the unseen first), by text.
        if (!cancelled) {
          setPrompts(
            [...options.prompts]
              .sort((a, b) => a.text.localeCompare(b.text))
              .map((p) => ({ value: p.id, label: p.text })),
          );
        }
      })
      .catch((err) => {
        console.error('Failed to read the prompts:', err);
        if (!cancelled) setPromptsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, prompts, brandId]);

  const items = useMemo(() => {
    const taken = new Set(listed);
    if (kind === 'prompt') return (prompts ?? []).filter((p) => !taken.has(`prompt:${p.value}`));
    if (kind === 'gsc_query') {
      return gscQueries
        .map((q) => ({
          value: normalizeQuery(q.query),
          label: q.query,
          meta: t('clicks', { count: q.clicks }),
        }))
        .filter((q) => !taken.has(`gsc_query:${q.value}`));
    }
    return [];
  }, [kind, prompts, gscQueries, listed, t]);

  const validUrl = (() => {
    try {
      return /^https?:$/.test(new URL(url.trim()).protocol);
    } catch {
      return false;
    }
  })();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setPicked(null);
      setUrl('');
    }
  };

  const add = async () => {
    let source: AddedDraftSource;
    if (kind === 'cited_page') {
      if (!validUrl) return;
      source = { kind, url: url.trim() };
    } else if (kind === 'prompt') {
      if (!picked) return;
      source = { kind, promptId: picked.value };
    } else {
      if (!picked) return;
      source = { kind, query: picked.label };
    }
    setSaving(true);
    try {
      await addDraftSource(draftId, source);
      toast.success(t('added'));
      onAdded();
      close(false);
    } catch (err) {
      console.error('Failed to add a draft source:', err);
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  const ready = kind === 'cited_page' ? validUrl : picked !== null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as AddKind);
              setPicked(null);
            }}
          >
            <TabsList>
              {ADD_KINDS.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`kinds.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {kind === 'cited_page' ? (
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              aria-label={t('urlLabel')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && validUrl) void add();
              }}
            />
          ) : kind === 'prompt' && promptsFailed ? (
            <p className="text-xs text-destructive">{t('promptsFailed')}</p>
          ) : (
            <Combobox
              items={items}
              value={picked}
              onValueChange={(item: PickerItem | null) => setPicked(item)}
              disabled={kind === 'prompt' && !prompts}
            >
              <ComboboxTrigger
                className="w-full"
                aria-label={t(`placeholders.${kind}`)}
                title={picked?.label}
              >
                {kind === 'prompt' && !prompts ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <LoadingDots />
                    {t('loading')}
                  </span>
                ) : (
                  <ComboboxValue placeholder={t(`placeholders.${kind}`)} />
                )}
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput placeholder={t('search')} />
                <ComboboxList>
                  <ComboboxEmpty>{t(`empty.${kind}`)}</ComboboxEmpty>
                  <ComboboxCollection>
                    {(item: PickerItem) => (
                      <ComboboxItem key={item.value} value={item} title={item.label}>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.meta && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {item.meta}
                          </span>
                        )}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
          {kind === 'gsc_query' && gscQueries.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('gscHint', { count: gscQueries.length })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t('cancel')}
          </Button>
          <Button disabled={!ready || saving} onClick={() => void add()}>
            {saving && <LoadingDots />}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
