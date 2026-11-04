/**
 * GET /api/v1/visibility-trend
 *
 * Canonical public path — see `whoami/route.ts` for the `/api/v1` ↔
 * `/api/mcp` relationship. Daily/weekly visibility buckets, ready to plot
 * against GA4 / Search Console time series in an external dashboard.
 */
export { GET } from '@/app/api/mcp/visibility-trend/route';
