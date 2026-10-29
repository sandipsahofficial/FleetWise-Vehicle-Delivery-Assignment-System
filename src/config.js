const path = require('node:path');
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fleetwise.db'),
  isTest: process.env.NODE_ENV === 'test',
};

module.exports = config;
