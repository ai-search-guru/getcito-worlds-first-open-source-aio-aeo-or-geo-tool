/**
 * GET /api/v1/shopping-cards
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Cursor-paginated normalized shopping-card rows.
 */
export { GET } from '@/app/api/mcp/shopping-cards/route';
