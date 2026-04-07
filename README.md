# Reqflow

> Zero-config Express.js middleware that auto-generates API documentation by observing live traffic.

No manual annotation. No Swagger comments. No configuration needed.
Just add one line to your Express app.

---

## The Problem

Every Express developer faces this:

- **Swagger** requires annotating every route with special comments
- Docs go **outdated the moment** your code changes
- New team members waste hours figuring out what each API returns
- Static analysis tools describe what your API *should* do — not what it *actually* does

## The Solution

Reqflow sits silently in your Express middleware pipeline and **watches real traffic**.
It learns your API by observation — building accurate, live documentation automatically.

```
Code tells you what should happen.
Traffic tells you what actually happens.
Reqflow lives in that gap.
```

---

## Quick Start

```bash
npm install reqflow
```

```js
const express = require('express')
const reqflow = require('reqflow')

const app = express()
app.use(express.json())
app.use(reqflow())   // ← that's it

app.get('/api/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice', role: 'admin' }])
})

app.listen(3000)
```

Open **http://localhost:3000/reqflow** to see your live API docs.

---

## How It Works

```
Incoming Request
      ↓
  Reqflow Middleware (silently watches)
      ↓
  Your Route Handler (runs normally)
      ↓
  Reqflow captures response
      ↓
  Schema inference engine learns field types
      ↓
  Merges with existing observations
      ↓
  Updates confidence score
      ↓
  Live docs at /reqflow auto-update
```

Every request makes your documentation more accurate.
After 50+ requests per route — confidence reaches 90%+.

---

## Features

### Zero Configuration
Drop into any existing Express app with one line.
No route annotations. No special comments. No setup.

### Schema Inference Engine
Automatically detects field types, classifies them as
`required`, `optional`, `rare`, or `edge case` based on
how often they appear across real requests.

### Confidence Scoring
Every route has a confidence score based on observation count.
The more traffic — the more accurate your docs.

### Live Dashboard
Clean, searchable documentation UI served at `/reqflow`.
Shows all routes, schemas, stats, and performance metrics.

### Try It Button
Test any endpoint directly from the docs — like Postman
built into your dashboard. No switching tools.

### Response Time Monitoring
Canvas-based performance chart showing last 50 response times
per route. Color coded: green (fast) → yellow → red (slow).
Performance badges on route list: ⚡ Fast / 🟡 Normal / 🐢 Slow

### Error Rate Tracking
Status code breakdown per route shown as a stacked bar.
Warning badges if error rates cross thresholds:
- ⚠️ if 5xx errors exceed 5%
- 🔴 if 4xx errors exceed 20%

### Change Detection
Automatic schema snapshots every 20 observations.
Detects when your API silently changes and shows a diff:
```
⚠️ Schema changed 2 days ago

+ lastLogin   string   added
- oldField    string   removed
~ age         string → number
```
🔄 badge appears on routes where schema changed recently.

### Sensitive Field Masking
Fields named `password`, `token`, `secret`, `key`, `apikey`, `auth`
are automatically flagged as `string ⚠️ sensitive` in the schema.
Values are never stored — only types.

### Auth & Content-Type Detection
Shows whether each route requires authorization and
what content type it expects. No manual setup needed.

---

## Dashboard Preview

```
┌─────────────────────────────────────────────────────────────┐
│  Reqflow — Live API Docs          🔍 Search routes...        │
│                                  [All][GET][POST][PUT][DEL]  │
├────────┬──────────────────┬────────────────┬────────┬───────┤
│ METHOD │ PATH             │ CONFIDENCE     │ OBS    │ LAST  │
├────────┼──────────────────┼────────────────┼────────┼───────┤
│ POST   │ /api/login  🔄   │ ████████ 87%   │ 23     │ 2m    │
│ GET    │ /api/users  ⚡   │ ██████ 72%     │ 15     │ 5m    │
│ GET    │ /api/users/:id ⚠️│ ███ 34%        │ 5      │ 1h    │
│ DELETE │ /api/users/:id   │ █ 10%          │ 1      │ 12h   │
└────────┴──────────────────┴────────────────┴────────┴───────┘

  POST /api/login                                87% ████████
  ─────────────────────────────────────────────────────────
  Auth Required: Yes    Content-Type: application/json

  REQUEST BODY              RESPONSE SCHEMA
  email    string  ✅       token      string  ✅
  password string  ⚠️       user.id    number  ✅
                            user.name  string  ✅
                            user.email string  ✅
                            isPremium  boolean 〰️

  STATS
  Avg: 42ms  Fastest: 12ms  Slowest: 312ms  Total: 23

  STATUS CODES
  200 ████████████████ 89%
  401 ███ 8%
  500 █ 3%
```

---

## Configuration

All options are optional. Works out of the box with zero config.

```js
app.use(reqflow({
  dashboardPath: '/reqflow',    // Dashboard URL path (default: /reqflow)
  dbPath: './reqflow.db',       // SQLite database location (default: project root)
  exclude: ['/health', '/ping'] // Routes to ignore completely
}))
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dashboardPath` | string | `/reqflow` | URL where dashboard is served |
| `dbPath` | string | `./reqflow.db` | Path to SQLite database file |
| `exclude` | string[] | `[]` | Route paths to exclude from tracking |

---

## API Endpoints

Reqflow exposes these endpoints automatically:

| Endpoint | Description |
|----------|-------------|
| `GET /reqflow` | Live documentation dashboard |
| `GET /reqflow/api/routes` | All routes as JSON |
| `GET /reqflow/api/routes/:id` | Single route detail with schema |
| `GET /reqflow/api/routes/:id/timeseries` | Response time series data |
| `GET /reqflow/api/routes/:id/changes` | Schema change detection data |

---

## How Schema Inference Works

Reqflow uses frequency tracking — no ML, no guessing:

```js
// After 10 observations of POST /api/login:
{
  "email":     { count: 10, type: "string" },  // 10/10 = required
  "password":  { count: 10, type: "string" },  // 10/10 = required ⚠️ sensitive
  "remember":  { count: 4,  type: "boolean" }, // 4/10  = optional
  "device":    { count: 1,  type: "string" }   // 1/10  = rare
}
```

Field classification thresholds:
- `100%` → **required** (always present)
- `50–99%` → **optional** (usually present)
- `10–49%` → **rare** (sometimes present)
- `< 10%` → **edge case** (barely ever seen)

---

## Confidence Score

| Observations | Confidence | Meaning |
|-------------|------------|---------|
| 1 | 10% | Barely know anything |
| 10 | 50% | Getting there |
| 50 | 90% | Pretty accurate |
| 100+ | 99% | Highly trusted |

---

## Reqflow vs Swagger

| | Swagger | Reqflow |
|---|---|---|
| Setup | Annotate every route | One line |
| Accuracy | What you write | What actually happens |
| Maintenance | Manual updates | Automatic |
| Goes outdated? | Immediately | Never |
| Catches edge cases | No | Yes |
| Confidence scoring | No | Yes |
| Change detection | No | Yes |
| Performance monitoring | No | Yes |

---

## Requirements

- Node.js >= 14
- Express >= 4.0.0

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/tejashkr-19/reqflow
cd reqflow

# Install dependencies
npm install

# Run tests
npm test

# Start example app
npm start
# Open http://localhost:3000/reqflow
```

---

## Running Tests

```bash
npm test
```

```
PASS  test/inference.test.js
  inferSchema     ✓ 8 tests passed
  mergeSchema     ✓ 4 tests passed
  classifyField   ✓ 4 tests passed
  confidence      ✓ 4 tests passed

Tests: 20 passed, 20 total
```

---

## Project Structure

```
reqflow/
├── src/
│   ├── middleware.js      # Traffic interceptor
│   ├── inference.js       # Schema inference engine
│   ├── storage.js         # SQLite read/write
│   └── dashboard/
│       ├── index.html     # Dashboard UI
│       └── app.js         # Dashboard JavaScript
├── test/
│   └── inference.test.js  # Unit tests
├── test-app/
│   └── index.js           # Example Express app
├── index.js               # Package entry point
└── package.json
```

---

## How It's Different from AI Documentation Tools

Tools like Qoder read your **static code files** and document what the code says.
Reqflow observes **live HTTP traffic** and documents what your API actually does.

- Code tells you what *should* happen
- Traffic tells you what *actually* happens
- Only live traffic can tell you a field appears 23% of the time
- Only live traffic can tell you response time spikes under certain conditions

---

## Contributing

Contributions are welcome! Please open an issue first to discuss
what you would like to change.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## License

MIT © Tejash K R

---

## Author

Built by Tejash K R as an open source developer tool.

If Reqflow saves you time — consider giving it a ⭐ on GitHub!

---

*"The best documentation is the one that writes itself."*
