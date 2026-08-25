export class ApplicationError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND_ERROR');
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string) {
    super(message, 401, 'UNAUTHORIZED_ERROR');
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN_ERROR');
  }
}
