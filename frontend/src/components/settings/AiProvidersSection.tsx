'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Loader2,
  Lock,
  Route,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AIProviderAvatar } from '@/components/AiProviderAvatar';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { OwnKeyGuardCard } from '@/components/settings/OwnKeyGuardCard';
import type { OwnKeyGuard } from '@/lib/chat/ownKeyGuard';
import { formatDate } from '@/lib/format';
import { formatRelative } from '@/lib/formatRelative';
import type { KeyFailureClass } from '@/lib/agent/keyErrors';
import { cn } from '@/lib/utils';
import {
  AI_PROVIDERS,
  DEFAULT_MODELS,
  OPENROUTER_MODEL_EXAMPLE,
  chatModelId,
  parseProviderSettings,
  type AiProvider,
  type AiProviderSettings,
  type SettingsError,
} from '@/lib/agent/providers';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * What own keys do for the workspace (lib/chat/key.ts ownKeyAccess): `open`
 * with Chat off (today's Agent Chat, any plan); `plan` on Enterprise; `kept`
 * for a key saved before Chat, until `until`; `locked` below Enterprise.
 */
type OwnKeyAccess = { state: 'open' | 'plan' | 'locked' } | { state: 'kept'; until: string | null };

interface SavedProvider {
  provider: AiProvider;
  last4: string | null;
  settings: AiProviderSettings;
  active: boolean;
  setAt: string | null;
  setByEmail: string | null;
  /** Its health (00440): when it was last tested, and why and since when it fails. */
  health?: {
    checkedAt: string | null;
    failingSince: string | null;
    failureClass: KeyFailureClass | null;
  };
}

/** What a test, a save or a switch found on a key (/api/settings/ai-providers). */
interface KeyCheckAnswer {
  error?: string;
  code?: string;
  check?: 'working' | 'no_credit' | 'unchecked';
  resumed?: number;
}

/** Two sentences as one message, the first ended with a full stop. */
function sentences(first: string, second: string | null): string {
  if (!second) return first;
  return `${first}${/[.!?]$/.test(first) ? '' : '.'} ${second}`;
}

/** The key class a refusal names (`key_invalid` …), or null. */
function refusedClass(code: string | undefined): KeyFailureClass | null {
  const cls = code?.startsWith('key_') ? code.slice(4) : null;
  return cls === 'invalid' || cls === 'no_credit' || cls === 'model' || cls === 'unreadable'
    ? cls
    : null;
}

/**
 * A key's health under its details (AGENT-OWN-KEY §5.2 item 7): working and
 * when it was checked, not working since when and why, or not checked yet.
 */
function KeyHealthLine({ provider, row }: { provider: AiProvider; row: SavedProvider }) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tOwnKey = useTranslations('chatAgents.ownKey');
  const health = row.health;
  const [tone, text] =
    health?.failingSince && health.failureClass
      ? ([
          'fail',
          t('agent_health.failing', {
            date: formatDate(health.failingSince),
            why: tOwnKey(`why.${health.failureClass}`, {
              provider: t(`agent_providers.${provider}.name`),
            }),
          }),
        ] as const)
      : health?.checkedAt
        ? ([
            'ok',
            t('agent_health.working', { when: formatRelative(health.checkedAt, tCommon) }),
          ] as const)
        : (['none', t('agent_health.unchecked')] as const);
  return (
    <p
      data-slot="key-health"
      data-tone={tone}
      className={cn(
        'mt-1 flex items-center gap-1.5 text-xs',
        tone === 'ok' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'fail' && 'text-red-700 dark:text-red-400',
        tone === 'none' && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'ok' && 'bg-emerald-500',
          tone === 'fail' && 'bg-red-500',
          tone === 'none' && 'bg-muted-foreground/40',
        )}
      />
      {text}
    </p>
  );
}

/** Where each provider hands out keys. */
const KEY_LINKS: Record<AiProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  azure: 'https://portal.azure.com/',
  openrouter: 'https://openrouter.ai/settings/keys',
};

function ProviderIcon({ provider }: { provider: AiProvider }) {
  if (provider === 'azure') return <Cloud className="h-5 w-5 text-muted-foreground" />;
  if (provider === 'openrouter') return <Route className="h-5 w-5 text-muted-foreground" />;
  // The same one-colour logos as the platforms', in the text colour.
  return <AIProviderAvatar provider={provider} plain />;
}

/**
 * Settings › AI Providers.
 *
 * Bring-your-own-key UI for the in-product agent on cloud. Customers add a
 * key for one or more providers — Anthropic, OpenAI, Google Gemini,
 * Microsoft Azure OpenAI, OpenRouter — and pick the one Chat uses; the chat
 * endpoint reads it back per turn (encrypted at rest, see
 * frontend/src/lib/agent/keyEncryption.ts).
 *
 * The plaintext is never returned from the server — `last4` is enough to
 * render the "…abcd" chip without a decrypt round-trip. On every change we
 * just refetch.
 *
 * With Chat on, own keys are Enterprise's (CHAT-16 items 19 and 28): below
 * it the page says Chat runs on the plan's AI limit and offers only Remove;
 * a key kept from before Chat can still be replaced or switched to until its
 * date. The API refuses the rest too.
 */
export function AiProvidersSection() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { canAdmin } = useUserRole();
  const [saved, setSaved] = useState<SavedProvider[] | null>(null);
  const [access, setAccess] = useState<OwnKeyAccess>({ state: 'open' });
  // The key guard's card: Admins only, where Chat runs on own keys (the route
  // sends it to nobody else); null when its numbers couldn't be read.
  const [keyGuard, setKeyGuard] = useState<OwnKeyGuard | null | undefined>(undefined);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [switching, setSwitching] = useState<AiProvider | null>(null);
  const [testing, setTesting] = useState<AiProvider | null>(null);
  // The key the remove dialog asks about; kept while the dialog fades out.
  const [confirmRemove, setConfirmRemove] = useState<AiProvider | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  // A read-only workspace (plan not active): Add key, Replace and Use for
  // Chat open the upgrade dialog instead. Removing a key stays open: it takes
  // back the access to the person's own AI account.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const name = (provider: AiProvider) => t(`agent_providers.${provider}.name`);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai-providers');
      const body = (await res.json()) as {
        providers?: SavedProvider[];
        access?: OwnKeyAccess;
        guard?: OwnKeyGuard | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setSaved(body.providers ?? []);
      setAccess(body.access ?? { state: 'open' });
      setKeyGuard('guard' in body ? (body.guard ?? null) : undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
      setSaved((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUse = async (provider: AiProvider) => {
    setSwitching(provider);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json().catch(() => ({}))) as KeyCheckAnswer;
      const refused = refusedClass(body.code);
      if (refused) {
        toast.error(keyError(provider, refused));
        await load();
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      toast.success(withResumed(t('agent_switched', { provider: name(provider) }), body.resumed));
      if (body.check === 'no_credit') toast.warning(keyError(provider, 'no_credit'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSwitching(null);
    }
  };

  /** The words for a key class, as the key's provider and model name it. */
  const keyError = (provider: AiProvider, cls: KeyFailureClass) =>
    t(`agent_keyError.${cls}`, {
      provider: name(provider),
      model: chatModelId(provider, byProvider.get(provider)?.settings ?? {}),
    });

  /** A message, and how many paused agents started again when some did. */
  const withResumed = (message: string, resumed = 0) =>
    sentences(message, resumed > 0 ? t('agent_testResumed', { count: resumed }) : null);

  // Test (AGENT-OWN-KEY §5.2 item 7): one tiny call on the saved key, and what it found kept.
  const handleTest = async (provider: AiProvider) => {
    setTesting(provider);
    try {
      const res = await fetch('/api/settings/ai-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: 'working' | 'failing' | 'unknown';
        class?: KeyFailureClass;
        resumed?: number;
      };
      if (!res.ok) throw new Error(body.error || 'Failed to test');
      if (body.outcome === 'working') {
        toast.success(
          withResumed(t('agent_testWorks', { provider: name(provider) }), body.resumed),
        );
      } else if (body.outcome === 'failing' && body.class) {
        toast.error(keyError(provider, body.class));
      } else {
        toast(t('agent_testUnknown'));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to test');
    } finally {
      setTesting(null);
    }
  };

  const handleRemove = async (provider: AiProvider) => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/settings/ai-providers?provider=${provider}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Failed to clear');
      toast.success(t('agent_removed'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear');
    } finally {
      setRemoving(false);
      setRemoveOpen(false);
    }
  };

  const byProvider = new Map((saved ?? []).map((row) => [row.provider, row]));
  const locked = access.state === 'locked';
  // Chat runs on the key (Enterprise, or a kept key): its health and Test show.
  const metered = access.state === 'plan' || access.state === 'kept';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t('aiProviders')}
          </CardTitle>
          <CardDescription>
            {t(access.state === 'open' ? 'agent_description' : 'agent_descriptionMetered')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {saved === null ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {/* Only today's Agent Chat stays locked without a key. */}
              {access.state === 'open' && !saved.some((row) => row.active) && (
                <p className="text-sm text-muted-foreground">{t('agent_noKey')}</p>
              )}
              {access.state === 'kept' && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {t('agent_kept', { date: formatDate(access.until) })}{' '}
                    <Link
                      href="/dashboard/settings/billing"
                      className="font-medium underline underline-offset-4"
                    >
                      {t('agent_comparePlans')}
                    </Link>
                  </p>
                </div>
              )}
              {locked && (
                <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p>
                    {t('agent_locked')}{' '}
                    <Link
                      href="/dashboard/settings/billing"
                      className="font-medium underline underline-offset-4"
                    >
                      {t('agent_comparePlans')}
                    </Link>
                  </p>
                </div>
              )}
              <div className="divide-y rounded-lg border">
                {AI_PROVIDERS.map((provider) => {
                  const row = byProvider.get(provider);
                  return (
                    <div
                      key={provider}
                      className="@container space-y-4 p-4"
                      data-provider={provider}
                    >
                      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                            <ProviderIcon provider={provider} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{name(provider)}</p>
                              {row && locked ? (
                                <Badge variant="secondary">{t('agent_notUsed')}</Badge>
                              ) : row?.active ? (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t('agent_usedByChat')}
                                </Badge>
                              ) : (
                                row && <Badge variant="secondary">{t('agent_keySaved')}</Badge>
                              )}
                            </div>
                            {row ? (
                              <p className="text-xs text-muted-foreground">
                                {row.last4 && <code className="font-mono">…{row.last4}</code>}
                                {' · '}
                                {t('agent_modelInUse', {
                                  model: chatModelId(provider, row.settings),
                                })}
                                {' · '}
                                {t('agent_savedAt', { date: formatDate(row.setAt) })}
                                {row.setByEmail &&
                                  ` ${t('agent_savedBy', { email: row.setByEmail })}`}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {t(`agent_providers.${provider}.about`)}
                              </p>
                            )}
                            {row && metered && <KeyHealthLine provider={provider} row={row} />}
                          </div>
                        </div>

                        {canAdmin && editing !== provider && (
                          <div className="flex shrink-0 items-center gap-2 pl-13 @lg:pl-0">
                            {row && !row.active && !locked && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={switching !== null}
                                onClick={guard(() => void handleUse(provider), {
                                  action: tActions('switchAiProvider'),
                                })}
                              >
                                {switching === provider && (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                )}
                                {t('agent_useForChat')}
                              </Button>
                            )}
                            {row && metered && (
                              <Button
                                variant="outline"
                                size="sm"
                                data-action="aiKey.test"
                                disabled={testing !== null}
                                onClick={guard(() => void handleTest(provider), {
                                  action: tActions('testAiKey'),
                                })}
                              >
                                {testing === provider && (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                )}
                                {testing === provider ? t('agent_testing') : t('agent_test')}
                              </Button>
                            )}
                            {/* A kept key is replaced, not joined by another provider's. */}
                            {!locked && (row || access.state !== 'kept') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={guard(() => setEditing(provider), {
                                  action: tActions('saveAiKeys'),
                                })}
                              >
                                {row ? t('agent_replace') : t('agent_addKey')}
                              </Button>
                            )}
                            {row && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${t('agent_removeKey')}: ${name(provider)}`}
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setConfirmRemove(provider);
                                  setRemoveOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {canAdmin && editing === provider && (
                        <ProviderKeyForm
                          provider={provider}
                          saved={row?.settings ?? {}}
                          onCancel={() => setEditing(null)}
                          onSaved={async () => {
                            // Closed once the row shows the new key, not before.
                            await load();
                            setEditing(null);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!canAdmin && (
            // Server-side, `/api/settings/ai-providers` PUT/PATCH/DELETE
            // already refuse a non-admin role with a 403 — say so up front
            // instead of offering buttons that end in an unhelpful toast.
            <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">{t('agent_adminOnly')}</p>
                <p className="mt-1 text-muted-foreground">{t('agent_adminOnlyHint')}</p>
              </div>
            </div>
          )}

          <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('agent_removeKey')}</DialogTitle>
                <DialogDescription>
                  {confirmRemove &&
                    t(metered ? 'agent_removeKeyConfirmChat' : 'agent_removeKeyConfirm', {
                      provider: name(confirmRemove),
                    })}
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>{tCommon('cancel')}</DialogClose>

                <Button
                  type="button"
                  variant="destructive"
                  disabled={removing}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmRemove) void handleRemove(confirmRemove);
                  }}
                >
                  {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('remove')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
      {keyGuard !== undefined && (
        <OwnKeyGuardCard
          key={keyGuard ? 'read' : 'unread'}
          guard={keyGuard}
          onSaved={setKeyGuard}
        />
      )}
    </div>
  );
}

/** A provider's key, and the settings it needs besides, saved together. */
function ProviderKeyForm({
  provider,
  saved,
  onCancel,
  onSaved,
}: {
  provider: AiProvider;
  saved: AiProviderSettings;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(saved.endpoint ?? '');
  const [deployment, setDeployment] = useState(saved.deployment ?? '');
  const [model, setModel] = useState(saved.model ?? '');
  const [invalid, setInvalid] = useState<SettingsError | null>(null);
  // The key's test turned it down (AGENT-OWN-KEY §11 Q8): why, under the key.
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = (field: string) => `ai-provider-${provider}-${field}`;

  const handleSave = async () => {
    const settings = provider === 'azure' ? { endpoint, deployment } : { model };
    const parsed = parseProviderSettings(provider, settings);
    if ('error' in parsed) {
      setInvalid(parsed.error);
      return;
    }
    setInvalid(null);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), settings: parsed.settings }),
      });
      const body = (await res.json().catch(() => ({}))) as KeyCheckAnswer & {
        field?: SettingsError | 'apiKey';
      };
      const providerName = t(`agent_providers.${provider}.name`);
      const refused = refusedClass(body.code);
      if (refused) {
        setKeyError(
          t(`agent_keyError.${refused}`, {
            provider: providerName,
            model: chatModelId(provider, parsed.settings),
          }),
        );
        return;
      }
      if (body.field && body.field !== 'apiKey') {
        setInvalid(body.field);
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      if (body.check === 'no_credit') {
        toast.warning(t('agent_savedNoCredit', { provider: providerName }));
      } else if (body.check === 'unchecked') {
        toast(t('agent_savedUnchecked'));
      } else {
        toast.success(
          sentences(
            t('agent_saved', { provider: providerName }),
            body.resumed ? t('agent_testResumed', { count: body.resumed }) : null,
          ),
        );
      }
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (field: SettingsError) =>
    invalid === field && <p className="text-xs text-destructive">{t(`agent_invalid.${field}`)}</p>;

  return (
    <form
      className="space-y-3 rounded-md border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={id('key')}>{t('agent_apiKeyLabel')}</Label>
        <Input
          id={id('key')}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(`agent_providers.${provider}.keyPlaceholder`)}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setKeyError(null);
          }}
          disabled={saving}
          aria-invalid={keyError !== null}
          className="bg-card font-mono"
          autoFocus
        />
        {keyError && (
          <p data-slot="key-error" className="text-xs text-destructive">
            {keyError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t.rich(`agent_providers.${provider}.keyHint`, {
            link: (chunks) => (
              <a href={KEY_LINKS[provider]} target="_blank" rel="noreferrer" className="underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>

      {provider === 'azure' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={id('endpoint')}>{t('agent_endpointLabel')}</Label>
            <Input
              id={id('endpoint')}
              spellCheck={false}
              placeholder={t('agent_endpointPlaceholder')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={saving}
              aria-invalid={invalid === 'endpoint'}
              className="bg-card"
            />
            {fieldError('endpoint')}
          </div>
          <div className="space-y-2">
            <Label htmlFor={id('deployment')}>{t('agent_deploymentLabel')}</Label>
            <Input
              id={id('deployment')}
              spellCheck={false}
              placeholder={t('agent_deploymentPlaceholder')}
              value={deployment}
              onChange={(e) => setDeployment(e.target.value)}
              disabled={saving}
              aria-invalid={invalid === 'deployment'}
              className="bg-card"
            />
            {fieldError('deployment')}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={id('model')}>{t('agent_modelLabel')}</Label>
          <Input
            id={id('model')}
            spellCheck={false}
            placeholder={
              provider === 'openrouter' ? OPENROUTER_MODEL_EXAMPLE : DEFAULT_MODELS[provider]
            }
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={saving}
            aria-invalid={invalid === 'model'}
            className="bg-card font-mono"
          />
          {fieldError('model') || (
            <p className="text-xs text-muted-foreground">
              {provider === 'openrouter'
                ? t('agent_openrouterModelHint', { model: OPENROUTER_MODEL_EXAMPLE })
                : t('agent_modelOptional', { model: DEFAULT_MODELS[provider] })}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || !apiKey.trim()}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {tCommon('save')}
        </Button>
      </div>
    </form>
  );
}
