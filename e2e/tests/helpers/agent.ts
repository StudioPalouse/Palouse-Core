import { expect, type Page } from '@playwright/test';

/**
 * Driving an agent the way a real MCP client does: mint an agent API key
 * through the REST surface, then call the MCP HTTP endpoint with it.
 *
 * This is the only way to produce agent-authored records. `POST /v1/tasks`
 * always attributes to `userActor` (apps/api/src/routes/tasks.ts), so origin
 * 'agent' cannot be set over REST at all; the MCP `create_task` tool is the
 * real path and is a plain HTTP call, no browser involved.
 */

const mcpUrl = process.env.MCP_HTTP_URL ?? 'http://localhost:7777/mcp';

/**
 * Unsafe cookie-authenticated calls must carry an Origin matching the web app.
 * That is a CSRF guard, not an oversight: a cross-site fetch would otherwise
 * reach the handler with the user's session cookie attached
 * (apps/api/src/middleware/request-guards.ts). Browsers set this header
 * themselves, so a non-browser caller has to supply it, as docs/deployment.md
 * says.
 */
const origin = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const asBrowser = { origin, 'content-type': 'application/json' };

export interface AgentCredentials {
  agentId: string;
  agentName: string;
  apiKey: string;
}

/**
 * Creates an agent in the workspace and mints a full-access key for it. The
 * plaintext key is returned by the API exactly once, on creation.
 */
export async function createAgentWithKey(
  page: Page,
  workspaceId: string,
  name: string,
): Promise<AgentCredentials> {
  const agentRes = await page.request.post('/v1/agents', {
    headers: asBrowser,
    data: { workspaceId, name, kind: 'mcp_generic' },
  });
  expect(
    agentRes.ok(),
    `POST /v1/agents responded ${agentRes.status()}: ${await agentRes.text()}`,
  ).toBeTruthy();
  const { agent } = (await agentRes.json()) as { agent: { id: string; name: string } };

  const keyRes = await page.request.post(`/v1/agents/${agent.id}/keys`, {
    headers: asBrowser,
    data: { workspaceId },
  });
  expect(
    keyRes.ok(),
    `POST /v1/agents/:id/keys responded ${keyRes.status()}: ${await keyRes.text()}`,
  ).toBeTruthy();
  const { plaintext } = (await keyRes.json()) as { plaintext: string };

  return { agentId: agent.id, agentName: agent.name, apiKey: plaintext };
}

/**
 * Calls one MCP tool and returns its decoded payload.
 *
 * The transport is stateless (a fresh server and transport per request, see
 * apps/mcp/src/index.ts), so a bare tools/call needs no initialize handshake.
 * Responses come back as either JSON or a single SSE frame depending on what
 * the client accepts, and tool results are JSON encoded inside a text content
 * block, so both layers are unwrapped here.
 */
export async function callTool<T = unknown>(
  apiKey: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  const raw = await res.text();
  expect(res.ok, `MCP ${name} responded ${res.status}: ${raw.slice(0, 300)}`).toBeTruthy();

  const frame = raw.startsWith('event:')
    ? raw.slice(raw.indexOf('data: ') + 'data: '.length).split('\n')[0]!
    : raw;
  const message = JSON.parse(frame) as {
    error?: { message: string };
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };

  expect(message.error, `MCP ${name} returned an error: ${message.error?.message}`).toBeUndefined();
  const text = message.result?.content?.[0]?.text ?? '';
  // Tool-level failures come back as a plain string, not JSON, so surface the
  // message rather than a parse error.
  expect(message.result?.isError, `MCP ${name} failed: ${text}`).toBeFalsy();
  return JSON.parse(text) as T;
}
