import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@palouse/config';
import { closeDb, getDb, users } from '@palouse/db';
import { getAuth } from '@palouse/auth';
import { userActor } from '@palouse/shared';
import { workspaces as workspaceService, taskService } from '@palouse/core';

const DEMO_EMAIL = 'demo@palouse.local';
const DEMO_PASSWORD = 'palouse-demo-password';

const DEMO_TASKS = [
  { title: 'Review Q2 connector roadmap', priority: 1, status: 'open' },
  { title: 'Draft Asana webhook handshake notes', priority: 2, status: 'in_progress' },
  { title: 'Triage inbox dedupe edge cases', priority: 2, status: 'open' },
  { title: 'Write MCP claim-token spec', priority: 0, status: 'blocked' },
  { title: 'Ship unified inbox v1', priority: 1, status: 'open' },
  { title: 'Archive stale Google Tasks import', priority: 4, status: 'done' },
] as const;

export function seedCommand(): Command {
  return new Command('seed')
    .description('Seed a demo user, workspace and tasks for local testing')
    .action(async () => {
      const env = loadEnv();
      const db = getDb(env.DATABASE_URL);
      const auth = getAuth();

      let [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
      if (!user) {
        await auth.api.signUpEmail({
          body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: 'Demo User' },
        });
        [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
      }
      if (!user) throw new Error('Failed to create demo user');

      const existing = await workspaceService.listWorkspacesForUser(db, user.id);
      let ws = existing.find((w) => w.slug === 'demo');
      if (!ws) {
        ws = await workspaceService.createWorkspace(db, user.id, { name: 'Demo', slug: 'demo' });
      }

      const { total } = await taskService.listTasks(db, {
        workspaceId: ws.id,
        limit: 1,
        offset: 0,
      });
      if (total === 0) {
        for (const t of DEMO_TASKS) {
          const created = await taskService.createTask(db, ws.id, user.id, {
            title: t.title,
            priority: t.priority,
          });
          if (t.status !== 'open') {
            await taskService.updateTask(db, ws.id, userActor(user.id), created.id, {
              status: t.status,
            });
          }
        }
      }

      console.log('Seed complete.');
      console.log(`  email:     ${DEMO_EMAIL}`);
      console.log(`  password:  ${DEMO_PASSWORD}`);
      console.log(`  workspace: ${ws.name} (${ws.id})`);
      console.log(`  tasks:     ${total === 0 ? DEMO_TASKS.length : total}`);
      await closeDb();
    });
}
