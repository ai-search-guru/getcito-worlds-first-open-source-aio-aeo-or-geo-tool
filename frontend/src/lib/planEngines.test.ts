import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';
import { getActiveEngineIdsForPlan } from './planEngines';

// This module also exports the Supabase-backed alignPromptsToPlanForOrg, so
// importing it pulls in the service-role client — which throws at import time
// when NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset, as they
// are in CI. Only the pure gating helper is under test, so a stub is enough.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const ALL_SCRAPER_IDS = ALL_SCRAPERS.map((s) => s.id);
const ALL_MODEL_IDS = ALL_MODELS.map((m) => m.id);

const STARTER_SCRAPER_IDS = ['chatgpt-web', 'copilot-web'];

/**
 * getPlan() short-circuits to the self-hosted plan unless the instance is
 * cloud, so every cloud expectation has to set the flag the helper reads.
 */
function useCloud(isCloud: boolean) {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', isCloud ? 'true' : 'false');
}

describe('getActiveEngineIdsForPlan', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * The rule under test (#800): an absent `allowedScrapers` / `allowedModels`
   * means every engine is allowed, while an array — even an empty one — means
   * only the listed ids are.
   */
  it('gives Starter only the scrapers it lists and no API models', () => {
    useCloud(true);

    expect(getActiveEngineIdsForPlan('starter')).toEqual({
      platforms: STARTER_SCRAPER_IDS,
      models: [],
    });
  });

  it('gives Growth every scraper but still no API models', () => {
    useCloud(true);

    expect(getActiveEngineIdsForPlan('growth')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: [],
    });
  });

  it('leaves Enterprise API models to plan_overrides', () => {
    useCloud(true);

    // alignPromptsToPlanForOrg layers organizations.plan_overrides.allowedModels
    // on top of this, so the plan-level answer stays "no models".
    expect(getActiveEngineIdsForPlan('enterprise')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: [],
    });
  });

  it('gives Self-Hosted every scraper and every model', () => {
    useCloud(true);

    expect(getActiveEngineIdsForPlan('self_hosted')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: ALL_MODEL_IDS,
    });
  });

  it('falls back to Starter for a missing, empty or unknown plan id', () => {
    useCloud(true);

    for (const planId of [undefined, null, '', 'not-a-plan']) {
      expect(getActiveEngineIdsForPlan(planId)).toEqual({
        platforms: STARTER_SCRAPER_IDS,
        models: [],
      });
    }
  });

  it('ignores the plan id on a self-hosted instance', () => {
    useCloud(false);

    // isCloud() is false, so getPlan() returns the self-hosted plan whatever
    // the caller asked for — even a Starter org gets every engine.
    expect(getActiveEngineIdsForPlan('starter')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: ALL_MODEL_IDS,
    });
  });

  it('defaults to self-hosted when NEXT_PUBLIC_IS_CLOUD is unset', () => {
    vi.unstubAllEnvs();

    expect(getActiveEngineIdsForPlan('starter')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: ALL_MODEL_IDS,
    });
  });

  it('returns fresh arrays so callers cannot mutate the plan config', () => {
    useCloud(true);

    const first = getActiveEngineIdsForPlan('growth');
    first.platforms.push('mutated');
    first.models.push('mutated');

    expect(getActiveEngineIdsForPlan('growth')).toEqual({
      platforms: ALL_SCRAPER_IDS,
      models: [],
    });
  });
});
