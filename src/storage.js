const Database = require('better-sqlite3');
const path = require('path');
const { mergeSchema, getConfidenceScore } = require('./inference');

let db;

function initDb(dbPath = './reqflow.db') {
  if (db) return; // avoid multiple initializations
  
  const targetPath = path.resolve(process.cwd(), dbPath);
  db = new Database(targetPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      status_code INTEGER,
      response_time INTEGER,
      observed_at TEXT NOT NULL,
      FOREIGN KEY (route_id) REFERENCES routes(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL UNIQUE,
      merged_schema TEXT,
      query_schema TEXT,
      request_body_schema TEXT,
      auth_required BOOLEAN DEFAULT 0,
      content_type TEXT,
      confidence_score INTEGER DEFAULT 0,
      total_observations INTEGER DEFAULT 0,
      FOREIGN KEY (route_id) REFERENCES routes(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      total_observations INTEGER NOT NULL,
      taken_at TEXT NOT NULL,
      FOREIGN KEY (route_id) REFERENCES routes(id)
    )
  `);
}

function saveRoute(method, reqPath) {
  const now = new Date().toISOString();
  
  const existingRoute = db.prepare('SELECT id FROM routes WHERE method = ? AND path = ?').get(method, reqPath);
  
  if (existingRoute) {
    db.prepare('UPDATE routes SET last_seen = ? WHERE id = ?').run(now, existingRoute.id);
    return existingRoute.id;
  } else {
    const result = db.prepare('INSERT INTO routes (method, path, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(method, reqPath, now, now);
    return result.lastInsertRowid;
  }
}


function saveObservation(routeId, statusCode, responseTime) {
  const now = new Date().toISOString();
  const result = db.prepare('INSERT INTO observations (route_id, status_code, response_time, observed_at) VALUES (?, ?, ?, ?)').run(routeId, statusCode, responseTime, now);
  
  // V2 Feature 3: Sliding window (Last 50 only)
  // Ensure exactly 50 observations per route to cap database growth
  db.prepare(`
    DELETE FROM observations 
    WHERE route_id = ? 
    AND id NOT IN (
      SELECT id FROM observations WHERE route_id = ? ORDER BY id DESC LIMIT 50
    )
  `).run(routeId, routeId);

  return result.lastInsertRowid;
}

function saveSchema(routeId, inferredSchema, inferredQuerySchema, hasAuth, contentType, inferredReqBodySchema) {
  const row = db.prepare('SELECT merged_schema, query_schema, auth_required, content_type, total_observations, request_body_schema FROM schemas WHERE route_id = ?').get(routeId);

  const updatedAuth = row ? (row.auth_required || hasAuth ? 1 : 0) : (hasAuth ? 1 : 0);
  const updatedContentType = contentType || (row ? row.content_type : null);

  if (!row) {
    let freshSchema = { total_observations: 0, fields: {} };
    freshSchema = mergeSchema(freshSchema, inferredSchema);
    
    let freshQuerySchema = { total_observations: 0, fields: {} };
    freshQuerySchema = mergeSchema(freshQuerySchema, inferredQuerySchema);

    let freshReqBodySchema = { total_observations: 0, fields: {} };
    freshReqBodySchema = mergeSchema(freshReqBodySchema, inferredReqBodySchema);
    
    const confidence = getConfidenceScore(freshSchema.total_observations);
    db.prepare(`
      INSERT INTO schemas 
      (route_id, merged_schema, confidence_score, total_observations, query_schema, auth_required, content_type, request_body_schema) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      routeId, JSON.stringify(freshSchema), confidence, freshSchema.total_observations,
      JSON.stringify(freshQuerySchema), updatedAuth, updatedContentType, JSON.stringify(freshReqBodySchema)
    );
  } else {
    // Merge existing response schema
    let currentSchema = JSON.parse(row.merged_schema);
    currentSchema.total_observations = row.total_observations;
    const updatedSchema = mergeSchema(currentSchema, inferredSchema);
    
    // Merge existing query schema
    let currentQuerySchema = row.query_schema ? JSON.parse(row.query_schema) : { total_observations: row.total_observations, fields: {} };
    currentQuerySchema.total_observations = row.total_observations;
    const updatedQuerySchema = mergeSchema(currentQuerySchema, inferredQuerySchema);

    // Merge existing request body schema
    let currentReqBodySchema = row.request_body_schema ? JSON.parse(row.request_body_schema) : { total_observations: row.total_observations, fields: {} };
    currentReqBodySchema.total_observations = row.total_observations;
    const updatedReqBodySchema = mergeSchema(currentReqBodySchema, inferredReqBodySchema);

    const newTotal = updatedSchema.total_observations;
    const newConfidence = getConfidenceScore(newTotal);

    db.prepare(`
      UPDATE schemas SET 
        merged_schema = ?, 
        confidence_score = ?, 
        total_observations = ?,
        query_schema = ?,
        auth_required = ?,
        content_type = ?,
        request_body_schema = ?
      WHERE route_id = ?
    `).run(
      JSON.stringify(updatedSchema), newConfidence, newTotal,
      JSON.stringify(updatedQuerySchema), updatedAuth, updatedContentType,
      JSON.stringify(updatedReqBodySchema), routeId
    );

    // --- V2 Feature 4: Snapshot Logic ---
    if (newTotal > 0 && newTotal % 20 === 0) {
      const now = new Date().toISOString();
      // 1. INSERT snapshot
      db.prepare(`
        INSERT INTO schema_snapshots (route_id, snapshot, total_observations, taken_at)
        VALUES (?, ?, ?, ?)
      `).run(routeId, JSON.stringify(updatedSchema), newTotal, now);

      // 2. Cleanup: Keep only last 5 snapshots per route
      db.prepare(`
        DELETE FROM schema_snapshots 
        WHERE route_id = ? 
        AND id NOT IN (
          SELECT id FROM schema_snapshots WHERE route_id = ? ORDER BY id DESC LIMIT 5
        )
      `).run(routeId, routeId);
    }
  }
}

function getAllRoutes() {
  const routes = db.prepare(`
    SELECT 
      r.id, r.method, r.path, r.first_seen, r.last_seen,
      COALESCE(s.confidence_score, 0) as confidence_score, 
      COALESCE(s.total_observations, 0) as total_observations
    FROM routes r
    LEFT JOIN schemas s ON r.id = s.route_id
    ORDER BY total_observations DESC
  `).all();

  // Performance Fix: Fetch latest 2 snapshots for ALL routes in one query
  const snapshotsRaw = db.prepare(`
    SELECT route_id, taken_at, id, snapshot
    FROM schema_snapshots 
    WHERE id IN (
      SELECT MAX(id) FROM schema_snapshots GROUP BY route_id
      UNION
      SELECT id FROM (
        SELECT id, route_id, ROW_NUMBER() OVER (PARTITION BY route_id ORDER BY id DESC) as rn 
        FROM schema_snapshots
      ) WHERE rn = 2
    )
  `).all();

  const snapshotMap = {};
  snapshotsRaw.forEach(s => {
    if (!snapshotMap[s.route_id]) snapshotMap[s.route_id] = [];
    snapshotMap[s.route_id].push(s);
  });

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Attach error rate data and avg_time for badge rendering
  return routes.map(route => {
    const snapshots = (snapshotMap[route.id] || []).sort((a,b) => b.id - a.id);
    let hasRecentChange = false;
    
    // Only detect change if we have at least 2 snapshots
    if (snapshots.length >= 2) {
      const latest = snapshots[0];
      const prev = snapshots[1];
      const detectedAt = new Date(latest.taken_at);
      
      if (detectedAt > sevenDaysAgo) {
        // Compare schemas to ensure an actual change occurred
        try {
          const sLatest = JSON.parse(latest.snapshot).fields || {};
          const sPrev = JSON.parse(prev.snapshot).fields || {};
          
          const keysLatest = Object.keys(sLatest);
          const keysPrev = Object.keys(sPrev);
          
          if (keysLatest.length !== keysPrev.length) {
            hasRecentChange = true;
          } else {
            // Check for new/removed keys or type changes
            for (const key of keysLatest) {
              if (!sPrev[key] || sPrev[key].type !== sLatest[key].type) {
                hasRecentChange = true;
                break;
              }
            }
            if (!hasRecentChange) {
              for (const key of keysPrev) {
                if (!sLatest[key]) {
                  hasRecentChange = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Fallback to true if parsing fails but dates match
          hasRecentChange = true;
        }
      }
    }

    const totalObs = db.prepare('SELECT COUNT(*) as c FROM observations WHERE route_id = ?').get(route.id).c;
    const avgRow = db.prepare('SELECT AVG(response_time) as a FROM observations WHERE route_id = ? AND response_time IS NOT NULL').get(route.id);
    const avg = avgRow.a ? Math.round(avgRow.a) : 0;

    const baseData = { 
      ...route, 
      avg_time: avg,
      has_recent_change: hasRecentChange
    };

    if (totalObs === 0) return { ...baseData, error_4xx_pct: 0, error_5xx_pct: 0 };

    const count4xx = db.prepare('SELECT COUNT(*) as c FROM observations WHERE route_id = ? AND status_code >= 400 AND status_code < 500').get(route.id).c;
    const count5xx = db.prepare('SELECT COUNT(*) as c FROM observations WHERE route_id = ? AND status_code >= 500').get(route.id).c;

    return {
      ...baseData,
      error_4xx_pct: Math.round((count4xx / totalObs) * 100),
      error_5xx_pct: Math.round((count5xx / totalObs) * 100),
    };
  });
}

function getRouteDetail(routeId) {
  const route = db.prepare(`
    SELECT r.method, r.path, r.first_seen, r.last_seen,
           s.merged_schema, s.confidence_score, s.total_observations,
           s.query_schema, s.auth_required, s.content_type, s.request_body_schema
    FROM routes r
    LEFT JOIN schemas s ON r.id = s.route_id
    WHERE r.id = ?
  `).get(routeId);

  if (!route) return null;

  const stats = db.prepare(`
    SELECT 
      ROUND(AVG(response_time)) as avg_response_time,
      MIN(response_time) as fastest_response_time,
      MAX(response_time) as slowest_response_time
    FROM observations 
    WHERE route_id = ? AND response_time IS NOT NULL
  `).get(routeId);

  const statusCodes = db.prepare(`
    SELECT status_code, COUNT(*) as count 
    FROM observations 
    WHERE route_id = ? AND status_code IS NOT NULL
    GROUP BY status_code
  `).all(routeId);

  const statusCodeBreakdown = {};
  for (const row of statusCodes) {
    statusCodeBreakdown[row.status_code] = row.count;
  }

  return {
    id: routeId,
    method: route.method,
    path: route.path,
    first_seen: route.first_seen,
    last_seen: route.last_seen,
    confidence_score: route.confidence_score || 0,
    total_observations: route.total_observations || 0,
    merged_schema: route.merged_schema ? JSON.parse(route.merged_schema) : { total_observations: 0, fields: {} },
    query_schema: route.query_schema ? JSON.parse(route.query_schema) : { total_observations: 0, fields: {} },
    auth_required: !!route.auth_required,
    content_type: route.content_type || 'Unknown',
    request_body_schema: route.request_body_schema ? JSON.parse(route.request_body_schema) : { total_observations: 0, fields: {} },
    avg_response_time: stats.avg_response_time || 0,
    fastest_response_time: stats.fastest_response_time || 0,
    slowest_response_time: stats.slowest_response_time || 0,
    status_code_breakdown: statusCodeBreakdown,
    status_breakdown: buildStatusBreakdown(statusCodes)
  };
}

function buildStatusBreakdown(statusCodes) {
  const groups = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  let total = 0;

  for (const row of statusCodes) {
    const code = row.status_code;
    total += row.count;
    if (code >= 200 && code < 300) groups['2xx'] += row.count;
    else if (code >= 300 && code < 400) groups['3xx'] += row.count;
    else if (code >= 400 && code < 500) groups['4xx'] += row.count;
    else if (code >= 500) groups['5xx'] += row.count;
  }

  const result = {};
  for (const [key, count] of Object.entries(groups)) {
    if (count > 0 || key === '2xx') {
      result[key] = {
        count: count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0
      };
    }
  }
  return result;
}

function getResponseTimeSeries(routeId) {
  return db.prepare(`
    SELECT response_time, observed_at 
    FROM observations 
    WHERE route_id = ? AND response_time IS NOT NULL 
    ORDER BY id ASC
  `).all(routeId);
}

function detectChanges(routeId) {
  const snapshots = db.prepare(`
    SELECT snapshot, taken_at, total_observations 
    FROM schema_snapshots 
    WHERE route_id = ? 
    ORDER BY id DESC LIMIT 2
  `).all(routeId);

  if (snapshots.length < 2) {
    return { hasChanges: false };
  }

  const current = JSON.parse(snapshots[0].snapshot);
  const previous = JSON.parse(snapshots[1].snapshot);
  
  const addedFields = [];
  const removedFields = [];
  const typeChanges = [];

  const currFields = current.fields || {};
  const prevFields = previous.fields || {};

  for (const field in currFields) {
    if (!prevFields[field]) {
      addedFields.push({ name: field, type: currFields[field].type });
    } else if (prevFields[field].type !== currFields[field].type) {
      typeChanges.push({ name: field, from: prevFields[field].type, to: currFields[field].type });
    }
  }

  for (const field in prevFields) {
    if (!currFields[field]) {
      removedFields.push({ name: field, type: prevFields[field].type });
    }
  }

  const hasChanges = addedFields.length > 0 || removedFields.length > 0 || typeChanges.length > 0;

  return {
    hasChanges,
    addedFields,
    removedFields,
    typeChanges,
    detectedAt: snapshots[0].taken_at,
    prevDate: snapshots[1].taken_at,
    currDate: snapshots[0].taken_at,
    prevObs: snapshots[1].total_observations,
    currObs: snapshots[0].total_observations
  };
}

module.exports = {
  initDb,
  saveRoute,
  saveObservation,
  saveSchema,
  getAllRoutes,
  getRouteDetail,
  getResponseTimeSeries,
  detectChanges
};
