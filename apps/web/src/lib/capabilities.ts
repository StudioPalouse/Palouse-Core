import type { CapabilityKey, WorkspaceCapabilities } from '@palouse/shared';

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  tasks: 'Tasks',
  decisions: 'Decisions',
  projects: 'Projects',
  context: 'Context',
  objectives: 'Objectives',
};

/** Path prefixes owned by each gateable capability. */
const ROUTE_CAPABILITIES: Array<{ prefix: string; capability: CapabilityKey }> = [
  { prefix: '/tasks', capability: 'tasks' },
  { prefix: '/reviews', capability: 'tasks' },
  { prefix: '/decisions', capability: 'decisions' },
  { prefix: '/projects', capability: 'projects' },
  { prefix: '/context', capability: 'context' },
  { prefix: '/objectives', capability: 'objectives' },
];

/** The capability that owns a route, or null for ungated routes. */
export function capabilityForPath(pathname: string): CapabilityKey | null {
  const hit = ROUTE_CAPABILITIES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return hit?.capability ?? null;
}

/**
 * Whether a capability is enabled on a loaded map. A missing key reads as
 * enabled (capabilities default on). A null map means the map has not loaded
 * yet; callers that must not reveal a disabled capability (the nav, the route
 * gate) check for a loaded map before calling so they can fail closed.
 */
export function isCapabilityEnabled(
  capabilities: WorkspaceCapabilities | null,
  key: CapabilityKey | null | undefined,
): boolean {
  if (!key) return true;
  return capabilities?.[key] !== false;
}
