import {
  connectorFetch,
  type ConnectorAdapter,
  type NormalizedExternalTask,
  type OAuthTokenSet,
  type PullContext,
  type PullResult,
  type PushPayload,
  type RefreshedTokens,
} from '@palouse/connector-core';

export const PROVIDER = 'todoist' as const;

const AUTH_URL = 'https://app.todoist.com/oauth/authorize';
const TOKEN_URL = 'https://api.todoist.com/oauth/access_token';
// Overridable so tests/local smoke runs can target a fake server.
const API = process.env.PALOUSE_TODOIST_API_BASE ?? 'https://api.todoist.com/api/v1';
const SCOPES = ['data:read_write'];

interface TodoistItem {
  id: string;
  content?: string;
  description?: string;
  checked?: boolean;
  is_deleted?: boolean;
  due?: { date?: string } | null;
  updated_at?: string;
}

interface TodoistSyncResponse {
  sync_token: string;
  full_sync?: boolean;
  items?: TodoistItem[];
  user?: { id?: string | number; email?: string; full_name?: string };
}

async function syncRequest(
  accessToken: string,
  syncToken: string,
  resourceTypes: string[],
): Promise<TodoistSyncResponse> {
  const res = await connectorFetch(`${API}/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sync_token: syncToken, resource_types: resourceTypes }),
  });
  return (await res.json()) as TodoistSyncResponse;
}

function normalize(item: TodoistItem): NormalizedExternalTask {
  return {
    externalSystem: 'todoist',
    externalId: item.id,
    externalUrl: `https://app.todoist.com/app/task/${item.id}`,
    externalUpdatedAt: item.updated_at,
    title: item.content?.trim() || '(untitled)',
    descriptionMd: item.description || undefined,
    status: item.checked ? 'done' : 'open',
    dueAt: item.due?.date ?? undefined,
  };
}

export const todoistAdapter: ConnectorAdapter = {
  system: 'todoist',
  // Todoist has webhooks, but they are app-wide and configured in the app
  // console; the first slice polls via the incremental sync token instead.
  pollOnly: true,

  buildAuthUrl({ config, redirectUri, state }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', config.clientId);
    u.searchParams.set('scope', SCOPES.join(','));
    u.searchParams.set('state', state);
    u.searchParams.set('redirect_uri', redirectUri);
    return u.toString();
  },

  async exchangeCode({ config, redirectUri, code }): Promise<OAuthTokenSet> {
    const res = await connectorFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    // The token response carries no identity; a one-off user sync supplies the
    // account label shown on the connection row.
    let externalAccountId: string | undefined;
    let accountLabel = 'Todoist account';
    try {
      const { user } = await syncRequest(body.access_token, '*', ['user']);
      if (user?.id !== undefined) externalAccountId = String(user.id);
      accountLabel = user?.email ?? user?.full_name ?? accountLabel;
    } catch {
      // Label stays generic; the connection still works.
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      // Legacy Todoist apps issue non-expiring tokens (no expires_in), so
      // expiresAt stays unset and the worker never tries to refresh.
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
      scopes: body.scope?.split(',') ?? SCOPES,
      externalAccountId,
      accountLabel,
    };
  },

  async refreshTokens({ config, refreshToken }): Promise<RefreshedTokens> {
    const res = await connectorFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  },

  async pull(ctx: PullContext): Promise<PullResult> {
    // The sync token doubles as the incremental cursor: '*' returns all active
    // items, and later calls return only items changed since (including ones
    // completed or deleted in the meantime).
    const body = await syncRequest(ctx.accessToken, ctx.cursor ?? '*', ['items']);
    const tasks: NormalizedExternalTask[] = [];
    for (const item of body.items ?? []) {
      if (item.is_deleted) continue;
      tasks.push(normalize(item));
    }
    return { tasks, nextCursor: body.sync_token };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    const headers = {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    };
    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.content = payload.title;
    if (payload.descriptionMd !== undefined) body.description = payload.descriptionMd ?? '';
    if (payload.dueAt !== undefined) {
      // 'no date' is Todoist's documented sentinel for clearing the due date.
      if (payload.dueAt === null) body.due_string = 'no date';
      else body.due_datetime = payload.dueAt;
    }
    if (Object.keys(body).length > 0) {
      await connectorFetch(`${API}/tasks/${payload.externalId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    }
    if (payload.status !== undefined) {
      const action = payload.status === 'done' ? 'close' : 'reopen';
      await connectorFetch(`${API}/tasks/${payload.externalId}/${action}`, {
        method: 'POST',
        headers,
      });
    }
  },
};
