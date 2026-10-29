class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity') {
    super(message, 422);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError
};
