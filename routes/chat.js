const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { requireAuth } = require('../middleware/auth');
const {
  createConversation,
  getConversationById,
  addMessage,
  getRecentMessages,
  getUserMemory,
  setUserMemory,
  updateConversationTitle,
} = require('../db/database');
const {
  sendMessage,
  sendMessageWithFile,
  generateConversationTitle,
  extractMemoryFacts,
  CHAT_MODEL,
  CODE_MODEL,
} = require('../ai/client');

const router = express.Router();

// ── Multer (memory storage, 20 MB limit) ─────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'text/plain', 'text/markdown', 'text/html', 'text/css',
      'application/javascript', 'application/json', 'application/xml',
      'text/x-python', 'text/x-java-source', 'text/x-c', 'text/x-c++',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const textExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
                      '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sh',
                      '.sql', '.yaml', '.yml', '.toml', '.env', '.md', '.txt',
                      '.html', '.css', '.json', '.xml', '.csv'];
    if (allowed.includes(file.mimetype) || textExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.originalname}`));
    }
  },
});

// ── Helper: extract file content for AI ──────────────────────────────────────
async function extractFileContent(file) {
  const mime = file.mimetype;
  const name = file.originalname;

  // Image
  if (mime.startsWith('image/')) {
    return {
      type: 'image',
      name,
      mimeType: mime,
      content: file.buffer.toString('base64'),
    };
  }

  // PDF
  if (mime === 'application/pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      return {
        type: 'pdf',
        name,
        content: data.text.slice(0, 12000), // cap to avoid token overflow
      };
    } catch {
      return { type: 'pdf', name, content: '[Could not extract PDF text]' };
    }
  }

  // Text / code file
  return {
    type: 'text',
    name,
    content: file.buffer.toString('utf8').slice(0, 12000),
  };
}

// ── POST /api/chat/send ───────────────────────────────────────────────────────
// Accepts JSON (no file) OR multipart/form-data (with file)
const handleUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    upload.single('file')(req, res, next);
  } else {
    next();
  }
};

router.post('/send', requireAuth, handleUpload, async (req, res) => {
  const message        = (req.body.message || '').trim();
  const conversationId = req.body.conversationId || null;
  const mode           = req.body.mode === 'code' ? 'code' : 'chat';
  const uploadedFile   = req.file || null;

  if (!message && !uploadedFile) {
    return res.status(400).json({ error: 'Message or file is required' });
  }

  const user = req.user;
  let conv;

  if (conversationId) {
    conv = getConversationById(conversationId);
    if (!conv || conv.user_id !== user.id) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
  } else {
    conv = createConversation(user.id, 'New Conversation', 'primorix-1.0');
  }

  const recentMessages = getRecentMessages(conv.id, mode === 'code' ? 6 : 25);
  const memoryFacts    = user.is_guest ? [] : getUserMemory(user.id);

  // Build the display label for the user message saved to DB
  let userDisplayMessage = message;
  if (uploadedFile) {
    const tag = uploadedFile.mimetype.startsWith('image/') ? '🖼️' : '📄';
    userDisplayMessage = message
      ? `${message}\n\n${tag} ${uploadedFile.originalname}`
      : `${tag} ${uploadedFile.originalname}`;
  }

  addMessage(conv.id, 'user', userDisplayMessage);

  try {
    let aiText;

    if (uploadedFile) {
      const fileData = await extractFileContent(uploadedFile);
      aiText = await sendMessageWithFile({
        user, memoryFacts,
        memorySummary: user.memory_summary || '',
        conversationHistory: recentMessages,
        userMessage: message,
        file: fileData,
        mode,
      });
    } else {
      aiText = await sendMessage({
        user, memoryFacts,
        memorySummary: user.memory_summary || '',
        conversationHistory: recentMessages,
        userMessage: message,
        mode,
      });
    }

    addMessage(conv.id, 'model', aiText);

    const isNewConv = recentMessages.length === 0;
    if (isNewConv) {
      generateConversationTitle(userDisplayMessage, aiText)
        .then(title => updateConversationTitle(conv.id, title))
        .catch(() => {});
    }

    const totalMessages = recentMessages.length + 2;
    if (!user.is_guest && totalMessages % 8 === 0) {
      extractMemoryFacts(user, getRecentMessages(conv.id, 16)).then(facts => {
        facts.forEach(f => { if (f.key && f.value) setUserMemory(user.id, f.key, f.value); });
      }).catch(() => {});
    }

    res.json({
      conversationId: conv.id,
      message: { role: 'model', content: aiText, created_at: new Date().toISOString() },
      isNewConversation: isNewConv,
    });
  } catch (err) {
    console.error('[chat/send]', err);
    res.status(500).json({ error: 'Failed to get AI response: ' + err.message });
  }
});

// ── GET /api/chat/memory ──────────────────────────────────────────────────────
router.get('/memory', requireAuth, (req, res) => {
  if (req.user.is_guest) return res.json({ facts: [], isGuest: true });
  res.json({ facts: getUserMemory(req.user.id), isGuest: false });
});

// ── DELETE /api/chat/memory/:key ──────────────────────────────────────────────
router.delete('/memory/:key', requireAuth, (req, res) => {
  if (req.user.is_guest) return res.status(403).json({ error: 'Guests cannot manage memory' });
  const { deleteUserMemory } = require('../db/database');
  deleteUserMemory(req.user.id, decodeURIComponent(req.params.key));
  res.json({ success: true });
});

// ── GET /api/chat/models ──────────────────────────────────────────────────────
router.get('/models', (req, res) => {
  res.json({
    models: [{ id: 'primorix-1.0', name: 'Primorix 1.0', internalModel: CHAT_MODEL }],
    codeModeModel: CODE_MODEL,
  });
});

module.exports = router;
