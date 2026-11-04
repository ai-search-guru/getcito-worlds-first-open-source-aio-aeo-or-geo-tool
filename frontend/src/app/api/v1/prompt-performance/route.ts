/**
 * GET /api/v1/prompt-performance
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Per-prompt visibility/mention/citation
 * aggregates, sortable and limitable.
 */
export { GET } from '@/app/api/mcp/prompt-performance/route';
