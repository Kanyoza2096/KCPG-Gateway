'use strict';

const { v4: uuidv4 } = require('uuid');

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = { requestId };
