/** Typed domain errors; the API maps them to HTTP status codes. */

export class ConflictError extends Error {
  readonly status = 409;
  readonly code: string;
  constructor(message: string, code = 'CONFLICT') {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly code: string;
  constructor(message: string, code = 'VALIDATION') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** Postgres SQLSTATE of an error thrown by any driver (postgres-js, PGlite, wrapped by Drizzle). */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Map integrity violations to domain errors; rethrow anything else untouched. */
export function mapPgError(err: unknown): never {
  switch (pgCode(err)) {
    case '23505':
      throw new ConflictError('A conflicting record already exists', 'UNIQUE_VIOLATION');
    case '23P01':
      throw new ConflictError('That slot or resource is already taken', 'EXCLUSION_VIOLATION');
    case '23514':
      throw new ValidationError('A data rule was violated', 'CHECK_VIOLATION');
    case '23503':
      throw new ValidationError('A referenced record does not exist', 'FOREIGN_KEY_VIOLATION');
    case '40001':
      throw new ConflictError('Concurrent update, please retry', 'SERIALIZATION_FAILURE');
    default:
      throw err;
  }
}
