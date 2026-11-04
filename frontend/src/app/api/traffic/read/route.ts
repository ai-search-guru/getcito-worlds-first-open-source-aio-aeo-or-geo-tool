import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  getTrafficBots,
  getTrafficConversions,
  getTrafficGooglePages,
  getTrafficGoogleTotals,
  getTrafficGoogleTrend,
  getTrafficLogs,
  getTrafficPages,
  getTrafficSources,
  getTrafficSummary,
  getTrafficTrend,
  getUntrackedGoogleQueries,
} from '@/lib/actions/traffic';
import { getBotConnections } from '@/lib/actions/aiBots';
import { TRAFFIC_READS, type TrafficRead } from '@/lib/trafficReads';

/**
 * POST /api/traffic/read — one of the AI Traffic page's reads, by name, with
 * the server action's own arguments (lib/trafficReads.ts). A route because
 * the browser runs fetches side by side, where Next runs a page's server
 * actions one at a time.
 *
 * Reads through the signed-in member's session, as the actions do, so RLS
 * and the reports' organization checks decide whose brand this is.
 */

export const runtime = 'nodejs';

// Every read takes the brand first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const READS: Record<TrafficRead, (brandId: string, ...rest: any[]) => Promise<unknown>> = {
  sources: getTrafficSources,
  summary: getTrafficSummary,
  trend: getTrafficTrend,
  logs: getTrafficLogs,
  pages: getTrafficPages,
  conversions: getTrafficConversions,
  googleTotals: getTrafficGoogleTotals,
  googleTrend: getTrafficGoogleTrend,
  googlePages: getTrafficGooglePages,
  untrackedQueries: getUntrackedGoogleQueries,
  bots: getTrafficBots,
  botConnections: getBotConnections,
};

const body = z.object({
  read: z.enum(TRAFFIC_READS),
  args: z
    .tuple([z.guid()])
    .rest(z.unknown())
    .refine((args) => args.length <= 4),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [brandId, ...rest] = parsed.data.args;
  // JSON has no undefined: an argument left out arrives as null.
  const args = rest.map((arg) => (arg === null ? undefined : arg));
  try {
    const data = await READS[parsed.data.read](brandId, ...args);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // The sections show their own failed state; the details stay in the log.
    console.error(`[traffic/read] ${parsed.data.read} failed:`, err);
    return Response.json({ error: 'Failed to load' }, { status: 500 });
  }
}
