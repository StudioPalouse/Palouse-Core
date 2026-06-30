import type { StepStatus } from '@palouse/shared';

/**
 * Pure OTLP/HTTP-JSON → Palouse usage mapper. No DB, no clock — correlation and
 * persistence happen in the service (`ingestOtlp`); this file only decodes
 * spans into generations and steps per the OpenTelemetry GenAI semantic
 * conventions (https://opentelemetry.io/docs/specs/semconv/gen-ai/).
 *
 * It accepts the shapes real exporters emit: current `gen_ai.usage.*_tokens`,
 * the legacy `prompt_tokens`/`completion_tokens` names, and Anthropic-style
 * cache token attributes. Spans that are neither a generation nor a step
 * (HTTP, DB, internal) are ignored and counted, not stored — Palouse keeps a
 * usage ledger, not a full trace store (docs §4).
 */

// --- OTLP JSON wire shapes (subset we read) ---

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpKeyValue[];
  status?: { code?: number };
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpTracePayload {
  resourceSpans?: OtlpResourceSpans[];
}

// --- Mapper output ---

/** Correlation hints lifted from span/resource attrs; resolved to a handoff by the service. */
export interface OtlpCorrelation {
  handoffId: string | null;
  claimToken: string | null;
}

export interface MappedGeneration extends OtlpCorrelation {
  model: string;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  otelTraceId: string | null;
  otelSpanId: string;
  /** Span end time; null when the exporter omitted timestamps — service defaults to ingest time. */
  occurredAt: Date | null;
}

export interface MappedStep extends OtlpCorrelation {
  title: string;
  status: StepStatus;
  otelTraceId: string | null;
  otelSpanId: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface OtlpMapResult {
  generations: MappedGeneration[];
  steps: MappedStep[];
  /** Spans that were neither a generation nor a step (not stored). */
  ignoredSpans: number;
}

// --- GenAI semconv attribute names (current + legacy aliases) ---

const ATTR = {
  inputTokens: ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'llm.usage.prompt_tokens'],
  outputTokens: [
    'gen_ai.usage.output_tokens',
    'gen_ai.usage.completion_tokens',
    'llm.usage.completion_tokens',
  ],
  cacheReadTokens: ['gen_ai.usage.cache_read_input_tokens'],
  cacheWriteTokens: ['gen_ai.usage.cache_creation_input_tokens'],
  model: ['gen_ai.response.model', 'gen_ai.request.model'],
  provider: ['gen_ai.system', 'gen_ai.provider.name'],
  stepTitle: ['palouse.step.title'],
  handoffId: ['palouse.handoff_id'],
  claimToken: ['palouse.claim_token'],
} as const;

function indexAttrs(kvs: OtlpKeyValue[] | undefined): Map<string, OtlpAnyValue> {
  const map = new Map<string, OtlpAnyValue>();
  for (const kv of kvs ?? []) if (kv.value) map.set(kv.key, kv.value);
  return map;
}

function readString(attrs: Map<string, OtlpAnyValue>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = attrs.get(k);
    if (v?.stringValue != null && v.stringValue !== '') return v.stringValue;
  }
  return null;
}

function readInt(attrs: Map<string, OtlpAnyValue>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = attrs.get(k);
    if (!v) continue;
    // OTLP/JSON encodes int64 as a string; doubles arrive as numbers.
    const raw = v.intValue ?? v.doubleValue;
    if (raw == null) continue;
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/** unixNano (string or number) → Date; null when absent/invalid. */
function nanoToDate(nano: string | number | undefined): Date | null {
  if (nano == null) return null;
  const n = typeof nano === 'string' ? Number(nano) : nano;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n / 1e6);
}

function spanStatus(span: OtlpSpan): StepStatus {
  // OTel StatusCode: 0 UNSET, 1 OK, 2 ERROR.
  return span.status?.code === 2 ? 'failed' : 'completed';
}

/**
 * Decode one OTLP trace export request. A span is classified, first match wins:
 *   1. carries token usage          → generation
 *   2. carries palouse.step.title    → step
 *   3. is a trace root with a name  → step (title = span name)
 *   4. otherwise                    → ignored
 */
export function mapOtlpTraces(payload: OtlpTracePayload): OtlpMapResult {
  const generations: MappedGeneration[] = [];
  const steps: MappedStep[] = [];
  let ignoredSpans = 0;

  for (const rs of payload.resourceSpans ?? []) {
    const resourceAttrs = indexAttrs(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const spanId = typeof span.spanId === 'string' ? span.spanId : '';
        if (!spanId) {
          ignoredSpans += 1;
          continue;
        }
        const attrs = indexAttrs(span.attributes);
        const traceId = typeof span.traceId === 'string' && span.traceId ? span.traceId : null;
        // Correlation: prefer span-level, fall back to resource-level (set once
        // via OTEL_RESOURCE_ATTRIBUTES for the whole process).
        const correlation: OtlpCorrelation = {
          handoffId: readString(attrs, ATTR.handoffId) ?? readString(resourceAttrs, ATTR.handoffId),
          claimToken:
            readString(attrs, ATTR.claimToken) ?? readString(resourceAttrs, ATTR.claimToken),
        };

        const inputTokens = readInt(attrs, ATTR.inputTokens);
        const outputTokens = readInt(attrs, ATTR.outputTokens);

        // 1. Generation — any token usage present.
        if (inputTokens != null || outputTokens != null) {
          generations.push({
            ...correlation,
            model: readString(attrs, ATTR.model) ?? 'unknown',
            provider: readString(attrs, ATTR.provider),
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
            cacheReadTokens: readInt(attrs, ATTR.cacheReadTokens) ?? 0,
            cacheWriteTokens: readInt(attrs, ATTR.cacheWriteTokens) ?? 0,
            otelTraceId: traceId,
            otelSpanId: spanId,
            occurredAt: nanoToDate(span.endTimeUnixNano) ?? nanoToDate(span.startTimeUnixNano),
          });
          continue;
        }

        // 2/3. Step — explicit title, or a trace root carrying a name.
        const explicitTitle = readString(attrs, ATTR.stepTitle);
        const isRoot = !span.parentSpanId;
        const title = explicitTitle ?? (isRoot && span.name ? span.name : null);
        if (title) {
          steps.push({
            ...correlation,
            title,
            status: spanStatus(span),
            otelTraceId: traceId,
            otelSpanId: spanId,
            startedAt: nanoToDate(span.startTimeUnixNano),
            endedAt: nanoToDate(span.endTimeUnixNano),
          });
          continue;
        }

        ignoredSpans += 1;
      }
    }
  }

  return { generations, steps, ignoredSpans };
}
