import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from './server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const scoped = new AsyncLocalStorage<ServerClient>();

/**
 * The Supabase client a data loader should query with: the caller's own
 * (RLS-scoped) client, unless withDbClient put another one in scope for the
 * current call chain.
 */
export async function dbClient(): Promise<ServerClient> {
  return scoped.getStore() ?? (await createClient());
}

/**
 * Run `fn` with every dbClient() call inside it answering `client`.
 *
 * Only for callers that have already established what the caller may see:
 * a service-role client skips RLS, so the loaders run under it must scope
 * every read themselves (by brand) — and the brand must already be checked.
 */
export function withDbClient<T>(client: ServerClient, fn: () => Promise<T>): Promise<T> {
  return scoped.run(client, fn);
}
