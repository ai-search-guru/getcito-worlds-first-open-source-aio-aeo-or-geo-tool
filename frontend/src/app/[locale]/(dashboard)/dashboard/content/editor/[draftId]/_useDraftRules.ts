'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getMyRuleSets, saveDraftRules, saveMyRuleSet } from '@/lib/actions/contentDrafts';
import { isPageType, type ContentDraft, type PageType } from '@/lib/content/drafts';
import type { CatalogMatch } from '@/lib/content/feedMatch';
import type { SiteType } from '@/lib/content/pageTypes';
import type { ShoppingCheck } from '@/lib/content/shoppingCheck';
import {
  MAX_TEXT_RULES,
  activeRules,
  checkRule,
  draftRulesFit,
  effectiveRules,
  lengthConflict,
  overridesForImport,
  readPage,
  ruleLength,
  ruleSet,
  ruleSetFits,
  rulesMet,
  setToSave,
  textRuleCheck,
  type ActiveRule,
  type DraftRules,
  type RuleContext,
  type RuleStatus,
  type SavedRuleSet,
  type TextRule,
} from '@/lib/content/rules';
import { buildSourceGroups } from '@/lib/content/sources';
import { useBrandStore } from '@/state/useBrandStore';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { DraftReads } from './_useDraftReads';

export interface DraftRulesState {
  /** The page type whose set applies. */
  setType: PageType | null;
  /** The set the draft's rules come from: GetCito's default or the workspace's My rules. */
  source: 'default' | 'mine';
  rules: { rule: ActiveRule; status: RuleStatus }[];
  /** The person's own rules, each checked as a number or by AI (not counted). */
  textRules: { rule: TextRule; check: 'numberCheck' | 'aiCheck' }[];
  /** The page types the workspace has My rules for. */
  mineTypes: PageType[];
  /** My rules have been read: until then a change would leave the workspace's set out. */
  ready: boolean;
  met: number;
  total: number;
  /** The page length the rules ask for. */
  length: number;
  /**
   * Whether the count stands (set by the editor once the set, the fan-outs,
   * the brief and the catalog are read): before, rules come and go from it.
   */
  settled?: boolean;
  /** The sections and questions the rules ask for take more than Length allows. */
  lengthConflict: { need: number; max: number } | null;
  /**
   * The draft's brand reads a Google Merchant Center account into its
   * catalog (the shopping check's): the Shopping hints say what it accepts.
   */
  merchantCenter?: boolean;
  /**
   * The rules checked against another page (an agent's change applied to a
   * copy): what it would meet and break (editor test 2026-10-25).
   */
  checkHtml: (html: string, characters: number) => { rule: ActiveRule; status: RuleStatus }[];
  /** Turns a rule on or off, or gives it a value, for this draft. */
  change: (key: string, change: { on?: boolean; value?: string }) => void;
  /** Loads a set into the draft: a type's GetCito default, or the workspace's My rules for it. */
  pickSet: (type: PageType, source: 'default' | 'mine') => void;
  /** Adds rules in the person's own words, one per line. */
  addTextRules: (lines: string[]) => void;
  /** Edits a text rule, turns it on or off; an empty text removes it. */
  changeTextRule: (id: string, change: { text?: string; on?: boolean }) => void;
  /** Save as my rules: the draft's choices become the workspace's set for the type. */
  saveAsMine: () => void;
  /** Back to GetCito's default set for the type. */
  reset: () => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type RuleSets = Partial<Record<PageType, SavedRuleSet>>;
/** No sets while My rules are unread: one object, so what reads them doesn't change. */
const NO_RULE_SETS: RuleSets = {};

/**
 * The draft's rules (CE-009) as the editor reads them: the set for its page
 * type with the person's changes, each checked against the page as written —
 * the header's chip and the Rules tab show the same. A draft no one has set
 * rules on starts from the workspace's My rules for its type, if it has
 * them, read once. The brand's domains, the fan-outs kept and the brief's
 * keywords come from the editor's one read of the sources and the brief
 * (useDraftReads), so a rebuild, an edit or a source checked shows in the
 * rules at once.
 */
export function useDraftRules({
  draft,
  siteType,
  html,
  characters,
  pageType,
  reads,
  catalog = null,
  shopping = null,
}: {
  draft: ContentDraft;
  /** The brand's business type as the editor holds it: My rules are kept per type (00227). */
  siteType: SiteType;
  html: string;
  characters: number;
  pageType: string | null;
  reads: Pick<DraftReads, 'brief' | 'sources'>;
  /** The page's product in the brand's catalog (CE-053), for the feed rule (RuleContext's). */
  catalog?: CatalogMatch | 'reading' | null;
  /**
   * The draft's shopping path against the catalog (useShoppingCheck), for the
   * Shopping rules (shopping path, part 6): shown once it's read and has one,
   * or couldn't be read; not while it's first read, so a draft without a
   * path never shows them.
   */
  shopping?: ShoppingCheck | 'reading' | 'failed' | null;
}): DraftRulesState {
  const t = useTranslations('contentEditor.editor.rules');
  const tTypes = useTranslations('contentEditor.pageTypes');
  // A read-only workspace (plan not active): a rule changed, a set picked or
  // saved as My rules opens the upgrade dialog instead, and nothing changes.
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const locked = () => {
    if (isLocked) openUpgrade(tActions('editRules'));
    return isLocked;
  };
  const [choices, setChoices] = useState<DraftRules>(draft.rules);
  // My rules as read, and for which site type: they are kept per type
  // (00227), so after a switch they count as unread until read again.
  const [mineState, setMineState] = useState<{ site: SiteType; sets: RuleSets } | null>(null);
  const mineRead = mineState?.site === siteType;
  const mine = mineRead ? mineState.sets : NO_RULE_SETS;
  const language = useBrandStore((s) => s.brands.find((b) => b.id === draft.brandId)?.language);
  // One save at a time, the latest waiting; what the database holds, to go back to.
  const saving = useRef(false);
  const waiting = useRef<{ rules: DraftRules; message: string } | null>(null);
  const saved = useRef<DraftRules>(draft.rules);

  // Read again once the brand's site type is saved (the editor passes it then).
  useEffect(() => {
    let cancelled = false;
    getMyRuleSets(draft.brandId)
      .then((sets) => {
        if (!cancelled) setMineState({ site: siteType, sets });
      })
      .catch((err) => {
        console.error('Failed to read My rules:', err);
        if (!cancelled) setMineState({ site: siteType, sets: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [draft.brandId, siteType]);

  const sources = reads.sources;
  const ctx = useMemo<RuleContext>(() => {
    if (!sources || sources.failed) {
      return { brandDomains: [], competitorDomains: [], fanouts: [], language, catalog, shopping };
    }
    const fanouts = buildSourceGroups(sources.data, sources.choices, {
      title: draft.title,
      sourceUrl: draft.sourceUrl,
    })
      .find((g) => g.kind === 'fanout')
      ?.rows.filter((r) => r.included)
      .map((r) => r.name);
    return {
      brandDomains: sources.data.brandDomains,
      competitorDomains: sources.data.competitorDomains,
      fanouts: fanouts ?? [],
      language,
      catalog,
      shopping,
    };
  }, [sources, draft.title, draft.sourceUrl, language, catalog, shopping]);
  const brief = reads.brief;
  const keywords = useMemo(
    () => (brief.status === 'ready' ? (brief.brief?.keywords ?? []) : []),
    [brief],
  );

  const draftType = isPageType(pageType) ? pageType : null;
  const setType = choices.set ?? draftType;
  const effective = useMemo(
    () => effectiveRules(choices, setType ? mine[setType] : undefined),
    [choices, setType, mine],
  );
  const rules = useMemo(
    () =>
      activeRules(
        ruleSet(setType, {
          keywords,
          language,
          length: effective.importLength,
          shopping: shopping !== null && shopping !== 'reading',
        }),
        effective,
      ),
    [setType, keywords, language, effective, shopping],
  );
  // The checks follow the page a beat behind typing.
  const deferredHtml = useDeferredValue(html);
  const deferredCharacters = useDeferredValue(characters);
  const page = useMemo(
    () => readPage(deferredHtml, deferredCharacters),
    [deferredHtml, deferredCharacters],
  );
  const checked = useMemo(
    () => rules.map((rule) => ({ rule, status: checkRule(rule, page, ctx) })),
    [rules, page, ctx],
  );
  const { met, total } = rulesMet(checked);
  const checkHtml = useCallback(
    (other: string, count: number) => {
      const read = readPage(other, count);
      return rules.map((rule) => ({ rule, status: checkRule(rule, read, ctx) }));
    },
    [rules, ctx],
  );
  const conflict = useMemo(
    () => lengthConflict(checked, ctx.fanouts.length),
    [checked, ctx.fanouts.length],
  );

  /**
   * Saves the latest change: one save at a time, so two quick changes can't
   * land out of order. A change made meanwhile waits and goes next (it holds
   * the earlier ones); only the last says it saved, or failed, and a failure
   * puts back what the database holds.
   */
  const flush = () => {
    if (saving.current || !waiting.current) return;
    const { rules: next, message } = waiting.current;
    waiting.current = null;
    saving.current = true;
    saveDraftRules(draft.id, next)
      .then(() => {
        saved.current = next;
        if (!waiting.current) toast(message);
      })
      .catch((err) => {
        console.error('Failed to save the rules:', err);
        if (!waiting.current) {
          setChoices(saved.current);
          toast.error(t('saveFailed'));
        }
      })
      .finally(() => {
        saving.current = false;
        flush();
      });
  };
  const save = (next: DraftRules, message: string) => {
    if (locked()) return;
    // Before My rules are read, the draft would save GetCito's set over the workspace's.
    if (!mineRead) return;
    // Past the database's size check the save would fail: the change stays out.
    if (!draftRulesFit(next)) {
      toast.error(t('tooLong'));
      return;
    }
    setChoices(next);
    waiting.current = { rules: next, message };
    flush();
  };
  // A change keeps the set the draft's rules come from.
  const edited = (change: Partial<DraftRules>, message = t('updated')) =>
    save({ ...effective, source: effective.source ?? 'default', ...change }, message);
  const typeName = (type: PageType | null) => (type ? tTypes(type) : '');

  return {
    setType,
    source: effective.source ?? 'default',
    rules: checked,
    textRules: effective.textRules.map((rule) => ({ rule, check: textRuleCheck(rule.text) })),
    mineTypes: (Object.keys(mine) as PageType[]).filter((type) => mine[type]),
    ready: mineRead,
    met,
    total,
    length: ruleLength(rules, setType),
    lengthConflict: conflict,
    merchantCenter: typeof shopping === 'object' && shopping !== null && shopping.merchantCenter,
    checkHtml,
    change: (key, change) =>
      edited({
        overrides: { ...effective.overrides, [key]: { ...effective.overrides[key], ...change } },
      }),
    pickSet: (type, source) => {
      const set = source === 'mine' ? mine[type] : undefined;
      save(
        {
          set: type === draftType ? null : type,
          source,
          // The page's own length stays the Length rule's starting point.
          overrides: overridesForImport(set?.overrides ?? {}, effective.importLength),
          textRules: set?.textRules ?? [],
          ...(effective.importLength ? { importLength: effective.importLength } : {}),
        },
        t('setPicked'),
      );
    },
    addTextRules: (lines) => {
      const room = MAX_TEXT_RULES - effective.textRules.length;
      if (room <= 0) {
        toast.error(t('text.tooMany', { max: MAX_TEXT_RULES }));
        return;
      }
      const added = lines.slice(0, room).map((text) => ({ id: newId(), text, on: true }));
      edited(
        { textRules: [...effective.textRules, ...added] },
        t('text.added', { count: added.length }),
      );
    },
    changeTextRule: (id, change) => {
      const removed = change.text !== undefined && !change.text.trim();
      edited(
        {
          textRules: removed
            ? effective.textRules.filter((r) => r.id !== id)
            : effective.textRules.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      ...change,
                      ...(change.text !== undefined && { text: change.text.trim() }),
                    }
                  : r,
              ),
        },
        removed ? t('text.removed') : t('updated'),
      );
    },
    saveAsMine: () => {
      if (!setType || locked()) return;
      const set = setToSave(effective, mine[setType]);
      if (!ruleSetFits(set)) {
        toast.error(t('tooLongMine'));
        return;
      }
      saveMyRuleSet(draft.brandId, setType, set)
        .then(() => {
          setMineState((prev) => prev && { ...prev, sets: { ...prev.sets, [setType]: set } });
          save({ ...effective, source: 'mine' }, t('savedMine', { type: typeName(setType) }));
        })
        .catch((err) => {
          console.error('Failed to save My rules:', err);
          toast.error(t('saveMineFailed'));
        });
    },
    reset: () =>
      save(
        {
          set: choices.set,
          source: 'default',
          overrides: {},
          textRules: [],
          // The page's own length isn't a choice: Reset keeps it.
          ...(effective.importLength ? { importLength: effective.importLength } : {}),
        },
        t('resetDone'),
      ),
  };
}
