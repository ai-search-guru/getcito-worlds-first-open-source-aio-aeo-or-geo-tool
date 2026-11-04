'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { saveChatFocus, saveChatGeneralSettings } from '@/lib/actions/chatPrefs';
import { FOCUS_AREAS, type FocusArea } from '@/lib/chat/focus';
import type {
  AnswerLanguage,
  ChatGeneralAccess,
  ChatGeneralSettings,
  GeneralPatch,
} from '@/lib/chat/generalSettings';
import type { ChatMode } from '@/lib/chat/precedence';
import { cn } from '@/lib/utils';
import { useFocusLabel } from './FocusPicker';

/**
 * Chat's Settings (CHAT-01 owner update 2026-10-26; CHAT-23
 * `chatSettings.*`; mockup #s-settings), General: the person's own
 * preferences. Each pick is kept at once on the person (every device); one
 * that can't be kept goes back and says so. Default mode is for the roles
 * that change things; Full auto says why it's locked. Your focus (CHAT-24
 * §3 item 2) is for everyone: it only changes what Chat suggests. The
 * mockup's other tabs come with their pages.
 */

const MODES: ChatMode[] = ['ask_first', 'auto', 'full_auto'];
/** generalSettings.ts ANSWER_LANGUAGES, in the order the list shows them. */
const LANGUAGES: AnswerLanguage[] = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl'];

const SELECT =
  'h-7 rounded-lg border bg-background px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** One setting (mockup `.srow2`): its name and a muted line, the control on the right. */
function Row({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t py-3 text-[13px]">
      <div className="min-w-0 flex-1">
        {label}
        <span className="block text-xs text-muted-foreground">{note}</span>
      </div>
      {children}
    </div>
  );
}

/** A switch (mockup `.sw`): 30×18, dark when on. */
function Switch({
  checked,
  label,
  action,
  onChange,
}: {
  checked: boolean;
  label: string;
  action: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-action={action}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        checked ? 'bg-foreground' : 'bg-muted-foreground/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full bg-background transition-[left] duration-200 motion-reduce:transition-none',
          checked ? 'left-[14px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function ChatSettings({
  initial,
  access,
  focus: savedFocus,
}: {
  initial: ChatGeneralSettings;
  access: ChatGeneralAccess;
  /** What Chat focuses on for the person, in the order picked. */
  focus: FocusArea[];
}) {
  const t = useTranslations('chatShell.settings');
  const tf = useTranslations('chatShell.focus');
  const focusLabel = useFocusLabel();
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [focus, setFocus] = useState(savedFocus);

  /** Shows the pick at once and keeps it; a refusal puts the old value back. */
  const change = async (patch: GeneralPatch) => {
    const before = settings;
    setSettings((was) => ({ ...was, ...patch }));
    const saved = await saveChatGeneralSettings(patch).catch(() => ({ ok: false as const }));
    if (!saved.ok) {
      setSettings(before);
      toast.error(t('failed'));
    } else if (patch.panelOnPages !== undefined) {
      // The dashboard's layout reads it: Ask Chat and Ctrl J follow on every page.
      router.refresh();
    }
  };

  /** Turns an area on (after the others) or off; one that isn't kept goes back. */
  const changeFocus = async (area: FocusArea, on: boolean) => {
    const before = focus;
    const next = on ? [...focus.filter((a) => a !== area), area] : focus.filter((a) => a !== area);
    setFocus(next);
    const saved = await saveChatFocus(next).catch(() => ({ ok: false as const }));
    if (!saved.ok) {
      setFocus(before);
      toast.error(t('failed'));
      return;
    }
    toast(next.length ? t('focus.saved', { label: focusLabel(next) }) : t('focus.cleared'));
  };

  const lockTip =
    access.fullAutoLock === 'plan'
      ? t('fullAutoPlan')
      : access.fullAutoLock === 'admin'
        ? t('fullAutoAdmin')
        : undefined;

  return (
    <div className="max-w-[920px]">
      <div className="mb-3.5">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="flex items-start gap-6 max-[900px]:flex-col">
        <nav
          aria-label={t('title')}
          className="sticky top-0 grid w-[200px] shrink-0 gap-0.5 max-[900px]:static max-[900px]:flex max-[900px]:w-full max-[900px]:flex-wrap"
        >
          <span
            data-action="chatSettings.tab"
            aria-current="page"
            className="rounded-lg bg-muted px-2.5 py-[7px] text-[13px] font-medium text-foreground"
          >
            {t('tabs.general')}
          </span>
        </nav>
        <section className="max-w-[680px] min-w-0 flex-1">
          <h2 className="mb-1 text-base font-semibold">{t('general.title')}</h2>
          <p className="mb-3.5 text-[13px] text-muted-foreground">
            {t.rich('general.intro', {
              policy: (chunks) => (
                <Link
                  href="/dashboard/settings/chat"
                  data-action="policy.open"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>

          {access.modes && (
            <Row label={t('defaultMode.label')} note={t('defaultMode.note')}>
              <span
                role="radiogroup"
                aria-label={t('defaultMode.label')}
                className="inline-flex shrink-0 rounded-[9px] border bg-muted/60 p-0.5"
              >
                {MODES.map((mode) => {
                  const locked = mode === 'full_auto' && !!access.fullAutoLock;
                  const on = settings.defaultMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={locked || undefined}
                      data-action="chatSettings.defaultMode"
                      title={locked ? lockTip : undefined}
                      onClick={() => {
                        if (!locked && !on) void change({ defaultMode: mode });
                      }}
                      className={cn(
                        'inline-flex items-center rounded-[7px] px-[9px] py-[3px] text-xs whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        on &&
                          'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]',
                        locked && 'cursor-not-allowed text-muted-foreground/60',
                      )}
                    >
                      {t(`defaultMode.${mode}`)}
                    </button>
                  );
                })}
              </span>
            </Row>
          )}

          <Row label={t('focus.label')} note={t('focus.note')}>
            <span
              role="group"
              aria-label={t('focus.label')}
              className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]"
            >
              {FOCUS_AREAS.map((area) => (
                <label key={area} className="flex items-center gap-[7px] whitespace-nowrap">
                  <input
                    type="checkbox"
                    data-action="chatSettings.focus"
                    value={area}
                    checked={focus.includes(area)}
                    onChange={(event) => void changeFocus(area, event.target.checked)}
                    className="accent-foreground"
                  />
                  {tf(`areas.${area}.name`)}
                </label>
              ))}
            </span>
          </Row>

          <Row label={t('language.label')} note={t('language.note')}>
            <select
              data-action="chatSettings.answerLanguage"
              aria-label={t('language.label')}
              value={settings.answerLanguage ?? ''}
              onChange={(event) =>
                void change({
                  answerLanguage: (event.target.value || null) as AnswerLanguage | null,
                })
              }
              className={SELECT}
            >
              <option value="">{t('language.same')}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`language.${language}`)}
                </option>
              ))}
            </select>
          </Row>

          {/* "Notify me when an agent needs me" and "Show Thought for N s" are
              kept on the person but nothing reads them yet, so they stay hidden
              until they're wired up; their saved values and schema stay. */}

          <Row label={t('everyPage.label')} note={t('everyPage.note')}>
            <Switch
              checked={settings.panelOnPages}
              label={t('everyPage.label')}
              action="chatSettings.toggleAskChatEverywhere"
              onChange={(next) => void change({ panelOnPages: next })}
            />
          </Row>
        </section>
      </div>
    </div>
  );
}
