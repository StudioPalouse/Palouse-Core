// MCP endpoint + client-config helpers, shared by the connect-agent dialog and
// the one-time key reveal.

// Baked at build time (fly/web*.toml build args). Empty in self-hosted builds
// that have not set NEXT_PUBLIC_MCP_URL; callers show a placeholder then.
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? '';
export const MCP_URL_PLACEHOLDER = 'https://your-palouse-host/mcp';
// Distinct client alias per environment, so connecting staging and prod side
// by side does not collide in the local MCP config.
export const MCP_ALIAS = MCP_URL.includes('mcp-test.') ? 'palouse-test' : 'palouse';

export function mcpEndpoint(): string {
  return MCP_URL || MCP_URL_PLACEHOLDER;
}

// OAuth sign-in connect: no key in the config. The client discovers the
// authorization server from the endpoint and runs the sign-in flow itself.
export function oauthConnectCommand(): string {
  return `claude mcp add --transport http ${MCP_ALIAS} ${mcpEndpoint()}`;
}

export function oauthHttpConfigSnippet(): string {
  return JSON.stringify(
    { mcpServers: { [MCP_ALIAS]: { type: 'http', url: mcpEndpoint() } } },
    null,
    2,
  );
}
