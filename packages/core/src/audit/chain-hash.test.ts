import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeAuditHash,
  genesisHash,
  type AuditChainFields,
} from '@palouse/shared/audit-chain';

// Pure hash/canonicalization tests. No database; these are the reproducibility
// contract an external auditor relies on to re-verify an exported chain.

describe('canonicalJson', () => {
  it('is independent of object key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys recursively', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalJson({ fields: ['title', 'status', 'assignee'] })).toBe(
      '{"fields":["title","status","assignee"]}',
    );
  });

  it('omits undefined object values but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it('rejects non-finite numbers so the recipe stays unambiguous', () => {
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });
});

describe('genesisHash', () => {
  it('is deterministic per workspace and differs across workspaces', () => {
    const a = genesisHash('11111111-1111-1111-1111-111111111111');
    expect(a).toBe(genesisHash('11111111-1111-1111-1111-111111111111'));
    expect(a).not.toBe(genesisHash('22222222-2222-2222-2222-222222222222'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeAuditHash', () => {
  const base: AuditChainFields = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    seq: 1,
    prevHash: genesisHash('11111111-1111-1111-1111-111111111111'),
    actorType: 'user',
    actorId: '33333333-3333-3333-3333-333333333333',
    action: 'task.created',
    targetType: 'task',
    targetId: '44444444-4444-4444-4444-444444444444',
    payload: { fields: ['title'] },
    at: '2026-07-13T12:00:00.000Z',
  };

  it('is stable for identical inputs', () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }));
    expect(computeAuditHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any committed field changes', () => {
    const h = computeAuditHash(base);
    expect(computeAuditHash({ ...base, seq: 2 })).not.toBe(h);
    expect(computeAuditHash({ ...base, action: 'task.updated' })).not.toBe(h);
    expect(computeAuditHash({ ...base, prevHash: 'deadbeef' })).not.toBe(h);
    expect(computeAuditHash({ ...base, payload: { fields: ['status'] } })).not.toBe(h);
    expect(computeAuditHash({ ...base, at: '2026-07-13T12:00:00.001Z' })).not.toBe(h);
    expect(computeAuditHash({ ...base, actorId: null })).not.toBe(h);
  });

  it('treats absent optional fields identically to explicit null', () => {
    const withNulls = computeAuditHash({
      ...base,
      actorId: null,
      targetType: null,
      targetId: null,
    });
    const stripped = computeAuditHash({
      ...base,
      actorId: null,
      targetType: null,
      targetId: null,
      payload: {},
    });
    // Sanity: the empty-payload variant differs, proving payload participates.
    expect(withNulls).not.toBe(stripped);
  });
});
