// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/mcp/actions/{id}?format= (AC-005): the fields by default, the
 * Copy Data Markdown, or the Export CSV as a file Excel reads as UTF-8.
 */

const { exportActionFor, getActionFor } = vi.hoisted(() => ({
  exportActionFor: vi.fn(),
  getActionFor: vi.fn(),
}));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/data', () => ({ getActionFor }));
vi.mock('@/lib/mcp/actionExport', () => ({ exportActionFor }));

const { GET } = await import('./route');

const get = (query = '') =>
  GET(new Request(`http://localhost/api/mcp/actions/a1${query}`), {
    params: Promise.resolve({ id: 'a1' }),
  });

beforeEach(() => {
  exportActionFor.mockReset();
  getActionFor.mockReset();
});

describe('GET /api/mcp/actions/{id}', () => {
  it('returns the fields as JSON by default, as before', async () => {
    getActionFor.mockResolvedValue({ id: 'a1', action_no: 52 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'a1', action_no: 52 });
    expect(exportActionFor).not.toHaveBeenCalled();
  });

  it('returns the Markdown Copy Data writes', async () => {
    exportActionFor.mockResolvedValue({ body: '# Title (AC-52)\n', fileName: 'action-AC-52.md' });
    const res = await get('?format=markdown');
    expect(exportActionFor).toHaveBeenCalledWith(expect.anything(), 'a1', 'markdown');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await res.text()).toBe('# Title (AC-52)\n');
  });

  it('returns the CSV as a download, with the byte order mark Excel needs', async () => {
    exportActionFor.mockResolvedValue({ body: 'section,action\n', fileName: 'action-AC-52.csv' });
    const res = await get('?format=csv');
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="action-AC-52.csv"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('refuses a format it does not know, and says which it does', async () => {
    const res = await get('?format=xml');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('format must be one of json, markdown, csv');
  });

  it("says so when the action isn't the key's", async () => {
    exportActionFor.mockResolvedValue(null);
    expect((await get('?format=csv')).status).toBe(404);
    getActionFor.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
});
