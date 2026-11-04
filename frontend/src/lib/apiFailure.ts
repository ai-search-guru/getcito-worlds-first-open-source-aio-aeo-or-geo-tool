/**
 * Why a call to the API failed, read from its status and body (BUG-001), so a
 * toast or an MCP client can say it in plain words with one thing to do. A
 * bare "Unauthorized" read as a session problem when the brand was another
 * workspace's: 401 is a bad or expired session only.
 */
export const API_FAILURES = [
  'session',
  'workspace',
  'not_found',
  'plan',
  'subscription',
  'limit',
  'busy',
  'failed',
] as const;
export type ApiFailure = (typeof API_FAILURES)[number];

/** The server's refusals of a brand the person can't reach. */
const WORKSPACE_CODES = new Set(['not_in_workspace', 'no_brand_access']);

/**
 * Read from the server's own codes, not the status alone: a 403 is another
 * workspace's brand only when the server says so, and a 429 is a used-up
 * allowance only with quota_exhausted or plan_limit. Anything not
 * recognised is a plain failure rather than a wrong reason with a wrong
 * thing to do.
 */
export function apiFailure(status: number, body: Record<string, unknown> = {}): ApiFailure {
  if (status === 401) return 'session';
  // The workspace's plan isn't active (a trial that ended, a canceled plan):
  // the server's 402 for any change while it is read-only. The upgrade
  // dialog, not a toast. Likewise for the demo brand, whose sample data
  // nothing runs on (demo_brand): the dialog with the demo's offer.
  if (body.code === 'subscription_inactive' || body.code === 'demo_brand') return 'subscription';
  if (body.error === 'quota_exhausted') return 'limit';
  // A monthly budget used up: plan-guard's PlanLimitError answers 429 with plan_limit.
  if (status === 429 && body.error === 'plan_limit') return 'limit';
  // The rate limiter, whose body carries a message and no error: wait a minute, not upgrade.
  if (status === 429 && body.error === undefined) return 'busy';
  // A missing subscription (402), or a plan without the feature: requireFeature's
  // 403 with plan_limit. Not plan-guard's 400 for an account with no organization.
  if (status === 402 || (status === 403 && body.error === 'plan_limit')) return 'plan';
  // The server's code since BUG-001; its bare "Unauthorized" 403 before then.
  // A brand of the workspace the person wasn't given (Selected brands,
  // no_brand_access) reads the same: as for another workspace's brand, the
  // thing to do is switch to one of your brands.
  if (WORKSPACE_CODES.has(String(body.code)) || (status === 403 && body.error === 'Unauthorized')) {
    return 'workspace';
  }
  if (status === 404) return 'not_found';
  return 'failed';
}

/** The refusals that open the upgrade dialog: a read-only workspace, and the demo brand. */
const UPGRADE_CODES = new Set(['subscription_inactive', 'demo_brand']);

/**
 * A read's failure, returned rather than thrown: Next.js hides a server
 * action's thrown message in production, so the card showed React's
 * "Minified React error #441" instead of what went wrong. `retryable` when
 * trying again may help: the API didn't answer (a dropped connection, the
 * read's timeout) or the proxy in front of it said it was down, as while it
 * restarts on a deploy.
 */
export interface ReadFailure {
  ok: false;
  failure: ApiFailure;
  retryable: boolean;
}

/** The proxy's answers while the API is down or restarting. */
export function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** The API didn't answer: a network error, or the read's timeout. */
export const NO_ANSWER: ReadFailure = { ok: false, failure: 'failed', retryable: true };

/** A response that isn't ok, as a ReadFailure. */
export async function responseFailure(res: Response): Promise<ReadFailure> {
  const body = await res.json().catch(() => ({}));
  return {
    ok: false,
    failure: apiFailure(res.status, body),
    retryable: isTransientStatus(res.status),
  };
}

/** How long a card waits before its one automatic retry. */
export const READ_RETRY_DELAY_MS = 1500;

/**
 * Runs `read`, and once more after `delayMs` when it failed in a way trying
 * again may fix. A server action that throws on its way (the request to
 * Next itself failed) is NO_ANSWER too. Called in the browser, so the wait
 * never holds Next's serialized server-action queue.
 */
export async function readWithOneRetry<R extends { ok: true } | ReadFailure>(
  read: () => Promise<R>,
  delayMs = READ_RETRY_DELAY_MS,
): Promise<R | ReadFailure> {
  const attempt = () => read().catch((): ReadFailure => NO_ANSWER);
  const first = await attempt();
  const result: { ok: true } | ReadFailure = first;
  if (result.ok || !result.retryable) return first;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return attempt();
}

/**
 * Whether a response body is the server's subscription_inactive (a read-only
 * workspace) or demo_brand (the demo brand, where nothing runs), also when
 * it comes as text: the AI SDK's chat transport throws an error whose
 * message is the response body. A server action refused by assertWritable
 * (lib/subscriptionGuard.ts) throws an error whose digest is the code, the
 * one thing production keeps of it. Either opens the upgrade dialog.
 */
export function isSubscriptionInactive(body: unknown): boolean {
  let value = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (typeof value !== 'object' || value === null) return false;
  const { code, digest } = value as { code?: unknown; digest?: unknown };
  return UPGRADE_CODES.has(String(code)) || UPGRADE_CODES.has(String(digest));
}
