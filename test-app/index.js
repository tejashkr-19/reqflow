const express = require('express');
const reqflow = require('../index');

const app = express();
const port = 3000;

app.use(express.json());
app.use(reqflow({
  dashboardPath: '/reqflow',
  dbPath: './reqflow.db',
  exclude: ['/health', '/ping']
}));

// --- Fix 1: Mounted Router Support ---
const urlRouter = express.Router();
urlRouter.get('/', (req, res) => res.json({ message: 'Welcome to mounted router' }));
urlRouter.get('/:shortid', (req, res) => {
  // --- Fix 2: Redirect Tracking ---
  if (req.params.shortid === 'redir') {
    return res.redirect('/health');
  }
  res.json({ shortid: req.params.shortid, fullPath: req.baseUrl + req.route.path });
});
app.use('/url', urlRouter);

// Routes for exclusion testing
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ping', (req, res) => res.send('pong'));

app.get('/api/users', (req, res) => {
  res.json([
    { 
      id: 1, 
      name: 'Alice Smith', 
      email: 'alice@example.com', 
      role: 'admin', 
      lastLogin: '2026-03-31T10:00:00Z', 
      isActive: true 
    },
    { 
      id: 2, 
      name: 'Bob Jones', 
      email: 'bob@example.com', 
      role: 'user', 
      lastLogin: '2026-03-30T15:30:00Z', 
      isActive: false 
    }
  ]);
});

let loginCount = 0;
app.post('/api/login', (req, res) => {
  loginCount++;
  // Add artificial random delay for performance chart testing
  const delay = Math.floor(Math.random() * 450); // 0 to 450ms
  
  setTimeout(() => {
    if (req.body && req.body.email === 'bad') {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const user = {
      id: 1,
      name: 'Alice Smith',
      email: 'alice@example.com',
      role: 'admin'
    };

    // Add field dynamically after 20 requests to trigger Feature 4 Change Detection
    if (loginCount > 20) {
      user.role2 = 'superadmin';
    }

    res.json({
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      user,
      lastLogin: '2026-04-01'
    });
  }, delay);
});

app.get('/api/crash', (req, res) => {
  throw new Error('Intentional crash test')
});

app.get('/api/users/:id', (req, res) => {
  res.json({
    id: parseInt(req.params.id),
    name: 'Alice Smith',
    email: 'alice@example.com',
    role: 'admin',
    lastLogin: '2026-03-31T10:00:00Z',
    isActive: true,
    preferences: {
      theme: 'dark',
      notifications: true
    }
  });
});

app.put('/api/users/:id', (req, res) => {
  const updatedData = req.body || {};
  res.json({
    id: parseInt(req.params.id),
    name: updatedData.name || 'Alice Mod',
    email: updatedData.email || 'alice_mod@example.com',
    role: updatedData.role || 'admin',
    lastUpdated: new Date().toISOString()
  });
});

app.delete('/api/users/:id', (req, res) => {
  res.json({
    success: true,
    message: `User ${req.params.id} successfully deleted.`,
    deletedAt: new Date().toISOString()
  });
});

app.get('/api/items/search', (req, res) => {
  const hasAuth = !!req.headers['authorization'];
  const { category, limit, password } = req.query;
  
  res.json({
    success: true,
    authDetected: hasAuth,
    results: [
      { id: 101, name: 'Item 1', category: category || 'general' },
      { id: 102, name: 'Item 2', category: category || 'general' }
    ],
    limit: parseInt(limit) || 10,
    debug: password ? 'Sensitive field detected in query' : 'No password'
  });
});

app.listen(port, () => {
  console.log(`Test app listening on port ${port}`);
});

// Error Handler (Must be at bottom for Reqflow capture test)
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// Catch-all for wrong routes to test 404 error tracking
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});
