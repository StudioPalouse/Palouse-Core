export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'INTEGRATION_FAILURE'
  | 'INTERNAL';

export class ReqOpsError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 500, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (msg: string) => new ReqOpsError('NOT_FOUND', msg, 404);
export const unauthorized = (msg = 'Unauthorized') => new ReqOpsError('UNAUTHORIZED', msg, 401);
export const forbidden = (msg = 'Forbidden') => new ReqOpsError('FORBIDDEN', msg, 403);
export const conflict = (msg: string) => new ReqOpsError('CONFLICT', msg, 409);
export const validation = (msg: string, details?: unknown) =>
  new ReqOpsError('VALIDATION', msg, 400, details);
