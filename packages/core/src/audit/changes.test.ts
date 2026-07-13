import { describe, expect, it } from 'vitest';
import { diffAuditChanges, MAX_AUDIT_VALUE_LENGTH } from './changes.js';

describe('diffAuditChanges', () => {
  it('records only fields that actually changed', () => {
    const before = { title: 'Draft', status: 'open', priority: 2 };
    const after = { title: 'Draft', status: 'done', priority: 2 };
    const changes = diffAuditChanges(before, after, ['title', 'status', 'priority']);
    expect(changes).toEqual({ status: { from: 'open', to: 'done' } });
  });

  it('ignores fields the caller did not touch even if they differ', () => {
    const before = { title: 'A', status: 'open' };
    const after = { title: 'B', status: 'done' };
    // Only `status` was in the update input, so a coincidental title diff is skipped.
    const changes = diffAuditChanges(before, after, ['status']);
    expect(changes).toEqual({ status: { from: 'open', to: 'done' } });
  });

  it('captures null transitions (set and clear)', () => {
    const changes = diffAuditChanges(
      { assigneeUserId: null, dueAt: '2026-07-01T00:00:00.000Z' },
      { assigneeUserId: 'u1', dueAt: null },
      ['assigneeUserId', 'dueAt'],
    );
    expect(changes).toEqual({
      assigneeUserId: { from: null, to: 'u1' },
      dueAt: { from: '2026-07-01T00:00:00.000Z', to: null },
    });
  });

  it('truncates oversized string values, keeping the log small', () => {
    const long = 'x'.repeat(MAX_AUDIT_VALUE_LENGTH + 200);
    const changes = diffAuditChanges({ descriptionMd: '' }, { descriptionMd: long }, [
      'descriptionMd',
    ]);
    const to = changes.descriptionMd!.to as string;
    expect(to.length).toBe(MAX_AUDIT_VALUE_LENGTH + 1); // + the ellipsis glyph
    expect(to.endsWith('…')).toBe(true);
  });

  it('returns an empty object for a no-op update', () => {
    const same = { title: 'Same', status: 'open' };
    expect(diffAuditChanges(same, { ...same }, ['title', 'status'])).toEqual({});
  });
});
