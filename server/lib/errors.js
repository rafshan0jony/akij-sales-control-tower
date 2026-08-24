'use strict';

/** Application error with HTTP status code. */
class AppError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFound(message = 'Not found') {
  return new AppError(404, message);
}

function unauthorized(message = 'Unauthorized') {
  return new AppError(401, message);
}

function forbidden(message = 'Forbidden') {
  return new AppError(403, message);
}

function badRequest(message = 'Bad request') {
  return new AppError(400, message);
}

module.exports = { AppError, notFound, unauthorized, forbidden, badRequest };
