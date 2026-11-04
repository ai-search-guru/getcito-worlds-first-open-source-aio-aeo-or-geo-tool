/**
 * How long each MCP read takes for one brand (MCP plan A1): every tool the
 * server marks read-only (readOnlyHint), timed over the Streamable HTTP
 * endpoint as a client calls it, slowest first, against a limit (10 s by
 * default). Writes are never called.
 *
 * Run from frontend/, with an API key of the brand's organization:
 *   GETCITO_API_KEY=getcito_... node scripts/mcp-read-timings.mjs \
 *     --url https://<host>/api/mcp --brand <brand_id> [--runs 2] [--limit-ms 10000]
 *
 * A tool that needs another id (a report, an audit, a draft…) gets the first
 * one its list_ tool returns; one that can't be given its inputs is skipped
 * and said so. Only names, times and response sizes are printed, never what
 * the tools return. Exits 1 when a read's slowest run is over the limit.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const KEY = process.env.GETCITO_API_KEY;
const URL_ARG = flag('url');
const BRAND = flag('brand');
const RUNS = Math.max(1, Number.parseInt(flag('runs', '2'), 10) || 2);
const LIMIT_MS = Math.max(1, Number.parseInt(flag('limit-ms', '10000'), 10) || 10000);
if (!KEY || !URL_ARG || !BRAND) {
  console.error(
    'Usage: GETCITO_API_KEY=getcito_... node scripts/mcp-read-timings.mjs --url https://<host>/api/mcp --brand <brand_id> [--runs 2] [--limit-ms 10000]',
  );
  process.exit(1);
}

/** The list_ tool, and its input, whose first row's id a get_ tool reads by. */
const ID_FROM = {
  get_report: ['list_reports', 'report_id'],
  get_content_opportunity: ['list_content_opportunities', 'opportunity_id'],
  get_site_audit: ['list_site_audits', 'audit_id'],
  get_action: ['list_actions', 'action_id'],
  get_mention: ['list_mentions', 'id'],
  get_content_draft: ['list_content_drafts', 'draft_id'],
  get_content_impact: ['list_content_drafts', 'draft_id'],
  get_content_sources: ['list_content_drafts', 'draft_id'],
  get_product_ai_says: ['list_catalog_products', 'product_id'],
};

/** The first `id` in a tool's JSON answer, however it nests its rows. */
function firstId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = firstId(item);
      if (id) return id;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    if (typeof value.id === 'string') return value.id;
    for (const child of Object.values(value)) {
      const id = firstId(child);
      if (id) return id;
    }
  }
  return null;
}

const text = (result) => (result.content ?? []).map((part) => part.text ?? '').join('');

async function connect() {
  const client = new Client({ name: 'getcito-read-timings', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_ARG), {
      requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
    }),
  );
  return client;
}

async function timed(client, name, args) {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120_000,
  });
  return { ms: performance.now() - started, result };
}

const client = await connect();
const { tools } = await client.listTools();
// Reads only: read-only by the server's own annotations, and named as one.
const reads = tools.filter(
  (tool) => tool.annotations?.readOnlyHint === true && /^(list|get)_/.test(tool.name),
);
const firstIds = new Map();
const rows = [];

for (const tool of reads) {
  const required = tool.inputSchema?.required ?? [];
  const args = {};
  if (required.includes('brand_id') || tool.inputSchema?.properties?.brand_id) {
    args.brand_id = BRAND;
  }
  const from = ID_FROM[tool.name];
  if (from) {
    const [list, input] = from;
    if (!firstIds.has(list)) {
      const listed = await client.callTool({ name: list, arguments: { brand_id: BRAND } });
      let id = null;
      try {
        id = listed.isError ? null : firstId(JSON.parse(text(listed)));
      } catch {
        id = null;
      }
      firstIds.set(list, id);
    }
    const id = firstIds.get(list);
    if (!id) {
      rows.push({ name: tool.name, skipped: `no row in ${list}` });
      continue;
    }
    args[input] = id;
  }
  const missing = required.filter((input) => !(input in args));
  if (missing.length) {
    rows.push({ name: tool.name, skipped: `needs ${missing.join(', ')}` });
    continue;
  }

  const runs = [];
  let error = null;
  let bytes = 0;
  for (let run = 0; run < RUNS; run++) {
    try {
      const { ms, result } = await timed(client, tool.name, args);
      runs.push(ms);
      bytes = text(result).length;
      if (result.isError) error = text(result).slice(0, 80);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 80) : 'failed';
      break;
    }
  }
  rows.push({ name: tool.name, runs, bytes, error });
}
await client.close();

const slowest = (row) => (row.runs?.length ? Math.max(...row.runs) : -1);
rows.sort((a, b) => slowest(b) - slowest(a));
const over = rows.filter((row) => slowest(row) > LIMIT_MS);

console.log(`MCP reads for one brand, ${RUNS} run(s) each, limit ${LIMIT_MS} ms\n`);
console.log(`${'tool'.padEnd(32)} ${'slowest'.padStart(9)} ${'runs (ms)'.padEnd(22)} size`);
for (const row of rows) {
  if (row.skipped) {
    console.log(`${row.name.padEnd(32)} ${'-'.padStart(9)} skipped: ${row.skipped}`);
    continue;
  }
  const mark = slowest(row) > LIMIT_MS ? '  OVER' : '';
  const runs = row.runs.map((ms) => Math.round(ms)).join(' / ');
  const size = `${(row.bytes / 1024).toFixed(1)} KB`;
  const note = row.error ? `  error: ${row.error}` : '';
  console.log(
    `${row.name.padEnd(32)} ${`${Math.round(slowest(row))}`.padStart(9)} ${runs.padEnd(22)} ${size}${mark}${note}`,
  );
}
console.log(
  `\n${rows.filter((row) => !row.skipped).length} reads timed, ${rows.filter((row) => row.skipped).length} skipped, ${over.length} over ${LIMIT_MS} ms.`,
);
process.exit(over.length ? 1 : 0);
