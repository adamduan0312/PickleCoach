import dotenv from 'dotenv';
dotenv.config();

import { Sequelize } from 'sequelize';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const config = require('../config/config.json');

// Create Sequelize instance (Sequelize CLI standard approach)
// This is the professional/industry-standard way
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

// Allow environment variables to override config.json values
export const sequelize = new Sequelize(
  process.env.DB_NAME || dbConfig.database,
  process.env.DB_USER || dbConfig.username,
  process.env.DB_PASSWORD || dbConfig.password,
  {
    host: process.env.DB_HOST || dbConfig.host,
    port: process.env.DB_PORT || dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging !== undefined 
      ? (typeof dbConfig.logging === 'function' ? dbConfig.logging : (dbConfig.logging ? console.log : false))
      : (env === 'development' ? console.log : false),
    pool: dbConfig.pool || {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: false,
      freezeTableName: true,
    },
  }
);

