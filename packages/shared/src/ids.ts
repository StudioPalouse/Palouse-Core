import { z } from 'zod';

export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

export const externalSystem = z.enum([
  'google_tasks',
  'ms_todo',
  'ms_planner',
  'asana',
  'notion',
  'palouse',
]);
export type ExternalSystem = z.infer<typeof externalSystem>;
