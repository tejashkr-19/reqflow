const { inferSchema } = require('./inference');
const { initDb, saveRoute, saveObservation, saveSchema, getAllRoutes, getRouteDetail, getResponseTimeSeries } = require('./storage');
const path = require('path');

function reqflowMiddleware(config = {}) {
  const dashboardPath = config.dashboardPath || config.path || '/reqflow';
  const dbPath = config.dbPath || './reqflow.db';
  const exclude = config.exclude || [];

  // Boot Database connection dynamically on first load
  initDb(dbPath);

  return function(req, res, next) {
    // --- Step 25: Exclusion List Support ---
    if (exclude.includes(req.path)) {
      return next();
    }

    // --- Phase 19: Dashboard Routes Interception ---
    if (req.path.startsWith(dashboardPath)) {
      if (req.method === 'GET') {
        if (req.path === dashboardPath) {
          return res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
        }
        if (req.path === `${dashboardPath}/app.js`) {
          return res.sendFile(path.join(__dirname, 'dashboard', 'app.js'));
        }
        if (req.path === `${dashboardPath}/api/routes`) {
          return res.json(getAllRoutes());
        }
        
        // Match detail API logic relative to configured dashboardPath
        const regexStr = `^${dashboardPath.replace(/\//g, '\\/')}\\/api\\/routes\\/(\\d+)$`;
        const idMatch = req.path.match(new RegExp(regexStr));
        if (idMatch) {
          const detail = getRouteDetail(parseInt(idMatch[1], 10));
          if (detail) return res.json(detail);
          return res.status(404).json({ error: 'Route details not found' });
        }

        const tsRegexStr = `^${dashboardPath.replace(/\//g, '\\/')}\\/api\\/routes\\/(\\d+)\\/timeseries$`;
        const tsMatch = req.path.match(new RegExp(tsRegexStr));
        if (tsMatch) {
          const timeseries = getResponseTimeSeries(parseInt(tsMatch[1], 10));
          return res.json(timeseries || []);
        }

        const changeRegexStr = `^${dashboardPath.replace(/\//g, '\\/')}\\/api\\/routes\\/(\\d+)\\/changes$`;
        const changeMatch = req.path.match(new RegExp(changeRegexStr));
        if (changeMatch) {
          const { detectChanges } = require('./storage');
          const changes = detectChanges(parseInt(changeMatch[1], 10));
          return res.json(changes);
        }
      }
      return next();
    }

    const requestTimestamp = Date.now();
    
    // Scrape incoming request payload including enhancement metrics
    const requestData = {
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query || {},
      hasAuth: !!req.headers['authorization'],
      contentType: req.headers['content-type'] || null,
      timestamp: requestTimestamp
    };
    
    const originalJson = res.json;
    const originalEnd = res.end;
    
    // Helper to process capture for both JSON and Redirects
    const processCapture = (body, statusCode, responseTime) => {
      const fullPath = (req.baseUrl || '') + (req.route?.path || req.path);
      const normalizedPath = fullPath.replace(/\/\d+/g, '/:param');

      try {
        const inferredReqSchema = inferSchema(requestData.body);
        const inferredResSchema = (typeof body === 'object' && body !== null) ? inferSchema(body) : body;
        const inferredQuerySchema = inferSchema(requestData.query);
        
        const routeId = saveRoute(requestData.method, normalizedPath);
        saveObservation(routeId, statusCode, responseTime);
        
        saveSchema(routeId, inferredResSchema, inferredQuerySchema, requestData.hasAuth, requestData.contentType, inferredReqSchema);
      } catch (err) {
        console.error('[Reqflow] Capture swallowed error to prevent crash:', err.message);
      }
    };

    // Override res.json with our version that captures data
    res.json = function(body) {
      const responseTime = Date.now() - requestTimestamp;
      processCapture(body, res.statusCode, responseTime);
      return originalJson.call(this, body);
    };

    // --- Fix 2: Robust Redirect Tracking via res.end ---
    // Instead of overriding res.redirect (which is brittle in Express 5),
    // we observe res.end and check for redirect status codes and Location header.
    res.end = function(chunk, encoding, callback) {
      // Check if this is a redirect that hasn't been captured via res.json
      const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
      const location = res.get('Location');

      if (isRedirect && location) {
        const responseTime = Date.now() - requestTimestamp;
        const redirectSchema = {
          redirect: "string",
          location: location
        };
        // Process capture only if it's a redirect
        processCapture(redirectSchema, res.statusCode, responseTime);
      }

      return originalEnd.apply(this, arguments);
    };
    
    next();
  };
}

module.exports = reqflowMiddleware;
