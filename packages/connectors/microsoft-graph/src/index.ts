// Shared Microsoft Graph plumbing for the ms_todo and ms_planner connectors:
// consumer/work OAuth (common tenant), paged fetches, and change-notification
// subscriptions. See docs/architecture.md §4 for the per-connector strategy.
import {
  connectorFetch,
  type OAuthClientConfig,
  type OAuthTokenSet,
  type RefreshedTokens,
  type WebhookSubscription,
} from '@palouse/connector-core';

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
// Overridable so tests/local smoke runs can target a fake server.
export const GRAPH_API = process.env.PALOUSE_MS_GRAPH_API_BASE ?? 'https://graph.microsoft.com/v1.0';

// Tasks.ReadWrite covers both To Do tasks and Planner tasks (delegated).
export const MS_SCOPES = ['offline_access', 'openid', 'email', 'profile', 'Tasks.ReadWrite'];

export function msBuildAuthUrl(input: {
  config: OAuthClientConfig;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', input.config.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', MS_SCOPES.join(' '));
  u.searchParams.set('state', input.state);
  return u.toString();
}

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

function decodeJwtClaim(idToken: string | undefined, claims: string[]): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    for (const claim of claims) {
      if (typeof parsed[claim] === 'string') return parsed[claim];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function msExchangeCode(input: {
  config: OAuthClientConfig;
  redirectUri: string;
  code: string;
}): Promise<OAuthTokenSet> {
  const res = await connectorFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      scope: MS_SCOPES.join(' '),
    }),
  });
  const body = (await res.json()) as MsTokenResponse;
  const account =
    decodeJwtClaim(body.id_token, ['email', 'preferred_username']) ?? 'Microsoft account';
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    scopes: body.scope?.split(' ') ?? MS_SCOPES,
    externalAccountId: decodeJwtClaim(body.id_token, ['oid', 'sub']),
    accountLabel: account,
  };
}

export async function msRefreshTokens(input: {
  config: OAuthClientConfig;
  refreshToken: string;
}): Promise<RefreshedTokens> {
  const res = await connectorFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
      scope: MS_SCOPES.join(' '),
    }),
  });
  const body = (await res.json()) as MsTokenResponse;
  return {
    accessToken: body.access_token,
    // Microsoft rotates refresh tokens — persist the new one when present.
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
  };
}

export async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH_API}${path}`;
  const res = await connectorFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await res.json()) as T;
}

/** Follows @odata.nextLink until the collection is exhausted. */
export async function graphGetAll<T>(path: string, accessToken: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value?: T[]; '@odata.nextLink'?: string } = await graphGet(next, accessToken);
    items.push(...(page.value ?? []));
    next = page['@odata.nextLink'];
  }
  return items;
}

export async function graphSend(
  path: string,
  accessToken: string,
  init: { method: string; body?: unknown; etag?: string },
): Promise<Response> {
  return connectorFetch(`${GRAPH_API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.etag ? { 'If-Match': init.etag } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// Graph caps To Do subscriptions at ~3 days; renew well inside that window.
const SUBSCRIPTION_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export async function graphCreateSubscription(input: {
  accessToken: string;
  resource: string;
  notificationUrl: string;
  clientState: string;
}): Promise<WebhookSubscription> {
  const expiresAt = new Date(Date.now() + SUBSCRIPTION_TTL_MS);
  const res = await graphSend('/subscriptions', input.accessToken, {
    method: 'POST',
    body: {
      changeType: 'created,updated,deleted',
      notificationUrl: input.notificationUrl,
      resource: input.resource,
      expirationDateTime: expiresAt.toISOString(),
      clientState: input.clientState,
    },
  });
  const body = (await res.json()) as { id: string; expirationDateTime?: string };
  return {
    subscriptionId: body.id,
    expiresAt: body.expirationDateTime ? new Date(body.expirationDateTime) : expiresAt,
  };
}

export async function graphRenewSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<WebhookSubscription> {
  const expiresAt = new Date(Date.now() + SUBSCRIPTION_TTL_MS);
  const res = await graphSend(`/subscriptions/${subscriptionId}`, accessToken, {
    method: 'PATCH',
    body: { expirationDateTime: expiresAt.toISOString() },
  });
  const body = (await res.json()) as { id: string; expirationDateTime?: string };
  return {
    subscriptionId: body.id,
    expiresAt: body.expirationDateTime ? new Date(body.expirationDateTime) : expiresAt,
  };
}

/** Graph dateTimeTimeZone — To Do returns UTC by default. */
export interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone?: string;
}

export function graphDateToIso(dt: GraphDateTimeTimeZone | undefined | null): string | undefined {
  if (!dt?.dateTime) return undefined;
  // Graph omits the zone designator from dateTime; trust timeZone (UTC default).
  const suffix = !dt.timeZone || dt.timeZone === 'UTC' ? 'Z' : '';
  const parsed = new Date(`${dt.dateTime}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
