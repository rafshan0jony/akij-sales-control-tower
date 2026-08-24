'use strict';

const { AppError } = require('../lib/errors');
const logger = require('../logger');

/** Wrap async route handlers so thrown errors reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || null;

  // Database / MCP connectivity errors -> friendly message
  if (err.code === 'ELOGIN' || /login failed/i.test(message)) {
    status = 503;
    message = 'Data source is temporarily unavailable';
    code = 'DATA_SOURCE_UNAVAILABLE';
  } else if (err.code === 'ETIMEOUT' || /timeout/i.test(message)) {
    status = 504;
    message = 'Data source timed out';
    code = 'DATA_SOURCE_TIMEOUT';
  }

  if (status >= 500) {
    logger.error('[http]', status, message, err.stack || '');
  }

  res.status(status).json({ error: message, code });
}

module.exports = { asyncHandler, notFoundHandler, errorHandler };
