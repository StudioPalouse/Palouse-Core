import { z } from 'zod';

/**
 * Product areas an admin can turn on or off per workspace. Dashboard is the
 * post-sign-in landing page and Settings is where the toggles live, so neither
 * is gateable; everything else in the sidebar is.
 */
export const CAPABILITY_KEYS = [
  'tasks',
  'decisions',
  'projects',
  'context',
  'objectives',
] as const;

export const capabilityKey = z.enum(CAPABILITY_KEYS);
export type CapabilityKey = z.infer<typeof capabilityKey>;

/** Enabled state for every capability. Capabilities default to enabled. */
export type WorkspaceCapabilities = Record<CapabilityKey, boolean>;

export const setCapabilityInput = z.object({
  enabled: z.boolean(),
});
export type SetCapabilityInput = z.infer<typeof setCapabilityInput>;
