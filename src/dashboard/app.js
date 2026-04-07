document.addEventListener('DOMContentLoaded', () => {
    let allRoutes = [];
    let currentMethodFilter = 'ALL';
    let currentSearchQuery = '';

    const routesBody = document.getElementById('routesBody');
    const searchInput = document.getElementById('searchInput');
    const methodFilters = document.getElementById('methodFilters');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const routeCount = document.getElementById('routeCount');

    // Dynamic Base Path resolution based on where the proxy mounts the dashboard
    const basePath = window.location.pathname.replace(/\/$/, "");

    // Fetch data
    async function loadRoutes() {
        routesBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 3rem; color: var(--text-muted);">Loading routes...</td></tr>';
        
        if (routeCount) routeCount.textContent = 'Loading...';
        
        try {
            const res = await fetch(`${basePath}/api/routes`);
            if (!res.ok) throw new Error('API fetch failed');
            allRoutes = await res.json();
            renderRoutes();
        } catch (err) {
            routesBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 3rem; color: var(--del-text);">Error loading routes: ${err.message}</td></tr>`;
            if (routeCount) routeCount.textContent = '0 routes';
        }
    }

    // Time Formatting
    function timeAgo(isoString) {
        if (!isoString) return '-';
        const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // Determine confidence bar color
    function getConfidenceClass(score) {
        if (score >= 90) return 'fill-high';
        if (score >= 50) return 'fill-med';
        return 'fill-low';
    }

    // Render Table
    function renderRoutes() {
        const filtered = allRoutes.filter(route => {
            const matchesMethod = currentMethodFilter === 'ALL' || route.method === currentMethodFilter;
            const matchesSearch = route.path.toLowerCase().includes(currentSearchQuery);
            return matchesMethod && matchesSearch;
        });

        if (routeCount) {
            routeCount.textContent = `Showing ${filtered.length} of ${allRoutes.length} routes`;
        }

        if (clearSearchBtn) {
            clearSearchBtn.style.display = currentSearchQuery.length > 0 ? 'block' : 'none';
        }

        if (filtered.length === 0) {
            routesBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 3rem; color: var(--text-muted);">No routes found matching your criteria.</td></tr>';
            return;
        }

        routesBody.innerHTML = filtered.map(route => {
            const methodBadgeClass = `badge badge-${route.method.toLowerCase()}`;
            const confClass = getConfidenceClass(route.confidence_score);

            let warnBadge = '';
            if (route.error_5xx_pct > 5) warnBadge = '<span class="route-warn-badge" title="Critical: High 5xx error rate (>5%)">⚠️</span>';
            else if (route.error_4xx_pct > 20) warnBadge = '<span class="route-warn-badge" title="Warning: High 4xx error rate (>20%)">🔴</span>';

            let perfBadge = '';
            if (route.avg_time) {
                if (route.avg_time < 100) perfBadge = `<span class="route-perf-badge perf-fast" title="Fast Response (Avg ${route.avg_time}ms)">⚡</span>`;
                else if (route.avg_time <= 300) perfBadge = `<span class="route-perf-badge perf-normal" title="Normal Response (Avg ${route.avg_time}ms)">🟡</span>`;
                else perfBadge = `<span class="route-perf-badge perf-slow" title="Slow Response (Avg ${route.avg_time}ms)">🐢</span>`;
            }

            let changeBadge = '';
            if (route.has_recent_change) {
                changeBadge = `<span class="route-warn-badge" title="Recent Schema Change Detected">🔄</span>`;
            }

            return `
                <tr data-id="${route.id}">
                    <td><div class="flex-cell"><span class="${methodBadgeClass}">${route.method}</span></div></td>
                    <td class="path-text"><div class="flex-cell">${warnBadge}${changeBadge}<span class="path-label">${route.path}</span>${perfBadge}</div></td>
                    <td>
                        <div class="flex-cell">
                            <div class="confidence-cell">
                                <span class="confidence-val">${route.confidence_score}%</span>
                                <div class="progress-track">
                                    <div class="progress-fill ${confClass}" style="width: ${route.confidence_score}%"></div>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="meta-text">${route.total_observations.toLocaleString()}</td>
                    <td class="meta-text">${timeAgo(route.last_seen)}</td>
                </tr>
            `;
        }).join('');
    }

    // Event Listeners
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            currentSearchQuery = '';
            renderRoutes();
        });
    }

    searchInput.addEventListener('input', (e) => {
        currentSearchQuery = e.target.value.toLowerCase();
        renderRoutes();
    });

    methodFilters.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            // Update active styling
            methodFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            
            // Execute filter
            currentMethodFilter = e.target.dataset.method;
            renderRoutes();
        }
    });

    // Click Listeners for toggling details
    let openRowId = null;

    routesBody.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        
        // Ignore clicks if clicking inside the detail panel
        if (tr.classList.contains('detail-row')) return;
        
        const routeId = parseInt(tr.dataset.id, 10);
        
        // Toggle logic (closing)
        if (openRowId === routeId) {
            const detailRow = document.getElementById(`detail-${routeId}`);
            if (detailRow) detailRow.remove();
            openRowId = null;
            return;
        }

        // Close any previous open panel
        if (openRowId) {
            const prevRow = document.getElementById(`detail-${openRowId}`);
            if (prevRow) prevRow.remove();
        }
        openRowId = routeId;

        // Show loading detail row
        const detailRow = document.createElement('tr');
        detailRow.id = `detail-${routeId}`;
        detailRow.className = 'detail-row';
        detailRow.innerHTML = `<td colspan="5"><div class="detail-panel open" style="text-align:center; color: var(--text-muted)">Loading schema details...</div></td>`;
        tr.after(detailRow);

        try {
            const res = await fetch(`${basePath}/api/routes/${routeId}`);
            if (!res.ok) throw new Error('Failed to fetch detail');
            const detail = await res.json();
            
            const tsRes = await fetch(`${basePath}/api/routes/${routeId}/timeseries`);
            let timeseries = [];
            if (tsRes.ok) {
                timeseries = await tsRes.json();
            }

            const changeRes = await fetch(`${basePath}/api/routes/${routeId}/changes`);
            let changes = { hasChanges: false };
            if (changeRes.ok) {
                changes = await changeRes.json();
            }
            
            renderDetailPanel(detailRow, detail, timeseries, changes);
            
        } catch (err) {
            detailRow.innerHTML = `<td colspan="5"><div class="detail-panel open" style="color:var(--del-text); text-align:center">Error: ${err.message}</div></td>`;
        }
    });

    function classifyField(count, totalObservations) {
        if (totalObservations === 0) return 'edge case';
        const freq = (count / totalObservations) * 100;
        if (freq === 100) return 'required';
        if (freq >= 50) return 'optional';
        if (freq >= 10) return 'rare';
        return 'edge case';
    }

    function getStatusColor(status) {
        if (status === 'required') return 'status-required';
        if (status === 'optional') return 'status-optional';
        if (status === 'rare') return 'status-rare';
        return 'status-edge';
    }

    function renderSchemaTable(fields, totalObs) {
        if (!fields || Object.keys(fields).length === 0) {
            return '<div style="padding: 1rem; color: var(--text-muted); font-size: 0.9rem">No fields detected.</div>';
        }

        const rows = Object.entries(fields).map(([field, data]) => {
            const status = classifyField(data.count, totalObs);
            const color = getStatusColor(status);
            return `
                <tr>
                    <td style="font-family: monospace; color: #f8fafc;">${field}</td>
                    <td class="type-text">${data.type}</td>
                    <td class="${color}">${status}</td>
                </tr>
            `;
        }).join('');

        return `
            <table class="schema-table">
                <thead>
                    <tr>
                        <th>Field</th>
                        <th>Type</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
    }

    function renderStatsSection(data) {
        const totalObs = data.total_observations || 1;
        const breakdown = data.status_code_breakdown || {};
        
        let statusRows = Object.entries(breakdown).map(([code, count]) => {
            const pct = Math.round((count / totalObs) * 100);
            const codeNum = parseInt(code, 10);
            
            let colorClass = 'status-2xx';
            let fillBg = '#10b981';
            
            if (codeNum >= 300) { colorClass = 'status-3xx'; fillBg = '#3b82f6'; }
            if (codeNum >= 400) { colorClass = 'status-4xx'; fillBg = '#f59e0b'; }
            if (codeNum >= 500) { colorClass = 'status-5xx'; fillBg = '#ef4444'; }

            return `
                <div class="status-bar-row">
                    <span class="status-code-label ${colorClass}">${code}</span>
                    <div class="status-track">
                        <div class="status-fill" style="width: ${pct}%; background: ${fillBg}"></div>
                    </div>
                    <span class="status-pct">${pct}%</span>
                </div>
            `;
        }).join('');

        if (!statusRows) statusRows = '<div style="color: var(--text-muted); padding: 1rem">No status codes recorded.</div>';

        return `
            <div class="stats-section">
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Average Time</div>
                        <div class="stat-value">${data.avg_response_time}ms</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Fastest</div>
                        <div class="stat-value">${data.fastest_response_time}ms</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Slowest</div>
                        <div class="stat-value">${data.slowest_response_time}ms</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total Calls</div>
                        <div class="stat-value">${data.total_observations.toLocaleString()}</div>
                    </div>
                </div>
                <div class="schema-box">
                    <h3>Status Code Breakdown</h3>
                    <div class="status-bars">
                        ${statusRows}
                    </div>
                </div>
            </div>
        `;
    }

    function renderErrorRateBar(data) {
        const bd = data.status_breakdown || {};
        const colors = { '2xx': '#10b981', '3xx': '#3b82f6', '4xx': '#f59e0b', '5xx': '#ef4444' };

        let segments = '';
        let legend = '';
        for (const [key, val] of Object.entries(bd)) {
            if (val.percentage > 0) {
                // Show text inside if segment is wide enough (> 10%)
                const label = val.percentage > 10 ? `${key}: ${val.count} (${val.percentage}%)` : '';
                segments += `<div class="stacked-segment" style="width:${val.percentage}%; background:${colors[key]}">
                    ${label}
                    <span class="tooltip">${key}: ${val.count} requests (${val.percentage}%)</span>
                </div>`;
                legend += `<div class="legend-item">
                    <span class="legend-dot" style="background:${colors[key]}"></span>
                    <span style="color:var(--text-muted)">${key}: ${val.percentage}% (${val.count})</span>
                </div>`;
            }
        }

        if (!segments) return '';

        return `
            <div class="error-rate-section schema-box" style="margin-top: 1.5rem;">
                <h3>Error Rate</h3>
                <div class="stacked-bar-container">${segments}</div>
                <div class="stacked-legend">${legend}</div>
            </div>
        `;
    }

    function renderChangeHistory(changes) {
        if (!changes || !changes.hasChanges) {
            return `
                <div class="change-history-section schema-box">
                    <h3>Change History</h3>
                    <div style="color: var(--get-text); font-weight: 500;">✅ Schema stable — no changes detected</div>
                </div>
            `;
        }

        const addedLines = (changes.addedFields || []).map(f => `
            <div class="diff-line added">
                <span class="diff-op">+</span>
                <span class="diff-field">${f.name}</span>
                <span class="diff-type">(added) ${f.type}</span>
            </div>
        `).join('');

        const removedLines = (changes.removedFields || []).map(f => `
            <div class="diff-line removed">
                <span class="diff-op">-</span>
                <span class="diff-field">${f.name}</span>
                <span class="diff-type">(removed) ${f.type}</span>
            </div>
        `).join('');

        const changedLines = (changes.typeChanges || []).map(f => `
            <div class="diff-line changed">
                <span class="diff-op">~</span>
                <span class="diff-field">${f.name}</span>
                <span class="diff-type">changed (${f.from} → ${f.to})</span>
            </div>
        `).join('');

        const formatDate = (iso) => new Date(iso).toLocaleString();

        return `
            <div class="change-history-section schema-box">
                <h3>Change History</h3>
                <div class="change-summary-line">⚠️ Schema changed ${timeAgo(changes.detectedAt)}</div>
                <div class="change-dates">
                    <div><strong>Previous snapshot:</strong> ${formatDate(changes.prevDate)} (obs #${changes.prevObs})</div>
                    <div><strong>Current snapshot:</strong> ${formatDate(changes.currDate)} (obs #${changes.currObs})</div>
                </div>
                <div class="diff-card">
                    ${addedLines}
                    ${changedLines}
                    ${removedLines}
                </div>
            </div>
        `;
    }

    function renderDetailPanel(rowElement, data, timeseries, changes) {
        const queryObs = data.query_schema ? data.query_schema.total_observations : 0;
        const queryFields = data.query_schema ? data.query_schema.fields : {};
        
        const reqBodyObs = data.request_body_schema ? data.request_body_schema.total_observations : 0;
        const reqBodyFields = data.request_body_schema ? data.request_body_schema.fields : {};

        let queryTableHTML = renderSchemaTable(queryFields, queryObs);
        if (Object.keys(queryFields).length === 0) {
            queryTableHTML = `<div style="padding: 1rem; color: var(--text-muted); font-size: 0.9rem; font-style: italic;">No query parameters recorded.</div>`;
        }

        let reqBodyTableHTML = renderSchemaTable(reqBodyFields, reqBodyObs);
        if (Object.keys(reqBodyFields).length === 0) {
            reqBodyTableHTML = `<div style="padding: 1rem; color: var(--text-muted); font-size: 0.9rem; font-style: italic;">No request body recorded.</div>`;
        }
        
        const resTableHTML = renderSchemaTable(data.merged_schema.fields, data.merged_schema.total_observations);
        const statsHTML = renderStatsSection(data);
        const errorRateHTML = renderErrorRateBar(data);

        const perfHTML = `
            <div class="performance-section schema-box" style="margin-top: 1.5rem;">
                <h3>Response Time Graph (Last 50)</h3>
                <div class="perf-canvas-wrapper" style="padding-left: 2.5rem; padding-bottom: 2rem;">
                    <canvas id="perf-canvas-${data.id}"></canvas>
                    <div id="perf-tooltip-${data.id}" class="perf-tooltip">
                        <span class="time-val"></span>
                        <span class="date-val"></span>
                    </div>
                </div>
            </div>
        `;

        const authStatus = data.auth_required ? '<span class="status-required" style="background: var(--get-bg); padding: 2px 6px; border-radius: 4px;">Yes</span>' : 'No';
        const contentType = data.content_type || 'Unknown';

        const hasBodyParams = ['POST', 'PUT', 'PATCH'].includes(data.method);
        const queryFieldsArr = Object.keys(queryFields);

        // Path Param Detection
        const pathParamMatches = [...data.path.matchAll(/:([a-zA-Z0-9_]+)/g)];
        const pathParams = pathParamMatches.map(m => m[1]);

        let tryItPathInputs = '';
        if (pathParams.length > 0) {
            tryItPathInputs += `<h4 style="margin-bottom:0.5rem; color:var(--text-main); margin-top:1rem;">Path Parameters</h4>`;
            pathParams.forEach(p => {
                tryItPathInputs += `
                    <div class="try-it-field-group">
                        <label>:${p}</label>
                        <input type="text" class="try-it-input" id="try-it-p-${data.id}-${p}" placeholder="Value for :${p}" />
                    </div>
                `;
            });
        }

        let tryItInputs = '';
        if (queryFieldsArr.length > 0) {
            tryItInputs += `<h4 style="margin-bottom:0.5rem; color:var(--text-main); margin-top: 1rem;">Query Parameters</h4>`;
            queryFieldsArr.forEach(p => {
                const pType = data.query_schema.fields[p].type;
                tryItInputs += `
                    <div class="try-it-field-group">
                        <label>${p} (${pType})</label>
                        <input type="text" class="try-it-input" id="try-it-q-${data.id}-${p}" placeholder="Enter ${p}" />
                    </div>
                `;
            });
        }

        // JSON Body Pre-population
        let prefilledBody = '{}';
        if (reqBodyFields && Object.keys(reqBodyFields).length > 0) {
            const template = {};
            Object.keys(reqBodyFields).forEach(k => {
                template[k] = "";
            });
            prefilledBody = JSON.stringify(template, null, 2);
        }

        let tryItBody = '';
        if (hasBodyParams) {
             tryItBody = `
                <h4 style="margin-bottom:0.5rem; color:var(--text-main); margin-top: 1rem;">JSON Body</h4>
                <div class="try-it-field-group">
                    <textarea class="try-it-textarea" id="try-it-b-${data.id}" placeholder="{}">${prefilledBody}</textarea>
                </div>
            `;
        }

        rowElement.innerHTML = `
            <td colspan="5" style="background:#111827">
                <div class="detail-panel open">
                    <button class="try-it-btn" id="try-it-toggle-${data.id}" style="z-index: 100;">Try It ▶</button>
                    <div class="meta-badges">
                        <div class="meta-badge">
                            Auth Required: <strong>${authStatus}</strong>
                        </div>
                        <div class="meta-badge">
                            Content-Type: <strong>${contentType}</strong>
                        </div>
                    </div>
                    <div class="schema-grid">
                        <div class="schema-box">
                            <h3>Request Body</h3>
                            ${reqBodyTableHTML}
                        </div>
                        <div class="schema-box">
                            <h3>Response Schema</h3>
                            ${resTableHTML}
                        </div>
                    </div>
                    <div class="schema-box" style="margin-top: 1.5rem;">
                        <h3>Query Params</h3>
                        ${queryTableHTML}
                    </div>
                    ${statsHTML}
                    ${errorRateHTML}
                    ${renderChangeHistory(changes)}
                    ${perfHTML}

                    <!-- TRY IT SECTION -->
                    <div class="try-it-container" id="try-it-wrap-${data.id}" style="display: none;">
                        <h3 style="margin-bottom: 1.5rem; color: var(--text-main);">
                            ${data.method} ${data.path}
                        </h3>
                        
                        <div class="try-it-field-group" style="margin-bottom: 1.5rem;">
                            <label>Authorization Header (optional)</label>
                            <input type="text" class="try-it-input" id="try-it-auth-${data.id}" placeholder="Bearer your-token-here" />
                        </div>

                        ${tryItPathInputs}
                        ${tryItInputs}
                        ${tryItBody}

                        <div class="try-it-actions" style="margin-bottom: 2rem;">
                            <button class="try-it-btn" style="position:relative; top:0; right:0;" id="try-it-send-${data.id}">Send Request ▶</button>
                            <button class="btn-clear" id="try-it-clear-${data.id}">Clear</button>
                        </div>

                        <div class="try-it-terminal" id="try-it-term-${data.id}" style="display: none;">
                            <div class="term-header">
                                <span id="try-it-status-${data.id}"></span>
                                <span id="try-it-time-${data.id}" style="color:var(--text-muted);"></span>
                            </div>
                            <pre id="try-it-res-${data.id}"></pre>
                        </div>
                    </div>
                </div>
            </td>
        `;

        // Direct Listener Attachment (No timeout for listeners)
        const toggleBtn = document.getElementById(`try-it-toggle-${data.id}`);
        const wrap = document.getElementById(`try-it-wrap-${data.id}`);
        const sendBtn = document.getElementById(`try-it-send-${data.id}`);
        const clearBtn = document.getElementById(`try-it-clear-${data.id}`);

        if (toggleBtn && wrap) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                const isHidden = wrap.style.display === 'none';
                wrap.style.display = isHidden ? 'block' : 'none';
                if (isHidden) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };
        }

        if (clearBtn) {
            clearBtn.onclick = () => {
                if (hasBodyParams) document.getElementById(`try-it-b-${data.id}`).value = prefilledBody;
                queryFieldsArr.forEach(p => {
                    document.getElementById(`try-it-q-${data.id}-${p}`).value = '';
                });
                pathParams.forEach(p => {
                    const el = document.getElementById(`try-it-p-${data.id}-${p}`);
                    if (el) el.value = '';
                });
                const authEl = document.getElementById(`try-it-auth-${data.id}`);
                if (authEl) authEl.value = '';
                const term = document.getElementById(`try-it-term-${data.id}`);
                if (term) term.style.display = 'none';
            };
        }

        if (sendBtn) {
            sendBtn.onclick = async () => {
                const term = document.getElementById(`try-it-term-${data.id}`);
                const statusBox = document.getElementById(`try-it-status-${data.id}`);
                const timeBox = document.getElementById(`try-it-time-${data.id}`);
                const resBox = document.getElementById(`try-it-res-${data.id}`);
                
                term.style.display = 'block';
                statusBox.innerHTML = '<span style="color:var(--text-muted)">Sending...</span>';
                timeBox.textContent = '';
                resBox.textContent = 'Waiting for response...';

                // Auth Header Capture
                const authVal = document.getElementById(`try-it-auth-${data.id}`).value;
                const headers = {};
                if (authVal) headers['Authorization'] = authVal;

                let sendBody = undefined;
                if (hasBodyParams) {
                    const rawJson = document.getElementById(`try-it-b-${data.id}`).value;
                    if (rawJson.trim() !== '') {
                        try {
                            JSON.parse(rawJson);
                            sendBody = rawJson;
                            headers['Content-Type'] = 'application/json';
                        } catch (e) {
                            statusBox.innerHTML = '<span class="status-4xx">Invalid JSON</span>';
                            resBox.textContent = e.message;
                            return;
                        }
                    }
                }

                // Path Param Substitution
                let fullPath = data.path;
                pathParams.forEach(p => {
                    const el = document.getElementById(`try-it-p-${data.id}-${p}`);
                    const val = (el ? el.value : '') || `:${p}`;
                    fullPath = fullPath.replace(new RegExp(`:${p}`, 'g'), val);
                });

                if (queryFieldsArr.length > 0) {
                    const params = new URLSearchParams();
                    queryFieldsArr.forEach(p => {
                        const el = document.getElementById(`try-it-q-${data.id}-${p}`);
                        const val = el ? el.value : '';
                        if (val) params.append(p, val);
                    });
                    const qStr = params.toString();
                    if (qStr) fullPath += '?' + qStr;
                }

                const startTime = performance.now();
                try {
                    const response = await fetch(fullPath, {
                        method: data.method,
                        headers: headers,
                        body: sendBody
                    });
                    
                    const responseTime = Math.round(performance.now() - startTime);
                    const classColor = response.ok ? 'status-2xx' : 'status-4xx';
                    statusBox.innerHTML = `<span class="${classColor}">${response.status} ${response.statusText}</span>`;
                    timeBox.textContent = responseTime + 'ms';

                    const resText = await response.text();
                    try {
                        const jsonRes = JSON.parse(resText);
                        resBox.textContent = JSON.stringify(jsonRes, null, 2);
                    } catch {
                        resBox.textContent = resText || '{ Empty Payload }';
                    }
                } catch (err) {
                    statusBox.innerHTML = '<span class="status-5xx">Request Failed</span>';
                    timeBox.textContent = '';
                    resBox.textContent = err.message;
                }
            };
        }

        // Keep Chart on delay to ensure canvas is ready
        setTimeout(() => {
            if (timeseries && timeseries.length > 0) {
                drawPerformanceChart(
                    document.getElementById(`perf-canvas-${data.id}`),
                    document.getElementById(`perf-tooltip-${data.id}`),
                    timeseries
                );
            }
        }, 50);
    }
    
    function drawPerformanceChart(canvas, tooltip, data) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        // Handle High DPI displays
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const w = rect.width;
        const h = rect.height;

        // Clear canvas
        ctx.clearRect(0, 0, w, h);

        if (data.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No performance data available', w/2, h/2);
            return;
        }

        const maxTime = Math.max(400, ...data.map(d => d.response_time));
        
        const xStep = data.length > 1 ? w / (data.length - 1) : w;
        
        function getY(time) {
            // Buffer top by 10%
            const maxPadded = maxTime * 1.1;
            return h - (time / maxPadded) * h;
        }

        // 1. Plot data segments with colors
        let maxIndex = 0;
        let maxVal = -1;

        for (let i = 0; i < data.length - 1; i++) {
            // Find LATEST max point
            if (data[i].response_time >= maxVal) { maxVal = data[i].response_time; maxIndex = i; }

            const x0 = i * xStep;
            const y0 = getY(data[i].response_time);
            const x1 = (i + 1) * xStep;
            const y1 = getY(data[i+1].response_time);

            const segmentMax = Math.max(data[i].response_time, data[i+1].response_time);
            if (segmentMax < 100) ctx.strokeStyle = '#10b981'; // Green
            else if (segmentMax <= 300) ctx.strokeStyle = '#facc15'; // Yellow
            else ctx.strokeStyle = '#ef4444'; // Red

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
        
        // Final check for max at the very last point
        if (data.length > 0 && data[data.length-1].response_time >= maxVal) {
            maxVal = data[data.length-1].response_time; maxIndex = data.length-1;
        }

        // 3. Draw Labels and Gridlines ON TOP
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        for (let t = 0; t <= maxTime; t += 100) {
            const gy = getY(t);
            if (gy < 0 || gy > h) continue;
            ctx.strokeStyle = t === 100 ? 'rgba(16, 185, 129, 0.4)' : (t === 300 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.1)');
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(t + 'ms', -10, gy);
        }

        ctx.save();
        ctx.translate(-45, h/2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ms', 0, 0);
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Last 50 Requests →', w/2, h + 30);

        // 3. Highlight slowest dot
        if (data.length > 0) {
            const hx = maxIndex * xStep;
            const hy = getY(maxVal);
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // 4. Hook up Tooltip
        let points = data.map((d, i) => ({ x: i * xStep, y: getY(d.response_time), data: d }));
        
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            
            let nearest = points[0];
            let minDist = Math.abs(mouseX - nearest.x);
            for(let i = 1; i < points.length; i++) {
                const dist = Math.abs(mouseX - points[i].x);
                if(dist < minDist) {
                    minDist = dist;
                    nearest = points[i];
                }
            }

            if (minDist < 30) {
                tooltip.classList.add('visible');
                // Calculate position relative to wrapper bounds
                let tooltipX = nearest.x - (tooltip.offsetWidth / 2);
                // Keep tooltip inside bounds
                if (tooltipX < 0) tooltipX = 0;
                if (tooltipX + tooltip.offsetWidth > rect.width) tooltipX = rect.width - tooltip.offsetWidth;
                
                tooltip.style.left = tooltipX + 'px';
                tooltip.style.top = (nearest.y - 12 - tooltip.offsetHeight) + 'px';
                tooltip.querySelector('.time-val').textContent = nearest.data.response_time + 'ms';
                
                const dDate = new Date(nearest.data.observed_at);
                tooltip.querySelector('.date-val').textContent = dDate.toLocaleTimeString();
            } else {
                tooltip.classList.remove('visible');
            }
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });
    }

    // Boot
    loadRoutes();
});
