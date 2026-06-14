import {
  ConnectorHttpError,
  type ConnectorAdapter,
  type NormalizedExternalTask,
  type OAuthTokenSet,
  type PullContext,
  type PullResult,
  type RefreshedTokens,
} from '@reqops/connector-core';

export const PROVIDER = 'notion' as const;

// Pin the data-sources API model from day one. Integrations on the old
// 2022-06-28 query endpoint break the moment a user adds a second data source
// to a database (see docs/notion-integration.md). Non-negotiable.
export const NOTION_VERSION = '2025-09-03';

const AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
// Overridable so tests/local smoke runs can target a fake Notion server.
const API = process.env.REQOPS_NOTION_API_BASE ?? 'https://api.notion.com/v1';

// Notion allows ~3 requests/second/connection with bursts; 429/529 carry
// Retry-After (seconds). We serialize requests with a minimum spacing and
// honor Retry-After on throttle — backfills must not stampede.
const MIN_REQUEST_INTERVAL_MS = 350; // ~2.85 req/s, comfortably under the cap
const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Field mapping — the piece with no Asana equivalent. Notion task databases are
// user-defined, so "Status"/"Due"/etc. are conventions, not guaranteed fields.
// Each connection stores how its data-source properties map onto ReqOps fields.
// ---------------------------------------------------------------------------
export interface NotionFieldMap {
  /** Title-type property to use. Omit → the data source's `title` property. */
  titleProp?: string;
  /** `status` or `select` property holding task state. Omit → everything `open`. */
  statusProp?: string;
  /** Option names (case-insensitive) that mean the task is finished. */
  doneStatuses?: string[];
  /** `date` property mapped to the task due date. */
  dueProp?: string;
  /** `rich_text` property mapped to the task description. */
  descriptionProp?: string;
}

/** Per-connection config carried on the integration row and read by `pull`. */
export interface NotionConnectionConfig {
  dataSourceId: string;
  fieldMap?: NotionFieldMap;
}

const DEFAULT_DONE_STATUSES = ['done', 'complete', 'completed', 'closed'];

// ---------------------------------------------------------------------------
// Rate-limited request core
// ---------------------------------------------------------------------------
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes all Notion calls through one promise chain with minimum spacing,
 * and retries 429/529 honoring Retry-After. Throws ConnectorHttpError on other
 * non-2xx so callers share the connector error contract.
 */
async function notionFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastAt + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) await delay(wait);
      lastAt = Date.now();

      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      });

      if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 1;
        await delay(retryAfter * 1000);
        continue;
      }
      if (!res.ok) throw new ConnectorHttpError(res.status, await res.text().catch(() => ''));
      return res;
    }
  };

  // Tail onto the chain so requests never overlap; isolate failures.
  const result = chain.then(run, run);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function notionJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await notionFetch(path, token, init);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Notion API surface (N1 read path)
// ---------------------------------------------------------------------------
interface NotionUser {
  id: string;
  name?: string;
  bot?: { workspace_name?: string };
}

export interface NotionDataSourceRef {
  id: string;
  name: string;
}

/** Validates a token and returns a human label (bot/workspace name). */
export async function verifyToken(token: string): Promise<{ accountLabel: string; botId: string }> {
  const me = await notionJson<NotionUser>('/users/me', token);
  const label = me.bot?.workspace_name ?? me.name ?? 'Notion workspace';
  return { accountLabel: label, botId: me.id };
}

/**
 * Lists the data sources inside a database. A database is now a container for
 * one or more data sources, each with its own schema; we store the
 * `data_source_id`, which is NOT interchangeable with the database id.
 */
export async function discoverDataSources(
  token: string,
  databaseId: string,
): Promise<NotionDataSourceRef[]> {
  const db = await notionJson<{ data_sources?: NotionDataSourceRef[] }>(
    `/databases/${databaseId}`,
    token,
  );
  return db.data_sources ?? [];
}

interface NotionPropertyValue {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  status?: { name: string } | null;
  select?: { name: string } | null;
  date?: { start: string; end?: string | null } | null;
}

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties: Record<string, NotionPropertyValue>;
}

interface QueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

function plain(parts?: { plain_text: string }[]): string | undefined {
  const text = (parts ?? []).map((p) => p.plain_text).join('').trim();
  return text || undefined;
}

function findTitleProp(props: Record<string, NotionPropertyValue>, preferred?: string): string | undefined {
  if (preferred && props[preferred]) return preferred;
  return Object.keys(props).find((k) => props[k]?.type === 'title');
}

/** Maps a Notion page onto a ReqOps task using the connection's field map. */
export function pageToTask(page: NotionPage, fieldMap: NotionFieldMap = {}): NormalizedExternalTask {
  const props = page.properties ?? {};

  const titleKey = findTitleProp(props, fieldMap.titleProp);
  const title = (titleKey && plain(props[titleKey]?.title)) || '(untitled)';

  let status: NormalizedExternalTask['status'] = 'open';
  const statusVal = fieldMap.statusProp ? props[fieldMap.statusProp] : undefined;
  if (statusVal) {
    const optionName = (statusVal.status?.name ?? statusVal.select?.name ?? '').toLowerCase();
    const done = (fieldMap.doneStatuses ?? DEFAULT_DONE_STATUSES).map((s) => s.toLowerCase());
    if (optionName && done.includes(optionName)) status = 'done';
  }

  const dueStart = fieldMap.dueProp ? props[fieldMap.dueProp]?.date?.start : undefined;
  const descriptionMd = fieldMap.descriptionProp
    ? plain(props[fieldMap.descriptionProp]?.rich_text)
    : undefined;

  return {
    externalSystem: 'notion',
    externalId: page.id,
    externalUrl: page.url,
    externalUpdatedAt: page.last_edited_time,
    title,
    descriptionMd,
    status,
    // Notion dates may be date-only ('2026-06-14') or full ISO; normalize date-only to UTC midnight.
    dueAt: dueStart ? (dueStart.length === 10 ? `${dueStart}T00:00:00Z` : dueStart) : undefined,
  };
}

/**
 * Queries a data source, paginating fully. When `cursor` (an ISO timestamp) is
 * present, filters to pages edited after it and sorts ascending so the returned
 * `nextCursor` is the newest edit seen — the basis for incremental sync.
 */
export async function queryDataSource(
  token: string,
  dataSourceId: string,
  cursor?: string,
): Promise<{ pages: NotionPage[]; latestEdit?: string }> {
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;
  let latestEdit = cursor;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    };
    if (cursor) {
      body.filter = { timestamp: 'last_edited_time', last_edited_time: { after: cursor } };
    }
    if (startCursor) body.start_cursor = startCursor;

    const res = await notionJson<QueryResponse>(`/data_sources/${dataSourceId}/query`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    for (const page of res.results) {
      pages.push(page);
      if (page.last_edited_time && (!latestEdit || page.last_edited_time > latestEdit)) {
        latestEdit = page.last_edited_time;
      }
    }
    startCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return { pages, latestEdit };
}

function parseConfig(raw: unknown): NotionConnectionConfig {
  const config = raw as Partial<NotionConnectionConfig> | undefined;
  if (!config?.dataSourceId) {
    throw new Error('Notion connection is missing dataSourceId — reconnect and select a database');
  }
  return { dataSourceId: config.dataSourceId, fieldMap: config.fieldMap };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export const notionAdapter: ConnectorAdapter = {
  system: 'notion',
  // N1 is read-only backfill + manual sync; webhooks (N2) flip this to false.
  pollOnly: true,

  buildAuthUrl({ config, redirectUri, state }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', config.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('owner', 'user');
    u.searchParams.set('state', state);
    return u.toString();
  },

  async exchangeCode({ config, redirectUri, code }): Promise<OAuthTokenSet> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!res.ok) throw new ConnectorHttpError(res.status, await res.text().catch(() => ''));
    const body = (await res.json()) as {
      access_token: string;
      workspace_id?: string;
      workspace_name?: string;
      bot_id?: string;
    };
    return {
      accessToken: body.access_token,
      // Notion bearer tokens (internal and OAuth) do not expire and have no refresh token.
      scopes: ['notion'],
      externalAccountId: body.workspace_id ?? body.bot_id,
      accountLabel: body.workspace_name ?? 'Notion workspace',
    };
  },

  async pull(ctx: PullContext): Promise<PullResult> {
    const { dataSourceId, fieldMap } = parseConfig(ctx.config);
    const { pages, latestEdit } = await queryDataSource(ctx.accessToken, dataSourceId, ctx.cursor);
    return {
      tasks: pages.map((p) => pageToTask(p, fieldMap)),
      nextCursor: latestEdit,
    };
  },
};

// Notion tokens never expire, so no refreshTokens. Webhooks (subscribeWebhook)
// and outbound push land in N2/N3 — see docs/notion-integration.md.
export type { RefreshedTokens };
