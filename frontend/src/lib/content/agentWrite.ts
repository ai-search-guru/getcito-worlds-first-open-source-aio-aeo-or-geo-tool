import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getCitedPassages, getDraftSources, getMyRuleSets } from '@/lib/actions/contentDrafts';
import { rebuildSources, type RebuildSources } from './brief';
import { MAX_PASSAGES } from './citedPassages';
import { isPageType, type DraftMethod } from './drafts';
import {
  NOT_FOR_AGENT,
  activeRules,
  checkRule,
  effectiveRules,
  fanoutsToUse,
  readPage,
  ruleLength,
  ruleSet,
  type ActiveRule,
  type DraftRules,
  type RuleStatus,
} from './rules';

/** A rule as the agent reads it: its key, its name and what it asks. */
export interface AgentRule {
  key: string;
  name: string;
  detail: string;
}

/**
 * What the Content Agent is given when Start hands it a draft (CE-015), as
 * the API's contentWriter.js reads it: the sources the Sources tab keeps
 * (as Rebuild outline sends them), the page type's rules in effect, the
 * person's own rules, and the passages AI answers quote today on an existing
 * page, which it never changes. Read in the browser: the sources and the
 * page are read with DOMParser.
 */
export interface AgentWriteRequest {
  sources: RebuildSources;
  rules: AgentRule[];
  textRules: string[];
  locked: string[];
  /** How many rules the editor counts ("met of total"): the run's "Reading N rules" says the same. */
  counted?: number;
  /** Write this (customer priorities item 9): the brief built from the sources first, in the same run. */
  buildBrief?: boolean;
}

/** The server's limit on rules (contentWriter.js writeDraftInput). */
const MAX_AGENT_RULES = 60;

/**
 * A rule as the agent reads it: its name, and what it asks; with its status
 * on the page, the fan-outs a fan-out rule still needs.
 */
export type RuleDescriber = (
  rule: ActiveRule,
  status?: RuleStatus,
) => { name: string; detail: string };

/** Rules in the reader's words, as Fix open rules sends them. */
export function useRuleDescriber(): RuleDescriber {
  const t = useTranslations('contentEditor.editor.rules');
  return useCallback(
    (rule: ActiveRule, status?: RuleStatus) => {
      const fanouts = status ? fanoutsToUse(status) : null;
      return {
        name: t(`names.${rule.key}`),
        detail: [
          rule.current
            ? `${t('agent.aim')}: ${rule.current}${rule.unit ? ` ${t(`units.${rule.unit}`)}` : ''}`
            : null,
          fanouts ? `${t('agent.fanouts')}: ${fanouts}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    },
    [t],
  );
}

/** The rules whose status names the fan-outs to use. */
const FANOUT_RULES = new Set(['fanoutH2', 'fanoutFaq']);

/**
 * The rules in effect as the editor checks them, as the agent reads them: on,
 * the agent's to follow, described, a fan-out rule with the fan-outs it still
 * needs. Rebuild outline sends them, so the brief plans to them (brief rules,
 * 2026; the API reads them with CONTENT_BRIEF_RULES on).
 */
export function rulesForAgent(
  checked: { rule: ActiveRule; status?: RuleStatus }[],
  describe: RuleDescriber,
): AgentRule[] {
  return checked
    .filter(({ rule }) => rule.on && rule.check !== 'feed' && !NOT_FOR_AGENT.has(rule.key))
    .slice(0, MAX_AGENT_RULES)
    .map(({ rule, status }) => ({
      key: rule.key,
      ...describe(rule, FANOUT_RULES.has(rule.key) ? status : undefined),
    }));
}

/**
 * The rules a rebuilt brief plans to: the agent's (rulesForAgent), without
 * the Keywords rule while it holds the brief's own keywords — a rebuild
 * writes them anew from the sources — unless the person set it.
 */
export function rulesForBrief(
  checked: { rule: ActiveRule; status?: RuleStatus }[],
  describe: RuleDescriber,
): AgentRule[] {
  return rulesForAgent(
    checked.filter(({ rule }) => rule.key !== 'keywords' || rule.changed),
    describe,
  );
}

/** The page's headings and paragraphs, as the editor's passages. */
function pagePassages(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p')]
    .map((el) => (el.textContent ?? '').trim().slice(0, 5_000))
    .filter(Boolean)
    .slice(0, MAX_PASSAGES);
}

/**
 * The request for a draft. The rules in effect are read for it (the page
 * type's set with the workspace's My rules), unless the editor, which has
 * them, passes its own.
 */
export async function agentWriteRequest(
  draft: {
    id: string;
    brandId: string;
    title: string;
    pageType: string | null;
    method: DraftMethod;
    sourceUrl: string | null;
    bodyHtml: string;
    rules: DraftRules;
    /** The brand's language, the Language rule's default. */
    language?: string | null;
  },
  describe: RuleDescriber,
  inEffect?: { rules: ActiveRule[]; textRules: string[] },
  /** The locked passages' keys, as the editor holds them; read from the server otherwise. */
  locked?: string[],
): Promise<AgentWriteRequest> {
  const setType = draft.rules.set ?? (isPageType(draft.pageType) ? draft.pageType : null);
  const [read, mine, cited] = await Promise.all([
    getDraftSources(draft.id),
    // Without the workspace's rules, the page type's defaults still apply.
    inEffect
      ? null
      : getMyRuleSets(draft.brandId).catch((): Awaited<ReturnType<typeof getMyRuleSets>> => ({})),
    !locked && draft.method === 'optimize' && draft.sourceUrl
      ? getCitedPassages(draft.id, pagePassages(draft.bodyHtml))
      : Promise.resolve(null),
  ]);
  const effective = effectiveRules(draft.rules, setType ? mine?.[setType] : undefined);
  const rules = (
    inEffect?.rules ??
    activeRules(
      ruleSet(setType, { language: draft.language, length: draft.rules.importLength }),
      effective,
    ).filter((rule) => rule.on)
  )
    // Heading levels are the editor's (one H1), never the agent's.
    .filter((rule) => rule.check !== 'feed' && !NOT_FOR_AGENT.has(rule.key));
  const textRules =
    inEffect?.textRules ?? effective.textRules.filter((rule) => rule.on).map((rule) => rule.text);
  const length = ruleLength(rules, setType);
  const sources = read
    ? rebuildSources(read.data, read.choices, {
        title: draft.title,
        sourceUrl: draft.sourceUrl,
        html: draft.bodyHtml,
        length,
      })
    : { promptIds: [], fanouts: [], pages: [], queries: [], headings: [], length };
  // The fan-out rules name the fan-outs the page doesn't use yet: an existing
  // page's own; a page the agent writes anew starts from none of them.
  const page = readPage(draft.method === 'optimize' ? (draft.bodyHtml ?? '') : '', 0);
  const ctx = {
    brandDomains: [],
    competitorDomains: [],
    fanouts: sources.fanouts.map((f) => f.query),
  };
  return {
    sources,
    rules: rules.slice(0, MAX_AGENT_RULES).map((rule) => ({
      key: rule.key,
      ...describe(rule, FANOUT_RULES.has(rule.key) ? checkRule(rule, page, ctx) : undefined),
    })),
    textRules,
    locked: locked ?? (cited ?? []).map((passage) => passage.key),
  };
}
