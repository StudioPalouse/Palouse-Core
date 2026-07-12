import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  getDb,
  memberships,
  objectives as objectivesTable,
  organizations,
  users,
  workspaces,
  type Database,
} from '@palouse/db';
import { userActor, type Actor } from '@palouse/shared';
import { addRelation, createDecision, getDecision } from './service.js';
import { createObjective, getObjective, listRelatedDecisions } from '../objectives/service.js';
import {
  createProject,
  createProjectItem,
  getProject,
  listRelatedDecisions as listProjectRelatedDecisions,
} from '../projects/service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  db = getDb(container.getConnectionUri());
  // Also exercises the 0019 ALTER TYPE ... ADD VALUE 'key_result' migration.
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await container?.stop();
});

/** Fresh workspace with an owner so each test is isolated. */
async function seedWorkspace(): Promise<{ workspaceId: string; actor: Actor }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org!.id, name: `WS ${suffix}`, slug: `ws-${suffix}` })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({ email: `owner-${suffix}@example.com`, name: 'Owner' })
    .returning();
  await db.insert(memberships).values({ workspaceId: ws!.id, userId: owner!.id, role: 'owner' });
  return { workspaceId: ws!.id, actor: userActor(owner!.id) };
}

describe('strategy linkage: getDecision hydration', () => {
  it('resolves goal relations to the objective title and status', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, {
      title: 'Grow signups',
      status: 'at_risk',
    });
    const decision = await createDecision(db, workspaceId, actor, {
      title: 'Pick a growth channel',
    });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });

    const detail = await getDecision(db, workspaceId, decision.id);
    const rel = detail.relations.find((r) => r.entityType === 'goal');
    expect(rel).toBeDefined();
    expect(rel!.label).toBe('Grow signups');
    expect(rel!.targetStatus).toBe('at_risk');
  });

  it('resolves key_result relations to the KR name and progress percent', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, {
      title: 'Improve activation',
      keyResults: [{ name: 'Activated users', startValue: 0, targetValue: 100, currentValue: 25 }],
    });
    const objDetail = await getObjective(db, workspaceId, objective.id);
    const krId = objDetail.keyResults[0]!.id;

    const decision = await createDecision(db, workspaceId, actor, { title: 'Onboarding rework' });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'key_result',
      entityId: krId,
    });

    const detail = await getDecision(db, workspaceId, decision.id);
    const rel = detail.relations.find((r) => r.entityType === 'key_result');
    expect(rel!.label).toBe('Activated users');
    // 25 of 0..100 => 25%.
    expect(rel!.targetStatus).toBe('25%');
  });

  it('returns label null (no throw) for a relation whose entity was deleted', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, { title: 'Temp goal' });
    const decision = await createDecision(db, workspaceId, actor, {
      title: 'Depends on temp goal',
    });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });
    await db.delete(objectivesTable).where(eq(objectivesTable.id, objective.id));

    const detail = await getDecision(db, workspaceId, decision.id);
    const rel = detail.relations.find((r) => r.entityType === 'goal');
    expect(rel).toBeDefined();
    expect(rel!.label).toBeNull();
    expect(rel!.targetStatus).toBeNull();
  });
});

describe('strategy linkage: objectiveService.listRelatedDecisions', () => {
  it('returns decisions linked to the objective and to its key results, deduped', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, {
      title: 'North star',
      keyResults: [{ name: 'Retention', startValue: 0, targetValue: 90 }],
    });
    const objDetail = await getObjective(db, workspaceId, objective.id);
    const krId = objDetail.keyResults[0]!.id;

    const goalDecision = await createDecision(db, workspaceId, actor, { title: 'Goal-level call' });
    const krDecision = await createDecision(db, workspaceId, actor, { title: 'KR-level call' });
    const bothDecision = await createDecision(db, workspaceId, actor, { title: 'Linked to both' });

    await addRelation(db, workspaceId, actor, goalDecision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });
    await addRelation(db, workspaceId, actor, krDecision.id, {
      entityType: 'key_result',
      entityId: krId,
    });
    await addRelation(db, workspaceId, actor, bothDecision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });
    await addRelation(db, workspaceId, actor, bothDecision.id, {
      entityType: 'key_result',
      entityId: krId,
    });

    const related = await listRelatedDecisions(db, workspaceId, objective.id);
    const ids = related.map((r) => r.decisionId).sort();
    expect(ids).toEqual([goalDecision.id, krDecision.id, bothDecision.id].sort());
    // The decision linked to both the goal and its KR appears exactly once.
    expect(related.filter((r) => r.decisionId === bothDecision.id)).toHaveLength(1);
  });

  it('does not leak decisions from another workspace', async () => {
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    const objectiveA = await createObjective(db, a.workspaceId, a.actor, { title: 'A goal' });
    const decisionB = await createDecision(db, b.workspaceId, b.actor, { title: 'B decision' });
    // Cross-wire: a B-workspace decision points at an A-workspace objective id.
    // The workspace-scoped join must exclude it.
    await addRelation(db, b.workspaceId, b.actor, decisionB.id, {
      entityType: 'goal',
      entityId: objectiveA.id,
    });

    const related = await listRelatedDecisions(db, a.workspaceId, objectiveA.id);
    expect(related).toHaveLength(0);
  });
});

describe('strategy linkage: getObjective gating', () => {
  it('omits related decisions unless includeRelatedDecisions is set', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, { title: 'Gated goal' });
    const decision = await createDecision(db, workspaceId, actor, { title: 'Linked' });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });

    const off = await getObjective(db, workspaceId, objective.id);
    expect(off.relatedDecisions).toEqual([]);

    const on = await getObjective(db, workspaceId, objective.id, { includeRelatedDecisions: true });
    expect(on.relatedDecisions.map((r) => r.decisionId)).toEqual([decision.id]);
  });

  it('links the same decision-objective pair idempotently', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const objective = await createObjective(db, workspaceId, actor, { title: 'Idempotent goal' });
    const decision = await createDecision(db, workspaceId, actor, { title: 'Once' });
    const first = await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });
    const second = await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'goal',
      entityId: objective.id,
    });
    expect(second.id).toBe(first.id);

    const related = await listRelatedDecisions(db, workspaceId, objective.id);
    expect(related).toHaveLength(1);
  });
});

describe('strategy linkage: decision <-> project (slice 2)', () => {
  it('hydrates a project relation to the project name and status in getDecision', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const project = await createProject(db, workspaceId, actor, {
      name: 'Website relaunch',
      status: 'active',
    });
    const decision = await createDecision(db, workspaceId, actor, { title: 'Choose a CMS' });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'project',
      entityId: project.id,
    });

    const detail = await getDecision(db, workspaceId, decision.id);
    const rel = detail.relations.find((r) => r.entityType === 'project');
    expect(rel!.label).toBe('Website relaunch');
    expect(rel!.targetStatus).toBe('active');
  });

  it('listRelatedDecisions returns project-level links only, not card-level links', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const project = await createProject(db, workspaceId, actor, { name: 'App v2' });
    const card = await createProjectItem(db, workspaceId, actor, project.id, { title: 'Card A' });

    const projectDecision = await createDecision(db, workspaceId, actor, {
      title: 'Project-level',
    });
    const cardDecision = await createDecision(db, workspaceId, actor, { title: 'Card-level' });
    await addRelation(db, workspaceId, actor, projectDecision.id, {
      entityType: 'project',
      entityId: project.id,
    });
    await addRelation(db, workspaceId, actor, cardDecision.id, {
      entityType: 'project_item',
      entityId: card.id,
    });

    const related = await listProjectRelatedDecisions(db, workspaceId, project.id);
    // Only the project-level link; the card-level (project_item) link is separate.
    expect(related.map((r) => r.decisionId)).toEqual([projectDecision.id]);
  });

  it('getProject omits related decisions unless includeRelatedDecisions is set', async () => {
    const { workspaceId, actor } = await seedWorkspace();
    const project = await createProject(db, workspaceId, actor, { name: 'Gated project' });
    const decision = await createDecision(db, workspaceId, actor, { title: 'Linked' });
    await addRelation(db, workspaceId, actor, decision.id, {
      entityType: 'project',
      entityId: project.id,
    });

    const off = await getProject(db, workspaceId, project.id);
    expect(off.relatedDecisions).toEqual([]);

    const on = await getProject(db, workspaceId, project.id, { includeRelatedDecisions: true });
    expect(on.relatedDecisions.map((r) => r.decisionId)).toEqual([decision.id]);
  });

  it('does not leak project-linked decisions from another workspace', async () => {
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    const projectA = await createProject(db, a.workspaceId, a.actor, { name: 'A project' });
    const decisionB = await createDecision(db, b.workspaceId, b.actor, { title: 'B decision' });
    await addRelation(db, b.workspaceId, b.actor, decisionB.id, {
      entityType: 'project',
      entityId: projectA.id,
    });

    const related = await listProjectRelatedDecisions(db, a.workspaceId, projectA.id);
    expect(related).toHaveLength(0);
  });
});
