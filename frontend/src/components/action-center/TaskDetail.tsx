'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowUpRight, Paperclip } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
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
  TASK_CHECKS,
  TASK_DETAIL_LIMITS,
  TASK_TYPES,
  hasTaskSpec,
  isTaskCheck,
  isTaskType,
  type ActionTaskDetails,
  type TaskDetailsEdit,
} from '@/lib/action-center/taskDetails';
import { findActionDraft, type ActionDraft } from '@/lib/content/actionDrafts';
import { contentEditorPath, type DraftMethod } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';
import { cn } from '@/lib/utils';
import type { CompetitorFindings } from '@/lib/action-center/competitorFindings';
import type { WinningFindings } from '@/lib/action-center/winningFindings';
import type { TaskAttachment } from '@/lib/action-center/chatAttachments';
import { CompetitorFindingsView } from './CompetitorFindings';
import { WinningFindingsView } from './WinningFindings';

/** The type of work, beside the task's text (AC-004). */
export function TaskTypeBadge({ type }: { type: ActionTaskDetails['type'] }) {
  const tTypes = useTranslations('actionCenter.taskTypes');
  if (!type) return null;
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      {tTypes(type)}
    </Badge>
  );
}

/**
 * Attached from Chat (CHAT-09 items 13, 16; the owner's decision of
 * 2026-10-31): the files and drafts Chat attached to the task, each with
 * who attached it, when, and Open: a draft in the Content Editor, any other
 * file downloaded. Read only: attaching is Chat's, marking the task done
 * stays the person's click.
 */
export function AttachedFromChat({ attachments }: { attachments: TaskAttachment[] }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task.attachedFromChat');
  const format = useFormatter();
  if (attachments.length === 0) return null;
  return (
    <section aria-label={t('title')} className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <ul className="space-y-1">
        {attachments.map((file) => (
          <li
            key={file.fileId}
            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={file.title}>
                {file.title}
              </span>
              <span className="block truncate text-muted-foreground">
                {t('by', {
                  name: file.attachedBy ?? t('someone'),
                  date: format.dateTime(new Date(file.attachedAt), {
                    month: 'short',
                    day: 'numeric',
                  }),
                })}
              </span>
            </span>
            {file.draft ? (
              <Link
                href={file.href}
                data-action="task.openAttachment"
                className="inline-flex shrink-0 items-center gap-0.5 font-medium underline-offset-2 hover:underline"
              >
                {t('openDraft')}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : (
              <a
                href={file.href}
                data-action="task.openAttachment"
                className="inline-flex shrink-0 items-center gap-0.5 font-medium underline-offset-2 hover:underline"
              >
                {t('open')}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where a task can be sent from the drawer (AC-004), and the sending. */
export interface TaskSendOptions {
  /** A content task, on an action that did not come from Content. */
  content: boolean;
  /** The brand has an active webhook. */
  webhook: boolean;
  onSend: (to: 'content' | 'webhook') => void;
}

/** Checking a task on its page now (AC-010), for a task checked automatically. */
export interface TaskCheckOptions {
  onCheck: () => void;
  /** A check is under way. */
  busy: boolean;
}

/** A writing task's work in the Content Editor (CE-022), and starting it. */
export interface TaskDraftWork {
  method: DraftMethod;
  /** The pages the action names, for an existing page's work. */
  pages: string[];
  /** The drafts already linked to the action. */
  drafts: ActionDraft[];
  onStart: (page: string | null) => void;
}

/**
 * "Create content" or "Optimize page" (CE-022): opens the Content Editor on
 * the draft for this work, started when there is none yet, and "Open draft"
 * once there is. An action naming several pages lists them, one draft each.
 */
function DraftWorkButtons({ work, disabled }: { work: TaskDraftWork; disabled: boolean }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task');
  const button = (page: string | null, label: string) => {
    const draft = findActionDraft(work.drafts, work.method, page);
    return draft ? (
      <Link
        href={contentEditorPath(draft.id)}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 shrink-0 text-xs')}
      >
        {t('openDraft')}
      </Link>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => work.onStart(page)}
        className="h-7 shrink-0 text-xs"
      >
        {label}
      </Button>
    );
  };

  if (work.method === 'create' || work.pages.length === 0) {
    return button(null, t(work.method === 'create' ? 'createContent' : 'optimizePage'));
  }
  if (work.pages.length === 1) return button(work.pages[0], t('optimizePage'));
  return (
    <div className="w-full space-y-1">
      <p className="text-xs text-muted-foreground">{t('pagesToOptimize')}</p>
      <ul className="space-y-1">
        {work.pages.map((page) => (
          <li key={page} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate" title={page}>
              {pagePath(page)}
            </span>
            {button(page, t('optimize'))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An opened task (AC-004): where to do it, why, how, when it counts as done
 * and what it takes, where it was sent, and for a task sent from the Improve
 * tab its body, platform and evidence (PROMPT-004); and (AC-010) the exact
 * page, the change to make there and how we check it.
 */
export function TaskDetailView({
  details,
  disabled,
  onEdit,
  send,
  draftWork,
  check,
  competitor = null,
  winning = null,
  attachments = [],
}: {
  details: ActionTaskDetails | null;
  disabled: boolean;
  onEdit: () => void;
  send?: TaskSendOptions;
  /** A writing task's draft (CE-022). */
  draftWork?: TaskDraftWork;
  /** Check now, for a task checked automatically (AC-010). */
  check?: TaskCheckOptions;
  /** What Analyze competitor content found (learning C1). */
  competitor?: CompetitorFindings | null;
  /** What Find what sets your winning pages apart found (learning C4). */
  winning?: WinningFindings | null;
  /** What Chat attached to it (CHAT-09 items 13, 16). */
  attachments?: TaskAttachment[];
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task');
  const tChecks = useTranslations('actionCenter.taskChecks');
  const missingText = useMissingText();
  const lastCheck = details?.lastCheck ?? null;
  const format = useFormatter();
  const effort = [details?.effort, details?.role].filter(Boolean).join(' · ');
  const sentContent = details?.sent.content ?? null;
  const sentWebhook = details?.sent.webhook ?? null;

  return (
    <div className="space-y-2 border-t px-4 py-3">
      {competitor && <CompetitorFindingsView findings={competitor} />}
      {winning && <WinningFindingsView findings={winning} />}
      {details?.body && (
        <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {details.body}
        </p>
      )}
      {details && (details.platformLabel || details.sources.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {details.platformLabel && (
            <Badge variant="secondary" className="text-[10px]">
              {details.platformLabel}
            </Badge>
          )}
          {details.sources.map((source) => (
            <Badge
              key={`${source.type}:${source.ref}`}
              variant="outline"
              title={source.ref}
              className="max-w-full truncate text-[10px] font-normal text-muted-foreground"
            >
              {source.type === 'answer' ? t('answerSource') : source.ref}
            </Badge>
          ))}
        </div>
      )}
      {details && hasTaskSpec(details) ? (
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {details.url && (
            <Field label={t('url')}>
              {/^https?:\/\//i.test(details.url) ? (
                <a
                  href={details.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline-offset-2 hover:underline"
                >
                  {details.url}
                  <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
                </a>
              ) : (
                details.url
              )}
            </Field>
          )}
          {details.where && <Field label={t('where')}>{details.where}</Field>}
          {details.why && <Field label={t('why')}>{details.why}</Field>}
          {details.change && (
            <Field label={t('change')}>
              {details.change.before ? (
                <>
                  <span className="text-muted-foreground">{t('changeBefore')}: </span>
                  {details.change.before}
                  <br />
                  <span className="text-muted-foreground">{t('changeAfter')}: </span>
                  {details.change.after}
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">{t('changeAdd')}: </span>
                  {details.change.after}
                </>
              )}
            </Field>
          )}
          {details.how.length > 0 && (
            <Field label={t('how')}>
              <ol className="list-decimal space-y-0.5 pl-4">
                {details.how.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </Field>
          )}
          {details.doneWhen && <Field label={t('doneWhen')}>{details.doneWhen}</Field>}
          {details.check && <Field label={t('check')}>{tChecks(details.check)}</Field>}
          {lastCheck && (
            <Field label={t('lastCheck')}>
              {(() => {
                const date = format.dateTime(new Date(lastCheck.at), {
                  month: 'short',
                  day: 'numeric',
                });
                return lastCheck.passed
                  ? t('checkedPassed', { date })
                  : t('checkedMissing', { date, missing: missingText(lastCheck.missing) });
              })()}
            </Field>
          )}
          {effort && <Field label={t('effort')}>{effort}</Field>}
        </dl>
      ) : (
        !details && <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}
      <AttachedFromChat attachments={attachments} />
      {(sentContent || sentWebhook) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {sentContent && (
            <p className="flex items-center gap-1">
              {t('sentToContent')}
              <Link
                href={`/dashboard/content?opportunity=${sentContent.opportunityId}`}
                className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t('openInContent')}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </p>
          )}
          {sentWebhook && (
            <p>
              {t('sentToWebhook', {
                date: format.dateTime(new Date(sentWebhook.at), {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {draftWork && <DraftWorkButtons work={draftWork} disabled={disabled} />}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onEdit}
          className="h-7 text-xs"
        >
          {t('edit')}
        </Button>
        {check && details?.check === 'auto' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || check.busy}
            onClick={check.onCheck}
            className="h-7 text-xs"
          >
            {check.busy ? t('checking') : t('checkNow')}
          </Button>
        )}
        {/* A writing task is written in the Content Editor: Create content / Optimize page. */}
        {send?.content && !sentContent && !draftWork && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => send.onSend('content')}
            className="h-7 text-xs"
          >
            {t('sendToContent')}
          </Button>
        )}
        {send?.webhook && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => send.onSend('webhook')}
            className="h-7 text-xs"
          >
            {sentWebhook ? t('sendToWebhookAgain') : t('sendToWebhook')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** What an automatic check found missing (AC-010), in words: "the page didn't open, …". */
export function useMissingText() {
  const tMissing = useTranslations('actionCenter.taskCheckMissing');
  return (codes: string[]) =>
    codes.map((code) => (tMissing.has(code) ? tMissing(code) : code)).join(', ');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-line">{children}</dd>
    </>
  );
}

const NO_TYPE = 'none';
const NO_CHECK = 'none';

/**
 * Every field of a task, editable (AC-004, AC-010). The text is saved only
 * when it changed, so a library task keeps rendering from its template in
 * the reader's language.
 */
export function TaskDetailForm({
  text,
  details,
  disabled,
  onSave,
  onCancel,
  submitLabel,
  requireSpec = false,
}: {
  /** The task's text as the drawer shows it. */
  text: string;
  details: ActionTaskDetails | null;
  disabled: boolean;
  onSave: (edit: TaskDetailsEdit & { title: string | null }) => void | Promise<void>;
  onCancel: () => void;
  /** The submit button's label; Save by default. */
  submitLabel?: string;
  /** Submit only with the URL, the change, Done when and How we check filled (AC-010's review). */
  requireSpec?: boolean;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task');
  const tTypes = useTranslations('actionCenter.taskTypes');
  const tChecks = useTranslations('actionCenter.taskChecks');
  const [draft, setDraft] = useState({
    title: text,
    url: details?.url ?? '',
    where: details?.where ?? '',
    why: details?.why ?? '',
    before: details?.change?.before ?? '',
    after: details?.change?.after ?? '',
    how: (details?.how ?? []).join('\n'),
    doneWhen: details?.doneWhen ?? '',
    check: details?.check ?? null,
    type: details?.type ?? null,
    effort: details?.effort ?? '',
    role: details?.role ?? '',
  });
  const id = useId();
  const set = (field: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const title = draft.title.trim();
  const specFilled =
    !!draft.url.trim() && !!draft.after.trim() && !!draft.doneWhen.trim() && !!draft.check;
  const canSubmit = !!title && (!requireSpec || specFilled);

  return (
    <form
      className="space-y-2.5 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        void onSave({
          title: title === text ? null : title,
          url: draft.url,
          where: draft.where,
          why: draft.why,
          before: draft.before,
          after: draft.after,
          how: draft.how.split('\n'),
          doneWhen: draft.doneWhen,
          check: draft.check,
          type: draft.type,
          effort: draft.effort,
          role: draft.role,
        });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <FormField id={`${id}-what`} label={t('what')}>
        <Input
          id={`${id}-what`}
          autoFocus
          value={draft.title}
          maxLength={200}
          disabled={disabled}
          className="h-8 text-sm"
          onChange={(e) => set('title')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-url`} label={t('url')}>
        <Input
          id={`${id}-url`}
          aria-required={requireSpec || undefined}
          value={draft.url}
          maxLength={TASK_DETAIL_LIMITS.url}
          placeholder={t('urlPlaceholder')}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => set('url')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-where`} label={t('where')}>
        <Input
          id={`${id}-where`}
          value={draft.where}
          maxLength={TASK_DETAIL_LIMITS.where}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => set('where')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-why`} label={t('why')}>
        <Textarea
          id={`${id}-why`}
          value={draft.why}
          rows={2}
          maxLength={TASK_DETAIL_LIMITS.why}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('why')(e.target.value)}
        />
      </FormField>
      <FormField
        id={`${id}-before`}
        label={`${t('change')} · ${t('changeBefore')}`}
        hint={t('changeBeforeHint')}
      >
        <Textarea
          id={`${id}-before`}
          value={draft.before}
          rows={2}
          maxLength={TASK_DETAIL_LIMITS.change}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('before')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-after`} label={`${t('change')} · ${t('changeAfter')}`}>
        <Textarea
          id={`${id}-after`}
          aria-required={requireSpec || undefined}
          value={draft.after}
          rows={2}
          maxLength={TASK_DETAIL_LIMITS.change}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('after')(e.target.value)}
        />
      </FormField>
      <FormField
        id={`${id}-how`}
        label={t('how')}
        hint={t('howHint', { max: TASK_DETAIL_LIMITS.steps })}
      >
        <Textarea
          id={`${id}-how`}
          value={draft.how}
          rows={4}
          maxLength={TASK_DETAIL_LIMITS.step * TASK_DETAIL_LIMITS.steps}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('how')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-done`} label={t('doneWhen')}>
        <Input
          id={`${id}-done`}
          aria-required={requireSpec || undefined}
          value={draft.doneWhen}
          maxLength={TASK_DETAIL_LIMITS.doneWhen}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => set('doneWhen')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-check`} label={t('check')}>
        <Select
          value={draft.check ?? NO_CHECK}
          onValueChange={(value) =>
            setDraft((current) => ({ ...current, check: isTaskCheck(value) ? value : null }))
          }
          disabled={disabled}
          items={[
            { value: NO_CHECK, label: t('noCheck') },
            ...TASK_CHECKS.map((check) => ({ value: check, label: tChecks(check) })),
          ]}
        >
          <SelectTrigger
            id={`${id}-check`}
            aria-required={requireSpec || undefined}
            className="h-8 w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CHECK}>{t('noCheck')}</SelectItem>
            {TASK_CHECKS.map((check) => (
              <SelectItem key={check} value={check}>
                {tChecks(check)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <div className="grid grid-cols-3 gap-2">
        <FormField id={`${id}-type`} label={t('type')}>
          <Select
            value={draft.type ?? NO_TYPE}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, type: isTaskType(value) ? value : null }))
            }
            disabled={disabled}
            items={[
              { value: NO_TYPE, label: t('noType') },
              ...TASK_TYPES.map((type) => ({ value: type, label: tTypes(type) })),
            ]}
          >
            <SelectTrigger id={`${id}-type`} className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TYPE}>{t('noType')}</SelectItem>
              {TASK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {tTypes(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`${id}-effort`} label={t('effort')}>
          <Input
            id={`${id}-effort`}
            value={draft.effort}
            maxLength={TASK_DETAIL_LIMITS.effort}
            placeholder={t('effortPlaceholder')}
            disabled={disabled}
            className="h-8 text-xs"
            onChange={(e) => set('effort')(e.target.value)}
          />
        </FormField>
        <FormField id={`${id}-role`} label={t('role')}>
          <Input
            id={`${id}-role`}
            value={draft.role}
            maxLength={TASK_DETAIL_LIMITS.role}
            placeholder={t('rolePlaceholder')}
            disabled={disabled}
            className="h-8 text-xs"
            onChange={(e) => set('role')(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={disabled || !canSubmit} className="h-7 text-xs">
          {submitLabel ?? t('save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
          className="h-7 text-xs"
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}
