'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

function sign(payload, expiresIn = config.auth.jwtExpiresIn) {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn });
}

function verify(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

module.exports = { sign, verify };
