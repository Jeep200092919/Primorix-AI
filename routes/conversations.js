const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getUserConversations,
  getConversationById,
  getConversationMessages,
  deleteConversation,
  createConversation,
} = require('../db/database');

const router = express.Router();

// GET /api/conversations — list user's conversations
router.get('/', requireAuth, (req, res) => {
  const conversations = getUserConversations(req.user.id, 100);
  res.json(conversations);
});

// POST /api/conversations — create new empty conversation
router.post('/', requireAuth, (req, res) => {
  const { title, model } = req.body;
  const conv = createConversation(req.user.id, title || 'New Conversation', model || 'primorix-1.0');
  res.json(conv);
});

// GET /api/conversations/:id — get conversation with messages
router.get('/:id', requireAuth, (req, res) => {
  const conv = getConversationById(req.params.id);
  if (!conv || conv.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const messages = getConversationMessages(conv.id);
  res.json({ ...conv, messages });
});

// DELETE /api/conversations/:id
router.delete('/:id', requireAuth, (req, res) => {
  const result = deleteConversation(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json({ success: true });
});

module.exports = router;
