/**
 * GET /api/v1/visibility-summary
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Overall visibility KPIs + top competitors for a
 * brand and date window.
 */
export { GET } from '@/app/api/mcp/visibility-summary/route';
