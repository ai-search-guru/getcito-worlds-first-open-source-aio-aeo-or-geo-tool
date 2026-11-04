import { describe, expect, it } from 'vitest';
import { MCP_CLIENTS, mcpClientSnippet } from './clientSetup';

const URL_ = 'https://app.example.com/api/mcp';
const TOKEN = 'getcito_test123';

describe('mcpClientSnippet', () => {
  it.each(MCP_CLIENTS)('%s carries the endpoint and the bearer header', (client) => {
    const snippet = mcpClientSnippet(client, URL_, TOKEN);
    expect(snippet).toContain(URL_);
    expect(snippet).toContain(`Bearer ${TOKEN}`);
  });

  it.each(['cursor', 'vscode', 'windsurf', 'openclaw', 'zed'] as const)(
    '%s is valid JSON',
    (client) => {
      expect(() => JSON.parse(mcpClientSnippet(client, URL_, TOKEN))).not.toThrow();
    },
  );

  it('uses each client’s own key for the server map and URL', () => {
    const parse = (client: (typeof MCP_CLIENTS)[number]) =>
      JSON.parse(mcpClientSnippet(client, URL_, TOKEN));

    expect(parse('cursor').mcpServers.getcito.url).toBe(URL_);
    expect(parse('vscode').servers.getcito).toMatchObject({ type: 'http', url: URL_ });
    expect(parse('windsurf').mcpServers.getcito.serverUrl).toBe(URL_);
    expect(parse('openclaw').mcp.servers.getcito).toMatchObject({
      url: URL_,
      transport: 'streamable-http',
    });
    expect(parse('zed').context_servers.getcito.url).toBe(URL_);
  });
});
