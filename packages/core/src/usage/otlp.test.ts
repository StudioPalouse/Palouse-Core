import { describe, expect, it } from 'vitest';
import { mapOtlpTraces, type OtlpTracePayload } from './otlp.js';

// --- OTLP/JSON span builders (int64s are strings on the wire) ---

interface Attr {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: number };
}
const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const int = (key: string, v: number): Attr => ({ key, value: { intValue: String(v) } });

function trace(spans: Record<string, unknown>[], resourceAttrs: Attr[] = []): OtlpTracePayload {
  return {
    resourceSpans: [
      { resource: { attributes: resourceAttrs }, scopeSpans: [{ spans: spans as never }] },
    ],
  };
}

// Span end at 2023-11-14T22:13:20.000Z.
const END_NANO = '1700000000000000000';
const END_MS = 1_700_000_000_000;

describe('mapOtlpTraces — generations', () => {
  it('maps a current GenAI span (gen_ai.usage.input_tokens / output_tokens + cache)', () => {
    const payload = trace([
      {
        traceId: 'abc123',
        spanId: 'span-1',
        parentSpanId: 'root-0',
        name: 'chat claude',
        endTimeUnixNano: END_NANO,
        attributes: [
          str('gen_ai.system', 'anthropic'),
          str('gen_ai.response.model', 'claude-opus-4-8'),
          int('gen_ai.usage.input_tokens', 1000),
          int('gen_ai.usage.output_tokens', 200),
          int('gen_ai.usage.cache_read_input_tokens', 300),
          int('gen_ai.usage.cache_creation_input_tokens', 50),
        ],
      },
    ]);
    const { generations, steps, ignoredSpans } = mapOtlpTraces(payload);
    expect(steps).toHaveLength(0);
    expect(ignoredSpans).toBe(0);
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheWriteTokens: 50,
      otelTraceId: 'abc123',
      otelSpanId: 'span-1',
    });
    expect(generations[0]!.occurredAt?.getTime()).toBe(END_MS);
  });

  it('accepts legacy prompt_tokens / completion_tokens and gen_ai.request.model fallback', () => {
    const payload = trace([
      {
        spanId: 'span-legacy',
        name: 'openllmetry.llm',
        endTimeUnixNano: END_NANO,
        attributes: [
          str('gen_ai.system', 'openai'),
          str('gen_ai.request.model', 'gpt-4o'), // no response.model
          int('gen_ai.usage.prompt_tokens', 80),
          int('gen_ai.usage.completion_tokens', 25),
        ],
      },
    ]);
    const { generations } = mapOtlpTraces(payload);
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 80,
      outputTokens: 25,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('records an output-only generation with model "unknown" when no model attr is present', () => {
    const payload = trace([
      { spanId: 's', endTimeUnixNano: END_NANO, attributes: [int('gen_ai.usage.output_tokens', 5)] },
    ]);
    const { generations } = mapOtlpTraces(payload);
    expect(generations[0]).toMatchObject({ model: 'unknown', inputTokens: 0, outputTokens: 5 });
  });

  it('falls back to start time, then null, when end time is absent', () => {
    const withStart = trace([
      {
        spanId: 's1',
        startTimeUnixNano: END_NANO,
        attributes: [int('gen_ai.usage.input_tokens', 1)],
      },
    ]);
    expect(mapOtlpTraces(withStart).generations[0]!.occurredAt?.getTime()).toBe(END_MS);

    const noTime = trace([{ spanId: 's2', attributes: [int('gen_ai.usage.input_tokens', 1)] }]);
    expect(mapOtlpTraces(noTime).generations[0]!.occurredAt).toBeNull();
  });
});

describe('mapOtlpTraces — steps & ignored spans', () => {
  it('treats a span with reqops.step.title as a step (status from error code)', () => {
    const payload = trace([
      {
        spanId: 'step-1',
        parentSpanId: 'root',
        endTimeUnixNano: END_NANO,
        startTimeUnixNano: END_NANO,
        status: { code: 2 }, // ERROR
        attributes: [str('reqops.step.title', 'Drafted the report')],
      },
    ]);
    const { steps, generations } = mapOtlpTraces(payload);
    expect(generations).toHaveLength(0);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ title: 'Drafted the report', status: 'failed', otelSpanId: 'step-1' });
    expect(steps[0]!.endedAt?.getTime()).toBe(END_MS);
  });

  it('treats a trace root (no parentSpanId) with a name as a step', () => {
    const payload = trace([{ spanId: 'root', name: 'Handle support ticket' }]);
    const { steps } = mapOtlpTraces(payload);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ title: 'Handle support ticket', status: 'completed' });
  });

  it('ignores non-genai child spans (HTTP/DB/internal)', () => {
    const payload = trace([
      { spanId: 'http', parentSpanId: 'root', name: 'GET /v1/things', attributes: [str('http.method', 'GET')] },
    ]);
    const { generations, steps, ignoredSpans } = mapOtlpTraces(payload);
    expect(generations).toHaveLength(0);
    expect(steps).toHaveLength(0);
    expect(ignoredSpans).toBe(1);
  });

  it('ignores spans without a span id', () => {
    const payload = trace([{ name: 'no-id', attributes: [int('gen_ai.usage.input_tokens', 1)] }]);
    expect(mapOtlpTraces(payload).ignoredSpans).toBe(1);
  });
});

describe('mapOtlpTraces — correlation hints', () => {
  it('reads handoff id / claim token from span attributes', () => {
    const payload = trace([
      {
        spanId: 's',
        endTimeUnixNano: END_NANO,
        attributes: [
          int('gen_ai.usage.input_tokens', 1),
          str('reqops.handoff_id', 'handoff-xyz'),
          str('reqops.claim_token', 'tok-123'),
        ],
      },
    ]);
    expect(mapOtlpTraces(payload).generations[0]).toMatchObject({
      handoffId: 'handoff-xyz',
      claimToken: 'tok-123',
    });
  });

  it('falls back to resource-level correlation attributes', () => {
    const payload = trace(
      [{ spanId: 's', endTimeUnixNano: END_NANO, attributes: [int('gen_ai.usage.input_tokens', 1)] }],
      [str('reqops.handoff_id', 'res-handoff')],
    );
    expect(mapOtlpTraces(payload).generations[0]).toMatchObject({ handoffId: 'res-handoff', claimToken: null });
  });

  it('returns empty result for an empty payload', () => {
    expect(mapOtlpTraces({})).toEqual({ generations: [], steps: [], ignoredSpans: 0 });
  });
});
