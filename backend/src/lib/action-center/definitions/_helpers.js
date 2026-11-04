/**
 * Payload building shared by the definition library.
 *
 * Not a definition — the registry skips files starting with an underscore.
 *
 * Every action names its targets: the prompts, pages, sources, queries,
 * topics, platforms or competitors it is about. The specification is plain
 * about titles: "Recover 7 lost citations", not "Recover citations". So every
 * payload carries `targetEntity`, `targetCount` and a bounded `targets` list,
 * collected from the signals that triggered it and snapshotted at creation.
 *
 * Library detectors put targets on their signals directly. The original ones
 * predate that, so their targets are read off the fields they do carry.
 */

import { targetKeys } from '../../targetIds.js';

function legacyTargets(signal) {
  const p = signal.payload ?? {};
  if (Array.isArray(p.targets)) return p.targets;
  if (p.promptId) return [{ id: p.promptId, label: p.promptText ?? '' }];
  if (p.competitorName)
    return [{ id: p.competitorId ?? p.competitorName, label: p.competitorName }];
  if (p.landingPage) return [{ id: p.landingPage, label: p.landingPage }];
  // Site Audit's low scores carry { url, score }; older signals plain addresses.
  if (Array.isArray(p.urls)) {
    return p.urls
      .map((entry) => (typeof entry === 'string' ? entry : entry?.url))
      .filter(Boolean)
      .map((url) => ({ id: url, label: url }));
  }
  if (p.platform) return [{ id: p.platform, label: p.platform }];
  return [];
}

/** A target's key: its id, or its label where it has none. */
export function targetKey(target) {
  return String(target.id ?? target.label ?? '');
}

/**
 * Every target across the matched signals, once each: the ones the signals
 * name first, with their labels, then those a bigger group lists only by id
 * (`targetIds`, AC-009), so the count is the whole group's.
 */
export function collectTargets(byKind) {
  const seen = new Map();
  const signals = [...byKind.values()].flat();
  for (const signal of signals) {
    for (const target of legacyTargets(signal)) {
      const key = targetKey(target);
      if (key && !seen.has(key)) seen.set(key, target);
    }
  }
  for (const signal of signals) {
    const ids = signal.payload?.targetIds;
    for (const id of Array.isArray(ids) ? ids : []) {
      const key = String(id ?? '');
      if (key && !seen.has(key)) seen.set(key, { id: key });
    }
  }
  return [...seen.values()];
}

/**
 * The target half of every payload.
 *
 * `contentExists` tells the planner which branch of an `optimise | create`
 * plan to take: prompt targets carry whether a page is mapped to them or has
 * ever been cited. Where nothing says, it is left undefined and the planner
 * optimises what exists — the conservative choice, since creating a page
 * that duplicates one is worse than improving it.
 */
export function targetPayload(byKind, entity, extra = {}) {
  const targets = collectTargets(byKind);
  const mapped = targets.filter((t) => typeof t.mapped === 'boolean');
  // The ones a signal named, to show; every target's key once there are more
  // (AC-009: the action keeps the whole list it counts, in action_entities).
  const named = targets.filter((t) => t.label !== undefined || Object.keys(t).length > 1);
  // The count is the list's, as the action keeps it (targetKeys): signals
  // each capped at MAX_TARGET_IDS can add up past it.
  const keys = targetKeys(targets.map(targetKey));
  const shown = named.slice(0, 50);
  // Listed whenever the names shown aren't exactly those keys: more of them,
  // or names whose keys the action keeps otherwise (trimmed, once).
  const shownKeys = shown.map(targetKey);
  const listed = keys.length !== shownKeys.length || keys.some((k, i) => k !== shownKeys[i]);
  return {
    targetEntity: entity,
    targetCount: keys.length,
    targets: shown,
    ...(listed ? { targetIds: keys } : {}),
    ...(mapped.length > 0 ? { contentExists: mapped.some((t) => t.mapped) } : {}),
    ...extra,
  };
}

/** The first matched signal, for payload fields that describe the whole
 *  condition rather than one target. */
export function first(byKind, kind) {
  return (byKind.get(kind) ?? [])[0] ?? null;
}

/** Competitor names across the matched signals, up to three. */
export function competitorNames(byKind) {
  const names = new Set();
  for (const signals of byKind.values()) {
    for (const signal of signals) {
      const name = signal.payload?.competitorName;
      if (name) names.add(name);
    }
  }
  return [...names].slice(0, 3);
}
