/**
 * Sequelize CLI + app DB config. Credentials come from environment only —
 * never commit real passwords. Loads `.env.${NODE_ENV}` when present.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = path.join(__dirname, '..', `.env.${nodeEnv}`);
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

function buildEnv(name) {
  const isProd = name === 'production';
  const password = process.env.DB_PASSWORD;
  if (isProd && (password == null || password === '')) {
    // Sequelize CLI may import all environments; validate at runtime in app/server.
  }
  const cfg = {
    username: process.env.DB_USER || 'root',
    password: password != null ? password : '',
    database: process.env.DB_NAME || (name === 'test' ? 'picklecoach_test' : name === 'production' ? 'picklecoach' : 'picklecoach_development'),
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',
    logging: name === 'development' ? console.log : false,
    pool: {
      max: Number(process.env.DB_POOL_MAX || 10),
      min: Number(process.env.DB_POOL_MIN || 0),
      acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
      idle: Number(process.env.DB_POOL_IDLE || 10000),
    },
  };
  if (isProd && (process.env.DB_SSL === '1' || process.env.DB_SSL === 'true')) {
    cfg.dialectOptions = {
      ssl: {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      },
    };
  }
  return cfg;
}

module.exports = {
  development: buildEnv('development'),
  test: buildEnv('test'),
  production: buildEnv('production'),
};
