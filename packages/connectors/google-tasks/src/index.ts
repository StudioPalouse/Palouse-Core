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

export const PROVIDER = 'google_tasks' as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Overridable so tests/local smoke runs can target a fake server.
const API = process.env.PALOUSE_GOOGLE_TASKS_API_BASE ?? 'https://tasks.googleapis.com/tasks/v1';
const SCOPES = ['https://www.googleapis.com/auth/tasks', 'openid', 'email'];

interface GoogleTaskList {
  id: string;
  title: string;
}

interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  updated?: string;
  etag?: string;
  webViewLink?: string;
  deleted?: boolean;
}

function decodeJwtEmail(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.email === 'string' ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

function normalize(listId: string, t: GoogleTask): NormalizedExternalTask {
  return {
    externalSystem: 'google_tasks',
    // Google task ids are only unique within a list — key on both.
    externalId: `${listId}:${t.id}`,
    externalUrl: t.webViewLink,
    externalEtag: t.etag,
    externalUpdatedAt: t.updated,
    title: t.title?.trim() || '(untitled)',
    descriptionMd: t.notes,
    status: t.status === 'completed' ? 'done' : 'open',
    dueAt: t.due,
  };
}

async function listAll<T>(url: string, accessToken: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(url);
    u.searchParams.set('maxResults', '100');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const res = await connectorFetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { items?: T[]; nextPageToken?: string };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return items;
}

export const googleTasksAdapter: ConnectorAdapter = {
  system: 'google_tasks',
  pollOnly: true,

  buildAuthUrl({ config, redirectUri, state }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', config.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPES.join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
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
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      id_token?: string;
    };
    const email = decodeJwtEmail(body.id_token);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
      scopes: body.scope?.split(' ') ?? SCOPES,
      externalAccountId: email,
      accountLabel: email ?? 'Google account',
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
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: body.access_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  },

  async pull(ctx: PullContext): Promise<PullResult> {
    const lists = await listAll<GoogleTaskList>(`${API}/users/@me/lists`, ctx.accessToken);
    const tasks: NormalizedExternalTask[] = [];
    let maxUpdated = ctx.cursor;

    for (const list of lists) {
      const url = new URL(`${API}/lists/${list.id}/tasks`);
      url.searchParams.set('showCompleted', 'true');
      url.searchParams.set('showHidden', 'true');
      if (ctx.cursor) url.searchParams.set('updatedMin', ctx.cursor);
      const items = await listAll<GoogleTask>(url.toString(), ctx.accessToken);
      for (const t of items) {
        if (t.deleted) continue;
        tasks.push(normalize(list.id, t));
        if (t.updated && (!maxUpdated || t.updated > maxUpdated)) maxUpdated = t.updated;
      }
    }
    return { tasks, nextCursor: maxUpdated };
  },

  async push(ctx: PullContext, payload: PushPayload): Promise<void> {
    const [listId, taskId] = payload.externalId.split(':');
    if (!listId || !taskId) throw new Error(`Bad google_tasks externalId: ${payload.externalId}`);
    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.descriptionMd !== undefined) body.notes = payload.descriptionMd ?? '';
    if (payload.dueAt !== undefined) body.due = payload.dueAt;
    if (payload.status !== undefined) {
      body.status = payload.status === 'done' ? 'completed' : 'needsAction';
    }
    await connectorFetch(`${API}/lists/${listId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  },
};
