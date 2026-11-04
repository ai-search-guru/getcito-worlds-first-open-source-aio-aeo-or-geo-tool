import type { Signal } from '@/lib/actions/signals';
import { SIGNAL_KINDS, isLibrarySignalKind } from '@/lib/signals/registry';
import { locationName, platformName, targetName } from '@/lib/signals/names';
import { getPlatformName } from '@/lib/trafficPlatforms';

/**
 * Composes the display strings a signal row shows from `kind` + `payload`.
 * Titles live in i18n templates (actionCenter.signalTexts.<kind>), not the
 * database — this module only prepares the interpolation values, so the
 * page's search box can match what the user actually reads.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * How many things a library finding is about. A group's value is its count,
 * except for the AI traffic drops, whose value is the site's visits: they
 * record their pages as `pageCount` (server library/detect.js).
 */
export function libraryTargetCount(signal: Signal, targets: readonly unknown[]): number {
  const pageCount = signal.payload?.pageCount;
  if (typeof pageCount === 'number') return Math.max(targets.length, pageCount);
  return Math.max(targets.length, Number(signal.currentValue ?? 0));
}

/**
 * A library signal's copy: what it is about, named from its targets, and the
 * measured fact behind it.
 *
 * The V1 library's detectors all write the same shape — an entity and a list
 * of targets — so their titles need two values: how many ("11 prompts") for a
 * finding about a group, and which one (a platform, a topic, a domain) for a
 * finding about a single thing. Descriptions also carry the row's numbers, so
 * a row says what was measured rather than only what kind of finding it is
 * (AC-002). Each family stores its numbers in the same three columns with
 * its own meaning, named here once.
 */
function librarySignalTexts(signal: Signal, t: Translator): { title: string; description: string } {
  const p = signal.payload ?? {};
  const targets = Array.isArray(p.targets) ? (p.targets as Array<{ label?: string }>) : [];
  const entity = str(p, 'entity');
  const count = entity === '' ? 0 : libraryTargetCount(signal, targets);
  const values: Record<string, string | number> = {
    targets: entity ? t(`targets.${entity}`, { count }) : '',
    name: targetName(entity, targets[0]?.label ?? ''),
    from: signal.previousValue ?? 0,
    to: signal.currentValue ?? 0,
    prompts: Number(p.prompts ?? 0),
  };
  if (entity === 'regions') values.best = locationName(str(p, 'bestRegion'));
  if (entity === 'sources') {
    // ae_citation_sources: answers citing the domain, those naming the brand,
    // and those naming only competitors, over the last week.
    values.answers = signal.currentValue ?? 0;
    values.withBrand = signal.previousValue ?? 0;
    values.competitorOnly = signal.changeValue ?? 0;
  }
  return {
    title: t(`${signal.kind}.title`, values),
    description: t(`${signal.kind}.description`, values),
  };
}

/** A URL as a row names it: without its protocol or trailing slash. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * A lost citation, once its evidence is recorded (server
 * signals/lostCitationEvidence.js), names the page that stopped being cited
 * and the platforms it was lost on, and a loss on one platform says which in
 * its title (AC-001/AC-002). Older rows keep the generic copy.
 */
function lostCitationTexts(signal: Signal, t: Translator): { title: string; description: string } {
  const p = signal.payload;
  const platforms = Array.isArray(p.platforms)
    ? p.platforms.filter((x): x is string => typeof x === 'string').map(platformName)
    : [];
  const lost = Array.isArray(p.lostUrls) ? (p.lostUrls as { url?: unknown }[]) : [];
  const page = typeof lost[0]?.url === 'string' ? shortUrl(lost[0].url) : '';
  const values = {
    prompt: str(p, 'promptText'),
    platform: platforms[0] ?? '',
    platforms: platforms.join(', '),
    page,
  };
  return {
    title: t(platforms.length === 1 ? 'lost_citations.titleOn' : 'lost_citations.title', values),
    description:
      page && platforms.length
        ? t('lost_citations.descriptionPage', values)
        : t('lost_citations.description', values),
  };
}

export function signalTexts(signal: Signal, t: Translator): { title: string; description: string } {
  if (isLibrarySignalKind(signal.kind)) return librarySignalTexts(signal, t);
  if (signal.kind === 'lost_citations') return lostCitationTexts(signal, t);
  const p = signal.payload;
  const values = ((): Record<string, string | number> => {
    switch (signal.kind) {
      case 'sharp_drop':
      case 'visibility_slipping':
        return { from: signal.previousValue ?? 0, to: signal.currentValue ?? 0 };
      case 'platform_gap':
        return {
          platform: platformName(str(p, 'platform')),
          best: platformName(str(p, 'bestPlatform')),
          rate: signal.currentValue ?? 0,
          bestRate: signal.previousValue ?? 0,
        };
      case 'competitor_citation_gap':
        return {
          competitor: str(p, 'competitorName'),
          theirs: signal.previousValue ?? 0,
          ours: signal.currentValue ?? 0,
        };
      case 'prompt_gain':
        return { prompt: str(p, 'promptText'), gain: signal.changeValue ?? 0 };
      case 'new_engine':
        return { platform: platformName(str(p, 'platform')) };
      // A referring platform, named as the AI Traffic page names it (AT-013).
      case 'ai_platform_new':
        return { platform: getPlatformName(str(p, 'aiSource')), visits: signal.currentValue ?? 0 };
      case 'first_citation':
        return { url: str(p, 'label') || str(p, 'url'), prompt: str(p, 'promptText') };
      case 'competitor_surge':
        return {
          name: str(p, 'competitorName'),
          from: signal.previousValue ?? 0,
          to: signal.currentValue ?? 0,
        };
      case 'competitor_crossed':
      case 'competitor_overtaken':
        return {
          name: str(p, 'competitorName'),
          competitorRate: Number(p.competitorRate ?? 0),
          brandRate: Number(p.brandRate ?? 0),
        };
      case 'page_opportunity':
        return {
          page: str(p, 'landingPage'),
          rank: Number(p.valueRank ?? 0),
          signal: str(p, 'valueSignal').replace('_', ' '),
        };
      case 'uncited_mentions':
        return { count: signal.currentValue ?? 0 };
      case 'audit_low_score':
        return { count: signal.currentValue ?? 0 };
    }
  })();

  return {
    title: t(`${signal.kind}.title`, values),
    description: t(`${signal.kind}.description`, values),
  };
}

/**
 * "Citation · Lost": the signal's category and what happened, as the signals
 * list's Type column reads. `tCategories` is actionCenter.signalCategories,
 * `t` actionCenter.signalsPage.
 */
export function signalTypeLabel(signal: Signal, tCategories: Translator, t: Translator): string {
  return `${tCategories(signal.category)} · ${t(`states.${SIGNAL_KINDS[signal.kind].stateKey}`)}`;
}

/** What the Affected column shows: a compact count label + optional detail. */
export function signalAffected(
  signal: Signal,
  t: Translator,
): { label: string; detail: string | null } {
  const p = signal.payload;
  if (isLibrarySignalKind(signal.kind)) {
    // The count for a group, the thing itself for a single finding.
    const targets = Array.isArray(p.targets) ? (p.targets as Array<{ label?: string }>) : [];
    const entity = str(p, 'entity');
    const count = libraryTargetCount(signal, targets);
    if (targets.length === 1) {
      return { label: targetName(entity, targets[0]?.label ?? ''), detail: null };
    }
    return {
      label: entity ? t(`affected.${entity}`, { count }) : '',
      detail: targets[0]?.label ? targetName(entity, targets[0].label) : null,
    };
  }
  switch (signal.kind) {
    case 'sharp_drop':
    case 'visibility_slipping':
      return { label: t('affected.allPrompts'), detail: null };
    case 'platform_gap':
      return { label: t('affected.platform'), detail: platformName(str(p, 'platform')) };
    case 'competitor_citation_gap':
      return { label: t('affected.competitor'), detail: str(p, 'competitorName') };
    case 'prompt_gain':
    case 'lost_citations':
      return { label: t('affected.prompts', { count: 1 }), detail: str(p, 'promptText') };
    case 'new_engine':
      return { label: t('affected.platform'), detail: platformName(str(p, 'platform')) };
    case 'ai_platform_new':
      return { label: t('affected.platform'), detail: getPlatformName(str(p, 'aiSource')) };
    case 'first_citation':
      return { label: t('affected.urls', { count: 1 }), detail: str(p, 'label') || str(p, 'url') };
    case 'competitor_surge':
    case 'competitor_crossed':
    case 'competitor_overtaken':
      return { label: t('affected.competitor'), detail: str(p, 'competitorName') };
    case 'page_opportunity':
      return { label: t('affected.urls', { count: 1 }), detail: str(p, 'landingPage') };
    case 'uncited_mentions': {
      const count = Array.isArray(p.promptIds) ? p.promptIds.length : (signal.currentValue ?? 0);
      return { label: t('affected.prompts', { count: Number(count) }), detail: null };
    }
    case 'audit_low_score': {
      const urls = Array.isArray(p.urls) ? (p.urls as { url?: string }[]) : [];
      return {
        label: t('affected.urls', { count: Number(signal.currentValue ?? urls.length) }),
        detail: urls[0]?.url ?? null,
      };
    }
  }
}

/**
 * A signal the engine closed because its subject moved to another kind — a
 * topic that went from slipping to dropped — reads "Changed", not "Resolved":
 * nothing was fixed, the finding became a different one.
 */
export function isSuperseded(signal: Pick<Signal, 'status' | 'payload'>): boolean {
  return signal.status === 'resolved' && typeof signal.payload?.supersededBy === 'string';
}
