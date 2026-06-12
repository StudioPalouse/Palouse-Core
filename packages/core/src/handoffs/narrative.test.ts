import { describe, expect, it } from 'vitest';
import type { Handoff, HandoffStep, HandoffUsageSummary } from '@reqops/shared';
import { narrateHandoff, prettyModel } from './narrative.js';

const baseHandoff: Handoff = {
  id: '00000000-0000-0000-0000-000000000001',
  taskId: '00000000-0000-0000-0000-000000000002',
  workspaceId: '00000000-0000-0000-0000-000000000003',
  actorAgentId: '00000000-0000-0000-0000-000000000004',
  state: 'completed',
  claimedAt: '2026-06-12T10:00:00.000Z',
  lastHeartbeatAt: '2026-06-12T10:13:00.000Z',
  deadlineAt: null,
  deadlineMinutes: 30,
  requeueCount: 0,
  resultSummaryMd: 'Done',
  failureReason: null,
  requestedByUserId: null,
  reviewRequired: false,
  reviewedByUserId: null,
  reviewedAt: null,
  reviewDecision: null,
  createdAt: '2026-06-12T09:55:00.000Z',
  updatedAt: '2026-06-12T10:14:00.000Z',
};

const summary: HandoffUsageSummary = {
  generationCount: 3,
  inputTokens: 412_031,
  outputTokens: 18_220,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 1.87,
  unpricedCount: 0,
  models: ['claude-opus-4-8'],
};

const steps: HandoffStep[] = Array.from({ length: 6 }, (_, i) => ({
  id: `00000000-0000-0000-0000-00000000001${i}`,
  handoffId: baseHandoff.id,
  seq: i + 1,
  title: `Step ${i + 1}`,
  detailMd: null,
  status: 'completed',
  source: 'mcp',
  startedAt: null,
  endedAt: null,
  createdAt: '2026-06-12T10:01:00.000Z',
}));

describe('narrateHandoff', () => {
  it('produces the canonical completed headline', () => {
    const { headline } = narrateHandoff({
      handoff: baseHandoff,
      agentName: 'claude-local',
      taskTitle: 'Prepare Q2 report',
      events: [],
      steps,
      summary,
    });
    expect(headline).toBe(
      "claude-local completed 'Prepare Q2 report' for 14 minutes across 6 steps. " +
        'Used Claude Opus 4.8 (412,031 tokens in / 18,220 out), costing $1.87.',
    );
  });

  it('flags unpriced calls instead of presenting a partial cost as total', () => {
    const { headline } = narrateHandoff({
      handoff: baseHandoff,
      agentName: 'a',
      taskTitle: 't',
      events: [],
      steps: [],
      summary: { ...summary, unpricedCount: 1 },
    });
    expect(headline).toContain('some calls unpriced');
  });

  it('explains failures in plain English', () => {
    const { headline } = narrateHandoff({
      handoff: { ...baseHandoff, state: 'failed', failureReason: 'heartbeat_timeout' },
      agentName: 'a',
      taskTitle: 't',
      events: [],
      steps: [],
      summary: { ...summary, generationCount: 0 },
    });
    expect(headline).toContain('the agent stopped responding');
  });
});

describe('prettyModel', () => {
  it('formats Anthropic ids', () => {
    expect(prettyModel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(prettyModel('claude-fable-5')).toBe('Claude Fable 5');
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
  });

  it('passes unknown ids through', () => {
    expect(prettyModel('gpt-5o')).toBe('gpt-5o');
  });
});
