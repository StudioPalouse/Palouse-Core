import type {
  Handoff,
  HandoffEvent,
  HandoffNarrative,
  HandoffStep,
  HandoffUsageSummary,
} from '@reqops/shared';

/**
 * Plain-English rendering of a handoff. Lives in core so the web UI, PDF
 * report, and CSV export all say exactly the same thing. Pure — no DB.
 */
export interface NarrativeInput {
  handoff: Handoff;
  agentName: string | null;
  taskTitle: string | null;
  events: HandoffEvent[];
  steps: HandoffStep[];
  summary: HandoffUsageSummary;
}

const EVENT_SENTENCES: Record<string, string> = {
  queued: 'Handed off to the agent',
  claimed: 'The agent picked it up',
  requeued: 'The agent went quiet — queued for another attempt',
  review_requested: 'The agent asked for review',
  reviewed: 'A person reviewed the work',
  completed: 'The agent finished',
  failed: "The agent couldn't finish",
  cancelled: 'The handoff was cancelled',
};

export function narrateHandoff(input: NarrativeInput): HandoffNarrative {
  const { handoff, summary, steps } = input;
  const agent = input.agentName ?? 'The agent';
  const task = input.taskTitle ? `'${input.taskTitle}'` : 'this task';

  const parts: string[] = [];
  const duration = workedDuration(handoff);
  const span = duration ? ` for ${duration}` : '';
  const stepsPart = steps.length > 0 ? ` across ${steps.length} step${steps.length === 1 ? '' : 's'}` : '';

  switch (handoff.state) {
    case 'queued':
      parts.push(`${agent} hasn't picked up ${task} yet.`);
      break;
    case 'claimed':
    case 'in_progress':
      parts.push(`${agent} is working on ${task}${span ? ` — ${duration} so far` : ''}${stepsPart}.`);
      break;
    case 'needs_review':
      parts.push(`${agent} worked on ${task}${span}${stepsPart} and is waiting for your review.`);
      break;
    case 'completed':
      parts.push(`${agent} completed ${task}${span}${stepsPart}.`);
      break;
    case 'failed':
      parts.push(
        `${agent} couldn't finish ${task}${span}${stepsPart}${
          handoff.failureReason ? ` (${humanFailure(handoff.failureReason)})` : ''
        }.`,
      );
      break;
    case 'cancelled':
      parts.push(`The handoff of ${task} to ${agent} was cancelled.`);
      break;
  }

  if (summary.generationCount > 0) {
    const models = summary.models.map(prettyModel).join(', ');
    const tokens = `${formatTokens(summary.inputTokens)} tokens in / ${formatTokens(summary.outputTokens)} out`;
    const cost =
      summary.costUsd === null
        ? 'cost not priced'
        : `costing ${formatUsd(summary.costUsd)}${summary.unpricedCount > 0 ? ' (some calls unpriced)' : ''}`;
    parts.push(`Used ${models} (${tokens}), ${cost}.`);
  }

  return { headline: parts.join(' '), sentences: buildSentences(input) };
}

function buildSentences(input: NarrativeInput): string[] {
  const sentences: string[] = [];
  for (const event of input.events) {
    const base = EVENT_SENTENCES[event.kind] ?? event.kind;
    let detail = '';
    if (event.kind === 'reviewed') {
      detail = event.payload.decision === 'approved' ? ' and approved it' : ' and sent it back';
      if (typeof event.payload.note === 'string' && event.payload.note)
        detail += ` — “${event.payload.note}”`;
    } else if (
      (event.kind === 'failed' || event.kind === 'requeued' || event.kind === 'cancelled') &&
      typeof event.payload.reason === 'string' &&
      event.payload.reason
    ) {
      detail = ` (${humanFailure(event.payload.reason)})`;
    }
    sentences.push(`${base}${detail}.`);
  }
  for (const step of input.steps) {
    sentences.push(`Step ${step.seq}: ${step.title}${step.status === 'failed' ? ' (failed)' : ''}.`);
  }
  return sentences;
}

function workedDuration(handoff: Handoff): string | null {
  if (!handoff.claimedAt) return null;
  const start = new Date(handoff.claimedAt).getTime();
  const end = ['completed', 'failed', 'cancelled', 'needs_review'].includes(handoff.state)
    ? new Date(handoff.updatedAt).getTime()
    : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest > 0 ? ` ${rest}m` : ''}`;
}

function humanFailure(reason: string): string {
  if (reason === 'heartbeat_timeout') return 'the agent stopped responding';
  if (reason === 'claim_ttl_expired') return 'no agent picked it up in time';
  if (reason === 'rejected_in_review') return 'a reviewer sent it back';
  return reason;
}

/** 'claude-opus-4-8' → 'Claude Opus 4.8'; unknown ids pass through untouched. */
export function prettyModel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  if (m) {
    const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
    return `Claude ${family} ${m[2]}.${m[3]}`;
  }
  const single = /^claude-([a-z]+)-(\d+)$/.exec(model);
  if (single) {
    const family = single[1]!.charAt(0).toUpperCase() + single[1]!.slice(1);
    return `Claude ${family} ${single[2]}`;
  }
  return model;
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
