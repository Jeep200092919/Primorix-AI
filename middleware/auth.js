const jwt = require('jsonwebtoken');
const { findUserById, updateUserLastSeen } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'primorix-ai-secret-key-change-in-production-2024';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    updateUserLastSeen(user.id);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.userId);
    if (user) {
      updateUserLastSeen(user.id);
      req.user = user;
    }
  } catch {
    // Ignore invalid tokens for optional auth
  }
  next();
}

module.exports = { signToken, requireAuth, optionalAuth };
