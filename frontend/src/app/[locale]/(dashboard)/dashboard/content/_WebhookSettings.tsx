'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  getWebhookConfig,
  saveWebhookConfig,
  testWebhook,
  type WebhookTestResult,
} from '@/lib/actions/content';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';

const WEBHOOK_EVENTS = [
  { value: 'opportunity.sent', label: 'eventOpportunitySent' },
  { value: 'daily_pulse.created', label: 'eventDailyPulseCreated' },
  { value: 'action_task.sent', label: 'eventActionTaskSent' },
  { value: 'content_draft.sent', label: 'eventContentDraftSent' },
] as const;

// Pages sent to the CMS (#1331) are opt-in, as in the column's default: a
// workflow set up for opportunities doesn't expect them.
const DEFAULT_WEBHOOK_EVENTS = WEBHOOK_EVENTS.map(({ value }) => value).filter(
  (value) => value !== 'content_draft.sent',
);

interface WebhookSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
}

export function WebhookSettingsDialog({ open, onOpenChange, brandId }: WebhookSettingsDialogProps) {
  const t = useTranslations('content.webhook');
  const tFailure = useTranslations('apiFailure');
  // A read-only workspace (plan not active): the settings show, and Test and
  // Save open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Only admins and managers save the webhook (RLS) and test it (the API):
  // a member sees it, and why it can't be changed, before pressing anything.
  const { canManage } = useUserRole();
  const readOnly = !canManage;

  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [events, setEvents] = useState<string[]>([...DEFAULT_WEBHOOK_EVENTS]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (open && brandId) {
      setLoading(true);
      setTestResult(null);
      getWebhookConfig(brandId)
        .then((config) => {
          if (config) {
            setUrl(config.webhookUrl);
            setSecret(config.webhookSecret || '');
            setIsActive(config.isActive);
            setEvents(config.events ?? [...DEFAULT_WEBHOOK_EVENTS]);
          } else {
            setUrl('');
            setSecret('');
            setIsActive(true);
            setEvents([...DEFAULT_WEBHOOK_EVENTS]);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [open, brandId]);

  const handleSave = async () => {
    if (!url.trim()) {
      toast.error(t('urlRequired'));
      return;
    }
    if (events.length === 0) {
      toast.error(t('eventRequired'));
      return;
    }
    setSaving(true);
    try {
      await saveWebhookConfig(brandId, {
        webhookUrl: url.trim(),
        webhookSecret: secret.trim() || undefined,
        events,
        isActive,
      });
      toast.success(t('saved'));
      onOpenChange(false);
    } catch (err) {
      console.error('Save webhook failed:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const testMessage = (result: WebhookTestResult) => {
    if (result.success) return t('testSuccess');
    // The API didn't run the test: not an admin or manager, too many tests…
    if (result.failure) {
      return result.failure === 'forbidden' ? t('testForbidden') : tFailure(result.failure);
    }
    if (result.location) {
      return t('testRedirect', { status: result.status, location: result.location });
    }
    return result.error || `HTTP ${result.status}`;
  };

  const handleTest = async () => {
    if (!url.trim()) {
      toast.error(t('urlRequiredTest'));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testWebhook(brandId, url.trim(), secret.trim() || undefined);
      setTestResult({ success: result.success, message: testMessage(result) });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingDots size="md" label={t('loading')} className="text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {readOnly && (
              <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                {t('readOnly')}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="webhook-url">{t('url')}</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder={t('urlPlaceholder')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-secret">{t('secret')}</Label>
              <Input
                id="webhook-secret"
                type="password"
                placeholder={t('secretPlaceholder')}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                disabled={readOnly}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('eventsTitle')}</legend>
              <p className="text-xs text-muted-foreground">{t('eventsDescription')}</p>
              <div className="space-y-2 rounded-md border p-3">
                {WEBHOOK_EVENTS.map((eventOption) => (
                  <div key={eventOption.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`webhook-event-${eventOption.value}`}
                      checked={events.includes(eventOption.value)}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        setEvents((current) =>
                          checked === true
                            ? Array.from(new Set([...current, eventOption.value]))
                            : current.filter((value) => value !== eventOption.value),
                        )
                      }
                    />
                    <Label
                      htmlFor={`webhook-event-${eventOption.value}`}
                      className="cursor-pointer font-normal"
                    >
                      {t(eventOption.label)}
                    </Label>
                  </div>
                ))}
              </div>
              {events.length === 0 && (
                <p className="text-xs text-destructive" role="alert">
                  {t('eventRequired')}
                </p>
              )}
            </fieldset>

            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                disabled={readOnly}
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-lg transition-transform ${
                    isActive ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-sm">{isActive ? t('active') : t('inactive')}</span>
            </div>

            {testResult && (
              <div
                className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                  testResult.success
                    ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                {testResult.message}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={guard(handleTest, { action: tActions('testWorkflow') })}
                disabled={readOnly || testing || !url.trim()}
                className="gap-2"
              >
                {testing && <LoadingDots />}
                {testing ? t('testing') : t('test')}
              </Button>
              <Button
                size="sm"
                onClick={guard(handleSave, { action: tActions('saveWorkflow') })}
                disabled={readOnly || saving || !url.trim()}
                className="gap-2"
              >
                {saving && <LoadingDots />}
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
