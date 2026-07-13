import { createHash } from 'node:crypto';

/**
 * Tamper-evident hash chain over the `audit_events` spine.
 *
 * Each row carries a per-workspace monotonic `seq`, the previous row's `hash`
 * as `prevHash`, and its own `hash` = sha256 over a canonical serialization of
 * the row's identifying fields plus `prevHash`. Any later edit or deletion of a
 * row changes its hash, which no longer matches the `prevHash` recorded on the
 * following row, so verification fails at a known `seq`.
 *
 * These functions are PURE (no DB) and live in the leaf `@palouse/shared`
 * package so both the write funnel (`@palouse/core` appendAuditEvent /
 * verifyChain) and the historical-row backfill (`@palouse/db` migrate) share a
 * SINGLE canonicalization implementation. An external auditor can re-verify a
 * `.jsonl` export with the recipe documented here and in the audit package
 * README.
 *
 * Recipe (version 1):
 *   canonical = canonicalJson({
 *     v, workspaceId, seq, prevHash, actorType, actorId, action,
 *     targetType, targetId, payload, at
 *   })
 *   hash = sha256Hex(canonical)
 * where canonicalJson emits object keys in sorted (byte) order with no
 * insignificant whitespace, and `at` is the row timestamp as an ISO-8601 string
 * in UTC (`Date.toISOString()`), `null` for any absent field.
 */
export const AUDIT_CHAIN_VERSION = 1 as const;

/** sha256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Deterministic JSON serialization: object keys sorted ascending by code unit,
 * arrays preserved in order, no whitespace. Mirrors the shape RFC 8785 (JCS)
 * produces for our value set (plain objects, arrays, strings, finite numbers,
 * booleans, null). We do not emit `undefined` keys. Non-finite numbers are not
 * expected in audit payloads and are rejected to keep the recipe unambiguous.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalJson: non-finite number is not serializable');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v === undefined ? null : v)).join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  // bigint, function, symbol, undefined at top level: not expected in payloads.
  throw new Error(`canonicalJson: unsupported value of type ${t}`);
}

/** Genesis prevHash for a workspace's chain: sha256('palouse:' + workspaceId). */
export function genesisHash(workspaceId: string): string {
  return sha256Hex(`palouse:${workspaceId}`);
}

/** The identifying fields of an audit row that the hash commits to. */
export interface AuditChainFields {
  workspaceId: string;
  seq: number;
  prevHash: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  /** ISO-8601 UTC string, e.g. new Date().toISOString(). */
  at: string;
}

/** Compute the chain hash for one row from its identifying fields. */
export function computeAuditHash(fields: AuditChainFields): string {
  return sha256Hex(
    canonicalJson({
      v: AUDIT_CHAIN_VERSION,
      workspaceId: fields.workspaceId,
      seq: fields.seq,
      prevHash: fields.prevHash,
      actorType: fields.actorType,
      actorId: fields.actorId ?? null,
      action: fields.action,
      targetType: fields.targetType ?? null,
      targetId: fields.targetId ?? null,
      payload: fields.payload ?? {},
      at: fields.at,
    }),
  );
}
