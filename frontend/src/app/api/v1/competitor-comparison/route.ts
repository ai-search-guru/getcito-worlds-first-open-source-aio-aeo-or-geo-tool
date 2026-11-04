/**
 * GET /api/v1/competitor-comparison
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Competitor benchmark + share of voice for a
 * brand and date window.
 */
export { GET } from '@/app/api/mcp/competitor-comparison/route';
