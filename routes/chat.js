const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createConversation,
  getConversationById,
  addMessage,
  getRecentMessages,
  getUserMemory,
  setUserMemory,
} = require('../db/database');
const {
  sendMessage,
  generateConversationTitle,
  extractMemoryFacts,
  getResolvedModelId,
  CHAT_MODEL,
  CODE_MODEL,
} = require('../ai/client');

const router = express.Router();

// POST /api/chat/send
router.post('/send', requireAuth, async (req, res) => {
  const { message, conversationId, mode } = req.body;
  const chatMode = mode === 'code' ? 'code' : 'chat';

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const user = req.user;
  let conv;

  // Create or find conversation
  if (conversationId) {
    conv = getConversationById(conversationId);
    if (!conv || conv.user_id !== user.id) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
  } else {
    conv = createConversation(user.id, 'New Conversation', 'primorix-1.0');
  }

  // Fetch context: fewer messages in code mode to stay within TPM limits
  const recentMessages = getRecentMessages(conv.id, chatMode === 'code' ? 6 : 25);
  const memoryFacts = user.is_guest ? [] : getUserMemory(user.id);

  // Save user message to DB
  addMessage(conv.id, 'user', message.trim());

  try {
    // Get AI response
    const aiText = await sendMessage({
      user,
      memoryFacts,
      memorySummary: user.memory_summary || '',
      conversationHistory: recentMessages,
      userMessage: message.trim(),
      mode: chatMode,
    });

    // Save AI response to DB
    addMessage(conv.id, 'model', aiText);

    // Generate title for new conversations (after first exchange)
    const isNewConv = recentMessages.length === 0;
    if (isNewConv) {
      generateConversationTitle(message.trim(), aiText).then(title => {
        const { updateConversationTitle } = require('../db/database');
        updateConversationTitle(conv.id, title);
      }).catch(() => {});
    }

    // Extract and store memory facts periodically (every 8 messages, non-guests only)
    const totalMessages = recentMessages.length + 2;
    if (!user.is_guest && totalMessages % 8 === 0) {
      const allRecent = getRecentMessages(conv.id, 16);
      extractMemoryFacts(user, allRecent).then(facts => {
        facts.forEach(f => {
          if (f.key && f.value) setUserMemory(user.id, f.key, f.value);
        });
      }).catch(() => {});
    }

    res.json({
      conversationId: conv.id,
      message: {
        role: 'model',
        content: aiText,
        created_at: new Date().toISOString(),
      },
      isNewConversation: isNewConv,
    });
  } catch (err) {
    console.error('[chat/send]', err);
    res.status(500).json({ error: 'Failed to get AI response: ' + err.message });
  }
});

// GET /api/chat/memory — get user's stored memory
router.get('/memory', requireAuth, (req, res) => {
  if (req.user.is_guest) {
    return res.json({ facts: [], isGuest: true });
  }
  const facts = getUserMemory(req.user.id);
  res.json({ facts, isGuest: false });
});

// DELETE /api/chat/memory/:key — delete a specific memory fact
router.delete('/memory/:key', requireAuth, (req, res) => {
  if (req.user.is_guest) return res.status(403).json({ error: 'Guests cannot manage memory' });
  const { deleteUserMemory } = require('../db/database');
  deleteUserMemory(req.user.id, decodeURIComponent(req.params.key));
  res.json({ success: true });
});

// GET /api/chat/models — list available models
router.get('/models', (req, res) => {
  res.json({
    models: [
      {
        id: 'primorix-1.0',
        name: 'Primorix 1.0',
        description: 'Our flagship model — powerful, fast, and memory-enabled',
        internalModel: CHAT_MODEL,
      },
    ],
    codeModeModel: CODE_MODEL,
  });
});

module.exports = router;
