import { generateText } from 'ai';
import {
  classifyProviderError,
  isKeyFailureClass,
  type KeyFailureClass,
} from '@/lib/agent/keyErrors';
import { AGENT_PROVIDER_OPTIONS, buildAgentModel, type AgentModelConfig } from '@/lib/agent/model';
import type { ActiveKeyRead } from '@/lib/agent/key';
import type { AiProvider } from '@/lib/agent/providers';
import { autoModels } from './engineModel';
import {
  markKeyChecked,
  markKeyFailing,
  markKeyWorking,
  resolveOwnKeyNotices,
  resumeOwnKeyAgents,
} from './keyHealth';

/**
 * Settings › AI Providers' Test (AGENT-OWN-KEY §5.2 item 7): one tiny call on
 * the key, with the model Chat calls first (Auto's reading model on an
 * Anthropic key, otherwise the key's own model), no retries. It costs well
 * under a cent on the workspace's key.
 *
 * - `working`: the provider answered.
 * - `failing`: a key class (refused, out of credit, a model it can't reach).
 * - `unknown`: the provider didn't answer, or refused the request itself:
 *   the key couldn't be checked now.
 */
export type KeyTestResult =
  | { outcome: 'working' }
  | { outcome: 'failing'; class: KeyFailureClass; status: number | null }
  | { outcome: 'unknown' };

/** How long the test waits for the provider. */
const TEST_TIMEOUT_MS = 20_000;

/** The most the test's answer may be: "OK" fits. */
const TEST_MAX_OUTPUT_TOKENS = 16;

export async function testOwnKey(config: AgentModelConfig): Promise<KeyTestResult> {
  const choice =
    config.provider === 'anthropic'
      ? autoModels(config.apiKey, 'own').pick('read')
      : { model: buildAgentModel(config), providerOptions: AGENT_PROVIDER_OPTIONS };
  try {
    await generateText({
      model: choice.model,
      prompt: 'Reply with OK.',
      maxOutputTokens: TEST_MAX_OUTPUT_TOKENS,
      providerOptions: choice.providerOptions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    return { outcome: 'working' };
  } catch (err) {
    const verdict = classifyProviderError(config.provider, err);
    if (isKeyFailureClass(verdict.class)) {
      return { outcome: 'failing', class: verdict.class, status: verdict.status };
    }
    return { outcome: 'unknown' };
  }
}

/** Tests a saved key as read: one that can't be decrypted fails `unreadable`, with no call. */
export async function testSavedKey(
  key: Exclude<ActiveKeyRead, { state: 'none' }>,
): Promise<KeyTestResult> {
  if (key.state === 'unreadable') return { outcome: 'failing', class: 'unreadable', status: null };
  return testOwnKey(key.config);
}

/**
 * What a test means for saving or switching to the key (AGENT-OWN-KEY §11
 * Q8): refused, a model it can't reach, or a key that can't be read isn't
 * taken (`refused`); out of credit is taken with a warning (`no_credit`);
 * a provider that didn't answer takes it unchecked.
 */
export function keyCheckOf(
  result: KeyTestResult,
): 'working' | 'no_credit' | 'unchecked' | 'refused' {
  if (result.outcome === 'working') return 'working';
  if (result.outcome === 'unknown') return 'unchecked';
  return result.class === 'no_credit' ? 'no_credit' : 'refused';
}

/**
 * Keeps what a test of a saved key found (00440): when it was checked; a key
 * class marks it failing; a working key clears its failure and, when Chat
 * uses it, the agents paused for the key start again (AGENT-OWN-KEY §5.4).
 * A key just saved starts unchecked (00440's trigger), so its agents are
 * resumed here rather than through the cleared failure. `unknown` keeps
 * nothing. The number of agents resumed.
 */
export async function keepKeyCheck(
  organizationId: string,
  provider: AiProvider,
  result: KeyTestResult,
  { active, now = new Date() }: { active: boolean; now?: Date },
): Promise<number> {
  if (result.outcome === 'unknown') return 0;
  await markKeyChecked(organizationId, provider, now);
  if (result.outcome === 'failing') {
    await markKeyFailing(organizationId, provider, result, now);
    return 0;
  }
  await markKeyWorking(organizationId, provider, now, { resume: false });
  // Its notices close whether or not a failure was still marked: a key saved
  // again has none (00440's trigger cleared it), and its notices stayed open.
  await resolveOwnKeyNotices(organizationId, provider, now).catch((err) =>
    console.error("[chat/key] could not close the AI key's notices:", err),
  );
  return active ? resumeOwnKeyAgents(organizationId, now) : 0;
}
