require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { discoverModel } = require('./ai/client');
const { getDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/chat', require('./routes/chat'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', name: 'Primorix AI' });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  // Initialize DB
  console.log('[Primorix AI] Initializing database...');
  getDb();
  console.log('[Primorix AI] Database ready.');

  // Discover and initialize AI model
  console.log('[Primorix AI] Discovering AI model...');
  try {
    const modelId = await discoverModel();
    console.log(`[Primorix AI] Model ready: ${modelId}`);
  } catch (err) {
    console.error('[Primorix AI] WARNING: AI model initialization failed:', err.message);
    console.error('[Primorix AI] The server will start but AI responses may not work.');
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Primorix AI running at http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('[Primorix AI] Fatal startup error:', err);
  process.exit(1);
});
