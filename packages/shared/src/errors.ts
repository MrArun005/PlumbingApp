/**
 * Error taxonomy — every error the platform throws on purpose extends
 * AppError and carries a STABLE machine-readable code. API layers map these
 * to HTTP responses; clients and support tooling switch on `code`, never on
 * message text (messages may change, codes may not).
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'ENV_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  /** Safe-to-expose structured context (no secrets, no PII). */
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }

  toJSON(): { code: ErrorCode; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly httpStatus = 400;
}

export class EnvValidationError extends AppError {
  readonly code = 'ENV_INVALID' as const;
  readonly httpStatus = 500;
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly httpStatus = 404;

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, { resource, id });
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly httpStatus = 409;
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED' as const;
  readonly httpStatus = 401;
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN' as const;
  readonly httpStatus = 403;
}

/**
 * Thrown by state machines when a transition is not in the allowed map.
 * Build-prompt rule 4: no ad-hoc status writes; illegal moves throw this.
 */
export class InvalidTransitionError<TState extends string = string> extends AppError {
  readonly code = 'INVALID_TRANSITION' as const;
  readonly httpStatus = 409;
  readonly entity: string;
  readonly from: TState;
  readonly to: TState;

  constructor(entity: string, from: TState, to: TState) {
    super(`Illegal ${entity} transition: ${from} → ${to}`, { entity, from, to });
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

/** Same idempotency key replayed with a DIFFERENT request body. */
export class IdempotencyKeyReusedError extends AppError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED' as const;
  readonly httpStatus = 422;
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly httpStatus = 429;
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL' as const;
  readonly httpStatus = 500;
}
