/**
 * GET /api/v1/whoami
 *
 * Canonical public path for the key-introspection endpoint. `/api/v1/*` is
 * the versioned Public Metrics API surface (Looker Studio, Sheets, custom
 * dashboards); the handlers live under `/api/mcp/*` where they were first
 * built for the MCP server's parallel REST surface, and both paths serve
 * identical responses with the same `getcito_` API-key auth.
 */
export { GET } from '@/app/api/mcp/whoami/route';
