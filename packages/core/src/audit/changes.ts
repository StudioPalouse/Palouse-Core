/**
 * Before/after diffs for the audit spine (roadmap A3). An update mutation passes
 * the entity DTO as it looked before and after the change plus the list of input
 * keys the caller touched; this returns a compact `{ field: { from, to } }` map
 * of the values that actually changed. The map is stored in the audit event
 * payload, so it is hash-chained and tamper-evident alongside everything else.
 *
 * Values are sanitized with the same discipline as the MCP tool-call logger
 * (apps/mcp/src/auth.ts): long strings are truncated so a large markdown body
 * never bloats the log (the full text lives on the entity row), and Dates are
 * normalized to ISO strings. DTOs are already ISO-normalized, so this mostly
 * guards against oversized text fields.
 */

/** Truncation ceiling for a single before/after string value. Mirrors MCP's MAX_ARG_LENGTH. */
export const MAX_AUDIT_VALUE_LENGTH = 500;

/** A single field's change, recorded in the audit payload's `changes` map. */
export interface AuditFieldChange {
  from: unknown;
  to: unknown;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_AUDIT_VALUE_LENGTH) {
    return `${value.slice(0, MAX_AUDIT_VALUE_LENGTH)}…`;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Diff two entity DTOs over the fields the caller changed. Both DTOs must be the
 * same shape (pass the value returned by the service's own `toDto`), so date and
 * enum normalization is already consistent on both sides. Only fields whose value
 * genuinely differs are returned; a no-op patch yields an empty object.
 */
export function diffAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Record<string, AuditFieldChange> {
  const changes: Record<string, AuditFieldChange> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = sanitizeValue(before[field]);
    const to = sanitizeValue(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}
