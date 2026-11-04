'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { ChatConfirmForm, ChatFormField } from '@/lib/chat/events';
import { cn } from '@/lib/utils';
import { AgentCard, AgentCardBody, AgentCardFooter, AgentCardHeader, DoneLine } from './AgentCard';
import { FormSwitch } from '@/components/chat/agents/AgentFormTriggers';

/** The values the card sends back, by field name. */
export type FormCardValues = Record<string, string | boolean>;

/**
 * What the card's owner says about the values as the person edits them: a
 * field's live line (a schedule's When: "Every Monday, 09:00 · Next: …"),
 * a field's problem (which keeps the button off), and fields that don't
 * apply now (change-only on a one-time job).
 */
export interface FormCardAssist {
  hints?: Record<string, string | undefined>;
  problems?: Record<string, string | undefined>;
  hidden?: readonly string[];
}

/** Where a form card stands: waiting, saving, made (a green line), skipped, or failed with Retry. */
export type FormCardStatus = 'pending' | 'saving' | 'approved' | 'skipped' | 'error';

const initialValues = (form: ChatConfirmForm): FormCardValues =>
  Object.fromEntries(form.fields.map((field) => [field.name, field.value]));

/**
 * An editable approval card (CHAT-12 item 7, W3-02; reused by a skill's
 * draft, W3-08, and a memory, W3-12a): the change's fields, editable before
 * it is made, its own button ("Create schedule") and Cancel. Nothing is made
 * before the click; the server checks the edited values again. The approval
 * card's look: the amber "Step n of m" pill, the card's lines under its
 * fields, and the read-only gate on the button.
 */
export function FormCard({
  step,
  title,
  form,
  assist,
  status = 'pending',
  error,
  doneLabel,
  onSubmit,
  onCancel,
}: {
  step: { n: number; total: number };
  title: string;
  form: ChatConfirmForm;
  /** Live help as the values change (a schedule's When). */
  assist?: (values: FormCardValues) => FormCardAssist;
  status?: FormCardStatus;
  error?: string;
  doneLabel?: string;
  onSubmit: (values: FormCardValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('agentic.formCard');
  const tApproval = useTranslations('agentic.approvalCard');
  const { guard } = useUpgradeGate();
  const titleId = useId();
  const fieldId = useId();
  const [values, setValues] = useState<FormCardValues>(() => initialValues(form));
  const help = useMemo(() => assist?.(values) ?? {}, [assist, values]);
  const busy = status === 'saving';

  if (status === 'approved') {
    return (
      <DoneLine>
        {[tApproval('approved', { n: step.n }), doneLabel].filter(Boolean).join(' · ')}
      </DoneLine>
    );
  }
  if (status === 'skipped') {
    return (
      <p
        role="status"
        data-slot="form-card-skipped"
        className="my-2 rounded-xl border border-dashed px-3 py-[9px] text-[13px] text-muted-foreground"
      >
        {tApproval('skipped', { n: step.n })} · {title}
      </p>
    );
  }

  const shown = form.fields.filter((field) => !help.hidden?.includes(field.name));
  const missing = (field: ChatFormField) =>
    field.kind !== 'toggle' && field.required && !String(values[field.name] ?? '').trim();
  const blocked = shown.some((field) => missing(field) || !!help.problems?.[field.name]);
  const submit = guard(() => onSubmit(values), { action: tApproval('approveNeedsPlan') });
  const set = (name: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <AgentCard tone="needsYou" aria-labelledby={titleId} data-kind="form" data-status={status}>
      <AgentCardHeader
        titleId={titleId}
        lead={
          <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-px text-[11px] leading-[14px] whitespace-nowrap text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {tApproval('stepOf', step)}
          </span>
        }
        title={title}
      />
      <AgentCardBody className="grid gap-3 pt-3">
        {shown.map((field) => {
          const id = `${fieldId}-${field.name}`;
          const problem = help.problems?.[field.name];
          const hint = problem ?? help.hints?.[field.name] ?? field.hint;
          const hintId = hint ? `${id}-hint` : undefined;
          if (field.kind === 'toggle') {
            return (
              <div key={field.name} className="flex items-start gap-2.5">
                <FormSwitch
                  checked={values[field.name] === true}
                  label={field.label}
                  action={`formCard.${field.name}`}
                  onChange={(next) => !busy && set(field.name, next)}
                />
                <div className="min-w-0 text-[13px] leading-[18px]">
                  <span>{field.label}</span>
                  {hint && (
                    <span id={hintId} className="block text-xs text-muted-foreground">
                      {hint}
                    </span>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={field.name} className="grid gap-1">
              <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                {field.label}
              </label>
              {field.kind === 'choice' ? (
                <div
                  id={id}
                  role="radiogroup"
                  aria-label={field.label}
                  className="flex flex-wrap gap-1.5"
                >
                  {(field.options ?? []).map((option) => {
                    const checked = values[field.name] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        data-action={`formCard.${field.name}`}
                        disabled={busy || option.disabled}
                        onClick={() => set(field.name, option.value)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
                          checked
                            ? 'border-foreground bg-foreground text-background'
                            : 'bg-card text-foreground hover:bg-muted disabled:hover:bg-card',
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : field.kind === 'textarea' ? (
                <Textarea
                  id={id}
                  data-action={`formCard.${field.name}`}
                  value={String(values[field.name] ?? '')}
                  maxLength={field.maxLength}
                  disabled={busy}
                  aria-invalid={!!problem || undefined}
                  aria-describedby={hintId}
                  onChange={(e) => set(field.name, e.target.value)}
                  className="min-h-16 text-[13px]"
                />
              ) : (
                <Input
                  id={id}
                  data-action={`formCard.${field.name}`}
                  value={String(values[field.name] ?? '')}
                  maxLength={field.maxLength}
                  disabled={busy}
                  aria-invalid={!!problem || undefined}
                  aria-describedby={hintId}
                  onChange={(e) => set(field.name, e.target.value)}
                  className="text-[13px]"
                />
              )}
              {hint && (
                <p
                  id={hintId}
                  className={cn(
                    'm-0 text-xs',
                    problem ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground',
                  )}
                >
                  {hint}
                </p>
              )}
            </div>
          );
        })}
        {status === 'error' && error && (
          <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </AgentCardBody>
      <AgentCardFooter
        note={
          form.notes && form.notes.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {form.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : undefined
        }
      >
        <Button data-action="formCard.cancel" variant="outline" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          data-action="formCard.submit"
          disabled={busy || blocked}
          aria-busy={busy || undefined}
          onClick={() => submit()}
        >
          {busy && <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {status === 'error' ? tApproval('retry') : form.submit}
        </Button>
      </AgentCardFooter>
    </AgentCard>
  );
}
