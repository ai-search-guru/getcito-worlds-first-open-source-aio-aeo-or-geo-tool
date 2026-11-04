import supabaseAdmin from '../../config/supabase.js';
import { readAllRpcRows } from '../rpcPages.js';

/**
 * The report card's reads and writes (00472), with the service-role client:
 * the tables have no policies, and only this server reaches them.
 */

/** Postgres' code for a row a unique index refuses. */
const UNIQUE_VIOLATION = '23505';

const fail = (what, error) => {
  throw new Error(`report card ${what}: ${error.message}`);
};

/** The store, on `db`. Tests pass their own. */
export function reportCardStore(db = supabaseAdmin) {
  return {
    /** The company's latest card since `since` that isn't failed, or null. */
    async recentCard(domain, since) {
      const { data, error } = await db
        .from('report_cards')
        .select('id, status, created_at')
        .eq('domain', domain)
        .in('status', ['queued', 'running', 'ready'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) fail('read', error);
      return data?.[0] ?? null;
    },

    /**
     * Dollars spent by cards made since `since`, and how many are still to run.
     * Read in pages: PostgREST stops at 1000 rows whatever `limit` asks for,
     * and a month at the daily cap holds several thousand cards.
     */
    async spendSince(since) {
      const { data, error } = await readAllRpcRows('report_cards spend', (from, to) =>
        db
          .from('report_cards')
          .select('id, cost_usd, status')
          .gte('created_at', since.toISOString())
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (error) fail('spend', error);
      // A card written between two pages can repeat at the boundary: once each.
      const cards = new Map((data ?? []).map((row) => [row.id, row]));
      let spent = 0;
      let pending = 0;
      for (const row of cards.values()) {
        spent += Number(row.cost_usd) || 0;
        if (row.status === 'queued' || row.status === 'running') pending += 1;
      }
      return { spent, pending };
    },

    /** Cards set to start between `from` and `to`, failed ones too: they cost as they ran. */
    async cardsStarting(from, to) {
      const { count, error } = await db
        .from('report_cards')
        .select('id', { count: 'exact', head: true })
        .gte('run_after', from.toISOString())
        .lt('run_after', to.toISOString());
      if (error) fail('count', error);
      return count ?? 0;
    },

    /** The new card's id, or null when the company already has one being made (00472's index). */
    async insertCard(row) {
      const { data, error } = await db.from('report_cards').insert(row).select('id').single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) fail('insert', error);
      return data;
    },

    async insertRequest(row) {
      const { data, error } = await db
        .from('report_card_requests')
        .insert(row)
        .select('id')
        .single();
      if (error) fail('request insert', error);
      return data;
    },
  };
}
