const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  createUser,
  createGuestUser,
  findUserByUsername,
  findUserByEmail,
  findGuestBySessionId,
} = require('../db/database');
const { signToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'Username must be 3–30 characters' });
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, _, ., -' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  if (email && findUserByEmail(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = createUser({ username, email, passwordHash });
    const token = signToken(result.lastInsertRowid);
    res.json({
      token,
      user: { id: result.lastInsertRowid, username, email: email || null, isGuest: false },
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findUserByUsername(username) || findUserByEmail(username);

  if (!user || user.is_guest) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(user.id);
  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, isGuest: false },
  });
});

// POST /api/auth/guest
router.post('/guest', (req, res) => {
  const { sessionId } = req.body;
  const guestSessionId = sessionId || uuidv4();

  let user = findGuestBySessionId(guestSessionId);
  if (!user) {
    const result = createGuestUser(guestSessionId);
    user = { id: result.lastInsertRowid, username: `Guest_${guestSessionId.slice(0, 8)}`, is_guest: 1 };
  }

  const token = signToken(user.id);
  res.json({
    token,
    guestSessionId,
    user: { id: user.id, username: user.username, isGuest: true },
  });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    username: u.username,
    email: u.email,
    isGuest: !!u.is_guest,
    createdAt: u.created_at,
    lastSeen: u.last_seen,
  });
});

module.exports = router;
