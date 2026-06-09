// BullMQ wrappers + job type registry. Concrete queues land in M3.
export const QUEUE_NAMES = {
  sync: 'sync',
  handoff: 'handoff',
  notifications: 'notifications',
  audit: 'audit',
  housekeeping: 'housekeeping',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
