/**
 * GET /api/v1/brands
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Lists the brands in the caller's organization.
 */
export { GET } from '@/app/api/mcp/brands/route';
