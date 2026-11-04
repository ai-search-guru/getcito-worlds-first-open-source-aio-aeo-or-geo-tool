'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatSkillItem } from '@/lib/chat/composerSetup';
import type { ChatReference, ChatReferenceType } from '@/lib/chat/references';
import { SHORTCUTS, shortcutCommand, type Shortcut } from '@/lib/chat/shortcuts';
import { cn } from '@/lib/utils';

/**
 * The composer's menus (CHAT-02 items 11–17, agentic update; mockup #slash,
 * #atmenu, #plusmenu): each opens above the box, or below it when there's
 * no room above (menuPlacement). Which row is active, and what a pick does,
 * is the composer's; these draw them.
 */

/**
 * The shortcuts a "/…" filters to (CHAT-02 item 12, CHAT-08; the list is
 * lib/chat/shortcuts.ts): those whose command, a part of it, or a word of
 * whose name starts with it. The enabled skills follow them in their own
 * group (W2-04).
 */
export function matchShortcuts(query: string, name: (shortcut: Shortcut) => string): Shortcut[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SHORTCUTS];
  return SHORTCUTS.filter(
    (s) =>
      s.id.startsWith(q) ||
      s.id.split('-').some((part) => part.startsWith(q)) ||
      name(s)
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
  );
}

/**
 * The skills a "/…" filters to (CHAT-13 item 5): those whose name, a part
 * of it, or a word of whose title starts with it.
 */
export function matchSkills(query: string, skills: readonly ChatSkillItem[]): ChatSkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter(
    (s) =>
      s.name.startsWith(q) ||
      s.name.split('-').some((part) => part.startsWith(q)) ||
      s.title
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q)),
  );
}

/** Each reference type's mark, as the mockup draws it. */
const REFERENCE_MARK: Record<ChatReferenceType, string> = {
  chart: '▤',
  metric: '◔',
  table: '▦',
  prompt: '❝',
  page: '⌁',
  task: '◎',
};

/** The tallest a menu gets (mockup: 300px). */
export const MENU_MAX = 300;
/** The gap between the box and its menu (mb-2, mt-2). */
const MENU_GAP = 8;
/** The overflow values that clip what sticks out of a box. */
const CLIPS = /^(auto|scroll|hidden|clip)$/;

/**
 * Where a menu opens and how tall it may be: above the box when its rows
 * fit there, else below when there's more room below (Chat Home's box sits
 * high on the page). The room ends at every box that clips the menu (the
 * page's scrolling area, under the header) and at the window. The menu is
 * absolutely placed against its parent, the composer's box.
 */
export function menuPlacement(panel: HTMLElement): { down: boolean; maxHeight: number } {
  const anchor = panel.parentElement;
  if (!anchor) return { down: false, maxHeight: MENU_MAX };
  const box = anchor.getBoundingClientRect();
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    if (!CLIPS.test(getComputedStyle(node).overflowY)) continue;
    const clip = node.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const above = box.top - top;
  const below = bottom - box.bottom;
  const need = Math.min(MENU_MAX, panel.scrollHeight) + MENU_GAP;
  const down = above < need && below > above;
  const room = (down ? below : above) - MENU_GAP;
  return { down, maxHeight: Math.max(0, Math.min(MENU_MAX, room)) };
}

function Panel({
  label,
  className,
  active,
  children,
}: {
  label: string;
  className?: string;
  /** The active row's index: kept in view as the arrows move it. */
  active?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ down: false, maxHeight: MENU_MAX });
  // Its side is picked as it opens, before it paints, and again when the window changes size.
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const fit = () => setPlace(menuPlacement(panel));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      data-side={place.down ? 'below' : 'above'}
      style={{ maxHeight: place.maxHeight }}
      className={cn(
        'absolute left-0 z-30 min-w-[240px] overflow-auto rounded-[14px] border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(10,10,10,.12)]',
        place.down ? 'top-full mt-2' : 'bottom-full mb-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

const row =
  'flex w-full items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[13px] hover:bg-muted aria-selected:bg-muted';

/**
 * The / menu: the shortcuts, then the Skills group of the enabled skills
 * that match (CHAT-13 item 5), one list for the arrows. "Browse all skills"
 * waits for the Skills page (W3).
 */
export function SlashMenu({
  shortcuts,
  skills = [],
  skillsOn = false,
  active,
  onPick,
  onPickSkill,
}: {
  shortcuts: Shortcut[];
  /** The enabled skills the query matches. */
  skills?: ChatSkillItem[];
  /** The person has skills: the empty state names them too. */
  skillsOn?: boolean;
  /** The active row: the shortcuts first, then the skills. */
  active: number;
  onPick: (shortcut: Shortcut) => void;
  onPickSkill?: (skill: ChatSkillItem) => void;
}) {
  const t = useTranslations('chatComposer.slash');
  return (
    <Panel label={t('label')} active={active} className="w-[min(520px,calc(100vw-2rem))]">
      <div className="flex px-2 py-1.5 text-xs font-semibold">
        {t('title')}
        <span className="ml-auto font-normal text-muted-foreground">{t('keys')}</span>
      </div>
      {shortcuts.length === 0 && skills.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">
          {skillsOn ? t('noneWithSkills') : t('none')}
        </p>
      ) : (
        <>
          {shortcuts.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              data-action="slashMenu.pickShortcut"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              className={row}
            >
              <span className="font-mono text-[12.5px]">{shortcutCommand(s)}</span>
              <span>{t(`shortcuts.${s.key}.name`)}</span>
            </button>
          ))}
          {skills.length > 0 && (
            <div role="group" aria-label={t('skills')}>
              <div
                aria-hidden
                className="px-2 pt-2 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
              >
                {t('skills')}
              </div>
              {skills.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  role="option"
                  aria-selected={shortcuts.length + i === active}
                  data-action="slashMenu.pickSkill"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPickSkill?.(s)}
                  className={row}
                >
                  <span className="font-mono text-[12.5px]">/{s.name}</span>
                  <span>{s.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function ReferenceMenu({
  references,
  loading,
  active,
  onPick,
}: {
  references: ChatReference[];
  loading: boolean;
  active: number;
  onPick: (reference: ChatReference) => void;
}) {
  const t = useTranslations('chatComposer.reference');
  return (
    <Panel label={t('title')} active={active} className="w-[260px]">
      <div className="px-2 pt-2 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase">
        {t('title')}
      </div>
      {references.length === 0 ? (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">
          {loading ? t('loading') : t('none')}
        </p>
      ) : (
        references.map((ref, i) => (
          <button
            key={`${ref.type}:${ref.id}`}
            type="button"
            role="option"
            aria-selected={i === active}
            data-action="refMenu.pick"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(ref)}
            className={row}
          >
            <span aria-hidden className="w-3.5 shrink-0 text-foreground">
              {REFERENCE_MARK[ref.type]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{ref.label}</span>
              <em className="block text-[11.5px] text-muted-foreground not-italic">
                {t(`types.${ref.type}`)}
              </em>
            </span>
          </button>
        ))
      )}
    </Panel>
  );
}

export interface PlusItem {
  key: 'attach' | 'connect';
  mark: string;
  label: string;
  note?: string;
  onPick: () => void;
}

export function PlusMenu({ items, active }: { items: PlusItem[]; active: number }) {
  const t = useTranslations('chatComposer.plus');
  return (
    <Panel label={t('label')} active={active} className="w-[240px]">
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === active}
          data-action={item.key === 'attach' ? 'plusMenu.attachFiles' : 'plusMenu.connectTool'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={item.onPick}
          className={row}
        >
          <span aria-hidden className="w-3.5 shrink-0 text-foreground">
            {item.mark}
          </span>
          <span className="min-w-0 flex-1">
            {item.label}
            {item.note && (
              <em className="block text-[11.5px] text-muted-foreground not-italic">{item.note}</em>
            )}
          </span>
        </button>
      ))}
    </Panel>
  );
}
