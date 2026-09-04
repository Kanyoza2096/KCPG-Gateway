'use strict';

class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details = null) {
    super(message, { status: 401, code: 'UNAUTHORIZED', details });
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details = null) {
    super(message, { status: 403, code: 'FORBIDDEN', details });
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found', details = null) {
    super(message, { status: 404, code: 'NOT_FOUND', details });
    this.name = 'NotFoundError';
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, { status: 400, code: 'BAD_REQUEST', details });
    this.name = 'BadRequestError';
  }
}

class UpstreamError extends AppError {
  constructor(message = 'Upstream service error', details = null) {
    super(message, { status: 502, code: 'UPSTREAM_ERROR', details });
    this.name = 'UpstreamError';
  }
}

module.exports = {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  UpstreamError,
};
