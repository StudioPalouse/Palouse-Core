import {
  connectorFetch,
  type ConnectorAdapter,
  type NormalizedExternalTask,
  type OAuthTokenSet,
  type PullContext,
  type PullResult,
  type PushPayload,
  type RefreshedTokens,
  type WebhookSubscription,
} from '@palouse/connector-core';

export const PROVIDER = 'asana' as const;

const AUTH_URL = 'https://app.asana.com/-/oauth_authorize';
const TOKEN_URL = 'https://app.asana.com/-/oauth_token';
// Overridable so tests/local smoke runs can target a fake Asana server.
const API = process.env.PALOUSE_ASANA_API_BASE ?? 'https://app.asana.com/api/1.0';
const OPT_FIELDS = 'name,notes,completed,due_on,due_at,modified_at,permalink_url';

interface AsanaTask {
  gid: string;
  name?: string;
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  modified_at?: string;
  permalink_url?: string;
}

function normalize(t: AsanaTask): NormalizedExternalTask {
  return {
    externalSystem: 'asana',
    externalId: t.gid,
    externalUrl: t.permalink_url,
    externalUpdatedAt: t.modified_at,
    title: t.name?.trim() || '(untitled)',
    descriptionMd: t.notes,
    status: t.completed ? 'done' : 'open',
    dueAt: t.due_at ?? (t.due_on ? `${t.due_on}T00:00:00Z` : undefined),
  };
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await connectorFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return (await res.json()) as T;
}

export const asanaAdapter: ConnectorAdapter = {
  system: 'asana',
  pollOnly: false,

  buildAuthUrl({ config, redirectUri, state }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', config.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  },

  async exchangeCode({ config, redirectUri, code }): Promise<OAuthTokenSet> {
    const res = await connectorFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      data?: { id?: string | number; email?: string; name?: string };
    };
    const label = body.data?.email ?? body.data?.name ?? 'Asana account';
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
      scopes: ['default'],
      externalAccountId: body.data?.id != null ? String(body.data.id) : undefined,
      accountLabel: label,
    };
  },

  async refreshTokens({ config, refreshToken }): Promise<RefreshedTokens> {
    const res = await connectorFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
      }),
    });
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: body.access_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  },

  /** Pulls tasks assigned to the connected user across their Asana workspaces. */
  async pull(ctx: PullContext): Promise<PullResult> {
    const { data: workspaces } = await getJson<{ data: { gid: string }[] }>(
      `${API}/workspaces`,
      ctx.accessToken,
    );

    const tasks: NormalizedExternalTask[] = [];
    let maxModified = ctx.cursor;

    for (const ws of workspaces) {
      let offset: string | undefined;
      do {
        const u = new URL(`${API}/tasks`);
        u.searchParams.set('assignee', 'me');
        u.searchParams.set('workspace', ws.gid);
        u.searchParams.set('opt_fields', OPT_FIELDS);
        u.searchParams.set('limit', '100');
        if (ctx.cursor) u.searchParams.set('modified_since', ctx.cursor);
        if (offset) u.searchParams.set('offset', offset);

        const page = await getJson<{ data: AsanaTask[]; next_page?: { offset: string } | null }>(
          u.toString(),
          ctx.accessToken,
        );
        for (const t of page.data) {
          tasks.push(normalize(t));
          if (t.modified_at && (!maxModified || t.modified_at > maxModified)) {
            maxModified = t.modified_at;
          }
        }
        offset = page.next_page?.offset;
      } while (offset);
    }
    return { tasks, nextCursor: maxModified };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    const data: Record<string, unknown> = {};
    if (payload.title !== undefined) data.name = payload.title;
    if (payload.descriptionMd !== undefined) data.notes = payload.descriptionMd ?? '';
    if (payload.status !== undefined) data.completed = payload.status === 'done';
    if (payload.dueAt !== undefined) data.due_at = payload.dueAt;
    await connectorFetch(`${API}/tasks/${payload.externalId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });
  },

  /**
   * Subscribes to the connected user's "My Tasks" list in their first workspace.
   * The X-Hook-Secret handshake is completed by the webhook receiver route.
   */
  async subscribeWebhook(ctx: PullContext, callbackUrl: string): Promise<WebhookSubscription> {
    const { data: workspaces } = await getJson<{ data: { gid: string }[] }>(
      `${API}/workspaces`,
      ctx.accessToken,
    );
    const first = workspaces[0];
    if (!first) throw new Error('Asana account has no workspaces');

    const { data: utl } = await getJson<{ data: { gid: string } }>(
      `${API}/users/me/user_task_list?workspace=${first.gid}`,
      ctx.accessToken,
    );

    const res = await connectorFetch(`${API}/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { resource: utl.gid, target: callbackUrl } }),
    });
    const body = (await res.json()) as { data: { gid: string } };
    return { subscriptionId: body.data.gid };
  },
};
