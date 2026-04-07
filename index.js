const reqflowMiddleware = require('./src/middleware');

/**
 * Reqflow Middleware Entry Point
 * @param {Object} config - Configuration options
 * @param {string} config.dashboardPath - URL path for the dashboard (default: /reqflow)
 * @param {string} config.dbPath - Path to the SQLite database file (default: ./reqflow.db)
 * @param {Array<string>} config.exclude - List of route paths to ignore (e.g. ['/health'])
 * @returns {Function} Express middleware
 */
module.exports = reqflowMiddleware;
