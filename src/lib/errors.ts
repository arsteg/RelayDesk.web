/** Errors thrown by the service layer. Server actions translate them into form messages. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, "NOT_FOUND");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, "VALIDATION", fieldErrors);
  }
}

/** Plan limit reached - message always tells the user how to upgrade. */
export class PlanLimitError extends AppError {
  constructor(message: string) {
    super(message, "PLAN_LIMIT");
  }
}

/** Workspace is read-only (cancelled, expired trial, past grace period, or suspended). */
export class ReadOnlyError extends AppError {
  constructor(message: string) {
    super(message, "READ_ONLY");
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait a few minutes and try again.") {
    super(message, "RATE_LIMITED");
  }
}
