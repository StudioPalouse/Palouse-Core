import { createServer, type Server } from 'node:http';

export interface FakeAsanaTask {
  gid: string;
  name: string;
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  modified_at: string;
  permalink_url?: string;
}

export interface PushRecord {
  gid: string;
  data: Record<string, unknown>;
}

/**
 * Minimal in-memory Asana API double covering what the connector uses:
 * workspaces, assigned-task listing with modified_since, user task list,
 * webhook creation and task updates (recorded as pushes).
 */
export interface FakeAsana {
  server: Server;
  url: string;
  addTask(task: Omit<FakeAsanaTask, 'modified_at'> & { modified_at?: string }): FakeAsanaTask;
  tasks(): FakeAsanaTask[];
  pushes(): PushRecord[];
  webhookTargets(): string[];
  close(): Promise<void>;
}

export function startFakeAsana(port: number): Promise<FakeAsana> {
  const tasks = new Map<string, FakeAsanaTask>();
  const pushes: PushRecord[] = [];
  const webhookTargets: string[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/workspaces') {
      return json(200, { data: [{ gid: 'ws-fake-1' }] });
    }
    if (req.method === 'GET' && url.pathname === '/tasks') {
      const since = url.searchParams.get('modified_since');
      const data = [...tasks.values()].filter((t) => !since || t.modified_at > since);
      return json(200, { data, next_page: null });
    }
    if (req.method === 'GET' && url.pathname === '/users/me/user_task_list') {
      return json(200, { data: { gid: 'utl-fake-1' } });
    }
    if (req.method === 'POST' && url.pathname === '/webhooks') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { data?: { target?: string } };
          if (parsed.data?.target) webhookTargets.push(parsed.data.target);
        } catch {
          // ignore malformed test input
        }
        json(201, { data: { gid: 'wh-fake-1' } });
      });
      return;
    }
    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (req.method === 'PUT' && taskMatch) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const gid = taskMatch[1]!;
        const parsed = JSON.parse(body) as { data: Record<string, unknown> };
        pushes.push({ gid, data: parsed.data });
        const existing = tasks.get(gid);
        if (existing) {
          if (typeof parsed.data.name === 'string') existing.name = parsed.data.name;
          if (typeof parsed.data.completed === 'boolean') existing.completed = parsed.data.completed;
          if (typeof parsed.data.notes === 'string') existing.notes = parsed.data.notes;
          existing.modified_at = new Date().toISOString();
        }
        json(200, { data: { gid } });
      });
      return;
    }
    json(404, { errors: [{ message: `no fake route for ${req.method} ${url.pathname}` }] });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        server,
        url: `http://localhost:${port}`,
        addTask(t) {
          const task: FakeAsanaTask = {
            modified_at: t.modified_at ?? new Date().toISOString(),
            permalink_url: `https://app.asana.com/0/0/${t.gid}`,
            ...t,
          };
          tasks.set(task.gid, task);
          return task;
        },
        tasks: () => [...tasks.values()],
        pushes: () => pushes,
        webhookTargets: () => webhookTargets,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
