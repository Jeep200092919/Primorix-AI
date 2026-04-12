const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'primorix.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      is_guest INTEGER DEFAULT 0,
      guest_session_id TEXT UNIQUE,
      memory_summary TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      summary TEXT DEFAULT '',
      model TEXT DEFAULT 'primorix-1.0',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'model')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, memory_key)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_user ON user_memory(user_id);
  `);
}

// --- User helpers ---

function createUser({ username, email, passwordHash }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO users (username, email, password_hash)
    VALUES (?, ?, ?)
  `).run(username, email || null, passwordHash);
}

function createGuestUser(guestSessionId) {
  const db = getDb();
  const username = `Guest_${guestSessionId.slice(0, 8)}`;
  return db.prepare(`
    INSERT INTO users (username, is_guest, guest_session_id)
    VALUES (?, 1, ?)
  `).run(username, guestSessionId);
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findGuestBySessionId(sessionId) {
  return getDb().prepare('SELECT * FROM users WHERE guest_session_id = ?').get(sessionId);
}

function updateUserLastSeen(userId) {
  return getDb().prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

function updateUserMemorySummary(userId, summary) {
  return getDb().prepare('UPDATE users SET memory_summary = ? WHERE id = ?').run(summary, userId);
}

// --- Conversation helpers ---

function createConversation(userId, title = 'New Conversation', model = 'primorix-1.0') {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO conversations (user_id, title, model) VALUES (?, ?, ?)
  `).run(userId, title, model);
  return getConversationById(result.lastInsertRowid);
}

function getConversationById(id) {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function getUserConversations(userId, limit = 50) {
  return getDb().prepare(`
    SELECT c.*,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
    FROM conversations c
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function updateConversationTitle(conversationId, title) {
  return getDb().prepare(
    'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(title, conversationId);
}

function updateConversationUpdatedAt(conversationId) {
  return getDb().prepare(
    'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(conversationId);
}

function deleteConversation(conversationId, userId) {
  return getDb().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
}

// --- Message helpers ---

function addMessage(conversationId, role, content) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)
  `).run(conversationId, role, content);
  updateConversationUpdatedAt(conversationId);
  return result;
}

function getConversationMessages(conversationId, limit = 100) {
  return getDb().prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(conversationId, limit);
}

function getRecentMessages(conversationId, limit = 20) {
  const rows = getDb().prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(conversationId, limit);
  return rows.reverse();
}

// --- Memory helpers ---

function setUserMemory(userId, key, value) {
  return getDb().prepare(`
    INSERT INTO user_memory (user_id, memory_key, memory_value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, memory_key) DO UPDATE SET
      memory_value = excluded.memory_value,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, key, value);
}

function getUserMemory(userId) {
  return getDb().prepare('SELECT memory_key, memory_value FROM user_memory WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
}

function deleteUserMemory(userId, key) {
  return getDb().prepare('DELETE FROM user_memory WHERE user_id = ? AND memory_key = ?').run(userId, key);
}

function clearUserMemory(userId) {
  return getDb().prepare('DELETE FROM user_memory WHERE user_id = ?').run(userId);
}

module.exports = {
  getDb,
  createUser,
  createGuestUser,
  findUserById,
  findUserByUsername,
  findUserByEmail,
  findGuestBySessionId,
  updateUserLastSeen,
  updateUserMemorySummary,
  createConversation,
  getConversationById,
  getUserConversations,
  updateConversationTitle,
  deleteConversation,
  addMessage,
  getConversationMessages,
  getRecentMessages,
  setUserMemory,
  getUserMemory,
  deleteUserMemory,
  clearUserMemory,
};
